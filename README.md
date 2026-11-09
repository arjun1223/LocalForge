# LocalForge

A real macOS desktop application for chatting with local Ollama models and running an approval-based coding agent. React + strict TypeScript + Tauri 2 + Rust. Apple Silicon supported. No cloud backend, accounts, telemetry, or model-specific source code.

## Run

Open `src-tauri/target/debug/bundle/macos/LocalForge.app` after a debug package, or `src-tauri/target/release/bundle/macos/LocalForge.app` after a release package.

```sh
cd LocalForge
npm install
npm run desktop          # native development app
npm run bundle           # release macOS .app
```

Rust is required to compile. `scripts/desktop.sh` automatically uses the repository-local `.toolchain` if present, otherwise your normal Cargo installation. Xcode Command Line Tools and Node 22+ are sufficient for this project. Development dependencies are needed only for compilation, not to run the packaged app. The app is locally built and ad-hoc signed, not distributed with an Apple Developer certificate or notarization.

Start the installed Ollama app (or `ollama serve` bound to loopback). LocalForge defaults to `http://localhost:11434`. It discovers models from `/api/tags`, gets capabilities from `/api/show`, and streams `/api/chat`. Install another model in Ollama and click Refresh; no source changes are needed. Missing models and an unavailable server produce actionable UI errors.

## Use

- **Chat:** select an installed model, type a prompt, explicitly submit. Chat does not have workspace file or terminal tools even when a project is selected. The mode notice offers **Use Code Agent** for hands-on project work; switching mode does not submit a prompt. Streaming, stop, Markdown/code highlighting, code copy, edit/resend, regenerate, rename/delete history.
- **Code Agent:** open a project with the native folder picker, select Code Agent, submit a task. The agent lists/searches/reads files, calls registered tools, proposes targeted changes, runs approved builds/tests, observes failures and iterates. Default limit: 25 model turns.
- **Approvals:** review the real before/after diff before applying a file change. Accept/reject individual proposals or all currently visible proposals. Accept All never authorizes future proposals. Default auto apply: off. Deletes always require approval.
- **Terminal:** open Output → Terminal and enter a program with arguments, e.g. `npm run build`. Arguments support quotes; shell operators and interpolation are not evaluated. Commands may also come from the agent, with the same native policy. Output shows cwd, stdout/stderr, exit code and duration. Esc/Stop cancels generation and running command process groups. Commands time out after 120 seconds by default (agent configurable up to 600).
- **Files:** click the paperclip for a native multi-file picker, drop text/code files from Finder onto the window, or drag an explorer file into the composer. Preview and remove files before sending. Sent files appear as expandable cards; long contents are explicitly excerpted to fit the selected context budget. Attachments are sent only with explicit submission.
- **Explorer:** expand folders, inspect highlighted source with line numbers, search project text, attach an opened file to the next prompt. Switching projects resets the tree, search and preview.
- **Progress:** a live timer beside each response counts seconds, minutes, hours and days. Final elapsed time is saved with completed, stopped or failed responses. Agent actions appear in a collapsible log beside the answer; detailed terminal output remains in Output.
- **Git:** Output → Git → status/diff/log. Read-only inspection; mutations are terminal commands requiring approval. Applied file changes are collected in Output → Diff even in a non-Git project.
- **Settings:** system/light/dark, local endpoint, defaults, generation budget, iterations, permission settings and per-model tool strategy/parameter/system prompt overrides.
- **Shortcuts:** Cmd+N new chat, Cmd+K focus prompt, Cmd+, settings, Enter or Cmd+Enter send, Shift+Enter newline, Esc stop/close settings.

## Architecture

```
React UI / conversation state
  ├─ providers/provider.ts      LocalModelProvider contract
  ├─ providers/ollama.ts        discovery, metadata, NDJSON streaming/cancellation
  ├─ agent/orchestrator.ts      bounded iterative native/fallback agent loop
  ├─ tools/registry.ts          strict schemas and structured fallback protocol
  ├─ context/context.ts        bounded recent context, tool-pair preservation
  ├─ storage/store.ts          serialized debounced local persistence
  └─ Tauri IPC
       ├─ lib.rs               approvals, local API bridge, persistence
       ├─ workspace.rs         canonical boundaries, text I/O, ignored search
       └─ process.rs           argv execution, bounded output, timeout/cancellation
```

Only Ollama is implemented. `LocalModelProvider` permits another local runtime without changing orchestration. Capabilities without reliable metadata display Unknown. Model identity never determines behavior. Automatic tool strategy uses native tools only when runtime metadata says they are supported; otherwise it tries the strict JSON fallback. Two malformed fallback responses disable Agent Mode for that model for the session; chat still works. Refresh or changing strategy allows retry.

Fallback format:

```json
{"type":"tool_call","tool":"read_file","arguments":{"path":"src/App.tsx"}}
```

A final response is `{"type":"final","content":"..."}`. Arbitrary prose is never executed. Native and fallback tools both pass through strict frontend schemas **and** native validation.

## Safety boundaries and practical limits

- Filesystem tools accept relative paths inside the active canonical workspace only. Parent traversal, absolute paths and symlinks (including dangling links) are rejected. Agent access outside that workspace is denied; choose another workspace explicitly using the folder picker. Files explicitly selected with the attachment picker or dropped by the user can be included as read-only text context without granting the agent access to their directory. The app never interprets model text as an app API request.
- Pending proposals are stored natively, tied to the workspace, and applied only by proposal ID. Content is compared again at apply time; external changes invalidate the proposal. Writes use an atomic same-directory rename and preserve existing permissions. Parent directories must already exist. Deleting directories is not supported. Symlink changes by an adversarial concurrent process are not a hardened OS sandbox; use trusted local workspaces.
- Native file writes/edits to `.git` are blocked. Terminal programs run **with your macOS account, not in an OS sandbox**. They can invoke project scripts, access network, and affect files outside the workspace. Approval UI explicitly states this. Every program except a narrow read-only Git allowlist requires approval even when Require Terminal Approval is off. `sudo` and system administration tools are blocked. No automatic Git push/reset/history rewriting. Use trusted commands and inspect their arguments.
- Text reads are limited to 512 KiB; binaries/non-UTF-8 files are rejected. Explorer/search respect `.gitignore` where available and skip `.git`, `node_modules`, build/dist/target and toolchain directories. Search caps: 20,000 visited entries / 150 matches. Terminal retains 64 KB per output stream. Attachments: up to eight UTF-8 text/code files, 512 KiB each, from the workspace or explicitly selected files. Images, PDFs, folders and binary files produce a clear error. The outgoing prompt receives a bounded, marked excerpt when necessary; the source file is never changed. The first version does not attach image inputs even when vision metadata is present.
- Context is conservatively estimated from characters; tool output is trimmed and older turns may be omitted. Native tool-call/result pairs stay together. Native tool schemas count toward the budget. Oversized result batches become marked excerpts. When the arguments of a fully returned call are themselves too large, that exchange becomes an explicit historical completion record with its tool, path and actual applied/rejected/error outcome. Executable arguments and approved changes remain intact; incomplete exchanges are never labeled completed. Exact source can be requested with targeted line ranges. Files are inspected on demand; no repository indexing service. Agent success depends on the selected model’s instruction/tool reliability; no application can guarantee every model will complete every task.
- Local inference accepts loopback hosts only, disables HTTP proxies and redirects, and has a restrictive webview CSP. Remote images in Markdown are suppressed. Approved terminal commands may independently access network. Markdown does not render raw HTML.
- Conversations/settings live in `~/Library/Application Support/dev.localforge.desktop/state.json`. Snapshots are written serially through atomic rename, with a 50 MiB limit. Corrupt/unsupported existing history is preserved and automatic saves are disabled for that session. Data is plaintext local application data, not encrypted. Pending approvals are intentionally not restored after restart.
- Output → Diff tracks the initial and final approved contents during a conversation; Git shows current repository state. There is no automatic rollback/undo, embedded PTY, language server, image attachment, or cloud provider.

## Verification

```sh
npm test
npm run build
CARGO_HOME="$PWD/.toolchain/cargo" RUSTUP_HOME="$PWD/.toolchain/rustup" PATH="$PWD/.toolchain/cargo/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml
npm run verify:ollama
npm run verify:fallback
npm run verify:context
npm run verify:modes
npm run verify:completed-edit
```

The deterministic TypeScript agent tests use test doubles to exercise failure/retry/protocol handling; they are not evidence of a model solving a task. `verify:ollama` makes actual local API requests against a dynamically discovered model. Native tests exercise real temporary filesystem operations and safety behavior. `tests/fixtures/broken-project` is a disposable repair-test project. The live test repaired it; run `npm run fixture:reset` to restore its deliberate syntax error before repeating the scenario. The final live verification report is in `VERIFICATION.md`.

API references used during implementation: [Tauri IPC channels](https://v2.tauri.app/develop/calling-frontend/), [Ollama tool calling](https://docs.ollama.com/capabilities/tool-calling).
