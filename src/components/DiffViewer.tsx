import { diffLines } from "diff";
import { Check, X, FileCode2, Terminal } from "lucide-react";
import type { Change, Pending } from "../types";
export function Diff({ change }: { change: Change }) {
  let oldLine = 0,
    newLine = 0;
  const chunks = diffLines(change.before ?? "", change.after ?? "");
  const added = chunks
    .filter((c) => c.added)
    .reduce((n, c) => n + (c.count ?? 0), 0);
  const removed = chunks
    .filter((c) => c.removed)
    .reduce((n, c) => n + (c.count ?? 0), 0);
  const rows = chunks.flatMap((chunk, chunkIndex) => {
    const lines = chunk.value.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    return lines.map((text, i) => {
      if (!chunk.added) oldLine++;
      if (!chunk.removed) newLine++;
      return (
        <div
          className={`diff-line ${chunk.added ? "added" : chunk.removed ? "removed" : ""}`}
          key={`${chunkIndex}-${i}`}
        >
          <span>{chunk.added ? "" : oldLine}</span>
          <span>{chunk.removed ? "" : newLine}</span>
          <b>{chunk.added ? "+" : chunk.removed ? "−" : " "}</b>
          <code>{text || " "}</code>
        </div>
      );
    });
  });
  return (
    <section className="diff-file">
      <header>
        <FileCode2 size={14} />
        <strong>{change.path}</strong>
        <span className="add-count">+{added}</span>
        <span className="remove-count">−{removed}</span>
        <small>
          {change.before === null
            ? "New file"
            : change.after === null
              ? "Delete file"
              : "Modified"}
        </small>
      </header>
      <div className="diff-lines">
        {rows.length ? (
          rows
        ) : (
          <div className="muted pad">No content changes</div>
        )}
      </div>
    </section>
  );
}
export function ApprovalCard({
  pending,
  decide,
  busy,
}: {
  pending: Pending;
  decide: (accept: boolean) => void;
  busy: boolean;
}) {
  return (
    <section className="approval-card">
      <header>
        <span className="approval-dot" />
        <strong>
          {pending.kind === "COMMAND"
            ? "Terminal approval required"
            : pending.kind === "DELETE"
              ? "Delete approval required"
              : "Review proposed change"}
        </strong>
      </header>
      {pending.command ? (
        <div className="command-review">
          <Terminal size={17} />
          <code>
            {[
              pending.command.program,
              ...pending.command.args.map((x) => JSON.stringify(x)),
            ].join(" ")}
          </code>
          <small>Working directory: {pending.workspace}</small>
          <p>
            This executes a local process with your user account. Programs and
            project scripts can read or modify files beyond this workspace and
            access the network. Approve only commands you trust.
          </p>
          <small>Timeout: {pending.command.timeout_seconds}s</small>
        </div>
      ) : (
        <Diff
          change={{
            path: pending.path!,
            before: pending.before,
            after: pending.after,
          }}
        />
      )}
      <footer>
        <button disabled={busy} onClick={() => decide(false)}>
          <X size={14} />
          Reject {pending.command ? "command" : "file"}
        </button>
        <button
          className="primary"
          disabled={busy}
          onClick={() => decide(true)}
        >
          <Check size={14} />
          Accept {pending.command ? "command" : "file"}
        </button>
      </footer>
    </section>
  );
}
