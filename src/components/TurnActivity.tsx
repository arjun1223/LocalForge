import { Check, ChevronRight, Circle, X } from "lucide-react";
import type { Activity } from "../types";

export function TurnActivity({
  activity,
  working,
}: {
  activity: Activity[];
  working: boolean;
}) {
  const actions = activity.filter(
    (item) =>
      !item.label.startsWith("Model turn ") &&
      !item.label.startsWith("Completed model turn "),
  );
  if (!actions.length) return null;
  const problems = actions.filter((item) => item.status === "error").length;
  return (
    <details className={`turn-activity ${working ? "working" : ""}`}>
      <summary>
        <ChevronRight size={12} />
        <span>
          {working
            ? "Working in your project"
            : `${actions.length} action${actions.length === 1 ? "" : "s"}`}
        </span>
        {problems > 0 && (
          <small>
            {problems} reported problem{problems === 1 ? "" : "s"}
          </small>
        )}
      </summary>
      <div>
        {actions.map((item) => (
          <details key={item.id} className={`turn-action ${item.status}`}>
            <summary>
              {item.status === "running" ? (
                <Circle className="spin" size={12} />
              ) : item.status === "success" ? (
                <Check size={12} />
              ) : (
                <X size={12} />
              )}
              <span>{item.label.replaceAll("_", " ")}</span>
              <small>
                {item.status === "running" ? "In progress" : item.status}
              </small>
            </summary>
            {item.detail && <pre>{item.detail.slice(-6000)}</pre>}
          </details>
        ))}
      </div>
    </details>
  );
}
