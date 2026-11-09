import type { LocalForgeController } from "../hooks/useLocalForge";
import {
  MessageSquare,
  Code2,
  FolderOpen,
  PanelLeftOpen,
  PanelRight,
  RefreshCw,
  ChevronDown,
  Cpu,
  X,
  AlertCircle,
} from "lucide-react";
export function Topbar({ ui }: { ui: LocalForgeController }) {
  const {
    models,
    model,
    setModel,
    connection,
    connectionError,
    workspace,
    mode,
    switchMode,
    busy,
    setSettingsOpen,
    sidebar,
    setSidebar,
    explorer,
    setExplorer,
    error,
    setError,
    active,
    selected,
    settings,
    mutate,
    updateConversation,
    refreshModels,
    openWorkspace,
    capLabel,
  } = ui;
  return (
    <>
      <header className={`topbar ${sidebar ? "" : "without-sidebar"}`}>
        {!sidebar && (
          <button title="Show sidebar" onClick={() => setSidebar(true)}>
            <PanelLeftOpen size={17} />
          </button>
        )}
        <div className="mode-switch">
          <button
            disabled={busy}
            className={mode === "chat" ? "active" : ""}
            onClick={() => switchMode("chat")}
          >
            <MessageSquare size={14} />
            Chat
          </button>
          <button
            disabled={busy}
            className={mode === "agent" ? "active" : ""}
            onClick={() => switchMode("agent")}
          >
            <Code2 size={14} />
            Code Agent
          </button>
        </div>
        <div
          className="model-select"
          title={
            selected
              ? `Chat: ${capLabel(selected.capabilities.chat)} · Tools: ${capLabel(selected.capabilities.tools)} · Vision: ${capLabel(selected.capabilities.vision)} · Reasoning: ${capLabel(selected.capabilities.reasoning)} · Structured output: ${capLabel(selected.capabilities.structuredOutput)}${selected.capabilities.contextLength ? ` · Max context: ${selected.capabilities.contextLength}` : ""}`
              : "Installed Ollama models"
          }
        >
          <Cpu size={15} />
          <select
            aria-label="Selected model"
            value={model}
            disabled={busy || !models.length}
            onChange={(e) => {
              setModel(e.target.value);
              mutate((s) => ({
                ...s,
                settings: { ...s.settings, defaultModel: e.target.value },
              }));
              if (active)
                updateConversation(active.id, (c) => ({
                  ...c,
                  model: e.target.value,
                }));
            }}
          >
            <option value="" disabled>
              {connection === "online"
                ? "No local models detected"
                : "Select a local model"}
            </option>
            {model && !models.some((m) => m.id === model) && (
              <option value={model}>{model} (unavailable)</option>
            )}
            {models.map((m) => (
              <option key={m.id}>{m.id}</option>
            ))}
          </select>
          <ChevronDown size={12} />
        </div>
        <button
          title="Refresh models"
          disabled={busy}
          onClick={() => void refreshModels()}
        >
          <RefreshCw
            size={14}
            className={connection === "connecting" ? "spin" : ""}
          />
        </button>
        <div className="topbar-spacer" />
        <button
          className="workspace-chip"
          disabled={busy}
          title={workspace ?? "Open workspace"}
          onClick={() => void openWorkspace()}
        >
          <FolderOpen size={14} />
          <span>{workspace?.split("/").pop() ?? "Open workspace"}</span>
        </button>
        <span
          className={`connection ${connection}`}
          title={connectionError || settings.ollamaUrl}
        >
          <i />
          {connection === "online"
            ? "Local"
            : connection === "connecting"
              ? "Connecting"
              : "Offline"}
        </span>
        <button
          title="Toggle explorer"
          className={explorer && workspace ? "active-icon" : ""}
          onClick={() => setExplorer((v) => !v)}
        >
          <PanelRight size={17} />
        </button>
      </header>
      {connection === "offline" && (
        <div className="connection-banner">
          <AlertCircle size={15} />
          <span>Ollama is not currently available.</span>
          <button disabled={busy} onClick={() => void refreshModels()}>
            Retry connection
          </button>
          <button onClick={() => setSettingsOpen(true)}>Settings</button>
        </div>
      )}
      {connection === "online" && !models.length && (
        <div className="connection-banner">
          <Cpu size={15} />
          No local models detected. Install a model with Ollama, then refresh.
        </div>
      )}
      {error && (
        <div className="error-banner">
          <AlertCircle size={15} />
          <span>{error}</span>
          <button title="Dismiss error" onClick={() => setError("")}>
            <X size={14} />
          </button>
        </div>
      )}
    </>
  );
}
