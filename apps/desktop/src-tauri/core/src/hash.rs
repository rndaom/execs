//! SHA-256 helpers for profile manifests and the shared blob store.

use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

/// MD5, needed only for the checksum block a VPK v2 directory carries. Not a
/// security primitive — never use it for integrity decisions.
pub fn md5(bytes: &[u8]) -> [u8; 16] {
    const S: [u32; 64] = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5,
        9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10,
        15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    let k: [u32; 64] =
        std::array::from_fn(|i| ((i as f64 + 1.0).sin().abs() * 4294967296.0) as u32);

    let mut msg = bytes.to_vec();
    let bit_len = (bytes.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_le_bytes());

    let mut state: [u32; 4] = [0x6745_2301, 0xefcd_ab89, 0x98ba_dcfe, 0x1032_5476];
    for chunk in msg.as_chunks::<64>().0 {
        let m: [u32; 16] = std::array::from_fn(|i| {
            u32::from_le_bytes([
                chunk[i * 4],
                chunk[i * 4 + 1],
                chunk[i * 4 + 2],
                chunk[i * 4 + 3],
            ])
        });
        let [mut a, mut b, mut c, mut d] = state;
        for i in 0..64 {
            let (f, g) = match i / 16 {
                0 => ((b & c) | (!b & d), i),
                1 => ((d & b) | (!d & c), (5 * i + 1) % 16),
                2 => (b ^ c ^ d, (3 * i + 5) % 16),
                _ => (c ^ (b | !d), (7 * i) % 16),
            };
            let tmp = d;
            d = c;
            c = b;
            let sum = a.wrapping_add(f).wrapping_add(k[i]).wrapping_add(m[g]);
            b = b.wrapping_add(sum.rotate_left(S[i]));
            a = tmp;
        }
        state[0] = state[0].wrapping_add(a);
        state[1] = state[1].wrapping_add(b);
        state[2] = state[2].wrapping_add(c);
        state[3] = state[3].wrapping_add(d);
    }
    let mut out = [0u8; 16];
    for (i, word) in state.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&word.to_le_bytes());
    }
    out
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub fn sha256_reader(mut reader: impl Read) -> io::Result<String> {
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

pub fn sha256_file(path: &Path) -> io::Result<String> {
    sha256_reader(File::open(path)?)
}

/// Suffix for the side file every atomic write goes through. A crash leaves at
/// most one of these next to the destination; it is never a live game file.
pub const PART_SUFFIX: &str = ".execs-part";

/// `<dest>.execs-part`, alongside `dest` so the rename stays on one volume.
pub fn part_path(dest: &Path) -> PathBuf {
    let mut name = dest.file_name().unwrap_or_default().to_os_string();
    name.push(PART_SUFFIX);
    dest.with_file_name(name)
}

/// Rename `from` over `to`. Windows refuses a rename onto an existing file, so
/// fall back to removing the destination first.
pub fn replace_file(from: &Path, to: &Path) -> io::Result<()> {
    match fs::rename(from, to) {
        Ok(()) => Ok(()),
        Err(err) => {
            if to.exists() {
                fs::remove_file(to)?;
                fs::rename(from, to)
            } else {
                Err(err)
            }
        }
    }
}

/// Write `bytes` to `dest` via `<dest>.execs-part` + rename, so a crash can
/// never leave a truncated file where the game (or we) will read one.
pub fn write_atomic(dest: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    let part = part_path(dest);
    let write = (|| -> io::Result<()> {
        let mut output = File::create(&part)?;
        output.write_all(bytes)?;
        output.flush()?;
        output.sync_all()
    })();
    if let Err(err) = write {
        let _ = fs::remove_file(&part);
        return Err(err);
    }
    if let Err(err) = replace_file(&part, dest) {
        let _ = fs::remove_file(&part);
        return Err(err);
    }
    Ok(())
}

/// Copy `src` to `dest` while hashing. Does not load the whole file into memory.
/// Writes through `<dest>.execs-part` and renames, so `dest` is never observed
/// half-written — a truncated `.vpk`/`.cfg` is one the game would still mount.
pub fn copy_and_sha256(src: &Path, dest: &Path) -> io::Result<String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    let part = part_path(dest);
    let hashed = (|| -> io::Result<String> {
        let mut input = File::open(src)?;
        let mut output = File::create(&part)?;
        let mut hasher = Sha256::new();
        let mut buf = [0u8; 64 * 1024];
        loop {
            let n = input.read(&mut buf)?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
            output.write_all(&buf[..n])?;
        }
        output.flush()?;
        Ok(format!("{:x}", hasher.finalize()))
    })();
    let hash = match hashed {
        Ok(hash) => hash,
        Err(err) => {
            let _ = fs::remove_file(&part);
            return Err(err);
        }
    };
    if let Err(err) = replace_file(&part, dest) {
        let _ = fs::remove_file(&part);
        return Err(err);
    }
    Ok(hash)
}

#[cfg(test)]
mod tests {

    #[test]
    fn md5_matches_the_rfc_1321_vectors() {
        let hex = |bytes: &[u8]| {
            super::md5(bytes)
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        };
        assert_eq!(hex(b""), "d41d8cd98f00b204e9800998ecf8427e");
        assert_eq!(hex(b"abc"), "900150983cd24fb0d6963f7d28e17f72");
        assert_eq!(
            hex(b"The quick brown fox jumps over the lazy dog"),
            "9e107d9d372bb6826bd81d3542a419d6"
        );
        // Spans several blocks, so the length padding is exercised too.
        assert_eq!(
            hex(
                b"12345678901234567890123456789012345678901234567890123456789012345678901234567890"
            ),
            "57edf4a22be3c955ac49da2e2107b67a"
        );
    }
    use super::*;

    #[test]
    fn hashes_known_vector() {
        assert_eq!(
            sha256_hex(b"hello"),
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    #[test]
    fn copy_and_hash_matches_bytes() {
        let dir = crate::test_temp_dir();
        let src = dir.join("src.bin");
        let dest = dir.join("out").join("dest.bin");
        std::fs::write(&src, b"hello").unwrap();
        let hash = copy_and_sha256(&src, &dest).unwrap();
        assert_eq!(hash, sha256_hex(b"hello"));
        assert_eq!(std::fs::read(&dest).unwrap(), b"hello");
        assert_eq!(sha256_file(&src).unwrap(), hash);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn copy_leaves_no_part_file_and_replaces_an_existing_dest() {
        let dir = crate::test_temp_dir();
        let src = dir.join("src.bin");
        let dest = dir.join("dest.bin");
        std::fs::write(&src, b"new").unwrap();
        std::fs::write(&dest, b"stale-and-longer").unwrap();

        copy_and_sha256(&src, &dest).unwrap();

        assert_eq!(std::fs::read(&dest).unwrap(), b"new");
        assert!(
            !part_path(&dest).exists(),
            "the .execs-part side file must not survive a successful copy"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_atomic_replaces_and_cleans_up() {
        let dir = crate::test_temp_dir();
        let dest = dir.join("nested").join("out.json");
        write_atomic(&dest, b"{\"a\":1}").unwrap();
        write_atomic(&dest, b"{}").unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), b"{}");
        assert!(!part_path(&dest).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
