//! Which TF2HUD.Editor schema file belongs to which HUD. The index is built
//! into the app: `hud_schema_index.json` records, for the pinned commit's
//! schema folder, the repository and name each schema gives its HUD and the
//! HUDs the editor gives the options in `shared-hud.json`. It is generated
//! by `scripts/pinned-sources.mjs --write-index`, which also fails when the
//! file no longer matches the pinned folder. A HUD is matched by repository,
//! then by name, so a schema added upstream needs no code here.

use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use crate::hud::github_repo_parts;
use crate::hud_apply::strip_json_comments;
use crate::profile::ProfileError;

/// The options the editor offers every HUD in its shared list.
pub const SHARED_SCHEMA_FILE: &str = "shared-hud.json";

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HudSchemaIndex {
    pub entries: Vec<HudSchemaIndexEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HudSchemaIndexEntry {
    /// The schema file to read: the HUD's own, or `SHARED_SCHEMA_FILE`.
    pub file: String,
    /// `owner/name` of the HUD's GitHub repository, lowercased.
    pub repo: Option<String>,
    /// Normalized names the HUD goes by: the file's stem and its `Name`.
    pub names: Vec<String>,
}

/// A schema folder entry safe to put in a URL and a cache file name.
pub fn is_schema_file_name(name: &str) -> bool {
    name.len() <= 96
        && name.len() > ".json".len()
        && name.ends_with(".json")
        && !name.starts_with('.')
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

/// Letters and digits only, lowercased, without the branch suffix GitHub puts
/// on a downloaded folder: `Middle-Mann`, `middle-mann` and `middlemann-main`
/// are one HUD.
pub fn normalize_hud_name(name: &str) -> String {
    let lower = name.trim().to_ascii_lowercase();
    let lower = ["-master", "-main"]
        .iter()
        .find_map(|suffix| lower.strip_suffix(suffix))
        .unwrap_or(&lower);
    lower.chars().filter(char::is_ascii_alphanumeric).collect()
}

/// `owner/name`, lowercased, of a GitHub repository URL.
pub fn normalize_hud_repo(repo: &str) -> Option<String> {
    let (owner, name) = github_repo_parts(repo)?;
    Some(format!("{owner}/{name}").to_ascii_lowercase())
}

/// The checked-in record of the pinned schema folder.
#[derive(Deserialize)]
struct Folder {
    commit: String,
    schemas: Vec<Described>,
    #[serde(default)]
    shared: Vec<Described>,
}

#[derive(Deserialize)]
struct Described {
    /// The schema file; absent for a HUD in the shared list.
    #[serde(default)]
    file: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    github: Option<String>,
}

impl Described {
    fn entry(self) -> Option<HudSchemaIndexEntry> {
        let file = self.file.unwrap_or_else(|| SHARED_SCHEMA_FILE.to_string());
        if !is_schema_file_name(&file) {
            return None;
        }
        let stem = (file != SHARED_SCHEMA_FILE).then(|| file.trim_end_matches(".json"));
        let mut names: Vec<String> = stem
            .into_iter()
            .chain(self.name.as_deref())
            .map(normalize_hud_name)
            .filter(|name| !name.is_empty())
            .collect();
        names.dedup();
        let repo = self.github.as_deref().and_then(normalize_hud_repo);
        (repo.is_some() || !names.is_empty()).then_some(HudSchemaIndexEntry { file, repo, names })
    }
}

/// Whether a cached or downloaded schema file is whole: JSON once the
/// editor's comments are stripped.
pub fn is_schema_json(raw: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(&strip_json_comments(raw)).is_ok()
}

/// The commit and index a folder record describes. A HUD's own schema comes
/// before the shared list.
pub fn parse_schema_folder(raw: &str) -> Result<(String, HudSchemaIndex), ProfileError> {
    let folder: Folder =
        serde_json::from_str(raw).map_err(|err| ProfileError::Io(err.to_string()))?;
    let entries = folder
        .schemas
        .into_iter()
        .filter(|schema| schema.file.as_deref() != Some(SHARED_SCHEMA_FILE))
        .chain(
            folder
                .shared
                .into_iter()
                .map(|hud| Described { file: None, ..hud }),
        )
        .filter_map(Described::entry)
        .collect();
    Ok((folder.commit, HudSchemaIndex { entries }))
}

fn pinned() -> &'static (String, HudSchemaIndex) {
    static PINNED: OnceLock<(String, HudSchemaIndex)> = OnceLock::new();
    PINNED.get_or_init(|| {
        parse_schema_folder(include_str!("hud_schema_index.json"))
            .expect("the checked-in schema index is valid")
    })
}

/// The index of the pinned schema folder, built into the app.
pub fn pinned_schema_index() -> &'static HudSchemaIndex {
    &pinned().1
}

/// The TF2HUD.Editor commit the built-in index was generated from.
pub fn pinned_schema_index_commit() -> &'static str {
    &pinned().0
}

impl HudSchemaIndex {
    /// The schema for a HUD: by its repository when one is known (a hud-db
    /// install), otherwise by name (an imported folder). A HUD's own schema
    /// wins over the shared options.
    pub fn find(&self, id: &str, repo: Option<&str>) -> Option<&HudSchemaIndexEntry> {
        let repo = repo.and_then(normalize_hud_repo);
        let name = normalize_hud_name(id);
        let own = |entry: &&HudSchemaIndexEntry| entry.file != SHARED_SCHEMA_FILE;
        let by_repo = |entry: &&HudSchemaIndexEntry| repo.is_some() && entry.repo == repo;
        let by_name = |entry: &&HudSchemaIndexEntry| entry.names.contains(&name);
        let entries = || self.entries.iter();
        entries()
            .find(|entry| own(entry) && by_repo(entry))
            .or_else(|| entries().find(|entry| own(entry) && by_name(entry)))
            .or_else(|| entries().find(by_repo))
            .or_else(|| entries().find(by_name))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn index() -> HudSchemaIndex {
        parse_schema_folder(
            r#"{"commit":"abc","schemas":[
                {"file":"middle-mann.json","name":null,"github":"https://github.com/Vexcenot/-Middle-Mann"},
                {"file":"idhud.json","name":"Improved Default HUD","github":"https://github.com/idhud-tf2/idhud"},
                {"file":"hypnotize-hud.json","name":null,"github":null},
                {"file":"../escape.json","name":"escape","github":null},
                {"file":"shared-hud.json","name":"shared","github":null}],
              "shared":[
                {"name":"Broesel Hud","github":"https://github.com/TF2HUDsArchive/Broesel-Hud"},
                {"name":"idhud","github":null}, {"name":null,"github":null}]}"#,
        )
        .unwrap()
        .1
    }

    #[test]
    fn a_catalog_hud_matches_by_repository_whatever_its_id_is() {
        let index = index();
        let found = index
            .find(
                "improved-default-hud",
                Some("https://github.com/IDHUD-tf2/idhud/"),
            )
            .unwrap();
        assert_eq!(found.file, "idhud.json");
        // Another HUD's repository never borrows a schema through its id.
        assert!(index
            .find("some-fork", Some("https://github.com/someone/else"))
            .is_none());
    }

    #[test]
    fn names_match_without_punctuation_case_or_branch_suffix() {
        let index = index();
        for id in [
            "middlemann",
            "Middle-Mann",
            "middle-mann-main",
            "MIDDLE_MANN",
        ] {
            assert_eq!(
                index.find(id, None).unwrap().file,
                "middle-mann.json",
                "{id}"
            );
        }
        for id in ["hypnotizehud", "hypnotize-hud", "hypnotizehud-master"] {
            assert_eq!(index.find(id, None).unwrap().file, "hypnotize-hud.json");
        }
        assert_eq!(
            index.find("improved-default-hud", None).unwrap().file,
            "idhud.json"
        );
        assert!(index.find("rayshud", None).is_none());
        assert!(index.find("", None).is_none());
    }

    #[test]
    fn shared_huds_read_the_shared_schema_and_never_shadow_a_huds_own() {
        let index = index();
        let broesel = index
            .find(
                "broesel-hud",
                Some("https://github.com/TF2HUDsArchive/Broesel-Hud"),
            )
            .unwrap();
        assert_eq!(broesel.file, SHARED_SCHEMA_FILE);
        assert_eq!(
            index.find("broeselhud", None).unwrap().file,
            SHARED_SCHEMA_FILE
        );
        // `idhud` is in the shared list too; its own schema wins.
        assert_eq!(index.find("idhud", None).unwrap().file, "idhud.json");
        // The nameless, linkless shared entry was dropped, not matched by "";
        // so were the unsafe file name and the shared schema listed as a HUD.
        assert_eq!(index.entries.len(), 5);
        assert!(index.find("escape", None).is_none());
        assert!(index.find("shared", None).is_none());
    }

    #[test]
    fn only_plain_json_names_are_schema_files() {
        for name in ["rayshud.json", "m0rehud-classic.json", "hud_fixes.v2.json"] {
            assert!(is_schema_file_name(name), "{name}");
        }
        for name in [
            ".json",
            "Schema",
            "../rayshud.json",
            "a/b.json",
            "ray shud.json",
            ".hidden.json",
            "rayshud.json?x",
        ] {
            assert!(!is_schema_file_name(name), "{name}");
        }
    }

    #[test]
    fn a_folder_record_that_is_not_json_is_refused() {
        assert!(parse_schema_folder("{").is_err());
        assert!(parse_schema_folder("[]").is_err());
    }

    #[test]
    fn the_built_in_index_names_the_pinned_huds() {
        assert_eq!(pinned_schema_index_commit().len(), 40);
        let index = pinned_schema_index();
        let file = |id: &str, repo: Option<&str>| index.find(id, repo).map(|e| e.file.as_str());
        assert_eq!(
            file("anything", Some("https://github.com/raysfire/rayshud")),
            Some("rayshud.json")
        );
        assert_eq!(file("rayshud-master", None), Some("rayshud.json"));
        assert_eq!(file("middlemann", None), Some("middle-mann.json"));
        assert_eq!(file("broeselhud", None), Some(SHARED_SCHEMA_FILE));
        assert_eq!(file("toonhud", None), None);
        assert!(index.entries.iter().all(|e| is_schema_file_name(&e.file)));
    }
}
