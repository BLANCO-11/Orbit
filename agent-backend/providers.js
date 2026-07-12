// agent-backend/providers.js
// Curated third-party service providers a user can "Connect" from the console.
//
// kind: 'oauth'  — login-and-approve flow (needs the user's own OAuth app
//                  client id/secret in env, one-time, OR a DCR-capable server).
//       'token'  — paste a token/secret the provider issues (e.g. Telegram bot
//                  token from BotFather). No redirect.
//
// mcp: when set, connecting the service injects its token into this MCP server
//      (env var) and registers it as a connector, so the agent can *act* on the
//      service. Providers without a known MCP server still store the token
//      (usable via a bring-your-own MCP or a future tool) — connecting is not
//      wasted, it just doesn't auto-wire a tool yet.

const PROVIDERS = [
  {
    id: "github", name: "GitHub", kind: "oauth", pkce: true,
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scopes: ["repo", "read:org", "user"],
    clientIdEnv: "GITHUB_CLIENT_ID", clientSecretEnv: "GITHUB_CLIENT_SECRET",
    setupUrl: "https://github.com/settings/developers",
    mcp: { name: "github", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], tokenEnv: "GITHUB_PERSONAL_ACCESS_TOKEN" },
  },
  {
    id: "gitlab", name: "GitLab", kind: "oauth", pkce: true,
    authorizeUrl: "https://gitlab.com/oauth/authorize",
    tokenUrl: "https://gitlab.com/oauth/token",
    scopes: ["api", "read_user"],
    clientIdEnv: "GITLAB_CLIENT_ID", clientSecretEnv: "GITLAB_CLIENT_SECRET",
    setupUrl: "https://gitlab.com/-/profile/applications",
    mcp: { name: "gitlab", command: "npx", args: ["-y", "@modelcontextprotocol/server-gitlab"], tokenEnv: "GITLAB_PERSONAL_ACCESS_TOKEN" },
  },
  {
    id: "microsoft", name: "Microsoft (Teams · DevOps · 365)", kind: "oauth", pkce: true,
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: ["offline_access", "User.Read", "Chat.ReadWrite", "Team.ReadBasic.All"],
    clientIdEnv: "MS_CLIENT_ID", clientSecretEnv: "MS_CLIENT_SECRET",
    setupUrl: "https://portal.azure.com → App registrations",
  },
  {
    id: "google", name: "Google (Drive · Gmail · Calendar)", kind: "oauth", pkce: true,
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["openid", "email", "https://www.googleapis.com/auth/drive.readonly"],
    clientIdEnv: "GOOGLE_CLIENT_ID", clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    setupUrl: "https://console.cloud.google.com/apis/credentials",
    extraAuthParams: { access_type: "offline", prompt: "consent" },
  },
  {
    id: "slack", name: "Slack", kind: "oauth",
    authorizeUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    scopes: ["chat:write", "channels:read", "channels:history"],
    clientIdEnv: "SLACK_CLIENT_ID", clientSecretEnv: "SLACK_CLIENT_SECRET",
    setupUrl: "https://api.slack.com/apps",
    mcp: { name: "slack", command: "npx", args: ["-y", "@modelcontextprotocol/server-slack"], tokenEnv: "SLACK_BOT_TOKEN" },
  },
  {
    id: "notion", name: "Notion", kind: "oauth",
    authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    scopes: [],
    clientIdEnv: "NOTION_CLIENT_ID", clientSecretEnv: "NOTION_CLIENT_SECRET",
    setupUrl: "https://www.notion.so/my-integrations",
    tokenAuth: "basic",
  },
  {
    id: "linear", name: "Linear", kind: "oauth",
    authorizeUrl: "https://linear.app/oauth/authorize",
    tokenUrl: "https://api.linear.app/oauth/token",
    scopes: ["read", "write"],
    clientIdEnv: "LINEAR_CLIENT_ID", clientSecretEnv: "LINEAR_CLIENT_SECRET",
    setupUrl: "https://linear.app/settings/api/applications",
  },
  {
    id: "discord", name: "Discord", kind: "oauth",
    authorizeUrl: "https://discord.com/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
    scopes: ["identify", "guilds"],
    clientIdEnv: "DISCORD_CLIENT_ID", clientSecretEnv: "DISCORD_CLIENT_SECRET",
    setupUrl: "https://discord.com/developers/applications",
  },
  {
    id: "huggingface", name: "Hugging Face", kind: "oauth", pkce: true,
    authorizeUrl: "https://huggingface.co/oauth/authorize",
    tokenUrl: "https://huggingface.co/oauth/token",
    scopes: ["openid", "read-repos", "inference-api"],
    clientIdEnv: "HF_CLIENT_ID", clientSecretEnv: "HF_CLIENT_SECRET",
    setupUrl: "https://huggingface.co/settings/applications",
  },
  {
    id: "telegram", name: "Telegram (bot)", kind: "token",
    tokenLabel: "Bot token", setupUrl: "https://t.me/BotFather",
    help: "Create a bot with @BotFather and paste its token.",
  },
];

const byId = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]));

function getProvider(id) { return byId[id] || null; }

/** OAuth providers need client creds in env; token providers are always ready. */
function isConfigured(p) {
  if (p.kind === "token") return true;
  return Boolean(process.env[p.clientIdEnv] && process.env[p.clientSecretEnv]);
}

/** Public list (no secrets) with per-provider readiness. */
function listProviders() {
  return PROVIDERS.map((p) => ({
    id: p.id, name: p.name, kind: p.kind,
    scopes: p.scopes || [],
    hasMcp: Boolean(p.mcp),
    configured: isConfigured(p),
    setupUrl: p.setupUrl || null,
    tokenLabel: p.tokenLabel || null,
    help: p.help || null,
  }));
}

module.exports = { PROVIDERS, getProvider, isConfigured, listProviders };
