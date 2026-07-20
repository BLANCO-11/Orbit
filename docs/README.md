# Orbit Documentation

Orbit is a local-first agent-operations console: it orchestrates coding/agent
harnesses (pi, OpenCode, remote devices), enforces a policy matrix, gives you
real observability, and exposes a **headless backend** so external apps can run
agent tasks and read back typed results.

This folder is the human-readable guide. For the exhaustive endpoint + WebSocket
protocol spec, see [`../API.md`](../API.md).

## Start here

| If you want to… | Read |
|---|---|
| Install and run Orbit for the first time | [Getting started](./getting-started.md) |
| Understand the moving parts (sessions, runs, tenants, sandbox, policy) | [Concepts](./concepts.md) |
| Use the app day-to-day (console, modes, connectors, policies, fleet) | [User guide](./user-guide.md) |
| Configure Orbit (env vars, settings, database, sandbox) | [Configuration](./configuration.md) |
| Drive Orbit from your own application | [Integration guide](./integration/README.md) |
| Fix something that's not working | [Troubleshooting](./troubleshooting.md) |

## Integration (headless backend) docs

For building a "parent app" that submits tasks to Orbit with only an API key:

- [Overview & the parent-app flow](./integration/README.md)
- [Authentication & tenants](./integration/authentication.md)
- [Run API & the result contract](./integration/run-api.md)
- [Secrets & connectors](./integration/secrets-and-connectors.md)
- [End-to-end examples (curl / Python / Node)](./integration/examples.md)

## Two ways to use Orbit

1. **The console (UI).** A Next.js dashboard for driving agents interactively —
   chat, plan, edit, and yolo modes; a live Mission board and Trace; connectors,
   policies, fleet, and admin. See the [User guide](./user-guide.md).
2. **The headless API.** Your application talks to the backend over REST +
   WebSocket. Submit a structured task, poll a typed result contract, fetch the
   generated artifacts. See the [Integration guide](./integration/README.md).

Both talk to the same backend and share the same sessions, policy, and
observability.
