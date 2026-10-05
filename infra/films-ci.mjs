#!/usr/bin/env node
// The access CI needs to publish the films (.github/workflows/films.yml).
//
//   node infra/films-ci.mjs --dry-run   say what it would do, change nothing
//   node infra/films-ci.mjs             create or update it all
//   node infra/films-ci.mjs --status    what exists now
//
// - An IAM role, stz-films-ci, that only a GitHub Actions run on this
//   repository's main branch can assume, through the account's GitHub OIDC
//   provider. No access keys exist anywhere.
// - Its one permission: list, write and delete under films/ in the staging
//   bucket. It cannot touch anything else in staging, nor the live bucket:
//   the admin's publish takes films live, like everything else.
// - The repository variables the workflow reads (FILMS_ROLE_ARN,
//   STAGING_BUCKET, BUCKET_REGION), set with the GitHub CLI. Variables, not
//   secrets: none of them is one, but they belong to this deployment.
//
// Records FILMS_ROLE_ARN in .env. Idempotent: run it again after changing
// anything above.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { need, saveEnv } from "./shared/env.mjs";

const execFileAsync = promisify(execFile);
const DRY = process.argv.includes("--dry-run");
const STATUS = process.argv.includes("--status");
const ROLE = "stz-films-ci";
const POLICY = "films-to-staging";
const OIDC_HOST = "token.actions.githubusercontent.com";
const STAGING = need("STAGING_BUCKET", "node infra/provision.mjs");
const REGION = need("BUCKET_REGION");
const log = (s) => console.log(`  ${s}`);

async function run(cmd, args, { allowFail = false, json = true } = {}) {
  try {
    const { stdout } = await execFileAsync(cmd, args, { maxBuffer: 16 * 1024 * 1024 });
    return json && stdout.trim() ? JSON.parse(stdout) : stdout.trim();
  } catch (err) {
    if (allowFail) return null;
    throw new Error(`${cmd} ${args.slice(0, 3).join(" ")} failed:\n  ${String(err.stderr || err.message).trim()}`);
  }
}
const aws = (args, o) => run("aws", [...args, "--output", "json"], o);

// which repository: the origin remote, e.g. git@github.com:owner/name.git
const remote = await run("git", ["remote", "get-url", "origin"], { json: false });
const repo = (remote.match(/github\.com[:/]([^/]+\/[^/]+?)(\.git)?$/) || [])[1];
if (!repo) throw new Error(`origin (${remote}) is not a GitHub repository`);

const account = (await aws(["sts", "get-caller-identity"])).Account;
const providerArn = `arn:aws:iam::${account}:oidc-provider/${OIDC_HOST}`;
const providers = (await aws(["iam", "list-open-id-connect-providers"])).OpenIDConnectProviderList.map((p) => p.Arn);
if (!providers.includes(providerArn)) {
  throw new Error(`the account has no GitHub OIDC provider (${OIDC_HOST}). Create it once:\n` +
    `  aws iam create-open-id-connect-provider --url https://${OIDC_HOST} --client-id-list sts.amazonaws.com`);
}

const trust = {
  Version: "2012-10-17",
  Statement: [{
    Effect: "Allow",
    Principal: { Federated: providerArn },
    Action: "sts:AssumeRoleWithWebIdentity",
    Condition: {
      StringEquals: {
        [`${OIDC_HOST}:aud`]: "sts.amazonaws.com",
        [`${OIDC_HOST}:sub`]: `repo:${repo}:ref:refs/heads/main`,
      },
    },
  }],
};
const permissions = {
  Version: "2012-10-17",
  Statement: [
    { Effect: "Allow", Action: "s3:ListBucket", Resource: `arn:aws:s3:::${STAGING}`, Condition: { StringLike: { "s3:prefix": ["films/*", "films/"] } } },
    { Effect: "Allow", Action: ["s3:PutObject", "s3:DeleteObject"], Resource: `arn:aws:s3:::${STAGING}/films/*` },
  ],
};

console.log(`films CI for ${repo}${DRY ? " (dry run)" : STATUS ? " (status)" : ""}`);
const existing = await aws(["iam", "get-role", "--role-name", ROLE], { allowFail: true });
log(`role ${ROLE}: ${existing ? "exists" : "missing"}`);
if (STATUS) {
  const vars = await run("gh", ["variable", "list", "--repo", repo, "--json", "name"], { allowFail: true });
  log(`repository variables: ${vars ? vars.map((v) => v.name).join(", ") || "none" : "could not read (gh auth status)"}`);
  process.exit(0);
}

if (DRY) {
  log(existing ? `would update ${ROLE}'s trust to main of ${repo}` : `would create ${ROLE}, assumable only from main of ${repo}`);
  log(`would allow it: list, put, delete under s3://${STAGING}/films/ (nothing else)`);
  log(`would set repository variables FILMS_ROLE_ARN, STAGING_BUCKET, BUCKET_REGION on ${repo}`);
  process.exit(0);
}

let roleArn;
if (existing) {
  await aws(["iam", "update-assume-role-policy", "--role-name", ROLE, "--policy-document", JSON.stringify(trust)]);
  roleArn = existing.Role.Arn;
  log("trust policy updated");
} else {
  roleArn = (await aws(["iam", "create-role", "--role-name", ROLE, "--assume-role-policy-document", JSON.stringify(trust),
    "--description", "GitHub Actions: publish stories/ films to the staging bucket's films/", "--max-session-duration", "3600"])).Role.Arn;
  log("role created");
}
await aws(["iam", "put-role-policy", "--role-name", ROLE, "--policy-name", POLICY, "--policy-document", JSON.stringify(permissions)]);
log(`policy ${POLICY}: films/ in the staging bucket only`);

for (const [name, value] of [["FILMS_ROLE_ARN", roleArn], ["STAGING_BUCKET", STAGING], ["BUCKET_REGION", REGION]]) {
  await run("gh", ["variable", "set", name, "--repo", repo, "--body", value], { json: false });
  log(`repository variable ${name} set`);
}
saveEnv({ FILMS_ROLE_ARN: roleArn });
console.log(`\n.env updated. Next push to main that touches stories/ publishes the films to staging;`);
console.log(`run it now with: gh workflow run films.yml --repo ${repo}`);
