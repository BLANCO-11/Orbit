# Authentication & tenants

## Credentials

Every request presents a credential, resolved to an identity
(`{ role, tenantId, … }`) in priority order:

1. **Superadmin env key** (`ORBIT_SUPERADMIN_KEY`) → `superadmin`.
2. **Paired device token** → role from the device scope (Fleet).
3. **Tenant API key** (`orb_live_…`) → the key's role + tenant.
4. **SSO browser session token** → the user's role + tenant.
5. **No superadmin key set** → dev-mode: every caller is `superadmin`.

Send the credential as either header:

```
x-api-key: <key>
# or
Authorization: Bearer <key>
```

WebSocket takes it as a query param: `ws://<host>:6800/api/ws?key=<key>`.

Check who you are:

```bash
curl -s http://localhost:6800/api/auth/whoami -H "x-api-key: $KEY"
# → { role, tenantId, email, ssoEnabled, ssoConfigured, devMode }
```

## Roles

| Role | Can |
|---|---|
| `superadmin` | Everything, across all tenants. Env-key or seeded account; never minted as an API key. |
| `admin` | Manage its tenant: keys, members, observability. |
| `member` | Programmatic access within its tenant: secrets, connectors, runs (the default for minted keys). |
| `viewer` | Read-only. |

Writes to secrets and connectors require **member or above** (viewers are
read-only).

## Dev-mode vs enforced

- **Dev-mode** — no `ORBIT_SUPERADMIN_KEY`: the backend is loopback-only and
  treats every caller as superadmin. Zero-config for local prototyping. In this
  mode, tenant is `null` (the shared local bucket) — secrets/connectors you
  create live there.
- **Enforced** — set `ORBIT_SUPERADMIN_KEY`: the API and WebSocket now require a
  valid credential. Do this before exposing Orbit beyond loopback.

## Minting tenant API keys

For multi-tenant / production use, don't share the superadmin key — mint
tenant-scoped keys. This is an admin+ operation.

```bash
ADMIN=<superadmin-or-admin-key>
BASE=http://localhost:6800

# 1. Create a tenant (superadmin).
TENANT=$(curl -s -X POST "$BASE/api/admin/tenants" \
  -H "x-api-key: $ADMIN" -H 'Content-Type: application/json' \
  -d '{"name":"Acme Corp"}' | jq -r '.tenant.id')

# 2. Mint a member key for it. The plaintext secret is returned ONCE, as `key.key`.
curl -s -X POST "$BASE/api/admin/keys" \
  -H "x-api-key: $ADMIN" -H 'Content-Type: application/json' \
  -d "{\"tenantId\":\"$TENANT\",\"label\":\"acme-server\",\"role\":\"member\"}" \
  | jq -r '.key.key'
# → orb_live_xxxxxxxx…   (store it now; only the hash is kept)
```

The response is `{ success, key: { id, tenantId, label, role, scope, keyPrefix, key } }`.
**`key.key` is the raw secret and is shown exactly once** — capture it
immediately. Revoke with `DELETE /api/admin/keys/:id`.

## Isolation guarantee

Secrets, connectors, sessions, runs, templates, and the fleet (paired devices /
remote harnesses) are all scoped to the tenant of the key that created them. A
`member` of tenant A:

- sees only tenant A's secrets/connectors/runs/sessions/templates/devices,
- cannot read or cancel tenant B's runs, or read/rename/delete tenant B's
  sessions, or disconnect/revoke tenant B's devices (they 404),
- gets only tenant A's connectors composed into its session sandboxes.

**Per-user (sessions).** Within a tenant, sessions are owner-private: a signed-in
(SSO) member/viewer sees only its own sessions, while a tenant `admin` sees all
of the tenant's. API-key callers have no per-user identity, so they are scoped to
the whole tenant. Enforced over REST and WebSocket alike.

`superadmin` operates in the shared (`null`) bucket. (Cross-tenant management by
superadmin via a `?tenantId` selector is not exposed on the secrets/connectors
routes — those pin to the caller's own tenant.)

See [`../../API.md`](../../API.md#1-authentication-rbac--cors) for the full RBAC
and CORS reference.
