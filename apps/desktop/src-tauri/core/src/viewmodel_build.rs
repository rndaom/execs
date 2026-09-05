//! Build a Yttrium-style viewmodel pack: hide chosen animation groups by
//! rewriting their SMD sequences off-screen, recompile each class's shared
//! animation model with TF2's own studiomdl, and pack the results into a VPK.
//! Everything happens in an isolated staging root — the live `tf/` tree is
//! never written.

use std::collections::{BTreeMap, BTreeSet};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};

use zip::ZipArchive;

use crate::profile::ProfileError;
use crate::viewmodel_groups::{ViewmodelGroup, SOLDIER_FORCED_FILES, VIEWMODEL_GROUPS};
use crate::vpk::write_vpk_v2;

const MAX_ANIMATION_ARCHIVE_ENTRIES: usize = 20_000;
const MAX_ANIMATIONS_ZIP_BYTES: usize = 256 * 1024 * 1024;
const MAX_SOURCE_ENTRY_BYTES: u64 = 32 * 1024 * 1024;
const MAX_EXTRACTED_SOURCE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_REWRITTEN_SMD_BYTES: usize = 64 * 1024 * 1024;
const MAX_STUDIOMDL_LOG_BYTES: u64 = 8 * 1024 * 1024;
const MAX_STUDIOMDL_LOG_TAIL_BYTES: u64 = 64 * 1024;
const MAX_COMPILED_MODEL_BYTES: u64 = 32 * 1024 * 1024;
const MAX_COMPILED_MODELS_BYTES: u64 = 128 * 1024 * 1024;
const STREAM_BUFFER_BYTES: usize = 64 * 1024;

pub fn viewmodel_group(id: &str) -> Option<&'static ViewmodelGroup> {
    VIEWMODEL_GROUPS.iter().find(|group| group.id == id)
}

/// How much of the viewmodel a hidden group removes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
#[derive(Default)]
pub enum ViewmodelHideMode {
    /// Move every bone off-screen — the weapon *and* the arms disappear.
    /// This is what CompVMInstaller does.
    #[default]
    Full,
    /// Move only the weapon attachment bones. The weapon disappears while the
    /// hands keep their normal animation.
    Weapon,
}

impl ViewmodelHideMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Full => "full",
            Self::Weapon => "weapon",
        }
    }

    pub fn from_str_or_default(value: Option<&str>) -> Self {
        match value {
            Some("weapon") => Self::Weapon,
            _ => Self::Full,
        }
    }
}

/// The weapon model is bone-merged onto these; every class parents them to
/// `bip_hand_L`/`bip_hand_R`, so moving them alone takes the weapon away and
/// leaves the arms animating.
fn is_weapon_bone(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.starts_with("weapon_bone") || lower.starts_with("vm_weapon_bone")
}

fn section(lines: &[&str], keyword: &str) -> Option<usize> {
    lines.iter().position(|line| line.trim() == keyword)
}

/// `  12 "bip_hand_R" 7` → (12, "bip_hand_R")
fn parse_node_line(line: &str) -> Option<(usize, &str)> {
    let trimmed = line.trim();
    let (index_text, rest) = trimmed.split_once(' ')?;
    let index = index_text.parse::<usize>().ok()?;
    let rest = rest.trim_start();
    let quoted = rest.strip_prefix('"')?;
    let end = quoted.find('"')?;
    Some((index, &quoted[..end]))
}

/// Leading bone index of a skeleton row like `    12 0.5 1.0 ...`.
fn parse_skeleton_row_index(line: &str) -> Option<usize> {
    let trimmed = line.trim_start();
    let (head, _) = trimmed.split_once(' ')?;
    head.parse::<usize>().ok()
}

/// Rewrite one SMD so the chosen bones sit far off-screen for the sequence.
pub fn hide_smd_sequence(text: &str, mode: ViewmodelHideMode) -> Result<String, String> {
    if text.len() > MAX_SOURCE_ENTRY_BYTES as usize {
        return Err(format!(
            "SMD input exceeds the {} MiB safety limit.",
            MAX_SOURCE_ENTRY_BYTES / (1024 * 1024)
        ));
    }
    match mode {
        ViewmodelHideMode::Full => hide_all_bones(text),
        ViewmodelHideMode::Weapon => hide_weapon_bones(text),
    }
}

fn push_smd_bounded(output: &mut String, value: &str) -> Result<(), String> {
    push_string_bounded(output, value, MAX_REWRITTEN_SMD_BYTES, "Rewritten SMD")
}

fn push_string_bounded(
    output: &mut String,
    value: &str,
    limit: usize,
    label: &str,
) -> Result<(), String> {
    let next_len = output
        .len()
        .checked_add(value.len())
        .ok_or_else(|| format!("{label} size overflowed."))?;
    if next_len > limit {
        return Err(format!("{label} exceeds its safety limit."));
    }
    output.push_str(value);
    Ok(())
}

/// Byte offset of `lines[index]` within `text`. `str::lines` drops the line
/// terminators, so the offsets have to be accumulated rather than searched for.
fn line_offset(text: &str, lines: &[&str], index: usize) -> usize {
    let mut offset = 0usize;
    for line in lines.iter().take(index) {
        offset += line.len();
        // Re-add whatever terminator followed this line.
        let rest = &text[offset..];
        if let Some(stripped) = rest.strip_prefix("\r\n") {
            offset += rest.len() - stripped.len();
        } else if rest.starts_with('\n') {
            offset += 1;
        }
    }
    offset
}

/// Faithful to CompVMInstaller's EditFile: keep everything before `skeleton`,
/// emit frame 0 with all bones at (-100,-100,-100) rot 0, then empty frames so
/// the original frame count (and therefore timing/anim events) is preserved.
fn hide_all_bones(text: &str) -> Result<String, String> {
    let lines: Vec<&str> = text.lines().collect();
    let nodes = section(&lines, "nodes").ok_or("SMD has no nodes section.")?;
    let skeleton = section(&lines, "skeleton").ok_or("SMD has no skeleton section.")?;
    if skeleton < nodes + 2 {
        return Err("SMD nodes section is malformed.".into());
    }
    let bones = skeleton - nodes - 2;
    let frames = lines
        .iter()
        .filter(|line| line.trim_start().starts_with("time "))
        .count()
        .max(1);
    // Cut at the byte offset of the `skeleton` line we actually located. A
    // bone named `*skeleton*` or a header comment containing the word would
    // otherwise truncate the nodes section and produce an SMD studiomdl
    // rejects.
    let cut = line_offset(text, &lines, skeleton);
    let estimated = cut
        .saturating_add(bones.saturating_mul(40))
        .saturating_add(frames.saturating_mul(32))
        .saturating_add(16)
        .min(MAX_REWRITTEN_SMD_BYTES);
    let mut out = String::with_capacity(estimated);
    push_smd_bounded(&mut out, &text[..cut])?;
    push_smd_bounded(&mut out, "skeleton\n  time 0\n")?;
    for bone in 0..bones {
        push_smd_bounded(&mut out, &format!("    {bone} -100 -100 -100 0 0 0\n"))?;
    }
    for frame in 1..frames {
        push_smd_bounded(&mut out, &format!("  time {frame}\n"))?;
    }
    push_smd_bounded(&mut out, "end\n")?;
    Ok(out)
}

/// Keep every frame of arm animation; rewrite only the weapon bones' rows.
/// Their transforms are parent-local, so -100 on a hand-parented bone parks
/// the weapon far from the camera without moving the hand.
fn hide_weapon_bones(text: &str) -> Result<String, String> {
    let lines: Vec<&str> = text.lines().collect();
    let nodes = section(&lines, "nodes").ok_or("SMD has no nodes section.")?;
    let skeleton = section(&lines, "skeleton").ok_or("SMD has no skeleton section.")?;
    if skeleton < nodes + 2 {
        return Err("SMD nodes section is malformed.".into());
    }
    let weapon_bones: BTreeSet<usize> = lines[nodes + 1..skeleton - 1]
        .iter()
        .filter_map(|line| parse_node_line(line))
        .filter(|(_, name)| is_weapon_bone(name))
        .map(|(index, _)| index)
        .collect();
    if weapon_bones.is_empty() {
        return Err("SMD has no weapon bones to hide.".into());
    }

    let mut out = String::with_capacity(text.len());
    for (position, line) in lines.iter().enumerate() {
        let rewritten = if position > skeleton {
            parse_skeleton_row_index(line)
                .filter(|index| weapon_bones.contains(index))
                .map(|index| format!("    {index} -100 -100 -100 0 0 0"))
        } else {
            None
        };
        push_smd_bounded(&mut out, rewritten.as_deref().unwrap_or(line))?;
        push_smd_bounded(&mut out, "\n")?;
    }
    Ok(out)
}

/// Minimal gameinfo.txt so studiomdl accepts the staging dir as its game root
/// and writes compiled models under it instead of the live install.
pub fn write_staging_gameinfo(dir: &Path) -> Result<(), ProfileError> {
    std::fs::create_dir_all(dir).map_err(|err| ProfileError::Io(err.to_string()))?;
    let gameinfo = concat!(
        "\"GameInfo\"\n{\n",
        "\tgame\t\"execs viewmodel staging\"\n",
        "\tFileSystem\n\t{\n",
        "\t\tSteamAppId\t440\n",
        "\t\tToolsAppId\t211\n",
        "\t\tSearchPaths\n\t\t{\n",
        "\t\t\tgame\t|gameinfo_path|.\n",
        "\t\t}\n\t}\n}\n",
    );
    std::fs::write(dir.join("gameinfo.txt"), gameinfo)
        .map_err(|err| ProfileError::Io(err.to_string()))
}

fn model_name_from_qc(qc: &str) -> Option<String> {
    for line in qc.lines() {
        let trimmed = line.trim();
        if trimmed.to_ascii_lowercase().starts_with("$modelname") {
            let value = trimmed["$modelname".len()..].trim().trim_matches('"');
            return Some(value.replace('\\', "/"));
        }
    }
    None
}

fn checked_normal_relative_path(raw: &str, label: &str) -> Result<(PathBuf, String), ProfileError> {
    let portable = raw.replace('\\', "/");
    let path = Path::new(&portable);
    if portable.is_empty() || path.is_absolute() {
        return Err(ProfileError::Io(format!(
            "{label} is not a normal relative path."
        )));
    }
    let mut out = PathBuf::new();
    let mut parts = Vec::new();
    for component in path.components() {
        let Component::Normal(value) = component else {
            return Err(ProfileError::Io(format!(
                "{label} is not a normal relative path."
            )));
        };
        let value = value
            .to_str()
            .ok_or_else(|| ProfileError::Io(format!("{label} is not valid Unicode.")))?;
        if value.is_empty()
            || value.contains(':')
            || value.chars().any(|character| character.is_control())
        {
            return Err(ProfileError::Io(format!(
                "{label} contains an invalid path component."
            )));
        }
        out.push(value);
        parts.push(value);
    }
    if parts.is_empty() {
        return Err(ProfileError::Io(format!(
            "{label} is not a normal relative path."
        )));
    }
    Ok((out, parts.join("/")))
}

fn checked_model_name_from_qc(qc: &str) -> Result<String, ProfileError> {
    let raw =
        model_name_from_qc(qc).ok_or_else(|| ProfileError::Io("QC has no $ModelName.".into()))?;
    let (_, model_name) = checked_normal_relative_path(&raw, "QC $ModelName")?;
    if !model_name.to_ascii_lowercase().ends_with(".mdl") {
        return Err(ProfileError::Io(
            "QC $ModelName must name a relative .mdl file.".into(),
        ));
    }
    Ok(model_name)
}

/// Classes touched by the hidden-group set, as their zip folder names.
fn changed_zip_folders(hidden_groups: &BTreeSet<String>) -> Result<Vec<String>, ProfileError> {
    let mut folders: Vec<String> = Vec::new();
    for id in hidden_groups {
        let group = viewmodel_group(id)
            .ok_or_else(|| ProfileError::Io(format!("Unknown viewmodel group {id}.")))?;
        if !folders.iter().any(|folder| folder == group.zip_folder) {
            folders.push(group.zip_folder.to_string());
        }
    }
    Ok(folders)
}

/// Files to hide for one class folder (group files plus Soldier's forced set).
fn hidden_files_for_folder(hidden_groups: &BTreeSet<String>, zip_folder: &str) -> BTreeSet<String> {
    let mut files = BTreeSet::new();
    for id in hidden_groups {
        if let Some(group) = viewmodel_group(id) {
            if group.zip_folder == zip_folder {
                for file in group.files {
                    files.insert((*file).to_string());
                }
            }
        }
    }
    if zip_folder == "soldier" && !files.is_empty() {
        for file in SOLDIER_FORCED_FILES {
            files.insert((*file).to_string());
        }
    }
    files
}

#[derive(Default)]
struct ExtractionBudget {
    entries: usize,
    bytes: u64,
}

fn size_limit_error(label: &str, limit: u64) -> ProfileError {
    ProfileError::Io(format!(
        "{label} exceeds the {} MiB safety limit.",
        limit / (1024 * 1024)
    ))
}

/// Copy through one reader with fixed memory while refusing the first byte
/// beyond `limit`. The ZIP header is only a preflight hint; this is the
/// authoritative bound if a malformed archive reports a smaller size.
fn copy_bounded(
    input: &mut impl Read,
    output: &mut impl Write,
    limit: u64,
    label: &str,
) -> Result<u64, ProfileError> {
    let mut copied = 0_u64;
    let mut buffer = [0_u8; STREAM_BUFFER_BYTES];
    loop {
        let read = input
            .read(&mut buffer)
            .map_err(|err| ProfileError::Io(err.to_string()))?;
        if read == 0 {
            return Ok(copied);
        }
        copied = copied
            .checked_add(read as u64)
            .ok_or_else(|| size_limit_error(label, limit))?;
        if copied > limit {
            return Err(size_limit_error(label, limit));
        }
        output
            .write_all(&buffer[..read])
            .map_err(|err| ProfileError::Io(err.to_string()))?;
    }
}

fn read_bounded(input: &mut impl Read, limit: u64, label: &str) -> Result<Vec<u8>, ProfileError> {
    let mut bytes = Vec::new();
    copy_bounded(input, &mut bytes, limit, label)?;
    Ok(bytes)
}

/// Open once, inspect that handle, then read that same handle under a bound.
/// A compiler replacing or extending the path after open cannot redirect the
/// read or make the allocation unbounded.
fn read_file_bounded(path: &Path, limit: u64, label: &str) -> Result<Vec<u8>, ProfileError> {
    let mut file = File::open(path).map_err(|err| ProfileError::Io(err.to_string()))?;
    let declared = file
        .metadata()
        .map_err(|err| ProfileError::Io(err.to_string()))?
        .len();
    if declared > limit {
        return Err(size_limit_error(label, limit));
    }
    read_bounded(&mut file, limit, label)
}

fn read_lossy_file_tail(path: &Path, limit: u64) -> Result<String, ProfileError> {
    let mut file = File::open(path).map_err(|err| ProfileError::Io(err.to_string()))?;
    let len = file
        .metadata()
        .map_err(|err| ProfileError::Io(err.to_string()))?
        .len();
    file.seek(SeekFrom::Start(len.saturating_sub(limit)))
        .map_err(|err| ProfileError::Io(err.to_string()))?;
    let bytes = read_bounded(&mut file, limit, "studiomdl diagnostic tail")?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn enforce_studiomdl_log_limit(log: &File, folder: &str) -> Result<(), ProfileError> {
    let len = log
        .metadata()
        .map_err(|err| ProfileError::Io(format!("Could not inspect studiomdl output: {err}")))?
        .len();
    if len > MAX_STUDIOMDL_LOG_BYTES {
        return Err(ProfileError::Io(format!(
            "studiomdl produced more than {} MiB of diagnostics compiling {folder}; it was stopped.",
            MAX_STUDIOMDL_LOG_BYTES / (1024 * 1024)
        )));
    }
    Ok(())
}

fn validate_animation_zip_len(len: usize) -> Result<(), ProfileError> {
    if len > MAX_ANIMATIONS_ZIP_BYTES {
        return Err(ProfileError::Io(format!(
            "The compressed animation archive may be at most {} MiB.",
            MAX_ANIMATIONS_ZIP_BYTES / (1024 * 1024)
        )));
    }
    Ok(())
}

fn extract_class_sources(
    animations_zip: &[u8],
    zip_folder: &str,
    dest: &Path,
    budget: &mut ExtractionBudget,
) -> Result<PathBuf, ProfileError> {
    validate_animation_zip_len(animations_zip.len())?;
    let mut archive = ZipArchive::new(std::io::Cursor::new(animations_zip))
        .map_err(|err| ProfileError::Io(err.to_string()))?;
    if archive.len() > MAX_ANIMATION_ARCHIVE_ENTRIES {
        return Err(ProfileError::Io(format!(
            "The animation archive has more than {MAX_ANIMATION_ARCHIVE_ENTRIES} entries."
        )));
    }
    // The archive is flat: c_<class>_animations.qc + c_<class>_animations_anims/*.
    let stem = format!("c_{zip_folder}_animations");
    let mut qc_path = None;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|err| ProfileError::Io(err.to_string()))?;
        if entry.enclosed_name().is_none() {
            return Err(ProfileError::Io(
                "The animation archive contains an unsafe path.".into(),
            ));
        }
        let (rel_path, rel) =
            checked_normal_relative_path(entry.name(), "Animation archive entry")?;
        let belongs = rel.eq_ignore_ascii_case(&format!("{stem}.qc"))
            || rel
                .to_ascii_lowercase()
                .starts_with(&format!("{stem}_anims/"));
        if !belongs || entry.is_dir() {
            continue;
        }
        budget.entries = budget
            .entries
            .checked_add(1)
            .ok_or_else(|| ProfileError::Io("Animation source entry count overflowed.".into()))?;
        if budget.entries > MAX_ANIMATION_ARCHIVE_ENTRIES {
            return Err(ProfileError::Io(format!(
                "Selected animation sources have more than {MAX_ANIMATION_ARCHIVE_ENTRIES} entries."
            )));
        }
        if budget.bytes > MAX_EXTRACTED_SOURCE_BYTES {
            return Err(ProfileError::Io(
                "Animation source byte budget is already exhausted.".into(),
            ));
        }
        let remaining = MAX_EXTRACTED_SOURCE_BYTES.saturating_sub(budget.bytes);
        let entry_limit = MAX_SOURCE_ENTRY_BYTES.min(remaining);
        let label = format!("Animation source {rel}");
        if entry.size() > entry_limit {
            return Err(size_limit_error(&label, entry_limit));
        }
        let out_path = dest.join(rel_path);
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent).map_err(|err| ProfileError::Io(err.to_string()))?;
        }
        let mut output =
            File::create(&out_path).map_err(|err| ProfileError::Io(err.to_string()))?;
        let copied = copy_bounded(&mut entry, &mut output, entry_limit, &label)?;
        output
            .flush()
            .map_err(|err| ProfileError::Io(err.to_string()))?;
        budget.bytes = budget
            .bytes
            .checked_add(copied)
            .ok_or_else(|| ProfileError::Io("Animation source byte count overflowed.".into()))?;
        if rel.to_ascii_lowercase().ends_with(".qc") {
            qc_path = Some(out_path.clone());
        }
    }
    qc_path.ok_or_else(|| {
        ProfileError::Io(format!(
            "The animation archive has no QC for class folder {zip_folder}."
        ))
    })
}

/// Run one compile with a hard timeout, returning studiomdl's combined log.
///
/// Output goes to a file rather than pipes: polling `try_wait` while a child
/// fills a pipe buffer deadlocks, and studiomdl is chatty.
fn run_studiomdl(
    studiomdl: &Path,
    game_dir: &Path,
    qc_path: &Path,
    staging: &Path,
    folder: &str,
) -> Result<String, ProfileError> {
    let log_path = staging.join(format!("studiomdl-{folder}.log"));
    if let Some(parent) = log_path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| ProfileError::Io(err.to_string()))?;
    }
    let log = std::fs::File::create(&log_path).map_err(|err| ProfileError::Io(err.to_string()))?;
    let log_monitor = log
        .try_clone()
        .map_err(|err| ProfileError::Io(err.to_string()))?;
    let errors = log
        .try_clone()
        .map_err(|err| ProfileError::Io(err.to_string()))?;
    let mut command = std::process::Command::new(studiomdl);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        // Redirecting output alone still opens a console for each class compile.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command
        .arg("-game")
        .arg(game_dir)
        .arg("-nop4")
        .arg(qc_path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::from(log))
        .stderr(std::process::Stdio::from(errors))
        .spawn()
        .map_err(|err| ProfileError::Io(format!("Could not run studiomdl: {err}")))?;

    let deadline = std::time::Instant::now() + STUDIOMDL_TIMEOUT;
    loop {
        let finished = match child.try_wait() {
            Ok(status) => status.is_some(),
            Err(err) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(ProfileError::Io(format!(
                    "Could not wait for studiomdl: {err}"
                )));
            }
        };
        if let Err(err) = enforce_studiomdl_log_limit(&log_monitor, folder) {
            if !finished {
                let _ = child.kill();
                let _ = child.wait();
            }
            return Err(err);
        }
        if finished {
            break;
        }
        if std::time::Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(ProfileError::Io(format!(
                "studiomdl did not finish within {} seconds compiling {folder}; it was stopped.",
                STUDIOMDL_TIMEOUT.as_secs()
            )));
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    // studiomdl writes in the console code page, not UTF-8. Only its bounded
    // tail is useful to the six-line failure diagnostic below; a compiler
    // that spams for the full timeout must not force the whole log into RAM.
    Ok(read_lossy_file_tail(&log_path, MAX_STUDIOMDL_LOG_TAIL_BYTES).unwrap_or_default())
}

/// Case-insensitive lookup of `<file>.smd` inside the class anims dir.
fn find_smd(anims_dir: &Path, file: &str) -> Option<PathBuf> {
    let wanted = format!("{}.smd", file.to_ascii_lowercase());
    let entries = std::fs::read_dir(anims_dir).ok()?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        if name.to_string_lossy().to_ascii_lowercase() == wanted {
            return Some(entry.path());
        }
    }
    None
}

/// How long one class's compile may take before we kill studiomdl. It can
/// hang for good on a bad QC or a Windows error dialog, and `output()` would
/// then block the calling thread and the pane's busy state forever.
const STUDIOMDL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

/// TF2's compiler binary, under `bin/` in the install. Viewmodel builds are
/// Windows-only (`viewmodel_build_available` gates on the host), so this is
/// the only name a build ever looks for.
pub const STUDIOMDL_FILE_NAME: &str = "studiomdl.exe";

/// Build the pack VPK. `studiomdl` is TF2's own compiler; `staging` is a
/// scratch dir this function owns — it is emptied on entry AND on every exit
/// path, so a failed build cannot leave hundreds of MB of extracted SMDs
/// behind, and a stale tree from another selection can never be packed.
pub fn build_viewmodel_pack_vpk(
    animations_zip: &[u8],
    hidden_groups: &BTreeSet<String>,
    mode: ViewmodelHideMode,
    studiomdl: &Path,
    staging_root: &Path,
    staging: &Path,
) -> Result<Vec<u8>, ProfileError> {
    // Materialize and validate the exact chain before the first recursive
    // cleanup. A `studio` junction must never turn scratch cleanup into an
    // out-of-scope deletion.
    crate::hash::create_dir_all_within(staging_root, staging)
        .map_err(|err| ProfileError::Io(err.to_string()))?;
    crate::hash::remove_tree_within(staging_root, staging)
        .map_err(|err| ProfileError::Io(err.to_string()))?;
    crate::hash::create_dir_all_within(staging_root, staging)
        .map_err(|err| ProfileError::Io(err.to_string()))?;

    let result = build_in_staging(animations_zip, hidden_groups, mode, studiomdl, staging);
    let cleanup = crate::hash::remove_tree_within(staging_root, staging)
        .map_err(|err| ProfileError::Io(format!("Could not clean viewmodel staging: {err}")));
    match (result, cleanup) {
        (Ok(vpk), Ok(())) => Ok(vpk),
        (Err(error), Ok(())) => Err(error),
        (Ok(_), Err(cleanup)) => Err(cleanup),
        (Err(error), Err(cleanup)) => Err(ProfileError::Io(format!(
            "{} Cleanup also failed: {}",
            error.message(),
            cleanup.message()
        ))),
    }
}

fn build_in_staging(
    animations_zip: &[u8],
    hidden_groups: &BTreeSet<String>,
    mode: ViewmodelHideMode,
    studiomdl: &Path,
    staging: &Path,
) -> Result<Vec<u8>, ProfileError> {
    if hidden_groups.is_empty() {
        return Err(ProfileError::Io(
            "Pick at least one animation group to hide.".into(),
        ));
    }
    validate_animation_zip_len(animations_zip.len())?;
    if !studiomdl.is_file() {
        return Err(ProfileError::Io(format!(
            "Could not find {STUDIOMDL_FILE_NAME} in the TF2 install's bin folder."
        )));
    }
    let folders = changed_zip_folders(hidden_groups)?;
    let game_dir = staging.join("game");
    write_staging_gameinfo(&game_dir)?;

    let mut pack_files: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    let mut extraction_budget = ExtractionBudget::default();
    let mut compiled_bytes = 0_u64;
    for folder in &folders {
        let src_dir = staging.join("src").join(folder);
        std::fs::create_dir_all(&src_dir).map_err(|err| ProfileError::Io(err.to_string()))?;
        let qc_path =
            extract_class_sources(animations_zip, folder, &src_dir, &mut extraction_budget)?;
        let anims_dir = src_dir.join(format!("c_{folder}_animations_anims"));

        for file in hidden_files_for_folder(hidden_groups, folder) {
            let smd_path = find_smd(&anims_dir, &file).ok_or_else(|| {
                ProfileError::Io(format!("Animation {file}.smd is missing for {folder}."))
            })?;
            let text = std::fs::read_to_string(&smd_path)
                .map_err(|err| ProfileError::Io(err.to_string()))?;
            let hidden = hide_smd_sequence(&text, mode)
                .map_err(|err| ProfileError::Io(format!("{}: {err}", smd_path.display())))?;
            std::fs::write(&smd_path, hidden).map_err(|err| ProfileError::Io(err.to_string()))?;
        }

        let qc_text =
            std::fs::read_to_string(&qc_path).map_err(|err| ProfileError::Io(err.to_string()))?;
        let model_name = checked_model_name_from_qc(&qc_text).map_err(|err| {
            ProfileError::Io(format!(
                "QC for {folder} is unsafe or invalid: {}",
                err.message()
            ))
        })?;

        let log = run_studiomdl(studiomdl, &game_dir, &qc_path, staging, folder)?;
        let models_dir = game_dir.join("models");
        let compiled = models_dir.join(&model_name);
        if !compiled.is_file() {
            let tail: String = log
                .lines()
                .rev()
                .take(6)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
                .join(" | ");
            return Err(ProfileError::Io(format!(
                "studiomdl failed for {folder}: {tail}"
            )));
        }
        crate::hash::validate_file_within(&models_dir, &compiled)
            .map_err(|err| ProfileError::Io(err.to_string()))?;
        let aggregate_remaining = MAX_COMPILED_MODELS_BYTES.saturating_sub(compiled_bytes);
        let limit = MAX_COMPILED_MODEL_BYTES.min(aggregate_remaining);
        let label = format!("Compiled viewmodel for {folder}");
        let bytes = read_file_bounded(&compiled, limit, &label)?;
        compiled_bytes = compiled_bytes
            .checked_add(bytes.len() as u64)
            .ok_or_else(|| ProfileError::Io("Compiled viewmodel size overflowed.".into()))?;
        if pack_files
            .insert(format!("models/{model_name}"), bytes)
            .is_some()
        {
            return Err(ProfileError::Io(format!(
                "More than one class compiled the same model path: {model_name}."
            )));
        }
    }

    Ok(write_vpk_v2(&pack_files))
}

#[cfg(test)]
mod tests {
    use super::*;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

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

    #[cfg(unix)]
    fn unlink_dir(link: &Path) {
        std::fs::remove_file(link).unwrap();
    }

    #[cfg(windows)]
    fn unlink_dir(link: &Path) {
        std::fs::remove_dir(link).unwrap();
    }

    fn one_file_zip(path: &str, bytes: &[u8]) -> Vec<u8> {
        let mut cursor = std::io::Cursor::new(Vec::new());
        {
            let mut zip = ZipWriter::new(&mut cursor);
            zip.start_file(path, SimpleFileOptions::default()).unwrap();
            zip.write_all(bytes).unwrap();
            zip.finish().unwrap();
        }
        cursor.into_inner()
    }

    #[test]
    fn bounded_stream_refuses_the_first_byte_beyond_its_limit() {
        let mut input = std::io::Cursor::new(vec![b'x'; STREAM_BUFFER_BYTES + 1]);
        let mut output = Vec::new();
        let err = copy_bounded(
            &mut input,
            &mut output,
            STREAM_BUFFER_BYTES as u64,
            "test stream",
        )
        .unwrap_err();
        assert!(err.message().contains("safety limit"), "{err:?}");
        assert_eq!(output.len(), STREAM_BUFFER_BYTES);
    }

    #[test]
    fn rewritten_smd_builder_refuses_growth_past_its_bound() {
        let mut output = "1234".to_string();
        push_string_bounded(&mut output, "5678", 8, "test SMD").unwrap();
        let err = push_string_bounded(&mut output, "9", 8, "test SMD").unwrap_err();
        assert!(err.contains("safety limit"), "{err}");
        assert_eq!(output, "12345678");
    }

    #[test]
    fn extraction_enforces_the_remaining_aggregate_budget_before_writing() {
        let root = crate::test_temp_dir();
        let dest = root.join("sources");
        let zip = one_file_zip("c_scout_animations.qc", b"12345");
        let mut budget = ExtractionBudget {
            entries: 0,
            bytes: MAX_EXTRACTED_SOURCE_BYTES - 4,
        };
        let err = extract_class_sources(&zip, "scout", &dest, &mut budget).unwrap_err();
        assert!(err.message().contains("safety limit"), "{err:?}");
        assert!(!dest.join("c_scout_animations.qc").exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn compressed_archive_length_is_bounded_without_allocating_a_fixture() {
        let err = validate_animation_zip_len(MAX_ANIMATIONS_ZIP_BYTES + 1).unwrap_err();
        assert!(err.message().contains("256 MiB"), "{err:?}");
    }

    #[test]
    fn archive_paths_must_be_enclosed_normal_relative_paths() {
        let root = crate::test_temp_dir();
        for unsafe_name in [
            "../c_scout_animations.qc",
            "/c_scout_animations.qc",
            "C:/c_scout_animations.qc",
            "c_scout_animations_anims/../../escape.smd",
        ] {
            let zip = one_file_zip(unsafe_name, b"unsafe");
            let mut budget = ExtractionBudget::default();
            let err = extract_class_sources(&zip, "scout", &root, &mut budget).unwrap_err();
            assert!(
                err.message().to_ascii_lowercase().contains("path"),
                "{unsafe_name}: {err:?}"
            );
        }
        assert!(!root.join("c_scout_animations.qc").exists());
        assert!(!root.join("escape.smd").exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn compiled_file_size_is_checked_on_its_open_handle() {
        let root = crate::test_temp_dir();
        let compiled = root.join("compiled.mdl");
        std::fs::write(&compiled, b"123456789").unwrap();
        let err = read_file_bounded(&compiled, 8, "compiled test model").unwrap_err();
        assert!(err.message().contains("safety limit"), "{err:?}");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn compiler_log_reader_keeps_only_the_bounded_tail() {
        let root = crate::test_temp_dir();
        let log = root.join("studiomdl.log");
        std::fs::write(&log, b"discard-this-prefix\nlast diagnostic line\n").unwrap();
        let tail = read_lossy_file_tail(&log, 21).unwrap();
        assert!(tail.len() <= 21);
        assert!(tail.ends_with("last diagnostic line\n"), "{tail:?}");
        assert!(!tail.contains("discard-this-prefix"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn compiler_log_limit_is_smaller_than_the_timeout_disk_risk() {
        // The live poll uses metadata from an open clone of the same file
        // handle. Exercise that exact size signal without needing TF2's
        // Windows-only compiler in the test environment.
        let root = crate::test_temp_dir();
        let path = root.join("studiomdl.log");
        let log = File::create(&path).unwrap();
        log.set_len(MAX_STUDIOMDL_LOG_BYTES + 1).unwrap();
        let err = enforce_studiomdl_log_limit(&log, "scout").unwrap_err();
        assert!(err.message().contains("8 MiB"), "{err:?}");
        let _ = std::fs::remove_dir_all(root);
    }

    /// `text.find("skeleton")` cuts at the first literal occurrence of the
    /// word, so a bone whose name contains it truncates the nodes section and
    /// produces an SMD studiomdl rejects.
    #[test]
    fn hide_all_bones_cuts_at_the_located_line_not_the_first_word() {
        let smd = "version 1\nnodes\n  0 \"skeleton_root\" -1\n  1 \"bip_hand_R\" 0\nend\n\
                   skeleton\n  time 0\n    0 1 2 3 4 5 6\n    1 1 2 3 4 5 6\nend\n";
        let out = hide_all_bones(smd).unwrap();
        // The nodes section survives intact.
        assert!(out.contains("\"skeleton_root\""), "{out}");
        assert!(out.contains("\"bip_hand_R\""), "{out}");
        // Both bones are parked off-screen, and only once each.
        assert_eq!(out.matches("-100 -100 -100").count(), 2, "{out}");
        assert!(out.trim_end().ends_with("end"), "{out}");
    }

    /// A failed build names the compiler it could not find, and must not
    /// leave its staging tree on disk.
    #[test]
    fn missing_compiler_is_named_and_staging_is_cleaned() {
        let dir = crate::test_temp_dir();
        let staging = dir.join("staging");
        // Leftovers from an earlier failed run.
        std::fs::create_dir_all(staging.join("src/scout")).unwrap();
        std::fs::write(staging.join("src/scout/leftover.smd"), b"stale").unwrap();

        let hidden: BTreeSet<String> = ["scout_primary".to_string()].into_iter().collect();
        let err = build_viewmodel_pack_vpk(
            b"not a zip",
            &hidden,
            ViewmodelHideMode::Full,
            &dir.join("bin").join(STUDIOMDL_FILE_NAME),
            &dir,
            &staging,
        )
        .unwrap_err();

        let message = err.message();
        assert!(message.contains(STUDIOMDL_FILE_NAME), "{message}");
        assert!(!staging.exists(), "staging must be cleaned on every path");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn linked_studio_parent_cannot_redirect_recursive_staging_cleanup() {
        let root = crate::test_temp_dir();
        let victim = crate::test_temp_dir();
        let victim_staging = victim.join("staging");
        std::fs::create_dir_all(&victim_staging).unwrap();
        let victim_file = victim_staging.join("keep.txt");
        std::fs::write(&victim_file, b"outside must survive").unwrap();
        let linked_studio = root.join("studio");
        link_dir(&victim, &linked_studio);

        let hidden: BTreeSet<String> = ["scout_primary".to_string()].into_iter().collect();
        let error = build_viewmodel_pack_vpk(
            b"not a zip",
            &hidden,
            ViewmodelHideMode::Full,
            &root.join("missing-studiomdl.exe"),
            &root,
            &linked_studio.join("staging"),
        )
        .unwrap_err();

        assert!(error.message().contains("link"), "{error:?}");
        assert_eq!(
            std::fs::read(&victim_file).unwrap(),
            b"outside must survive"
        );
        unlink_dir(&linked_studio);
        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(victim).unwrap();
    }

    const SAMPLE_SMD: &str = "version 1\nnodes\n  0 \"bip_pelvis\" -1\n  1 \"bip_spine\" 0\nend\nskeleton\n  time 0\n    0 1.5 2.5 3.5 0.1 0.2 0.3\n    1 0.5 0.5 0.5 0 0 0\n  time 1\n    0 1.6 2.6 3.6 0.1 0.2 0.3\n  time 2\n    1 0.9 0.9 0.9 0 0 0\nend\n";

    /// Shaped like the real files: hand bones plus weapon bones parented to
    /// them, and two frames of animation.
    const HAND_SMD: &str = "version 1\nnodes\n  0 \"root\" -1\n  1 \"bip_hand_R\" 0\n  2 \"weapon_bone\" 1\n  3 \"vm_weapon_bone_1\" 1\nend\nskeleton\n  time 0\n    0 0 0 0 0 0 0\n    1 1.5 2.5 3.5 0.1 0.2 0.3\n    2 5.1 3.5 0.0 0 0 0\n    3 5.4 4.9 -0.1 0 0 0\n  time 1\n    1 1.6 2.6 3.6 0.1 0.2 0.3\n    2 5.2 3.6 0.0 0 0 0\nend\n";

    #[test]
    fn weapon_mode_hides_only_weapon_bones_and_keeps_hand_frames() {
        let hidden = hide_smd_sequence(HAND_SMD, ViewmodelHideMode::Weapon).unwrap();
        // Weapon bones parked, every frame preserved.
        assert!(hidden.contains("    2 -100 -100 -100 0 0 0"));
        assert!(hidden.contains("    3 -100 -100 -100 0 0 0"));
        assert!(!hidden.contains("5.1 3.5"));
        assert!(!hidden.contains("5.4 4.9"));
        // Hand and root animation untouched, both frames still there.
        assert!(hidden.contains("    1 1.5 2.5 3.5 0.1 0.2 0.3"));
        assert!(hidden.contains("    1 1.6 2.6 3.6 0.1 0.2 0.3"));
        assert!(hidden.contains("    0 0 0 0 0 0 0"));
        assert!(hidden.contains("  time 0\n"));
        assert!(hidden.contains("  time 1\n"));
        // The nodes section is never rewritten.
        assert!(hidden.contains("  2 \"weapon_bone\" 1"));

        // Full mode on the same file still flattens everything.
        let full = hide_smd_sequence(HAND_SMD, ViewmodelHideMode::Full).unwrap();
        assert!(full.contains("    1 -100 -100 -100 0 0 0"));
        assert!(!full.contains("1.5 2.5 3.5"));
    }

    #[test]
    fn weapon_mode_needs_weapon_bones() {
        // A skeleton with no weapon attachment bones cannot hide a weapon.
        assert!(hide_smd_sequence(SAMPLE_SMD, ViewmodelHideMode::Weapon).is_err());
    }

    #[test]
    fn hide_mode_round_trips_through_options() {
        assert_eq!(ViewmodelHideMode::default(), ViewmodelHideMode::Full);
        assert_eq!(ViewmodelHideMode::Weapon.as_str(), "weapon");
        assert_eq!(
            ViewmodelHideMode::from_str_or_default(Some("weapon")),
            ViewmodelHideMode::Weapon
        );
        assert_eq!(
            ViewmodelHideMode::from_str_or_default(Some("full")),
            ViewmodelHideMode::Full
        );
        // Unknown / missing falls back to the CompVMInstaller behavior.
        assert_eq!(
            ViewmodelHideMode::from_str_or_default(None),
            ViewmodelHideMode::Full
        );
        assert_eq!(
            ViewmodelHideMode::from_str_or_default(Some("nonsense")),
            ViewmodelHideMode::Full
        );
    }

    #[test]
    fn hides_all_bones_and_preserves_frame_count() {
        let hidden = hide_smd_sequence(SAMPLE_SMD, ViewmodelHideMode::Full).unwrap();
        assert!(hidden.contains("nodes"));
        assert!(hidden.contains("  time 0\n"));
        assert!(hidden.contains("    0 -100 -100 -100 0 0 0"));
        assert!(hidden.contains("    1 -100 -100 -100 0 0 0"));
        assert!(!hidden.contains("    2 -100"));
        assert!(hidden.contains("  time 1\n"));
        assert!(hidden.contains("  time 2\n"));
        assert!(!hidden.contains("  time 3"));
        assert!(hidden.trim_end().ends_with("end"));
        assert!(!hidden.contains("1.5 2.5 3.5"));
    }

    #[test]
    fn rejects_smd_without_skeleton() {
        assert!(hide_smd_sequence("version 1\nnodes\nend\n", ViewmodelHideMode::Full).is_err());
        assert!(hide_smd_sequence("version 1\nnodes\nend\n", ViewmodelHideMode::Weapon).is_err());
    }

    #[test]
    fn resolves_model_name_from_qc() {
        let qc = "$ModelName \"weapons\\c_models\\c_medic_animations.mdl\"\n$Sequence x\n";
        assert_eq!(
            model_name_from_qc(qc).as_deref(),
            Some("weapons/c_models/c_medic_animations.mdl")
        );
    }

    #[test]
    fn qc_model_name_must_be_a_normal_relative_mdl_path() {
        assert_eq!(
            checked_model_name_from_qc("$ModelName \"weapons/c_models/safe.mdl\"").unwrap(),
            "weapons/c_models/safe.mdl"
        );
        for unsafe_name in [
            "../escape.mdl",
            "/absolute.mdl",
            "C:/drive.mdl",
            "weapons/c_models/not-a-model.vvd",
        ] {
            let qc = format!("$ModelName \"{unsafe_name}\"\n");
            assert!(
                checked_model_name_from_qc(&qc).is_err(),
                "accepted {unsafe_name}"
            );
        }
    }

    #[test]
    fn soldier_hides_force_the_original_files() {
        let mut hidden = BTreeSet::new();
        hidden.insert("soldier/melee".to_string());
        let files = hidden_files_for_folder(&hidden, "soldier");
        assert!(files.contains("bet_idle"));
        assert!(files.contains("s_draw"));
        let scout: BTreeSet<String> = ["scout/melee".to_string()].into_iter().collect();
        assert!(!hidden_files_for_folder(&scout, "scout").contains("bet_idle"));
    }

    #[test]
    fn unknown_group_is_an_error() {
        let mut hidden = BTreeSet::new();
        hidden.insert("scout/rocketlaunchers".to_string());
        assert!(changed_zip_folders(&hidden).is_err());
        let known: BTreeSet<String> = ["demoman/melee".to_string()].into_iter().collect();
        assert_eq!(
            changed_zip_folders(&known).unwrap(),
            vec!["demo".to_string()]
        );
    }
}
