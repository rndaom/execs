//! Minimal MDL reader/writer for the material search paths a model carries.
//!
//! A studiomdl header stores its material directories as `cdtextures`: an array
//! of file offsets, each pointing at a NUL-terminated path such as
//! `models/props_gameplay/`. The engine joins those with each texture name from
//! `textures[]` to find a VMT. Relocating a mod's materials therefore means
//! rewriting this table — nothing else in the file references it.
//!
//! Rewrites append the new strings and a new offset array at the end of the
//! file and repoint the header, so no existing offset shifts. Read-only on the
//! game's own files; execs only ever rewrites its own staged copies.

/// Header field offsets in `studiohdr_t`, stable across MDL 44-49 (TF2 ships
/// 48/49). Verified against the game's own models by `examples/mdl_probe.rs`.
const OFF_ID: usize = 0;
const OFF_VERSION: usize = 4;
const OFF_LENGTH: usize = 76;
const OFF_NUM_CDTEXTURES: usize = 212;
const OFF_CDTEXTURE_INDEX: usize = 216;
const HEADER_MIN: usize = 244;

const MIN_VERSION: u32 = 44;
const MAX_VERSION: u32 = 49;

fn read_i32(bytes: &[u8], at: usize) -> Option<i32> {
    Some(i32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

fn write_i32(bytes: &mut [u8], at: usize, value: i32) {
    bytes[at..at + 4].copy_from_slice(&value.to_le_bytes());
}

/// True for a studiomdl file this module understands.
pub fn is_mdl(bytes: &[u8]) -> bool {
    bytes.len() >= HEADER_MIN
        && &bytes[OFF_ID..OFF_ID + 4] == b"IDST"
        && read_i32(bytes, OFF_VERSION)
            .is_some_and(|v| (MIN_VERSION..=MAX_VERSION).contains(&(v as u32)))
}

/// The model's material directories, in engine search order.
pub fn material_dirs(bytes: &[u8]) -> Option<Vec<String>> {
    if !is_mdl(bytes) {
        return None;
    }
    let count = read_i32(bytes, OFF_NUM_CDTEXTURES)?;
    let index = read_i32(bytes, OFF_CDTEXTURE_INDEX)?;
    if !(0..=64).contains(&count) || index <= 0 {
        return None;
    }
    let mut dirs = Vec::with_capacity(count as usize);
    for slot in 0..count as usize {
        let at = index as usize + slot * 4;
        let offset = read_i32(bytes, at)?;
        if offset <= 0 {
            return None;
        }
        dirs.push(read_cstr(bytes, offset as usize)?);
    }
    Some(dirs)
}

fn read_cstr(bytes: &[u8], at: usize) -> Option<String> {
    let rest = bytes.get(at..)?;
    let end = rest.iter().position(|byte| *byte == 0)?;
    // Paths are ASCII; anything else means we misread the table.
    let text = std::str::from_utf8(&rest[..end]).ok()?;
    if !text.is_ascii() {
        return None;
    }
    Some(text.to_string())
}

/// Point the model at `dirs` instead of its current material directories.
///
/// The new table is appended, so the count may grow — which is what lets a
/// relocated path keep the original as a fallback. Returns `None` if the file
/// is not an MDL or its table cannot be read.
pub fn rewrite_material_dirs(bytes: &[u8], dirs: &[String]) -> Option<Vec<u8>> {
    if dirs.is_empty() || dirs.len() > 64 {
        return None;
    }
    material_dirs(bytes)?;
    let mut out = bytes.to_vec();
    // The engine reads offsets as absolute file positions, so keep them 4-byte
    // aligned like studiomdl's own output.
    while !out.len().is_multiple_of(4) {
        out.push(0);
    }
    let mut offsets = Vec::with_capacity(dirs.len());
    for dir in dirs {
        if dir.contains('\0') {
            return None;
        }
        offsets.push(out.len() as i32);
        out.extend_from_slice(dir.as_bytes());
        out.push(0);
    }
    while !out.len().is_multiple_of(4) {
        out.push(0);
    }
    let table = out.len() as i32;
    for offset in &offsets {
        out.extend_from_slice(&offset.to_le_bytes());
    }
    write_i32(&mut out, OFF_NUM_CDTEXTURES, dirs.len() as i32);
    write_i32(&mut out, OFF_CDTEXTURE_INDEX, table);
    // studiohdr_t.length must match the file or the engine rejects the model.
    let length = out.len() as i32;
    write_i32(&mut out, OFF_LENGTH, length);
    Some(out)
}

/// A material directory as the engine compares them: lowercase, forward
/// slashes, exactly one trailing slash.
pub fn normalize_dir(dir: &str) -> String {
    let cleaned = dir.replace('\\', "/").to_ascii_lowercase();
    let trimmed = cleaned.trim_matches('/');
    if trimmed.is_empty() {
        String::new()
    } else {
        format!("{trimmed}/")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A header just long enough to carry a cdtextures table.
    fn fake_mdl(dirs: &[&str]) -> Vec<u8> {
        let mut bytes = vec![0u8; HEADER_MIN];
        bytes[0..4].copy_from_slice(b"IDST");
        write_i32(&mut bytes, OFF_VERSION, 49);
        let mut offsets = Vec::new();
        for dir in dirs {
            offsets.push(bytes.len() as i32);
            bytes.extend_from_slice(dir.as_bytes());
            bytes.push(0);
        }
        while !bytes.len().is_multiple_of(4) {
            bytes.push(0);
        }
        let table = bytes.len() as i32;
        for offset in &offsets {
            bytes.extend_from_slice(&offset.to_le_bytes());
        }
        write_i32(&mut bytes, OFF_NUM_CDTEXTURES, dirs.len() as i32);
        write_i32(&mut bytes, OFF_CDTEXTURE_INDEX, table);
        let length = bytes.len() as i32;
        write_i32(&mut bytes, OFF_LENGTH, length);
        bytes
    }

    #[test]
    fn reads_material_dirs() {
        let mdl = fake_mdl(&["models/props_gameplay/", "models/shared/"]);
        assert_eq!(
            material_dirs(&mdl).unwrap(),
            vec![
                "models/props_gameplay/".to_string(),
                "models/shared/".to_string()
            ]
        );
    }

    #[test]
    fn rewrite_keeps_the_original_as_a_fallback_and_reads_back() {
        let mdl = fake_mdl(&["models/props_gameplay/"]);
        let dirs = vec![
            "console/models/props_gameplay/".to_string(),
            "models/props_gameplay/".to_string(),
        ];
        let out = rewrite_material_dirs(&mdl, &dirs).unwrap();
        assert_eq!(material_dirs(&out).unwrap(), dirs);
        // The prefixed path must come first, or the stock material wins.
        assert!(material_dirs(&out).unwrap()[0].starts_with("console/"));
    }

    #[test]
    fn rewrite_updates_the_declared_length() {
        let mdl = fake_mdl(&["models/x/"]);
        let out = rewrite_material_dirs(&mdl, &["console/models/x/".to_string()]).unwrap();
        assert_eq!(read_i32(&out, OFF_LENGTH).unwrap() as usize, out.len());
    }

    #[test]
    fn refuses_files_that_are_not_models() {
        assert!(material_dirs(b"VTF\0notamodel").is_none());
        assert!(rewrite_material_dirs(b"nope", &["x/".to_string()]).is_none());
    }

    #[test]
    fn normalizes_dirs_the_way_the_engine_compares_them() {
        assert_eq!(normalize_dir("Models\\Props\\"), "models/props/");
        assert_eq!(normalize_dir("models/props"), "models/props/");
        assert_eq!(normalize_dir("/"), "");
    }
}
