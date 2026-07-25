// Brand-identifier tests.
//
// These names are matched as LITERAL STRINGS by code that makes security
// decisions, and a miss does not raise an error — the check just stops
// matching. That is the failure mode this file exists to catch:
//
//   • the fleet anti-recursion guard stops blocking re-delegation;
//   • the notify tool stops being classified as a meta tool, so it starts
//     triggering mode switches;
//   • built-in MCP servers stop receiving the session id.
//
// Each of those is silent in production. So: assert every matcher resolves
// against the LIVE registry, not against a copy of the names.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const brand = require("../agent-backend/brand");
const policyEngine = require("../agent-backend/policy-engine");

const SERVER_SRC = fs.readFileSync(
  path.join(__dirname, "..", "agent-backend", "server.js"), "utf-8",
);

function testRegistryMatchesConstants() {
  console.log("built-in MCP servers are registered under the brand constants...");
  // server.js must key its registry off brand.MCP, not off string literals.
  // A literal would be invisible to every other matcher in this file.
  for (const key of Object.keys(brand.MCP)) {
    if (["registry", "backend"].includes(key)) continue; // registered elsewhere
    assert.ok(
      SERVER_SRC.includes(`[MCP.${key}]`),
      `server.js should register the ${key} server as [MCP.${key}], not a literal name`,
    );
  }
  // And no stray literal spelling of a built-in name should remain in server.js.
  for (const name of brand.builtinMcpNames()) {
    assert.ok(
      !SERVER_SRC.includes(`"${name}"`),
      `server.js contains the literal "${name}" — use the MCP constant so renames stay in one place`,
    );
  }
}

function testFleetDispatchMatcher() {
  console.log("fleet dispatch is recognised in every spelling pi may use...");
  const tool = brand.FLEET_DISPATCH_TOOL;
  const spellings = [
    tool,                                        // bare
    brand.mcpToolName(brand.MCP.fleet, tool),    // mcp_<server>_<tool>
    brand.flatToolName(brand.MCP.fleet, tool),   // <server_underscored>_<tool>
  ];
  for (const name of spellings) {
    assert.ok(brand.isFleetDispatch(name), `isFleetDispatch should match "${name}"`);
    assert.ok(
      brand.FLEET_DISPATCH_NAMES.includes(name),
      `FLEET_DISPATCH_NAMES should contain "${name}" — fleet.js builds its no-redelegate list from it`,
    );
  }
  // Every spelling must embed the CURRENT server name, or the guard is matching
  // a name nothing is registered under any more.
  for (const name of brand.FLEET_DISPATCH_NAMES.slice(1)) {
    const normalised = name.replace(/_/g, "-");
    assert.ok(
      normalised.includes(brand.MCP.fleet.replace(/_/g, "-")),
      `"${name}" does not contain the registered fleet server name "${brand.MCP.fleet}"`,
    );
  }
  // Negative: a similarly-named tool must NOT be swallowed by the guard.
  assert.ok(!brand.isFleetDispatch("dispatch_to_device_group"), "must not match a longer tool name");
  assert.ok(!brand.isFleetDispatch(""), "must not match empty");
  assert.ok(!brand.isFleetDispatch(null), "must not match null");
}

function testNotifyIsAMetaTool() {
  console.log("notify is classified as a meta tool in every spelling...");
  // A notify spelling that falls out of META_TOOLS silently starts counting as
  // a real capability, which can force a mode switch mid-turn.
  for (const name of brand.NOTIFY_NAMES) {
    const capability = policyEngine.toolToCapability(name, false);
    assert.strictEqual(
      capability, "read_workspace",
      `"${name}" should classify as read_workspace (meta), got "${capability}"`,
    );
  }
  assert.ok(
    brand.NOTIFY_NAMES.some((n) => n.includes(brand.MCP.notify.replace(/-/g, "_"))),
    "NOTIFY_NAMES should be derived from the registered notify server name",
  );

  // Documented gap, asserted so it stays deliberate: pi's own prefixed spelling
  // is classified as `network`, not as a meta tool. Adding it to META_TOOLS
  // would loosen policy — a product decision, not a rename. If that decision is
  // ever made, this assertion is the thing to flip.
  assert.strictEqual(
    policyEngine.toolToCapability(brand.NOTIFY_MCP_TOOL, false), "network",
    "pi's prefixed notify spelling is expected to classify as network (see brand.NOTIFY_NAMES)",
  );
}

function testNoStaleBrandInMatchers() {
  console.log("security matchers carry no hardcoded product name...");
  // The three files that match MCP names must import them, never spell them.
  for (const rel of ["fleet.js", "policy-engine.js", "server.js"]) {
    const src = fs.readFileSync(path.join(__dirname, "..", "agent-backend", rel), "utf-8");
    assert.ok(
      /require\((["'])(\.\/)?brand\1\)/.test(src),
      `${rel} matches tool names and must import them from brand.js`,
    );
  }
}

function testProviderExtensionMatches() {
  console.log("pi provider extension registers the same id the harness passes...");
  // Cross-language pair: the harness passes `--provider <PROVIDER_ID>` while an
  // ESM extension calls pi.registerProvider("..."). The extension cannot import
  // the CJS constant, so nothing but this test keeps the two halves together —
  // and a mismatch surfaces as "unknown provider" at spawn, not at boot.
  const ext = fs.readFileSync(
    path.join(__dirname, "..", "agent-backend", "harnesses", "picode", "tether-provider.mjs"), "utf-8",
  );
  const m = /pi\.registerProvider\(\s*["']([^"']+)["']/.exec(ext);
  assert.ok(m, "could not find pi.registerProvider(...) in the provider extension");
  assert.strictEqual(
    m[1], brand.PROVIDER_ID,
    `provider extension registers "${m && m[1]}" but the harness passes "${brand.PROVIDER_ID}"`,
  );

  const harness = fs.readFileSync(
    path.join(__dirname, "..", "agent-backend", "harnesses", "picode", "index.js"), "utf-8",
  );
  assert.ok(
    !/"--provider",\s*"/.test(harness),
    "picode/index.js should pass PROVIDER_ID, not a literal provider name",
  );
}

function testSlugAndProviderAreConsistent() {
  console.log("slug / provider id / MCP names agree...");
  // PROVIDER_ID leaks into STORED data (pi resolves models as `<id>/<model>`),
  // so a mismatch here means config rows that no longer resolve.
  assert.strictEqual(brand.PROVIDER_ID, brand.SLUG, "provider id should be the slug");
  assert.strictEqual(brand.SLUG, brand.BRAND.toLowerCase(), "slug should be the lowercased brand");
  for (const name of brand.builtinMcpNames()) {
    assert.ok(
      name.startsWith(`${brand.SLUG}-`),
      `built-in MCP server "${name}" should be namespaced under the slug "${brand.SLUG}-"`,
    );
  }
}

function testApiKeyPrefix() {
  console.log("minted API keys carry the current brand prefix...");
  // The prefix is cosmetic — lookup is by key_hash — so a stale one raises no
  // error anywhere. It just ships the previous product's name to every user's
  // clipboard, which is how it survived the last rebrand.
  const dbSrc = fs.readFileSync(path.join(__dirname, "..", "agent-backend", "db.js"), "utf-8");
  assert.ok(
    /require\((["'])\.\/brand\1\)/.test(dbSrc),
    "db.js should take API_KEY_PREFIX from brand.js, not spell it",
  );
  assert.ok(
    !/["']\w+_live_["']/.test(dbSrc),
    "db.js contains a literal <x>_live_ prefix — use brand.API_KEY_PREFIX",
  );
  assert.ok(
    brand.API_KEY_PREFIX.endsWith("_live_"),
    `API_KEY_PREFIX "${brand.API_KEY_PREFIX}" should keep the <abbrev>_live_ shape`,
  );
  // Abbreviation must plausibly come from the current brand, or it is a leftover.
  const abbrev = brand.API_KEY_PREFIX.slice(0, -"_live_".length);
  assert.ok(
    brand.SLUG.startsWith(abbrev[0]) && [...abbrev].every((c) => brand.SLUG.includes(c)),
    `API_KEY_PREFIX abbreviation "${abbrev}" does not derive from the slug "${brand.SLUG}"`,
  );
}

function run() {
  testRegistryMatchesConstants();
  testFleetDispatchMatcher();
  testNotifyIsAMetaTool();
  testNoStaleBrandInMatchers();
  testProviderExtensionMatches();
  testSlugAndProviderAreConsistent();
  testApiKeyPrefix();
  console.log("\n✓ brand identifier tests passed");
}

run();
