//! Steam transport used only inside a dedicated development helper process.
use crate::protocol;

use libloading::Library;
use std::{
    ffi::{c_char, c_void},
    time::{Duration, Instant},
};
use sysinfo::{ProcessesToUpdate, System};

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
impl Drop for Shutdown {
    fn drop(&mut self) {
        // SAFETY: constructed only after successful initialization; DLL outlives guard.
        unsafe { (self.0)() }
    }
}

fn refuse_game(system: &mut System) -> Result<()> {
    system.refresh_processes(ProcessesToUpdate::All, true);
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
    while started.elapsed() < Duration::from_secs(30) {
        refuse_game(system)?;
        callbacks();
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
            if let Some(snapshot) = snapshot {
                if !logged_on(user) || identity(user) != steam_id {
                    return Err("Account changed before completion".into());
                }
                return Ok(snapshot);
            }
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err(format!("Timed out waiting for a complete backpack (coordinator welcome: {welcomed}); no empty inventory was inferred").into())
}
