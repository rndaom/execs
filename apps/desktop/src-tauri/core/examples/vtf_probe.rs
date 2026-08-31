//! Dev tool: decode VTF files (or every crosshair sprite in a TF2 install)
//! and print a terminal preview. `cargo run --example vtf_probe -- <path...>`;
//! a directory argument is treated as a TF2 root.

use execs_core::vtf_read::decode_vtf_frame0;

fn preview(rgba: &[u8], width: u32, height: u32) {
    let step_y = (height as usize / 24).max(1);
    let step_x = (width as usize / 48).max(1);
    for y in (0..height as usize).step_by(step_y) {
        let mut line = String::new();
        for x in (0..width as usize).step_by(step_x) {
            let i = (y * width as usize + x) * 4;
            let a = rgba[i + 3];
            let lum = (u32::from(rgba[i]) + u32::from(rgba[i + 1]) + u32::from(rgba[i + 2])) / 3;
            line.push(if a < 32 {
                ' '
            } else if lum > 170 {
                '#'
            } else if lum > 85 {
                '+'
            } else {
                '.'
            });
        }
        println!("{line}");
    }
}

fn main() {
    for arg in std::env::args().skip(1) {
        let path = std::path::Path::new(&arg);
        if path.is_dir() {
            match execs_core::extract_stock_crosshair_sprites(path) {
                Ok(sprites) => {
                    for (name, sprite) in sprites {
                        println!(
                            "== stock {name}: {}x{} ({} bytes rgba)",
                            sprite.width,
                            sprite.height,
                            sprite.rgba.len()
                        );
                        preview(&sprite.rgba, sprite.width, sprite.height);
                    }
                }
                Err(err) => println!("!! {arg}: {}", err.message()),
            }
            continue;
        }
        let bytes = std::fs::read(path).expect("read file");
        match decode_vtf_frame0(&bytes) {
            Ok(decoded) => {
                println!(
                    "== {arg}: {}x{}, {} frame(s)",
                    decoded.width, decoded.height, decoded.frames
                );
                preview(&decoded.rgba, decoded.width, decoded.height);
            }
            Err(err) => println!("!! {arg}: {err}"),
        }
    }
}
