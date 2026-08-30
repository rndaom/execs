//! Source VPK v1/v2 reader and a small v1 writer. Read-only against official TF2 VPKs.

use std::collections::BTreeMap;
use std::io::{Cursor, Read};
use std::path::Path;

const SIGNATURE: u32 = 0x55AA_1234;
const DIR_ARCHIVE: u16 = 0x7fff;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VpkError(pub String);

impl VpkError {
    pub fn message(&self) -> String {
        self.0.clone()
    }
}

#[derive(Debug, Clone)]
pub struct VpkArchive {
    pub files: BTreeMap<String, Vec<u8>>,
}

pub fn read_vpk_dir_file(path: &Path) -> Result<VpkArchive, VpkError> {
    let bytes = std::fs::read(path).map_err(|err| VpkError(err.to_string()))?;
    read_vpk(&bytes, Some(path))
}

pub fn read_vpk_dir_bytes(bytes: &[u8]) -> Result<VpkArchive, VpkError> {
    read_vpk(bytes, None)
}

fn read_vpk(bytes: &[u8], dir_path: Option<&Path>) -> Result<VpkArchive, VpkError> {
    if bytes.len() < 12 {
        return Err(VpkError("VPK header is too short.".into()));
    }
    let mut cur = Cursor::new(bytes);
    let signature = read_u32(&mut cur)?;
    if signature != SIGNATURE {
        return Err(VpkError("Not a VPK archive.".into()));
    }
    let version = read_u32(&mut cur)?;
    let tree_size = read_u32(&mut cur)? as usize;
    let header_size = match version {
        1 => 12,
        2 => {
            if bytes.len() < 28 {
                return Err(VpkError("VPK v2 header is too short.".into()));
            }
            let _file_data = read_u32(&mut cur)?;
            let _archive_md5 = read_u32(&mut cur)?;
            let _other_md5 = read_u32(&mut cur)?;
            let _signature = read_u32(&mut cur)?;
            28
        }
        _ => return Err(VpkError(format!("unsupported VPK version {version}"))),
    };
    let tree_end = header_size + tree_size;
    if bytes.len() < tree_end {
        return Err(VpkError("VPK directory tree is truncated.".into()));
    }
    let data_base = tree_end;
    let mut archives: BTreeMap<u16, Vec<u8>> = BTreeMap::new();
    let mut files = BTreeMap::new();
    while cur.position() < tree_end as u64 {
        let ext = read_cstring(&mut cur, tree_end)?;
        if ext.is_empty() {
            break;
        }
        loop {
            let path = read_cstring(&mut cur, tree_end)?;
            if path.is_empty() {
                break;
            }
            loop {
                let name = read_cstring(&mut cur, tree_end)?;
                if name.is_empty() {
                    break;
                }
                if cur.position() as usize + 18 > tree_end {
                    return Err(VpkError("VPK entry is truncated.".into()));
                }
                let _crc = read_u32(&mut cur)?;
                let preload_len = read_u16(&mut cur)? as usize;
                let archive_index = read_u16(&mut cur)?;
                let offset = read_u32(&mut cur)? as usize;
                let length = read_u32(&mut cur)? as usize;
                let term = read_u16(&mut cur)?;
                if term != 0xffff {
                    return Err(VpkError("VPK entry terminator missing.".into()));
                }
                if (cur.position() as usize) + preload_len > tree_end {
                    return Err(VpkError("VPK preload is truncated.".into()));
                }
                let mut preload = vec![0u8; preload_len];
                cur.read_exact(&mut preload)
                    .map_err(|err| VpkError(err.to_string()))?;
                let mut body = preload;
                if length > 0 {
                    if archive_index == DIR_ARCHIVE {
                        let start = data_base + offset;
                        let end = start.saturating_add(length);
                        if end > bytes.len() {
                            return Err(VpkError("VPK file data is truncated.".into()));
                        }
                        body.extend_from_slice(&bytes[start..end]);
                    } else {
                        let Some(dir_path) = dir_path else {
                            return Err(VpkError(
                                "Refusing an in-memory split VPK (need the *_dir.vpk path).".into(),
                            ));
                        };
                        if !archives.contains_key(&archive_index) {
                            let sibling = sibling_archive_path(dir_path, archive_index)?;
                            let loaded =
                                std::fs::read(&sibling).map_err(|err| VpkError(err.to_string()))?;
                            archives.insert(archive_index, loaded);
                        }
                        let archive = archives.get(&archive_index).expect("archive loaded");
                        let end = offset.saturating_add(length);
                        if end > archive.len() {
                            return Err(VpkError("VPK archive data is truncated.".into()));
                        }
                        body.extend_from_slice(&archive[offset..end]);
                    }
                }
                let rel = if path == " " || path.is_empty() {
                    format!("{name}.{ext}")
                } else {
                    format!("{path}/{name}.{ext}")
                };
                if rel.contains("..") {
                    return Err(VpkError("Refusing a VPK path that escapes.".into()));
                }
                files.insert(rel.replace('\\', "/"), body);
            }
        }
    }
    Ok(VpkArchive { files })
}

/// `tf2_misc_dir.vpk` + archive 0 → same-folder `tf2_misc_000.vpk`. Never leaves that folder.
pub fn sibling_archive_path(dir_path: &Path, index: u16) -> Result<std::path::PathBuf, VpkError> {
    let name = dir_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    let stem = name
        .strip_suffix("_dir.vpk")
        .or_else(|| name.strip_suffix("_dir.VPK"))
        .ok_or_else(|| VpkError("Split VPK directory files must be named *_dir.vpk.".into()))?;
    if stem.is_empty() || stem.contains("..") || stem.contains('/') || stem.contains('\\') {
        return Err(VpkError("Refusing a VPK archive name that escapes.".into()));
    }
    let parent = dir_path
        .parent()
        .ok_or_else(|| VpkError("VPK directory has no parent folder.".into()))?;
    let sibling = parent.join(format!("{stem}_{index:03}.vpk"));
    if sibling.parent() != Some(parent) {
        return Err(VpkError("Refusing a VPK archive path that escapes.".into()));
    }
    Ok(sibling)
}

/// Minimal VPK v1 writer. All files live in the directory archive.
pub fn write_vpk_v1(files: &BTreeMap<String, Vec<u8>>) -> Vec<u8> {
    let mut grouped: BTreeMap<String, BTreeMap<String, BTreeMap<String, Vec<u8>>>> =
        BTreeMap::new();
    for (rel, bytes) in files {
        let normalized = rel.replace('\\', "/");
        let (path, file) = match normalized.rfind('/') {
            Some(idx) => (&normalized[..idx], &normalized[idx + 1..]),
            None => (" ", normalized.as_str()),
        };
        let (name, ext) = match file.rfind('.') {
            Some(idx) => (&file[..idx], &file[idx + 1..]),
            None => (file, " "),
        };
        grouped
            .entry(ext.to_string())
            .or_default()
            .entry(path.to_string())
            .or_default()
            .insert(name.to_string(), bytes.clone());
    }

    let mut tree = Vec::new();
    let mut data = Vec::new();
    for (ext, paths) in &grouped {
        write_cstring(&mut tree, ext);
        for (path, names) in paths {
            write_cstring(&mut tree, path);
            for (name, bytes) in names {
                write_cstring(&mut tree, name);
                tree.extend_from_slice(&crc32(bytes).to_le_bytes());
                tree.extend_from_slice(&0u16.to_le_bytes());
                tree.extend_from_slice(&DIR_ARCHIVE.to_le_bytes());
                tree.extend_from_slice(&(data.len() as u32).to_le_bytes());
                tree.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
                tree.extend_from_slice(&0xffffu16.to_le_bytes());
                data.extend_from_slice(bytes);
            }
            tree.push(0);
        }
        tree.push(0);
    }
    tree.push(0);

    let mut out = Vec::with_capacity(12 + tree.len() + data.len());
    out.extend_from_slice(&SIGNATURE.to_le_bytes());
    out.extend_from_slice(&1u32.to_le_bytes());
    out.extend_from_slice(&(tree.len() as u32).to_le_bytes());
    out.extend_from_slice(&tree);
    out.extend_from_slice(&data);
    out
}

fn read_u32(cur: &mut Cursor<&[u8]>) -> Result<u32, VpkError> {
    let mut buf = [0u8; 4];
    cur.read_exact(&mut buf)
        .map_err(|err| VpkError(err.to_string()))?;
    Ok(u32::from_le_bytes(buf))
}

fn read_u16(cur: &mut Cursor<&[u8]>) -> Result<u16, VpkError> {
    let mut buf = [0u8; 2];
    cur.read_exact(&mut buf)
        .map_err(|err| VpkError(err.to_string()))?;
    Ok(u16::from_le_bytes(buf))
}

fn read_cstring(cur: &mut Cursor<&[u8]>, limit: usize) -> Result<String, VpkError> {
    let mut bytes = Vec::new();
    loop {
        if cur.position() as usize >= limit {
            return Err(VpkError("VPK string overran the directory tree.".into()));
        }
        let mut one = [0u8; 1];
        cur.read_exact(&mut one)
            .map_err(|err| VpkError(err.to_string()))?;
        if one[0] == 0 {
            break;
        }
        bytes.push(one[0]);
    }
    String::from_utf8(bytes).map_err(|_| VpkError("VPK path is not UTF-8.".into()))
}

fn write_cstring(out: &mut Vec<u8>, s: &str) {
    out.extend_from_slice(s.as_bytes());
    out.push(0);
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for byte in data {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            let mask = if crc & 1 != 0 { 0xffff_ffff } else { 0 };
            crc = (crc >> 1) ^ (0xedb8_8320 & mask);
        }
    }
    !crc
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_and_reads_a_single_file() {
        let mut files = BTreeMap::new();
        files.insert("scripts/tf_weapon_scattergun.ctx".into(), b"hello".to_vec());
        let bytes = write_vpk_v1(&files);
        let archive = read_vpk_dir_bytes(&bytes).unwrap();
        assert_eq!(
            archive
                .files
                .get("scripts/tf_weapon_scattergun.ctx")
                .unwrap(),
            b"hello"
        );
    }

    #[test]
    fn rejects_bad_signature() {
        assert!(read_vpk_dir_bytes(b"not a vpk").is_err());
    }

    #[test]
    fn reads_sibling_archive_and_refuses_escape_names() {
        let dir = std::env::temp_dir().join(format!(
            "execs-vpk-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let payload = b"weapon-script";
        std::fs::write(dir.join("tf2_misc_000.vpk"), payload).unwrap();

        let mut tree = Vec::new();
        write_cstring(&mut tree, "ctx");
        write_cstring(&mut tree, "scripts");
        write_cstring(&mut tree, "tf_weapon_scattergun");
        tree.extend_from_slice(&crc32(payload).to_le_bytes());
        tree.extend_from_slice(&0u16.to_le_bytes());
        tree.extend_from_slice(&0u16.to_le_bytes());
        tree.extend_from_slice(&0u32.to_le_bytes());
        tree.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        tree.extend_from_slice(&0xffffu16.to_le_bytes());
        tree.push(0);
        tree.push(0);
        tree.push(0);

        let mut dir_bytes = Vec::new();
        dir_bytes.extend_from_slice(&SIGNATURE.to_le_bytes());
        dir_bytes.extend_from_slice(&1u32.to_le_bytes());
        dir_bytes.extend_from_slice(&(tree.len() as u32).to_le_bytes());
        dir_bytes.extend_from_slice(&tree);
        let dir_path = dir.join("tf2_misc_dir.vpk");
        std::fs::write(&dir_path, &dir_bytes).unwrap();

        let archive = read_vpk_dir_file(&dir_path).unwrap();
        assert_eq!(
            archive
                .files
                .get("scripts/tf_weapon_scattergun.ctx")
                .unwrap(),
            payload
        );
        assert!(read_vpk_dir_bytes(&dir_bytes).is_err());
        assert!(sibling_archive_path(Path::new("not-a-dir.vpk"), 0).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_dotdot_paths() {
        let mut files = BTreeMap::new();
        files.insert("scripts/../steam.inf".into(), b"no".to_vec());
        let bytes = write_vpk_v1(&files);
        assert!(read_vpk_dir_bytes(&bytes).is_err());
    }
}
