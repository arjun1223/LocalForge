import { useEffect, useState } from "react";
import type { Message } from "../types";
export function formatDuration(milliseconds: number) {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(total / 86400),
    hours = Math.floor(total / 3600) % 24,
    minutes = Math.floor(total / 60) % 60,
    seconds = total % 60;
  return [
    days ? `${days} d` : "",
    days || hours ? `${hours} h` : "",
    days || hours || minutes ? `${minutes} min` : "",
    `${seconds} s`,
  ]
    .filter(Boolean)
    .join(" ");
}
export function ResponseTimer({
  message,
  working,
}: {
  message: Message;
  working: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!working) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [working, message.id]);
  if (!working && message.elapsedMs === undefined) return null;
  const duration = working
    ? Math.max(0, now - message.createdAt)
    : message.elapsedMs!;
  const label = working
    ? "Working for"
    : message.outcome === "stopped"
      ? "Stopped after"
      : message.outcome === "failed"
        ? "Failed after"
        : "Worked for";
  return (
    <small
      className={`response-timer ${working ? "running" : ""}`}
      aria-label={`${label} ${formatDuration(duration)}`}
    >
      <span aria-hidden="true">◷</span> {label} {formatDuration(duration)}
    </small>
  );
}
