use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub fn resource_file(
    app: &AppHandle,
    relative: impl AsRef<std::path::Path>,
) -> Result<PathBuf, String> {
    let relative = relative.as_ref();
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let mut candidates = vec![
        resource_dir.join(relative),
        resource_dir.join("resources").join(relative),
    ];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("resources").join(relative));
        }
    }
    #[cfg(debug_assertions)]
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(relative),
    );
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| format!("resource is missing: {}", relative.display()))
}

fn file_sha256(path: &Path) -> Result<[u8; 32], String> {
    let mut file = fs::File::open(path)
        .map_err(|error| format!("无法读取核心文件 {}：{error}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 1024 * 128];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| format!("无法校验核心文件 {}：{error}", path.display()))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(hasher.finalize().into())
}

/// Materializes an immutable, bundled core payload into the per-user data
/// directory. Installers never overwrite a running executable: every app
/// version receives its own runtime directory and payload integrity is checked
/// before the path is returned to a process launcher.
pub fn bundled_core_file(
    app: &AppHandle,
    core_id: &str,
    executable: &str,
) -> Result<PathBuf, String> {
    let payload = resource_file(
        app,
        PathBuf::from("core-payloads")
            .join(core_id)
            .join(format!("{executable}.payload")),
    )?;
    let payload_hash = file_sha256(&payload)?;
    let runtime = ensure(app)?;
    let target = PathBuf::from(runtime.cores_dir)
        .join("bundled")
        .join(env!("CARGO_PKG_VERSION"))
        .join(core_id)
        .join(executable);

    materialize_core_payload(&payload, &target, payload_hash)?;
    Ok(target)
}

fn materialize_core_payload(
    payload: &Path,
    target: &Path,
    payload_hash: [u8; 32],
) -> Result<(), String> {
    if target.is_file() && file_sha256(&target)? == payload_hash {
        return Ok(());
    }
    let parent = target.parent().ok_or("核心运行目录无效")?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("无法创建核心运行目录 {}：{error}", parent.display()))?;
    let pending = target.with_extension("exe.pending");
    let mut source = fs::File::open(&payload)
        .map_err(|error| format!("无法打开内置核心载荷 {}：{error}", payload.display()))?;
    let mut output = fs::File::create(&pending)
        .map_err(|error| format!("无法释放内置核心 {}：{error}", pending.display()))?;
    std::io::copy(&mut source, &mut output)
        .map_err(|error| format!("无法释放内置核心 {}：{error}", pending.display()))?;
    output
        .flush()
        .map_err(|error| format!("无法写入内置核心 {}：{error}", pending.display()))?;
    drop(output);
    if file_sha256(&pending)? != payload_hash {
        let _ = fs::remove_file(&pending);
        return Err(format!("内置核心释放后校验失败：{}", target.display()));
    }
    if target.is_file() {
        fs::remove_file(&target)
            .map_err(|error| format!("无法替换内置核心 {}：{error}", target.display()))?;
    }
    fs::rename(&pending, &target)
        .map_err(|error| format!("无法安装内置核心 {}：{error}", target.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{file_sha256, materialize_core_payload};
    use std::fs;

    #[test]
    fn core_payload_is_materialized_and_corruption_is_repaired() {
        let root = std::env::temp_dir().join(format!(
            "kingo-core-payload-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let payload = root.join("xray.exe.payload");
        let target = root.join("bundled").join("2.0.6").join("xray.exe");
        fs::write(&payload, b"verified core payload").unwrap();
        let hash = file_sha256(&payload).unwrap();

        materialize_core_payload(&payload, &target, hash).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"verified core payload");

        fs::write(&target, b"corrupt").unwrap();
        materialize_core_payload(&payload, &target, hash).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"verified core payload");
        assert!(!target.with_extension("exe.pending").exists());
        let _ = fs::remove_dir_all(&root);
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePaths {
    pub data_dir: String,
    pub cache_dir: String,
    pub cores_dir: String,
    pub routes_dir: String,
    pub subscriptions_dir: String,
    pub logs_dir: String,
}

fn path_to_string(path: PathBuf) -> String {
    path.to_string_lossy().into_owned()
}

pub fn resolve(app: &AppHandle) -> Result<RuntimePaths, String> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法获取 KiNGO 数据目录：{error}"))?;
    Ok(RuntimePaths {
        data_dir: path_to_string(data.clone()),
        cache_dir: path_to_string(data.join("cache")),
        cores_dir: path_to_string(data.join("cores")),
        routes_dir: path_to_string(data.join("routes")),
        subscriptions_dir: path_to_string(data.join("subscriptions")),
        logs_dir: path_to_string(data.join("logs")),
    })
}

pub fn ensure(app: &AppHandle) -> Result<RuntimePaths, String> {
    let paths = resolve(app)?;
    for directory in [
        &paths.data_dir,
        &paths.cache_dir,
        &paths.cores_dir,
        &paths.routes_dir,
        &paths.subscriptions_dir,
        &paths.logs_dir,
    ] {
        fs::create_dir_all(directory)
            .map_err(|error| format!("无法创建 KiNGO 数据目录：{error}"))?;
    }
    Ok(paths)
}
