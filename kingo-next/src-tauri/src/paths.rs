use serde::Serialize;
use std::fs;
use std::path::PathBuf;
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
