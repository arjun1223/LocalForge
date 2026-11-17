import { useMemo, useState } from "react";
import {
  conversationMarkdown,
  filterConversations,
} from "../history/conversations";
import type { LocalForgeController } from "../hooks/useLocalForge";
import {
  Plus,
  MessageSquare,
  Code2,
  FolderOpen,
  Settings2,
  PanelLeftClose,
  ShieldCheck,
  Pencil,
  Trash2,
  Copy,
  Search,
  X,
} from "lucide-react";
export function Sidebar({ ui }: { ui: LocalForgeController }) {
  const {
    data,
    busy,
    setSettingsOpen,
    sidebar,
    setSidebar,
    renaming,
    setRenaming,
    mutate,
    updateConversation,
    addConversation,
    openWorkspace,
    openConversation,
  } = ui;
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const visible = useMemo(
    () => filterConversations(data.conversations, query),
    [data.conversations, query],
  );
  const active = data.conversations.find((c) => c.id === data.activeId);
  async function copyConversation() {
    if (!active) return;
    try {
      await navigator.clipboard.writeText(conversationMarkdown(active));
      setNotice("Conversation copied as Markdown.");
    } catch {
      setNotice("Could not copy the conversation.");
    }
  }
  return (
    <>
      {sidebar && (
        <aside className="sidebar">
          <div className="traffic-space" />
          <div className="brand">
            <div className="brand-mark">
              <Code2 size={21} />
            </div>
            <span>
              LocalForge<small>LOCAL AI WORKSPACE</small>
            </span>
            <button title="Collapse sidebar" onClick={() => setSidebar(false)}>
              <PanelLeftClose size={16} />
            </button>
          </div>
          <div className="new-actions">
            <button
              disabled={busy}
              className="new-chat"
              onClick={() => addConversation("chat")}
            >
              <Plus size={16} />
              New chat<kbd>⌘ N</kbd>
            </button>
            <button disabled={busy} onClick={() => addConversation("agent")}>
              <Code2 size={16} />
              New agent task
            </button>
          </div>
          <div className="sidebar-section-label">
            CONVERSATIONS
            <span>
              {query.trim()
                ? `${visible.length} / ${data.conversations.length}`
                : data.conversations.length}
            </span>
          </div>
          {!!data.conversations.length && (
            <div className="history-search">
              <Search size={14} aria-hidden="true" />
              <input
                type="search"
                aria-label="Search conversations"
                placeholder="Search conversations…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  title="Clear conversation search"
                  aria-label="Clear conversation search"
                  onClick={() => setQuery("")}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          )}
          <nav className="history" aria-label="Conversations">
            {!!data.conversations.length && !visible.length && (
              <p className="sidebar-empty">No matching conversations.</p>
            )}
            {!data.conversations.length && (
              <p className="sidebar-empty">
                Your conversations live here.
                <br />
                Always on this Mac.
              </p>
            )}
            {visible.map((c) => (
              <div
                key={c.id}
                className={`history-item ${c.id === data.activeId ? "active" : ""}`}
              >
                {c.mode === "agent" ? (
                  <Code2 size={14} />
                ) : (
                  <MessageSquare size={14} />
                )}
                {renaming === c.id ? (
                  <input
                    autoFocus
                    defaultValue={c.title}
                    onBlur={(e) => {
                      updateConversation(c.id, (v) => ({
                        ...v,
                        title: e.target.value.trim() || c.title,
                      }));
                      setRenaming("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                  />
                ) : (
                  <button
                    className="history-title"
                    disabled={busy}
                    onClick={() => void openConversation(c)}
                    title={c.title}
                  >
                    {c.title}
                  </button>
                )}
                <div className="history-actions">
                  <button
                    disabled={busy}
                    title="Rename conversation"
                    onClick={() => setRenaming(c.id)}
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    disabled={busy}
                    title="Delete conversation"
                    onClick={() => {
                      mutate((s) => ({
                        ...s,
                        conversations: s.conversations.filter(
                          (x) => x.id !== c.id,
                        ),
                        activeId: s.activeId === c.id ? undefined : s.activeId,
                      }));
                    }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
          </nav>
          <div className="sidebar-section-label">
            WORKSPACES
            <button
              disabled={busy}
              title="Open workspace"
              onClick={() => void openWorkspace()}
            >
              <Plus size={13} />
            </button>
          </div>
          <div className="workspace-history">
            {data.workspaceHistory.slice(0, 4).map((p) => (
              <button
                disabled={busy}
                title={p}
                key={p}
                onClick={() => void openWorkspace(p)}
              >
                <FolderOpen size={14} />
                <span>{p.split("/").pop()}</span>
              </button>
            ))}
            <button disabled={busy} onClick={() => void openWorkspace()}>
              <Plus size={14} />
              Open a project…
            </button>
          </div>
          <div className="sidebar-footer">
            <p role="status" className="history-copy-status">
              {notice}
            </p>
            <button
              disabled={busy || !active?.messages.length}
              onClick={() => void copyConversation()}
            >
              <Copy size={15} /> Copy chat as Markdown
            </button>
            <div className="local-note">
              <ShieldCheck size={14} />
              <span>
                Local by default<small>No cloud. No telemetry.</small>
              </span>
            </div>
            <button onClick={() => setSettingsOpen(true)}>
              <Settings2 size={15} />
              Settings<kbd>⌘ ,</kbd>
            </button>
          </div>
        </aside>
      )}
    </>
  );
}
