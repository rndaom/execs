//! Which TF2HUD.Editor schema file belongs to which HUD, built from the
//! pinned commit's schema folder instead of a list of HUD names. Each schema
//! names its HUD's repository; `common.json` lists the HUDs the editor gives
//! the options in `shared-hud.json`. A HUD is matched by repository, then by
//! name, so a schema added upstream needs no code here.

use serde::{Deserialize, Serialize};

use crate::hud::github_repo_parts;
use crate::hud_apply::strip_json_comments;
use crate::profile::ProfileError;

/// The editor's list of HUDs that get the shared options. Not a schema.
pub const SHARED_HUD_LIST_FILE: &str = "common.json";
/// The options the editor offers every HUD in `SHARED_HUD_LIST_FILE`.
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

#[derive(Deserialize)]
struct Described {
    #[serde(rename = "Name", default)]
    name: Option<String>,
    #[serde(rename = "Links", default)]
    links: Option<Links>,
}

#[derive(Deserialize)]
struct Links {
    #[serde(rename = "GitHub", default)]
    github: Option<String>,
}

impl Described {
    fn entry(self, file: &str, stem: Option<&str>) -> HudSchemaIndexEntry {
        let mut names: Vec<String> = stem
            .into_iter()
            .chain(self.name.as_deref())
            .map(normalize_hud_name)
            .filter(|name| !name.is_empty())
            .collect();
        names.dedup();
        HudSchemaIndexEntry {
            file: file.to_string(),
            repo: self
                .links
                .and_then(|links| links.github)
                .as_deref()
                .and_then(normalize_hud_repo),
            names,
        }
    }
}

fn parse<T: serde::de::DeserializeOwned>(raw: &str) -> Result<T, ProfileError> {
    serde_json::from_str(&strip_json_comments(raw)).map_err(|err| ProfileError::Io(err.to_string()))
}

/// Whether a cached or downloaded schema folder file is whole: JSON once the
/// editor's comments are stripped.
pub fn is_schema_json(raw: &str) -> bool {
    parse::<serde_json::Value>(raw).is_ok()
}

/// The index entry for one HUD's own schema file.
pub fn schema_index_entry(file: &str, raw: &str) -> Result<HudSchemaIndexEntry, ProfileError> {
    let stem = file.strip_suffix(".json").unwrap_or(file);
    Ok(parse::<Described>(raw)?.entry(file, Some(stem)))
}

/// One entry per HUD in the editor's shared list, each reading the shared
/// schema.
pub fn shared_index_entries(raw: &str) -> Result<Vec<HudSchemaIndexEntry>, ProfileError> {
    Ok(parse::<Vec<Described>>(raw)?
        .into_iter()
        .map(|hud| hud.entry(SHARED_SCHEMA_FILE, None))
        .filter(|entry| entry.repo.is_some() || !entry.names.is_empty())
        .collect())
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
        let mut entries = vec![
            schema_index_entry(
                "middle-mann.json",
                r#"{ // comments are allowed
                    "Links": {"GitHub": "https://github.com/Vexcenot/-Middle-Mann"}}"#,
            )
            .unwrap(),
            schema_index_entry(
                "idhud.json",
                r#"{"Name":"Improved Default HUD","Links":{"GitHub":"https://github.com/idhud-tf2/idhud"}}"#,
            )
            .unwrap(),
            schema_index_entry("hypnotize-hud.json", r#"{"Controls":{}}"#).unwrap(),
        ];
        entries.extend(
            shared_index_entries(
                r#"[{"Name":"Broesel Hud","Links":{"GitHub":"https://github.com/TF2HUDsArchive/Broesel-Hud"}},
                    {"Name":"idhud","Links":{}}, {"Links":{}}]"#,
            )
            .unwrap(),
        );
        HudSchemaIndex { entries }
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
        // The nameless, linkless shared entry was dropped, not matched by "".
        assert_eq!(index.entries.len(), 5);
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
    fn a_schema_that_is_not_json_is_refused() {
        assert!(schema_index_entry("broken.json", "{").is_err());
        assert!(shared_index_entries("{}").is_err());
    }
}
