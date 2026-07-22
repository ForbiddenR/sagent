import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";

class ErrorBoundary extends React.Component<React.PropsWithChildren, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Dagent render failed", error, info);
  }

  render() {
    if (this.state.error) {
      return <div className="fatal-screen">
        <div className="fatal-card">
          <span className="eyebrow">Startup error</span>
          <h1>Dagent could not render</h1>
          <p>{this.state.error.message}</p>
          <button onClick={() => window.location.reload()}>Reload application</button>
        </div>
      </div>;
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <HashRouter><App /></HashRouter>
  </ErrorBoundary>,
);
