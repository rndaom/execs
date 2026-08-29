//! SHA-256 helpers for profile manifests and the shared blob store.

use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::Path;

use sha2::{Digest, Sha256};

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

/// Copy `src` to `dest` while hashing. Does not load the whole file into memory.
pub fn copy_and_sha256(src: &Path, dest: &Path) -> io::Result<String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut input = File::open(src)?;
    let mut output = File::create(dest)?;
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
}

#[cfg(test)]
mod tests {
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
}
