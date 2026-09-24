// Checks that apply to every repository, whatever it is written in:
// infrastructure it declares, secrets it leaks, whether anyone tests it,
// whether anyone could pick it up from the README.

import { prioritize, lineAt, TESTY, MINIFIED, VENDORED } from "../repo.js";
import { pass, warn, fail, na, tiered, plural } from "../result.js";
import { SECRETS, mask } from "../secrets.js";
import { ECOSYSTEMS, DEV_MANIFEST, LISTENERS, HANDLERS, LOCK_IN, isPre1 } from "../ecosystems.js";

// ------------------------------------------------------------- always-on map
// Resources that bill by the hour whether or not anyone uses them. The list is
// deliberately the obvious ones: each is a line item someone has been
// surprised by. Aurora Serverless and Cloud Run min-instances can go either
// way; they are left out rather than guessed at.
const TF_ALWAYS_ON = {
  aws_instance: "EC2 instance", aws_db_instance: "RDS instance", aws_rds_cluster: "RDS cluster",
  aws_elasticache_cluster: "ElastiCache cluster", aws_elasticache_replication_group: "ElastiCache replication group",
  aws_nat_gateway: "NAT gateway", aws_lb: "load balancer", aws_alb: "load balancer", aws_elb: "classic load balancer",
  aws_eks_cluster: "EKS control plane", aws_eks_node_group: "EKS node group", aws_ecs_service: "ECS service",
  aws_opensearch_domain: "OpenSearch domain", aws_elasticsearch_domain: "Elasticsearch domain",
  aws_msk_cluster: "MSK (Kafka) cluster", aws_redshift_cluster: "Redshift cluster", aws_mq_broker: "Amazon MQ broker",
  aws_autoscaling_group: "auto scaling group", aws_docdb_cluster: "DocumentDB cluster", aws_neptune_cluster: "Neptune cluster",
  aws_emr_cluster: "EMR cluster", aws_sagemaker_endpoint: "SageMaker endpoint",
  google_compute_instance: "Compute Engine VM", google_sql_database_instance: "Cloud SQL instance",
  google_container_cluster: "GKE cluster", google_redis_instance: "Memorystore Redis",
  azurerm_linux_virtual_machine: "Azure VM", azurerm_windows_virtual_machine: "Azure VM", azurerm_virtual_machine: "Azure VM",
  azurerm_kubernetes_cluster: "AKS cluster", azurerm_postgresql_flexible_server: "Azure Postgres server",
  azurerm_redis_cache: "Azure Cache for Redis", azurerm_application_gateway: "Azure application gateway",
  azurerm_service_plan: "App Service plan", azurerm_app_service_plan: "App Service plan",
  digitalocean_droplet: "DigitalOcean droplet", digitalocean_database_cluster: "DigitalOcean database",
  digitalocean_kubernetes_cluster: "DigitalOcean Kubernetes",
};
const TF_ZERO = /^(aws_lambda_function|aws_s3_bucket|aws_cloudfront_distribution|aws_dynamodb_table|aws_apigatewayv2_api|aws_api_gateway_rest_api|aws_sqs_queue|google_cloudfunctions2?_function|google_cloud_run_(v2_)?service|google_storage_bucket|azurerm_(linux_|windows_)?function_app|azurerm_storage_account|azurerm_static_(site|web_app)|cloudflare_workers?_script|cloudflare_pages_project)$/;

const CFN_ALWAYS_ON = {
  "AWS::EC2::Instance": "EC2 instance", "AWS::RDS::DBInstance": "RDS instance", "AWS::RDS::DBCluster": "RDS cluster",
  "AWS::ElastiCache::CacheCluster": "ElastiCache cluster", "AWS::ElastiCache::ReplicationGroup": "ElastiCache replication group",
  "AWS::EC2::NatGateway": "NAT gateway", "AWS::ElasticLoadBalancingV2::LoadBalancer": "load balancer",
  "AWS::ElasticLoadBalancing::LoadBalancer": "classic load balancer", "AWS::EKS::Cluster": "EKS control plane",
  "AWS::ECS::Service": "ECS service", "AWS::OpenSearchService::Domain": "OpenSearch domain",
  "AWS::Elasticsearch::Domain": "Elasticsearch domain", "AWS::MSK::Cluster": "MSK (Kafka) cluster",
  "AWS::Redshift::Cluster": "Redshift cluster", "AWS::AutoScaling::AutoScalingGroup": "auto scaling group",
  "AWS::AmazonMQ::Broker": "Amazon MQ broker", "AWS::DocDB::DBCluster": "DocumentDB cluster",
};
const CFN_ZERO = /^AWS::(Lambda::Function|Serverless::(Function|Api|HttpApi)|S3::Bucket|CloudFront::Distribution|DynamoDB::Table|ApiGatewayV2::Api|SQS::Queue)$/;

// CDK, by construct name. `new ec2.Vpc(` is here on purpose: its default is one
// NAT gateway per availability zone, which is the most common surprise line on
// an AWS bill that nobody remembers asking for.
const CDK_ALWAYS_ON = [
  [/new\s+ec2\.Instance\s*\(/g, "EC2 instance"],
  [/new\s+rds\.(DatabaseInstance|DatabaseCluster)\s*\(/g, "RDS database"],
  [/new\s+elasticache\.Cfn\w+\s*\(/g, "ElastiCache"],
  [/new\s+elbv2\.(Application|Network)LoadBalancer\s*\(/g, "load balancer"],
  [/new\s+eks\.Cluster\s*\(/g, "EKS cluster"],
  [/new\s+ecs\.(Fargate|Ec2)Service\s*\(|new\s+ecs_patterns\.\w+\s*\(/g, "ECS service"],
  [/new\s+opensearch\.Domain\s*\(/g, "OpenSearch domain"],
  [/new\s+ec2\.Vpc\s*\((?![^)]*natGateways\s*:\s*0)/g, "VPC with default NAT gateways"],
];
const CDK_ZERO = /new\s+(lambda\.(Function|DockerImageFunction)|NodejsFunction|s3\.Bucket|cloudfront\.Distribution|dynamodb\.(Table|TableV2))\s*\(/g;

const STATEFUL_IMAGE = /postgres|mysql|mariadb|mongo|redis|valkey|keydb|memcached|elasticsearch|opensearch|rabbitmq|kafka|zookeeper|clickhouse|cassandra|scylla|neo4j|minio|nats|couchdb|influxdb|timescale|mssql|oracle/i;

// ------------------------------------------------------------ the Beast
// Anything that answers a query by running: a database, a cache, a search
// engine, a warehouse. Finding none is a pass -- a repo with nothing to wake
// has already done what rule 1 asks. Queues are not here (they are not
// queried for answers), and neither are key-value stores like DynamoDB or
// embedded engines like DuckDB and SQLite: a predictable key and a file read
// in-process are exactly what the rule recommends.
const BEAST_IMAGE = /postgres|mysql|mariadb|mongo|redis|valkey|keydb|memcached|elasticsearch|opensearch|clickhouse|cassandra|scylla|neo4j|couchdb|influxdb|timescale|mssql|oracle/i;
const BEAST_ALWAYS_ON = /RDS|ElastiCache|OpenSearch|Elasticsearch|Redshift|DocumentDB|Neptune|Cloud SQL|Memorystore|Postgres|Redis|database/i;
const TF_WAREHOUSE = /^(snowflake_warehouse|databricks_(sql_endpoint|sql_warehouse|cluster)|google_bigquery_(dataset|table)|aws_redshiftserverless_workgroup|aws_athena_workgroup)$/;

// Database clients by ecosystem, matched as whole package names in the
// manifest that ecosystem uses. package.json is not here: the Node pack reads
// it, and counting its drivers twice would double the penalty.
const MANIFESTS = [
  [/(^|\/)(requirements[\w.-]*\.txt|pyproject\.toml|Pipfile|setup\.cfg|setup\.py)$/, "Python",
    ["psycopg2", "psycopg2-binary", "psycopg", "asyncpg", "pymysql", "mysqlclient", "mysql-connector-python", "pymongo", "motor",
      "redis", "sqlalchemy", "django", "peewee", "tortoise-orm", "snowflake-connector-python", "google-cloud-bigquery",
      "databricks-sql-connector", "cassandra-driver", "elasticsearch", "opensearch-py", "clickhouse-driver", "oracledb", "cx_oracle", "pyodbc"]],
  [/(^|\/)go\.mod$/, "Go",
    ["github.com/lib/pq", "github.com/jackc/pgx", "github.com/go-sql-driver/mysql", "go.mongodb.org/mongo-driver", "github.com/redis/go-redis",
      "github.com/go-redis/redis", "gorm.io/gorm", "github.com/snowflakedb/gosnowflake", "cloud.google.com/go/bigquery", "github.com/elastic/go-elasticsearch"]],
  [/(^|\/)Gemfile$/, "Ruby", ["pg", "mysql2", "mongoid", "redis", "activerecord", "sequel", "rails"]],
  [/(^|\/)(pom\.xml|build\.gradle(\.kts)?)$/, "JVM",
    ["postgresql", "mysql-connector-java", "mysql-connector-j", "mongodb-driver-sync", "jedis", "lettuce-core", "spring-boot-starter-data-jpa",
      "hibernate-core", "snowflake-jdbc", "google-cloud-bigquery"]],
  [/(^|\/)composer\.json$/, "PHP", ["doctrine/dbal", "doctrine/orm", "illuminate/database", "laravel/framework", "predis/predis", "mongodb/mongodb"]],
  [/(^|\/)Cargo\.toml$/, "Rust", ["sqlx", "diesel", "tokio-postgres", "postgres", "mysql", "mongodb", "redis", "sea-orm"]],
  [/\.csproj$/, ".NET", ["Npgsql", "MySql.Data", "MySqlConnector", "MongoDB.Driver", "StackExchange.Redis", "Microsoft.EntityFrameworkCore",
    "Microsoft.Data.SqlClient", "System.Data.SqlClient"]],
];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
// A package name standing alone: not "pg" inside "pgadmin", not "redis" inside "redis-py-cluster-helper".
const nameRe = (name) => new RegExp(`(^|[\\s"'=:<>,\\[(/])${escapeRe(name)}(?=$|[\\s"'=<>~!;,\\])@\\[])`, "im");

// ------------------------------------------------------------- secret scan
const SCANNABLE = /\.(m?[jt]sx?|cjs|cts|mts|json|ya?ml|toml|ini|cfg|conf|properties|xml|html?|py|rb|go|php|sh|ps1|tf|tfvars|java|kt|cs|swift|rs|env)$|(^|\/)(Dockerfile|\.env[\w.-]*|\.npmrc|\.pypirc|Procfile)$/i;
const SCAN_PRIORITY = [/(^|\/)\.env/, /config|settings|secret|credential|deploy|infra|\.github\//i, /^[^/]+$/, /\.(json|ya?ml|toml|tf)$/];

// ------------------------------------------------------------------ gather
async function gather(repo) {
  const readmeFile = repo.rootFile(/^readme(\.(md|markdown|rst|txt|adoc))?$/i);

  const composeFiles = repo.find(/(^|\/)(docker-)?compose(\.[\w-]+)?\.ya?ml$/i);
  const dockerfiles = repo.find(/(^|\/)(Dockerfile(\.[\w-]+)?|[\w-]+\.dockerfile)$/i);
  const tfFiles = prioritize(repo.find(/\.tf$/), [/^(infra|terraform|deploy)\//], 80);
  const yamlInfra = prioritize(
    repo.find(/\.(ya?ml|json)$/i).filter((f) => /(template|cloudformation|cfn|sam|stack|k8s|kube|helm|chart|manifest|deploy)/i.test(f.path) && !/package(-lock)?\.json$|tsconfig|\.eslintrc/i.test(f.path)),
    [/template\.ya?ml$/i, /k8s|kube/i], 40);
  const cdkFiles = prioritize(
    repo.find(/\.[cm]?[jt]s$/).filter((f) => /(^|\/)(cdk|infra|stacks?|deploy)(\/|[.-])|stack\.[cm]?[jt]s$/i.test(f.path) && !TESTY.test(f.path)),
    [/stack/i], 30);
  const procfile = repo.rootFile(/^Procfile$/);
  const flyToml = repo.rootFile(/^fly\.toml$/);
  const serverlessYml = repo.find(/(^|\/)serverless\.ya?ml$/);

  const scanList = prioritize(
    repo.files.filter((f) => SCANNABLE.test(f.path) && !VENDORED.test(f.path) && !MINIFIED.test(f.path)
      && (f.size === null || f.size <= 200_000) && !/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(f.path)),
    SCAN_PRIORITY, 150);

  const manifestFiles = prioritize(
    repo.files.filter((f) => !VENDORED.test(f.path) && !TESTY.test(f.path) && MANIFESTS.some(([re]) => re.test(f.path))),
    [/^[^/]+$/], 30);
  const ours = (f) => !VENDORED.test(f.path) && !TESTY.test(f.path);
  const ecoManifests = prioritize(repo.files.filter((f) => ours(f) && ECOSYSTEMS.some((e) => e.manifest.test(f.path))), [/^[^/]+$/], 30);
  const otherSources = prioritize(
    repo.files.filter((f) => ours(f) && (f.size === null || f.size <= 300_000) && ECOSYSTEMS.some((e) => e.source.test(f.path))),
    [/(^|\/)(main|app|server|index|wsgi|asgi|manage|handler|lambda|program|application|api)\.\w+$/i, /^(src|app|cmd|api|server|functions?)\//], 80);

  const toRead = new Set([
    ...(readmeFile ? [readmeFile.path] : []),
    ...[...composeFiles, ...dockerfiles, ...tfFiles, ...yamlInfra, ...cdkFiles, ...serverlessYml].map((f) => f.path),
    ...(procfile ? [procfile.path] : []), ...(flyToml ? [flyToml.path] : []),
    ...manifestFiles.map((f) => f.path),
    ...ecoManifests.map((f) => f.path),
    ...otherSources.map((f) => f.path),
    ...scanList.map((f) => f.path),
  ]);
  const { ok, failed } = await repo.readMany([...toRead]);
  const text = new Map(ok.map((r) => [r.path, r.text]));

  // ---- always-on vs scale-to-zero declarations
  const alwaysOn = [];
  const zero = [];
  for (const f of tfFiles) {
    const t = text.get(f.path);
    if (!t) continue;
    for (const m of t.matchAll(/resource\s+"([\w-]+)"\s+"([\w-]+)"/g)) {
      const e = { path: f.path, line: lineAt(t, m.index), note: `${m[1]}.${m[2]}` };
      if (TF_ALWAYS_ON[m[1]]) alwaysOn.push({ ...e, what: TF_ALWAYS_ON[m[1]] });
      else if (TF_ZERO.test(m[1])) zero.push(e);
    }
  }
  const workloads = [];
  for (const f of yamlInfra) {
    const t = text.get(f.path);
    if (!t) continue;
    for (const m of t.matchAll(/["']?Type["']?\s*:\s*["']?(AWS::[\w:]+)/g)) {
      const e = { path: f.path, line: lineAt(t, m.index), note: m[1] };
      if (CFN_ALWAYS_ON[m[1]]) alwaysOn.push({ ...e, what: CFN_ALWAYS_ON[m[1]] });
      else if (CFN_ZERO.test(m[1])) zero.push(e);
    }
    for (const m of t.matchAll(/^kind:\s*(Deployment|StatefulSet|DaemonSet)\s*$/gm)) {
      workloads.push({ path: f.path, line: lineAt(t, m.index), note: `Kubernetes ${m[1]}` });
    }
  }
  for (const f of cdkFiles) {
    const t = text.get(f.path);
    if (!t) continue;
    for (const [re, what] of CDK_ALWAYS_ON) {
      for (const m of t.matchAll(re)) alwaysOn.push({ path: f.path, line: lineAt(t, m.index), note: m[0].replace(/\s*\($/, ""), what });
    }
    for (const m of t.matchAll(CDK_ZERO)) zero.push({ path: f.path, line: lineAt(t, m.index), note: m[1] });
  }
  if (procfile && /^web:/m.test(text.get(procfile.path) ?? "")) {
    alwaysOn.push({ path: procfile.path, note: "web: process", what: "always-on web dyno" });
  }
  if (flyToml) {
    const t = text.get(flyToml.path) ?? "";
    const min = Number(/min_machines_running\s*=\s*(\d+)/.exec(t)?.[1] ?? 0);
    if (min > 0) alwaysOn.push({ path: flyToml.path, note: `min_machines_running = ${min}`, what: "Fly machines kept running" });
    else zero.push({ path: flyToml.path, note: "Fly machines stop when idle" });
  }
  for (const f of serverlessYml) zero.push({ path: f.path, note: "Serverless Framework" });

  // ---- orchestrated services (compose)
  for (const f of composeFiles) {
    const t = text.get(f.path);
    if (!t) continue;
    for (const s of composeServices(t)) {
      workloads.push({ path: f.path, line: s.line, note: `${s.name}${s.image ? ` (${s.image})` : ""}`, stateful: STATEFUL_IMAGE.test(`${s.name} ${s.image ?? ""}`) });
    }
  }

  // ---- runtimes that make a long-running process scale to zero anyway
  const zeroRuntime = [];
  for (const f of dockerfiles) {
    const t = text.get(f.path) ?? "";
    if (/aws-lambda-adapter|AWS_LWA_|lambda-web-adapter/i.test(t)) zeroRuntime.push({ path: f.path, note: "AWS Lambda Web Adapter" });
    if (/public\.ecr\.aws\/lambda\//i.test(t)) zeroRuntime.push({ path: f.path, note: "Lambda container base image" });
  }

  // ---- other ecosystems: declared dependencies and server entry points
  const otherDeps = [];
  for (const f of ecoManifests) {
    const t = text.get(f.path);
    if (t === undefined) continue;
    const eco = ECOSYSTEMS.find((e) => e.manifest.test(f.path));
    let parsed;
    try {
      parsed = eco.parse(t, f.path);
    } catch (err) {
      failed.push({ path: f.path, error: `could not parse: ${err.message}` });
      continue;
    }
    for (const d of parsed) otherDeps.push({ ...d, eco: eco.label, path: f.path, dev: DEV_MANIFEST.test(f.path) });
  }
  const otherRuntime = [...new Map(otherDeps.filter((d) => !d.dev).map((d) => [`${d.eco}:${d.name}`, d])).values()];
  const otherListeners = [];
  const otherHandlers = [];
  for (const f of otherSources) {
    const t = text.get(f.path);
    if (!t) continue;
    for (const [re, eco] of LISTENERS) {
      const m = re.exec(t);
      if (m) otherListeners.push({ path: f.path, line: lineAt(t, m.index), note: `${m[0].trim()} (${eco})` });
    }
    for (const [re, eco] of HANDLERS) {
      const m = re.exec(t);
      if (m) otherHandlers.push({ path: f.path, line: lineAt(t, m.index), note: `${m[0].trim()} (${eco})` });
    }
  }

  // ---- the Beast: anything that runs to answer a query
  const beasts = [];
  for (const a of alwaysOn) {
    if (BEAST_ALWAYS_ON.test(a.what)) beasts.push({ path: a.path, line: a.line, note: `${a.what} (${a.note})`, name: a.what });
  }
  for (const f of tfFiles) {
    const t = text.get(f.path);
    if (!t) continue;
    for (const m of t.matchAll(/resource\s+"([\w-]+)"\s+"([\w-]+)"/g)) {
      if (TF_WAREHOUSE.test(m[1])) beasts.push({ path: f.path, line: lineAt(t, m.index), note: `${m[1]}.${m[2]}`, name: m[1].split("_")[0] === "google" ? "BigQuery" : m[1].split("_")[0] });
    }
  }
  for (const w of workloads) {
    const svc = w.note ?? "";
    if (w.path && /compose/i.test(w.path) && BEAST_IMAGE.test(svc)) beasts.push({ path: w.path, line: w.line, note: `compose service ${svc}`, name: BEAST_IMAGE.exec(svc)[0].toLowerCase() });
  }
  for (const f of manifestFiles) {
    const t = text.get(f.path);
    if (!t) continue;
    const [, eco, names] = MANIFESTS.find(([re]) => re.test(f.path));
    for (const n of names) {
      const m = nameRe(n).exec(t);
      if (m) beasts.push({ path: f.path, line: lineAt(t, m.index), note: `${n} (${eco})`, name: n });
    }
  }

  // ---- secrets
  const secrets = [];
  for (const f of scanList) {
    const t = text.get(f.path);
    if (!t) continue;
    for (const s of SECRETS) {
      for (const m of t.matchAll(s.re)) {
        if (s.ignore?.test(m[0]) || s.skipMatch?.(m)) continue;
        secrets.push({ path: f.path, line: lineAt(t, m.index), note: `${s.name}: ${mask(m[1] ?? m[0])}`, severity: TESTY.test(f.path) ? "warn" : s.severity });
      }
    }
  }

  const envFiles = repo.find(/(^|\/)\.env(\.[\w.-]+)?$/)
    .filter((f) => !/\.(example|sample|template|dist|defaults?|schema|tpl)$|\.example\.|\.sample\./i.test(f.path));
  const keyFiles = repo.find(/(^|\/)(id_rsa|id_dsa|id_ecdsa|id_ed25519)$|\.(pem|key|p12|pfx|jks|keystore)$/i);

  const dataFiles = repo.find(/\.(csv|tsv|jsonl|ndjson|parquet|avro|arrow|feather|orc|geojson|sqlite3?|db|xlsx?|xlsm|mdb|accdb|sav|dta|pbix|twbx?|numbers)$/i);

  return {
    readme: readmeFile ? { path: readmeFile.path, text: text.get(readmeFile.path) ?? null } : null,
    ci: repo.find(/^(\.github\/workflows\/[^/]+\.ya?ml|\.gitlab-ci\.ya?ml|\.circleci\/config\.ya?ml|azure-pipelines\.ya?ml|Jenkinsfile|\.travis\.ya?ml|bitbucket-pipelines\.ya?ml|\.drone\.ya?ml|\.woodpecker\.ya?ml|\.buildkite\/.+)$/i),
    tests: repo.find(/(^|\/)(test|tests|__tests__|spec|e2e)\/.+\.\w+$|\.(test|spec)\.\w+$|(^|\/)test_[^/]+\.py$|_test\.(go|py)$/),
    alwaysOn, zero, zeroRuntime, workloads, secrets, envFiles, keyFiles, dataFiles, beasts,
    manifests: manifestFiles.length,
    otherManifests: ecoManifests.length, otherSources: otherSources.length,
    otherRuntime, otherListeners, otherHandlers,
    schemaDocs: repo.find(/\.schema\.json$|(^|\/)(schemas?|types)\/|(^|\/)(openapi|swagger|asyncapi)\.(ya?ml|json)$|\.(proto|graphql|gql|avsc|d\.ts|xsd)$|(^|\/)schema\.(prisma|sql|rb)$|(^|\/)migrations?\//i),
    unread: failed,
  };
}

/** Top-level service names under `services:`, with their image when given.
 *  YAML is not parsed in general -- compose files are regular enough that the
 *  indentation of the first service tells us the level every service sits at. */
export function composeServices(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^services:\s*(#.*)?$/.test(l));
  if (start === -1) return [];
  const out = [];
  let indent = null;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\S/.test(l)) break;
    const m = /^(\s+)([\w.-]+):\s*(#.*)?$/.exec(l);
    if (m) {
      if (indent === null) indent = m[1].length;
      if (m[1].length === indent) { out.push({ name: m[2], line: i + 1, image: null }); continue; }
    }
    const img = /^\s+image:\s*["']?([^\s"'#]+)/.exec(l);
    if (img && out.length && out[out.length - 1].image === null) out[out.length - 1].image = img[1];
  }
  return out;
}

// ------------------------------------------------------------------ checks
const checks = [
  {
    id: "always-on", principle: "balance", weight: 2,
    title: "Nothing bills while nobody is using it",
    why: "Every always-on resource is a line item that arrives whether or not a single request did.",
    run({ common: c }) {
      const kinds = [...new Set(c.alwaysOn.map((a) => a.what))];
      const data = { count: c.alwaysOn.length, kinds, zero: c.zero.length };
      const zeroNote = c.zero.length ? ` ${plural(c.zero.length, "scale-to-zero resource")} declared.` : "";
      if (!c.alwaysOn.length) {
        return pass(`No always-on infrastructure declared in the repo.${zeroNote}`, c.zero.slice(0, 8), data);
      }
      return tiered(c.alwaysOn.length, 0, 2,
        `${plural(c.alwaysOn.length, "always-on resource")} declared: ${kinds.join(", ")}.${zeroNote}`,
        c.alwaysOn.map(({ path, line, note, what }) => ({ path, line, note: `${what} — ${note}` })), data);
    },
  },
  {
    id: "no-beast", principle: "beast",
    title: "Nothing standing by to be queried",
    why: "The Beast bills you precisely when it runs. The cheapest one is the one that was never built.",
    run({ common: c }) {
      const names = [...new Set(c.beasts.map((b) => b.name))];
      const data = { backends: names, manifests: c.manifests };
      if (!names.length) {
        return pass("No database, cache, search engine, or warehouse in the repo's infrastructure, compose files, or dependency manifests.", [], data);
      }
      return tiered(names.length, 0, 1, `Stands on ${plural(names.length, "backend")} that answer queries by running: ${names.join(", ")}.`, c.beasts, data);
    },
  },
  // The floor for every language. Each of these steps aside (n/a) when the
  // only code is JavaScript, because packs/node.js measures that properly;
  // otherwise it measures Python, Go, Ruby, JVM, PHP, Rust, and .NET from
  // their manifests and sources. Finding nothing is a pass, not a blank:
  // no dependencies and no server are the wins these rules ask for.
  {
    id: "other-deps", principle: "dependency",
    title: "Few third-party libraries",
    why: "A library you import is someone else's code, exploits, and outages running inside your walls.",
    run({ common: c, node: n }) {
      const ecos = [...new Set(c.otherRuntime.map((d) => d.eco))];
      const data = { count: c.otherRuntime.length, names: c.otherRuntime.map((d) => d.name), ecosystems: ecos };
      if (!c.otherManifests) {
        return n ? na("No manifests outside JavaScript; the JavaScript checks count its dependencies.", data)
          : pass("No dependency manifest at all: nothing third-party is declared.", [], data);
      }
      if (!c.otherRuntime.length) return pass("Its manifests declare no runtime dependencies.", [], data);
      return tiered(c.otherRuntime.length, 5, 15,
        `${plural(c.otherRuntime.length, "runtime dependency", "runtime dependencies")} declared (${ecos.join(", ")}).`,
        c.otherRuntime.map((d) => ({ path: d.path, note: `${d.name}${d.version ? ` ${d.version}` : ""}` })), data);
    },
  },
  {
    id: "other-servers", principle: "stateless", weight: 2,
    title: "Nothing kept running",
    why: "No idle compute burning money while it waits for traffic that never came.",
    run({ common: c, node: n }) {
      const data = { listeners: c.otherListeners.length, handlers: c.otherHandlers.length, shape: null };
      if (!c.otherSources) {
        return n ? na("No code outside JavaScript; the JavaScript checks cover its entry points.", data)
          : pass("No server code at all: nothing to keep running.", [], { ...data, shape: "none" });
      }
      if (!c.otherListeners.length) {
        return c.otherHandlers.length
          ? pass(`Entry points are functions a platform starts per request (${plural(c.otherHandlers.length, "handler")}).`, c.otherHandlers.slice(0, 8), { ...data, shape: "functions" })
          : pass("No long-running server found.", [], { ...data, shape: "none" });
      }
      if (c.zeroRuntime.length) return pass("A server, but on a runtime that stops it when idle.", [...c.zeroRuntime, ...c.otherListeners].slice(0, 8), { ...data, shape: "server-on-zero" });
      if (c.otherHandlers.length) return warn("Has both a long-running server and per-request handlers. Check which one production runs.", [...c.otherListeners, ...c.otherHandlers].slice(0, 10), { ...data, shape: "mixed" });
      return fail(`A long-running server (${plural(c.otherListeners.length, "listener")}) and nothing in the repo that stops it when idle.`, c.otherListeners.slice(0, 10), { ...data, shape: "server" });
    },
  },
  {
    id: "other-pre-1", principle: "shiny",
    title: "Built on settled libraries",
    why: "Proven, portable, and replaceable are features. A 0.x version is a library telling you it has not settled.",
    run({ common: c, node: n }) {
      const hits = c.otherRuntime.filter((d) => isPre1(d.version));
      const data = { names: hits.map((d) => d.name), total: c.otherRuntime.length };
      if (!c.otherManifests && n) return na("No manifests outside JavaScript; the JavaScript checks cover this.", data);
      if (!c.otherRuntime.length) return pass("No third-party dependencies, so nothing unsettled to build on.", [], data);
      if (!hits.length) return pass("No pre-1.0 runtime dependencies.", [], data);
      return tiered(hits.length, 0, 2, `${plural(hits.length, "runtime dependency", "runtime dependencies")} still below 1.0.`,
        hits.map((d) => ({ path: d.path, note: `${d.name} ${d.version}` })), data);
    },
  },
  {
    id: "other-lock-in", principle: "gravity",
    title: "Data reachable without one vendor's engine",
    why: "Do not hand the keys to your own data to the engine sitting on top of it.",
    run({ common: c, node: n }) {
      const hits = c.otherRuntime.filter((d) => LOCK_IN[d.name]);
      const vendors = [...new Set(hits.map((d) => LOCK_IN[d.name]))];
      const data = { vendors };
      if (!c.otherManifests && n) return na("No manifests outside JavaScript; the JavaScript checks cover this.", data);
      if (!hits.length) return pass("No proprietary data-service SDKs: nothing holds its data behind someone else's engine.", [], data);
      return tiered(vendors.length, 0, 1, `Data held behind ${vendors.join(", ")}.`, hits.map((d) => ({ path: d.path, note: `${d.name} (${LOCK_IN[d.name]})` })), data);
    },
  },
  {
    id: "secrets", principle: "foundation", weight: 2,
    title: "No credentials in the source",
    why: "A key in a public repo is a key in every scraper's collection within minutes of the push.",
    run({ common: c }) {
      const hard = c.secrets.filter((s) => s.severity === "fail");
      const soft = c.secrets.filter((s) => s.severity === "warn");
      const kindsOf = (list) => [...new Set(list.map((s) => s.note.split(":")[0]))];
      const data = { hard: hard.length, soft: soft.length, kinds: kindsOf(hard.length ? hard : soft) };
      if (hard.length) return fail(`${plural(hard.length, "credential")} committed in plain text. Rotate them; deleting the line does not remove it from history.`, c.secrets, data);
      if (soft.length) return warn(`${plural(soft.length, "possible credential")} (browser-side keys, test fixtures, or connection strings). Confirm each is meant to be public.`, soft, data);
      return pass("No credential patterns found in the files scanned.", [], data);
    },
  },
  {
    id: "secret-files", principle: "foundation", weight: 2,
    title: "No .env or key files committed",
    why: "A committed .env is the most common way a production password ends up public.",
    run({ common: c }) {
      const realKeys = c.keyFiles.filter((f) => !TESTY.test(f.path));
      const testKeys = c.keyFiles.filter((f) => TESTY.test(f.path));
      const bad = [...c.envFiles, ...realKeys];
      const data = { env: c.envFiles.length, keys: realKeys.length, testKeys: testKeys.length, files: bad.map((f) => f.path) };
      if (bad.length) return fail(`${plural(bad.length, "secret-bearing file")} in the repository.`, bad.map((f) => ({ path: f.path })), data);
      if (testKeys.length) return warn(`${plural(testKeys.length, "key file")} under test fixtures. Probably throwaway, worth confirming.`, testKeys.map((f) => ({ path: f.path })), data);
      return pass("No .env files or private key files committed.", [], data);
    },
  },
  {
    id: "moving-parts", principle: "foundation",
    title: "Few moving parts",
    why: "Resilience through fewer moving parts: every part is a part that can break.",
    run({ common: c }) {
      const stateful = c.workloads.filter((w) => w.stateful).length;
      const data = { services: c.workloads.length, stateful };
      if (!c.workloads.length) return pass("No orchestrated services declared (no compose services or Kubernetes workloads).", [], data);
      return tiered(c.workloads.length, 1, 3,
        `${plural(c.workloads.length, "orchestrated service")}${stateful ? `, ${stateful} of them stateful (database, cache, or queue)` : ""}.`,
        c.workloads, data);
    },
  },
  {
    id: "open-data", principle: "gravity",
    title: "Data in formats anyone can read",
    why: "Data belongs in one place, in formats anyone can read, not behind a tool that rents you the only door.",
    run({ common: c }) {
      if (!c.dataFiles.length) return na("No data files in the repository.");
      const closed = c.dataFiles.filter((f) => /\.(xlsx?|xlsm|mdb|accdb|sav|dta|pbix|twbx?|numbers)$/i.test(f.path));
      const data = { files: c.dataFiles.length, closed: closed.length };
      if (!closed.length) return pass(`${plural(c.dataFiles.length, "data file")}, all in open formats.`, c.dataFiles.slice(0, 6).map((f) => ({ path: f.path })), data);
      return warn(`${plural(closed.length, "data file")} in a proprietary format that needs a specific application to read.`, closed.map((f) => ({ path: f.path })), data);
    },
  },
  {
    id: "ci", principle: "modernization",
    title: "Checks run on every change",
    why: "Modernization is a habit, not a project. Automation is what keeps the habit when nobody is watching.",
    run({ common: c }) {
      const data = { files: c.ci.length };
      return c.ci.length
        ? pass(`Continuous integration configured (${plural(c.ci.length, "file")}).`, c.ci.slice(0, 5).map((f) => ({ path: f.path })), data)
        : warn("No CI configuration found. Nothing runs the tests on a push.", [], data);
    },
  },
  {
    id: "tests", principle: "modernization",
    title: "Has tests",
    why: "You cannot replace what doesn't work if you cannot tell what does.",
    run({ common: c }) {
      const data = { files: c.tests.length };
      return c.tests.length
        ? pass(`${plural(c.tests.length, "test file")} in the repository.`, c.tests.slice(0, 5).map((f) => ({ path: f.path })), data)
        : fail("No test files found.", [], data);
    },
  },
  {
    id: "activity", principle: "modernization",
    title: "Still being tended",
    why: "Incremental and continuous. A repo nobody has touched in two years is modernized by nobody.",
    run(_, repo) {
      const { pushedAt, archived } = repo.meta;
      if (archived) return warn("The repository is archived. It is read-only and will not be updated.", [], { archived: true, months: null });
      if (!pushedAt) return na("Activity dates are not available from this source.");
      const months = (Date.now() - Date.parse(pushedAt)) / (30.44 * 864e5);
      const data = { archived: false, months: Math.round(months) };
      const when = months < 1 ? "within the last month" : `${plural(Math.round(months), "month")} ago`;
      const make = months <= 12 ? pass : months <= 24 ? warn : fail;
      return make(`Last change ${when}.`, [], data);
    },
  },
  {
    id: "readme", principle: "schemas",
    title: "A README someone new could start from",
    why: "Documented things get reused instead of rebuilt.",
    run({ common: c }) {
      if (!c.readme) return fail("No README at the root.", [], { words: 0, exists: false });
      if (c.readme.text === null) return warn("README exists but could not be read.", [{ path: c.readme.path }], { words: null, exists: true });
      const words = c.readme.text.replace(/```[\s\S]*?```/g, " ").split(/\s+/).filter((w) => /[a-z]/i.test(w)).length;
      const data = { words, exists: true };
      return words >= 150
        ? pass(`README runs ${words} words.`, [{ path: c.readme.path }], data)
        : warn(`README is ${words} words. Enough for a name, not for a newcomer.`, [{ path: c.readme.path }], data);
    },
  },
  {
    id: "schemas", principle: "schemas",
    title: "Data shapes are written down",
    why: "A documented schema can move. An undocumented blob is an anchor.",
    run({ common: c }) {
      const data = { files: c.schemaDocs.length };
      return c.schemaDocs.length
        ? pass(`${plural(c.schemaDocs.length, "schema or type definition")} found.`, c.schemaDocs.slice(0, 6).map((f) => ({ path: f.path })), data)
        : warn("No schema files, type definitions, API specs, or migrations found.", [], data);
    },
  },
];

export const common = { id: "common", label: "Any language", always: true, detect: () => true, gather, checks };
