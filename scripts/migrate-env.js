#!/usr/bin/env node
// scripts/migrate-env.js
//
// Rewrite a .env file's variable NAMES to the current canonical set.
//
// This is a CONFIG migration, not a data migration: it renames keys in a text
// file and touches nothing else. It exists because the app deliberately fails
// at boot on a legacy name rather than falling back silently — see the security
// note in agent-backend/env-config.js.
//
//   node scripts/migrate-env.js .env --dry-run     # show the diff
//   node scripts/migrate-env.js .env               # rewrite in place (.bak kept)
//
// Comments, blank lines, ordering and values are preserved. Only the key on the
// left of the first `=` is rewritten, plus legacy names mentioned inside
// comments (so the file's own documentation doesn't go stale).

const fs = require("fs");
const path = require("path");
const { LEGACY } = require("../agent-backend/env-config");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const target = args.find((a) => !a.startsWith("-")) || ".env";
const file = path.resolve(process.cwd(), target);

if (!fs.existsSync(file)) {
  console.error(`[migrate-env] no such file: ${file}`);
  process.exit(1);
}

const original = fs.readFileSync(file, "utf-8");
const lines = original.split("\n");

// Names already present in the file, so we can warn instead of creating a
// duplicate key when both the old and new name are set.
const present = new Set();
for (const line of lines) {
  const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
  if (m) present.add(m[1]);
}

// Legacy names longest-first, so e.g. TETHER_SECRET_FILE is matched before the
// TETHER_SECRET rule can rewrite half of it.
const BY_LENGTH = Object.entries(LEGACY).sort((a, b) => b[0].length - a[0].length);

const ASSIGNMENT = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=.*)$/;
// A comment that is really a disabled assignment (`# FOO=bar`). These must be
// treated as assignments, NOT as prose: rewriting them as prose can silently
// turn a disabled legacy key into a disabled duplicate of a live one.
const COMMENTED_ASSIGNMENT = /^(\s*#+\s*)((?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=.*)$/;

const renamed = [];
const conflicts = [];
const inComments = [];

function rewriteProse(text) {
  let out = text;
  for (const [old, replacement] of BY_LENGTH) {
    const re = new RegExp(`\\b${old}\\b`, "g");
    if (re.test(out)) {
      out = out.replace(re, replacement);
      inComments.push([old, replacement]);
    }
  }
  return out;
}

const out = [];
for (const line of lines) {
  // A marker this script wrote on a previous run. Leave it exactly as-is, or a
  // rerun rewrites the legacy name out of its own explanation.
  if (/^\s*#\s*\[migrated\]/.test(line)) { out.push(line); continue; }

  const commented = COMMENTED_ASSIGNMENT.exec(line);
  if (commented) {
    // Disabled assignment. Rename the key in place and keep it disabled — but
    // ONLY if the replacement isn't already live in this file. Otherwise
    // renaming would produce a commented-out duplicate of a live key, which is
    // one uncomment away from an ambiguous config (and made this script
    // non-idempotent: every rerun re-renamed the line it had just disabled).
    const [, hash, body] = commented;
    const inner = ASSIGNMENT.exec(body);
    if (inner) {
      const replacement = LEGACY[inner[2]];
      if (replacement && !present.has(replacement)) {
        renamed.push([inner[2], replacement]);
        out.push(`${hash}${inner[1]}${replacement}${inner[3]}`);
        continue;
      }
      if (replacement) { out.push(line); continue; } // already superseded; leave inert
    }
    // Not a recognisable legacy assignment — treat the whole line as prose.
    out.push(rewriteProse(line));
    continue;
  }

  const m = ASSIGNMENT.exec(line);
  if (!m) {
    // Prose comment or blank line.
    out.push(rewriteProse(line));
    continue;
  }

  const [, prefix, key, rest] = m;
  const replacement = LEGACY[key];
  if (!replacement) { out.push(line); continue; }

  if (present.has(replacement)) {
    // Both names are live. Renaming would produce a duplicate key whose winner
    // depends on the parser, so disable the legacy line instead and say so.
    conflicts.push([key, replacement]);
    out.push(`# [migrated] ${key} is obsolete — ${replacement} is already set in this file.`);
    out.push(`# ${prefix}${key}${rest}`);
    continue;
  }
  renamed.push([key, replacement]);
  out.push(`${prefix}${replacement}${rest}`);
}

const text = out.join("\n");

if (!renamed.length && !conflicts.length && !inComments.length) {
  console.log(`[migrate-env] ${target} uses no legacy variable names — nothing to do.`);
  process.exit(0);
}

const width = Math.max(...[...renamed, ...conflicts, ...inComments].map(([o]) => o.length));
if (renamed.length) {
  console.log(`\n  Renamed (${renamed.length}):`);
  for (const [o, n] of renamed) console.log(`    ${o.padEnd(width)}  →  ${n}`);
}
if (inComments.length) {
  console.log(`\n  Also updated in surrounding comments (${inComments.length}):`);
  for (const [o, n] of inComments) console.log(`    ${o.padEnd(width)}  →  ${n}`);
}
if (conflicts.length) {
  console.log(`\n  ⚠ Both names were set — the legacy line was COMMENTED OUT, not renamed:`);
  for (const [o, n] of conflicts) console.log(`    ${o.padEnd(width)}     ${n} already present`);
  console.log(`    Check that the surviving value is the one you want.`);
}

if (dryRun) {
  console.log(`\n[migrate-env] --dry-run: ${target} was not modified.`);
  process.exit(0);
}

fs.writeFileSync(`${file}.bak`, original, "utf-8");
fs.writeFileSync(file, text, "utf-8");
console.log(`\n[migrate-env] rewrote ${target} (previous version saved as ${target}.bak).`);
