// agent-backend/crypto-store.js
// Encryption-at-rest for OAuth/service tokens. Unlike device tokens (which we
// only ever compare, so we hash them), service tokens must be replayed to the
// provider, so they're encrypted and decryptable.
//
// AES-256-GCM with a 32-byte key. The key comes from ORBIT_SECRET if set;
// otherwise a random key is generated once and persisted to a gitignored file
// (chmod 600), so a local install "just works" without configuration.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const KEY_FILE = path.join(__dirname, ".orbit-secret");

function loadKey() {
  if (process.env.ORBIT_SECRET) {
    return crypto.createHash("sha256").update(process.env.ORBIT_SECRET).digest(); // 32 bytes
  }
  try {
    const hex = fs.readFileSync(KEY_FILE, "utf-8").trim();
    if (hex.length === 64) return Buffer.from(hex, "hex");
  } catch {}
  const key = crypto.randomBytes(32);
  try {
    fs.writeFileSync(KEY_FILE, key.toString("hex"), { mode: 0o600 });
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
    console.error("[Crypto] decrypt failed:", e.message);
    return "";
  }
}

module.exports = { encrypt, decrypt };
