import { useLocalForge } from "./hooks/useLocalForge";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { MessageList } from "./components/MessageList";
import { Composer } from "./components/Composer";
import { Explorer } from "./components/Explorer";
import { Settings } from "./components/Settings";
import { OutputPanel } from "./components/OutputPanel";
import { toolInvoke } from "./native";
import { Terminal, Check, GitBranch } from "lucide-react";
export default function App() {
  const ui = useLocalForge();
  const {
    models,
    connection,
    workspace,
    busy,
    settingsOpen,
    setSettingsOpen,
    sidebar,
    explorer,
    outputOpen,
    setOutputOpen,
    outputTab,
    setOutputTab,
    setError,
    revision,
    records,
    git,
    attachWorkspaceFile,
    active,
    settings,
    mutate,
    refreshModels,
    runManual,
    refreshGit,
  } = ui;
  return (
    <div className={`app ${sidebar ? "" : "sidebar-hidden"}`}>
      <Sidebar ui={ui} />
      <main className="main">
        <Topbar ui={ui} />
        <div className="work-area">
          <section className="conversation-column">
            <MessageList ui={ui} />
            <Composer ui={ui} />
            {outputOpen && (
              <OutputPanel
                tab={outputTab}
                setTab={setOutputTab}
                close={() => setOutputOpen(false)}
                activity={active?.activity ?? []}
                records={records}
                changes={active?.changes ?? []}
                git={git}
                refreshGit={(kind) => void refreshGit(kind)}
                run={(text) => void runManual(text)}
                busy={busy}
              />
            )}
          </section>
          {workspace && explorer && (
            <Explorer
              key={workspace}
              workspace={workspace}
              revision={revision}
              onError={setError}
              search={(q) =>
                toolInvoke(
                  "find_text",
                  { query: q },
                  new AbortController().signal,
                  undefined,
                  workspace,
                )
              }
              onAttach={(path) => void attachWorkspaceFile(path)}
            />
          )}
        </div>
        <footer className="statusbar">
          <span>
            <i className={connection === "online" ? "green" : ""} />
            {connection === "online"
              ? "Ollama connected"
              : connection === "connecting"
                ? "Connecting to Ollama"
                : "Ollama disconnected"}
          </span>
          {workspace && (
            <span title={workspace}>
              <GitBranch size={11} />
              {workspace}
            </span>
          )}
          <div />
          <button
            onClick={() => {
              setOutputOpen((v) => !v);
              if (!outputOpen) setOutputTab("terminal");
            }}
          >
            <Terminal size={12} />
            Output
          </button>
          <button
            onClick={() => {
              setOutputOpen(true);
              setOutputTab("diff");
            }}
          >
            <Check size={11} />
            {active?.changes.length ?? 0} files changed
          </button>
          <span>LocalForge 0.1</span>
        </footer>
      </main>
      {settingsOpen && (
        <Settings
          value={settings}
          change={(s) => mutate((old) => ({ ...old, settings: s }))}
          models={models}
          close={() => setSettingsOpen(false)}
          refresh={() => void refreshModels()}
          locked={busy}
        />
      )}
    </div>
  );
}
