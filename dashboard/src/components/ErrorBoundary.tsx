'use client';

import React from 'react';

/**
 * ErrorBoundary — Catch render errors, show friendly fallback.
 */
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          height: '100vh', padding: '40px', textAlign: 'center',
          background: 'var(--bg-base)', color: 'var(--text-primary)',
        }}>
          <div style={{
            width: '48px', height: '48px', borderRadius: '50%',
            background: 'var(--accent-danger-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: '16px',
          }}>
            <span style={{ fontSize: '1.5rem' }}>!</span>
          </div>
          <h3 style={{ marginBottom: '8px', fontSize: '1.1rem' }}>Something went wrong</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '20px', maxWidth: '400px' }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            style={{
              padding: '8px 20px', borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--accent-primary)', background: 'var(--accent-primary)',
              color: '#fff', cursor: 'pointer', fontWeight: '600', fontSize: '0.85rem',
            }}
          >
            Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * ComponentErrorBoundary — Lightweight wrapper for individual components.
 */
export function ComponentErrorBoundary({ children, fallback }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  return (
    <ErrorBoundary>
      {children}
    </ErrorBoundary>
  );
}
