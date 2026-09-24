#!/usr/bin/env node
// The morning routine: harvest, score, print the queue.
//
//   node pipeline/daily.mjs
//
// Runs the three steps in order and stops on the first hard failure. Nothing is
// published; this only produces the queue for a human to choose from.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function run(script, args = []) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(HERE, script), ...args], { stdio: "inherit" });
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`))
    );
  });
}

const started = Date.now();
try {
  await run("harvest.mjs");
  await run("score.mjs");
  await run("queue.mjs");
} catch (err) {
  console.error(`\nFAILED: ${err.message}`);
  process.exit(1);
}
console.log(`  done in ${Math.round((Date.now() - started) / 1000)}s\n`);
