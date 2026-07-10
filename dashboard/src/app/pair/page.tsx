// This file's content is never actually rendered — RootLayout (../layout.tsx)
// always renders <ClientDashboard /> regardless of the matched route, and
// Dashboard (../page.tsx) does a client-side pathname check to show
// PairDevice for /pair. This file exists purely so Next's router recognizes
// /pair as a real route (HTTP 200) instead of falling through to not-found
// (HTTP 404) before any client JS has a chance to run.
export default function PairRoute() {
  return null;
}
