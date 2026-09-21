//! Minimal read-only decoding of Valve's installed compiled paint definitions.
//! Wire layout: ValveSoftware/source-sdk-2013, tf_proto_def_messages.proto
//! and CProtoBufScriptObjectDefinitionManager::BInitDefinitions. No renderer/code
//! from the SDK is included here.
use std::collections::BTreeMap;

#[derive(Debug)]
pub(super) struct Paint {
    pub name: String,
    pub icon: Option<String>,
}

fn primary_texture(header: &[u8]) -> Result<Option<String>, String> {
    let mut texture = None;
    let mut seen = false;
    for (id, value) in fields(header)? {
        if let (6, Field::Bytes(variable)) = (id, value) {
            let mut name = None;
            let mut path = None;
            for (id, value) in fields(variable)? {
                match (id, value) {
                    (1, Field::Bytes(value)) => name = std::str::from_utf8(value).ok(),
                    (3, Field::Bytes(value)) => path = std::str::from_utf8(value).ok(),
                    _ => {}
                }
            }
            if name != Some("texture_layer_1") {
                continue;
            }
            // A compiled header has already resolved prefab inheritance. Do not
            // search other layers and pretend one is the final rendered pattern.
            if seen {
                return Err("Ambiguous primary paint texture".into());
            }
            seen = true;
            if let Some(path) = path.filter(|path| path.starts_with("patterns/")) {
                let stem = path
                    .strip_suffix(".tga")
                    .or_else(|| path.strip_suffix(".vtf"))
                    .unwrap_or(path);
                let icon = format!("materials/{stem}.vtf");
                if super::valid_icon(&icon) {
                    texture = Some(icon);
                }
            }
        }
    }
    Ok(texture)
}

fn take<'a>(bytes: &mut &'a [u8], length: usize) -> Result<&'a [u8], String> {
    let (value, rest) = bytes
        .split_at_checked(length)
        .ok_or("Truncated paint definitions")?;
    *bytes = rest;
    Ok(value)
}

fn integer(bytes: &mut &[u8]) -> Result<u32, String> {
    Ok(u32::from_le_bytes(take(bytes, 4)?.try_into().unwrap()))
}

fn varint(bytes: &mut &[u8]) -> Result<u64, String> {
    let mut value = 0u64;
    for shift in (0..70).step_by(7) {
        let byte = take(bytes, 1)?[0];
        if shift == 63 && byte > 1 {
            return Err("Paint definition integer overflow".into());
        }
        value |= u64::from(byte & 127) << shift;
        if byte & 128 == 0 {
            return Ok(value);
        }
    }
    Err("Invalid paint definition integer".into())
}

pub(super) enum Field<'a> {
    Number(u64),
    Bytes(&'a [u8]),
    Other,
}

pub(super) fn fields(mut bytes: &[u8]) -> Result<Vec<(u32, Field<'_>)>, String> {
    let mut result = Vec::new();
    while !bytes.is_empty() {
        if result.len() >= 4096 {
            return Err("Paint definition field limit".into());
        }
        let tag = varint(&mut bytes)?;
        let number = u32::try_from(tag >> 3).map_err(|_| "Invalid protobuf field")?;
        if number == 0 {
            return Err("Invalid protobuf field".into());
        }
        let value = match tag & 7 {
            0 => Field::Number(varint(&mut bytes)?),
            1 => {
                take(&mut bytes, 8)?;
                Field::Other
            }
            2 => {
                let length =
                    usize::try_from(varint(&mut bytes)?).map_err(|_| "Invalid protobuf length")?;
                Field::Bytes(take(&mut bytes, length)?)
            }
            5 => {
                take(&mut bytes, 4)?;
                Field::Other
            }
            _ => return Err("Unsupported protobuf field".into()),
        };
        result.push((number, value));
    }
    Ok(result)
}

pub(super) fn names(mut bytes: &[u8]) -> Result<BTreeMap<u32, Paint>, String> {
    let mut names = BTreeMap::new();
    let mut total = 0usize;
    while !bytes.is_empty() {
        let kind = integer(&mut bytes)?;
        let count = integer(&mut bytes)? as usize;
        total = total
            .checked_add(count)
            .ok_or("Paint definition count overflow")?;
        if total > 100_000 {
            return Err("Paint definition count limit".into());
        }
        for _ in 0..count {
            let length = integer(&mut bytes)? as usize;
            if length > 1024 * 1024 {
                return Err("Paint definition size limit".into());
            }
            let message = take(&mut bytes, length)?;
            if kind != 9 {
                continue;
            }
            let mut id = None;
            let mut name = None;
            let mut icon = None;
            for (field, value) in fields(message)? {
                match (field, value) {
                    (1, Field::Bytes(header)) => {
                        icon = primary_texture(header)?;
                        for (field, value) in fields(header)? {
                            if let (1, Field::Number(value)) = (field, value) {
                                id = Some(u32::try_from(value).map_err(|_| "Invalid paint ID")?);
                            }
                        }
                    }
                    (2, Field::Bytes(value)) => {
                        if value.len() > 512 {
                            return Err("Paint name length limit".into());
                        }
                        name = Some(
                            std::str::from_utf8(value)
                                .map_err(|_| "Invalid paint name")?
                                .to_owned(),
                        );
                    }
                    _ => {}
                }
            }
            if let (Some(id), Some(name)) = (id, name) {
                if names.insert(id, Paint { name, icon }).is_some() {
                    return Err("Duplicate paint definition".into());
                }
            }
        }
    }
    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn swatch_uses_only_exact_primary_texture_and_restricts_paths() {
        fn header(path: &str) -> Vec<u8> {
            let name = "texture_layer_1";
            let mut variable = vec![10, name.len() as u8];
            variable.extend(name.bytes());
            variable.extend([26, path.len() as u8]);
            variable.extend(path.bytes());
            let mut header = vec![50, variable.len() as u8];
            header.extend(variable);
            header
        }
        let value = header("patterns/test/wood.tga");
        assert_eq!(
            primary_texture(&value).unwrap().as_deref(),
            Some("materials/patterns/test/wood.vtf")
        );
        for path in ["patterns/../secret", "models/player", "patterns/C:/secret"] {
            assert!(primary_texture(&header(path)).unwrap().is_none());
        }
        let mut repeated = value.clone();
        repeated.extend(value);
        assert!(primary_texture(&repeated).is_err());
    }
    #[test]
    fn reads_exact_paint_identity_and_refuses_bad_framing() {
        let message = [10, 2, 8, 42, 18, 5, b'#', b'T', b'e', b's', b't'];
        let mut bytes = 9u32.to_le_bytes().to_vec();
        bytes.extend(1u32.to_le_bytes());
        bytes.extend((message.len() as u32).to_le_bytes());
        bytes.extend(message);
        assert_eq!(names(&bytes).unwrap()[&42].name, "#Test");
        for end in 1..bytes.len() {
            assert!(names(&bytes[..end]).is_err());
        }
        assert!(fields(&[0]).is_err());
        assert!(fields(&[8, 255, 255, 255, 255, 255, 255, 255, 255, 255, 2]).is_err());
    }
}
