//! Account-scoped operation evidence. Pending intents never replay automatically.
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

const MAX_BYTES: u64 = 96 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Journal {
    pub operation_id: String,
    pub steam_id: String,
    pub kind: String,
    pub pending: bool,
    pub intent: serde_json::Value,
    pub outcome: Option<serde_json::Value>,
}

pub fn new_token() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn path(data: &Path, steam_id: &str) -> Result<PathBuf, String> {
    if steam_id.is_empty()
        || steam_id.len() > 20
        || !steam_id.bytes().all(|b| b.is_ascii_digit())
        || steam_id
            .parse::<u64>()
            .ok()
            .is_none_or(|id| id == 0 || id.to_string() != steam_id)
    {
        return Err("Invalid Steam account identity.".into());
    }
    Ok(data
        .join("inventory/operations")
        .join(format!("{steam_id}.json")))
}

pub fn read(data: &Path, steam_id: &str) -> Result<Option<Journal>, String> {
    let path = path(data, steam_id)?;
    match crate::hash::validate_file_within(data, &path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    }
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "Could not read inventory operation evidence: {error}"
            ))
        }
    };
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("Inventory operation evidence exceeds its limit.".into());
    }
    let journal: Journal = serde_json::from_slice(&bytes)
        .map_err(|e| format!("Inventory operation evidence is unreadable: {e}"))?;
    validate(&journal, steam_id)?;
    Ok(Some(journal))
}

pub fn save(data: &Path, journal: &Journal) -> Result<(), String> {
    validate(journal, &journal.steam_id)?;
    let path = path(data, &journal.steam_id)?;
    let bytes = serde_json::to_vec(journal).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("Inventory operation evidence exceeds its limit.".into());
    }
    crate::hash::create_dir_all_within(data, path.parent().ok_or("Invalid journal path")?)
        .map_err(|e| e.to_string())?;
    crate::hash::write_atomic_within(data, &path, &bytes).map_err(|e| e.to_string())
}

fn validate(journal: &Journal, steam_id: &str) -> Result<(), String> {
    if journal.steam_id != steam_id
        || uuid::Uuid::parse_str(&journal.operation_id).is_err()
        || !["layout", "craft", "delete"].contains(&journal.kind.as_str())
        || !journal.intent.is_object()
    {
        return Err("Inventory operation evidence has invalid identity or intent.".into());
    }
    let status = journal
        .outcome
        .as_ref()
        .and_then(|outcome| outcome.get("status"))
        .and_then(serde_json::Value::as_str);
    if (journal.pending && journal.outcome.is_some() && status != Some("unknown"))
        || (!journal.pending && !matches!(status, Some("confirmed" | "refused")))
    {
        return Err("Inventory operation evidence has an inconsistent outcome.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    struct TestDir(PathBuf);
    impl TestDir {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("execs-inventory-journal-{}", new_token()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn account_journal_is_bounded_and_preserves_pending_until_outcome_commit() {
        let dir = TestDir::new();
        let mut journal = Journal {
            operation_id: new_token(),
            steam_id: "76561198000000000".into(),
            kind: "craft".into(),
            pending: true,
            intent: serde_json::json!({"itemId":"18446744073709551615"}),
            outcome: None,
        };
        save(dir.path(), &journal).unwrap();
        assert!(
            read(dir.path(), &journal.steam_id)
                .unwrap()
                .unwrap()
                .pending
        );
        assert!(read(dir.path(), "76561198000000001").unwrap().is_none());
        journal.pending = false;
        journal.outcome = Some(serde_json::json!({"status":"confirmed"}));
        save(dir.path(), &journal).unwrap();
        assert!(
            !read(dir.path(), &journal.steam_id)
                .unwrap()
                .unwrap()
                .pending
        );
        assert!(read(dir.path(), "../../settings").is_err());
    }
    #[test]
    fn unreadable_evidence_cannot_be_treated_as_no_pending_operation() {
        let dir = TestDir::new();
        let target = path(dir.path(), "76561198000000000").unwrap();
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(target, b"broken").unwrap();
        assert!(read(dir.path(), "76561198000000000").is_err());
    }

    #[test]
    fn account_paths_require_canonical_nonzero_identities() {
        let dir = TestDir::new();
        for id in [
            "",
            "0",
            "01",
            "-1",
            "+1",
            "18446744073709551616",
            "1/2",
            " 1",
        ] {
            assert!(read(dir.path(), id).is_err(), "{id}");
        }
    }

    #[test]
    fn inconsistent_outcomes_cannot_replace_pending_evidence() {
        let dir = TestDir::new();
        let mut journal = Journal {
            operation_id: new_token(),
            steam_id: "76561198000000000".into(),
            kind: "delete".into(),
            pending: true,
            intent: serde_json::json!({"itemId":"100"}),
            outcome: None,
        };
        save(dir.path(), &journal).unwrap();
        for outcome in [
            serde_json::json!({}),
            serde_json::json!({"status":"confirmed"}),
            serde_json::json!({"status":"refused"}),
        ] {
            journal.outcome = Some(outcome);
            assert!(save(dir.path(), &journal).is_err());
            assert!(
                read(dir.path(), &journal.steam_id)
                    .unwrap()
                    .unwrap()
                    .pending
            );
        }
        journal.outcome = Some(serde_json::json!({"status":"unknown"}));
        save(dir.path(), &journal).unwrap();
        journal.pending = false;
        assert!(save(dir.path(), &journal).is_err());
        assert!(
            read(dir.path(), &journal.steam_id)
                .unwrap()
                .unwrap()
                .pending
        );
    }
}
