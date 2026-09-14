//! Detect the supported mastercomfig startup loader from its contents. Names
//! and leftover overrides files are not evidence that overrides will execute.
#[cfg(test)]
use std::collections::BTreeMap;
use std::fs::File;
use std::io::Read;
use std::path::Path;

use crate::cfg_script::gameplay_script_signature;
use crate::hash::read_small_file_bounded;
use crate::profile::{ProfileError, ProfileManifest};
use crate::surface::{is_stock_custom_entry, CfgLayer};

const AUTOEXEC: &str = "cfg/autoexec.cfg";
const COMFIG: &str = "cfg/comfig/comfig.cfg";
const MAX_LOADER_BYTES: usize = 1024 * 1024;

enum Member {
    Vpk,
    Autoexec,
    Comfig,
}

// Source mounts custom children alphabetically before the ordinary tf/ path.
// Lowercasing determines mount order, not portable pack ownership.
type MountKey = (u8, String);

fn candidate(rel: &str) -> Option<(MountKey, Member)> {
    if is_stock_custom_entry(rel) {
        return None;
    }
    if let Some(rest) = rel.strip_prefix("tf/custom/") {
        let (pack, inner) = rest.split_once('/').unwrap_or((rest, ""));
        if pack.starts_with('.') || pack.is_empty() {
            return None;
        }
        let member = if inner.is_empty() && pack.to_ascii_lowercase().ends_with(".vpk") {
            Member::Vpk
        } else {
            loose_member(inner)?
        };
        Some(((0, pack.to_ascii_lowercase()), member))
    } else {
        Some(((1, String::new()), loose_member(rel.strip_prefix("tf/")?)?))
    }
}

fn loose_member(path: &str) -> Option<Member> {
    // Loose Source paths are case-sensitive on Linux.
    let path = if cfg!(windows) {
        path.to_ascii_lowercase()
    } else {
        path.to_string()
    };
    match path.as_str() {
        AUTOEXEC => Some(Member::Autoexec),
        COMFIG => Some(Member::Comfig),
        _ => None,
    }
}

pub fn cfg_layer_from_manifest(
    profiles_dir: &Path,
    manifest: &ProfileManifest,
) -> Result<CfgLayer, ProfileError> {
    let sources = manifest
        .files
        .iter()
        .filter(|file| candidate(&file.path).is_some())
        .map(|file| {
            Ok((
                file.path.as_str(),
                crate::apply::manifest_source_path(profiles_dir, &manifest.id, file)?,
            ))
        })
        .collect::<Result<Vec<_>, ProfileError>>()?;
    cfg_layer_from_sources(sources.iter().map(|(rel, source)| (*rel, source.as_path())))
}

/// Sources have already passed the live inventory or manifest containment
/// checks. Read only two bounded members from each VPK, never its full payload.
pub(crate) fn cfg_layer_from_sources<'a>(
    sources: impl IntoIterator<Item = (&'a str, &'a Path)>,
) -> Result<CfgLayer, ProfileError> {
    let mut sources: Vec<_> = sources
        .into_iter()
        .filter_map(|(rel, source)| candidate(rel).map(|(key, member)| (key, member, rel, source)))
        .collect();
    sources.sort_by(|left, right| left.0.cmp(&right.0));
    let mut autoexec: Option<Vec<u8>> = None;
    let mut comfig: Option<Vec<u8>> = None;
    for (_, member, rel, source) in sources {
        match member {
            Member::Vpk => {
                let mut signature = [0; 4];
                let read = File::open(source)
                    .and_then(|mut file| file.read(&mut signature))
                    .map_err(|err| ProfileError::Io(err.to_string()))?;
                // Historical opaque .vpk files can remain in a profile, but
                // cannot prove a loader exists. A signed malformed VPK fails.
                if read != 4 || signature != [0x34, 0x12, 0xaa, 0x55] {
                    continue;
                }
                let mut archive = crate::vpk::read_vpk_dir_file_filtered_bounded(
                    source,
                    &|path| {
                        (autoexec.is_none() && path == AUTOEXEC)
                            || (comfig.is_none() && path == COMFIG)
                    },
                    MAX_LOADER_BYTES as u64,
                    (MAX_LOADER_BYTES * 2) as u64,
                )
                .map_err(|err| {
                    ProfileError::Io(format!(
                        "Could not inspect the cfg loader in {rel}: {}",
                        err.message()
                    ))
                })?;
                if autoexec.is_none() {
                    autoexec = archive.files.remove(AUTOEXEC);
                }
                if comfig.is_none() {
                    comfig = archive.files.remove(COMFIG);
                }
            }
            Member::Autoexec | Member::Comfig => {
                if matches!(member, Member::Autoexec) && autoexec.is_some()
                    || matches!(member, Member::Comfig) && comfig.is_some()
                {
                    continue;
                }
                let bytes = read_small_file_bounded(source, MAX_LOADER_BYTES).map_err(|err| {
                    ProfileError::Io(format!("Could not inspect the cfg loader in {rel}: {err}"))
                })?;
                match member {
                    Member::Autoexec => autoexec = Some(bytes),
                    Member::Comfig => comfig = Some(bytes),
                    Member::Vpk => unreachable!(),
                }
            }
        }
        // Keep at most two cfg members, even when the install has many packs.
        // A later search path cannot replace the first startup autoexec.
        if autoexec
            .as_deref()
            .is_some_and(|bytes| !startup_executes_overrides(bytes))
        {
            return Ok(CfgLayer::Vanilla);
        }
        if autoexec.is_some() && comfig.is_some() {
            break;
        }
    }
    Ok(
        if autoexec
            .as_deref()
            .zip(comfig.as_deref())
            .is_some_and(|(autoexec, comfig)| supported_loader(autoexec, comfig))
        {
            CfgLayer::Comfig
        } else {
            CfgLayer::Vanilla
        },
    )
}

fn supported_loader(autoexec: &[u8], comfig: &[u8]) -> bool {
    let Ok(comfig) = std::str::from_utf8(comfig) else {
        return false;
    };
    gameplay_script_signature(comfig).next().is_some() && startup_executes_overrides(autoexec)
}

fn startup_executes_overrides(autoexec: &[u8]) -> bool {
    let Ok(autoexec) = std::str::from_utf8(autoexec) else {
        return false;
    };
    let mut loads_comfig = false;
    for command in gameplay_script_signature(autoexec) {
        let mut tokens = command.split_whitespace();
        if tokens.next() != Some("exec") {
            continue;
        }
        let Some(path) = tokens.next() else {
            continue;
        };
        if tokens.next().is_some() {
            continue;
        }
        match path.strip_suffix(".cfg").unwrap_or(path) {
            "comfig/comfig" => loads_comfig = true,
            "overrides/autoexec" if loads_comfig => return true,
            _ => {}
        }
    }
    false
}

#[cfg(test)]
pub(crate) fn test_base_vpk() -> Vec<u8> {
    crate::vpk::write_vpk_v1(&BTreeMap::from([
        (
            AUTOEXEC.into(),
            b"exec comfig/comfig.cfg;exec overrides/autoexec.cfg\n".to_vec(),
        ),
        (COMFIG.into(), b"echo synthetic loader fixture\n".to_vec()),
    ]))
}

#[cfg(test)]
pub(crate) fn write_test_base(root: &Path) {
    let path = root.join("tf/custom/mastercomfig-base.vpk");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, test_base_vpk()).unwrap();
}

#[cfg(test)]
pub(crate) fn install_test_base(profiles_dir: &Path, root: &Path, id: &str) {
    write_test_base(root);
    crate::profile::put_shared_blob_to(
        profiles_dir,
        root,
        id,
        "tf/custom/mastercomfig-base.vpk",
        &test_base_vpk(),
        std::iter::empty::<&str>(),
    )
    .unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_top_level_executed_commands_prove_the_loader() {
        let core = b"echo core\n";
        assert!(supported_loader(
            b"exec \"comfig/comfig.cfg\";exec overrides/autoexec.cfg",
            core
        ));
        for script in [
            "// exec comfig/comfig;exec overrides/autoexec\n",
            "bind x \"exec comfig/comfig;exec overrides/autoexec\"",
            "alias later \"exec comfig/comfig;exec overrides/autoexec\"",
            "exec overrides/autoexec;exec comfig/comfig",
            "exec comfig/comfig;echo exec overrides/autoexec",
        ] {
            assert!(!supported_loader(script.as_bytes(), core), "{script}");
        }
        assert!(!supported_loader(
            b"exec comfig/comfig;exec overrides/autoexec",
            b"// absent\n"
        ));
    }
}
