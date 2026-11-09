import type { LocalForgeController } from "../hooks/useLocalForge";
import {
  ArrowUp,
  MessageSquare,
  Code2,
  Copy,
  RotateCcw,
  Pencil,
  Sparkles,
} from "lucide-react";
import { Markdown } from "./Markdown";
import { ApprovalCard } from "./DiffViewer";
import { ModeNotice } from "./ModeNotice";
import { ResponseTimer } from "./ResponseTimer";
import { TurnActivity } from "./TurnActivity";
export function MessageList({ ui }: { ui: LocalForgeController }) {
  const {
    mode,
    workspace,
    switchMode,
    setPrompt,
    setAttached,
    busy,
    workingMessageId,
    approvals,
    composer,
    bottom,
    scroller,
    follow,
    active,
    selected,
    updateConversation,
    send,
    capLabel,
    latestActivity,
  } = ui;
  return (
    <>
      <div className="conversation-heading">
        <span>
          {active?.title ??
            (mode === "chat" ? "New conversation" : "New agent task")}
        </span>
        <small>
          {mode === "agent" ? "AGENT" : "CHAT"}
          {selected?.parameterSize ? ` / ${selected.parameterSize}` : ""}
        </small>
      </div>
      <ModeNotice
        mode={mode}
        workspace={workspace}
        busy={busy}
        useAgent={() => switchMode("agent")}
      />
      <div
        className="messages"
        ref={scroller}
        onScroll={() => {
          const el = scroller.current;
          if (el)
            follow.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
      >
        {!active?.messages.length && (
          <div className="welcome">
            <div className="welcome-mark">
              {mode === "chat" ? (
                <MessageSquare size={26} />
              ) : (
                <Code2 size={28} />
              )}
            </div>
            <div className="eyebrow">PRIVATE. CAPABLE. ON YOUR MAC.</div>
            <h1>
              {mode === "chat"
                ? "A little more possibility."
                : "From question to working code."}
            </h1>
            <p>
              {mode === "chat"
                ? "Think it through, work it out, or start something new. Your models and conversations stay here."
                : "Open a project and give your local model a task. Review its actions, approve changes, and follow the results."}
            </p>
            <div className="suggestions">
              {(mode === "chat"
                ? [
                    [
                      "Explore an idea",
                      "Help me think through an idea. Ask me what I’m working on.",
                    ],
                    [
                      "Explain something",
                      "Help me understand a technical concept. Ask me which one.",
                    ],
                  ]
                : [
                    [
                      "Inspect this project",
                      "Inspect this project, identify its structure and explain how to build and test it.",
                    ],
                    [
                      "Fix a failing build",
                      "Inspect this project and figure out why the build is failing. Fix it, show the diff, and verify with a successful build.",
                    ],
                  ]
              ).map(([title, value]) => (
                <button
                  key={title}
                  onClick={() => {
                    setPrompt(value);
                    composer.current?.focus();
                  }}
                >
                  <Sparkles size={15} />
                  <span>{title}</span>
                  <ArrowUp size={14} />
                </button>
              ))}
            </div>
            {selected && (
              <div className="capabilities">
                <span>
                  Tools <b>{capLabel(selected.capabilities.tools)}</b>
                </span>
                <span>
                  Vision <b>{capLabel(selected.capabilities.vision)}</b>
                </span>
                <span>
                  Reasoning <b>{capLabel(selected.capabilities.reasoning)}</b>
                </span>
                <span>
                  JSON <b>{capLabel(selected.capabilities.structuredOutput)}</b>
                </span>
              </div>
            )}
          </div>
        )}
        {active?.messages.map((m, index) => (
          <article
            key={m.id}
            className={`message ${m.role} ${m.error ? "message-error" : ""}`}
          >
            <div className="message-avatar">
              {m.role === "user" ? "Y" : <Code2 size={16} />}
            </div>
            <div className="message-body">
              <header>
                <strong>{m.role === "user" ? "You" : "LocalForge"}</strong>
                <small>
                  {m.role === "assistant"
                    ? active.model
                    : new Date(m.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                </small>
                {m.role === "assistant" && (
                  <ResponseTimer
                    message={m}
                    working={workingMessageId === m.id}
                  />
                )}
              </header>
              {m.attachments?.length ? (
                <div className="sent-attachments">
                  {m.attachments.map((file) => (
                    <details key={file.path}>
                      <summary>
                        {file.name.split("/").pop()}
                        {file.originalCharacters ? " · excerpt" : ""}
                      </summary>
                      <pre>{file.content}</pre>
                    </details>
                  ))}
                </div>
              ) : null}
              {m.role === "assistant" && (
                <TurnActivity
                  activity={active.activity.filter(
                    (item) => item.messageId === m.id,
                  )}
                  working={workingMessageId === m.id}
                />
              )}
              {m.content ? (
                <Markdown text={m.content} />
              ) : (
                <div className="thinking">
                  <span />
                  <span />
                  <span />
                  <small>{latestActivity?.label ?? "Generating…"}</small>
                </div>
              )}
              {(!busy || index < active.messages.length - 1) && (
                <div className="message-actions">
                  <button
                    title="Copy message"
                    onClick={() =>
                      void navigator.clipboard.writeText(m.content)
                    }
                  >
                    <Copy size={13} />
                  </button>
                  {m.role === "user" && (
                    <button
                      disabled={busy}
                      title="Edit and resend from this prompt"
                      onClick={() => {
                        setPrompt(m.content);
                        setAttached(m.attachments ?? []);
                        updateConversation(active.id, (c) => ({
                          ...c,
                          messages: c.messages.slice(0, index),
                        }));
                        composer.current?.focus();
                      }}
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                  {m.role === "assistant" &&
                    index === active.messages.length - 1 && (
                      <button
                        disabled={busy}
                        title="Regenerate response"
                        onClick={() => {
                          const previous = active.messages[index - 1];
                          if (previous?.role === "user")
                            void send(
                              previous.content,
                              active.messages.slice(0, index - 1),
                              previous.attachments ?? [],
                            );
                        }}
                      >
                        <RotateCcw size={13} />
                      </button>
                    )}
                </div>
              )}
            </div>
          </article>
        ))}
        {approvals.length > 0 && (
          <div className="approvals">
            <div className="approval-actions">
              <span>
                {approvals.length} pending approval
                {approvals.length === 1 ? "" : "s"}
              </span>
              <button onClick={() => approvals.forEach((a) => a.answer(false))}>
                Reject all
              </button>
              <button
                className="primary"
                onClick={() => approvals.forEach((a) => a.answer(true))}
              >
                Accept all
              </button>
            </div>
            {approvals.map((a) => (
              <ApprovalCard
                key={a.pending.id}
                pending={a.pending}
                decide={a.answer}
                busy={false}
              />
            ))}
          </div>
        )}
        <div ref={bottom} />
      </div>
    </>
  );
}
