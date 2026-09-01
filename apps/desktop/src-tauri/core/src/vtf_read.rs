//! Minimal VTF reader: frame 0 of the largest mip, decoded to RGBA. Covers the
//! formats TF2 uses for crosshair sprites and community crosshair packs
//! (BGRA8888, RGBA8888, DXT1, DXT5). Read-only; never writes game files.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedVtf {
    pub width: u32,
    pub height: u32,
    pub frames: u16,
    /// Unpremultiplied RGBA, row-major.
    pub rgba: Vec<u8>,
}

const FORMAT_RGBA8888: i32 = 0;
const FORMAT_ABGR8888: i32 = 1;
const FORMAT_BGRA8888: i32 = 12;
const FORMAT_DXT1: i32 = 13;
const FORMAT_DXT5: i32 = 15;
const FORMAT_NONE: i32 = -1;

fn read_u16(bytes: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(bytes.get(at..at + 2)?.try_into().ok()?))
}

fn read_u32(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

fn read_i32(bytes: &[u8], at: usize) -> Option<i32> {
    Some(i32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

fn format_data_size(format: i32, width: u32, height: u32) -> Option<usize> {
    match format {
        FORMAT_RGBA8888 | FORMAT_ABGR8888 | FORMAT_BGRA8888 => Some((width * height * 4) as usize),
        FORMAT_DXT1 => Some((width.div_ceil(4) * height.div_ceil(4) * 8) as usize),
        FORMAT_DXT5 => Some((width.div_ceil(4) * height.div_ceil(4) * 16) as usize),
        FORMAT_NONE => Some(0),
        _ => None,
    }
}

fn mip_dimensions(width: u32, height: u32, mip: u32) -> (u32, u32) {
    ((width >> mip).max(1), (height >> mip).max(1))
}

/// Decode frame 0 of the largest mip. Fails on unsupported formats rather than
/// guessing.
pub fn decode_vtf_frame0(bytes: &[u8]) -> Result<DecodedVtf, String> {
    if bytes.len() < 64 || &bytes[0..4] != b"VTF\0" {
        return Err("Not a VTF file.".into());
    }
    let major = read_u32(bytes, 4).ok_or("VTF header truncated.")?;
    let minor = read_u32(bytes, 8).ok_or("VTF header truncated.")?;
    if major != 7 {
        return Err(format!("Unsupported VTF version {major}.{minor}."));
    }
    let header_size = read_u32(bytes, 12).ok_or("VTF header truncated.")? as usize;
    let width = u32::from(read_u16(bytes, 16).ok_or("VTF header truncated.")?);
    let height = u32::from(read_u16(bytes, 18).ok_or("VTF header truncated.")?);
    let frames = read_u16(bytes, 24).ok_or("VTF header truncated.")?.max(1);
    let format = read_i32(bytes, 52).ok_or("VTF header truncated.")?;
    let mip_count = u32::from(*bytes.get(56).ok_or("VTF header truncated.")?).max(1);
    let low_res_format = read_i32(bytes, 57).ok_or("VTF header truncated.")?;
    let low_res_w = u32::from(*bytes.get(61).ok_or("VTF header truncated.")?);
    let low_res_h = u32::from(*bytes.get(62).ok_or("VTF header truncated.")?);
    if width == 0 || height == 0 || width > 1024 || height > 1024 {
        return Err(format!("Unsupported VTF dimensions {width}x{height}."));
    }

    // Where the high-res image data starts.
    let data_start = if minor >= 3 {
        // 7.3+: resource dictionary. Entries begin at byte 80.
        let resource_count = read_u32(bytes, 68).ok_or("VTF header truncated.")? as usize;
        if resource_count > 64 {
            return Err("VTF resource table is implausibly large.".into());
        }
        let mut found = None;
        for index in 0..resource_count {
            let entry = 80 + index * 8;
            let tag = bytes
                .get(entry..entry + 3)
                .ok_or("VTF resources truncated.")?;
            if tag == [0x30, 0x00, 0x00] {
                found =
                    Some(read_u32(bytes, entry + 4).ok_or("VTF resources truncated.")? as usize);
                break;
            }
        }
        found.ok_or("VTF has no image resource.")?
    } else {
        let low_res_size = if low_res_format == FORMAT_NONE || low_res_w == 0 || low_res_h == 0 {
            0
        } else {
            format_data_size(low_res_format, low_res_w, low_res_h)
                .ok_or_else(|| format!("Unsupported VTF thumbnail format {low_res_format}."))?
        };
        header_size + low_res_size
    };

    // Mips are stored smallest→largest; within a mip, frame-major. Skip every
    // smaller mip (all frames), then land on frame 0 of mip 0.
    let mut offset = data_start;
    for mip in (1..mip_count).rev() {
        let (mip_w, mip_h) = mip_dimensions(width, height, mip);
        let mip_size = format_data_size(format, mip_w, mip_h)
            .ok_or_else(|| format!("Unsupported VTF format {format}."))?;
        offset += mip_size * frames as usize;
    }
    let frame_size = format_data_size(format, width, height)
        .ok_or_else(|| format!("Unsupported VTF format {format}."))?;
    let data = bytes
        .get(offset..offset + frame_size)
        .ok_or("VTF image data truncated.")?;

    let rgba = match format {
        FORMAT_RGBA8888 => data.to_vec(),
        FORMAT_ABGR8888 => {
            let mut out = data.to_vec();
            for chunk in out.as_chunks_mut::<4>().0 {
                chunk.reverse();
            }
            out
        }
        FORMAT_BGRA8888 => {
            let mut out = data.to_vec();
            for chunk in out.as_chunks_mut::<4>().0 {
                chunk.swap(0, 2);
            }
            out
        }
        FORMAT_DXT1 => decode_dxt(data, width, height, false)?,
        FORMAT_DXT5 => decode_dxt(data, width, height, true)?,
        other => return Err(format!("Unsupported VTF format {other}.")),
    };

    Ok(DecodedVtf {
        width,
        height,
        frames,
        rgba,
    })
}

fn rgb565(value: u16) -> [u8; 3] {
    let r = ((value >> 11) & 0x1f) as u32;
    let g = ((value >> 5) & 0x3f) as u32;
    let b = (value & 0x1f) as u32;
    [
        ((r * 255 + 15) / 31) as u8,
        ((g * 255 + 31) / 63) as u8,
        ((b * 255 + 15) / 31) as u8,
    ]
}

fn decode_dxt(data: &[u8], width: u32, height: u32, dxt5: bool) -> Result<Vec<u8>, String> {
    let block_bytes = if dxt5 { 16 } else { 8 };
    let blocks_x = width.div_ceil(4) as usize;
    let blocks_y = height.div_ceil(4) as usize;
    if data.len() < blocks_x * blocks_y * block_bytes {
        return Err("DXT data truncated.".into());
    }
    let mut out = vec![0u8; (width * height * 4) as usize];

    for by in 0..blocks_y {
        for bx in 0..blocks_x {
            let block = &data[(by * blocks_x + bx) * block_bytes..][..block_bytes];
            let (alpha, color_block): ([u8; 16], &[u8]) = if dxt5 {
                (decode_dxt5_alpha(&block[0..8]), &block[8..16])
            } else {
                ([255; 16], block)
            };

            let c0 = u16::from_le_bytes([color_block[0], color_block[1]]);
            let c1 = u16::from_le_bytes([color_block[2], color_block[3]]);
            let rgb0 = rgb565(c0);
            let rgb1 = rgb565(c1);
            let mut palette = [[0u8; 4]; 4];
            palette[0] = [rgb0[0], rgb0[1], rgb0[2], 255];
            palette[1] = [rgb1[0], rgb1[1], rgb1[2], 255];
            // DXT5 color blocks always use 4-color mode; DXT1 switches on c0<=c1.
            if dxt5 || c0 > c1 {
                for channel in 0..3 {
                    palette[2][channel] =
                        ((2 * u16::from(rgb0[channel]) + u16::from(rgb1[channel])) / 3) as u8;
                    palette[3][channel] =
                        ((u16::from(rgb0[channel]) + 2 * u16::from(rgb1[channel])) / 3) as u8;
                }
                palette[2][3] = 255;
                palette[3][3] = 255;
            } else {
                for channel in 0..3 {
                    palette[2][channel] =
                        ((u16::from(rgb0[channel]) + u16::from(rgb1[channel])) / 2) as u8;
                }
                palette[2][3] = 255;
                palette[3] = [0, 0, 0, 0];
            }
            let indices = u32::from_le_bytes([
                color_block[4],
                color_block[5],
                color_block[6],
                color_block[7],
            ]);

            for py in 0..4usize {
                for px in 0..4usize {
                    let x = bx * 4 + px;
                    let y = by * 4 + py;
                    if x >= width as usize || y >= height as usize {
                        continue;
                    }
                    let texel = py * 4 + px;
                    let index = ((indices >> (texel * 2)) & 0b11) as usize;
                    let mut pixel = palette[index];
                    if dxt5 {
                        pixel[3] = alpha[texel];
                    }
                    let at = (y * width as usize + x) * 4;
                    out[at..at + 4].copy_from_slice(&pixel);
                }
            }
        }
    }
    Ok(out)
}

fn decode_dxt5_alpha(block: &[u8]) -> [u8; 16] {
    let a0 = block[0];
    let a1 = block[1];
    let mut palette = [0u8; 8];
    palette[0] = a0;
    palette[1] = a1;
    if a0 > a1 {
        for i in 1..7u16 {
            palette[(i + 1) as usize] = (((7 - i) * u16::from(a0) + i * u16::from(a1)) / 7) as u8;
        }
    } else {
        for i in 1..5u16 {
            palette[(i + 1) as usize] = (((5 - i) * u16::from(a0) + i * u16::from(a1)) / 5) as u8;
        }
        palette[6] = 0;
        palette[7] = 255;
    }
    let mut bits: u64 = 0;
    for (index, byte) in block[2..8].iter().enumerate() {
        bits |= u64::from(*byte) << (8 * index);
    }
    let mut out = [0u8; 16];
    for (texel, slot) in out.iter_mut().enumerate() {
        let index = ((bits >> (3 * texel)) & 0b111) as usize;
        *slot = palette[index];
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header(
        minor: u32,
        width: u16,
        height: u16,
        frames: u16,
        format: i32,
        mips: u8,
        header_size: u32,
    ) -> Vec<u8> {
        let mut out = vec![0u8; header_size as usize];
        out[0..4].copy_from_slice(b"VTF\0");
        out[4..8].copy_from_slice(&7u32.to_le_bytes());
        out[8..12].copy_from_slice(&minor.to_le_bytes());
        out[12..16].copy_from_slice(&header_size.to_le_bytes());
        out[16..18].copy_from_slice(&width.to_le_bytes());
        out[18..20].copy_from_slice(&height.to_le_bytes());
        out[24..26].copy_from_slice(&frames.to_le_bytes());
        out[52..56].copy_from_slice(&format.to_le_bytes());
        out[56] = mips;
        out[57..61].copy_from_slice(&FORMAT_NONE.to_le_bytes());
        out
    }

    #[test]
    fn decodes_bgra_72_with_mips_and_frames() {
        // 8x8 BGRA, 2 mips, 2 frames. Data order: mip1(4x4) f0,f1 then mip0 f0,f1.
        let mut bytes = header(2, 8, 8, 2, FORMAT_BGRA8888, 2, 80);
        bytes.extend(vec![1u8; 4 * 4 * 4]); // mip1 frame0
        bytes.extend(vec![2u8; 4 * 4 * 4]); // mip1 frame1
        let mut frame0 = Vec::new();
        for _ in 0..(8 * 8) {
            frame0.extend_from_slice(&[10, 20, 30, 255]); // B G R A
        }
        bytes.extend(&frame0);
        bytes.extend(vec![9u8; 8 * 8 * 4]); // mip0 frame1
        let decoded = decode_vtf_frame0(&bytes).unwrap();
        assert_eq!((decoded.width, decoded.height, decoded.frames), (8, 8, 2));
        assert_eq!(&decoded.rgba[0..4], &[30, 20, 10, 255]);
    }

    #[test]
    #[allow(clippy::unusual_byte_groupings)]
    fn decodes_dxt1_solid_block() {
        // One 4x4 DXT1 block, both endpoints pure red, all indices 0.
        let mut bytes = header(2, 4, 4, 1, FORMAT_DXT1, 1, 80);
        let red = 0b11111_000000_00000u16;
        bytes.extend(&red.to_le_bytes());
        bytes.extend(&red.to_le_bytes());
        bytes.extend(&0u32.to_le_bytes());
        let decoded = decode_vtf_frame0(&bytes).unwrap();
        assert_eq!(&decoded.rgba[0..4], &[255, 0, 0, 255]);
        assert_eq!(decoded.rgba.len(), 4 * 4 * 4);
    }

    #[test]
    fn decodes_dxt5_alpha_endpoints() {
        // One 4x4 DXT5 block: alpha0=200 with all alpha indices 0, white color.
        let mut bytes = header(2, 4, 4, 1, FORMAT_DXT5, 1, 80);
        bytes.push(200); // a0
        bytes.push(0); // a1
        bytes.extend([0u8; 6]); // alpha indices -> palette[0] = 200
        let white = 0xffffu16;
        bytes.extend(&white.to_le_bytes());
        bytes.extend(&white.to_le_bytes());
        bytes.extend(&0u32.to_le_bytes());
        let decoded = decode_vtf_frame0(&bytes).unwrap();
        assert_eq!(&decoded.rgba[0..4], &[255, 255, 255, 200]);
    }

    #[test]
    fn reads_73_resource_dictionary() {
        // 7.3 header with one image resource pointing at BGRA data.
        let header_size = 96u32;
        let mut bytes = header(3, 2, 2, 1, FORMAT_BGRA8888, 1, header_size);
        bytes[68..72].copy_from_slice(&1u32.to_le_bytes()); // resource count
        bytes[80..83].copy_from_slice(&[0x30, 0x00, 0x00]); // image tag
        bytes[84..88].copy_from_slice(&(header_size).to_le_bytes()); // offset
        for _ in 0..4 {
            bytes.extend_from_slice(&[1, 2, 3, 255]);
        }
        let decoded = decode_vtf_frame0(&bytes).unwrap();
        assert_eq!(&decoded.rgba[0..4], &[3, 2, 1, 255]);
    }

    #[test]
    fn rejects_garbage() {
        assert!(decode_vtf_frame0(b"nope").is_err());
        let bytes = header(2, 4, 4, 1, 99, 1, 80);
        assert!(decode_vtf_frame0(&bytes).is_err());
    }
}
