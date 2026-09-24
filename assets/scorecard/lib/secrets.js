// Shapes of well-known credentials. Used twice: by the secret-scan check, and
// by redact(), which every check that quotes a line of source must pass that
// line through. A scorecard that found your key and then printed it in full
// on a shareable page would be the leak.

export const SECRETS = [
  { name: "AWS access key ID", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, severity: "fail", ignore: /^AKIAIOSFODNN7EXAMPLE$/ },
  { name: "private key", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/g, severity: "fail" },
  { name: "GitHub token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,})\b/g, severity: "fail" },
  { name: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, severity: "fail" },
  { name: "Stripe live key", re: /\b[sr]k_live_[0-9a-zA-Z]{20,}\b/g, severity: "fail" },
  { name: "Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, severity: "fail" },
  { name: "OpenAI API key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}T3BlbkFJ[A-Za-z0-9_-]{16,}\b/g, severity: "fail" },
  // Browser-side Google keys (Maps, Firebase) are public by design, so this is
  // a prompt to check its restrictions, not proof of a leak.
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g, severity: "warn" },
  { name: "password in a connection string",
    re: /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqps?):\/\/[^\s:@/'"`]+:([^\s@/'"`$<{]{3,})@([^\s/:'"`]+)/g,
    severity: "warn",
    // A password only matters if it opens something someone can reach.
    harmless: (m) => unreachable(m[2]) },
];

// Hosts no attacker can log into, and why. The host decides whether a
// connection-string password matters, not how the password looks: a readable
// password on a reachable host (an RDS endpoint, a public IP) is a weak
// credential and stays flagged. Private addresses (10.x, 192.168.x) stay
// flagged too -- not reachable from the internet, but real infrastructure.
const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|0\.0\.0\.0|host\.docker\.internal)$/i;
// RFC 2606 / 6761: names reserved so they never resolve publicly.
const RESERVED = /(^|\.)(localhost|local|test|invalid|example)$|(^|\.)example\.(com|org|net)$/i;

// ---------------------------------------------------------------- .env files
// A committed .env is judged by what it holds, not by its name. Many are
// Compose profiles or local-dev settings: ports, feature flags, a database URL
// pointing at a service name. The ones that matter hold a secret value.
const SECRET_NAME = /(secret|password|passwd|pwd|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|credential|auth[_-]?key|signing[_-]?key)/i;
const PLACEHOLDER_VALUE = /^(|changeme|change[_-]?me|x{3,}|\*+|<.*>|\$\{.*\}|\{\{.*\}\}|your[_-].*|example|placeholder|todo|tbd|null|none|false|true|0|1)$/i;
const URL_CREDENTIAL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/'"`]+:([^\s@/'"`]+)@([^\s/:'"`]+)/i;

/**
 * The secret values a .env file holds, by variable name. Never returns values.
 * @returns {{name:string, line:number, why:string}[]}
 */
export function envSecrets(text) {
  const found = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/.exec(raw);
    if (!m) return;
    const [, name, rawValue] = m;
    const value = rawValue.replace(/\s+#.*$/, "").trim().replace(/^(["'])(.*)\1$/, "$2");
    const url = URL_CREDENTIAL.exec(value);
    if (url) {
      if (!unreachable(url[2])) found.push({ name, line: i + 1, why: `credentials for ${url[2]}` });
      return;
    }
    if (SECRETS.some((s) => new RegExp(s.re.source).test(value))) {
      found.push({ name, line: i + 1, why: "a known key format" });
      return;
    }
    if (SECRET_NAME.test(name) && !PLACEHOLDER_VALUE.test(value)) found.push({ name, line: i + 1, why: "a secret-named variable with a value" });
  });
  return found;
}

/** Why a connection string's host makes its password harmless, or null. */
export function unreachable(host) {
  if (LOOPBACK.test(host)) return `points at ${host}, this machine only`;
  if (RESERVED.test(host)) return `points at ${host}, a reserved name that never resolves publicly`;
  // No dot and not an IP: a container, compose, or cluster service name
  // (postgres, redis, agor-db) or a template ("host"). It only resolves inside
  // its own network.
  if (!host.includes(".") && !/^\d+$/.test(host)) return `points at "${host}", a name that only resolves inside its own network, or a template`;
  return null;
}

export const mask = (s) => (s.length <= 8 ? "****" : `${s.slice(0, 4)}…${s.slice(-2)}`);

/** Every credential-shaped substring replaced by its masked form. */
export function redact(text) {
  let out = text;
  for (const s of SECRETS) {
    // With no capture group, the replacer's second argument is the offset, a
    // number -- hence the typeof rather than a truthiness test.
    out = out.replace(s.re, (whole, group1) => (typeof group1 === "string"
      ? whole.replace(group1, mask(group1))
      : mask(whole)));
  }
  return out;
}
