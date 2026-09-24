// The language packs, in the order their checks are listed.
//
// Adding a language is one file: export { id, label, detect(repo),
// gather(repo), checks[] } and add it here. Each check names the manifesto
// principle it answers to (see ../principles.js) and returns one of the
// verdicts in ../result.js. docs/SCORECARD.md walks through an example.

import { common } from "./common.js";
import { web } from "./web.js";
import { node } from "./node.js";

export const PACKS = [common, web, node];
