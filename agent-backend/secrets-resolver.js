// agent-backend/secrets-resolver.js
// Turns the encrypted, tenant-scoped secrets store into runtime values for a
// spawn — WITHOUT ever putting a value in the prompt, transcript, or logs.
// Two consumers:
//   1. the harness, which injects a tenant's secrets as env vars into the
//      sandbox so generated scripts read them from os.environ (never the prompt);
//   2. config that carries ${secret:NAME} references (e.g. connector env — a
//      later phase), resolved to values only in-memory at spawn.
//
// The store (db.js) holds only ciphertext; decryption happens here via
// crypto-store — the same at-rest key that protects connection tokens.

const db = require("./db");
const { decrypt } = require("./crypto-store");

// ${secret:NAME} — NAME is a POSIX-ish env identifier.
const PLACEHOLDER_RE = /\$\{secret:([A-Za-z_][A-Za-z0-9_]*)\}/g;

// Decrypted { NAME: value } for a tenant (null → the dev/superadmin bucket).
// NEVER log the return value. Blank/undecryptable entries are dropped.
async function getTenantSecrets(tenantId) {
  const rows = await db.getSecretsForTenant(tenantId);
  const out = {};
  for (const r of rows) {
    const v = decrypt(r.valueEnc);
    if (v) out[r.name] = v;
  }
  return out;
}

// Replace ${secret:NAME} in a string with its value. Unknown names are LEFT
// as-is (a typo stays visible instead of silently blanking a credential).
function resolvePlaceholders(str, secrets) {
  if (typeof str !== "string" || !str) return str;
  return str.replace(PLACEHOLDER_RE, (m, name) =>
    Object.prototype.hasOwnProperty.call(secrets, name) ? secrets[name] : m);
}

// Deep-resolve ${secret:NAME} across a plain string/array/object (e.g. a
// connector's env map). Returns a NEW structure; the input is untouched.
function resolveDeep(value, secrets) {
  if (typeof value === "string") return resolvePlaceholders(value, secrets);
  if (Array.isArray(value)) return value.map((v) => resolveDeep(v, secrets));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveDeep(v, secrets);
    return out;
  }
  return value;
}

// Inject each secret as an env var (NAME=value) into `env` (mutated + returned).
// `reserved` (a RegExp) protects names the harness owns — a secret must never be
// able to hijack the provider/gateway/system env. Skipped names are returned so
// the caller can warn (by NAME only — never the value).
function injectIntoEnv(env, secrets, reserved = null) {
  const injected = [];
  const skipped = [];
  for (const [name, value] of Object.entries(secrets)) {
    if (reserved && reserved.test(name)) { skipped.push(name); continue; }
    env[name] = value;
    injected.push(name);
  }
  return { injected, skipped };
}

module.exports = {
  getTenantSecrets,
  resolvePlaceholders,
  resolveDeep,
  injectIntoEnv,
  PLACEHOLDER_RE,
};
