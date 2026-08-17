use std::{fs, path::PathBuf};

fn prepare_core_payloads() {
    const CORES: &[&str] = &[
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
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("manifest directory"));
    let source_root = manifest.join("resources").join("cores");
    let payload_root = manifest.join("resources").join("core-payloads");
    fs::create_dir_all(&payload_root).expect("create core payload directory");

    for relative in CORES {
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
