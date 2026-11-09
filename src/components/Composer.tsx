import type { LocalForgeController } from "../hooks/useLocalForge";
import { ArrowUp, Square, ShieldCheck, X, Paperclip } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { desktop, errorText } from "../native";
export function Composer({ ui }: { ui: LocalForgeController }) {
  const [dragging, setDragging] = useState(false);
  const [previewPath, setPreviewPath] = useState<string>();
  const handlers = useRef(ui);
  handlers.current = ui;
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        if (disposed) return;
        if (payload.type === "enter" || payload.type === "over")
          setDragging(true);
        else {
          setDragging(false);
          if (payload.type === "drop")
            void handlers.current.attachDroppedPaths(payload.paths);
        }
      })
      .then((off) => {
        if (disposed) off();
        else unlisten = off;
      })
      .catch((error) => {
        if (!disposed)
          handlers.current.setError(
            `File drop could not start: ${errorText(error)}`,
          );
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  useEffect(() => {
    const isFiles = (event: DragEvent) =>
      event.dataTransfer?.types.includes("Files");
    const enter = (event: DragEvent) => {
      if (isFiles(event)) {
        event.preventDefault();
        setDragging(true);
      }
    };
    const over = (event: DragEvent) => {
      if (isFiles(event)) {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      }
    };
    const leave = (event: DragEvent) => {
      if (!event.relatedTarget) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      setDragging(false);
      if (
        Array.from(event.dataTransfer?.items ?? []).some(
          (item) => item.webkitGetAsEntry?.()?.isDirectory,
        )
      ) {
        event.preventDefault();
        handlers.current.setError(
          "Folders cannot be attached. Use Open a project for folders, or select individual text files.",
        );
        return;
      }
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length) {
        event.preventDefault();
        void handlers.current.attachDropped(files);
      }
    };
    const end = () => setDragging(false);
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    window.addEventListener("dragend", end);
    window.addEventListener("blur", end);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
      window.removeEventListener("dragend", end);
      window.removeEventListener("blur", end);
    };
  }, []);
  const {
    model,
    connection,
    mode,
    workspace,
    prompt,
    setPrompt,
    busy,
    workingMessageId,
    ready,
    approvals,
    attached,
    setAttached,
    attaching,
    attachWorkspaceFile,
    composer,
    settings,
    stop,
    send,
    attachContext,
    latestActivity,
  } = ui;
  const preview = attached.find((file) => file.path === previewPath);
  return (
    <>
      {dragging && (
        <div className="file-drop-overlay">
          <Paperclip size={30} />
          <strong>
            {busy
              ? "Finish or stop the current response first"
              : "Drop files to add to your message"}
          </strong>
          <span>Text and code files · Stay on your Mac</span>
        </div>
      )}
      <div className="composer-area">
        {busy && (
          <div className="agent-progress">
            <span className="progress-dot" />
            {approvals.length
              ? "Waiting for your approval"
              : !workingMessageId
                ? "Running command…"
                : (latestActivity?.label ??
                  (mode === "agent"
                    ? "Working on your task…"
                    : "Generating response…"))}
            <button onClick={stop}>Stop</button>
          </div>
        )}
        {attached.length > 0 && (
          <div className="attachments">
            {attached.map((f) => (
              <span key={f.path} title={f.path}>
                <Paperclip size={12} />
                <button
                  className="attachment-name"
                  type="button"
                  onClick={() =>
                    setPreviewPath(previewPath === f.path ? undefined : f.path)
                  }
                >
                  {f.name.split("/").pop()}{" "}
                  <small>
                    {f.content.length < 1000
                      ? `${f.content.length} chars`
                      : `${(f.content.length / 1000).toFixed(1)}k`}
                    {f.originalCharacters ? " · excerpt" : ""}
                  </small>
                </button>
                <button
                  type="button"
                  title={`Remove ${f.name}`}
                  aria-label={`Remove ${f.name}`}
                  disabled={attaching}
                  onClick={() =>
                    setAttached((old) => old.filter((x) => x.path !== f.path))
                  }
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        {preview && (
          <div className="attachment-preview">
            <header>
              <strong>{preview.name}</strong>
              <span>{preview.content.length.toLocaleString()} characters</span>
              <button
                type="button"
                title="Close attachment preview"
                onClick={() => setPreviewPath(undefined)}
              >
                <X size={14} />
              </button>
            </header>
            <pre>
              {preview.content.slice(0, 12000) || "Empty file"}
              {preview.content.length > 12000 ? "\n… Preview shortened" : ""}
            </pre>
          </div>
        )}
        <form
          className="composer"
          onDragOver={(event) => {
            if (
              event.dataTransfer.types.includes("application/x-localforge-file")
            ) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={(event) => {
            const value = event.dataTransfer.getData(
              "application/x-localforge-file",
            );
            if (!value) return;
            event.preventDefault();
            try {
              const file = JSON.parse(value);
              if (file.workspace === workspace && typeof file.path === "string")
                void attachWorkspaceFile(file.path);
            } catch {
              /* Ignore unrelated or malformed drag data. */
            }
          }}
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            ref={composer}
            aria-label="Message prompt"
            rows={3}
            placeholder={
              mode === "chat"
                ? "Ask anything. It stays local."
                : "Describe a task for your workspace…"
            }
            value={prompt}
            disabled={!ready}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <footer>
            <div>
              <button
                type="button"
                title="Add files (or drop from Finder)"
                aria-label="Add files"
                disabled={busy || attaching || !ready}
                onClick={() => void attachContext()}
              >
                <Paperclip size={16} />
              </button>
              {attaching ? (
                <span>Adding files…</span>
              ) : (
                <span className="drop-hint">Drop files here</span>
              )}
              <span>
                {mode === "agent" ? (
                  <>
                    <ShieldCheck size={12} />
                    {settings.autoApply ? "Auto apply on" : "Review changes"}
                  </>
                ) : (
                  <>
                    <ShieldCheck size={12} />
                    {workspace
                      ? "Workspace tools off · Chat"
                      : "Private conversation"}
                  </>
                )}
              </span>
            </div>
            {busy ? (
              <button
                type="button"
                className="send-button stop"
                title="Stop generation"
                onClick={stop}
              >
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button
                className="send-button"
                title="Send prompt"
                disabled={
                  !prompt.trim() ||
                  !model ||
                  connection !== "online" ||
                  !ready ||
                  attaching
                }
              >
                <ArrowUp size={18} />
              </button>
            )}
          </footer>
        </form>
        <div className="composer-caption">
          <span>
            {mode === "agent"
              ? "Review changes and commands before approving."
              : "Local models can make mistakes. Check important details."}
          </span>
          <span>↵ Send · ⇧↵ New line</span>
        </div>
      </div>
    </>
  );
}
