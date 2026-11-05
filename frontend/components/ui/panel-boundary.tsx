"use client";

import { Component, type ReactNode } from "react";

import { Button } from "./button";

/**
 * Keeps one broken panel from blanking the whole dashboard: if its content throws while
 * drawing, the panel says so and offers a retry, and every other panel carries on.
 */
export class PanelBoundary extends Component<{ label: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`[panel] "${this.props.label}" could not be drawn`, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-control px-4 py-3 text-sm text-muted">
        <span>This panel couldn&apos;t be drawn. The rest of the dashboard is unaffected.</span>
        <Button variant="secondary" size="sm" onClick={() => this.setState({ failed: false })}>
          Try again
        </Button>
      </div>
    );
  }
}
