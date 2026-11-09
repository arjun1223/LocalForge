import { Code2, MessageSquare } from "lucide-react";
import type { Mode } from "../types";
export function ModeNotice({
  mode,
  workspace,
  busy,
  useAgent,
}: {
  mode: Mode;
  workspace?: string;
  busy: boolean;
  useAgent: () => void;
}) {
  if (!workspace) return null;
  return (
    <div className={`mode-notice ${mode}`} role="status">
      {mode === "chat" ? <MessageSquare size={15} /> : <Code2 size={15} />}
      <div>
        <strong>
          {mode === "chat"
            ? "Chat · workspace tools off"
            : "Code Agent · workspace tools on"}
        </strong>
        <span>
          {mode === "chat"
            ? "Opening a project does not give Chat file or terminal access."
            : "Can inspect project files and propose changes using your permission settings."}
        </span>
      </div>
      {mode === "chat" ? (
        <button disabled={busy} onClick={useAgent}>
          <Code2 size={13} />
          Use Code Agent
        </button>
      ) : (
        <small title={workspace}>{workspace.split("/").pop()}</small>
      )}
    </div>
  );
}
