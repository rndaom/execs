//! A small rotating record of what execs did and which errors it hit.
//!
//! Copy diagnostics includes the newest lines so a bug report shows the last
//! operations instead of only "it broke". Each line is a timestamp, a short
//! kind and one sentence. Callers pass operation names, outcomes, error
//! messages and URLs; never file contents or cfg text, and credential-looking
//! words are masked before anything is written. Logging is best effort: a
//! failure to write never changes the operation being recorded.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

const LOG_NAME: &str = "activity.log";
const ROTATED_NAME: &str = "activity.log.1";
/// Past this the log is rotated; one older generation is kept.
const MAX_LOG_BYTES: u64 = 256 * 1024;
const MAX_LINE_CHARS: usize = 400;
/// Commands whose argument must never reach the log.
const SECRET_WORDS: [&str; 4] = ["rcon_password", "sv_password", "password", "token"];

static WRITES: Mutex<()> = Mutex::new(());

fn log_path(data_dir: &Path) -> PathBuf {
    data_dir.join("logs").join(LOG_NAME)
}

/// Record one line in the app's data folder. Never fails the caller.
pub fn record(kind: &str, message: &str) {
    if let Ok(dir) = crate::settings::try_execs_data_dir() {
        record_to(&dir, kind, message);
    }
}

/// One log line: single-line, bounded, with secret-looking values masked.
fn line(kind: &str, message: &str) -> String {
    let mut words: Vec<String> = Vec::new();
    let mut mask_next = false;
    for word in message.split_whitespace() {
        if mask_next {
            words.push("[hidden]".into());
            mask_next = false;
            continue;
        }
        let lower = word.to_ascii_lowercase();
        if let Some((key, _)) = lower.split_once('=') {
            if SECRET_WORDS.iter().any(|secret| key.contains(secret)) {
                words.push(format!("{}=[hidden]", &word[..key.len()]));
                continue;
            }
        }
        mask_next = SECRET_WORDS
            .iter()
            .any(|secret| lower.trim_matches('"') == *secret);
        words.push(word.to_string());
    }
    let mut text = words.join(" ");
    if text.chars().count() > MAX_LINE_CHARS {
        text = text.chars().take(MAX_LINE_CHARS).collect::<String>() + "…";
    }
    let kind: String = kind
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-')
        .take(32)
        .collect();
    format!("{} {kind}: {text}\n", crate::profile::utc_rfc3339())
}

pub fn record_to(data_dir: &Path, kind: &str, message: &str) {
    let _guard = WRITES
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let logs = data_dir.join("logs");
    if crate::hash::create_dir_all_within(data_dir, &logs).is_err() {
        return;
    }
    let path = log_path(data_dir);
    match std::fs::symlink_metadata(&path) {
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return,
        Ok(meta) if crate::hash::metadata_is_link(&meta) || !meta.is_file() => return,
        Ok(meta) if meta.len() >= MAX_LOG_BYTES => {
            let rotated = logs.join(ROTATED_NAME);
            if std::fs::symlink_metadata(&rotated).is_ok()
                && crate::hash::remove_file_force_within(data_dir, &rotated).is_err()
            {
                return;
            }
            if crate::hash::move_file_within(data_dir, &path, &rotated).is_err() {
                return;
            }
        }
        Ok(_) => {}
    }
    // A plain append: a failure repeating in a loop must stay cheap, and a
    // torn last line in a diagnostics log costs nothing.
    use std::io::Write as _;
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = file.write_all(line(kind, message).as_bytes());
    }
}

/// The newest `count` lines, oldest first.
pub fn recent_to(data_dir: &Path, count: usize) -> Vec<String> {
    let path = log_path(data_dir);
    let Ok(Some(bytes)) =
        crate::archive::read_regular_file_bounded_within(data_dir, &path, MAX_LOG_BYTES * 2)
    else {
        return Vec::new();
    };
    let text = String::from_utf8_lossy(&bytes);
    let lines: Vec<&str> = text.lines().filter(|line| !line.is_empty()).collect();
    lines[lines.len().saturating_sub(count)..]
        .iter()
        .map(|line| (*line).to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_single_lines_and_returns_the_newest() {
        let dir = crate::test_temp_dir();
        for index in 0..5 {
            record_to(&dir, "switch", &format!("step {index}\nsecond line"));
        }
        let recent = recent_to(&dir, 2);
        assert_eq!(recent.len(), 2);
        assert!(recent[0].ends_with("switch: step 3 second line"));
        assert!(recent[1].ends_with("switch: step 4 second line"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn masks_credentials_and_bounds_each_line() {
        let masked = line(
            "error",
            "Could not save rcon_password hunter2 or sv_password=abc token=xyz",
        );
        assert!(!masked.contains("hunter2"));
        assert!(!masked.contains("abc"));
        assert!(!masked.contains("xyz"));
        assert!(masked.contains("rcon_password [hidden]"));
        let long = line("net", &"x".repeat(2_000));
        assert!(long.chars().count() < MAX_LINE_CHARS + 64);
    }

    #[test]
    fn rotates_one_generation_past_the_size_limit() {
        let dir = crate::test_temp_dir();
        std::fs::create_dir_all(dir.join("logs")).unwrap();
        std::fs::write(log_path(&dir), vec![b'a'; MAX_LOG_BYTES as usize]).unwrap();
        record_to(&dir, "tidy", "fresh");
        assert!(dir.join("logs").join(ROTATED_NAME).is_file());
        assert_eq!(recent_to(&dir, 10).len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
