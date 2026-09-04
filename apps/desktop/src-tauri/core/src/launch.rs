//! Read and write TF2 launch options (profile + Steam `localconfig.vdf`).

use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

use crate::finder::discover_steam_roots;
use crate::hash::{
    read_small_file_bounded, read_small_text_bounded, validate_dir_within, validate_file_within,
    write_atomic_within,
};
use crate::process_lock::{live_process_names, refuse_if_running_among, steam_running_among};
use crate::profile::{load_library_from, load_manifest, profiles_dir, ProfileError};
use crate::vdf::{parse_vdf, serialize_vdf, VdfMap, VdfValue};

const TF2_APP: &str = "440";
const STEAM_ID64_BASE: u64 = 76561197960265728;
const RECOMMENDED_LAUNCH_OPTIONS: &str = "-novid -nojoy -nosteamcontroller -nohltv -particles 1";
const MAX_LOCALCONFIG_BYTES: usize = 16 * 1024 * 1024;
const MAX_LOGINUSERS_BYTES: usize = 1024 * 1024;

const LAUNCH_OPTIONS_PATH: &[&str] = &[
    "UserLocalConfigStore",
    "Software",
    "Valve",
    "Steam",
    "apps",
    "440",
    "LaunchOptions",
];

const LAUNCH_OPTIONS_PATH_FROM_STORE: &[&str] =
    &["Software", "Valve", "Steam", "apps", "440", "LaunchOptions"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SteamAccount {
    pub steam_root: PathBuf,
    pub account_id: String,
}

impl SteamAccount {
    pub fn localconfig(&self) -> PathBuf {
        self.steam_root
            .join("userdata")
            .join(&self.account_id)
            .join("config")
            .join("localconfig.vdf")
    }

    pub fn cloud_config(&self) -> PathBuf {
        self.steam_root
            .join("userdata")
            .join(&self.account_id)
            .join(TF2_APP)
            .join("remote")
            .join("cfg")
            .join("config.cfg")
    }
}

pub fn read_launch_options() -> String {
    read_launch_options_from(&discover_steam_roots())
}

pub fn read_launch_options_from(steam_roots: &[PathBuf]) -> String {
    let Some(account) = pick_steam_account_from(steam_roots) else {
        return String::new();
    };
    let Ok(text) = read_small_text_bounded(&account.localconfig(), MAX_LOCALCONFIG_BYTES) else {
        return String::new();
    };
    let Ok(vdf) = parse_vdf(&text) else {
        return String::new();
    };
    sanitize_launch_options(&launch_options_from_localconfig(&vdf).unwrap_or_default())
}

/// Official mastercomfig recommended set. Same on Windows and Linux (no `gamemoderun`).
pub fn recommended_launch_options() -> String {
    sanitize_launch_options(RECOMMENDED_LAUNCH_OPTIONS)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LaunchWriteReason {
    Written,
    SteamOpen,
    NoAccount,
    /// The profile commit succeeded, but Steam's copy could not be updated.
    /// `launch_sync_pending` keeps this retryable instead of turning a
    /// postcommit I/O problem into a misleading all-or-nothing error.
    WriteFailed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchWriteResult {
    pub written: bool,
    pub reason: LaunchWriteReason,
}

impl LaunchWriteResult {
    fn steam_open() -> Self {
        Self {
            written: false,
            reason: LaunchWriteReason::SteamOpen,
        }
    }

    fn no_account() -> Self {
        Self {
            written: false,
            reason: LaunchWriteReason::NoAccount,
        }
    }

    fn ok() -> Self {
        Self {
            written: true,
            reason: LaunchWriteReason::Written,
        }
    }

    fn write_failed() -> Self {
        Self {
            written: false,
            reason: LaunchWriteReason::WriteFailed,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetLaunchResult {
    pub launch_options: String,
    pub steam_write: LaunchWriteReason,
}

pub fn write_launch_options_to_localconfig_from<I, S>(
    steam_roots: &[PathBuf],
    options: &str,
    steam_running_names: I,
) -> Result<LaunchWriteResult, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let steam_running = steam_running_among(steam_running_names);
    write_launch_options_to_localconfig_checked(steam_roots, options, || steam_running)
}

/// Production boundary for Steam-owned configuration. Unlike the injectable
/// `_from` helper, this samples the process table at each destructive boundary
/// so a snapshot taken before a long profile switch cannot authorize a later
/// `localconfig.vdf` rewrite.
pub fn write_launch_options_to_localconfig(
    steam_roots: &[PathBuf],
    options: &str,
) -> Result<LaunchWriteResult, ProfileError> {
    write_launch_options_to_localconfig_checked(steam_roots, options, || {
        steam_running_among(live_process_names())
    })
}

fn write_launch_options_to_localconfig_checked<F>(
    steam_roots: &[PathBuf],
    options: &str,
    mut steam_is_running: F,
) -> Result<LaunchWriteResult, ProfileError>
where
    F: FnMut() -> bool,
{
    if steam_is_running() {
        return Ok(LaunchWriteResult::steam_open());
    }
    let Some(account) = pick_steam_account_from(steam_roots) else {
        return Ok(LaunchWriteResult::no_account());
    };
    let prepared = prepare_localconfig_update(account, options)?;
    if steam_is_running() {
        return Ok(LaunchWriteResult::steam_open());
    }
    backup_localconfig_once(
        &prepared.account.steam_root,
        &prepared.path,
        prepared.original.as_bytes(),
    )?;
    if steam_is_running() {
        return Ok(LaunchWriteResult::steam_open());
    }
    write_atomic_within(
        &prepared.account.steam_root,
        &prepared.path,
        prepared.serialized.as_bytes(),
    )
    .map_err(|err| ProfileError::Io(err.to_string()))?;
    Ok(LaunchWriteResult::ok())
}

struct PreparedLocalconfigUpdate {
    account: SteamAccount,
    path: PathBuf,
    original: String,
    serialized: String,
}

fn prepare_localconfig_update(
    account: SteamAccount,
    options: &str,
) -> Result<PreparedLocalconfigUpdate, ProfileError> {
    let path = account.localconfig();
    validate_existing_file_within(&account.steam_root, &path)?;
    let original = read_small_text_bounded(&path, MAX_LOCALCONFIG_BYTES)
        .map_err(|err| ProfileError::Io(err.to_string()))?;
    let mut vdf = parse_vdf(&original).map_err(ProfileError::Io)?;
    if !has_localconfig_root(&vdf) {
        return Err(ProfileError::Io(
            "Refusing to rewrite localconfig.vdf: its Steam settings root is missing.".into(),
        ));
    }
    set_launch_options_in_vdf(&mut vdf, &sanitize_launch_options(options));
    let serialized = serialize_vdf(&vdf);
    // We re-emit the whole file through our own writer, so anything our parser
    // does not model would be silently corrupted. Read our own output back and
    // refuse to write unless it is the tree we meant to write. This is a
    // Steam-owned file holding every app's launch options.
    let reparsed = parse_vdf(&serialized).map_err(ProfileError::Io)?;
    if reparsed != vdf {
        return Err(ProfileError::Io(
            "Refusing to rewrite localconfig.vdf: this file uses KeyValues syntax we would not \
             round-trip intact. Set the launch options in Steam instead."
                .into(),
        ));
    }
    Ok(PreparedLocalconfigUpdate {
        account,
        path,
        original,
        serialized,
    })
}

/// Keep one pristine copy of the user's Steam config, made the first time we
/// ever touch it.
fn backup_localconfig_once(
    steam_root: &Path,
    path: &Path,
    original: &[u8],
) -> Result<(), ProfileError> {
    if original.iter().all(u8::is_ascii_whitespace) {
        return Err(ProfileError::Io(
            "localconfig.vdf is empty; refusing to create an unusable pristine backup.".into(),
        ));
    }
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".execs-backup");
    let backup = path.with_file_name(name);
    if backup.exists() {
        validate_existing_backup(steam_root, path)?;
        return Ok(());
    }
    write_atomic_within(steam_root, &backup, original)
        .map_err(|err| ProfileError::Io(err.to_string()))?;
    let written = read_small_file_bounded(&backup, MAX_LOCALCONFIG_BYTES)
        .map_err(|err| ProfileError::Io(err.to_string()))?;
    if written != original {
        return Err(ProfileError::Io(
            "The localconfig.vdf backup did not verify byte-for-byte; refusing to overwrite Steam configuration."
                .into(),
        ));
    }
    Ok(())
}

fn validate_existing_backup(steam_root: &Path, path: &Path) -> Result<(), ProfileError> {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".execs-backup");
    let backup = path.with_file_name(name);
    if !backup.exists() {
        return Ok(());
    }
    validate_existing_file_within(steam_root, &backup)?;
    let existing = read_small_text_bounded(&backup, MAX_LOCALCONFIG_BYTES)
        .map_err(|err| ProfileError::Io(err.to_string()))?;
    let parsed = parse_vdf(&existing).map_err(|err| {
        ProfileError::Io(format!(
            "The existing localconfig.vdf backup is incomplete or invalid ({err}); refusing to overwrite Steam configuration."
        ))
    })?;
    if !has_localconfig_root(&parsed) {
        return Err(ProfileError::Io(
            "The existing localconfig.vdf backup has no Steam settings root; refusing to overwrite Steam configuration."
                .into(),
        ));
    }
    Ok(())
}

fn has_localconfig_root(vdf: &VdfMap) -> bool {
    vdf.get("UserLocalConfigStore")
        .and_then(VdfValue::as_obj)
        .is_some()
        || vdf.get("Software").and_then(VdfValue::as_obj).is_some()
}

fn validate_existing_file_within(root: &Path, path: &Path) -> Result<(), ProfileError> {
    validate_file_within(root, path).map_err(|err| ProfileError::Io(err.to_string()))
}

pub fn get_profile_launch_options(
    tf2_root: &Path,
    profile_id: &str,
) -> Result<String, ProfileError> {
    get_profile_launch_options_from(&profiles_dir(), tf2_root, profile_id)
}

pub fn get_profile_launch_options_from(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
) -> Result<String, ProfileError> {
    ensure_library_usable(profiles_dir, tf2_root)?;
    Ok(load_manifest(profiles_dir, profile_id)?.launch_options)
}

pub fn set_profile_launch_options(
    tf2_root: &Path,
    profile_id: &str,
    raw: &str,
) -> Result<SetLaunchResult, ProfileError> {
    let running = live_process_names();
    refuse_if_running_among(&running)?;
    let profiles = profiles_dir();
    let steam_roots = discover_steam_roots();
    let sanitized = save_profile_launch_options_to(&profiles, tf2_root, profile_id, raw, &running)?;
    let steam = sync_committed_profile_launch_options(
        &profiles,
        tf2_root,
        profile_id,
        &sanitized,
        &running,
        || write_launch_options_to_localconfig(&steam_roots, &sanitized),
    );
    Ok(SetLaunchResult {
        launch_options: sanitized,
        steam_write: steam.reason,
    })
}

pub fn set_profile_launch_options_to<I, J, S, T>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    raw: &str,
    running_tf2_names: I,
    steam_names: J,
    steam_roots: &[PathBuf],
) -> Result<SetLaunchResult, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
    J: IntoIterator<Item = T>,
    T: AsRef<str>,
{
    let running: Vec<String> = running_tf2_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    refuse_if_running_among(&running)?;
    let steam_names: Vec<String> = steam_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    let sanitized =
        save_profile_launch_options_to(profiles_dir, tf2_root, profile_id, raw, &running)?;
    let steam = sync_committed_profile_launch_options(
        profiles_dir,
        tf2_root,
        profile_id,
        &sanitized,
        &running,
        || write_launch_options_to_localconfig_from(steam_roots, &sanitized, &steam_names),
    );
    Ok(SetLaunchResult {
        launch_options: sanitized,
        steam_write: steam.reason,
    })
}

pub(crate) fn sync_committed_profile_launch_options(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    expected_options: &str,
    running_names: &[String],
    write_steam: impl FnOnce() -> Result<LaunchWriteResult, ProfileError>,
) -> LaunchWriteResult {
    let active = load_library_from(profiles_dir, Some(tf2_root))
        .ok()
        .and_then(|library| library.active_profile_id)
        .is_some_and(|active| active == profile_id);
    if !active {
        return LaunchWriteResult::write_failed();
    }
    let Ok(result) = write_steam() else {
        return LaunchWriteResult::write_failed();
    };
    if result.reason != LaunchWriteReason::Written {
        return result;
    }
    match crate::profile::clear_launch_sync_pending_if_matches(
        profiles_dir,
        tf2_root,
        profile_id,
        expected_options,
        running_names,
    ) {
        Ok(true) => result,
        Ok(false) | Err(_) => LaunchWriteResult::write_failed(),
    }
}

fn save_profile_launch_options_to(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    raw: &str,
    running: &[String],
) -> Result<String, ProfileError> {
    refuse_if_running_among(running)?;
    ensure_library_usable(profiles_dir, tf2_root)?;
    let sanitized = sanitize_launch_options(raw);
    crate::profile::set_manifest_launch_options(
        profiles_dir,
        tf2_root,
        profile_id,
        sanitized.clone(),
        running,
    )?;
    Ok(sanitized)
}

fn ensure_library_usable(profiles_dir: &Path, tf2_root: &Path) -> Result<(), ProfileError> {
    let library = load_library_from(profiles_dir, Some(tf2_root))?;
    if library.root_mismatch {
        return Err(ProfileError::RootMismatch {
            library_root: library.tf2_root.unwrap_or_default(),
            confirmed_root: tf2_root.to_string_lossy().into_owned(),
        });
    }
    if !library.usable {
        return Err(ProfileError::NotInitialized);
    }
    Ok(())
}

fn set_launch_options_in_vdf(vdf: &mut VdfMap, options: &str) {
    if vdf
        .get("UserLocalConfigStore")
        .and_then(VdfValue::as_obj)
        .is_some()
    {
        vdf.set_path(LAUNCH_OPTIONS_PATH, options);
        return;
    }
    if vdf.get("Software").and_then(VdfValue::as_obj).is_some() {
        vdf.set_path(LAUNCH_OPTIONS_PATH_FROM_STORE, options);
        return;
    }
    vdf.set_path(LAUNCH_OPTIONS_PATH, options);
}

pub fn find_cloud_config() -> Option<PathBuf> {
    find_cloud_config_from(&discover_steam_roots())
}

pub fn find_cloud_config_from(steam_roots: &[PathBuf]) -> Option<PathBuf> {
    let account = pick_steam_account_from(steam_roots)?;
    let path = account.cloud_config();
    validate_file_within(&account.steam_root, &path)
        .is_ok()
        .then_some(path)
}

/// Cloud `config.cfg` path for the picked account, even if the file does not exist yet.
pub fn cloud_config_path_from(steam_roots: &[PathBuf]) -> Option<PathBuf> {
    let account = pick_steam_account_from(steam_roots)?;
    cloud_parent_is_safe(&account).then(|| account.cloud_config())
}

fn cloud_parent_is_safe(account: &SteamAccount) -> bool {
    let mut current = account
        .steam_root
        .join("userdata")
        .join(&account.account_id);
    for component in [TF2_APP, "remote", "cfg"] {
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(_) if validate_dir_within(&account.steam_root, &current).is_err() => return false,
            Ok(_) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return true,
            Err(_) => return false,
        }
    }
    true
}

pub fn pick_steam_account_from(steam_roots: &[PathBuf]) -> Option<SteamAccount> {
    let mut candidates = Vec::new();
    for steam_root in steam_roots {
        let userdata = steam_root.join("userdata");
        let Ok(entries) = fs::read_dir(&userdata) else {
            continue;
        };
        for entry in entries.flatten() {
            let account_path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() || !file_type.is_dir() {
                continue;
            }
            let Ok(account_id) = entry.file_name().into_string() else {
                continue;
            };
            if account_id
                .parse::<u32>()
                .ok()
                .filter(|id| *id != 0)
                .is_none()
            {
                continue;
            }
            let Ok(canonical_root) = fs::canonicalize(steam_root) else {
                continue;
            };
            let Ok(canonical_account) = fs::canonicalize(&account_path) else {
                continue;
            };
            if !canonical_account.starts_with(&canonical_root) {
                continue;
            }
            let account = SteamAccount {
                steam_root: steam_root.clone(),
                account_id,
            };
            if validate_file_within(steam_root, &account.localconfig()).is_err() {
                continue;
            }
            candidates.push(account);
        }
    }
    if candidates.is_empty() {
        return None;
    }

    // `MostRecent` describes the account Steam actually selected. Consult it
    // before the TF2-directory heuristic: a newly logged-in account may not
    // have created userdata/<id>/440 yet, while an older account has.
    if let Some(preferred) = prefer_most_recent(steam_roots, &candidates) {
        return Some(preferred);
    }

    let with_440: Vec<SteamAccount> = candidates
        .iter()
        .filter(|account| {
            validate_dir_within(
                &account.steam_root,
                &account
                    .steam_root
                    .join("userdata")
                    .join(&account.account_id)
                    .join(TF2_APP),
            )
            .is_ok()
        })
        .cloned()
        .collect();

    let pool = if with_440.is_empty() {
        &candidates
    } else {
        &with_440
    };

    pool.iter()
        .filter(|account| localconfig_mentions_440(&account.localconfig()))
        .max_by_key(|account| localconfig_mtime(&account.localconfig()))
        .cloned()
        .or_else(|| {
            pool.iter()
                .max_by_key(|account| localconfig_mtime(&account.localconfig()))
                .cloned()
        })
}

pub fn sanitize_launch_options(raw: &str) -> String {
    split_launch_commands(raw)
        .into_iter()
        .filter_map(|command| {
            let sanitized = sanitize_launch_command(&command);
            (!sanitized.is_empty()).then_some(sanitized)
        })
        .collect::<Vec<_>>()
        .join("; ")
}

fn sanitize_launch_command(raw: &str) -> String {
    let tokens = tokenize_launch_options(raw);
    let mut out = Vec::new();
    let mut i = 0;
    while i < tokens.len() {
        let normalized = normalized_launch_token(&tokens[i].value);
        if normalized == "-dxlevel" || normalized.starts_with("-dxlevel") {
            if normalized == "-dxlevel"
                && i + 1 < tokens.len()
                && !normalized_launch_token(&tokens[i + 1].value).starts_with('-')
                && !normalized_launch_token(&tokens[i + 1].value).starts_with('+')
            {
                i += 2;
                continue;
            }
            i += 1;
            continue;
        }
        if launch_token_is_forbidden(&normalized) {
            i += 1;
            continue;
        }
        // A quoted shell fragment can contain multiple effective words. Drop
        // the whole fragment if any one is forbidden; leaving `bash -c` behind
        // is safer than persisting a hidden destructive TF2 option.
        if normalized
            .split(|ch: char| ch.is_whitespace() || ch == ';')
            .any(launch_token_is_forbidden)
        {
            i += 1;
            continue;
        }
        out.push(tokens[i].raw.as_str());
        i += 1;
    }
    out.join(" ")
}

/// Split Source command-buffer separators before token filtering. A semicolon
/// is meaningful even when it is attached directly to the preceding/following
/// command (`+quit;echo`), but a quoted semicolon remains argument data.
fn split_launch_commands(raw: &str) -> Vec<String> {
    let mut commands = Vec::new();
    let mut current = String::new();
    let mut quote = None;
    let mut escaped = false;

    for ch in raw.chars() {
        if ch == ';' && quote.is_none() {
            push_launch_command(&mut commands, &mut current);
            escaped = false;
            continue;
        }
        current.push(ch);
        if matches!(ch, '\'' | '"') && !escaped {
            match quote {
                Some(open) if open == ch => quote = None,
                None => quote = Some(ch),
                Some(_) => {}
            }
            escaped = false;
            continue;
        }
        escaped = ch == '\\' && !escaped;
        if ch != '\\' {
            escaped = false;
        }
    }
    push_launch_command(&mut commands, &mut current);
    commands
}

fn push_launch_command(commands: &mut Vec<String>, current: &mut String) {
    let command = current.trim();
    if !command.is_empty() {
        commands.push(command.to_string());
    }
    current.clear();
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LaunchToken {
    raw: String,
    value: String,
}

/// Tokenize enough of Windows/POSIX quoting to recognize an option hidden by
/// whole-token or in-token quotes while retaining the user's original spelling
/// for every benign argument.
fn tokenize_launch_options(raw: &str) -> Vec<LaunchToken> {
    let mut tokens = Vec::new();
    let mut raw_token = String::new();
    let mut value = String::new();
    let mut quote = None;
    let mut escaped = false;

    for ch in raw.chars() {
        if ch.is_whitespace() && quote.is_none() {
            push_launch_token(&mut tokens, &mut raw_token, &mut value);
            escaped = false;
            continue;
        }

        raw_token.push(ch);
        if matches!(ch, '\'' | '"') && !escaped {
            match quote {
                Some(open) if open == ch => quote = None,
                None => quote = Some(ch),
                Some(_) => value.push(ch),
            }
            escaped = false;
            continue;
        }
        value.push(ch);
        escaped = ch == '\\' && !escaped;
        if ch != '\\' {
            escaped = false;
        }
    }
    push_launch_token(&mut tokens, &mut raw_token, &mut value);
    tokens
}

fn push_launch_token(tokens: &mut Vec<LaunchToken>, raw: &mut String, value: &mut String) {
    if !raw.is_empty() {
        tokens.push(LaunchToken {
            raw: std::mem::take(raw),
            value: std::mem::take(value),
        });
    }
}

fn normalized_launch_token(token: &str) -> String {
    let mut normalized = String::new();
    let mut chars = token.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\\' && chars.peek().is_some_and(|next| matches!(next, '\'' | '"')) {
            continue;
        }
        if !matches!(ch, '\'' | '"') {
            normalized.extend(ch.to_lowercase());
        }
    }
    normalized
}

fn launch_token_is_forbidden(token: &str) -> bool {
    matches!(token, "-autoconfig" | "-default" | "+quit" | "gamemoderun")
        || token.starts_with("-dxlevel")
        || token.contains("%command%")
}

fn prefer_most_recent(steam_roots: &[PathBuf], pool: &[SteamAccount]) -> Option<SteamAccount> {
    for steam_root in steam_roots {
        let loginusers = steam_root.join("config").join("loginusers.vdf");
        let Ok(text) = read_small_text_bounded(&loginusers, MAX_LOGINUSERS_BYTES) else {
            continue;
        };
        let Ok(vdf) = parse_vdf(&text) else {
            continue;
        };
        let Some(account_id) = most_recent_account_id(&vdf) else {
            continue;
        };
        if let Some(match_account) = pool
            .iter()
            .find(|account| account.steam_root == *steam_root && account.account_id == account_id)
        {
            return Some(match_account.clone());
        }
    }
    None
}

fn most_recent_account_id(vdf: &VdfMap) -> Option<String> {
    let users = vdf
        .get("users")
        .or_else(|| vdf.get("Users"))
        .and_then(VdfValue::as_obj)?;
    for (steam_id64, value) in &users.entries {
        let Some(obj) = value.as_obj() else {
            continue;
        };
        let most_recent = obj
            .get("MostRecent")
            .or_else(|| obj.get("mostrecent"))
            .and_then(VdfValue::as_str)
            .unwrap_or("");
        if most_recent == "1" {
            return steamid64_to_account(steam_id64);
        }
    }
    None
}

fn steamid64_to_account(id: &str) -> Option<String> {
    let n: u64 = id.parse().ok()?;
    n.checked_sub(STEAM_ID64_BASE).map(|id| id.to_string())
}

fn launch_options_from_localconfig(vdf: &VdfMap) -> Option<String> {
    let store = vdf
        .get("UserLocalConfigStore")
        .and_then(VdfValue::as_obj)
        .unwrap_or(vdf);
    let apps = vdf_get_obj(store, &["Software", "Valve", "Steam", "apps"])?;
    let app = apps.get(TF2_APP)?.as_obj()?;
    app.get("LaunchOptions")
        .and_then(VdfValue::as_str)
        .map(str::to_string)
}

fn localconfig_mentions_440(path: &Path) -> bool {
    let Ok(text) = read_small_text_bounded(path, MAX_LOCALCONFIG_BYTES) else {
        return false;
    };
    let Ok(vdf) = parse_vdf(&text) else {
        return false;
    };
    launch_options_from_localconfig(&vdf).is_some() || vdf_has_app_440(&vdf)
}

fn vdf_has_app_440(vdf: &VdfMap) -> bool {
    let store = vdf
        .get("UserLocalConfigStore")
        .and_then(VdfValue::as_obj)
        .unwrap_or(vdf);
    vdf_get_obj(store, &["Software", "Valve", "Steam", "apps"])
        .and_then(|apps| apps.get(TF2_APP))
        .is_some()
}

fn vdf_get_obj<'a>(map: &'a VdfMap, keys: &[&str]) -> Option<&'a VdfMap> {
    let mut current = map;
    for key in keys {
        current = current.get(key)?.as_obj()?;
    }
    Some(current)
}

fn localconfig_mtime(path: &Path) -> SystemTime {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[cfg(unix)]
    fn link_dir(target: &Path, link: &Path) {
        std::os::unix::fs::symlink(target, link).unwrap();
    }

    #[cfg(windows)]
    fn link_dir(target: &Path, link: &Path) {
        let status = std::process::Command::new("cmd")
            .args(["/d", "/c", "mklink", "/j"])
            .arg(link)
            .arg(target)
            .status()
            .unwrap();
        assert!(status.success(), "could not create test junction");
    }

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let mut file = fs::File::create(path).unwrap();
        file.write_all(contents.as_bytes()).unwrap();
    }

    #[test]
    fn account_discovery_refuses_linked_config_and_cloud_ancestors() {
        let dir = crate::test_temp_dir();
        let steam = dir.join("Steam");
        let account = steam.join("userdata").join("111");
        let outside_config = dir.join("outside-config");
        write_file(
            &outside_config.join("localconfig.vdf"),
            &localconfig("-console"),
        );
        fs::create_dir_all(&account).unwrap();
        link_dir(&outside_config, &account.join("config"));
        assert!(pick_steam_account_from(std::slice::from_ref(&steam)).is_none());

        #[cfg(unix)]
        fs::remove_file(account.join("config")).unwrap();
        #[cfg(windows)]
        fs::remove_dir(account.join("config")).unwrap();
        write_file(
            &account.join("config/localconfig.vdf"),
            &localconfig("-console"),
        );
        let outside_cloud = dir.join("outside-cloud");
        write_file(&outside_cloud.join("remote/cfg/config.cfg"), "external\n");
        link_dir(&outside_cloud, &account.join("440"));

        assert_eq!(find_cloud_config_from(std::slice::from_ref(&steam)), None);
        assert_eq!(cloud_config_path_from(&[steam]), None);
    }

    fn localconfig(options: &str) -> String {
        format!(
            r#""UserLocalConfigStore"
{{
	"Software"
	{{
		"Valve"
		{{
			"Steam"
			{{
				"apps"
				{{
					"440"
					{{
						"LaunchOptions"		"{options}"
					}}
				}}
			}}
		}}
	}}
}}
"#
        )
    }

    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn strips_banned_launch_tokens() {
        assert_eq!(
            sanitize_launch_options("-novid -autoconfig -default -dxlevel 90 +quit -console"),
            "-novid -console"
        );
        assert_eq!(sanitize_launch_options("-dxlevel90 -novid"), "-novid");
        assert_eq!(sanitize_launch_options(""), "");
        // AGENTS.md RND-158 names `gamemoderun %command%` alongside the rest.
        assert_eq!(
            sanitize_launch_options("gamemoderun %command% -novid"),
            "-novid"
        );
        assert_eq!(
            sanitize_launch_options("mangohud %command% -nojoy"),
            "mangohud -nojoy"
        );
        assert_eq!(sanitize_launch_options("GAMEMODERUN -novid"), "-novid");
    }

    #[test]
    fn strips_quoted_fragmented_and_nested_banned_launch_tokens() {
        assert_eq!(
            sanitize_launch_options(
                r#""-autoconfig" -auto"config" "-dxlevel" "90" "+quit" "gamemoderun" "%command%" -novid"#,
            ),
            "-novid"
        );
        assert_eq!(
            sanitize_launch_options(r#"+exec "my config.cfg" -console"#),
            r#"+exec "my config.cfg" -console"#
        );
        assert!(
            !sanitize_launch_options(r#"bash -c "echo ok; -autoconfig" -novid"#)
                .contains("-autoconfig")
        );
    }

    #[test]
    fn strips_forbidden_commands_around_semicolon_separators() {
        assert_eq!(sanitize_launch_options("+quit;echo x"), "echo x");
        assert_eq!(sanitize_launch_options("+echo x;+quit"), "+echo x");
        assert_eq!(
            sanitize_launch_options("-novid;-autoconfig;-default;+quit;-console"),
            "-novid; -console"
        );
        assert_eq!(
            sanitize_launch_options("gamemoderun;%command%;-novid"),
            "-novid"
        );
        assert_eq!(
            sanitize_launch_options(r#""+quit";+echo ok; +q"uit""#),
            "+echo ok"
        );
        // A quoted fragment is one argument, but it still must not become a
        // hiding place for a forbidden command-buffer token.
        assert_eq!(
            sanitize_launch_options(r#""+quit;echo hidden" -novid"#),
            "-novid"
        );
        assert_eq!(
            sanitize_launch_options(r#"+exec "cfg;name.cfg" -console"#),
            r#"+exec "cfg;name.cfg" -console"#
        );
    }

    #[test]
    fn localconfig_write_backs_up_once_and_leaves_no_part_file() {
        let dir = crate::test_temp_dir();
        let steam = dir.join("Steam");
        write_account(&steam, "111", "-novid");
        let path = steam
            .join("userdata")
            .join("111")
            .join("config")
            .join("localconfig.vdf");
        let original = fs::read(&path).unwrap();

        write_launch_options_to_localconfig_from(
            std::slice::from_ref(&steam),
            "-nojoy",
            None::<&str>,
        )
        .unwrap();
        let backup = path.with_file_name("localconfig.vdf.execs-backup");
        assert_eq!(fs::read(&backup).unwrap(), original);
        assert!(!path.with_file_name("localconfig.vdf.execs-part").exists());
        assert!(!path
            .with_file_name("localconfig.vdf.execs-backup.execs-part")
            .exists());

        // A second write must not overwrite the pristine copy.
        write_launch_options_to_localconfig_from(
            std::slice::from_ref(&steam),
            "-console",
            None::<&str>,
        )
        .unwrap();
        assert_eq!(fs::read(&backup).unwrap(), original);
        assert_eq!(
            read_launch_options_from(std::slice::from_ref(&steam)),
            "-console"
        );
        cleanup(&dir);
    }

    #[test]
    fn refuses_an_invalid_existing_localconfig_backup() {
        let dir = crate::test_temp_dir();
        let steam = dir.join("Steam");
        write_account(&steam, "111", "-novid");
        let path = steam
            .join("userdata")
            .join("111")
            .join("config")
            .join("localconfig.vdf");
        let original = fs::read(&path).unwrap();
        write_file(
            &path.with_file_name("localconfig.vdf.execs-backup"),
            "\"truncated\" {",
        );

        assert!(write_launch_options_to_localconfig_from(
            std::slice::from_ref(&steam),
            "-console",
            None::<&str>,
        )
        .is_err());
        assert_eq!(fs::read(&path).unwrap(), original);
        cleanup(&dir);
    }

    #[test]
    fn write_rejects_a_non_localconfig_backup_without_writing() {
        let dir = crate::test_temp_dir();
        let steam = dir.join("Steam");
        write_account(&steam, "111", "-novid");
        let path = steam
            .join("userdata")
            .join("111")
            .join("config")
            .join("localconfig.vdf");
        let original = fs::read(&path).unwrap();
        let backup = path.with_file_name("localconfig.vdf.execs-backup");
        write_file(&backup, "\"unrelated\" \"but valid VDF\"\n");

        assert!(write_launch_options_to_localconfig_from(
            std::slice::from_ref(&steam),
            "-console",
            None::<&str>,
        )
        .is_err());
        assert_eq!(fs::read(&path).unwrap(), original);
        assert_eq!(
            fs::read_to_string(&backup).unwrap(),
            "\"unrelated\" \"but valid VDF\"\n"
        );
        cleanup(&dir);
    }

    #[test]
    fn rechecks_steam_after_parsing_before_any_write() {
        let dir = crate::test_temp_dir();
        let steam = dir.join("Steam");
        write_account(&steam, "111", "-novid");
        let path = steam
            .join("userdata")
            .join("111")
            .join("config")
            .join("localconfig.vdf");
        let original = fs::read(&path).unwrap();
        let mut checks = 0;

        let result = write_launch_options_to_localconfig_checked(
            std::slice::from_ref(&steam),
            "-console",
            || {
                checks += 1;
                checks >= 2
            },
        )
        .unwrap();

        assert_eq!(result.reason, LaunchWriteReason::SteamOpen);
        assert_eq!(fs::read(&path).unwrap(), original);
        assert!(!path.with_file_name("localconfig.vdf.execs-backup").exists());
        cleanup(&dir);
    }

    #[test]
    fn localconfig_conditionals_survive_the_rewrite() {
        let dir = crate::test_temp_dir();
        let steam = dir.join("Steam");
        let path = steam
            .join("userdata")
            .join("111")
            .join("config")
            .join("localconfig.vdf");
        // A naive parser reads `"key" "value" [$WIN32]` as the key `[$WIN32]`
        // whose value is the next key, shifting everything after it by one.
        let text = localconfig("-novid").replace(
            "\"LaunchOptions\"\t\t\"-novid\"",
            "\"LaunchOptions\"\t\t\"-novid\"\n\t\t\t\t\t\t\t\"Cloud\"\t\t\"1\" [$WIN32]\n\t\t\t\t\t\t\t\"LastPlayed\"\t\t\"99\"",
        );
        write_file(&path, &text);
        fs::create_dir_all(steam.join("userdata").join("111").join("440")).unwrap();

        write_launch_options_to_localconfig_from(
            std::slice::from_ref(&steam),
            "-nojoy",
            None::<&str>,
        )
        .unwrap();

        let after = parse_vdf(&fs::read_to_string(&path).unwrap()).unwrap();
        let app = vdf_get_obj(
            &after,
            &[
                "UserLocalConfigStore",
                "Software",
                "Valve",
                "Steam",
                "apps",
                "440",
            ],
        )
        .unwrap();
        assert_eq!(app.get("Cloud").and_then(VdfValue::as_str), Some("1"));
        assert_eq!(app.get("LastPlayed").and_then(VdfValue::as_str), Some("99"));
        assert_eq!(
            app.get("LaunchOptions").and_then(VdfValue::as_str),
            Some("-nojoy")
        );
        assert!(fs::read_to_string(&path).unwrap().contains("[$WIN32]"));
        cleanup(&dir);
    }

    #[test]
    fn reads_launch_options_from_account_with_440() {
        let dir = crate::test_temp_dir();
        let steam = dir.join("Steam");
        write_file(
            &steam
                .join("userdata")
                .join("111")
                .join("config")
                .join("localconfig.vdf"),
            &localconfig("-novid -windowed"),
        );
        write_file(
            &steam
                .join("userdata")
                .join("111")
                .join("440")
                .join("remote")
                .join("cfg")
                .join("config.cfg"),
            "unbindall\n",
        );
        write_file(
            &steam
                .join("userdata")
                .join("222")
                .join("config")
                .join("localconfig.vdf"),
            &localconfig("-autoconfig"),
        );

        let options = read_launch_options_from(std::slice::from_ref(&steam));
        assert_eq!(options, "-novid -windowed");
        let cloud = find_cloud_config_from(&[steam]).unwrap();
        assert!(cloud.ends_with(Path::new("440/remote/cfg/config.cfg")));
        cleanup(&dir);
    }

    #[test]
    fn prefers_most_recent_loginusers_account() {
        let dir = crate::test_temp_dir();
        let steam = dir.join("Steam");
        let recent_id64 = STEAM_ID64_BASE + 999;
        write_file(
            &steam.join("config").join("loginusers.vdf"),
            &format!(
                r#""users"
{{
	"{recent_id64}"
	{{
		"MostRecent"		"1"
	}}
	"{}"
	{{
		"MostRecent"		"0"
	}}
}}
"#,
                STEAM_ID64_BASE + 111
            ),
        );
        write_file(
            &steam
                .join("userdata")
                .join("999")
                .join("config")
                .join("localconfig.vdf"),
            &localconfig("-console"),
        );
        fs::create_dir_all(steam.join("userdata").join("999").join("440")).unwrap();
        write_file(
            &steam
                .join("userdata")
                .join("111")
                .join("config")
                .join("localconfig.vdf"),
            &localconfig("-novid"),
        );
        fs::create_dir_all(steam.join("userdata").join("111").join("440")).unwrap();

        assert_eq!(read_launch_options_from(&[steam]), "-console");
        cleanup(&dir);
    }

    #[test]
    fn most_recent_account_wins_even_before_its_440_directory_exists() {
        let dir = crate::test_temp_dir();
        let steam = dir.join("Steam");
        let recent_id64 = STEAM_ID64_BASE + 999;
        write_file(
            &steam.join("config").join("loginusers.vdf"),
            &format!(
                r#""users"
{{
	"{recent_id64}"
	{{
		"MostRecent"		"1"
	}}
}}
"#,
            ),
        );
        write_file(
            &steam
                .join("userdata")
                .join("999")
                .join("config")
                .join("localconfig.vdf"),
            &localconfig("-console"),
        );
        write_account(&steam, "111", "-novid");

        assert_eq!(read_launch_options_from(&[steam]), "-console");
        cleanup(&dir);
    }

    #[test]
    fn missing_steam_data_is_empty() {
        let dir = crate::test_temp_dir();
        assert_eq!(read_launch_options_from(&[dir.join("none")]), "");
        assert_eq!(find_cloud_config_from(&[dir.join("none")]), None);
        cleanup(&dir);
    }

    #[test]
    fn recommended_is_the_official_comfig_set() {
        let expected = "-novid -nojoy -nosteamcontroller -nohltv -particles 1";
        assert_eq!(recommended_launch_options(), expected);
        assert_eq!(
            sanitize_launch_options(&format!(
                "{expected} -autoconfig -default -dxlevel 90 +quit"
            )),
            expected
        );
    }

    fn write_account(steam: &Path, account: &str, options: &str) {
        write_file(
            &steam
                .join("userdata")
                .join(account)
                .join("config")
                .join("localconfig.vdf"),
            &localconfig(options),
        );
        fs::create_dir_all(steam.join("userdata").join(account).join("440")).unwrap();
    }

    #[test]
    fn writes_localconfig_when_steam_names_empty() {
        let dir = crate::test_temp_dir();
        let steam = dir.join("Steam");
        write_account(&steam, "111", "-novid");

        let result = write_launch_options_to_localconfig_from(
            std::slice::from_ref(&steam),
            "-novid -nojoy -autoconfig +quit",
            None::<&str>,
        )
        .unwrap();
        assert_eq!(
            result,
            LaunchWriteResult {
                written: true,
                reason: LaunchWriteReason::Written,
            }
        );
        assert_eq!(
            read_launch_options_from(std::slice::from_ref(&steam)),
            "-novid -nojoy"
        );
        let text = fs::read_to_string(
            steam
                .join("userdata")
                .join("111")
                .join("config")
                .join("localconfig.vdf"),
        )
        .unwrap();
        let vdf = parse_vdf(&text).unwrap();
        assert_eq!(
            launch_options_from_localconfig(&vdf).as_deref(),
            Some("-novid -nojoy")
        );
        cleanup(&dir);
    }

    #[test]
    fn skips_localconfig_when_steam_is_open() {
        let dir = crate::test_temp_dir();
        let steam = dir.join("Steam");
        write_account(&steam, "111", "-novid");

        let result = write_launch_options_to_localconfig_from(
            std::slice::from_ref(&steam),
            "-console",
            ["steam"],
        )
        .unwrap();
        assert_eq!(
            result,
            LaunchWriteResult {
                written: false,
                reason: LaunchWriteReason::SteamOpen,
            }
        );
        assert_eq!(read_launch_options_from(&[steam]), "-novid");
        cleanup(&dir);
    }

    #[test]
    fn write_without_account_is_no_account() {
        let dir = crate::test_temp_dir();
        let result =
            write_launch_options_to_localconfig_from(&[dir.join("none")], "-novid", None::<&str>)
                .unwrap();
        assert_eq!(
            result,
            LaunchWriteResult {
                written: false,
                reason: LaunchWriteReason::NoAccount,
            }
        );
        cleanup(&dir);
    }

    #[test]
    fn oversized_localconfig_and_backup_are_rejected_without_replacement() {
        let dir = crate::test_temp_dir();
        let steam = dir.join("Steam");
        write_account(&steam, "111", "-old");
        let localconfig_path = steam.join("userdata/111/config/localconfig.vdf");
        fs::File::create(&localconfig_path)
            .unwrap()
            .set_len(MAX_LOCALCONFIG_BYTES as u64 + 1)
            .unwrap();
        assert_eq!(read_launch_options_from(std::slice::from_ref(&steam)), "");
        assert!(write_launch_options_to_localconfig_from(
            std::slice::from_ref(&steam),
            "-console",
            None::<&str>,
        )
        .is_err());
        assert_eq!(
            fs::metadata(&localconfig_path).unwrap().len(),
            MAX_LOCALCONFIG_BYTES as u64 + 1
        );

        write_file(&localconfig_path, &localconfig("-old"));
        let backup = localconfig_path.with_file_name("localconfig.vdf.execs-backup");
        fs::File::create(&backup)
            .unwrap()
            .set_len(MAX_LOCALCONFIG_BYTES as u64 + 1)
            .unwrap();
        assert!(write_launch_options_to_localconfig_from(
            std::slice::from_ref(&steam),
            "-console",
            None::<&str>,
        )
        .is_err());
        assert_eq!(read_launch_options_from(&[steam]), "-old");
        cleanup(&dir);
    }

    #[test]
    fn oversized_loginusers_is_ignored_during_account_selection() {
        let dir = crate::test_temp_dir();
        let steam = dir.join("Steam");
        write_account(&steam, "111", "-old");
        let loginusers = steam.join("config/loginusers.vdf");
        fs::create_dir_all(loginusers.parent().unwrap()).unwrap();
        fs::File::create(&loginusers)
            .unwrap()
            .set_len(MAX_LOGINUSERS_BYTES as u64 + 1)
            .unwrap();
        let account = pick_steam_account_from(std::slice::from_ref(&steam)).unwrap();
        assert_eq!(account.account_id, "111");
        cleanup(&dir);
    }

    fn tf2_name() -> &'static str {
        if cfg!(windows) {
            "tf_win64.exe"
        } else {
            "tf_linux64"
        }
    }

    #[test]
    fn set_profile_sanitizes_and_writes_steam_when_closed() {
        let dir = crate::test_temp_dir();
        let root = dir.join("Team Fortress 2");
        let profiles = dir.join("profiles");
        let steam = dir.join("Steam");
        write_file(&root.join("tf/steam.inf"), "appID=440\n");
        write_account(&steam, "111", "-old");
        let library =
            crate::profile::create_profile_record_to(&profiles, &root, "Main", None::<&str>)
                .unwrap();
        let id = library.profiles[0].id.clone();
        crate::profile::set_active_profile_to(&profiles, &root, &id, None::<&str>).unwrap();

        let result = set_profile_launch_options_to(
            &profiles,
            &root,
            &id,
            "-novid -autoconfig -dxlevel 90 +quit -console",
            None::<&str>,
            None::<&str>,
            std::slice::from_ref(&steam),
        )
        .unwrap();
        assert_eq!(result.launch_options, "-novid -console");
        assert_eq!(result.steam_write, LaunchWriteReason::Written);
        assert_eq!(
            get_profile_launch_options_from(&profiles, &root, &id).unwrap(),
            "-novid -console"
        );
        assert_eq!(read_launch_options_from(&[steam]), "-novid -console");
        cleanup(&dir);
    }

    #[test]
    fn set_profile_saves_library_when_steam_is_open() {
        let dir = crate::test_temp_dir();
        let root = dir.join("Team Fortress 2");
        let profiles = dir.join("profiles");
        let steam = dir.join("Steam");
        write_file(&root.join("tf/steam.inf"), "appID=440\n");
        write_account(&steam, "111", "-old");
        let library =
            crate::profile::create_profile_record_to(&profiles, &root, "Main", None::<&str>)
                .unwrap();
        let id = library.profiles[0].id.clone();
        crate::profile::set_active_profile_to(&profiles, &root, &id, None::<&str>).unwrap();

        let result = set_profile_launch_options_to(
            &profiles,
            &root,
            &id,
            "-console",
            None::<&str>,
            ["steam"],
            std::slice::from_ref(&steam),
        )
        .unwrap();
        assert_eq!(result.launch_options, "-console");
        assert_eq!(result.steam_write, LaunchWriteReason::SteamOpen);
        assert_eq!(
            load_manifest(&profiles, &id).unwrap().launch_options,
            "-console"
        );
        assert_eq!(read_launch_options_from(&[steam]), "-old");
        cleanup(&dir);
    }

    #[test]
    fn set_profile_keeps_a_retryable_commit_when_localconfig_sync_fails() {
        let dir = crate::test_temp_dir();
        let root = dir.join("Team Fortress 2");
        let profiles = dir.join("profiles");
        let steam = dir.join("Steam");
        write_file(&root.join("tf/steam.inf"), "appID=440\n");
        write_account(&steam, "111", "-old");
        let localconfig = steam
            .join("userdata")
            .join("111")
            .join("config")
            .join("localconfig.vdf");
        write_file(
            &localconfig.with_file_name("localconfig.vdf.execs-backup"),
            "\"not-localconfig\" \"but-valid-vdf\"\n",
        );
        let library =
            crate::profile::create_profile_record_to(&profiles, &root, "Main", None::<&str>)
                .unwrap();
        let id = library.profiles[0].id.clone();
        crate::profile::set_active_profile_to(&profiles, &root, &id, None::<&str>).unwrap();

        let result = set_profile_launch_options_to(
            &profiles,
            &root,
            &id,
            "-console",
            None::<&str>,
            None::<&str>,
            std::slice::from_ref(&steam),
        )
        .unwrap();
        assert_eq!(result.steam_write, LaunchWriteReason::WriteFailed);
        let manifest = load_manifest(&profiles, &id).unwrap();
        assert_eq!(manifest.launch_options, "-console");
        assert!(manifest.launch_sync_pending);
        assert_eq!(read_launch_options_from(&[steam]), "-old");
        cleanup(&dir);
    }

    #[test]
    fn set_profile_refuses_while_tf2_running() {
        let dir = crate::test_temp_dir();
        let root = dir.join("Team Fortress 2");
        let profiles = dir.join("profiles");
        write_file(&root.join("tf/steam.inf"), "appID=440\n");
        let library =
            crate::profile::create_profile_record_to(&profiles, &root, "Main", None::<&str>)
                .unwrap();
        let id = library.profiles[0].id.clone();
        let err = set_profile_launch_options_to(
            &profiles,
            &root,
            &id,
            "-novid",
            [tf2_name()],
            None::<&str>,
            &[],
        )
        .unwrap_err();
        assert_eq!(err, ProfileError::GameRunning);
        assert_eq!(load_manifest(&profiles, &id).unwrap().launch_options, "");
        cleanup(&dir);
    }

    /// Every manifest write goes through `save_manifest`, so the index's
    /// `updated_at` moves with it; a writer that skips it leaves the UI showing
    /// a stale "last updated".
    #[test]
    fn setting_launch_options_touches_the_profile_record() {
        let dir = crate::test_temp_dir();
        let root = dir.join("Team Fortress 2");
        let profiles = dir.join("profiles");
        write_file(&root.join("tf/steam.inf"), "appID=440\n");
        let library =
            crate::profile::create_profile_record_to(&profiles, &root, "Main", None::<&str>)
                .unwrap();
        let id = library.profiles[0].id.clone();

        let index_path = crate::profile::index_file(&profiles);
        let mut index: crate::profile::LibraryIndex =
            serde_json::from_str(&fs::read_to_string(&index_path).unwrap()).unwrap();
        index.profiles[0].updated_at = "2000-01-01T00:00:00Z".to_string();
        fs::write(
            &index_path,
            format!("{}\n", serde_json::to_string_pretty(&index).unwrap()),
        )
        .unwrap();

        set_profile_launch_options_to(
            &profiles,
            &root,
            &id,
            "-novid",
            None::<&str>,
            ["steam"],
            &[],
        )
        .unwrap();

        let after: crate::profile::LibraryIndex =
            serde_json::from_str(&fs::read_to_string(&index_path).unwrap()).unwrap();
        assert_ne!(after.profiles[0].updated_at, "2000-01-01T00:00:00Z");
        cleanup(&dir);
    }
}
