// Module-resolution hook for test/api.test.mjs. The admin server imports the
// AWS SDK (through lib/store.mjs) and sharp, whose native binary is built for
// Linux. Swapping those two for in-memory stand-ins lets the real server.mjs,
// router, auth and renderer run under test on any machine, with no network.

const here = (f) => new URL(f, import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier === "sharp") return { url: here("./sharp.mjs"), shortCircuit: true };
  if (specifier === "./lib/store.mjs" && context.parentURL?.endsWith("/admin/server.mjs")) {
    return { url: here("./store.mjs"), shortCircuit: true };
  }
  return next(specifier, context);
}
