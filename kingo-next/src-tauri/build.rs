use std::{fs, path::PathBuf};

fn prepare_core_payloads() {
    const WINDOWS_CORES: &[&str] = &[
        "hy2/hysteria2.exe",
        "hysteria/hysteria-tun-windows-6.0-386.exe",
        "juicity/juicity-client.exe",
        "mieru/mieru.exe",
        "mihomo/mihomo.exe",
        "naiveproxy/naive.exe",
        "shadowquic/shadowquic.exe",
        "sing-box/sing-box.exe",
        "subs-check/subs-check.exe",
        "xray/xray.exe",
    ];
    const MACOS_ARM64_CORES: &[&str] = &[
        "hy2/hysteria2",
        "hysteria/hysteria",
        "juicity/juicity-client",
        "mieru/mieru",
        "mihomo/mihomo",
        "naiveproxy/naive",
        "shadowquic/shadowquic",
        "sing-box/sing-box",
        "subs-check/subs-check",
        "xray/xray",
    ];
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").expect("target operating system");
    let target_arch = std::env::var("CARGO_CFG_TARGET_ARCH").expect("target architecture");
    let cores = match (target_os.as_str(), target_arch.as_str()) {
        ("windows", "x86_64") => WINDOWS_CORES,
        ("macos", "aarch64") => MACOS_ARM64_CORES,
        _ => panic!("unsupported KiNGO bundle target: {target_os}-{target_arch}"),
    };
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("manifest directory"));
    let source_root = manifest.join("resources").join("cores");
    let payload_root = manifest.join("resources").join("core-payloads");
    fs::create_dir_all(&payload_root).expect("create core payload directory");

    for relative in cores {
        let source = source_root.join(relative);
        println!("cargo:rerun-if-changed={}", source.display());
        let target = payload_root.join(format!("{relative}.payload"));
        fs::create_dir_all(target.parent().expect("payload parent"))
            .expect("create payload parent");
        fs::copy(&source, &target).unwrap_or_else(|error| {
            panic!(
                "copy bundled core payload {} to {} failed: {error}",
                source.display(),
                target.display()
            )
        });
    }
}

fn main() {
    prepare_core_payloads();
    tauri_build::build()
}
