use super::models::{CommunityNodeCandidate, CommunityScanState, CommunitySettings};
use crate::paths;
use std::{fs, path::PathBuf};
use tauri::AppHandle;

// Schema 3 adds continuous external-TUN contamination protection and a unified
// exit-country provider chain. Older saved results cannot prove they were
// collected under those guarantees, so do not present them as verified nodes.
const SCHEMA_VERSION: u32 = 3;

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredNodes {
    schema_version: u32,
    nodes: Vec<CommunityNodeCandidate>,
}

fn directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = PathBuf::from(paths::ensure(app)?.data_dir).join("community-nodes");
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建公共节点数据目录：{error}"))?;
    Ok(directory)
}

pub fn runtime_directory(app: &AppHandle, job_id: &str) -> Result<PathBuf, String> {
    let directory = directory(app)?.join("runtime").join(job_id);
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建公共节点测试目录：{error}"))?;
    Ok(directory)
}

pub fn remove_runtime_directory(app: &AppHandle, job_id: &str) -> Result<(), String> {
    let runtime = directory(app)?.join("runtime").join(job_id);
    if runtime.is_dir() {
        fs::remove_dir_all(&runtime)
            .map_err(|error| format!("清理公共节点测速临时目录失败：{error}"))?;
    }
    Ok(())
}

fn atomic_write(path: &PathBuf, bytes: &[u8]) -> Result<(), String> {
    let temporary = path.with_extension("tmp");
    let backup = path.with_extension("bak");
    fs::write(&temporary, bytes).map_err(|error| format!("公共节点临时文件写入失败：{error}"))?;
    if path.exists() {
        if backup.exists() {
            fs::remove_file(&backup).map_err(|error| format!("公共节点旧备份清理失败：{error}"))?;
        }
        fs::rename(path, &backup).map_err(|error| format!("公共节点旧文件备份失败：{error}"))?;
    }
    if let Err(error) = fs::rename(&temporary, path) {
        if backup.exists() {
            let _ = fs::rename(&backup, path);
        }
        return Err(format!("公共节点文件提交失败：{error}"));
    }
    if backup.exists() {
        let _ = fs::remove_file(backup);
    }
    Ok(())
}

pub fn save_nodes(app: &AppHandle, nodes: &[CommunityNodeCandidate]) -> Result<(), String> {
    let payload = StoredNodes {
        schema_version: SCHEMA_VERSION,
        nodes: nodes.to_vec(),
    };
    let bytes = serde_json::to_vec_pretty(&payload)
        .map_err(|error| format!("公共节点序列化失败：{error}"))?;
    atomic_write(&directory(app)?.join("nodes.json"), &bytes)
}

pub fn load_nodes(app: &AppHandle) -> Vec<CommunityNodeCandidate> {
    let Ok(path) = directory(app).map(|directory| directory.join("nodes.json")) else {
        return Vec::new();
    };
    let Ok(bytes) = fs::read(path) else {
        return Vec::new();
    };
    let mut nodes = serde_json::from_slice::<StoredNodes>(&bytes)
        .ok()
        .filter(|value| value.schema_version == SCHEMA_VERSION)
        .map(|value| value.nodes)
        .unwrap_or_default();
    let mut unverified = 0usize;
    for node in &mut nodes {
        if !node.exit_verified {
            node.country_code = None;
            node.country_name = None;
            node.exit_ip = None;
            unverified += 1;
            node.display_name = format!("未知地区 {unverified:02}");
        }
    }
    nodes
}

pub fn save_scan_state(app: &AppHandle, state: &CommunityScanState) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(state)
        .map_err(|error| format!("公共节点任务状态序列化失败：{error}"))?;
    atomic_write(&directory(app)?.join("scan-job.json"), &bytes)
}

pub fn load_scan_state(app: &AppHandle) -> Option<CommunityScanState> {
    let path = directory(app).ok()?.join("scan-job.json");
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
}

pub fn write_connection_config(
    app: &AppHandle,
    node: &CommunityNodeCandidate,
    mixed_port: u16,
    controller_port: u16,
) -> Result<PathBuf, String> {
    let connection_dir = directory(app)?.join("connections");
    fs::create_dir_all(&connection_dir)
        .map_err(|error| format!("无法创建公共节点连接目录：{error}"))?;
    let mut proxy = node.config.clone();
    let object = proxy
        .as_object_mut()
        .ok_or_else(|| "公共节点配置格式无效".to_string())?;
    object.insert(
        "name".into(),
        serde_json::Value::String("KINGO_COMMUNITY".into()),
    );
    let config = serde_json::json!({
        "mixed-port": mixed_port,
        "external-controller": format!("127.0.0.1:{controller_port}"),
        "secret": "KiNGO",
        "allow-lan": false,
        "mode": "rule",
        "log-level": "info",
        "ipv6": true,
        "proxies": [proxy],
        "proxy-groups": [{
            "name": "PROXY",
            "type": "select",
            "proxies": ["KINGO_COMMUNITY"]
        }],
        "rules": ["MATCH,PROXY"]
    });
    let bytes = serde_yaml::to_string(&config)
        .map_err(|error| format!("生成公共节点连接配置失败：{error}"))?;
    let path = connection_dir.join(format!("{}.yaml", node.id));
    atomic_write(&path, bytes.as_bytes())?;
    Ok(path)
}

pub fn clear_nodes(app: &AppHandle) -> Result<(), String> {
    let path = directory(app)?.join("nodes.json");
    if path.exists() {
        fs::remove_file(path).map_err(|error| format!("清空公共节点失败：{error}"))?;
    }
    let checkpoint = directory(app)?.join("checkpoint.json");
    if checkpoint.exists() {
        fs::remove_file(checkpoint)
            .map_err(|error| format!("清理旧版公共节点检查点失败：{error}"))?;
    }
    Ok(())
}

pub fn load_settings(app: &AppHandle) -> CommunitySettings {
    let Ok(path) = directory(app).map(|directory| directory.join("settings.json")) else {
        return CommunitySettings::default();
    };
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub fn save_settings(
    app: &AppHandle,
    mut settings: CommunitySettings,
) -> Result<CommunitySettings, String> {
    settings.retain_count = settings.retain_count.clamp(10, 200);
    settings.speed_concurrency = settings.speed_concurrency.clamp(1, 8);
    settings.speed_timeout_seconds = settings.speed_timeout_seconds.clamp(3, 30);
    settings.sort_mode = "speed".into();
    let bytes = serde_json::to_vec_pretty(&settings)
        .map_err(|error| format!("公共节点设置序列化失败：{error}"))?;
    atomic_write(&directory(app)?.join("settings.json"), &bytes)?;
    Ok(settings)
}
