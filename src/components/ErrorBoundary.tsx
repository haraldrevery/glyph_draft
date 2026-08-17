import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Root error boundary: a render-time exception anywhere below it shows a recover
 * panel instead of a blank white screen. React error boundaries catch errors in
 * **render / lifecycle** only — not event handlers, promises, or module load.
 *
 * The document autosaves, so the work is safe on disk; the fallback offers a reload
 * (the most common fix) and surfaces the error text so a real bug can be reported. It
 * deliberately does NOT auto-clear storage — a state-induced crash needs a human
 * decision, not a silent wipe.
 */
interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep a console trace for diagnosis; the boundary itself shows the panel.
    console.error("Unhandled render error:", error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="error-boundary" role="alert">
        <div className="error-boundary-card">
          <h1>Something went wrong</h1>
          <p>
            The editor hit an unexpected error and stopped drawing. Your work is autosaved, so it
            should still be there after a reload.
          </p>
          <pre className="error-boundary-detail">{error.message}</pre>
          <div className="error-boundary-actions">
            <button type="button" className="btn" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
