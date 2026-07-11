'use client';

import dynamic from 'next/dynamic';

const Dashboard = dynamic(() => import('./page'), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
      Loading Orbit...
    </div>
  ),
});

export default function ClientDashboard() {
  return <Dashboard />;
}
