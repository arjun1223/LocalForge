import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  defaults,
  type Activity,
  type Conversation,
  type Message,
  type Mode,
  type Model,
  type Pending,
  type SavedData,
  type TerminalRecord,
} from "../types";
import {
  approvalInvoke,
  chooseAttachments,
  readAttachments,
  viewFile,
  chooseWorkspace,
  configurePolicy,
  desktop,
  errorText,
  id,
  native,
  restoreWorkspace,
  toolInvoke,
} from "../native";
import { OllamaProvider } from "../providers/ollama";
import { runAgent, AgentUnsupportedError } from "../agent/orchestrator";
import { chatMessages } from "../context/chat";
import {
  prepareAttachments,
  renderAttachments,
  mergeAttachments,
  droppedAttachments,
  type Attachment,
  type AttachmentBatch,
} from "../context/attachments";
import { contextBudget } from "../context/context";
import {
  generationSettings,
  hydrate,
  newConversation,
  persist,
} from "../storage/store";
import { parseCommand } from "../tools/command";
import type { OutputTab } from "../types";
type ApprovalWait = { pending: Pending; answer: (yes: boolean) => void };
const empty: SavedData = {
  version: 1,
  settings: defaults,
  conversations: [],
  workspaceHistory: [],
};
export function useLocalForge() {
  const [data, setData] = useState<SavedData>(empty);
  const dataRef = useRef(data);
  dataRef.current = data;
  const [ready, setReady] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState("");
  const [connection, setConnection] = useState<
    "connecting" | "online" | "offline"
  >("connecting");
  const [connectionError, setConnectionError] = useState("");
  const [workspace, setWorkspace] = useState<string>();
  const [mode, setMode] = useState<Mode>("chat");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [workingMessageId, setWorkingMessageId] = useState<string>();
  const busyRef = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [explorer, setExplorer] = useState(true);
  const [outputOpen, setOutputOpen] = useState(false);
  const [outputTab, setOutputTab] = useState<OutputTab>("activity");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [approvals, setApprovals] = useState<ApprovalWait[]>([]);
  const [records, setRecords] = useState<TerminalRecord[]>([]);
  const [git, setGit] = useState("");
  const [renaming, setRenaming] = useState("");
  const [unsupported, setUnsupported] = useState<Set<string>>(new Set());
  const [attached, setAttached] = useState<Attachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  const attachmentEpoch = useRef(0);
  const attachmentLoading = useRef(false);
  function clearAttachments() {
    attachmentEpoch.current++;
    setAttached([]);
  }
  const controller = useRef<AbortController | undefined>(undefined);
  const composer = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const discovery = useRef(0);
  const provider = useMemo(
    () => new OllamaProvider(data.settings.ollamaUrl),
    [data.settings.ollamaUrl],
  );
  const active = data.conversations.find((c) => c.id === data.activeId);
  const selected = models.find((m) => m.id === model);
  const settings = data.settings;
  const mutate = useCallback((fn: (s: SavedData) => SavedData) => {
    setData((s) => {
      const next = fn(s);
      dataRef.current = next;
      return next;
    });
  }, []);
  const updateConversation = useCallback(
    (cid: string, fn: (c: Conversation) => Conversation) => {
      mutate((s) => ({
        ...s,
        conversations: s.conversations.map((c) =>
          c.id === cid ? { ...fn(c), updatedAt: Date.now() } : c,
        ),
      }));
    },
    [mutate],
  );
  useEffect(() => {
    let alive = true;
    hydrate()
      .then(async (saved) => {
        if (!alive) return;
        setData(saved);
        dataRef.current = saved;
        setModel(saved.settings.defaultModel);
        setMode(saved.settings.defaultMode);
        const c = saved.conversations.find((c) => c.id === saved.activeId);
        if (c) {
          setMode(c.mode);
          setModel(c.model);
          if (c.workspace) {
            try {
              setWorkspace(await restoreWorkspace(c.workspace));
            } catch (e) {
              setError(errorText(e));
            }
          }
        }
        setReady(true);
      })
      .catch((e) => {
        if (alive) {
          setStorageFailed(true);
          setError(errorText(e));
          setReady(true);
        }
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
  }, [settings.theme]);
  useEffect(() => {
    if (!ready || storageFailed || !desktop) return;
    const timer = setTimeout(() => {
      void persist(data).catch((e) =>
        setError(`Could not save local history: ${errorText(e)}`),
      );
    }, 650);
    return () => clearTimeout(timer);
  }, [data, ready, storageFailed]);
  useEffect(() => {
    if (ready && desktop)
      void configurePolicy(settings).catch((e) => setError(errorText(e)));
  }, [settings.autoApply, settings.terminalApproval, ready]);
  useEffect(() => {
    if (follow.current)
      bottom.current?.scrollIntoView({ behavior: busy ? "instant" : "smooth" });
  }, [active?.messages, approvals.length]);
  const refreshModels = useCallback(async () => {
    const request = ++discovery.current;
    setConnection("connecting");
    setConnectionError("");
    try {
      const found = await provider.listModels();
      if (request !== discovery.current) return;
      setModels(found);
      setConnection("online");
      setUnsupported(new Set());
      setModel((old) =>
        found.some((m) => m.id === old)
          ? old
          : found.some((m) => m.id === dataRef.current.settings.defaultModel)
            ? dataRef.current.settings.defaultModel
            : (found.find((m) => m.capabilities.chat === true)?.id ??
              found[0]?.id ??
              ""),
      );
    } catch (e) {
      if (request !== discovery.current) return;
      setConnection("offline");
      setConnectionError(errorText(e));
      setModels([]);
    }
  }, [provider]);
  useEffect(() => {
    if (ready) void refreshModels();
    return () => {
      discovery.current++;
    };
  }, [ready, refreshModels]);
  useEffect(() => {
    if (!model || connection !== "online") return;
    let alive = true;
    provider
      .getModelInfo(model)
      .then((info) => {
        if (alive)
          setModels((ms) =>
            ms.map((m) => (m.id === info.id ? { ...m, ...info } : m)),
          );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [provider, model, connection]);
  function addConversation(nextMode: Mode) {
    if (busyRef.current) return;
    const c = newConversation(nextMode, model, workspace);
    mutate((s) => ({
      ...s,
      activeId: c.id,
      conversations: [c, ...s.conversations],
    }));
    setMode(nextMode);
    setPrompt("");
    clearAttachments();
    setError("");
    follow.current = true;
    composer.current?.focus();
  }
  function switchMode(nextMode: Mode) {
    if (busyRef.current) return;
    setMode(nextMode);
    if (active)
      updateConversation(active.id, (conversation) => ({
        ...conversation,
        mode: nextMode,
        workspace,
      }));
    setError("");
    composer.current?.focus();
  }
  const stop = useCallback(() => {
    controller.current?.abort();
    provider.cancelGeneration();
  }, [provider]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        addConversation("chat");
      } else if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        composer.current?.focus();
      } else if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      } else if (e.key === "Escape") {
        if (settingsOpen) setSettingsOpen(false);
        else stop();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  async function openWorkspace(path?: string) {
    if (busyRef.current) return;
    try {
      const p = path ? await restoreWorkspace(path) : await chooseWorkspace();
      if (!p) return;
      setWorkspace(p);
      clearAttachments();
      setGit("");
      setRevision((v) => v + 1);
      mutate((s) => ({
        ...s,
        workspaceHistory: [
          p,
          ...s.workspaceHistory.filter((x) => x !== p),
        ].slice(0, 12),
      }));
      if (active && !active.messages.length)
        updateConversation(active.id, (c) => ({ ...c, workspace: p }));
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function openConversation(c: Conversation) {
    if (busyRef.current) return;
    try {
      if (c.workspace) setWorkspace(await restoreWorkspace(c.workspace));
      else {
        await native("close_workspace");
        setWorkspace(undefined);
      }
      mutate((s) => ({ ...s, activeId: c.id }));
      setRevision((value) => value + 1);
      setGit("");
      setMode(c.mode);
      setModel(c.model);
      clearAttachments();
      setError("");
      follow.current = true;
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function requestApproval(pending: Pending, signal: AbortSignal) {
    return new Promise<boolean>((resolve, reject) => {
      const abort = () => {
        setApprovals((old) => old.filter((a) => a.pending.id !== pending.id));
        void approvalInvoke(
          pending.id,
          false,
          new AbortController().signal,
        ).catch(() => {});
        reject(new DOMException("Cancelled", "AbortError"));
      };
      const answer = (yes: boolean) => {
        signal.removeEventListener("abort", abort);
        setApprovals((old) => old.filter((a) => a.pending.id !== pending.id));
        resolve(yes);
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      setApprovals((old) => [...old, { pending, answer }]);
      follow.current = true;
    });
  }
  const activity = (cid: string, item: Activity) =>
    updateConversation(cid, (c) => ({
      ...c,
      activity: c.activity.some((a) => a.id === item.id)
        ? c.activity.map((a) => (a.id === item.id ? item : a))
        : [...c.activity, item].slice(-250),
    }));
  async function execute(
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
    cid?: string,
  ) {
    signal.throwIfAborted();
    const command = name === "run_terminal_command";
    const recordId = id();
    if (command) {
      setOutputOpen(true);
      setOutputTab("terminal");
      setRecords((old) => [
        ...old.slice(-29),
        {
          id: recordId,
          command: [args.program, ...((args.args as string[]) ?? [])].join(" "),
          cwd: workspace ?? "",
          stdout: "",
          stderr: "",
          running: true,
        },
      ]);
    }
    const onOutput = (stream: string, text: string) => {
      if (command)
        setRecords((old) =>
          old.map((r) =>
            r.id === recordId
              ? {
                  ...r,
                  [stream]: (
                    (stream === "stdout" ? r.stdout : r.stderr) + text
                  ).slice(-64000),
                }
              : r,
          ),
        );
    };
    try {
      let result = await toolInvoke(name, args, signal, onOutput, workspace);
      if (result.approval) {
        if (command)
          setRecords((records) =>
            records.map((record) =>
              record.id === recordId ? { ...record, waiting: true } : record,
            ),
          );
        const yes = await requestApproval(result.approval, signal);
        signal.throwIfAborted();
        if (command)
          setRecords((records) =>
            records.map((record) =>
              record.id === recordId ? { ...record, waiting: false } : record,
            ),
          );
        result = await approvalInvoke(
          result.approval.id,
          yes,
          signal,
          onOutput,
        );
      }
      if (command)
        setRecords((old) =>
          old.map((r) =>
            r.id === recordId
              ? {
                  ...r,
                  running: false,
                  waiting: false,
                  outcome: result.rejected
                    ? "rejected"
                    : result.stopped
                      ? "stopped"
                      : undefined,
                  stdout:
                    typeof result.stdout === "string" ? result.stdout : "",
                  stderr:
                    typeof result.stderr === "string"
                      ? result.stderr +
                        (result.stopped
                          ? "\nCommand stopped or timed out."
                          : "")
                      : result.rejected
                        ? "Command rejected by user."
                        : "",
                  exitCode: result.exit_code as number | null,
                  duration: result.duration_ms as number,
                }
              : r,
          ),
        );
      if (result.applied && typeof result.path === "string" && cid) {
        const change = {
          path: result.path,
          before: result.before as string | null,
          after: result.after as string | null,
        };
        updateConversation(cid, (c) => {
          const previous = c.changes.find((x) => x.path === change.path);
          return {
            ...c,
            changes: [
              ...c.changes.filter((x) => x.path !== change.path),
              { ...change, before: previous ? previous.before : change.before },
            ],
          };
        });
        setRevision((v) => v + 1);
      }
      return result;
    } catch (e) {
      if (command)
        setRecords((old) =>
          old.map((r) =>
            r.id === recordId
              ? {
                  ...r,
                  running: false,
                  waiting: false,
                  outcome: signal.aborted ? "stopped" : "failed",
                  stderr:
                    r.stderr +
                    `\n${signal.aborted ? "Stopped by user" : errorText(e)}`,
                }
              : r,
          ),
        );
      throw e;
    }
  }
  async function send(
    text = prompt,
    historyOverride?: Message[],
    filesOverride?: Attachment[],
  ) {
    if (busyRef.current || attachmentLoading.current || !text.trim() || !model)
      return;
    if (mode === "agent" && !workspace) {
      setError("Open a workspace before starting an agent task.");
      return;
    }
    const options = generationSettings(settings, model);
    if (
      mode === "agent" &&
      (options.toolStrategy === "chat-only" ||
        unsupported.has(`${model}:${options.toolStrategy}`))
    ) {
      setError(
        "This model is set to Chat Only or did not reliably follow the agent protocol. Choose another tool strategy in Settings or Refresh models to retry.",
      );
      return;
    }
    if (
      mode === "agent" &&
      options.toolStrategy === "native" &&
      selected?.capabilities.tools === false
    ) {
      setError(
        "This model reports no native tool support. Choose Automatic or Structured Fallback in Settings.",
      );
      return;
    }
    let c = active;
    if (!c) {
      c = newConversation(mode, model, workspace);
      mutate((s) => ({
        ...s,
        activeId: c!.id,
        conversations: [c!, ...s.conversations],
      }));
    }
    const cid = c.id;
    const history = historyOverride ?? c.messages;
    const allowance = Math.floor(
      Math.max(
        0,
        contextBudget(
          options.contextLength ?? 8192,
          options.maxTokens ?? 4096,
        ) -
          text.length * 2 -
          (options.systemPrompt?.length ?? 0) -
          6500,
      ) * 0.8,
    );
    const files = filesOverride ?? attached;
    if (files.length && allowance < files.length * 220 + 200) {
      setError(
        "This prompt leaves too little room for the attached files. Shorten the prompt or increase Context length in Settings.",
      );
      return;
    }
    const packedFiles = prepareAttachments(files, allowance);
    const user: Message = {
      id: id(),
      role: "user",
      content: text,
      ...(packedFiles.length ? { attachments: packedFiles } : {}),
      createdAt: Date.now(),
    };
    const assistant: Message = {
      id: id(),
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    };
    let outcome: Message["outcome"] = "completed";
    setWorkingMessageId(assistant.id);
    updateConversation(cid, (old) => ({
      ...old,
      model,
      mode,
      workspace,
      title: history.length
        ? old.title
        : text.trim().replace(/\s+/g, " ").slice(0, 60),
      messages: [...history, user, assistant],
    }));
    setPrompt("");
    clearAttachments();
    setError("");
    setBusy(true);
    busyRef.current = true;
    follow.current = true;
    const ctrl = new AbortController();
    controller.current = ctrl;
    const currentProvider = provider;
    const append = (chunk: string) =>
      updateConversation(cid, (old) => ({
        ...old,
        messages: old.messages.map((m) =>
          m.id === assistant.id ? { ...m, content: m.content + chunk } : m,
        ),
      }));
    try {
      await configurePolicy(settings);
      ctrl.signal.throwIfAborted();
      const messages = [...history.filter((m) => !m.error), user].map((m) => ({
        role: m.role,
        content: m.content + renderAttachments(m.attachments ?? []),
      }));
      if (mode === "agent") {
        setOutputTab("activity");
        const final = await runAgent({
          provider: currentProvider,
          model,
          options,
          messages,
          workspace: workspace!,
          maxIterations: settings.maxIterations,
          nativeTools:
            options.toolStrategy === "native" ||
            (options.toolStrategy !== "fallback" &&
              selected?.capabilities.tools === true),
          signal: ctrl.signal,
          onText: append,
          onResetText: () =>
            updateConversation(cid, (old) => ({
              ...old,
              messages: old.messages.map((m) =>
                m.id === assistant.id ? { ...m, content: "" } : m,
              ),
            })),
          onActivity: (a) => activity(cid, { ...a, messageId: assistant.id }),
          execute: (name, args) => execute(name, args, ctrl.signal, cid),
        });
        updateConversation(cid, (old) => ({
          ...old,
          messages: old.messages.map((m) =>
            m.id === assistant.id ? { ...m, content: final } : m,
          ),
        }));
      } else {
        const response = await currentProvider.streamChat(
          {
            model,
            messages: chatMessages(messages, options, workspace),
            options,
            signal: ctrl.signal,
          },
          append,
        );
        if (!response.content.trim())
          throw new Error(
            "The model finished without an answer. Try again with a shorter prompt, more output tokens, or another local model.",
          );
      }
    } catch (e) {
      outcome = ctrl.signal.aborted ? "stopped" : "failed";
      const text = ctrl.signal.aborted ? "Stopped by user." : errorText(e);
      if (e instanceof AgentUnsupportedError)
        setUnsupported(
          (old) => new Set([...old, `${model}:${options.toolStrategy}`]),
        );
      if (!ctrl.signal.aborted) setError(text);
      updateConversation(cid, (old) => ({
        ...old,
        messages: old.messages.map((m) =>
          m.id === assistant.id
            ? {
                ...m,
                content: m.content ? `${m.content}\n\n---\n${text}` : text,
                error: !ctrl.signal.aborted,
              }
            : m,
        ),
        activity: old.activity.map((a) =>
          a.status === "running" ? { ...a, status: "error", detail: text } : a,
        ),
      }));
    } finally {
      updateConversation(cid, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) =>
          message.id === assistant.id
            ? {
                ...message,
                elapsedMs: Math.max(0, Date.now() - assistant.createdAt),
                outcome,
              }
            : message,
        ),
      }));
      setWorkingMessageId(undefined);
      setBusy(false);
      busyRef.current = false;
      controller.current = undefined;
      setRevision((v) => v + 1);
      if (!storageFailed)
        void persist(dataRef.current).catch((e) => setError(errorText(e)));
    }
  }
  async function runManual(text: string) {
    if (busyRef.current || !workspace) {
      setError("Open a workspace to run terminal commands.");
      return;
    }
    const ctrl = new AbortController();
    controller.current = ctrl;
    setBusy(true);
    busyRef.current = true;
    try {
      const args = parseCommand(text);
      await execute(
        "run_terminal_command",
        { ...args, timeout_seconds: 120 },
        ctrl.signal,
        active?.id,
      );
    } catch (e) {
      if (!ctrl.signal.aborted) setError(errorText(e));
    } finally {
      setBusy(false);
      busyRef.current = false;
      controller.current = undefined;
    }
  }
  async function refreshGit(kind: string) {
    if (!workspace) {
      setError("Open a Git workspace first.");
      return;
    }
    try {
      const result = await toolInvoke(
        `git_${kind}`,
        {},
        new AbortController().signal,
        undefined,
        workspace,
      );
      setGit(String(result.stdout ?? "") + String(result.stderr ?? ""));
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function importAttachments(load: () => Promise<AttachmentBatch>) {
    if (busyRef.current || attachmentLoading.current) return;
    const epoch = attachmentEpoch.current;
    attachmentLoading.current = true;
    setAttaching(true);
    try {
      const batch = await load();
      if (epoch !== attachmentEpoch.current) return;
      const result = mergeAttachments(attached, batch.files);
      setAttached(result.files);
      const errors = [...batch.errors];
      if (result.skipped)
        errors.push(
          `Up to 8 files can be attached. Remove a file before adding more.`,
        );
      setError(errors.join("\n"));
      composer.current?.focus();
    } catch (e) {
      if (epoch === attachmentEpoch.current) setError(errorText(e));
    } finally {
      attachmentLoading.current = false;
      setAttaching(false);
    }
  }
  const attachContext = () => importAttachments(chooseAttachments);
  const attachDropped = (files: File[]) =>
    importAttachments(() => droppedAttachments(files));
  const attachDroppedPaths = (paths: string[]) =>
    importAttachments(() => readAttachments(paths));
  const attachWorkspaceFile = (path: string) =>
    importAttachments(async () => {
      if (!workspace) throw new Error("Open a project first.");
      return {
        files: [
          {
            path: `${workspace}/${path}`,
            name: path,
            content: await viewFile(path, workspace),
          },
        ],
        errors: [],
      };
    });
  const capLabel = (v: boolean | "unknown" | undefined) =>
    v === true ? "Yes" : v === false ? "No" : "Unknown";
  const latestActivity = active?.activity
    .filter((a) => a.status === "running")
    .at(-1);
  return {
    data,
    models,
    model,
    setModel,
    connection,
    connectionError,
    workspace,
    mode,
    setMode,
    switchMode,
    prompt,
    setPrompt,
    busy,
    workingMessageId,
    ready,
    settingsOpen,
    setSettingsOpen,
    sidebar,
    setSidebar,
    explorer,
    setExplorer,
    outputOpen,
    setOutputOpen,
    outputTab,
    setOutputTab,
    error,
    setError,
    revision,
    approvals,
    records,
    git,
    renaming,
    setRenaming,
    attached,
    setAttached,
    attaching,
    attachDropped,
    attachDroppedPaths,
    attachWorkspaceFile,
    composer,
    bottom,
    scroller,
    follow,
    active,
    selected,
    settings,
    mutate,
    updateConversation,
    refreshModels,
    addConversation,
    stop,
    openWorkspace,
    openConversation,
    send,
    runManual,
    refreshGit,
    attachContext,
    capLabel,
    latestActivity,
  };
}
export type LocalForgeController = ReturnType<typeof useLocalForge>;
