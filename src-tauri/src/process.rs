use crate::workspace::CommandArgs;
use serde_json::{json, Value};
use std::{path::Path, process::Stdio, time::Instant};
use tauri::ipc::Channel;
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
};
use tokio_util::sync::CancellationToken;

pub fn validate(a: &CommandArgs) -> Result<(), String> {
    if a.program.is_empty()
        || a.program.len() > 200
        || a.program.contains('/')
        || a.program.contains('\\')
        || a.program.chars().any(char::is_whitespace)
        || !a
            .program
            .chars()
            .all(|c| c.is_alphanumeric() || "-_.".contains(c))
    {
        return Err("Program must be a simple executable name. Supply arguments separately; shell text is never evaluated.".into());
    }
    if matches!(
        a.program.as_str(),
        "sudo" | "su" | "osascript" | "launchctl" | "diskutil" | "csrutil" | "nvram"
    ) {
        return Err("System administration commands are not supported.".into());
    }
    if a.args.len() > 100 || a.args.iter().any(|s| s.len() > 10000 || s.contains('\0')) {
        return Err("Command arguments exceed limits".into());
    }
    if !(1..=600).contains(&a.timeout_seconds) {
        return Err("Command timeout must be 1–600 seconds".into());
    }
    Ok(())
}
pub fn auto_safe(a: &CommandArgs) -> bool {
    // Only exact read-only Git requests bypass approval when terminal approval is disabled.
    a.program == "git" && matches!(a.args.as_slice(), [x] if x=="status" || x=="diff")
}
async fn output<R: AsyncRead + Unpin>(
    mut stream: R,
    kind: &'static str,
    channel: Option<Channel<Value>>,
) -> String {
    let mut buf = [0u8; 4096];
    let mut tail = Vec::new();
    loop {
        match stream.read(&mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                if let Some(ref c) = channel {
                    let _ =
                        c.send(json!({"stream":kind,"text":String::from_utf8_lossy(&buf[..n])}));
                }
                tail.extend_from_slice(&buf[..n]);
                if tail.len() > 64000 {
                    tail.drain(..tail.len() - 64000);
                }
            }
        }
    }
    String::from_utf8_lossy(&tail).into()
}
pub async fn run(
    root: &Path,
    a: &CommandArgs,
    cancel: CancellationToken,
    channel: Option<Channel<Value>>,
) -> Result<Value, String> {
    validate(a)?;
    let start = Instant::now();
    let mut cmd = Command::new(&a.program);
    let mut argv = a.args.clone();
    if auto_safe(a) {
        argv = vec![
            "--no-pager".into(),
            "-c".into(),
            "core.fsmonitor=false".into(),
            a.args[0].clone(),
        ];
        if a.args[0] == "diff" {
            argv.extend(["--no-ext-diff".into(), "--no-textconv".into()]);
        }
        argv.extend(["--".into(), ".".into()]);
    }
    cmd.args(&argv)
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("NO_COLOR", "1")
        .env("TERM", "dumb");
    #[cfg(unix)]
    cmd.process_group(0);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not launch {}: {e}. Check your PATH.", a.program))?;
    let pid = child.id();
    let out = tokio::spawn(output(
        child.stdout.take().ok_or("Missing stdout")?,
        "stdout",
        channel.clone(),
    ));
    let err = tokio::spawn(output(
        child.stderr.take().ok_or("Missing stderr")?,
        "stderr",
        channel,
    ));
    let (status, stopped) = tokio::select! {
        s=child.wait() => (s.map_err(|e|e.to_string())?,false),
        _=cancel.cancelled() => { kill_group(pid); let _=child.kill().await; (child.wait().await.map_err(|e|e.to_string())?,true) },
        _=tokio::time::sleep(std::time::Duration::from_secs(a.timeout_seconds)) => { kill_group(pid); let _=child.kill().await; (child.wait().await.map_err(|e|e.to_string())?,true) }
    };
    // A child may have left descendants holding the output pipes. Terminate its process group.
    kill_group(pid);
    let stdout = out.await.map_err(|e| e.to_string())?;
    let stderr = err.await.map_err(|e| e.to_string())?;
    Ok(
        json!({"program":a.program,"args":a.args,"cwd":root,"stdout":stdout,"stderr":stderr,"exit_code":status.code(),"duration_ms":start.elapsed().as_millis(),"stopped":stopped,"output_note":"Captured output is limited to the last 64 KB per stream."}),
    )
}
fn kill_group(pid: Option<u32>) {
    #[cfg(unix)]
    if let Some(pid) = pid {
        unsafe {
            libc::kill(-(pid as i32), libc::SIGKILL);
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn command_policy() {
        let a = CommandArgs {
            program: "sudo".into(),
            args: vec![],
            timeout_seconds: 30,
        };
        assert!(validate(&a).is_err());
        let b = CommandArgs {
            program: "npm".into(),
            args: vec!["run".into(), "build".into()],
            timeout_seconds: 30,
        };
        assert!(validate(&b).is_ok());
        assert!(!auto_safe(&b));
        let c = CommandArgs {
            program: "git".into(),
            args: vec!["status".into(), "--porcelain".into(), "; rm -rf /".into()],
            timeout_seconds: 30,
        };
        assert!(!auto_safe(&c));
    }
}
