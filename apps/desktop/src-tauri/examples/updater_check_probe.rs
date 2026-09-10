//! Read-only release probe of the production updater's default version comparison.
//! It uses a loopback feed and never downloads or installs an artifact.
use std::time::Duration;
use tauri_plugin_updater::UpdaterExt;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    assert_eq!(
        args.len(),
        3,
        "loopback feed, installed version, expected version or none"
    );
    let endpoint: reqwest::Url = args[0].parse().expect("valid feed URL");
    assert_eq!(endpoint.scheme(), "http");
    assert_eq!(endpoint.host_str(), Some("127.0.0.1"));
    let mut context = tauri::generate_context!();
    context.package_info_mut().version = args[1].parse().expect("valid installed version");
    context.config_mut().app.windows.clear();
    context.config_mut().plugins.0.get_mut("updater").unwrap()
        ["dangerousInsecureTransportProtocol"] = serde_json::json!(true);
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            let app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let result: Result<(), Box<dyn std::error::Error + Send + Sync>> = async {
                    let update = app
                        .updater_builder()
                        .timeout(Duration::from_secs(15))
                        .endpoints(vec![endpoint])?
                        .build()?
                        .check()
                        .await?;
                    let actual = update
                        .as_ref()
                        .map_or("none", |update| update.version.as_str());
                    if actual != args[2] {
                        return Err(format!(
                            "Installed {}: expected {}, got {actual}",
                            args[1], args[2]
                        )
                        .into());
                    }
                    println!("PASS: installed {}, offered {actual}", args[1]);
                    Ok(())
                }
                .await;
                if let Err(error) = result {
                    eprintln!("Updater check failed: {error}");
                    app.exit(1);
                } else {
                    app.exit(0);
                }
            });
            Ok(())
        })
        .run(context)
        .expect("updater check runtime");
}
