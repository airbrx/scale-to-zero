// A JSON Schema validator for exactly the subset admin/openapi.json uses.
//
// Shared by the admin Lambda (request bodies) and pipeline/build.mjs (articles
// on disk), so an article is held to one definition wherever it is written. It
// is about eighty lines instead of a dependency: "if twenty lines you
// understand will do, write them" -- and these are not many more.
//
// Supported: type (one or a list), enum, pattern, minLength, minimum,
// required, properties, additionalProperties (boolean or schema),
// minProperties, items, and local $ref ("#/components/schemas/Name").
// Anything else in a schema is a mistake in the spec, and throws.

const KNOWN = new Set(["type", "enum", "pattern", "minLength", "minimum", "required", "properties",
  "additionalProperties", "minProperties", "items", "$ref", "description", "format", "example", "title", "readOnly"]);

const join = (at, k) => (at ? `${at}.${k}` : k);
const label = (at) => at || "the body";
const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array"
  : Number.isInteger(v) ? "integer" : typeof v);

/**
 * @param {object} doc   the whole OpenAPI document, for resolving $ref
 * @returns {(schemaName: string, value: unknown) => string[]}  error messages, empty when valid
 */
export function validator(doc) {
  const resolve = (ref) => {
    const m = /^#\/components\/schemas\/(.+)$/.exec(ref);
    const s = m && doc.components?.schemas?.[m[1]];
    if (!s) throw new Error(`unresolvable $ref ${ref}`);
    return s;
  };

  function check(schema, v, at, errors) {
    if (schema.$ref) return check(resolve(schema.$ref), v, at, errors);
    for (const k of Object.keys(schema)) if (!KNOWN.has(k)) throw new Error(`schema keyword "${k}" at ${at} is not supported by shared/schema.mjs`);

    if (schema.type) {
      const types = [].concat(schema.type);
      const t = typeOf(v);
      if (!types.includes(t) && !(t === "integer" && types.includes("number"))) {
        errors.push(`${label(at)} must be ${types.join(" or ")}, got ${t}`);
        return;
      }
    }
    if (schema.enum && !schema.enum.includes(v)) errors.push(`${label(at)} must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}`);
    if (typeof v === "string") {
      if (schema.minLength !== undefined && v.length < schema.minLength) errors.push(`${label(at)} must not be empty`);
      if (schema.pattern && !new RegExp(schema.pattern).test(v)) errors.push(`${label(at)} must match ${schema.pattern}`);
    }
    if (typeof v === "number" && schema.minimum !== undefined && v < schema.minimum) errors.push(`${label(at)} must be at least ${schema.minimum}`);
    if (Array.isArray(v) && schema.items) v.forEach((x, i) => check(schema.items, x, `${at}[${i}]`, errors));

    if (typeOf(v) === "object") {
      const props = schema.properties ?? {};
      for (const r of schema.required ?? []) if (!(r in v)) errors.push(`${join(at, r)} is required`);
      if (schema.minProperties !== undefined && Object.keys(v).length < schema.minProperties) {
        errors.push(`${label(at)} must have at least ${schema.minProperties} field${schema.minProperties === 1 ? "" : "s"}`);
      }
      for (const [k, x] of Object.entries(v)) {
        if (props[k]) check(props[k], x, join(at, k), errors);
        else if (schema.additionalProperties === false) errors.push(`${join(at, k)} is not a known field`);
        else if (typeof schema.additionalProperties === "object") check(schema.additionalProperties, x, join(at, k), errors);
      }
    }
  }

  return (name, value) => {
    const schema = doc.components?.schemas?.[name];
    if (!schema) throw new Error(`no schema named ${name} in the spec`);
    const errors = [];
    check(schema, value, "", errors);
    return errors;
  };
}
