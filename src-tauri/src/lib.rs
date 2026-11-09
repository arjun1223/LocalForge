mod attachments;
mod process;
mod workspace;
use futures_util::StreamExt;
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{ipc::Channel, Manager, State};
use tokio_util::sync::CancellationToken;
use workspace::*;

type S = Arc<Native>;
#[tauri::command]
async fn read_attachments(paths: Vec<String>) -> Result<attachments::AttachmentBatch, String> {
    tokio::task::spawn_blocking(move || attachments::read(paths))
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn choose_attachments() -> Result<attachments::AttachmentBatch, String> {
    let files = rfd::AsyncFileDialog::new()
        .set_title("Attach text or code files")
        .pick_files()
        .await;
    let paths = files
        .unwrap_or_default()
        .into_iter()
        .map(|file| file.path().to_string_lossy().into_owned())
        .collect();
    tokio::task::spawn_blocking(move || attachments::read(paths))
        .await
        .map_err(|e| e.to_string())
}
#[derive(Default)]
struct Native {
    workspace: Mutex<Option<PathBuf>>,
    pending: Mutex<HashMap<String, Pending>>,
    jobs: Mutex<HashMap<String, CancellationToken>>,
    policy: Mutex<Policy>,
}
#[derive(Default, Clone)]
struct Policy {
    auto_apply: bool,
    terminal_approval: bool,
}
#[derive(Clone, Serialize)]
struct Pending {
    id: String,
    kind: String,
    path: Option<String>,
    before: Option<String>,
    after: Option<String>,
    command: Option<CommandArgs>,
    workspace: PathBuf,
}
impl Native {
    fn scoped_root(&self, expected: Option<&str>) -> Result<PathBuf, String> {
        let root = self.root()?;
        if expected.is_some_and(|path| Path::new(path) != root) {
            return Err("Workspace changed. Reopen the selected project before continuing.".into());
        }
        Ok(root)
    }
    fn root(&self) -> Result<PathBuf, String> {
        self.workspace
            .lock()
            .unwrap()
            .clone()
            .ok_or("Open a workspace first".into())
    }
}
fn job(n: &Native, id: &str) -> Result<CancellationToken, String> {
    if id.is_empty() || id.len() > 100 {
        return Err("Invalid operation ID".into());
    }
    let mut jobs = n.jobs.lock().unwrap();
    if jobs.contains_key(id) {
        return Err("Operation already running".into());
    }
    let token = CancellationToken::new();
    jobs.insert(id.into(), token.clone());
    Ok(token)
}
#[tauri::command]
fn cancel_operation(state: State<'_, S>, id: String) {
    if let Some(t) = state.jobs.lock().unwrap().get(&id) {
        t.cancel();
    }
}
#[tauri::command]
fn configure_policy(state: State<'_, S>, auto_apply: bool, terminal_approval: bool) {
    *state.policy.lock().unwrap() = Policy {
        auto_apply,
        terminal_approval,
    };
}
#[tauri::command]
async fn choose_workspace(state: State<'_, S>) -> Result<Option<String>, String> {
    let picked = rfd::AsyncFileDialog::new()
        .set_title("Open project workspace")
        .pick_folder()
        .await;
    if let Some(p) = picked {
        let root = p.path().canonicalize().map_err(|e| e.to_string())?;
        set_root(&state, &root)?;
        Ok(Some(root.to_string_lossy().into()))
    } else {
        Ok(None)
    }
}
fn set_root(n: &Native, root: &Path) -> Result<(), String> {
    if !root.is_dir() {
        return Err("Workspace directory is unavailable".into());
    }
    if !n.jobs.lock().unwrap().is_empty() {
        return Err("Stop active operations before switching workspace".into());
    }
    *n.workspace.lock().unwrap() = Some(root.into());
    n.pending.lock().unwrap().clear();
    Ok(())
}
#[tauri::command]
fn restore_workspace(state: State<'_, S>, path: String) -> Result<String, String> {
    let root = PathBuf::from(path)
        .canonicalize()
        .map_err(|_| "Workspace directory is unavailable")?;
    set_root(&state, &root)?;
    Ok(root.to_string_lossy().into())
}
#[tauri::command]
fn close_workspace(state: State<'_, S>) -> Result<(), String> {
    if !state.jobs.lock().unwrap().is_empty() {
        return Err("Stop active operations first".into());
    }
    *state.workspace.lock().unwrap() = None;
    state.pending.lock().unwrap().clear();
    Ok(())
}
#[tauri::command]
async fn browse(
    state: State<'_, S>,
    path: String,
    expected_workspace: Option<String>,
) -> Result<Value, String> {
    let root = state.scoped_root(expected_workspace.as_deref())?;
    tokio::task::spawn_blocking(move || list(&root, &path))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn view_file(
    state: State<'_, S>,
    path: String,
    expected_workspace: Option<String>,
) -> Result<String, String> {
    let root = state.scoped_root(expected_workspace.as_deref())?;
    tokio::task::spawn_blocking(move || read(&resolve(&root, &path, false)?))
        .await
        .map_err(|e| e.to_string())?
}

fn prepare(_n: &Native, root: &Path, name: &str, args: Value) -> Result<Pending, String> {
    let (path, before, after, command, kind) = match name {
        "create_file" | "write_file" => {
            let a: WriteArgs = parse(args)?;
            let p = resolve(root, &a.path, true)?;
            if p == root || p.components().any(|c| c.as_os_str() == ".git") {
                return Err("Cannot write Git internals or workspace root".into());
            }
            if a.content.len() > MAX_FILE as usize {
                return Err("Write exceeds 512 KiB".into());
            }
            if name == "create_file" && p.exists() {
                return Err("File already exists; use edit_file".into());
            }
            let before = if p.exists() { Some(read(&p)?) } else { None };
            (Some(a.path), before, Some(a.content), None, "WRITE")
        }
        "edit_file" => {
            let a: EditArgs = parse(args)?;
            let p = resolve(root, &a.path, false)?;
            if p.components().any(|c| c.as_os_str() == ".git") {
                return Err("Cannot edit Git internals".into());
            }
            let b = read(&p)?;
            if a.old_text.is_empty() || b.matches(&a.old_text).count() != 1 {
                return Err("old_text must match exactly one non-empty occurrence".into());
            }
            let after = b.replacen(&a.old_text, &a.new_text, 1);
            if after.len() > MAX_FILE as usize {
                return Err("Edited file exceeds 512 KiB".into());
            }
            (Some(a.path), Some(b), Some(after), None, "WRITE")
        }
        "delete_file" => {
            let a: PathArgs = parse(args)?;
            let p = resolve(root, &a.path, false)?;
            if p.components().any(|c| c.as_os_str() == ".git") {
                return Err("Cannot delete Git internals".into());
            }
            (Some(a.path), Some(read(&p)?), None, None, "DELETE")
        }
        "run_terminal_command" => {
            let a: CommandArgs = parse(args)?;
            process::validate(&a)?;
            (None, None, None, Some(a), "COMMAND")
        }
        _ => return Err("Unknown mutation tool".into()),
    };
    Ok(Pending {
        id: uuid::Uuid::new_v4().to_string(),
        kind: kind.into(),
        path,
        before,
        after,
        command,
        workspace: root.into(),
    })
}
fn apply(p: &Pending) -> Result<Value, String> {
    let path = p.path.as_ref().ok_or("No file specified")?;
    let dest = resolve(&p.workspace, path, true)?;
    let current = if dest.exists() {
        Some(read(&dest)?)
    } else {
        None
    };
    if current != p.before {
        return Err(
            "File changed since this proposal. Read the current file and propose a new edit."
                .into(),
        );
    }
    if let Some(ref content) = p.after {
        let tmp = dest.with_file_name(format!(".localforge-{}.tmp", uuid::Uuid::new_v4()));
        use std::io::Write;
        let result = (|| {
            let mut f = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&tmp)
                .map_err(|e| e.to_string())?;
            f.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
            f.sync_all().map_err(|e| e.to_string())?;
            if dest.exists() {
                let perms = fs::metadata(&dest)
                    .map_err(|e| e.to_string())?
                    .permissions();
                fs::set_permissions(&tmp, perms).map_err(|e| e.to_string())?;
            }
            fs::rename(&tmp, &dest).map_err(|e| e.to_string())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&tmp);
        }
        result?;
    } else {
        fs::remove_file(&dest).map_err(|e| e.to_string())?;
    }
    Ok(json!({"applied":true,"path":path,"operation":p.kind,"before":p.before,"after":p.after}))
}
async fn execute_pending(
    n: &Native,
    p: Pending,
    id: &str,
    channel: Option<Channel<Value>>,
) -> Result<Value, String> {
    if n.root()? != p.workspace {
        return Err("Workspace changed; proposal invalidated".into());
    }
    if let Some(ref a) = p.command {
        let token = job(n, id)?;
        let result = process::run(&p.workspace, a, token, channel).await;
        n.jobs.lock().unwrap().remove(id);
        result
    } else {
        tokio::task::spawn_blocking(move || apply(&p))
            .await
            .map_err(|e| e.to_string())?
    }
}
#[tauri::command]
async fn resolve_approval(
    state: State<'_, S>,
    proposal_id: String,
    accept: bool,
    operation_id: String,
    on_output: Channel<Value>,
) -> Result<Value, String> {
    let p = state
        .pending
        .lock()
        .unwrap()
        .remove(&proposal_id)
        .ok_or("Proposal expired or already resolved")?;
    if !accept {
        return Ok(
            json!({"rejected":true,"reason":"User rejected this action. Do not repeat it without a new request."}),
        );
    }
    execute_pending(&state, p, &operation_id, Some(on_output)).await
}
#[tauri::command]
async fn execute_tool(
    state: State<'_, S>,
    name: String,
    args: Value,
    operation_id: String,
    on_output: Channel<Value>,
    expected_workspace: Option<String>,
) -> Result<Value, String> {
    let root = state.scoped_root(expected_workspace.as_deref())?;
    if matches!(
        name.as_str(),
        "create_file" | "write_file" | "edit_file" | "delete_file" | "run_terminal_command"
    ) {
        let n = state.inner().clone();
        let r = root.clone();
        let tool = name.clone();
        let p = tokio::task::spawn_blocking(move || prepare(&n, &r, &tool, args))
            .await
            .map_err(|e| e.to_string())??;
        let policy = state.policy.lock().unwrap().clone();
        let automatic = (p.kind == "WRITE" && policy.auto_apply)
            || (p.kind == "COMMAND"
                && !policy.terminal_approval
                && p.command.as_ref().is_some_and(process::auto_safe));
        if automatic {
            return execute_pending(&state, p, &operation_id, Some(on_output)).await;
        }
        state
            .pending
            .lock()
            .unwrap()
            .insert(p.id.clone(), p.clone());
        return Ok(json!({"approval":p}));
    }
    if name.starts_with("git_") {
        let _: Empty = parse(args)?;
        let argv = match name.as_str() {
            "git_status" => vec![
                "--no-pager",
                "-c",
                "core.fsmonitor=false",
                "status",
                "--short",
                "--branch",
                "--",
                ".",
            ],
            "git_diff" => vec![
                "--no-pager",
                "-c",
                "core.fsmonitor=false",
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                "--",
                ".",
            ],
            "git_log" => vec![
                "--no-pager",
                "-c",
                "log.showSignature=false",
                "log",
                "-12",
                "--oneline",
                "--decorate",
                "--",
                ".",
            ],
            _ => return Err("Unknown Git tool".into()),
        };
        let a = CommandArgs {
            program: "git".into(),
            args: argv.into_iter().map(String::from).collect(),
            timeout_seconds: 20,
        };
        let token = job(&state, &operation_id)?;
        let mut r = process::run(&root, &a, token.clone(), Some(on_output.clone())).await;
        if name == "git_diff" {
            if let Ok(ref mut result) = r {
                if result["exit_code"] == 0 {
                    let staged = CommandArgs {
                        program: "git".into(),
                        args: vec![
                            "--no-pager".into(),
                            "-c".into(),
                            "core.fsmonitor=false".into(),
                            "diff".into(),
                            "--cached".into(),
                            "--no-ext-diff".into(),
                            "--no-textconv".into(),
                            "--".into(),
                            ".".into(),
                        ],
                        timeout_seconds: 20,
                    };
                    match process::run(&root, &staged, token, Some(on_output)).await {
                        Ok(v) => {
                            result["stdout"] = json!(format!(
                                "[Unstaged changes]\n{}\n[Staged changes]\n{}",
                                result["stdout"].as_str().unwrap_or(""),
                                v["stdout"].as_str().unwrap_or("")
                            ));
                            result["stderr"] = json!(format!(
                                "{}{}",
                                result["stderr"].as_str().unwrap_or(""),
                                v["stderr"].as_str().unwrap_or("")
                            ));
                            result["duration_ms"] = json!(
                                result["duration_ms"].as_u64().unwrap_or(0)
                                    + v["duration_ms"].as_u64().unwrap_or(0)
                            );
                            result["exit_code"] = v["exit_code"].clone();
                            result["stopped"] = v["stopped"].clone();
                        }
                        Err(e) => r = Err(e),
                    }
                }
            }
        }
        state.jobs.lock().unwrap().remove(&operation_id);
        return r;
    }
    tokio::task::spawn_blocking(move || match name.as_str() {
        "list_directory" => {
            let a: PathArgs = parse(args)?;
            list(&root, &a.path)
        }
        "read_file" => {
            let a: PathArgs = parse(args)?;
            Ok(json!({"path":a.path,"content":read(&resolve(&root,&a.path,false)?)?}))
        }
        "read_file_range" => {
            let a: RangeArgs = parse(args)?;
            if a.start == 0 || a.end < a.start || a.end - a.start > 500 {
                return Err("Use 1-based line ranges of at most 501 lines".into());
            }
            let text = read(&resolve(&root, &a.path, false)?)?;
            let content = text
                .lines()
                .enumerate()
                .skip(a.start - 1)
                .take(a.end - a.start + 1)
                .map(|(i, l)| format!("{}: {}", i + 1, l))
                .collect::<Vec<_>>()
                .join("\n");
            Ok(json!({"path":a.path,"content":content}))
        }
        "search_files" | "find_text" => {
            let a: SearchArgs = parse(args)?;
            search(&root, &a.query, name == "find_text")
        }
        _ => Err(format!("Unknown tool: {name}")),
    })
    .await
    .map_err(|e| e.to_string())?
}
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Empty {}

fn endpoint(base: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(base).map_err(|_| "Invalid Ollama URL")?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("Use HTTP or HTTPS".into());
    }
    if !matches!(
        url.host_str(),
        Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
    ) || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("This local-first version accepts loopback Ollama servers only.".into());
    }
    if url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
        return Err("Use an Ollama origin such as http://localhost:11434".into());
    }
    Ok(url)
}
#[tauri::command]
async fn ollama_request(
    state: State<'_, S>,
    base_url: String,
    route: String,
    body: Option<Value>,
    operation_id: String,
    on_chunk: Channel<Vec<u8>>,
) -> Result<Value, String> {
    if !matches!(route.as_str(), "tags" | "show" | "chat") {
        return Err("Unsupported API route".into());
    }
    let url = endpoint(&base_url)?
        .join(&format!("api/{route}"))
        .map_err(|e| e.to_string())?;
    let token = job(&state, &operation_id)?;
    let result=async {
        let client=reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none()).connect_timeout(Duration::from_secs(5)).timeout(Duration::from_secs(1800)).build().map_err(|e|e.to_string())?;
        let request=if let Some(ref b)=body{client.post(url).json(b)}else{client.get(url)};
        let res=tokio::select!{r=request.send()=>r.map_err(|e|format!("Ollama is not currently available. Check Settings and retry. ({e})"))?,_=token.cancelled()=>return Err("Cancelled".into())};
        if !res.status().is_success(){let status=res.status();let msg=res.text().await.unwrap_or_default();return Err(format!("Ollama {status}: {}",msg.chars().take(2000).collect::<String>()))}
        if body.as_ref().and_then(|b|b.get("stream")).and_then(Value::as_bool)==Some(true){
            let mut stream=res.bytes_stream();while let Some(chunk)=tokio::select!{c=stream.next()=>c,_=token.cancelled()=>return Err("Cancelled".into())}{let chunk=chunk.map_err(|e|e.to_string())?;on_chunk.send(chunk.to_vec()).map_err(|e|e.to_string())?;}
            Ok(json!({"done":true}))
        }else{tokio::select!{r=res.json::<Value>()=>r.map_err(|e|e.to_string()),_=token.cancelled()=>Err("Cancelled".into())}}
    }.await;
    state.jobs.lock().unwrap().remove(&operation_id);
    result
}
fn data_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("state.json"))
}
#[tauri::command]
fn load_data(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    let p = data_file(&app)?;
    if !p.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&p).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map(Some).map_err(|e| {
        format!(
            "Local history could not be read; the original file is preserved at {}: {e}",
            p.display()
        )
    })
}
#[tauri::command]
fn save_data(app: tauri::AppHandle, data: Value) -> Result<(), String> {
    let p = data_file(&app)?;
    let bytes = serde_json::to_vec(&data).map_err(|e| e.to_string())?;
    if bytes.len() > 50 * 1024 * 1024 {
        return Err("History exceeds 50 MiB. Export or delete old conversations.".into());
    }
    let tmp = p.with_extension("tmp");
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(tmp, p).map_err(|e| e.to_string())
}

pub fn run() {
    // Finder-launched apps inherit a minimal PATH. Include standard development locations.
    let home = std::env::var("HOME").unwrap_or_default();
    let path = std::env::var("PATH").unwrap_or_default();
    std::env::set_var(
        "PATH",
        format!("/opt/homebrew/bin:/usr/local/bin:{home}/.cargo/bin:{path}"),
    );
    tauri::Builder::default()
        .manage(Arc::new(Native {
            policy: Mutex::new(Policy {
                auto_apply: false,
                terminal_approval: true,
            }),
            ..Default::default()
        }))
        .invoke_handler(tauri::generate_handler![
            cancel_operation,
            configure_policy,
            choose_workspace,
            choose_attachments,
            read_attachments,
            restore_workspace,
            close_workspace,
            browse,
            view_file,
            execute_tool,
            resolve_approval,
            ollama_request,
            load_data,
            save_data
        ])
        .run(tauri::generate_context!())
        .expect("Could not start LocalForge");
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn real_build_failure_edit_and_recovery() {
        let r = std::env::temp_dir().join(format!("localforge-recovery-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&r).unwrap();
        let r = r.canonicalize().unwrap();
        fs::write(r.join("src.js"), "const result = ;\nconsole.log(result);\n").unwrap();
        let command = CommandArgs {
            program: "node".into(),
            args: vec!["--check".into(), "src.js".into()],
            timeout_seconds: 20,
        };
        let failed = process::run(&r, &command, CancellationToken::new(), None)
            .await
            .unwrap();
        assert_ne!(failed["exit_code"], 0);
        assert!(failed["stderr"].as_str().unwrap().contains("SyntaxError"));
        let proposal = prepare(
            &Native::default(),
            &r,
            "edit_file",
            json!({"path":"src.js","old_text":"const result = ;","new_text":"const result = 42;"}),
        )
        .unwrap();
        assert!(read(&r.join("src.js")).unwrap().contains("= ;"));
        apply(&proposal).unwrap();
        let passed = process::run(&r, &command, CancellationToken::new(), None)
            .await
            .unwrap();
        assert_eq!(passed["exit_code"], 0);
        fs::remove_dir_all(r).unwrap();
    }
    #[tokio::test]
    async fn command_cancellation() {
        let r = std::env::temp_dir().canonicalize().unwrap();
        let token = CancellationToken::new();
        let t = token.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(120)).await;
            t.cancel();
        });
        let a = CommandArgs {
            program: "node".into(),
            args: vec!["-e".into(), "setInterval(()=>{},1000)".into()],
            timeout_seconds: 10,
        };
        let result = process::run(&r, &a, token, None).await.unwrap();
        assert_eq!(result["stopped"], true);
        assert!(result["duration_ms"].as_u64().unwrap() < 5000);
    }
    #[test]
    fn rejects_stale_workspace_requests() {
        let n = Native::default();
        *n.workspace.lock().unwrap() = Some(PathBuf::from("/selected/project-a"));
        assert!(n.scoped_root(Some("/selected/project-a")).is_ok());
        assert!(n.scoped_root(Some("/selected/project-b")).is_err());
        *n.workspace.lock().unwrap() = Some(PathBuf::from("/selected/project-b"));
        assert!(n.scoped_root(Some("/selected/project-a")).is_err());
        assert!(n.scoped_root(Some("/selected/project-b")).is_ok());
    }
    #[test]
    fn local_endpoints_only() {
        assert!(endpoint("http://localhost:11434").is_ok());
        assert!(endpoint("http://127.0.0.1:11434").is_ok());
        assert!(endpoint("https://example.com").is_err());
        assert!(endpoint("http://localhost.evil.test").is_err());
        assert!(endpoint("http://user:secret@localhost:11434").is_err());
    }
    #[test]
    fn stale_edits() {
        let r = std::env::temp_dir().join(format!("localforge-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&r).unwrap();
        let r = r.canonicalize().unwrap();
        fs::write(r.join("a.txt"), "old").unwrap();
        let n = Native::default();
        let p = prepare(
            &n,
            &r,
            "edit_file",
            json!({"path":"a.txt","old_text":"old","new_text":"new"}),
        )
        .unwrap();
        fs::write(r.join("a.txt"), "external").unwrap();
        assert!(apply(&p).is_err());
        assert_eq!(read(&r.join("a.txt")).unwrap(), "external");
        fs::remove_dir_all(r).unwrap();
    }
    #[test]
    fn actual_edits() {
        let r = std::env::temp_dir().join(format!("localforge-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&r).unwrap();
        let r = r.canonicalize().unwrap();
        let n = Native::default();
        let p = prepare(
            &n,
            &r,
            "create_file",
            json!({"path":"a.txt","content":"hello"}),
        )
        .unwrap();
        assert!(!r.join("a.txt").exists());
        apply(&p).unwrap();
        assert_eq!(read(&r.join("a.txt")).unwrap(), "hello");
        let d = prepare(&n, &r, "delete_file", json!({"path":"a.txt"})).unwrap();
        apply(&d).unwrap();
        assert!(!r.join("a.txt").exists());
        fs::remove_dir_all(r).unwrap();
    }
}
