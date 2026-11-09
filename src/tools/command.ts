export function parseCommand(text: string): {
  program: string;
  args: string[];
} {
  const words: string[] = [];
  let current = "";
  let quote = "";
  let escape = false;
  let started = false;
  for (const c of text.trim()) {
    if (escape) {
      current += c;
      escape = false;
      started = true;
    } else if (c === "\\" && quote !== "'") {
      escape = true;
      started = true;
    } else if (quote) {
      if (c === quote) quote = "";
      else current += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      started = true;
    } else if (/\s/.test(c)) {
      if (started) {
        words.push(current);
        current = "";
        started = false;
      }
    } else {
      current += c;
      started = true;
    }
  }
  if (quote || escape)
    throw new Error("Unclosed quote or trailing escape in command");
  if (started) words.push(current);
  if (!words.length) throw new Error("Enter an executable and arguments");
  if (
    words.some((w) => ["|", "||", "&&", ";", ">", ">>", "<", "&"].includes(w))
  )
    throw new Error(
      "Shell operators are not supported. Run one program at a time.",
    );
  return { program: words[0], args: words.slice(1) };
}
