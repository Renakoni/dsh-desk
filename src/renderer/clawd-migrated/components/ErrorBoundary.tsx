// @ts-nocheck
import React from "react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[Renderer] Unhandled React error", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
          <div className="panel-group-card" style={{ maxWidth: 520 }}>
            <h2 className="panel-title">界面渲染失败</h2>
            <p className="note">请重启 DSH Desk。如果问题持续出现，请查看开发者控制台日志。</p>
            <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", marginTop: 12 }}>
              {this.state.error.message}
            </pre>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

