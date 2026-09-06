//! CI-only installer probe. Uses the production updater plugin and public key
//! against a loopback feed; it is never linked into the desktop executable.
use std::{path::PathBuf, time::Duration};
use tauri_plugin_updater::UpdaterExt;

fn main() {
    assert_eq!(std::env::var("CI").as_deref(), Ok("true"));
    let args: Vec<String> = std::env::args().skip(1).collect();
    assert_eq!(
        args.len(),
        4,
        "feed, old executable, marker, expected version"
    );
    assert!(args[0].starts_with("http://127.0.0.1:"));
    let runner = std::fs::canonicalize(std::env::var("RUNNER_TEMP").unwrap()).unwrap();
    let executable = std::fs::canonicalize(&args[1]).unwrap();
    assert!(executable.starts_with(&runner));
    let marker = PathBuf::from(&args[2]);
    assert!(std::fs::canonicalize(marker.parent().unwrap())
        .unwrap()
        .starts_with(&runner));
    let mut context = tauri::generate_context!();
    context.package_info_mut().version = "0.1.1".parse().unwrap();
    context.config_mut().app.windows.clear();
    let updater = context.config_mut().plugins.0.get_mut("updater").unwrap();
    updater["dangerousInsecureTransportProtocol"] = serde_json::json!(true);
    updater["windows"]["installMode"] = serde_json::json!("quiet");
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            let app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let result: Result<(), Box<dyn std::error::Error + Send + Sync>> = async {
                    let updater = app
                        .updater_builder()
                        .executable_path(&executable)
                        .timeout(Duration::from_secs(120))
                        .endpoints(vec![args[0].parse()?])?
                        .build()?;
                    let update = updater
                        .check()
                        .await?
                        .ok_or("No update offered from 0.1.1")?;
                    assert_eq!(update.version, args[3]);
                    let bytes = update.download(|_, _| {}, || {}).await?;
                    std::fs::write(
                        &marker,
                        format!("downloaded and signature-verified {}\n", update.version),
                    )?;
                    update.install(bytes)?;
                    Ok(())
                }
                .await;
                if let Err(error) = result {
                    eprintln!("Updater probe failed: {error}");
                    app.exit(1);
                } else {
                    app.exit(0);
                }
            });
            Ok(())
        })
        .run(context)
        .expect("updater probe runtime");
}
