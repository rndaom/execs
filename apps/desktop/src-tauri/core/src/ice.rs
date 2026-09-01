//! Thin ICE (`IceKey(0)`): 8 rounds, 8-byte key.
//! Faithful port of Valve's public-domain Matthew Kwan IceKey.cpp (the `vice` cipher).
//! Used to read the user's own `tf_weapon_*.ctx`. We never write official VPKs.

use std::sync::OnceLock;

const ROUNDS: usize = 8;

const ICE_SMOD: [[u32; 4]; 4] = [
    [333, 313, 505, 369],
    [379, 375, 319, 391],
    [361, 445, 451, 397],
    [397, 425, 395, 505],
];

const ICE_SXOR: [[u32; 4]; 4] = [
    [0x83, 0x85, 0x9b, 0xcd],
    [0xcc, 0xa7, 0xad, 0x41],
    [0x4b, 0x2e, 0xd4, 0x33],
    [0xea, 0xcb, 0x2e, 0x04],
];

const PBOX: [u32; 32] = [
    0x0000_0001,
    0x0000_0080,
    0x0000_0400,
    0x0000_2000,
    0x0008_0000,
    0x0020_0000,
    0x0100_0000,
    0x4000_0000,
    0x0000_0008,
    0x0000_0020,
    0x0000_0100,
    0x0000_4000,
    0x0001_0000,
    0x0080_0000,
    0x0400_0000,
    0x2000_0000,
    0x0000_0004,
    0x0000_0010,
    0x0000_0200,
    0x0000_8000,
    0x0002_0000,
    0x0040_0000,
    0x0800_0000,
    0x1000_0000,
    0x0000_0002,
    0x0000_0040,
    0x0000_0800,
    0x0000_1000,
    0x0004_0000,
    0x0010_0000,
    0x0200_0000,
    0x8000_0000,
];

const ICE_KEYROT: [usize; 8] = [0, 1, 2, 3, 2, 1, 3, 0];

fn gf_mult(mut a: u32, mut b: u32, m: u32) -> u32 {
    let mut res = 0;
    while b != 0 {
        if b & 1 != 0 {
            res ^= a;
        }
        a <<= 1;
        b >>= 1;
        if a >= 256 {
            a ^= m;
        }
    }
    res
}

fn gf_exp7(b: u32, m: u32) -> u32 {
    if b == 0 {
        return 0;
    }
    let mut x = gf_mult(b, b, m);
    x = gf_mult(b, x, m);
    x = gf_mult(x, x, m);
    gf_mult(b, x, m)
}

fn ice_perm32(mut x: u32) -> u32 {
    let mut res = 0;
    for item in PBOX {
        if x == 0 {
            break;
        }
        if x & 1 != 0 {
            res |= item;
        }
        x >>= 1;
    }
    res
}

fn sboxes() -> &'static [[u32; 1024]; 4] {
    static BOXES: OnceLock<[[u32; 1024]; 4]> = OnceLock::new();
    BOXES.get_or_init(|| {
        let mut boxes = [[0u32; 1024]; 4];
        // Faithful port of Kwan's IceKey table build; indices mirror the reference.
        #[allow(clippy::needless_range_loop)]
        for i in 0..1024 {
            let col = (i >> 1) & 0xff;
            let row = (i & 0x1) | ((i & 0x200) >> 8);
            for box_i in 0..4 {
                let x = gf_exp7(col as u32 ^ ICE_SXOR[box_i][row], ICE_SMOD[box_i][row]);
                let shifted = match box_i {
                    0 => x << 24,
                    1 => x << 16,
                    2 => x << 8,
                    _ => x,
                };
                boxes[box_i][i] = ice_perm32(shifted);
            }
        }
        boxes
    })
}

#[derive(Clone)]
pub struct IceKey {
    keys: [[u32; 3]; ROUNDS],
}

impl IceKey {
    pub fn new(key: &[u8; 8]) -> Self {
        let mut ice = Self {
            keys: [[0; 3]; ROUNDS],
        };
        ice.set(key);
        ice
    }

    fn set(&mut self, key: &[u8; 8]) {
        let mut kb = [0u16; 4];
        for i in 0..4 {
            kb[3 - i] = u16::from(key[i * 2]) << 8 | u16::from(key[i * 2 + 1]);
        }
        self.schedule_build(&mut kb, 0, &ICE_KEYROT);
    }

    #[allow(clippy::needless_range_loop)]
    fn schedule_build(&mut self, kb: &mut [u16; 4], n: usize, keyrot: &[usize]) {
        for i in 0..8 {
            let kr = keyrot[i];
            self.keys[n + i] = [0, 0, 0];
            for j in 0..15 {
                let slot = j % 3;
                for k in 0..4 {
                    let idx = (kr + k) & 3;
                    let bit = kb[idx] & 1;
                    self.keys[n + i][slot] = (self.keys[n + i][slot] << 1) | u32::from(bit);
                    kb[idx] = (kb[idx] >> 1) | ((bit ^ 1) << 15);
                }
            }
        }
    }

    fn f(&self, p: u32, sk: &[u32; 3]) -> u32 {
        let boxes = sboxes();
        let tl = ((p >> 16) & 0x3ff) | (p.rotate_right(14) & 0xffc00);
        let tr = (p & 0x3ff) | ((p << 2) & 0xffc00);
        let mut al = sk[2] & (tl ^ tr);
        let mut ar = al ^ tr;
        al ^= tl;
        al ^= sk[0];
        ar ^= sk[1];
        boxes[0][(al >> 10) as usize]
            | boxes[1][(al & 0x3ff) as usize]
            | boxes[2][(ar >> 10) as usize]
            | boxes[3][(ar & 0x3ff) as usize]
    }

    pub fn encrypt_block(&self, input: [u8; 8]) -> [u8; 8] {
        let mut l = u32::from(input[0]) << 24
            | u32::from(input[1]) << 16
            | u32::from(input[2]) << 8
            | u32::from(input[3]);
        let mut r = u32::from(input[4]) << 24
            | u32::from(input[5]) << 16
            | u32::from(input[6]) << 8
            | u32::from(input[7]);
        let mut i = 0;
        while i < ROUNDS {
            l ^= self.f(r, &self.keys[i]);
            r ^= self.f(l, &self.keys[i + 1]);
            i += 2;
        }
        pack_swapped(l, r)
    }

    pub fn decrypt_block(&self, input: [u8; 8]) -> [u8; 8] {
        let mut l = u32::from(input[0]) << 24
            | u32::from(input[1]) << 16
            | u32::from(input[2]) << 8
            | u32::from(input[3]);
        let mut r = u32::from(input[4]) << 24
            | u32::from(input[5]) << 16
            | u32::from(input[6]) << 8
            | u32::from(input[7]);
        for i in (1..ROUNDS).rev().step_by(2) {
            l ^= self.f(r, &self.keys[i]);
            r ^= self.f(l, &self.keys[i - 1]);
        }
        pack_swapped(l, r)
    }

    pub fn encrypt(&self, data: &[u8]) -> Vec<u8> {
        transform(self, data, false)
    }

    pub fn decrypt(&self, data: &[u8]) -> Vec<u8> {
        transform(self, data, true)
    }
}

fn pack_swapped(mut l: u32, mut r: u32) -> [u8; 8] {
    let mut out = [0u8; 8];
    for i in 0..4 {
        out[3 - i] = (r & 0xff) as u8;
        out[7 - i] = (l & 0xff) as u8;
        r >>= 8;
        l >>= 8;
    }
    out
}

fn transform(key: &IceKey, data: &[u8], decrypt: bool) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len());
    let mut i = 0;
    while i + 8 <= data.len() {
        let mut block = [0u8; 8];
        block.copy_from_slice(&data[i..i + 8]);
        let next = if decrypt {
            key.decrypt_block(block)
        } else {
            key.encrypt_block(block)
        };
        out.extend_from_slice(&next);
        i += 8;
    }
    if i < data.len() {
        out.extend_from_slice(&data[i..]);
    }
    out
}

pub const TF2_WEAPON_KEY: [u8; 8] = *b"E2NcUkG2";

pub fn decrypt_weapon_ctx(bytes: &[u8]) -> Vec<u8> {
    IceKey::new(&TF2_WEAPON_KEY).decrypt(bytes)
}

pub fn encrypt_weapon_ctx(bytes: &[u8]) -> Vec<u8> {
    let mut padded = bytes.to_vec();
    if !padded.len().is_multiple_of(8) {
        padded.resize(padded.len().div_ceil(8) * 8, 0);
    }
    IceKey::new(&TF2_WEAPON_KEY).encrypt(&padded)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_plaintext() {
        let text = b"WeaponData\n{\n\t\"printname\"\t\"Scattergun\"\n}\n";
        let cipher = encrypt_weapon_ctx(text);
        assert_ne!(&cipher[..text.len()], text.as_slice());
        let plain = decrypt_weapon_ctx(&cipher);
        assert!(String::from_utf8_lossy(&plain).contains("Scattergun"));
    }

    #[test]
    fn block_round_trips() {
        let key = IceKey::new(b"E2NcUkG2");
        let plain = *b"WeaponDa";
        let cipher = key.encrypt_block(plain);
        assert_ne!(cipher, plain);
        assert_eq!(key.decrypt_block(cipher), plain);
    }
}
