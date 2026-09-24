// Just enough of every other ecosystem to answer four questions without a
// full language pack: what does it depend on, is any of it pre-1.0, does it
// hold data behind one vendor's engine, and does it keep a server running?
//
// JavaScript is not here: packs/node.js reads it properly. A full pack for any
// of these languages (see docs/SCORECARD.md) can go deeper; these are the
// floor, so that a repo in any language is measured on every rule and
// absence -- no dependencies, no server -- scores as the win it is.
//
// Parsers read declared, direct, runtime dependencies. They are line-based on
// purpose: a manifest a regex cannot read is rare, and a wrong count is
// visible in the evidence, where a silent parser failure would not be.

const PY_REQ = /^([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?\s*(?:(===|==|~=|>=|<=|!=|>|<)\s*([0-9][^\s,;]*))?/;

function parsePython(text, path) {
  const out = [];
  const push = (spec) => {
    const m = PY_REQ.exec(spec.trim());
    if (m && m[1].toLowerCase() !== "python") out.push({ name: m[1].toLowerCase(), version: m[4] ?? null });
  };
  if (/requirements[\w.-]*\.txt$/.test(path)) {
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/#.*/, "").trim();
      if (line && !line.startsWith("-")) push(line);
    }
    return out;
  }
  // pyproject.toml: PEP 621 `dependencies = [...]` and Poetry's table.
  for (const block of text.matchAll(/^\s*dependencies\s*=\s*\[([\s\S]*?)\]/gm)) {
    for (const s of block[1].matchAll(/["']([^"']+)["']/g)) push(s[1]);
  }
  for (const section of text.matchAll(/^\[(tool\.poetry\.dependencies|packages)\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/gm)) {
    for (const m of section[2].matchAll(/^\s*([A-Za-z0-9][\w.-]*)\s*=\s*(?:["']([^"']*)["']|\{[^}]*version\s*=\s*["']([^"']*)["'])?/gm)) {
      if (m[1].toLowerCase() === "python") continue;
      out.push({ name: m[1].toLowerCase(), version: (m[2] ?? m[3] ?? "").replace(/^[\^~>=<*\s]+/, "") || null });
    }
  }
  // setup.cfg install_requires
  const ir = /install_requires\s*=\s*\n((?:[ \t]+.+\n?)+)/.exec(text);
  if (ir) for (const line of ir[1].split(/\n/)) if (line.trim()) push(line);
  return out;
}

function parseGoMod(text) {
  const out = [];
  const add = (name, version, rest) => { if (!/\/\/\s*indirect/.test(rest ?? "")) out.push({ name, version }); };
  for (const block of text.matchAll(/^require\s*\(([\s\S]*?)^\)/gm)) {
    for (const m of block[1].matchAll(/^\s*([\w.\-/]+)\s+(v[\w.\-+]+)(.*)$/gm)) add(m[1], m[2], m[3]);
  }
  for (const m of text.matchAll(/^require\s+([\w.\-/]+)\s+(v[\w.\-+]+)(.*)$/gm)) add(m[1], m[2], m[3]);
  return out;
}

function parseGemfile(text) {
  return [...text.matchAll(/^\s*gem\s+["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])?/gm)]
    .map((m) => ({ name: m[1], version: m[2]?.replace(/^[~>=<\s]+/, "") ?? null }));
}

function parseJvm(text, path) {
  if (path.endsWith("pom.xml")) {
    return [...text.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)]
      .filter((m) => !/<scope>\s*test\s*<\/scope>/.test(m[1]))
      .map((m) => ({
        name: /<artifactId>([^<]+)<\/artifactId>/.exec(m[1])?.[1] ?? "?",
        version: (/<version>([^<$]+)<\/version>/.exec(m[1])?.[1]) ?? null,
      }));
  }
  return [...text.matchAll(/\b(?:implementation|api|compile|runtimeOnly)\s*\(?\s*["']([^:"']+):([^:"']+):([^"']+)["']/g)]
    .map((m) => ({ name: m[2], version: m[3] }));
}

function parseComposer(text) {
  const j = JSON.parse(text);
  return Object.entries(j.require ?? {})
    .filter(([name]) => name !== "php" && !/^(ext|lib)-/.test(name))
    .map(([name, v]) => ({ name, version: String(v).replace(/^[\^~>=<*\s|v]+/, "") || null }));
}

function parseCargo(text) {
  const section = /^\[dependencies\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(text);
  if (!section) return [];
  return [...section[1].matchAll(/^\s*([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]*)"|\{[^}]*?version\s*=\s*"([^"]*)"[^}]*\}|\{[^}]*\})/gm)]
    .map((m) => ({ name: m[1], version: (m[2] ?? m[3] ?? "").replace(/^[\^~=\s]+/, "") || null }));
}

function parseCsproj(text) {
  return [...text.matchAll(/<PackageReference\s+Include="([^"]+)"(?:\s+Version="([^"]+)")?/g)]
    .map((m) => ({ name: m[1], version: m[2] ?? null }));
}

export const ECOSYSTEMS = [
  { id: "python", label: "Python", manifest: /(^|\/)(requirements[\w.-]*\.txt|pyproject\.toml|Pipfile|setup\.cfg)$/, source: /\.py$/, parse: parsePython },
  { id: "go", label: "Go", manifest: /(^|\/)go\.mod$/, source: /\.go$/, parse: parseGoMod },
  { id: "ruby", label: "Ruby", manifest: /(^|\/)Gemfile$/, source: /\.rb$/, parse: parseGemfile },
  { id: "jvm", label: "Java/Kotlin", manifest: /(^|\/)(pom\.xml|build\.gradle(\.kts)?)$/, source: /\.(java|kt)$/, parse: parseJvm },
  { id: "php", label: "PHP", manifest: /(^|\/)composer\.json$/, source: /\.php$/, parse: parseComposer },
  { id: "rust", label: "Rust", manifest: /(^|\/)Cargo\.toml$/, source: /\.rs$/, parse: parseCargo },
  { id: "dotnet", label: ".NET", manifest: /\.csproj$/, source: /\.cs$/, parse: parseCsproj },
];

/** Manifests that only list development and test tooling. */
export const DEV_MANIFEST = /requirements[-_.]?(dev|test|tests|docs|lint|ci)[\w.-]*\.txt$/i;

/** A version that has not reached 1.0: "0.4.2", "v0.9.0". */
export const isPre1 = (version) => /^v?0\.\d/.test(String(version ?? "").trim());

// Long-running listeners, by ecosystem. Each is the idiom that starts a
// server and waits: the shape that bills while idle.
export const LISTENERS = [
  [/\bapp\.run\(|\buvicorn\.run\(|\.serve_forever\(|\bweb\.run_app\(|\bwaitress\.serve\(|\bHTTPServer\(/, "python"],
  [/\bhttp\.ListenAndServe(TLS)?\(|\.Run\(\s*":\d+"|\.Listen\(\s*":\d+"/, "go"],
  [/\bRack::Server\b|\bWEBrick::HTTPServer\b|\bset\s+:port\b|\brun!/, "ruby"],
  [/\bSpringApplication\.run\(|\bHttpServer\.create\(|\bembeddedServer\(/, "jvm"],
  [/\bHttpServer::new\b|\baxum::serve\b|\bwarp::serve\b|\bTcpListener::bind\(/, "rust"],
  [/\bapp\.Run\(\s*\)|\bWebHost\.CreateDefaultBuilder\b/, "dotnet"],
];

// Per-invocation entry points: functions a platform starts on demand.
export const HANDLERS = [
  [/def\s+(lambda_)?handler\s*\(\s*event\s*,\s*context|\bfunctions_framework\b|\bMangum\(/, "python"],
  [/\blambda\.Start\(|\bfuncframework\.RegisterHTTPFunction/, "go"],
  [/implements\s+RequestHandler\b|@FunctionName\(/, "jvm"],
  [/\blambda_runtime::run\b|#\[lambda_http::/, "rust"],
  [/\[Function(Name)?\(/, "dotnet"],
  [/def\s+(self\.)?handler\s*\(\s*event:/, "ruby"],
];

// Proprietary data services by client package, across ecosystems.
export const LOCK_IN = {
  "firebase-admin": "Firebase", "google-cloud-firestore": "Firestore", "google-cloud-datastore": "Datastore",
  "google-cloud-bigquery": "BigQuery", "google-cloud-spanner": "Spanner", "snowflake-connector-python": "Snowflake",
  "databricks-sql-connector": "Databricks SQL", "azure-cosmos": "Cosmos DB", pynamodb: "DynamoDB", faunadb: "Fauna",
  "cloud.google.com/go/firestore": "Firestore", "firebase.google.com/go": "Firebase", "firebase.google.com/go/v4": "Firebase",
  "cloud.google.com/go/bigquery": "BigQuery", "github.com/snowflakedb/gosnowflake": "Snowflake",
  "github.com/aws/aws-sdk-go-v2/service/dynamodb": "DynamoDB", "github.com/Azure/azure-sdk-for-go/sdk/data/azcosmos": "Cosmos DB",
  "aws-sdk-dynamodb": "DynamoDB", "snowflake-jdbc": "Snowflake", "dynamodb": "DynamoDB",
  "Google.Cloud.Firestore": "Firestore", "AWSSDK.DynamoDBv2": "DynamoDB", "Microsoft.Azure.Cosmos": "Cosmos DB", "Snowflake.Data": "Snowflake",
  firestore: "Firestore",
};
