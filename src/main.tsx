import { Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "highlight.js/styles/github-dark.css";
class Boundary extends Component<{ children: ReactNode }, { error?: string }> {
  state: { error?: string } = {};
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("LocalForge UI error", error, info.componentStack);
  }
  render() {
    return this.state.error ? (
      <main className="crash">
        <h1>LocalForge encountered an error.</h1>
        <p>{this.state.error}</p>
        <p>Your saved conversations are preserved.</p>
        <button onClick={() => location.reload()}>Restart interface</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <Boundary>
    <App />
  </Boundary>,
);
