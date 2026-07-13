// This file's content is never actually rendered — RootLayout (../../layout.tsx)
// always renders <ClientDashboard /> regardless of the matched route, and
// Dashboard (../../page.tsx) reads the session id from the /session/<id> path
// (see useSessions). This stub exists purely so Next's router recognizes
// /session/<id> as a real route (HTTP 200) instead of falling through to
// not-found (HTTP 404) before any client JS has a chance to run.
export default function SessionRoute() {
  return null;
}
