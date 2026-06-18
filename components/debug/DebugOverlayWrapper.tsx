'use client';

import { Component, type ReactNode } from 'react';
import DebugOverlay from './DebugOverlay';

class DebugErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

export function DebugOverlayWrapper() {
  return (
    <DebugErrorBoundary>
      <DebugOverlay />
    </DebugErrorBoundary>
  );
}
