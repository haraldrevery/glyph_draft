import { Component, type ErrorInfo, type ReactNode } from "react";
import { exportProject } from "../features/project/projectActions";

/**
 * Render-error containment. React error boundaries catch errors in **render /
 * lifecycle** only — not event handlers, promises, or module load.
 *
 * Two uses:
 *  - The ROOT boundary (no `fallback`): the last line of defence. Shows a recover
 *    panel with Reload and — because the document autosaves, a document that throws
 *    while rendering would throw again after a reload — an "Export project file"
 *    rescue, which serializes the store directly (no rendering), so the work can
 *    always be got out.
 *  - SCOPED boundaries (with `fallback`) around the parts that run the geometry
 *    engine (the canvas glyph, onion skin, each sidebar thumbnail, the text preview),
 *    so one bad glyph degrades that one view instead of blanking the whole app.
 *    `resetKey` retries automatically when it changes — pass the glyph, so an Undo
 *    or a glyph switch re-renders it.
 *
 * Containment is deliberately at the UI level only: the shared fill pipeline does
 * NOT swallow errors, so an export of a broken glyph still fails loudly instead of
 * silently writing an SVG with geometry missing.
 *
 * It never auto-clears storage — a state-induced crash needs a human decision.
 */
interface Props {
  children: ReactNode;
  /** Scoped fallback. Omit for the full-screen root panel. */
  fallback?: (error: Error) => ReactNode;
  /** When this changes, a caught error is cleared and the children re-render. */
  resetKey?: unknown;
  onError?: (error: Error) => void;
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
    // Keep a console trace for diagnosis; the boundary itself shows the fallback.
    console.error("Render error:", error, info.componentStack);
    this.props.onError?.(error);
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error);
    return (
      <div className="error-boundary" role="alert">
        <div className="error-boundary-card">
          <h1>Something went wrong</h1>
          <p>
            The editor hit an unexpected error and stopped drawing. Your work is autosaved. If
            reloading shows this again, export the project file first so nothing is lost.
          </p>
          <pre className="error-boundary-detail">{error.message}</pre>
          <div className="error-boundary-actions">
            <button type="button" className="btn" onClick={() => void exportProject()}>
              Export project file…
            </button>
            <button type="button" className="btn" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
