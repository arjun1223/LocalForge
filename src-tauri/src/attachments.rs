use serde::Serialize;
use std::{fs::File, io::Read, path::PathBuf};

#[derive(Serialize)]
pub struct Attachment {
    path: String,
    name: String,
    content: String,
}
#[derive(Default, Serialize)]
pub struct AttachmentBatch {
    files: Vec<Attachment>,
    errors: Vec<String>,
}
// A separate UI-only import path. Agent tools never receive this capability.
pub fn read(paths: Vec<String>) -> AttachmentBatch {
    let mut batch = AttachmentBatch::default();
    if paths.len() > 8 {
        batch.errors.push("Choose up to 8 files at a time.".into());
    }
    for input in paths.into_iter().take(8) {
        let path = PathBuf::from(&input);
        let name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let result = (|| -> Result<String, String> {
            if !path.is_absolute() {
                return Err("Expected a file from Finder or the file picker".into());
            }
            let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
            if !meta.is_file() {
                return Err("Folders cannot be attached. Use Open a project for folders.".into());
            }
            if meta.len() > crate::workspace::MAX_FILE {
                return Err("File exceeds 512 KiB".into());
            }
            let file = File::open(&path).map_err(|e| e.to_string())?;
            let mut bytes = Vec::new();
            file.take(crate::workspace::MAX_FILE + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            if bytes.len() as u64 > crate::workspace::MAX_FILE {
                return Err("File exceeds 512 KiB".into());
            }
            if bytes.contains(&0) || bytes.starts_with(b"%PDF-") {
                return Err("Attach a text or code file. Images, PDFs and other binary files are not supported yet.".into());
            }
            String::from_utf8(bytes).map_err(|_| "Attach a UTF-8 text or code file".into())
        })();
        match result {
            Ok(content) => batch.files.push(Attachment {
                path: input,
                name,
                content: content.trim_start_matches('\u{feff}').into(),
            }),
            Err(error) => batch.errors.push(format!("{name}: {error}")),
        }
    }
    batch
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn imports_explicit_files_and_reports_invalid_items_individually() {
        let dir =
            std::env::temp_dir().join(format!("localforge-attachments-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let text = dir.join("source.txt");
        let binary = dir.join("image.png");
        let large = dir.join("large.txt");
        std::fs::write(&text, "\u{feff}actual attached text ✓").unwrap();
        std::fs::write(&binary, [0, 1, 2]).unwrap();
        std::fs::write(&large, vec![b'x'; crate::workspace::MAX_FILE as usize + 1]).unwrap();
        let batch = read(
            vec![text, binary, large, dir.clone(), dir.join("missing.txt")]
                .into_iter()
                .map(|p| p.to_string_lossy().into())
                .collect(),
        );
        assert_eq!(batch.files.len(), 1);
        assert_eq!(batch.files[0].content, "actual attached text ✓");
        assert_eq!(batch.errors.len(), 4);
        assert!(read(vec!["relative.txt".into()]).files.is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
