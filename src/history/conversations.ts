import type { Conversation } from "../types";

export function filterConversations(
  conversations: Conversation[],
  query: string,
) {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return conversations;
  return conversations.filter((conversation) => {
    const fields = [
      conversation.title,
      conversation.model,
      ...conversation.messages.flatMap((message) => [
        message.content,
        ...(message.attachments ?? []).map((file) => file.name),
      ]),
    ].map((field) => field.toLowerCase());
    return terms.every((term) => fields.some((field) => field.includes(term)));
  });
}

export function conversationMarkdown(conversation: Conversation) {
  const singleLine = (value: string) => value.replace(/\s+/g, " ").trim();
  return (
    [
      `# ${singleLine(conversation.title)}`,
      `Mode: ${conversation.mode === "agent" ? "Code Agent" : "Chat"} · Model: ${singleLine(conversation.model)}`,
      ...conversation.messages.map((message) => {
        const files = (message.attachments ?? []).map((file) =>
          singleLine(file.name),
        );
        const metadata = [
          ...(message.outcome ? [`Status: ${message.outcome}.`] : []),
          ...(files.length ? [`Attachments: ${files.join(", ")}.`] : []),
        ];
        return [
          `## ${message.role === "user" ? "You" : "LocalForge"}`,
          ...metadata,
          message.content,
        ].join("\n\n");
      }),
    ].join("\n\n") + "\n"
  );
}
