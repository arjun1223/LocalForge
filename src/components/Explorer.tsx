import { useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  FileCode2,
  Folder,
  FolderOpen,
  RefreshCw,
  Search,
  X,
  Copy,
} from "lucide-react";
import hljs from "highlight.js/lib/common";
import { browse, errorText, viewFile } from "../native";
import type { Entry } from "../types";
function Directory({
  path,
  workspace,
  openFile,
  revision,
}: {
  path: string;
  workspace: string;
  openFile: (path: string) => void;
  revision: number;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => {
    let active = true;
    setEntries([]);
    browse(path, workspace)
      .then((v) => {
        if (active) {
          setEntries(v.entries);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [path, workspace, revision]);
  return (
    <div className="tree">
      {error && <p className="error-text">{error}</p>}
      {entries.map((e) => (
        <div key={e.path}>
          <button
            className="tree-row"
            title={e.path}
            draggable={!e.directory}
            onDragStart={(event) => {
              if (e.directory) return;
              event.dataTransfer.effectAllowed = "copy";
              event.dataTransfer.setData(
                "application/x-localforge-file",
                JSON.stringify({ path: e.path, workspace }),
              );
            }}
            onClick={() =>
              e.directory
                ? setExpanded((old) => {
                    const next = new Set(old);
                    if (next.has(e.path)) next.delete(e.path);
                    else next.add(e.path);
                    return next;
                  })
                : openFile(e.path)
            }
          >
            {e.directory ? (
              <>
                <ChevronRight
                  className={expanded.has(e.path) ? "rotated" : ""}
                  size={12}
                />
                {expanded.has(e.path) ? (
                  <FolderOpen size={14} />
                ) : (
                  <Folder size={14} />
                )}
              </>
            ) : (
              <>
                <span className="tree-indent" />
                <FileCode2 size={14} />
              </>
            )}
            <span>{e.name}</span>
          </button>
          {e.directory && expanded.has(e.path) && (
            <Directory
              path={e.path}
              workspace={workspace}
              openFile={openFile}
              revision={revision}
            />
          )}
        </div>
      ))}
    </div>
  );
}
export function Explorer({
  workspace,
  revision,
  onError,
  search,
  onAttach,
}: {
  workspace: string;
  revision: number;
  onError: (s: string) => void;
  search: (q: string) => Promise<Record<string, unknown>>;
  onAttach: (path: string) => void;
}) {
  const [localRevision, setLocalRevision] = useState(0);
  const [file, setFile] = useState<{ path: string; text: string }>();
  const [query, setQuery] = useState("");
  const [results, setResults] =
    useState<{ path: string; line?: number; text?: string }[]>();
  useEffect(() => {
    setFile(undefined);
    setResults(undefined);
  }, [workspace]);
  const open = (path: string) => {
    viewFile(path, workspace)
      .then((text) => setFile({ path, text }))
      .catch((e) => onError(errorText(e)));
  };
  const highlighted = useMemo(
    () =>
      file
        ? hljs.highlightAuto(file.text.slice(0, 100000)).value.split("\n")
        : [],
    [file],
  );
  return (
    <aside className="explorer">
      <header className="panel-header">
        <strong>EXPLORER</strong>
        <button
          title="Refresh files"
          onClick={() => {
            setLocalRevision((n) => n + 1);
            if (file) open(file.path);
          }}
        >
          <RefreshCw size={14} />
        </button>
      </header>
      <div className="workspace-name">
        <FolderOpen size={14} />
        {workspace.split("/").pop()}
      </div>
      <form
        className="file-search"
        onSubmit={(e) => {
          e.preventDefault();
          search(query)
            .then((r) => setResults(r.matches as typeof results))
            .catch((e) => onError(errorText(e)));
        }}
      >
        <Search size={13} />
        <input
          aria-label="Search project text"
          placeholder="Find text in project…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {results ? (
          <button type="button" onClick={() => setResults(undefined)}>
            <X size={12} />
          </button>
        ) : null}
      </form>
      <div className="tree-container">
        {results ? (
          results.map((r, i) => (
            <button
              className="search-result"
              key={i}
              onClick={() => open(r.path)}
            >
              <strong>
                {r.path}:{r.line}
              </strong>
              <code>{r.text}</code>
            </button>
          ))
        ) : (
          <Directory
            path="."
            workspace={workspace}
            openFile={open}
            revision={revision + localRevision}
          />
        )}
      </div>
      {file && (
        <div className="file-preview">
          <header title={file.path}>
            <span>{file.path}</span>
            <button
              title="Attach to prompt"
              onClick={() => onAttach(file.path)}
            >
              Attach to prompt
            </button>
            <button
              title="Copy file"
              onClick={() => void navigator.clipboard.writeText(file.text)}
            >
              <Copy size={12} />
            </button>
            <button title="Close file" onClick={() => setFile(undefined)}>
              <X size={13} />
            </button>
          </header>
          <div className="source-lines">
            {highlighted.map((line, i) => (
              <div key={i}>
                <span>{i + 1}</span>
                <code dangerouslySetInnerHTML={{ __html: line || " " }} />
              </div>
            ))}
            {file.text.length > 100000 && (
              <p>Preview truncated at 100,000 characters.</p>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
