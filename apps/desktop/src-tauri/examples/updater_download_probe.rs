//! Loopback-only signed download/timeout probe; never invokes an installer.
fn main() {
    execs_lib::verify_updater_download_recovery();
    println!("PASS: stalled updater download releases its lease; signed retry reaches handoff; tampered bytes fail; stale leases cannot unlock newer operations");
}
