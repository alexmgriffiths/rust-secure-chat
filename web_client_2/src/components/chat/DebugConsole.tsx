import { useEffect, useRef, useState } from "react";
import { LogEntry } from "../../types/chat";

function prettyJson(raw: string) {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

type Props = { log: LogEntry[]; onClear: () => void };

export function DebugConsole({ log, onClear }: Props) {
  const [open, setOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log, open]);

  return (
    <div className="console-drawer">
      <button className="console-bar" onClick={() => setOpen((o) => !o)}>
        <span className="console-bar-left">
          <span className="console-label">Console</span>
          {log.length > 0 && <span className="console-count">{log.length}</span>}
        </span>
        <span className="console-bar-right">
          {log.length > 0 && (
            <span
              className="console-clear"
              role="button"
              onClick={(e) => { e.stopPropagation(); onClear(); }}
            >
              Clear
            </span>
          )}
          <svg
            className={`console-chevron${open ? " console-chevron-open" : ""}`}
            width="14" height="14" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round"
          >
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </span>
      </button>
      {open && (
        <div className="console-entries">
          {log.length === 0 ? (
            <span className="console-empty">No frames yet.</span>
          ) : (
            log.map((entry) => (
              <div key={entry.id} className={`console-entry console-${entry.direction}`}>
                <span className="console-meta">
                  <span className="console-arrow">{entry.direction === "sent" ? "↑" : "↓"}</span>
                  <span className="console-time">{entry.timestamp}</span>
                </span>
                <pre className="console-body">{prettyJson(entry.content)}</pre>
              </div>
            ))
          )}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}
