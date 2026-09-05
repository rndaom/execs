/// Tauri's default manifest only requests Common Controls v6. Profile files
/// live under `%AppData%\execs\profiles\<uuid>\files\tf\custom\...`, so a
/// large HUD tree crosses the 260-character `MAX_PATH` limit on its own;
/// `longPathAware` lets the process open those paths on Windows 10 1607+
/// when the system policy allows long paths.
const WINDOWS_MANIFEST: &str = r#"<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity
        type="win32"
        name="Microsoft.Windows.Common-Controls"
        version="6.0.0.0"
        processorArchitecture="*"
        publicKeyToken="6595b64144ccf1df"
        language="*"
      />
    </dependentAssembly>
  </dependency>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <longPathAware xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">true</longPathAware>
    </windowsSettings>
  </application>
</assembly>
"#;

fn main() {
    let windows = tauri_build::WindowsAttributes::new().app_manifest(WINDOWS_MANIFEST);
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("failed to run tauri-build");
    // tauri-winres links resources to binaries, not Cargo examples. The updater
    // probe also needs Common Controls v6 for TaskDialogIndirect at process load.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
        && std::env::var_os("CARGO_FEATURE_RELEASE_PROBES").is_some()
    {
        let manifest = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap())
            .join("updater-probe.manifest");
        std::fs::write(&manifest, WINDOWS_MANIFEST).expect("write updater probe manifest");
        println!("cargo:rustc-link-arg-examples=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg-examples=/MANIFESTINPUT:{}",
            manifest.display()
        );
    }
}
