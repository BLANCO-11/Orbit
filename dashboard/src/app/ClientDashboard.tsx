'use client';

import dynamic from 'next/dynamic';

const Dashboard = dynamic(() => import('./page'), {
  ssr: false,
  loading: () => (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: '#08080c', color: '#8b8b90',
      fontSize: '0.9rem', fontFamily: 'Inter, sans-serif',
    }}>
      Loading AegisAgent...
    </div>
  ),
});

export default function ClientDashboard() {
  return <Dashboard />;
}
