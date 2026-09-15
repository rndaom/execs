//! The real pinned updater, a mock Tauri runtime, and disposable loopback data.
//! No installer or production app initialization is invoked by these tests.
use super::{download_update, UpdateLease};
use crate::{ExclusiveOperation, WriteGate};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri_plugin_updater::UpdaterExt;

const PAYLOAD: &[u8] = include_bytes!("../../test-fixtures/updater/payload.txt");
const SIGNATURE: &str = include_str!("../../test-fixtures/updater/payload.txt.sig");
const PUBLIC_KEY: &str = include_str!("../../test-fixtures/updater/public-key.txt");

struct Server {
    endpoint: String,
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Server {
    fn new() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let endpoint = format!("{origin}/feed");
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = Arc::clone(&stop);
        let payload_requests = Arc::new(AtomicUsize::new(0));
        let thread = std::thread::spawn(move || {
            while !stopped.load(Ordering::Acquire) {
                let (mut socket, _) = match listener.accept() {
                    Ok(socket) => socket,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(5));
                        continue;
                    }
                    Err(error) => panic!("loopback accept: {error}"),
                };
                let origin = origin.clone();
                let payload_requests = Arc::clone(&payload_requests);
                std::thread::spawn(move || {
                    // Windows accepts inherit the listener's nonblocking mode.
                    // This worker waits for a request under the read deadline.
                    socket.set_nonblocking(false).unwrap();
                    socket
                        .set_read_timeout(Some(Duration::from_secs(2)))
                        .unwrap();
                    let mut request = [0u8; 4096];
                    let count = socket.read(&mut request).unwrap();
                    let request = String::from_utf8_lossy(&request[..count]);
                    if request.starts_with("GET /feed ") {
                        let body = serde_json::json!({
                            "version": "99.0.0",
                            "platforms": {"fixture": {
                                "signature": SIGNATURE.trim(),
                                "url": format!("{origin}/payload")
                            }}
                        })
                        .to_string();
                        write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
                    } else if request.starts_with("GET /payload ") {
                        match payload_requests.fetch_add(1, Ordering::SeqCst) {
                            0 => {
                                socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 1000\r\nConnection: close\r\n\r\nx").unwrap();
                                std::thread::sleep(Duration::from_secs(1));
                            }
                            attempt => {
                                let mut body = PAYLOAD.to_vec();
                                if attempt > 1 {
                                    body[0] ^= 1;
                                }
                                write!(socket, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).unwrap();
                                socket.write_all(&body).unwrap();
                            }
                        }
                    } else {
                        panic!("unexpected fixture request: {request}");
                    }
                });
            }
        });
        Self {
            endpoint,
            stop,
            thread: Some(thread),
        }
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        self.thread.take().unwrap().join().unwrap();
    }
}

pub(crate) fn stalled_payload_releases_lease_and_signed_retry_reaches_handoff() {
    let server = Server::new();
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().plugins.0.insert(
        "updater".into(),
        serde_json::json!({
            "pubkey": PUBLIC_KEY.trim(),
            "dangerousInsecureTransportProtocol": true
        }),
    );
    let app = tauri::test::mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)
        .unwrap();
    let gate = WriteGate::new();
    tauri::async_runtime::block_on(async {
        for attempt in 0..3 {
            let result = async {
                let operation =
                    gate.begin_operation_unlocked(ExclusiveOperation::InstallingUpdate)?;
                let mut lease = UpdateLease::new(operation);
                let mut update = app
                    .updater_builder()
                    .timeout(Duration::from_secs(2))
                    .no_proxy()
                    .target("fixture")
                    .endpoints(vec![server.endpoint.parse().unwrap()])
                    .unwrap()
                    .build()
                    .unwrap()
                    .check()
                    .await
                    .unwrap()
                    .expect("metadata check succeeded");
                let bytes = download_update(&mut update, Duration::from_millis(150)).await?;
                assert_eq!(bytes, PAYLOAD);
                assert!(gate.operation_is(ExclusiveOperation::InstallingUpdate));
                // Simulate only the production handoff boundary; never install
                // the fixture. The successful lease stays closed until exit.
                lease.keep_until_exit();
                Ok::<(), crate::error::CommandError>(())
            }
            .await;
            match attempt {
                0 => {
                    let error = result.unwrap_err();
                    assert_eq!(error.code, "UpdateDownloadTimedOut");
                    assert!(error.message.contains("try Install update again"));
                    assert!(!gate.operation_is(ExclusiveOperation::InstallingUpdate));
                }
                1 => {
                    result.unwrap();
                    assert!(gate.operation_is(ExclusiveOperation::InstallingUpdate));
                    gate.current_token(ExclusiveOperation::InstallingUpdate)
                        .unwrap()
                        .finish();
                }
                _ => {
                    assert_eq!(result.unwrap_err().code, "UpdateFailed");
                    assert!(!gate.operation_is(ExclusiveOperation::InstallingUpdate));
                }
            }
        }
    });
}

pub(crate) fn stale_update_lease_cannot_clear_a_new_operation() {
    let gate = WriteGate::new();
    let old = gate
        .begin_operation_unlocked(ExclusiveOperation::InstallingUpdate)
        .unwrap();
    let lease = UpdateLease::new(old.clone());
    old.finish();
    let current = gate
        .begin_operation_unlocked(ExclusiveOperation::InstallingUpdate)
        .unwrap();
    drop(lease);
    assert!(current.is_current());
    current.finish();
}
