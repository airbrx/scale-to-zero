#!/usr/bin/env node
// Runs the access-log stats twice a day, so they never fall a week behind.
//
//   node infra/schedule-stats.mjs            create or update the schedule
//   node infra/schedule-stats.mjs --status   show it, and the last runs
//   node infra/schedule-stats.mjs --remove   delete it
//
// An EventBridge rule invokes the admin Lambda directly with
// {"job":"process-stats"}. server.mjs handles that event by running the same
// incremental processing as the admin's Refresh button (POST /api/stats), and
// refuses any other direct invocation. The rule reaches the function through a
// resource-based permission scoped to this one rule's ARN -- no role, no
// Function URL, no origin header involved.
//
// Idempotent: every step checks first, so re-running after a change to the
// schedule just updates it. Uses the AWS CLI, like the rest of infra/.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const REGION = "us-east-1";          // where the admin Lambda lives
const FN = "stz-admin";
const RULE = "stz-stats-twice-daily";
const STATEMENT = "AllowStatsScheduleInvoke";
// 07:00 and 19:00 UTC: midnight and noon Pacific daylight time (an hour
// earlier in winter). EventBridge rules run on UTC.
const SCHEDULE = "cron(0 7,19 * * ? *)";
const INPUT = JSON.stringify({ job: "process-stats" });

const args = process.argv.slice(2);
const log = (s) => console.log(`  ${s}`);

async function aws(cmd, { allowFail = false } = {}) {
  try {
    const { stdout } = await execFileAsync("aws", [...cmd, "--region", REGION, "--output", "json"], { maxBuffer: 16 * 1024 * 1024 });
    return stdout.trim() ? JSON.parse(stdout) : null;
  } catch (err) {
    if (allowFail) return null;
    throw new Error(`aws ${cmd.slice(0, 2).join(" ")} failed:\n  ${String(err.stderr || err.message).trim()}`);
  }
}

const fnArn = (await aws(["lambda", "get-function-configuration", "--function-name", FN])).FunctionArn;

async function permissionStatement() {
  const policy = await aws(["lambda", "get-policy", "--function-name", FN], { allowFail: true });
  if (!policy) return null;
  return JSON.parse(policy.Policy).Statement.find((s) => s.Sid === STATEMENT) ?? null;
}

if (args.includes("--status")) {
  const rule = await aws(["events", "describe-rule", "--name", RULE], { allowFail: true });
  if (!rule) {
    console.log(`no rule ${RULE}; run without --status to create it`);
    process.exit(0);
  }
  const targets = await aws(["events", "list-targets-by-rule", "--rule", RULE]);
  console.log(`${RULE}: ${rule.State}, ${rule.ScheduleExpression}`);
  for (const t of targets.Targets) log(`target ${t.Arn} input ${t.Input}`);
  log(`invoke permission: ${(await permissionStatement()) ? "present" : "MISSING"}`);
  const since = String(Date.now() - 3 * 864e5);
  const events = await aws(["logs", "filter-log-events", "--log-group-name", `/aws/lambda/${FN}`,
    "--start-time", since, "--filter-pattern", "\"process-stats\""], { allowFail: true });
  const runs = (events?.events ?? []).map((e) => e.message.trim()).filter((m) => m.includes("\"job\""));
  log(`runs in the last 3 days: ${runs.length}`);
  for (const r of runs.slice(-6)) log(`  ${r.slice(r.indexOf("{"))}`);
  process.exit(0);
}

if (args.includes("--remove")) {
  const rule = await aws(["events", "describe-rule", "--name", RULE], { allowFail: true });
  if (rule) {
    const targets = await aws(["events", "list-targets-by-rule", "--rule", RULE]);
    if (targets.Targets.length) await aws(["events", "remove-targets", "--rule", RULE, "--ids", ...targets.Targets.map((t) => t.Id)]);
    await aws(["events", "delete-rule", "--name", RULE]);
    log(`deleted rule ${RULE}`);
  }
  if (await permissionStatement()) {
    await aws(["lambda", "remove-permission", "--function-name", FN, "--statement-id", STATEMENT]);
    log("removed invoke permission");
  }
  process.exit(0);
}

console.log(`schedule stats: ${SCHEDULE} -> ${FN}`);

// 1. The rule. put-rule creates or updates in place.
const { RuleArn } = await aws(["events", "put-rule", "--name", RULE,
  "--schedule-expression", SCHEDULE, "--state", "ENABLED",
  "--description", "Fold new CloudFront access logs into the scale-to-zero.com stats (admin Refresh, automated)"]);
log(`rule ${RuleArn}`);

// 2. Permission for this rule, and only this rule, to invoke the function.
const existing = await permissionStatement();
const scopedToRule = existing?.Condition?.ArnLike?.["AWS:SourceArn"] === RuleArn;
if (existing && !scopedToRule) {
  await aws(["lambda", "remove-permission", "--function-name", FN, "--statement-id", STATEMENT]);
}
if (!existing || !scopedToRule) {
  await aws(["lambda", "add-permission", "--function-name", FN, "--statement-id", STATEMENT,
    "--action", "lambda:InvokeFunction", "--principal", "events.amazonaws.com", "--source-arn", RuleArn]);
  log("invoke permission granted, scoped to the rule");
} else {
  log("invoke permission already in place");
}

// 3. The target, with the job payload server.mjs recognises.
const put = await aws(["events", "put-targets", "--rule", RULE,
  "--targets", JSON.stringify([{ Id: "stz-admin", Arn: fnArn, Input: INPUT,
    RetryPolicy: { MaximumRetryAttempts: 2, MaximumEventAgeInSeconds: 3600 } }])]);
if (put.FailedEntryCount) throw new Error(`put-targets failed: ${JSON.stringify(put.FailedEntries)}`);
log(`target ${fnArn} with ${INPUT}`);

console.log("\ndone. Check on it with: node infra/schedule-stats.mjs --status");
