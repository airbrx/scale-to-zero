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
    // Local docker-compose defaults are not secrets anyone can use.
    skipMatch: (m) => /^(localhost|127\.|0\.0\.0\.0|db|database|postgres|mysql|mariadb|mongo|redis|rabbitmq|host\.docker\.internal)$/i.test(m[2]) },
];

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
