# Verification — 2026-10-16 (America/Detroit)

This report distinguishes automated checks, real model API checks, and interactive desktop checks. No test result below is inferred from the model's own claims.

## Build and automated checks

- `npm test`: **9 passed**. NDJSON chunk assembly, capability uncertainty, strict tool schemas, fallback parsing, shell-free command tokenization, context tool/result pairing, iterative failed-build/retry orchestration, malformed-protocol rejection, cancellation and iteration limits.
- Native `cargo test --manifest-path src-tauri/Cargo.toml`: **9 passed**. Canonical workspace restrictions, symlink/dangling symlink rejection, binary rejection, stale proposal detection, real creation/edit/deletion, command allowlist, loopback endpoint policy, actual child-process cancellation, and an actual failed `node --check` → approved edit → successful `node --check` recovery.
- `npm run build`: **passed**, including TypeScript strict checks and Vite production compilation.
- `npm run bundle`: **passed**, producing the optimized Apple Silicon `LocalForge.app` (approximately 16.4 MiB).
- Dependency audit after installation/update: **0 known vulnerabilities** reported. Third-party bundler warnings about Zod purity annotations and a large local JavaScript bundle do not fail the build.

## Real local model checks

The installed model was dynamically discovered as `qwen3.5:9b`. This name is a test observation, not an application constant or a supported-model allowlist.

- `/api/tags`: detected the installed model.
- `/api/show`: returned completion, tools, vision, and thinking metadata. Structured output remains Unknown because no reliable model capability flag was provided.
- `npm run verify:ollama`: streamed a real `LOCAL_OK` reply and received a real structured `list_directory` native tool call.
- `npm run verify:fallback`: without native tools or a forced JSON-format option, received the required strict JSON `list_directory` fallback request.

## Interactive macOS desktop checks

Using the actual packaged Tauri application:

1. The model selector populated from Ollama. A real chat returned `DESKTOP_OK` through the Rust HTTP bridge and streamed response parser.
2. The native folder picker opened the disposable `tests/fixtures/broken-project` directory. The explorer listed actual files.
3. Submitted a real agent request to inspect and fix the failing build.
4. The agent called `list_directory`, read `package.json`, `src.js`, and `test.cjs`, and requested approval to run `npm run build`.
5. Accepted that command. The terminal displayed **exit 1**, the real `SyntaxError: Unexpected token ';'`, and its file/line location.
6. The agent proposed changing `const result = ;` to `const result = null;`. The approval card showed the real one-line before/after diff. A separate filesystem read confirmed the file was still unchanged while approval was pending.
7. Accepted the edit. Only then was the file changed.
8. The agent requested approval to rebuild. After acceptance, the terminal displayed **exit 0**.
9. The agent requested approval to run `npm run test`. After acceptance, the terminal displayed **exit 0**, **1 test passed**, **0 failed**.
10. The agent finished with a summary consistent with those actual outputs. The Diff panel displayed the approved one-line change. The non-Git fixture initially produced Git inspection errors, which were displayed and returned to the agent rather than hidden.
11. Explorer text search found `const result` at `src.js:2`, and the highlighted code viewer showed the actual edited file with line numbers.
12. Quit the debug app and launched the optimized release app. Both conversations, selected model, active workspace, final answer, activity metadata and approved file diff restored from Application Support.
13. Changed the configured endpoint temporarily to unused loopback port 11435. The app displayed **Ollama is not currently available**, Offline, and Retry Connection. Restored port 11434 and verified reconnection and model discovery.
14. Started a long chat generation, clicked Stop, and observed **Stopped by user** with controls enabled again.
15. Submitted a harmless manual command, then clicked Reject Command. The terminal displayed **Command rejected by user**, no command output, and no execution duration.
16. Reopened the final release after the last native safety changes. Git status returned the selected subtree and the new-repository branch status. Git diff returned separate unstaged/staged sections without failing on the absence of a first commit. The approved historical diff remained available in the Diff tab.

The repair fixture is left in its successfully repaired state as evidence of the live run. To repeat the scenario, run `npm run fixture:reset` to reset **only** that disposable fixture.

## Coverage limits and product boundaries

Only one model was installed. Live switching among multiple models, a live empty-model server, vision inputs, and arbitrary third-party model reliability were not verified. Discovery/selection handles arbitrary model IDs; runtime metadata and tool validation govern behavior. Deterministic TypeScript agent tests use test doubles and do not by themselves establish real model performance; the desktop workflow above does.

Approved terminal commands execute as the macOS user, without an OS sandbox, and can affect paths beyond the workspace. The approval screen states this. Filesystem tools independently enforce workspace boundaries. External filesystem tool access is denied in this version rather than offering a broader-access grant. The native terminal is an output/command panel rather than an interactive PTY. Vision metadata is displayed, but image attachments are not implemented. Context uses a conservative character estimate rather than a model-specific tokenizer. Local history is plaintext. The locally built app is not Apple-notarized. These are documented in README.md.

## Context-budget fix — 2026-10-16

A real user task failed after a model turn requested three component-file reads. The old context packer kept that entire newest group, including optional reasoning and large results, then threw when it exceeded a fixed threshold. Native tool schemas were also missing from the estimate.

The packer now reserves space for native schemas, pins the actual task, preserves complete tool-call arguments and result pairing, removes optional reasoning when necessary, and fits oversized result batches using explicitly marked head/tail excerpts. File paths and command outcomes survive trimming. Oversized original prompts and irreducible call arguments still produce actionable errors. Packing does not mutate saved messages or tool results.

- TypeScript/unit checks: **17 tests passed**, including regression cases at context sizes 8192 and 9216, native schema accounting, batched reads, command errors, fallback tool messages, retained task/history, and an orchestrator continuation after large reads.
- Strict TypeScript and the optimized Tauri macOS build: **passed**.
- `npm run verify:context`: **passed with the actual local model**. It read Sidebar.tsx, Topbar.tsx and MessageList.tsx in one batch and continued with compacted context at an 8192-token setting. Request estimates stayed at or below 9600 prompt characters after output/template reserves and schema accounting. The model returned CONTEXT_OK. This check establishes context continuation, not the correctness of a general code review. The read-only test harness rejected a model request for terminal execution; no commands or edits were executed by the agent.
- The final UI could not be relaunched during this check because macOS was locked. The rebuilt bundle is at the same release path. Quit and reopen LocalForge to load it; the failed conversation can then be regenerated. Existing local history/settings were not modified by the headless regression check.

## Reliability and attachment pass — 2026-10-18

Current automated coverage: **36 TypeScript tests** and **11 native Rust tests** passed. Strict TypeScript checks and optimized macOS packaging passed. The native tests include real failed-build/edit/rebuild recovery, stale approvals, cancellation, workspace boundaries, stale workspace request rejection, and reading actual user-selected attachment fixtures. Frontend regressions cover native and structured-fallback large writes followed by a real Node syntax check, rejection/error preservation, incomplete exchange rejection, attachment decoding/capacity/excerpts/retry serialization, and seconds/minutes/hours/days formatting.

The new `npm run verify:completed-edit` passed with the dynamically discovered local `qwen3.5:9b`. It wrote and syntax-checked **117,030 characters** in a disposable temporary directory, packed the actual successful result at an **8192-token context setting**, and received `source.mjs`, `Applied: true`, and `EDIT_CONTEXT_OK` from the real model. Original source and history remained byte-for-byte intact. The full executable write payload is never shortened before approval/execution; only completed model-request history can become a labeled summary.

Interactive release-app checks performed this pass:

- Native attachment picker selected a real temporary UTF-8 document. Its composer preview contained the actual verification text. The local model returned the exact code `FORGE_FILE_7429` from that document.
- The timer advanced through seconds into minutes, froze at `Worked for 1 min 40 s`, and retained that duration after quit/relaunch.
- Switching between the LocalForge workspace and the repair fixture refreshed the explorer to each workspace's actual files. Project search found the newly added source function, opened the actual source preview, attached it, and removed the attachment.
- A real packaged Code Agent request read `package.json`, returned `localforge` / `0.1.0`, completed in 47 seconds, and displayed a collapsible `1 action` log with `read file success`.
- A newly sent source attachment appeared as an expandable file card instead of flooding the message. Escape cancelled generation, restored enabled controls, and froze the response timer at `Stopped after 4 s`.
- Manual `node --version` displayed a real approval card, ran only after accepting that specific harmless test command, and returned `v24.14.0`, exit 0. Running this command did not restart the previous response timer.
- Both windowed and full-screen layouts were visually inspected. Existing conversations, selected model and workspace restored after relaunch.

Finder imports now use Tauri native drag/drop events and the same bounded Rust attachment reader as the verified picker; browser File drops remain a fallback. Native drop interception is enabled in the final build. Drop decoding and invalid-file behavior are covered by automated tests. The computer-use tool did not reliably complete a cross-window release, so automated cross-window release is not claimed. The user subsequently confirmed the physical Finder drop with a screenshot showing the imported text-file chip (see below). The native picker is verified end-to-end. Images/PDFs and arbitrary desktop computer control remain unimplemented; unsupported attachments show an explicit error.

The previously accepted model-generated stylesheet omitted the desktop layout/theme rules. The functional desktop stylesheet was restored with the user's authorization, with timer/attachment/activity styling added. Both exact stylesheet versions are retained locally in the ignored `.localforge-recovery/` folder. No original conversations or settings were manually rewritten.

Final packaging includes clearer terminal states for waiting for approval, rejection without execution, stopped commands and failed commands; manual commands no longer use a model-generation progress label. macOS locked during the last relaunch check, so the final bundle was built successfully but its last small UI refinements were not re-opened after that lock. Unlock, quit LocalForge and open the release bundle to load them.

After the user unlocked macOS, the latest native-drop build was successfully relaunched. Existing messages, the expandable source attachment, connection/model/workspace selection, and fixed stopped/completed response durations restored correctly. The 36 frontend and 11 native tests and optimized macOS build passed again after restoring native Finder-drop imports. The automated gesture remained inconclusive; the subsequent user-supplied screenshot confirmed the manual Finder drop.

### Physical Finder drop confirmed

The user supplied a screenshot taken on 2026-10-18 at 3:38:35 PM showing `localforge-attachment-check.txt` as a removable attachment chip above the composer, labeled **53 chars**. This confirms the human Finder-drop test imported the real fixture in the packaged native-drop build. This is user-provided visual verification, distinct from an automated mouse-gesture pass. The native picker-to-model content check was independently verified earlier in this report.
