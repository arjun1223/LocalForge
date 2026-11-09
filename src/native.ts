import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import type { Entry, Pending, SavedData, Settings } from "./types";
import type { AttachmentBatch } from "./context/attachments";
export const desktop = isTauri();
export const id = () => crypto.randomUUID();
export const errorText = (e: unknown) =>
  e instanceof Error ? e.message : String(e);
export async function native<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!desktop)
    throw new Error(
      "Open LocalForge as a desktop app with npm run desktop. Native tools are unavailable in a browser.",
    );
  return invoke<T>(command, args);
}
export const cancel = (operationId: string) =>
  native<void>("cancel_operation", { id: operationId });
export const chooseWorkspace = () => native<string | null>("choose_workspace");
export const chooseAttachments = () =>
  native<AttachmentBatch>("choose_attachments");
export const readAttachments = (paths: string[]) =>
  native<AttachmentBatch>("read_attachments", { paths });
export const restoreWorkspace = (path: string) =>
  native<string>("restore_workspace", { path });
export const browse = (path = ".", expectedWorkspace?: string) =>
  native<{ entries: Entry[] }>("browse", { path, expectedWorkspace });
export const viewFile = (path: string, expectedWorkspace?: string) =>
  native<string>("view_file", { path, expectedWorkspace });
export const loadData = () => native<SavedData | null>("load_data");
export const saveData = (data: SavedData) =>
  native<void>("save_data", { data });
export const configurePolicy = (s: Settings) =>
  native<void>("configure_policy", {
    autoApply: s.autoApply,
    terminalApproval: s.terminalApproval,
  });
export type ToolResult = Record<string, unknown> & { approval?: Pending };
export async function toolInvoke(
  name: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
  onOutput?: (stream: string, text: string) => void,
  expectedWorkspace?: string,
): Promise<ToolResult> {
  return operation(
    "execute_tool",
    { name, args, expectedWorkspace },
    signal,
    onOutput,
  );
}
export async function approvalInvoke(
  proposalId: string,
  accept: boolean,
  signal: AbortSignal,
  onOutput?: (stream: string, text: string) => void,
): Promise<ToolResult> {
  return operation(
    "resolve_approval",
    { proposalId, accept },
    signal,
    onOutput,
  );
}
async function operation(
  command: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
  onOutput?: (stream: string, text: string) => void,
): Promise<ToolResult> {
  signal.throwIfAborted();
  const operationId = id();
  const channel = new Channel<{ stream: string; text: string }>();
  channel.onmessage = (e) => onOutput?.(e.stream, e.text);
  const stop = () => {
    void cancel(operationId).catch(() => {});
  };
  signal.addEventListener("abort", stop, { once: true });
  try {
    return await native<ToolResult>(command, {
      ...args,
      operationId,
      onOutput: channel,
    });
  } finally {
    signal.removeEventListener("abort", stop);
  }
}
