//! Valve PCF (DMX binary) particle files: decode, re-encode, and the shrink
//! passes that let a modded particle file fit back into the byte budget of the
//! stock file it replaces inside `tf2_misc_dir.vpk`.
//!
//! Clean-room implementation from the DMX/PCF wire format. The shrink pipeline
//! mirrors the behavior of cueki's casual-pre-loader compression (cleanup of
//! redundant defaults, structural dedup of array-referenced elements, string
//! dictionary minimization) so the same mod library fits the same targets, and
//! is validated against that pipeline's output corpus in tests.

use std::collections::{BTreeMap, BTreeSet, HashMap};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PcfError(pub String);

impl PcfError {
    pub fn message(&self) -> String {
        self.0.clone()
    }
}

/// Attribute wire-type codes. Array codes are scalar code + 14.
mod ty {
    pub const ELEMENT: u8 = 0x01;
    pub const INTEGER: u8 = 0x02;
    pub const FLOAT: u8 = 0x03;
    pub const BOOLEAN: u8 = 0x04;
    pub const STRING: u8 = 0x05;
    pub const BINARY: u8 = 0x06;
    pub const COLOR: u8 = 0x08;
    pub const VECTOR2: u8 = 0x09;
    pub const VECTOR3: u8 = 0x0a;
    pub const VECTOR4: u8 = 0x0b;
    pub const MATRIX: u8 = 0x0e;
    pub const ELEMENT_ARRAY: u8 = 0x0f;
    pub const ARRAY_BASE_OFFSET: u8 = 14;
    pub const MATRIX_ARRAY: u8 = 0x1c;
}

pub const ELEMENT_ARRAY_TYPE: u8 = ty::ELEMENT_ARRAY;
pub const ELEMENT_TYPE: u8 = ty::ELEMENT;

/// The sentinel Source uses for "no element".
pub const NO_ELEMENT: u32 = 0xffff_ffff;

/// Floats keep their raw bits so re-encoding is byte-exact; comparisons that
/// need numeric semantics go through `f32::from_bits`.
#[derive(Debug, Clone, PartialEq)]
pub enum PcfValue {
    Element(u32),
    Integer(i32),
    Float(u32),
    Boolean(bool),
    String(Vec<u8>),
    Binary(Vec<u8>),
    Color([u8; 4]),
    Vector2([u32; 2]),
    Vector3([u32; 3]),
    Vector4([u32; 4]),
    Matrix([u32; 16]),
    Array(Vec<PcfValue>),
}

#[derive(Debug, Clone, PartialEq)]
pub struct PcfAttr {
    pub type_code: u8,
    pub value: PcfValue,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PcfElement {
    pub type_name_index: u16,
    pub name: Vec<u8>,
    pub signature: [u8; 16],
    /// Insertion-ordered; order is part of the wire format on re-encode.
    pub attributes: Vec<(Vec<u8>, PcfAttr)>,
}

impl PcfElement {
    pub fn attr(&self, name: &[u8]) -> Option<&PcfAttr> {
        self.attributes
            .iter()
            .find(|(attr_name, _)| attr_name == name)
            .map(|(_, attr)| attr)
    }

    /// Replaces in place when the name exists (keeping its position), appends
    /// otherwise — matching insertion-ordered map assignment.
    pub fn set_attr(&mut self, name: &[u8], attr: PcfAttr) {
        if let Some(slot) = self
            .attributes
            .iter_mut()
            .find(|(attr_name, _)| attr_name == name)
        {
            slot.1 = attr;
        } else {
            self.attributes.push((name.to_vec(), attr));
        }
    }
}

pub const PCF_HEADERS: [&str; 3] = [
    "<!-- dmx encoding binary 2 format dmx 1 -->",
    "<!-- dmx encoding binary 2 format pcf 1 -->",
    "<!-- dmx encoding binary 3 format pcf 1 -->",
];

#[derive(Debug, Clone, PartialEq)]
pub struct PcfFile {
    /// Header line without the trailing `\n` (one of `PCF_HEADERS`).
    pub version: String,
    pub string_dictionary: Vec<Vec<u8>>,
    pub elements: Vec<PcfElement>,
}

impl PcfFile {
    pub fn type_name(&self, element: &PcfElement) -> &[u8] {
        self.string_dictionary
            .get(element.type_name_index as usize)
            .map(|name| name.as_slice())
            .unwrap_or(b"")
    }
}

struct Reader<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, len: usize) -> Result<&'a [u8], PcfError> {
        let end = self
            .pos
            .checked_add(len)
            .filter(|end| *end <= self.bytes.len())
            .ok_or_else(|| PcfError("Particle file is truncated.".into()))?;
        let slice = &self.bytes[self.pos..end];
        self.pos = end;
        Ok(slice)
    }

    fn u8(&mut self) -> Result<u8, PcfError> {
        Ok(self.take(1)?[0])
    }

    fn u16(&mut self) -> Result<u16, PcfError> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap()))
    }

    fn u32(&mut self) -> Result<u32, PcfError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }

    fn i32(&mut self) -> Result<i32, PcfError> {
        Ok(i32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }

    fn cstring(&mut self) -> Result<Vec<u8>, PcfError> {
        let start = self.pos;
        while self.pos < self.bytes.len() {
            if self.bytes[self.pos] == 0 {
                let out = self.bytes[start..self.pos].to_vec();
                self.pos += 1;
                return Ok(out);
            }
            self.pos += 1;
        }
        Err(PcfError("Particle file string is unterminated.".into()))
    }
}

fn read_value(reader: &mut Reader<'_>, type_code: u8) -> Result<PcfValue, PcfError> {
    if (ty::ELEMENT_ARRAY..=ty::MATRIX_ARRAY).contains(&type_code) {
        let count = reader.u32()? as usize;
        let base = type_code - ty::ARRAY_BASE_OFFSET;
        // Cap the reserve: count comes from the file and each item is ≥1 byte.
        let mut items = Vec::with_capacity(count.min(reader.bytes.len() - reader.pos));
        for _ in 0..count {
            items.push(read_value(reader, base)?);
        }
        return Ok(PcfValue::Array(items));
    }
    match type_code {
        ty::ELEMENT => Ok(PcfValue::Element(reader.u32()?)),
        ty::INTEGER => Ok(PcfValue::Integer(reader.i32()?)),
        ty::FLOAT => Ok(PcfValue::Float(reader.u32()?)),
        ty::BOOLEAN => Ok(PcfValue::Boolean(reader.u8()? != 0)),
        ty::STRING => Ok(PcfValue::String(reader.cstring()?)),
        ty::BINARY => {
            let len = reader.u32()? as usize;
            Ok(PcfValue::Binary(reader.take(len)?.to_vec()))
        }
        ty::COLOR => Ok(PcfValue::Color(reader.take(4)?.try_into().unwrap())),
        ty::VECTOR2 => Ok(PcfValue::Vector2([reader.u32()?, reader.u32()?])),
        ty::VECTOR3 => Ok(PcfValue::Vector3([
            reader.u32()?,
            reader.u32()?,
            reader.u32()?,
        ])),
        ty::VECTOR4 => Ok(PcfValue::Vector4([
            reader.u32()?,
            reader.u32()?,
            reader.u32()?,
            reader.u32()?,
        ])),
        ty::MATRIX => {
            let mut cells = [0u32; 16];
            for cell in &mut cells {
                *cell = reader.u32()?;
            }
            Ok(PcfValue::Matrix(cells))
        }
        other => Err(PcfError(format!(
            "Particle attribute type {other} is not supported."
        ))),
    }
}

fn write_value(out: &mut Vec<u8>, type_code: u8, value: &PcfValue) -> Result<(), PcfError> {
    match value {
        PcfValue::Array(items) => {
            if !(ty::ELEMENT_ARRAY..=ty::MATRIX_ARRAY).contains(&type_code) {
                return Err(PcfError("Array value on a scalar attribute type.".into()));
            }
            out.extend_from_slice(&(items.len() as u32).to_le_bytes());
            let base = type_code - ty::ARRAY_BASE_OFFSET;
            for item in items {
                write_value(out, base, item)?;
            }
            Ok(())
        }
        PcfValue::Element(index) => {
            out.extend_from_slice(&index.to_le_bytes());
            Ok(())
        }
        PcfValue::Integer(value) => {
            out.extend_from_slice(&value.to_le_bytes());
            Ok(())
        }
        PcfValue::Float(bits) => {
            out.extend_from_slice(&bits.to_le_bytes());
            Ok(())
        }
        PcfValue::Boolean(flag) => {
            out.push(u8::from(*flag));
            Ok(())
        }
        PcfValue::String(bytes) => {
            out.extend_from_slice(bytes);
            out.push(0);
            Ok(())
        }
        PcfValue::Binary(bytes) => {
            out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
            out.extend_from_slice(bytes);
            Ok(())
        }
        PcfValue::Color(rgba) => {
            out.extend_from_slice(rgba);
            Ok(())
        }
        PcfValue::Vector2(cells) => {
            for cell in cells {
                out.extend_from_slice(&cell.to_le_bytes());
            }
            Ok(())
        }
        PcfValue::Vector3(cells) => {
            for cell in cells {
                out.extend_from_slice(&cell.to_le_bytes());
            }
            Ok(())
        }
        PcfValue::Vector4(cells) => {
            for cell in cells {
                out.extend_from_slice(&cell.to_le_bytes());
            }
            Ok(())
        }
        PcfValue::Matrix(cells) => {
            for cell in cells {
                out.extend_from_slice(&cell.to_le_bytes());
            }
            Ok(())
        }
    }
}

pub fn decode_pcf(bytes: &[u8]) -> Result<PcfFile, PcfError> {
    let mut reader = Reader { bytes, pos: 0 };
    let header = reader.cstring()?;
    let header = String::from_utf8_lossy(&header);
    let header = header
        .strip_suffix('\n')
        .ok_or_else(|| PcfError("Particle file header is malformed.".into()))?;
    let version = PCF_HEADERS
        .iter()
        .find(|known| **known == header)
        .ok_or_else(|| PcfError(format!("Unsupported particle format: {header}")))?
        .to_string();

    let string_count = reader.u16()? as usize;
    let mut string_dictionary = Vec::with_capacity(string_count);
    for _ in 0..string_count {
        string_dictionary.push(reader.cstring()?);
    }

    let element_count = reader.u32()? as usize;
    if element_count > bytes.len() {
        return Err(PcfError("Particle file is truncated.".into()));
    }
    let mut elements = Vec::with_capacity(element_count);
    for _ in 0..element_count {
        let type_name_index = reader.u16()?;
        let name = reader.cstring()?;
        let signature: [u8; 16] = reader.take(16)?.try_into().unwrap();
        elements.push(PcfElement {
            type_name_index,
            name,
            signature,
            attributes: Vec::new(),
        });
    }

    for element in &mut elements {
        let attr_count = reader.u32()? as usize;
        for _ in 0..attr_count {
            let name_index = reader.u16()? as usize;
            let name = string_dictionary
                .get(name_index)
                .ok_or_else(|| PcfError("Attribute name index is out of range.".into()))?
                .clone();
            let type_code = reader.u8()?;
            let value = read_value(&mut reader, type_code)?;
            let attr = PcfAttr { type_code, value };
            // Duplicate names replace in place, keeping first position.
            if let Some(slot) = element
                .attributes
                .iter_mut()
                .find(|(existing, _)| *existing == name)
            {
                slot.1 = attr;
            } else {
                element.attributes.push((name, attr));
            }
        }
    }

    Ok(PcfFile {
        version,
        string_dictionary,
        elements,
    })
}

pub fn encode_pcf(pcf: &PcfFile) -> Result<Vec<u8>, PcfError> {
    if pcf.string_dictionary.len() > u16::MAX as usize {
        return Err(PcfError("String dictionary is too large.".into()));
    }
    let mut first_index: HashMap<&[u8], u16> = HashMap::new();
    for (index, name) in pcf.string_dictionary.iter().enumerate() {
        first_index.entry(name.as_slice()).or_insert(index as u16);
    }

    let mut out = Vec::new();
    out.extend_from_slice(pcf.version.as_bytes());
    out.push(b'\n');
    out.push(0);

    out.extend_from_slice(&(pcf.string_dictionary.len() as u16).to_le_bytes());
    for name in &pcf.string_dictionary {
        out.extend_from_slice(name);
        out.push(0);
    }

    out.extend_from_slice(&(pcf.elements.len() as u32).to_le_bytes());
    for element in &pcf.elements {
        out.extend_from_slice(&element.type_name_index.to_le_bytes());
        out.extend_from_slice(&element.name);
        out.push(0);
        out.extend_from_slice(&element.signature);
    }

    for element in &pcf.elements {
        out.extend_from_slice(&(element.attributes.len() as u32).to_le_bytes());
        for (name, attr) in &element.attributes {
            let index = first_index.get(name.as_slice()).ok_or_else(|| {
                PcfError("Attribute name is missing from the string dictionary.".into())
            })?;
            out.extend_from_slice(&index.to_le_bytes());
            out.push(attr.type_code);
            write_value(&mut out, attr.type_code, &attr.value)?;
        }
    }

    Ok(out)
}

// ---------------------------------------------------------------------------
// Shrink pipeline
// ---------------------------------------------------------------------------

/// Attribute values that match Source's engine defaults on operator elements
/// can be dropped: the engine fills them back in at load.
const OPERATOR_DEFAULTS: &[(&[u8], Default)] = &[
    (b"operator start fadein", Default::Float(0.0)),
    (b"operator end fadein", Default::Float(0.0)),
    (b"operator start fadeout", Default::Float(0.0)),
    (b"operator end fadeout", Default::Float(0.0)),
    (b"operator fade oscillate", Default::Float(0.0)),
    (
        b"Visibility Proxy Input Control Point Number",
        Default::Int(-1),
    ),
    (b"Visibility Proxy Radius", Default::Float(1.0)),
    (b"Visibility input minimum", Default::Float(0.0)),
    (b"Visibility input maximum", Default::Float(1.0)),
    (b"Visibility Alpha Scale minimum", Default::Float(0.0)),
    (b"Visibility Alpha Scale maximum", Default::Float(1.0)),
    (b"Visibility Radius Scale minimum", Default::Float(1.0)),
    (b"Visibility Radius Scale maximum", Default::Float(1.0)),
    (b"Visibility Camera Depth Bias", Default::Float(0.0)),
];

/// Same idea for particle system definition elements.
const SYSTEM_DEFAULTS: &[(&[u8], Default)] = &[
    (b"max_particles", Default::Int(1000)),
    (b"initial_particles", Default::Int(0)),
    (b"material", Default::Bytes(b"vgui/white")),
    (b"bounding_box_min", Default::Vec3([-10.0, -10.0, -10.0])),
    (b"bounding_box_max", Default::Vec3([10.0, 10.0, 10.0])),
    (b"cull_radius", Default::Float(0.0)),
    (b"cull_cost", Default::Float(1.0)),
    (b"cull_control_point", Default::Int(0)),
    (b"cull_replacement_definition", Default::Bytes(b"")),
    (b"radius", Default::Float(5.0)),
    (b"color", Default::Rgba([255.0, 255.0, 255.0, 255.0])),
    (b"rotation", Default::Float(0.0)),
    (b"rotation_speed", Default::Float(0.0)),
    (b"sequence_number", Default::Int(0)),
    (b"sequence_number1", Default::Int(0)),
    (b"group id", Default::Int(0)),
    (b"maximum time step", Default::Float(0.1)),
    (b"maximum sim tick rate", Default::Float(0.0)),
    (b"minimum sim tick rate", Default::Float(0.0)),
    (b"minimum rendered frames", Default::Int(0)),
    (
        b"control point to disable rendering if it is the camera",
        Default::Int(-1),
    ),
    (b"maximum draw distance", Default::Float(100000.0)),
    (b"time to sleep when not drawn", Default::Float(8.0)),
    (b"Sort particles", Default::Bool(true)),
    (b"batch particle systems", Default::Bool(false)),
    (b"view model effect", Default::Bool(false)),
];

enum Default {
    Int(i64),
    Float(f64),
    Bool(bool),
    Bytes(&'static [u8]),
    Vec3([f64; 3]),
    Rgba([f64; 4]),
}

fn value_as_number(value: &PcfValue) -> Option<f64> {
    match value {
        PcfValue::Element(v) => Some(f64::from(*v)),
        PcfValue::Integer(v) => Some(f64::from(*v)),
        PcfValue::Float(bits) => Some(f64::from(f32::from_bits(*bits))),
        PcfValue::Boolean(v) => Some(f64::from(u8::from(*v))),
        _ => None,
    }
}

fn value_as_tuple(value: &PcfValue) -> Option<Vec<f64>> {
    match value {
        PcfValue::Color(rgba) => Some(rgba.iter().map(|c| f64::from(*c)).collect()),
        PcfValue::Vector3(cells) => Some(
            cells
                .iter()
                .map(|bits| f64::from(f32::from_bits(*bits)))
                .collect(),
        ),
        PcfValue::Vector4(cells) => Some(
            cells
                .iter()
                .map(|bits| f64::from(f32::from_bits(*bits)))
                .collect(),
        ),
        _ => None,
    }
}

fn matches_default(value: &PcfValue, default: &Default) -> bool {
    match default {
        // Numeric comparisons are cross-type (a boolean true equals 1, a float
        // 0.0 equals 0), and a stored f32 only matches when it equals the f64
        // default exactly — 0.1 as f32 does not.
        Default::Int(expected) => value_as_number(value) == Some(*expected as f64),
        Default::Float(expected) => value_as_number(value) == Some(*expected),
        Default::Bool(expected) => value_as_number(value) == Some(f64::from(u8::from(*expected))),
        Default::Bytes(expected) => match value {
            PcfValue::String(bytes) | PcfValue::Binary(bytes) => bytes == expected,
            _ => false,
        },
        Default::Vec3(expected) => {
            value_as_tuple(value).is_some_and(|cells| cells == expected.to_vec())
        }
        Default::Rgba(expected) => {
            value_as_tuple(value).is_some_and(|cells| cells == expected.to_vec())
        }
    }
}

fn remove_default_attributes(element: &mut PcfElement, defaults: &[(&[u8], Default)]) {
    element.attributes.retain(|(name, attr)| {
        let Some((_, default)) = defaults.iter().find(|(key, _)| *key == name.as_slice()) else {
            return true;
        };
        !matches_default(&attr.value, default)
    });
}

const TYPE_SYSTEM: &[u8] = b"DmeParticleSystemDefinition";
const TYPE_CHILD: &[u8] = b"DmeParticleChild";
const TYPE_OPERATOR: &[u8] = b"DmeParticleOperator";

fn cleanup_pass(pcf: &mut PcfFile) {
    // Name → element index for system definitions. Matching list.index()
    // semantics: identical duplicate definitions resolve to the first, and a
    // repeated name keeps the last definition's slot.
    let system_positions: Vec<usize> = (0..pcf.elements.len())
        .filter(|index| pcf.type_name(&pcf.elements[*index]) == TYPE_SYSTEM)
        .collect();
    let mut system_indices: HashMap<Vec<u8>, u32> = HashMap::new();
    for &index in &system_positions {
        let first_equal = system_positions
            .iter()
            .copied()
            .find(|&candidate| pcf.elements[candidate] == pcf.elements[index])
            .unwrap_or(index);
        system_indices.insert(pcf.elements[index].name.clone(), first_equal as u32);
    }

    for index in 0..pcf.elements.len() {
        let type_name = pcf.type_name(&pcf.elements[index]).to_vec();
        let element = &mut pcf.elements[index];
        if type_name == TYPE_CHILD {
            let broken = matches!(
                element.attr(b"child"),
                Some(PcfAttr {
                    value: PcfValue::Element(NO_ELEMENT),
                    ..
                })
            );
            if broken {
                if let Some(target) = system_indices.get(&element.name).copied() {
                    if let Some(slot) = element
                        .attributes
                        .iter_mut()
                        .find(|(name, _)| name == b"child")
                    {
                        slot.1.value = PcfValue::Element(target);
                    }
                }
            }
        } else if type_name == TYPE_SYSTEM {
            if let Some(slot) = element
                .attributes
                .iter_mut()
                .find(|(name, _)| name == b"children")
            {
                if let PcfValue::Array(items) = &slot.1.value {
                    let mut seen = BTreeSet::new();
                    let mut unique = Vec::with_capacity(items.len());
                    for item in items {
                        let key = match item {
                            PcfValue::Element(v) => *v,
                            _ => u32::MAX,
                        };
                        if seen.insert(key) {
                            unique.push(item.clone());
                        }
                    }
                    if unique.len() != items.len() {
                        slot.1.value = PcfValue::Array(unique);
                    }
                }
            }
            remove_default_attributes(element, SYSTEM_DEFAULTS);
        } else if type_name == TYPE_OPERATOR {
            element.name = Vec::new();
            remove_default_attributes(element, OPERATOR_DEFAULTS);
        }
    }
}

/// A canonical byte key for structural equality of an element's attributes
/// (sorted by name, so insertion order does not matter). Negative-zero floats
/// normalize to zero so numerically-equal elements group together.
fn canonical_attr_key(element: &PcfElement) -> Vec<u8> {
    fn push_value(out: &mut Vec<u8>, value: &PcfValue) {
        fn norm(bits: u32) -> u32 {
            if bits == 0x8000_0000 {
                0
            } else {
                bits
            }
        }
        match value {
            PcfValue::Element(v) => {
                out.push(1);
                out.extend_from_slice(&v.to_le_bytes());
            }
            PcfValue::Integer(v) => {
                out.push(2);
                out.extend_from_slice(&v.to_le_bytes());
            }
            PcfValue::Float(bits) => {
                out.push(3);
                out.extend_from_slice(&norm(*bits).to_le_bytes());
            }
            PcfValue::Boolean(v) => {
                out.push(4);
                out.push(u8::from(*v));
            }
            PcfValue::String(bytes) | PcfValue::Binary(bytes) => {
                out.push(5);
                out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
                out.extend_from_slice(bytes);
            }
            PcfValue::Color(rgba) => {
                out.push(6);
                out.extend_from_slice(rgba);
            }
            PcfValue::Vector2(cells) => {
                out.push(7);
                for cell in cells {
                    out.extend_from_slice(&norm(*cell).to_le_bytes());
                }
            }
            PcfValue::Vector3(cells) => {
                out.push(8);
                for cell in cells {
                    out.extend_from_slice(&norm(*cell).to_le_bytes());
                }
            }
            PcfValue::Vector4(cells) => {
                out.push(9);
                for cell in cells {
                    out.extend_from_slice(&norm(*cell).to_le_bytes());
                }
            }
            PcfValue::Matrix(cells) => {
                out.push(10);
                for cell in cells {
                    out.extend_from_slice(&norm(*cell).to_le_bytes());
                }
            }
            PcfValue::Array(items) => {
                out.push(11);
                out.extend_from_slice(&(items.len() as u32).to_le_bytes());
                for item in items {
                    push_value(out, item);
                }
            }
        }
    }

    let mut sorted: Vec<&(Vec<u8>, PcfAttr)> = element.attributes.iter().collect();
    sorted.sort_by(|a, b| a.0.cmp(&b.0));
    let mut key = Vec::new();
    for (name, attr) in sorted {
        key.extend_from_slice(&(name.len() as u32).to_le_bytes());
        key.extend_from_slice(name);
        key.push(attr.type_code);
        push_value(&mut key, &attr.value);
    }
    key
}

/// Groups of element indices (in first-seen order) that share identical
/// attribute structure and are referenced from element arrays. Only groups
/// with more than one collected reference count as duplicates.
fn find_duplicate_array_elements(pcf: &PcfFile) -> Vec<Vec<u32>> {
    let excluded: [&[u8]; 3] = [b"DmeElement", b"DmElement", TYPE_SYSTEM];
    let mut group_order: Vec<Vec<u8>> = Vec::new();
    let mut groups: HashMap<Vec<u8>, Vec<u32>> = HashMap::new();
    let mut key_cache: HashMap<u32, Vec<u8>> = HashMap::new();

    for element in &pcf.elements {
        for (_, attr) in &element.attributes {
            if attr.type_code != ty::ELEMENT_ARRAY {
                continue;
            }
            let PcfValue::Array(items) = &attr.value else {
                continue;
            };
            for item in items {
                let PcfValue::Element(index) = item else {
                    continue;
                };
                if (*index as usize) >= pcf.elements.len() {
                    continue;
                }
                let referenced = &pcf.elements[*index as usize];
                if excluded.contains(&pcf.type_name(referenced)) {
                    continue;
                }
                let key = key_cache
                    .entry(*index)
                    .or_insert_with(|| canonical_attr_key(referenced))
                    .clone();
                let group = groups.entry(key.clone()).or_insert_with(|| {
                    group_order.push(key);
                    Vec::new()
                });
                group.push(*index);
            }
        }
    }

    group_order
        .into_iter()
        .filter_map(|key| groups.remove(&key))
        .filter(|group| group.len() > 1)
        .collect()
}

fn unique_preserve_order(indices: &[u32]) -> Vec<u32> {
    let mut seen = BTreeSet::new();
    indices
        .iter()
        .copied()
        .filter(|index| seen.insert(*index))
        .collect()
}

fn update_array_indices(pcf: &mut PcfFile, duplicates: &[Vec<u32>]) {
    let mut index_map: HashMap<u32, u32> = HashMap::new();
    for group in duplicates {
        let unique = unique_preserve_order(group);
        let first = unique[0];
        for &index in &unique[1..] {
            index_map.insert(index, first);
        }
    }
    for element in &mut pcf.elements {
        for (_, attr) in &mut element.attributes {
            if attr.type_code != ty::ELEMENT_ARRAY {
                continue;
            }
            if let PcfValue::Array(items) = &mut attr.value {
                for item in items {
                    if let PcfValue::Element(index) = item {
                        if let Some(target) = index_map.get(index) {
                            *index = *target;
                        }
                    }
                }
            }
        }
    }
}

fn reorder_elements(pcf: &mut PcfFile, duplicates: &[Vec<u32>]) {
    let mut duplicate_to_first: HashMap<u32, u32> = HashMap::new();
    let mut duplicate_indices: BTreeSet<u32> = BTreeSet::new();
    for group in duplicates {
        let unique = unique_preserve_order(group);
        let first = unique[0];
        for &index in &unique[1..] {
            duplicate_indices.insert(index);
            duplicate_to_first.insert(index, first);
        }
    }

    let mut old_to_new: HashMap<u32, u32> = HashMap::new();
    let mut new_elements = Vec::with_capacity(pcf.elements.len() - duplicate_indices.len());
    for (old_index, element) in pcf.elements.drain(..).enumerate() {
        let old_index = old_index as u32;
        if !duplicate_indices.contains(&old_index) {
            old_to_new.insert(old_index, new_elements.len() as u32);
            new_elements.push(element);
        }
    }

    for element in &mut new_elements {
        for (_, attr) in &mut element.attributes {
            if attr.type_code == ty::ELEMENT_ARRAY {
                if let PcfValue::Array(items) = &mut attr.value {
                    let mut kept = Vec::with_capacity(items.len());
                    for item in items.drain(..) {
                        let PcfValue::Element(mut index) = item else {
                            continue;
                        };
                        if let Some(first) = duplicate_to_first.get(&index) {
                            index = *first;
                        }
                        // References that never resolved drop out of arrays.
                        if let Some(new_index) = old_to_new.get(&index) {
                            kept.push(PcfValue::Element(*new_index));
                        }
                    }
                    *items = kept;
                }
            } else if attr.type_code == ty::ELEMENT {
                if let PcfValue::Element(index) = &mut attr.value {
                    let mut target = *index;
                    if let Some(first) = duplicate_to_first.get(&target) {
                        target = *first;
                    }
                    // Unresolved single references (like the 0xffffffff
                    // sentinel) keep their raw value.
                    if let Some(new_index) = old_to_new.get(&target) {
                        *index = *new_index;
                    }
                }
            }
        }
    }

    pcf.elements = new_elements;
}

fn optimize_string_dictionary(pcf: &mut PcfFile) {
    let mut used: BTreeSet<Vec<u8>> = BTreeSet::new();
    for element in &pcf.elements {
        used.insert(pcf.type_name(element).to_vec());
        for (name, _) in &element.attributes {
            used.insert(name.clone());
        }
    }
    let new_dictionary: Vec<Vec<u8>> = used.into_iter().collect();
    let positions: HashMap<&[u8], u16> = new_dictionary
        .iter()
        .enumerate()
        .map(|(index, name)| (name.as_slice(), index as u16))
        .collect();
    for element in &mut pcf.elements {
        let old = pcf
            .string_dictionary
            .get(element.type_name_index as usize)
            .map(|name| name.as_slice())
            .unwrap_or(b"");
        element.type_name_index = positions.get(old).copied().unwrap_or(0);
    }
    pcf.string_dictionary = new_dictionary;
}

/// The full shrink pipeline: cleanup, dedup of array-referenced elements, and
/// string dictionary minimization.
pub fn remove_duplicate_elements(pcf: &mut PcfFile) {
    cleanup_pass(pcf);
    let duplicates = find_duplicate_array_elements(pcf);
    if !duplicates.is_empty() {
        update_array_indices(pcf, &duplicates);
        reorder_elements(pcf, &duplicates);
    }
    optimize_string_dictionary(pcf);
}

// ---------------------------------------------------------------------------
// System-level helpers
// ---------------------------------------------------------------------------

fn lossy(name: &[u8]) -> String {
    String::from_utf8_lossy(name).into_owned()
}

/// System definitions that are not also named as a `DmeParticleChild` — the
/// top-level effects a file owns.
pub fn get_parent_elements(pcf: &PcfFile) -> BTreeSet<String> {
    let mut systems = BTreeSet::new();
    let mut children = BTreeSet::new();
    for element in &pcf.elements {
        let type_name = pcf.type_name(element);
        if type_name == TYPE_SYSTEM {
            systems.insert(lossy(&element.name));
        } else if type_name == TYPE_CHILD {
            children.insert(lossy(&element.name));
        }
    }
    systems.retain(|name| !children.contains(name));
    systems
}

pub fn check_parents(pcf: &PcfFile, parents: &BTreeSet<String>) -> bool {
    pcf.elements.iter().any(|element| {
        pcf.type_name(element) == TYPE_SYSTEM && parents.contains(&lossy(&element.name))
    })
}

/// Vanilla structure with the mod's material swaps applied by element name.
/// Used for `disguise.pcf`, where only material changes are safe to take.
pub fn update_materials(base: &PcfFile, mod_pcf: &PcfFile) -> PcfFile {
    let mut mod_materials: HashMap<String, PcfAttr> = HashMap::new();
    for element in &mod_pcf.elements {
        if let Some(attr) = element.attr(b"material") {
            mod_materials.insert(lossy(&element.name), attr.clone());
        }
    }
    let mut result = base.clone();
    for element in &mut result.elements {
        if let Some(attr) = mod_materials.get(&lossy(&element.name)) {
            element.set_attr(b"material", attr.clone());
        }
    }
    result
}

/// Root systems: system definitions never referenced as a child by another
/// system in the same file. References follow child/definition-named string
/// attributes, element references, and children arrays (through
/// `DmeParticleChild` hops), matching the map generator the mod ecosystem's
/// rebuild lists come from.
pub fn find_root_systems(pcf: &PcfFile) -> Vec<String> {
    let mut system_last_index: BTreeMap<String, usize> = BTreeMap::new();
    for (index, element) in pcf.elements.iter().enumerate() {
        if pcf.type_name(element) == TYPE_SYSTEM {
            system_last_index.insert(lossy(&element.name), index);
        }
    }

    let mut referenced: BTreeSet<String> = BTreeSet::new();
    for (_, &index) in &system_last_index {
        let element = &pcf.elements[index];
        for (name, attr) in &element.attributes {
            let attr_name = lossy(name).to_lowercase();
            let child_or_definition =
                attr_name.contains("child") || attr_name.contains("definition");
            match (&attr.type_code, &attr.value) {
                (&ty::STRING, PcfValue::String(value)) => {
                    if !value.is_empty() && child_or_definition {
                        let target = lossy(value);
                        if system_last_index.contains_key(&target) {
                            referenced.insert(target);
                        }
                    }
                }
                (&ty::ELEMENT, PcfValue::Element(value)) => {
                    if (*value as usize) < pcf.elements.len() && child_or_definition {
                        let target = lossy(&pcf.elements[*value as usize].name);
                        if system_last_index.contains_key(&target) {
                            referenced.insert(target);
                        }
                    }
                }
                (&ty::ELEMENT_ARRAY, PcfValue::Array(items)) => {
                    if !attr_name.contains("child") {
                        continue;
                    }
                    for item in items {
                        let PcfValue::Element(item_index) = item else {
                            continue;
                        };
                        if (*item_index as usize) >= pcf.elements.len() {
                            continue;
                        }
                        let mut target = &pcf.elements[*item_index as usize];
                        if pcf.type_name(target) == TYPE_CHILD {
                            for (child_name, child_attr) in &target.attributes {
                                if child_name == b"child" {
                                    if let (&ty::ELEMENT, PcfValue::Element(child_index)) =
                                        (&child_attr.type_code, &child_attr.value)
                                    {
                                        if (*child_index as usize) < pcf.elements.len() {
                                            target = &pcf.elements[*child_index as usize];
                                        }
                                        break;
                                    }
                                }
                            }
                        }
                        let target_name = lossy(&target.name);
                        if system_last_index.contains_key(&target_name) {
                            referenced.insert(target_name);
                        }
                    }
                }
                (code, PcfValue::Array(items)) if *code == ty::STRING + ty::ARRAY_BASE_OFFSET => {
                    if !attr_name.contains("child") {
                        continue;
                    }
                    for item in items {
                        if let PcfValue::String(value) = item {
                            let target = lossy(value);
                            if system_last_index.contains_key(&target) {
                                referenced.insert(target);
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }

    system_last_index
        .keys()
        .filter(|name| !referenced.contains(*name))
        .cloned()
        .collect()
}

/// A copy of the file keeping only the named elements and everything they
/// reference, with the root's system list rebuilt. Kept elements stay in
/// their original relative order.
pub fn extract_elements(pcf: &PcfFile, names: &[String]) -> Result<PcfFile, PcfError> {
    if pcf.elements.is_empty() {
        return Err(PcfError("Particle file has no elements.".into()));
    }
    let root_list = pcf.elements[0]
        .attr(b"particleSystemDefinitions")
        .ok_or_else(|| PcfError("Particle file has no root system list.".into()))?;
    let root_list_type = root_list.type_code;

    let mut keep: BTreeSet<usize> = BTreeSet::new();
    keep.insert(0);
    for name in names {
        // Prefer the system definition: a DmeParticleChild record often
        // shares its system's name, and extracting the record's tree instead
        // would silently drop the effect.
        let Some(start) = pcf
            .elements
            .iter()
            .position(|element| {
                pcf.type_name(element) == TYPE_SYSTEM && lossy(&element.name) == *name
            })
            .or_else(|| {
                pcf.elements
                    .iter()
                    .position(|element| lossy(&element.name) == *name)
            })
        else {
            continue;
        };
        let mut stack = vec![start];
        while let Some(index) = stack.pop() {
            if !keep.insert(index) {
                continue;
            }
            for (_, attr) in &pcf.elements[index].attributes {
                match (&attr.type_code, &attr.value) {
                    (&ty::ELEMENT, PcfValue::Element(value)) => {
                        if *value != NO_ELEMENT && (*value as usize) < pcf.elements.len() {
                            stack.push(*value as usize);
                        }
                    }
                    (&ty::ELEMENT_ARRAY, PcfValue::Array(items)) => {
                        for item in items {
                            if let PcfValue::Element(value) = item {
                                if *value != NO_ELEMENT && (*value as usize) < pcf.elements.len() {
                                    stack.push(*value as usize);
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    let old_to_new: HashMap<usize, u32> = keep
        .iter()
        .enumerate()
        .map(|(new_index, &old_index)| (old_index, new_index as u32))
        .collect();

    let mut new_elements: Vec<PcfElement> = Vec::with_capacity(keep.len());
    for &old_index in &keep {
        let source = &pcf.elements[old_index];
        let mut element = PcfElement {
            type_name_index: source.type_name_index,
            name: source.name.clone(),
            signature: source.signature,
            attributes: Vec::with_capacity(source.attributes.len()),
        };
        for (name, attr) in &source.attributes {
            let mut attr = attr.clone();
            match (&attr.type_code, &mut attr.value) {
                (&ty::ELEMENT, PcfValue::Element(value)) => {
                    if *value != NO_ELEMENT {
                        if let Some(new_index) = old_to_new.get(&(*value as usize)) {
                            *value = *new_index;
                        }
                    }
                }
                (&ty::ELEMENT_ARRAY, PcfValue::Array(items)) => {
                    for item in items {
                        if let PcfValue::Element(value) = item {
                            if *value != NO_ELEMENT {
                                if let Some(new_index) = old_to_new.get(&(*value as usize)) {
                                    *value = *new_index;
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
            element.attributes.push((name.clone(), attr));
        }
        new_elements.push(element);
    }

    let mut result = PcfFile {
        version: pcf.version.clone(),
        string_dictionary: pcf.string_dictionary.clone(),
        elements: new_elements,
    };

    let system_indices: Vec<PcfValue> = result
        .elements
        .iter()
        .enumerate()
        .skip(1)
        .filter(|(_, element)| result.type_name(element) == TYPE_SYSTEM)
        .map(|(index, _)| PcfValue::Element(index as u32))
        .collect();
    result.elements[0].set_attr(
        b"particleSystemDefinitions",
        PcfAttr {
            type_code: root_list_type,
            value: PcfValue::Array(system_indices),
        },
    );

    Ok(result)
}

/// Names of all system definitions in the file, in element order.
pub fn system_definition_names(pcf: &PcfFile) -> Vec<String> {
    pcf.elements
        .iter()
        .filter(|element| pcf.type_name(element) == TYPE_SYSTEM)
        .map(|element| lossy(&element.name))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dict(names: &[&str]) -> Vec<Vec<u8>> {
        names.iter().map(|name| name.as_bytes().to_vec()).collect()
    }

    fn element(type_index: u16, name: &str, attrs: Vec<(&str, PcfAttr)>) -> PcfElement {
        PcfElement {
            type_name_index: type_index,
            name: name.as_bytes().to_vec(),
            signature: [7; 16],
            attributes: attrs
                .into_iter()
                .map(|(attr_name, attr)| (attr_name.as_bytes().to_vec(), attr))
                .collect(),
        }
    }

    fn attr(type_code: u8, value: PcfValue) -> PcfAttr {
        PcfAttr { type_code, value }
    }

    fn float(value: f32) -> PcfValue {
        PcfValue::Float(value.to_bits())
    }

    fn elements_array(indices: &[u32]) -> PcfAttr {
        attr(
            ty::ELEMENT_ARRAY,
            PcfValue::Array(indices.iter().map(|i| PcfValue::Element(*i)).collect()),
        )
    }

    /// dict entries: 0 DmeElement, 1 DmeParticleSystemDefinition,
    /// 2 DmeParticleChild, 3 DmeParticleOperator, plus attribute names.
    fn base_dict() -> Vec<Vec<u8>> {
        dict(&[
            "DmeElement",
            "DmeParticleSystemDefinition",
            "DmeParticleChild",
            "DmeParticleOperator",
            "particleSystemDefinitions",
            "children",
            "child",
            "functionName",
            "radius",
            "material",
        ])
    }

    fn sample_file() -> PcfFile {
        // 0 root, 1 system A, 2 system B, 3+4 identical operators referenced
        // from both systems' operator arrays, 5 child record pointing at B.
        PcfFile {
            version: PCF_HEADERS[1].to_string(),
            string_dictionary: base_dict(),
            elements: vec![
                element(0, "root", vec![("particleSystemDefinitions", elements_array(&[1, 2]))]),
                element(
                    1,
                    "effect_a",
                    vec![
                        ("children", elements_array(&[5, 5])),
                        ("functionName", elements_array(&[3])),
                        ("radius", attr(ty::FLOAT, float(5.0))),
                    ],
                ),
                element(
                    1,
                    "effect_b",
                    vec![("functionName", elements_array(&[4]))],
                ),
                element(3, "op", vec![("radius", attr(ty::FLOAT, float(2.5)))]),
                element(3, "op", vec![("radius", attr(ty::FLOAT, float(2.5)))]),
                element(
                    2,
                    "effect_b",
                    vec![("child", attr(ty::ELEMENT, PcfValue::Element(NO_ELEMENT)))],
                ),
            ],
        }
    }

    #[test]
    fn roundtrips_exactly() {
        let file = sample_file();
        let bytes = encode_pcf(&file).unwrap();
        let decoded = decode_pcf(&bytes).unwrap();
        assert_eq!(decoded, file);
        assert_eq!(encode_pcf(&decoded).unwrap(), bytes);
    }

    #[test]
    fn rejects_unknown_header() {
        let mut bytes = encode_pcf(&sample_file()).unwrap();
        bytes[5] = b'X';
        assert!(decode_pcf(&bytes).is_err());
    }

    #[test]
    fn shrink_pipeline_dedupes_and_fixes_children() {
        let mut file = sample_file();
        remove_duplicate_elements(&mut file);

        // The duplicate operator collapsed; the broken child ref now points at
        // effect_b's system definition; default radius 5.0 dropped.
        assert_eq!(file.elements.len(), 5);
        let effect_a = &file.elements[1];
        assert!(effect_a.attr(b"radius").is_none());
        let children = effect_a.attr(b"children").unwrap();
        if let PcfValue::Array(items) = &children.value {
            assert_eq!(items.len(), 1);
        } else {
            panic!("children should stay an element array");
        }
        let child_record = file
            .elements
            .iter()
            .find(|element| file.type_name(element) == TYPE_CHILD)
            .unwrap();
        let target = match child_record.attr(b"child").unwrap().value {
            PcfValue::Element(value) => value,
            _ => panic!("child stays an element ref"),
        };
        assert_eq!(
            file.elements[target as usize].name,
            b"effect_b".to_vec(),
            "broken child reference resolves to the same-named system"
        );

        // Operator elements referenced from both arrays now share one index.
        let op_ref = |element: &PcfElement| match &element.attr(b"functionName").unwrap().value {
            PcfValue::Array(items) => match items[0] {
                PcfValue::Element(value) => value,
                _ => panic!(),
            },
            _ => panic!(),
        };
        assert_eq!(op_ref(&file.elements[1]), op_ref(&file.elements[2]));

        // Dictionary shrank to used names only, sorted.
        let mut sorted = file.string_dictionary.clone();
        sorted.sort();
        assert_eq!(file.string_dictionary, sorted);
        assert!(!file.string_dictionary.contains(&b"material".to_vec()));

        let bytes = encode_pcf(&file).unwrap();
        assert_eq!(decode_pcf(&bytes).unwrap(), file);
    }

    #[test]
    fn default_matching_uses_numeric_semantics() {
        assert!(matches_default(&float(5.0), &Default::Float(5.0)));
        assert!(matches_default(&PcfValue::Integer(0), &Default::Float(0.0)));
        assert!(matches_default(&PcfValue::Boolean(true), &Default::Int(1)));
        // f32(0.1) as f64 is not the f64 literal 0.1, so it never matches.
        assert!(!matches_default(&float(0.1), &Default::Float(0.1)));
        assert!(matches_default(
            &PcfValue::Color([255, 255, 255, 255]),
            &Default::Rgba([255.0, 255.0, 255.0, 255.0])
        ));
        assert!(matches_default(
            &PcfValue::Vector3([(-10f32).to_bits(); 3]),
            &Default::Vec3([-10.0, -10.0, -10.0])
        ));
        assert!(!matches_default(
            &PcfValue::Array(vec![PcfValue::Integer(0)]),
            &Default::Int(0)
        ));
    }

    #[test]
    fn parents_and_roots() {
        let file = sample_file();
        let parents = get_parent_elements(&file);
        // effect_b is named by a DmeParticleChild record, so only effect_a is
        // a parent.
        assert_eq!(
            parents.iter().cloned().collect::<Vec<_>>(),
            vec!["effect_a".to_string()]
        );
        assert!(check_parents(&file, &parents));
        assert!(!check_parents(
            &file,
            &BTreeSet::from(["other".to_string()])
        ));

        // Roots: effect_a's children array points (via the child record) at
        // effect_b, so effect_b is not a root.
        let mut file = sample_file();
        // Fix the child ref so the hop resolves.
        file.elements[5].set_attr(
            b"child",
            attr(ty::ELEMENT, PcfValue::Element(2)),
        );
        assert_eq!(find_root_systems(&file), vec!["effect_a".to_string()]);
    }

    #[test]
    fn update_materials_swaps_only_materials() {
        let mut base = sample_file();
        base.elements[1].set_attr(
            b"material",
            attr(ty::STRING, PcfValue::String(b"effects/base".to_vec())),
        );
        let mut mod_pcf = sample_file();
        mod_pcf.elements[1].set_attr(
            b"material",
            attr(ty::STRING, PcfValue::String(b"effects/modded".to_vec())),
        );
        mod_pcf.elements[1].set_attr(b"radius", attr(ty::FLOAT, float(99.0)));

        let merged = update_materials(&base, &mod_pcf);
        let system = &merged.elements[1];
        assert_eq!(
            system.attr(b"material").unwrap().value,
            PcfValue::String(b"effects/modded".to_vec())
        );
        assert_eq!(system.attr(b"radius").unwrap().value, float(5.0));
    }

    /// Cross-validation against the reference corpus generated with cueki's
    /// own pipeline (see design-qa.md). Run manually:
    /// `EXECS_PCF_CORPUS=<scratchpad> cargo test corpus_ -- --ignored`
    #[test]
    #[ignore = "needs the local reference corpus"]
    fn corpus_cross_validation() {
        let Some(corpus) = std::env::var_os("EXECS_PCF_CORPUS") else {
            panic!("set EXECS_PCF_CORPUS to the corpus root");
        };
        let root = std::path::PathBuf::from(corpus);
        let manifest: serde_json::Value = serde_json::from_slice(
            &std::fs::read(root.join("refcorpus/manifest.json")).unwrap(),
        )
        .unwrap();
        let disguise_parents: BTreeSet<String> = manifest["disguise_parents"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| value.as_str().unwrap().to_string())
            .collect();

        let mut compared = 0usize;
        let mut skipped = 0usize;
        for record in manifest["files"].as_array().unwrap() {
            let tag = record["tag"].as_str().unwrap();
            let src = std::path::Path::new(record["src"].as_str().unwrap());
            let src = if src.is_absolute() {
                src.to_path_buf()
            } else {
                root.join(src)
            };
            let raw = std::fs::read(&src).unwrap();
            let file = decode_pcf(&raw).unwrap_or_else(|err| panic!("{tag}: {}", err.0));
            if record["status"].as_str() == Some("skipped_parents") {
                assert!(
                    check_parents(&file, &disguise_parents),
                    "{tag}: expected a disguise-parent hit"
                );
                skipped += 1;
                continue;
            }
            let mut processed = if record["orig"].as_str() == Some("disguise.pcf") {
                let vanilla =
                    decode_pcf(&std::fs::read(root.join("vanilla_all/disguise.pcf")).unwrap())
                        .unwrap();
                update_materials(&vanilla, &file)
            } else {
                file
            };
            remove_duplicate_elements(&mut processed);
            let encoded = encode_pcf(&processed).unwrap();
            let expected = std::fs::read(root.join(format!("refcorpus/{tag}.out.pcf"))).unwrap();

            // What actually gates an install: the shrunk file fits the stock
            // entry it replaces.
            if let Some(target_size) = record["target_size"].as_u64() {
                if record["status"].as_str() == Some("fits") {
                    assert!(
                        encoded.len() as u64 <= target_size,
                        "{tag}: {} bytes over its stock budget",
                        encoded.len() as u64 - target_size
                    );
                }
            }

            // cueki's dedup groups by python `hash()` alone; in these files a
            // stock pair of near-identical operators collides and it wrongly
            // merges -2.0 speed vectors into -1.0 ones. Our structural key
            // keeps them apart, so these are slightly larger and more
            // faithful. (List verified by sweeping the corpus for collision
            // groups with cueki's own hash.)
            const HASH_COLLISION_DIVERGENCES: [&str; 6] = [
                "Ghytd_Pack__taunt_fx",
                "Ghytd_Pack__smoke_blackbillow",
                "Square_Series__taunt_fx",
                "Square_Series__smoke_blackbillow",
                "TF2_Classic__taunt_fx",
                "Toon_Pack__taunt_fx",
            ];
            if HASH_COLLISION_DIVERGENCES.contains(&tag) {
                assert!(
                    encoded.len() >= expected.len()
                        && encoded.len() <= expected.len() + 1024,
                    "{tag}: unexpected size delta vs reference"
                );
                let reference = decode_pcf(&expected).unwrap();
                let mut mine_systems = system_definition_names(&processed);
                let mut ref_systems = system_definition_names(&reference);
                mine_systems.sort();
                ref_systems.sort();
                assert_eq!(mine_systems, ref_systems, "{tag}: system sets diverge");
            } else {
                if encoded.len() != expected.len() {
                    let _ = std::fs::write(root.join(format!("mine_{tag}.pcf")), &encoded);
                }
                assert_eq!(
                    encoded.len(),
                    expected.len(),
                    "{tag}: size mismatch vs reference"
                );
                assert_eq!(encoded, expected, "{tag}: bytes differ from reference");
            }
            compared += 1;
        }
        assert!(compared > 100, "corpus should cover the mod library");
        assert!(skipped >= 1 || compared > 0);
        println!("corpus: {compared} byte-exact, {skipped} parent-skips");
    }

    /// The rebuild path: derive keep-lists from vanilla files and check the
    /// extracted trees match the reference keep-lists and fit their targets.
    #[test]
    #[ignore = "needs the local reference corpus"]
    fn corpus_rebuild_extraction() {
        let Some(corpus) = std::env::var_os("EXECS_PCF_CORPUS") else {
            panic!("set EXECS_PCF_CORPUS to the corpus root");
        };
        let root = std::path::PathBuf::from(corpus);
        let manifest: serde_json::Value = serde_json::from_slice(
            &std::fs::read(root.join("refcorpus/manifest.json")).unwrap(),
        )
        .unwrap();
        let derived: serde_json::Value =
            serde_json::from_slice(&std::fs::read(root.join("derived_roots.json")).unwrap())
                .unwrap();

        // Every vanilla file's derived roots must match the python analyzer.
        let mut checked = 0usize;
        for (name, expected) in derived.as_object().unwrap() {
            let raw = std::fs::read(root.join("vanilla_all").join(name)).unwrap();
            let file = decode_pcf(&raw).unwrap_or_else(|err| panic!("{name}: {}", err.0));
            let roots = find_root_systems(&file);
            let expected: Vec<String> = expected
                .as_array()
                .unwrap()
                .iter()
                .map(|value| value.as_str().unwrap().to_string())
                .collect();
            assert_eq!(roots, expected, "{name}: root systems diverge");
            checked += 1;
        }
        assert!(checked > 100);

        for (name, keep) in manifest["rebuild_keep"].as_object().unwrap() {
            let keep: Vec<String> = keep
                .as_array()
                .unwrap()
                .iter()
                .map(|value| value.as_str().unwrap().to_string())
                .collect();
            let raw = std::fs::read(root.join("vanilla_all").join(name)).unwrap();
            let vanilla = decode_pcf(&raw).unwrap();
            let mut rebuilt = extract_elements(&vanilla, &keep).unwrap();
            remove_duplicate_elements(&mut rebuilt);
            let encoded = encode_pcf(&rebuilt).unwrap();
            assert!(
                encoded.len() <= raw.len(),
                "{name}: rebuild must fit the vanilla byte budget"
            );
            let round = decode_pcf(&encoded).unwrap();
            let mut kept_systems = system_definition_names(&round);
            kept_systems.sort();
            for system in &keep {
                assert!(
                    kept_systems.binary_search(system).is_ok(),
                    "{name}: rebuilt file lost {system}"
                );
            }
        }
        println!("rebuild extraction validated for {checked} files");
    }

    #[test]
    fn extract_keeps_named_trees_and_rebuilds_root() {
        let file = sample_file();
        let extracted = extract_elements(&file, &["effect_a".to_string()]).unwrap();
        // Keeps root, effect_a, its operator, and the child record; the
        // effect_b system itself is unreachable (the child record's ref is
        // the NO_ELEMENT sentinel) so it drops out of the definitions.
        let systems = system_definition_names(&extracted);
        assert_eq!(systems, vec!["effect_a".to_string()]);
        let root_list = match &extracted.elements[0]
            .attr(b"particleSystemDefinitions")
            .unwrap()
            .value
        {
            PcfValue::Array(items) => items.len(),
            _ => panic!(),
        };
        assert_eq!(root_list, 1);
        // Round-trips cleanly.
        let bytes = encode_pcf(&extracted).unwrap();
        assert_eq!(decode_pcf(&bytes).unwrap(), extracted);
    }
}
