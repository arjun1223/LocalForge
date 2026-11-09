import { useState } from "react";
import {
  CheckCircle2,
  Circle,
  XCircle,
  ChevronDown,
  Terminal,
  GitBranch,
  Play,
} from "lucide-react";
import { Diff } from "./DiffViewer";
import type { Activity, Change, TerminalRecord } from "../types";
import type { OutputTab } from "../types";
export function OutputPanel({
  tab,
  setTab,
  close,
  activity,
  records,
  changes,
  git,
  refreshGit,
  run,
  busy,
}: {
  tab: OutputTab;
  setTab: (t: OutputTab) => void;
  close: () => void;
  activity: Activity[];
  records: TerminalRecord[];
  changes: Change[];
  git: string;
  refreshGit: (kind: string) => void;
  run: (text: string) => void;
  busy: boolean;
}) {
  const [command, setCommand] = useState("");
  const errors = activity.filter((a) => a.status === "error");
  const activityList = tab === "problems" ? errors : activity;
  return (
    <section className="output-panel">
      <header className="output-tabs">
        {(["terminal", "activity", "problems", "diff", "git"] as const).map(
          (t) => (
            <button
              key={t}
              className={tab === t ? "selected" : ""}
              onClick={() => setTab(t)}
            >
              {t === "terminal" && <Terminal size={12} />} {t.toUpperCase()}{" "}
              {t === "problems" && errors.length > 0 && (
                <span>{errors.length}</span>
              )}
              {t === "diff" && changes.length > 0 && (
                <span>{changes.length}</span>
              )}
            </button>
          ),
        )}
        <button
          className="panel-collapse"
          title="Collapse output panel"
          onClick={close}
        >
          <ChevronDown size={16} />
        </button>
      </header>
      <div className="output-content">
        {tab === "terminal" ? (
          <>
            {!records.length && (
              <p className="output-empty">
                Run a build, test, or command in your workspace. Commands show
                their real output here.
              </p>
            )}
            {records.map((r) => (
              <div className="terminal-record" key={r.id}>
                <header>
                  <code>❯ {r.command}</code>
                  <small>
                    {r.running
                      ? r.waiting
                        ? "Waiting for approval…"
                        : "Running…"
                      : r.outcome === "rejected"
                        ? "Rejected · not executed"
                        : r.outcome === "stopped"
                          ? "Stopped"
                          : r.outcome === "failed"
                            ? "Failed"
                            : `Exit ${r.exitCode ?? "—"}${r.duration !== undefined ? ` · ${(r.duration / 1000).toFixed(2)}s` : ""}`}
                  </small>
                </header>
                <small className="muted">{r.cwd}</small>
                <pre>
                  {r.stdout}
                  <span className="stderr">{r.stderr}</span>
                </pre>
              </div>
            ))}
          </>
        ) : tab === "diff" ? (
          changes.length ? (
            changes.map((c) => <Diff key={c.path} change={c} />)
          ) : (
            <p className="output-empty">
              Approved file changes will appear here.
            </p>
          )
        ) : tab === "git" ? (
          <>
            <div className="git-actions">
              <GitBranch size={14} />
              {["status", "diff", "log"].map((kind) => (
                <button
                  key={kind}
                  disabled={busy}
                  onClick={() => refreshGit(kind)}
                >
                  git {kind}
                </button>
              ))}
            </div>
            <pre className="git-output">
              {git || "Choose a Git view above."}
            </pre>
          </>
        ) : (
          <>
            {!activityList.length && (
              <p className="output-empty">
                {tab === "problems"
                  ? "No reported problems."
                  : "Agent actions will appear here."}
              </p>
            )}
            {activityList.map((a) => (
              <details className={`activity-row ${a.status}`} key={a.id}>
                <summary>
                  {a.status === "running" ? (
                    <Circle className="spin" size={14} />
                  ) : a.status === "success" ? (
                    <CheckCircle2 size={14} />
                  ) : (
                    <XCircle size={14} />
                  )}
                  <span>{a.label}</span>
                  <time>
                    {new Date(a.at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </summary>
                {a.detail && <pre>{a.detail}</pre>}
              </details>
            ))}
          </>
        )}
      </div>
      {tab === "terminal" && (
        <form
          className="terminal-command"
          onSubmit={(e) => {
            e.preventDefault();
            if (command.trim()) {
              run(command);
              setCommand("");
            }
          }}
        >
          <span>❯</span>
          <input
            aria-label="Terminal command"
            placeholder="npm run build"
            value={command}
            disabled={busy}
            onChange={(e) => setCommand(e.target.value)}
          />
          <button disabled={busy || !command.trim()} title="Run command">
            <Play size={13} />
          </button>
        </form>
      )}
    </section>
  );
}
