import { X, RefreshCw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import {
  defaults,
  type Model,
  type Settings as SettingsType,
  type ToolStrategy,
} from "../types";
export function Settings({
  value,
  change,
  models,
  close,
  refresh,
  locked,
}: {
  value: SettingsType;
  change: (s: SettingsType) => void;
  models: Model[];
  close: () => void;
  refresh: () => void;
  locked: boolean;
}) {
  const set = <K extends keyof SettingsType>(key: K, v: SettingsType[K]) =>
    change({ ...value, [key]: v });
  const [url, setUrl] = useState(value.ollamaUrl);
  const model = value.defaultModel;
  const overrides = value.models[model] ?? {};
  const override = (key: string, v: unknown) =>
    change({
      ...value,
      models: { ...value.models, [model]: { ...overrides, [key]: v } },
    });
  return (
    <div className="modal-shade" onClick={close}>
      <section
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <div>
            <small>LOCALFORGE</small>
            <h2>Settings</h2>
          </div>
          <button onClick={close} title="Close settings">
            <X size={20} />
          </button>
        </header>
        <div className="settings-scroll">
          <fieldset disabled={locked}>
            <section>
              <h3>General</h3>
              <label>
                Appearance
                <select
                  value={value.theme}
                  onChange={(e) =>
                    set("theme", e.target.value as SettingsType["theme"])
                  }
                >
                  <option value="system">System</option>
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </label>
              <label>
                Default mode
                <select
                  value={value.defaultMode}
                  onChange={(e) =>
                    set(
                      "defaultMode",
                      e.target.value as SettingsType["defaultMode"],
                    )
                  }
                >
                  <option value="chat">Chat</option>
                  <option value="agent">Code Agent</option>
                </select>
              </label>
            </section>
            <section>
              <h3>
                Model provider <span className="badge">Ollama</span>
              </h3>
              <label>
                Ollama URL
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onBlur={() => set("ollamaUrl", url.trim())}
                  placeholder={defaults.ollamaUrl}
                />
              </label>
              <p>
                Loopback endpoints only. Click Refresh to reconnect after
                changing the URL.
              </p>
              <label>
                Default model
                <select
                  value={value.defaultModel}
                  onChange={(e) => set("defaultModel", e.target.value)}
                >
                  <option value="">Automatic</option>
                  {models.map((m) => (
                    <option key={m.id}>{m.id}</option>
                  ))}
                </select>
              </label>
              <button onClick={refresh}>
                <RefreshCw size={14} />
                Refresh models
              </button>
            </section>
            <section>
              <h3>Generation defaults</h3>
              <label>
                Temperature
                <input
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  value={value.temperature}
                  onChange={(e) =>
                    set(
                      "temperature",
                      Math.min(2, Math.max(0, Number(e.target.value))),
                    )
                  }
                />
              </label>
              <label>
                Context length
                <input
                  type="number"
                  min="2048"
                  max="1048576"
                  step="1024"
                  value={value.contextLength}
                  onChange={(e) =>
                    set(
                      "contextLength",
                      Math.min(1048576, Math.max(2048, Number(e.target.value))),
                    )
                  }
                />
              </label>
              <label>
                Maximum output tokens
                <input
                  type="number"
                  min="64"
                  max="131072"
                  step="256"
                  value={value.maxTokens}
                  onChange={(e) =>
                    set(
                      "maxTokens",
                      Math.min(131072, Math.max(64, Number(e.target.value))),
                    )
                  }
                />
              </label>
              <p>
                Ollama controls parameter support. Keep context within your
                model’s metadata and available memory.
              </p>
            </section>
            <section>
              <h3>Agent permissions</h3>
              <label>
                Maximum iterations
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={value.maxIterations}
                  onChange={(e) =>
                    set(
                      "maxIterations",
                      Math.min(100, Math.max(1, Number(e.target.value))),
                    )
                  }
                />
              </label>
              <label className="toggle">
                Auto apply workspace edits
                <input
                  type="checkbox"
                  checked={value.autoApply}
                  onChange={(e) => set("autoApply", e.target.checked)}
                />
              </label>
              <p>Off by default. Deletes always require approval.</p>
              <label className="toggle">
                Require terminal approval
                <input
                  type="checkbox"
                  checked={value.terminalApproval}
                  onChange={(e) => set("terminalApproval", e.target.checked)}
                />
              </label>
              <p>
                When off, only exact read-only Git commands can run
                automatically. Project scripts, builds, installs and other
                programs still require explicit approval.
              </p>
            </section>
            <section>
              <h3>Per-model overrides</h3>
              {model ? (
                <>
                  <p>
                    Overrides for <strong>{model}</strong>
                  </p>
                  <label>
                    Tool strategy
                    <select
                      value={overrides.toolStrategy ?? "automatic"}
                      onChange={(e) =>
                        override("toolStrategy", e.target.value as ToolStrategy)
                      }
                    >
                      <option value="automatic">Automatic</option>
                      <option value="native">Native tools</option>
                      <option value="fallback">Structured fallback</option>
                      <option value="chat-only">Chat only</option>
                    </select>
                  </label>
                  {(
                    [
                      ["temperature", "Temperature"],
                      ["contextLength", "Context length"],
                      ["maxTokens", "Maximum output tokens"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        type="number"
                        min={
                          key === "temperature"
                            ? 0
                            : key === "contextLength"
                              ? 2048
                              : 64
                        }
                        max={
                          key === "temperature"
                            ? 2
                            : key === "contextLength"
                              ? 1048576
                              : 131072
                        }
                        step={key === "temperature" ? 0.1 : 1}
                        placeholder="Use default"
                        value={overrides[key] ?? ""}
                        onChange={(e) =>
                          override(
                            key,
                            e.target.value === ""
                              ? undefined
                              : Math.min(
                                  key === "temperature"
                                    ? 2
                                    : key === "contextLength"
                                      ? 1048576
                                      : 131072,
                                  Math.max(
                                    key === "temperature"
                                      ? 0
                                      : key === "contextLength"
                                        ? 2048
                                        : 64,
                                    Number(e.target.value),
                                  ),
                                ),
                          )
                        }
                      />
                    </label>
                  ))}
                  <label className="stack">
                    Additional system prompt
                    <textarea
                      value={overrides.systemPrompt ?? ""}
                      onChange={(e) => override("systemPrompt", e.target.value)}
                      rows={3}
                    />
                  </label>
                  <button
                    onClick={() => {
                      const next = { ...value.models };
                      delete next[model];
                      set("models", next);
                    }}
                  >
                    Reset overrides
                  </button>
                </>
              ) : (
                <p>Select a default model to configure overrides.</p>
              )}
            </section>
          </fieldset>
          <section className="privacy-note">
            <ShieldCheck size={22} />
            <div>
              <h3>Your machine. Your models.</h3>
              <p>
                Inference uses your local Ollama server. Conversations and
                settings stay in macOS Application Support. No analytics,
                telemetry, cloud accounts, or remote AI APIs. Approved terminal
                programs may make their own network connections.
              </p>
            </div>
          </section>
          {locked && (
            <p className="error-text">
              Stop the active task to change settings.
            </p>
          )}
        </div>
        <footer>
          <span>Changes save automatically</span>
          <button className="primary" onClick={close}>
            Done
          </button>
        </footer>
      </section>
    </div>
  );
}
