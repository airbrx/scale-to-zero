// Account-specific identifiers that the scripts discover (the ACM certificate
// ARN, the admin Lambda's direct function URL) are written to config.local.json,
// which is untracked. The repository is public; the account ID inside an ARN
// and a URL that reaches the function without going through CloudFront do not
// need to be.
//
// Nothing reads these back today -- they are a record of what provisioning
// created. If a script comes to need one, read it from here and fail loudly
// when it is missing.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export async function saveLocal(root, deployFields) {
  const file = path.join(root, "config.local.json");
  const current = existsSync(file) ? JSON.parse(await readFile(file, "utf8")) : {};
  current.deploy = { ...(current.deploy ?? {}), ...deployFields };
  await writeFile(file, JSON.stringify(current, null, 2) + "\n");
  return file;
}
