//! Steam transport used only inside a dedicated development helper process.
use crate::protocol;
use base64::Engine;

use libloading::Library;
use std::{
    ffi::{c_char, c_void, CStr},
    time::{Duration, Instant},
};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;
type Interface = *mut c_void;

// ISteamGameCoordinator001 has exactly these three methods, in this order.
// C calling convention matches C++ instance methods on Windows x64 and Linux x64.
// Never use this declaration on 32-bit Windows (which requires thiscall).
#[repr(C)]
struct Coordinator {
    send: unsafe extern "C" fn(Interface, u32, *const c_void, u32) -> i32,
    available: unsafe extern "C" fn(Interface, *mut u32) -> bool,
    retrieve: unsafe extern "C" fn(Interface, *mut u32, *mut c_void, u32, *mut u32) -> i32,
}

struct Shutdown(unsafe extern "C" fn());

fn avatar_png(width: u32, height: u32, rgba: &[u8]) -> Option<String> {
    if width == 0
        || height == 0
        || width > 184
        || height > 184
        || rgba.len() != width as usize * height as usize * 4
    {
        return None;
    }
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.write_header().ok()?.write_image_data(rgba).ok()?;
    }
    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

// Optional local Steam presentation data. A missing SDK export or unloaded avatar
// never turns a valid backpack into an error. No web profile scraping is needed.
unsafe fn persona(
    library: &Library,
    client: Interface,
    user: i32,
    pipe: i32,
    steam_id: u64,
) -> (Option<String>, Option<String>) {
    type GetFriends = unsafe extern "C" fn(Interface, i32, i32, *const c_char) -> Interface;
    let read = || -> Option<(Option<String>, Option<String>)> {
        let get_friends = library
            .get::<GetFriends>(b"SteamAPI_ISteamClient_GetISteamFriends\0")
            .ok()?;
        let friends = get_friends(client, user, pipe, c"SteamFriends017".as_ptr());
        if friends.is_null() {
            return None;
        }
        let get_name = library
            .get::<unsafe extern "C" fn(Interface) -> *const c_char>(
                b"SteamAPI_ISteamFriends_GetPersonaName\0",
            )
            .ok()?;
        let name = get_name(friends);
        let name = if name.is_null() {
            None
        } else {
            let value = CStr::from_ptr(name).to_string_lossy();
            (!value.trim().is_empty()).then(|| value.chars().take(128).collect())
        };
        let avatar = (|| -> Option<String> {
            let get_avatar = library
                .get::<unsafe extern "C" fn(Interface, u64) -> i32>(
                    b"SteamAPI_ISteamFriends_GetMediumFriendAvatar\0",
                )
                .ok()?;
            let image = get_avatar(friends, steam_id);
            if image <= 0 {
                return None;
            }
            let get_utils = library
                .get::<unsafe extern "C" fn(Interface, i32, *const c_char) -> Interface>(
                    b"SteamAPI_ISteamClient_GetISteamUtils\0",
                )
                .ok()?;
            let utils = get_utils(client, pipe, c"SteamUtils010".as_ptr());
            if utils.is_null() {
                return None;
            }
            let size = library
                .get::<unsafe extern "C" fn(Interface, i32, *mut u32, *mut u32) -> bool>(
                    b"SteamAPI_ISteamUtils_GetImageSize\0",
                )
                .ok()?;
            let pixels = library
                .get::<unsafe extern "C" fn(Interface, i32, *mut u8, i32) -> bool>(
                    b"SteamAPI_ISteamUtils_GetImageRGBA\0",
                )
                .ok()?;
            let (mut width, mut height) = (0, 0);
            if !size(utils, image, &mut width, &mut height)
                || width == 0
                || height == 0
                || width > 184
                || height > 184
            {
                return None;
            }
            let mut rgba = vec![0; width as usize * height as usize * 4];
            if !pixels(utils, image, rgba.as_mut_ptr(), rgba.len() as i32) {
                return None;
            }
            avatar_png(width, height, &rgba)
        })();
        Some((name, avatar))
    };
    read().unwrap_or_default()
}
impl Drop for Shutdown {
    fn drop(&mut self) {
        // SAFETY: constructed only after successful initialization; DLL outlives guard.
        unsafe { (self.0)() }
    }
}

fn refuse_game(system: &mut System) -> Result<()> {
    system.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    if system.processes().values().any(|p| {
        matches!(
            p.name().to_string_lossy().to_ascii_lowercase().as_str(),
            "tf_win64.exe" | "tf_linux64"
        )
    }) {
        return Err("Close TF2 before connecting the inventory probe".into());
    }
    Ok(())
}

pub fn read_inventory(path: &std::path::Path) -> Result<protocol::Snapshot> {
    if !cfg!(target_arch = "x86_64") {
        return Err("Inventory access currently requires x64".into());
    }
    let expected = if cfg!(windows) {
        "steam_api64.dll"
    } else {
        "libsteam_api.so"
    };
    if !path.is_absolute()
        || !path.is_file()
        || path.file_name().and_then(|s| s.to_str()) != Some(expected)
    {
        return Err("Provide the absolute path to the installed TF2 Steam API library".into());
    }
    let mut system = System::new();
    refuse_game(&mut system)?;
    // This executable is single-threaded here. App identity is process-local;
    // no steam_appid.txt or Steam settings files are created.
    std::env::set_var("SteamAppId", "440");
    std::env::set_var("SteamGameId", "440");
    // SAFETY: the operator supplies the installed Valve library, not downloaded code.
    // Symbol signatures follow the Steamworks headers. All pointers are checked
    // before dereference; every interface and function remains within DLL lifetime.
    unsafe { connect(path, &mut system) }
}

unsafe fn connect(path: &std::path::Path, system: &mut System) -> Result<protocol::Snapshot> {
    let library = Library::new(path)?;
    let init = library.get::<unsafe extern "C" fn() -> bool>(b"SteamAPI_Init\0")?;
    let shutdown = *library.get::<unsafe extern "C" fn()>(b"SteamAPI_Shutdown\0")?;
    if !init() {
        return Err(
            "Steam initialization failed. Start Steam and sign in under the same OS user".into(),
        );
    }
    let _shutdown = Shutdown(shutdown);
    let create = library.get::<unsafe extern "C" fn(*const c_char) -> Interface>(
        b"SteamInternal_CreateInterface\0",
    )?;
    let client = create(c"SteamClient020".as_ptr());
    if client.is_null() {
        return Err("SteamClient020 is unavailable".into());
    }
    let user_handle = library.get::<unsafe extern "C" fn() -> i32>(b"SteamAPI_GetHSteamUser\0")?();
    let pipe = library.get::<unsafe extern "C" fn() -> i32>(b"SteamAPI_GetHSteamPipe\0")?();
    if user_handle == 0 || pipe == 0 {
        return Err("Steam has no connected user".into());
    }
    type GetInterface = unsafe extern "C" fn(Interface, i32, i32, *const c_char) -> Interface;
    let get_user = library.get::<GetInterface>(b"SteamAPI_ISteamClient_GetISteamUser\0")?;
    let mut user = std::ptr::null_mut();
    for version in [c"SteamUser023", c"SteamUser022", c"SteamUser021"] {
        user = get_user(client, user_handle, pipe, version.as_ptr());
        if !user.is_null() {
            break;
        }
    }
    if user.is_null() {
        return Err("No supported Steam user interface".into());
    }
    let logged_on = library
        .get::<unsafe extern "C" fn(Interface) -> bool>(b"SteamAPI_ISteamUser_BLoggedOn\0")?;
    let identity = library
        .get::<unsafe extern "C" fn(Interface) -> u64>(b"SteamAPI_ISteamUser_GetSteamID\0")?;
    if !logged_on(user) {
        return Err("Sign into the Steam client first".into());
    }
    let steam_id = identity(user);
    if steam_id == 0 {
        return Err("Steam returned an empty account identity".into());
    }
    eprintln!("Connected to the existing Steam session.");
    let get_gc =
        library.get::<GetInterface>(b"SteamAPI_ISteamClient_GetISteamGenericInterface\0")?;
    let gc = get_gc(
        client,
        user_handle,
        pipe,
        c"SteamGameCoordinator001".as_ptr(),
    );
    if gc.is_null() {
        return Err("TF2 Game Coordinator interface unavailable".into());
    }
    let vtable = *(gc as *const *const Coordinator);
    if vtable.is_null() {
        return Err("Empty coordinator interface".into());
    }
    let gc_api = &*vtable;
    let callbacks = library.get::<unsafe extern "C" fn()>(b"SteamAPI_RunCallbacks\0")?;
    let started = Instant::now();
    let mut last_hello = None;
    let mut welcomed = false;
    let mut snapshot = None;
    let mut account_presentation = (None, None);
    while started.elapsed() < Duration::from_secs(30) {
        refuse_game(system)?;
        callbacks();
        if account_presentation.1.is_none() {
            account_presentation = persona(&library, client, user_handle, pipe, steam_id);
        }
        if !logged_on(user) || identity(user) != steam_id {
            return Err("Steam disconnected or changed account; discarded the snapshot".into());
        }
        if !welcomed && last_hello.is_none_or(|at: Instant| at.elapsed() >= Duration::from_secs(5))
        {
            // Empty CMsgClientHello inside the standard eight-byte protobuf envelope.
            // No inventory-changing message is implemented by this executable.
            let kind = protocol::PROTOBUF | 4006;
            let mut hello = kind.to_le_bytes().to_vec();
            hello.extend(0u32.to_le_bytes());
            let result = (gc_api.send)(gc, kind, hello.as_ptr().cast(), hello.len() as u32);
            if result != 0 {
                return Err(format!("Coordinator hello failed ({result})").into());
            }
            last_hello = Some(Instant::now());
        }
        // Bounded drain prevents a noisy queue from defeating the deadline/guards.
        for _ in 0..64 {
            let mut size = 0;
            if !(gc_api.available)(gc, &mut size) {
                break;
            }
            if size as usize > protocol::MAX_MESSAGE {
                return Err("Coordinator message exceeds 8 MiB".into());
            }
            let mut bytes = vec![0; size as usize];
            let (mut kind, mut received) = (0, 0);
            let result = (gc_api.retrieve)(
                gc,
                &mut kind,
                bytes.as_mut_ptr().cast(),
                size,
                &mut received,
            );
            if result != 0 || received > size {
                return Err(format!("Coordinator receive failed ({result})").into());
            }
            bytes.truncate(received as usize);
            eprintln!(
                "GC message {} ({} bytes)",
                kind & !protocol::PROTOBUF,
                received
            );
            match kind & !protocol::PROTOBUF {
                27 => {
                    let request = protocol::refresh(protocol::payload(kind, &bytes)?, steam_id)?;
                    let result = (gc_api.send)(
                        gc,
                        protocol::PROTOBUF | 28,
                        request.as_ptr().cast(),
                        request.len() as u32,
                    );
                    if result != 0 {
                        return Err(format!("Cache refresh request failed ({result})").into());
                    }
                }
                4004 => {
                    protocol::payload(kind, &bytes)?;
                    welcomed = true;
                }
                24 => {
                    snapshot = Some(protocol::snapshot(
                        protocol::payload(kind, &bytes)?,
                        steam_id,
                    )?);
                }
                4008 => return Err("Coordinator ended the session".into()),
                _ => {}
            }
        }
        if welcomed {
            if let Some(mut snapshot) = snapshot {
                if !logged_on(user) || identity(user) != steam_id {
                    return Err("Account changed before completion".into());
                }
                snapshot.persona_name = account_presentation.0;
                snapshot.avatar = account_presentation.1;
                return Ok(snapshot);
            }
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err(format!("Timed out waiting for a complete backpack (coordinator welcome: {welcomed}); no empty inventory was inferred").into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn avatar_is_bounded_and_encoded_as_png() {
        assert!(avatar_png(185, 1, &[0; 740]).is_none());
        assert!(avatar_png(1, 1, &[0; 3]).is_none());
        let url = avatar_png(1, 1, &[12, 34, 56, 255]).unwrap();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(url.strip_prefix("data:image/png;base64,").unwrap())
            .unwrap();
        let mut decoder = png::Decoder::new(bytes.as_slice()).read_info().unwrap();
        let mut decoded = vec![0; decoder.output_buffer_size()];
        decoder.next_frame(&mut decoded).unwrap();
        assert_eq!(decoded, [12, 34, 56, 255]);
    }
}
