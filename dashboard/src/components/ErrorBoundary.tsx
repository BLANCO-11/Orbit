'use client';

import React from 'react';
import { Button } from '@/components/ui/button';

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
        <div className="flex h-screen flex-col items-center justify-center bg-background p-10 text-center text-foreground">
          <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-destructive/10">
            <span className="text-2xl">!</span>
          </div>
          <h3 className="mb-2 text-[1.1rem] font-semibold">Something went wrong</h3>
          <p className="mb-5 max-w-[400px] text-[0.85rem] text-muted-foreground">
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <Button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
          >
            Reload Page
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * ComponentErrorBoundary — Lightweight wrapper for individual panels/widgets.
 *
 * Unlike ErrorBoundary (full-page takeover), this renders a compact inline
 * fallback so a crash in one panel doesn't take the whole dashboard down.
 */
export class ComponentErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode; label?: string },
  ErrorBoundaryState
> {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error(`ComponentErrorBoundary (${this.props.label || 'component'}) caught:`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center gap-2 p-6 text-center text-[0.8rem] text-muted-foreground">
          <span>{this.props.label ? `${this.props.label} failed to render.` : 'This panel failed to render.'}</span>
          <Button variant="outline" size="sm" onClick={() => this.setState({ hasError: false, error: null })}>
            Retry
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
