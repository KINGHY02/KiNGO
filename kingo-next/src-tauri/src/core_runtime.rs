use crate::{cores, process_utils::hidden_command};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read},
    path::PathBuf,
    process::{Child, Stdio},
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreProcessStatus {
    pub core_id: String,
    pub running: bool,
    pub pid: Option<u32>,
    pub executable_path: Option<String>,
    pub config_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone)]
pub struct CoreRuntime {
    children: Arc<Mutex<HashMap<String, Child>>>,
    executables: Arc<Mutex<HashMap<String, PathBuf>>>,
    temporary_configs: Arc<Mutex<HashMap<String, PathBuf>>>,
}

impl Default for CoreRuntime {
    fn default() -> Self {
        Self {
            children: Arc::new(Mutex::new(HashMap::new())),
            executables: Arc::new(Mutex::new(HashMap::new())),
            temporary_configs: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

fn forward_core_output<R: Read + Send + 'static>(
    app: AppHandle,
    core_id: String,
    reader: R,
    level: &'static str,
) {
    std::thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            let message = line.trim();
            if message.is_empty() {
                continue;
            }
            let normalized = message.to_ascii_lowercase();
            let detected_level = if normalized.contains("error") || normalized.contains("fatal") {
                "error"
            } else if normalized.contains("warn") {
                "warning"
            } else {
                level
            };
            let _ = app.emit(
                "connection-log",
                serde_json::json!({
                    "level": detected_level,
                    "message": format!("[{core_id}] {message}"),
                }),
            );
        }
    });
}

fn resolve_executable(
    app: &AppHandle,
    core_id: &str,
) -> Result<(cores::CoreProfile, PathBuf), String> {
    let status = cores::statuses(app)?
        .into_iter()
        .find(|item| item.profile.id == core_id)
        .ok_or_else(|| "核心不存在".to_string())?;
    let executable = status
        .executable_path
        .ok_or_else(|| format!("{} 核心文件不存在", status.profile.name))?;
    Ok((status.profile, PathBuf::from(executable)))
}

fn configure_xray_assets(app: &AppHandle, command: &mut std::process::Command) {
    if let Ok(asset) = crate::paths::resource_file(app, "cores/xray/geoip.dat") {
        if let Some(directory) = asset.parent() {
            command.env("XRAY_LOCATION_ASSET", directory);
        }
    }
}

pub fn spawn_transient(app: &AppHandle, core_id: &str, config_path: &str) -> Result<Child, String> {
    let (profile, executable) = resolve_executable(app, core_id)?;
    let config = PathBuf::from(config_path);
    if !config.is_file() {
        return Err("核心配置文件不存在".into());
    }
    let mut command = hidden_command(&executable);
    if let Some(directory) = executable.parent() {
        command.current_dir(directory);
    }
    match profile.family.as_str() {
        "mihomo" => {
            let directory = config
                .parent()
                .ok_or_else(|| "核心配置目录无效".to_string())?;
            command.args([
                "-d",
                directory.to_string_lossy().as_ref(),
                "-f",
                config_path,
            ]);
        }
        "hysteria2" => {
            command.args(["client", "-c", config_path]);
        }
        "hysteria" | "shadowquic" => {
            command.args(["-c", config_path]);
        }
        "naiveproxy" => {
            command.arg(config_path);
        }
        "mieru" => {
            command
                .env("MIERU_CONFIG_JSON_FILE", config_path)
                .arg("run");
        }
        _ => {
            command.args(["run", "-c", config_path]);
        }
    }
    if profile.family == "xray" {
        configure_xray_assets(app, &mut command);
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("核心启动失败：{error}"))
}

pub fn validate_mihomo_config(app: &AppHandle, config_path: &str) -> Result<(), String> {
    let core_id = crate::clash_controller::active_core(app).unwrap_or_else(|_| "mihomo".into());
    let (_, executable) = resolve_executable(app, &core_id)?;
    let config = PathBuf::from(config_path);
    if !config.is_file() {
        return Err("Clash 运行配置不存在".into());
    }
    let directory = config.parent().ok_or("Clash 运行配置目录无效")?;
    let output = hidden_command(executable)
        .args([
            "-t",
            "-d",
            directory.to_string_lossy().as_ref(),
            "-f",
            config_path,
        ])
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("mihomo 配置检查启动失败：{error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Err(format!(
        "mihomo 配置检查失败：{}",
        if stderr.is_empty() { stdout } else { stderr }
    ))
}

pub fn start(
    app: &AppHandle,
    runtime: &CoreRuntime,
    core_id: String,
    config_path: String,
) -> Result<CoreProcessStatus, String> {
    let (profile, executable) = resolve_executable(app, &core_id)?;
    let config = PathBuf::from(&config_path);
    if !config.is_file() {
        return Err("核心配置文件不存在".into());
    }
    stop(runtime, &core_id)?;

    let mut command = hidden_command(&executable);
    if let Some(directory) = executable.parent() {
        command.current_dir(directory);
    }
    match profile.family.as_str() {
        "mihomo" => {
            let directory = config
                .parent()
                .ok_or_else(|| "核心配置目录无效".to_string())?;
            command.args([
                "-d",
                directory.to_string_lossy().as_ref(),
                "-f",
                &config_path,
            ]);
        }
        "hysteria2" => {
            command.args(["client", "-c", &config_path]);
        }
        "hysteria" | "shadowquic" => {
            command.args(["-c", &config_path]);
        }
        "naiveproxy" => {
            command.arg(&config_path);
        }
        "mieru" => {
            command
                .env("MIERU_CONFIG_JSON_FILE", &config_path)
                .arg("run");
        }
        _ => {
            command.args(["run", "-c", &config_path]);
        }
    }
    if profile.family == "xray" {
        configure_xray_assets(app, &mut command);
    }
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("核心启动失败：{error}"))?;
    let pid = child.id();
    if let Some(stdout) = child.stdout.take() {
        forward_core_output(app.clone(), core_id.clone(), stdout, "info");
    }
    if let Some(stderr) = child.stderr.take() {
        forward_core_output(app.clone(), core_id.clone(), stderr, "warning");
    }
    runtime
        .children
        .lock()
        .map_err(|_| "核心进程状态不可用")?
        .insert(core_id.clone(), child);
    runtime
        .executables
        .lock()
        .map_err(|_| "核心路径状态不可用")?
        .insert(core_id.clone(), executable.clone());
    Ok(CoreProcessStatus {
        core_id,
        running: true,
        pid: Some(pid),
        executable_path: Some(executable.to_string_lossy().into_owned()),
        config_path: Some(config_path),
        error: None,
    })
}

pub fn stop(runtime: &CoreRuntime, core_id: &str) -> Result<(), String> {
    let child = runtime
        .children
        .lock()
        .map_err(|_| "核心进程状态不可用")?
        .remove(core_id);
    if let Some(mut child) = child {
        let _ = child.kill();
        let _ = child.wait();
    }
    let executable = runtime
        .executables
        .lock()
        .map_err(|_| "核心路径状态不可用")?
        .remove(core_id);
    if core_id == "mieru" {
        if let Some(executable) = executable {
            let _ = hidden_command(executable)
                .arg("stop")
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
    }
    if let Ok(mut configs) = runtime.temporary_configs.lock() {
        if let Some(path) = configs.remove(core_id) {
            let _ = std::fs::remove_file(path);
        }
    }
    Ok(())
}

pub fn register_temporary_config(
    runtime: &CoreRuntime,
    core_id: &str,
    config_path: impl Into<PathBuf>,
) -> Result<(), String> {
    runtime
        .temporary_configs
        .lock()
        .map_err(|_| "temporary core configuration state unavailable".to_string())?
        .insert(core_id.to_string(), config_path.into());
    Ok(())
}

/// Moves a verified process from an isolated runtime into the active runtime.
/// The caller must stop any old active process before adopting the replacement.
pub fn adopt(target: &CoreRuntime, source: &CoreRuntime, core_id: &str) -> Result<(), String> {
    if target
        .children
        .lock()
        .map_err(|_| "active core process state unavailable".to_string())?
        .contains_key(core_id)
    {
        return Err("active runtime already contains this core".into());
    }
    let child = source
        .children
        .lock()
        .map_err(|_| "candidate core process state unavailable".to_string())?
        .remove(core_id)
        .ok_or_else(|| "candidate core process is no longer running".to_string())?;
    let executable = source
        .executables
        .lock()
        .map_err(|_| "candidate core path state unavailable".to_string())?
        .remove(core_id);
    let temporary_config = source
        .temporary_configs
        .lock()
        .map_err(|_| "candidate core configuration state unavailable".to_string())?
        .remove(core_id);

    target
        .children
        .lock()
        .map_err(|_| "active core process state unavailable".to_string())?
        .insert(core_id.to_string(), child);
    if let Some(executable) = executable {
        target
            .executables
            .lock()
            .map_err(|_| "active core path state unavailable".to_string())?
            .insert(core_id.to_string(), executable);
    }
    if let Some(config) = temporary_config {
        target
            .temporary_configs
            .lock()
            .map_err(|_| "active core configuration state unavailable".to_string())?
            .insert(core_id.to_string(), config);
    }
    Ok(())
}

pub fn stop_all(runtime: &CoreRuntime) -> Result<(), String> {
    let ids: Vec<String> = runtime
        .children
        .lock()
        .map_err(|_| "核心进程状态不可用")?
        .keys()
        .cloned()
        .collect();
    for id in ids {
        stop(runtime, &id)?;
    }
    Ok(())
}

pub fn statuses(runtime: &CoreRuntime) -> Result<Vec<CoreProcessStatus>, String> {
    let mut children = runtime.children.lock().map_err(|_| "核心进程状态不可用")?;
    let mut output = Vec::with_capacity(children.len());
    let ids: Vec<String> = children.keys().cloned().collect();
    for core_id in ids {
        let child = children.get_mut(&core_id).expect("core child exists");
        let exited = child
            .try_wait()
            .map_err(|error| format!("读取核心进程状态失败：{error}"))?
            .is_some();
        if exited {
            children.remove(&core_id);
            let executable = runtime
                .executables
                .lock()
                .ok()
                .and_then(|mut executables| executables.remove(&core_id));
            if core_id == "mieru" {
                if let Some(executable) = executable {
                    let _ = hidden_command(executable)
                        .arg("stop")
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .status();
                }
            }
            if let Ok(mut configs) = runtime.temporary_configs.lock() {
                if let Some(path) = configs.remove(&core_id) {
                    let _ = std::fs::remove_file(path);
                }
            }
            output.push(CoreProcessStatus {
                core_id,
                running: false,
                pid: None,
                executable_path: None,
                config_path: None,
                error: Some("核心进程已退出".into()),
            });
        } else {
            output.push(CoreProcessStatus {
                core_id,
                running: true,
                pid: Some(child.id()),
                executable_path: None,
                config_path: None,
                error: None,
            });
        }
    }
    Ok(output)
}
