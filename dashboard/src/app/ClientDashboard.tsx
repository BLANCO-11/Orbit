'use client';

import dynamic from 'next/dynamic';

const Dashboard = dynamic(() => import('./page'), { ssr: false });

export default function ClientDashboard() {
  return <Dashboard />;
}
