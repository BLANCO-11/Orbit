// agent-backend/crypto-store.js
// Encryption-at-rest for OAuth/service tokens. Unlike device tokens (which we
// only ever compare, so we hash them), service tokens must be replayed to the
// provider, so they're encrypted and decryptable.
//
// AES-256-GCM with a 32-byte key. The key comes from APP_SECRET if set;
// otherwise a random key is generated once and persisted to a gitignored file
// (chmod 600), so a local install "just works" without configuration.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const env = require("./env-config");

// Where the auto-generated key is persisted. IMPORTANT: it must live on a DURABLE
// path, otherwise a container recreate mints a fresh random key and every secret
// already encrypted in the (persistent) DB becomes undecryptable → the
// "[Crypto] decrypt failed: Unsupported state or unable to authenticate data"
// bug on session init. Prefer an explicit APP_SECRET_FILE, else a file under
// APP_HOME (the mounted /data volume in Docker), else the module dir (bare-metal
// back-compat). Best practice is still to set a stable APP_SECRET env.
function keyFilePath() {
  if (env.isSet("APP_SECRET_FILE")) return env.get("APP_SECRET_FILE");
  if (env.isSet("APP_HOME")) return path.join(env.get("APP_HOME"), ".tether-secret");
  return path.join(__dirname, ".tether-secret");
}

const KEY_FILE = keyFilePath();

function loadKey() {
  if (env.isSet("APP_SECRET")) {
    return crypto.createHash("sha256").update(env.get("APP_SECRET")).digest(); // 32 bytes
  }
  // Auto-migrate legacy .orbit-secret to .tether-secret
  try {
    const legacyPath = env.isSet("APP_HOME")
      ? path.join(env.get("APP_HOME"), ".orbit-secret")
      : path.join(__dirname, ".orbit-secret");
    if (fs.existsSync(legacyPath) && !fs.existsSync(KEY_FILE)) {
      fs.renameSync(legacyPath, KEY_FILE);
      console.log(`[Crypto] Migrated legacy key file ${legacyPath} -> ${KEY_FILE}`);
    }
  } catch (e) {}

  try {
    const hex = fs.readFileSync(KEY_FILE, "utf-8").trim();
    if (hex.length === 64) return Buffer.from(hex, "hex");
  } catch {}
  const key = crypto.randomBytes(32);
  try {
    fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
    fs.writeFileSync(KEY_FILE, key.toString("hex"), { mode: 0o600 });
    console.log(`[Crypto] generated a new encryption key at ${KEY_FILE} (set APP_SECRET to make it deterministic).`);
  } catch (e) {
    console.error("[Crypto] could not persist key file:", e.message);
  }
  return key;
}

const KEY = loadKey();

/** Encrypt a UTF-8 string → base64("iv:tag:ciphertext"). Returns "" for empty input. */
function encrypt(plaintext) {
  if (!plaintext) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

/** Decrypt a value produced by encrypt(). Returns "" on empty/failure. */
function decrypt(payload) {
  if (!payload) return "";
  try {
    const buf = Buffer.from(payload, "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch (e) {
    // GCM auth-tag failure ("Unsupported state or unable to authenticate data")
    // almost always means the key differs from the one used to encrypt this value
    // — typically the encryption key was regenerated (no stable APP_SECRET and a
    // non-persistent key file). The value must be re-saved to recover it.
    console.error(
      `[Crypto] decrypt failed: ${e.message} — likely the encryption key changed since this value was stored (set a stable APP_SECRET; key file: ${KEY_FILE}).`,
    );
    return "";
  }
}

module.exports = { encrypt, decrypt };
