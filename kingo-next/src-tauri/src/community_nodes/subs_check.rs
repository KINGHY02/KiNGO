use super::{
    fingerprint,
    models::{CommunityNodeCandidate, CommunityScanState},
    parser, ranking,
    scanner::{self, CommunityNodeStore},
    source_manifest, store,
};
use crate::{paths, process_utils::hidden_command};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Child, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};

pub(crate) const CORE_VERSION: &str = "1.6.2";
#[cfg(windows)]
const CORE_SHA256: &str = "135a731efd4b97dd6f8ae685224cf8d97c8bcbc07b3b8dd70d1342e21542e5a0";
const UPSTREAM_SPEED_TEST_URL: &str = "https://github.com/AaronFeng753/Waifu2x-Extension-GUI/releases/download/v2.21.12/Waifu2x-Extension-GUI-v2.21.12-Portable.7z";

#[derive(Clone, Default)]
pub struct SubsCheckRuntime {
    child: Arc<Mutex<Option<Child>>>,
    running: Arc<AtomicBool>,
    stop_requested: Arc<AtomicBool>,
}

#[derive(Clone, Debug)]
pub(crate) struct CoreInstallation {
    pub path: PathBuf,
    pub version: String,
    pub source: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct UserCoreMetadata {
    version: String,
    sha256: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PipelineStatus {
    total: usize,
    alive_done: usize,
    alive_pass: usize,
    filter_pass: usize,
    speed_done: usize,
    speed_pass: usize,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubsCheckStatus {
    checking: bool,
    pipeline: PipelineStatus,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn job_stamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn emit_state(app: &AppHandle, state: &Arc<Mutex<CommunityScanState>>) {
    if let Ok(snapshot) = state.lock().map(|value| value.clone()) {
        let _ = app.emit("community-scan-progress", snapshot);
    }
}

fn update_state(
    app: &AppHandle,
    state: &Arc<Mutex<CommunityScanState>>,
    update: impl FnOnce(&mut CommunityScanState),
) {
    if let Ok(mut value) = state.lock() {
        update(&mut value);
        value.updated_at = Some(now());
    }
    emit_state(app, state);
}

fn free_local_port() -> Result<u16, String> {
    TcpListener::bind(("127.0.0.1", 0))
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .map_err(|error| format!("无法分配 SubsCheck 本地状态端口：{error}"))
}

fn sha256(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let bytes = fs::read(path).map_err(|error| format!("读取 SubsCheck 核心失败：{error}"))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn bundled_core_path(app: &AppHandle) -> Result<PathBuf, String> {
    let path = paths::bundled_core_file(app, "subs-check", subs_check_executable())?;
    #[cfg(windows)]
    {
        let actual = sha256(&path)?;
        if actual != CORE_SHA256 {
            return Err(format!(
                "SubsCheck 核心校验失败（期望 {CORE_SHA256}，实际 {actual}）"
            ));
        }
    }
    Ok(path)
}

fn subs_check_executable() -> &'static str {
    if cfg!(target_os = "macos") {
        "subs-check"
    } else {
        "subs-check.exe"
    }
}

fn user_core_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let directory = PathBuf::from(paths::ensure(app)?.cores_dir).join("subs-check");
    Ok((
        directory.join(subs_check_executable()),
        directory.join("version.json"),
    ))
}

pub(crate) fn installation(app: &AppHandle) -> Result<CoreInstallation, String> {
    let (user_path, metadata_path) = user_core_paths(app)?;
    if user_path.is_file() {
        let metadata: UserCoreMetadata = serde_json::from_slice(
            &fs::read(&metadata_path)
                .map_err(|error| format!("读取 SubsCheck 更新信息失败：{error}"))?,
        )
        .map_err(|error| format!("解析 SubsCheck 更新信息失败：{error}"))?;
        let actual = sha256(&user_path)?;
        if !actual.eq_ignore_ascii_case(&metadata.sha256) {
            return Err("SubsCheck 用户更新版校验失败，请在设置中恢复内置版本".into());
        }
        return Ok(CoreInstallation {
            path: user_path,
            version: metadata.version.trim_start_matches('v').to_string(),
            source: "user".into(),
        });
    }

    Ok(CoreInstallation {
        path: bundled_core_path(app)?,
        version: CORE_VERSION.into(),
        source: "bundled".into(),
    })
}

pub(crate) fn user_core_target(app: &AppHandle) -> Result<PathBuf, String> {
    user_core_paths(app).map(|paths| paths.0)
}

pub(crate) fn has_user_core(app: &AppHandle) -> bool {
    user_core_paths(app)
        .map(|paths| paths.0.is_file())
        .unwrap_or(false)
}

pub(crate) fn save_user_core_metadata(
    app: &AppHandle,
    version: &str,
    sha256: &str,
) -> Result<(), String> {
    let (_, metadata_path) = user_core_paths(app)?;
    let staged = metadata_path.with_extension("json.new");
    let bytes = serde_json::to_vec_pretty(&UserCoreMetadata {
        version: version.trim_start_matches('v').to_string(),
        sha256: sha256.to_ascii_lowercase(),
    })
    .map_err(|error| error.to_string())?;
    fs::write(&staged, bytes).map_err(|error| error.to_string())?;
    if metadata_path.exists() {
        fs::remove_file(&metadata_path).map_err(|error| error.to_string())?;
    }
    fs::rename(staged, metadata_path).map_err(|error| error.to_string())
}

pub(crate) fn remove_user_core(app: &AppHandle) -> Result<(), String> {
    let (executable, metadata) = user_core_paths(app)?;
    for path in [executable, metadata] {
        if path.exists() {
            fs::remove_file(path).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

pub(crate) fn is_running(runtime: &SubsCheckRuntime) -> bool {
    runtime.running.load(Ordering::SeqCst)
}

#[allow(clippy::too_many_arguments)]
fn write_config(
    path: &Path,
    output: &Path,
    port: u16,
    api_key: &str,
    sources: &[String],
    speed_concurrency: usize,
    timeout_seconds: u64,
    latency_url: &str,
    download_url: &str,
) -> Result<(), String> {
    let value = serde_json::json!({
        "print-progress": false,
        "concurrent": 48,
        "speed-concurrent": speed_concurrency.clamp(1, 8),
        "media-concurrent": 1,
        "shuffle-test-order": true,
        "check-interval": 10080,
        "success-limit": 0,
        "timeout": timeout_seconds.clamp(2, 30) * 1000,
        "alive-test-url": latency_url,
        "speed-test-url": download_url,
        "min-speed": 0,
        "download-timeout": timeout_seconds.clamp(3, 30),
        "download-mb": 4,
        "total-speed-limit": 0,
        "listen-port": format!("127.0.0.1:{port}"),
        "rename-node": true,
        "node-prefix": "",
        "media-check": false,
        "keep-days": 0,
        "output-dir": output.to_string_lossy(),
        "enable-web-ui": true,
        "api-key": api_key,
        "sub-store-port": "",
        "save-method": "local",
        "sub-urls-retry": 2,
        "sub-urls-timeout": 10,
        "sub-urls-concurrent": 12,
        "sub-urls-get-ua": "clash.meta (https://github.com/beck-8/subs-check)",
        "sub-urls-remote": [],
        "sub-urls": sources,
        "ipv6": true,
        "proxy": "",
        "callback-script": "",
        "recipient-url": [],
        "platforms": [],
        "filter": [],
        "node-type": [],
        "dns": { "enable": false }
    });
    let yaml = serde_yaml::to_string(&value)
        .map_err(|error| format!("生成 SubsCheck 配置失败：{error}"))?;
    fs::write(path, yaml).map_err(|error| format!("写入 SubsCheck 配置失败：{error}"))
}

fn status(client: &reqwest::blocking::Client, port: u16, key: &str) -> Option<SubsCheckStatus> {
    client
        .get(format!("http://127.0.0.1:{port}/api/status"))
        .header("X-API-Key", key)
        .send()
        .and_then(|response| response.error_for_status())
        .and_then(|response| response.json())
        .ok()
}

fn request_graceful_stop(
    client: &reqwest::blocking::Client,
    port: u16,
    key: &str,
) -> Result<(), String> {
    client
        .post(format!("http://127.0.0.1:{port}/api/force-close"))
        .header("X-API-Key", key)
        .send()
        .and_then(|response| response.error_for_status())
        .map(|_| ())
        .map_err(|error| format!("请求 SubsCheck 停止失败：{error}"))
}

fn country_and_speed(name: &str) -> (Option<String>, Option<u64>) {
    let country = Regex::new(r"(?i)(?:^|[^A-Z])([A-Z]{2})_\d+")
        .ok()
        .and_then(|regex| regex.captures(name))
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str().to_ascii_uppercase());
    let speed = Regex::new(r"(?i)(\d+(?:\.\d+)?)\s*(KB|MB)/s")
        .ok()
        .and_then(|regex| regex.captures(name))
        .and_then(|captures| {
            let value = captures.get(1)?.as_str().parse::<f64>().ok()?;
            let multiplier = if captures.get(2)?.as_str().eq_ignore_ascii_case("MB") {
                1024.0
            } else {
                1.0
            };
            Some((value * multiplier).round() as u64)
        });
    (country, speed)
}

fn import_output(
    path: &Path,
    retain_count: usize,
    core_version: &str,
) -> Result<Vec<CommunityNodeCandidate>, String> {
    let content = fs::read(path).map_err(|error| format!("读取 SubsCheck 输出失败：{error}"))?;
    let source = super::models::CommunitySource {
        id: format!("subs-check-{}", core_version.trim_start_matches('v')),
        url: "internal://subs-check/all.yaml".into(),
        enabled: true,
    };
    let mut batch = fingerprint::deduplicate(parser::parse_subscription(&source, &content));
    if batch.nodes.is_empty() {
        return Err(format!(
            "SubsCheck 输出没有可导入节点（跳过 {}，错误：{}）",
            batch.skipped,
            batch.errors.join("；")
        ));
    }
    for node in &mut batch.nodes {
        let (country_code, speed) = country_and_speed(&node.original_name);
        node.country_code = country_code.clone();
        node.country_name = Some(crate::services::country_name_zh(
            country_code.as_deref(),
            None,
        ));
        node.speed_samples_kbps = speed.into_iter().collect();
        node.speed_median_kbps = speed;
        node.exit_verified = country_code.is_some();
        node.last_tested_at = Some(now());
    }
    batch.nodes.sort_by(|left, right| {
        right
            .speed_median_kbps
            .unwrap_or_default()
            .cmp(&left.speed_median_kbps.unwrap_or_default())
            .then_with(|| left.id.cmp(&right.id))
    });
    batch.nodes.truncate(retain_count.min(batch.nodes.len()));
    let mut counters = std::collections::HashMap::<String, usize>::new();
    for node in &mut batch.nodes {
        let country = node
            .country_name
            .clone()
            .unwrap_or_else(|| "未知地区".into());
        let counter = counters.entry(country.clone()).or_default();
        *counter += 1;
        node.display_name = format!("{country} {:02}", *counter);
    }
    ranking::sort_nodes(&mut batch.nodes, "speed");
    Ok(batch.nodes)
}

fn finish(
    app: &AppHandle,
    runtime: &SubsCheckRuntime,
    store_state: &CommunityNodeStore,
    job_id: &str,
    result: Result<Vec<CommunityNodeCandidate>, String>,
) {
    if let Ok(mut child) = runtime.child.lock() {
        if let Some(process) = child.as_mut() {
            let _ = process.kill();
            let _ = process.wait();
        }
        *child = None;
    }
    runtime.running.store(false, Ordering::SeqCst);
    let stopped = runtime.stop_requested.load(Ordering::SeqCst);
    match result {
        Ok(nodes) => {
            let save = store::save_nodes(app, &nodes);
            if save.is_ok() {
                if let Ok(mut current) = store_state.nodes.lock() {
                    *current = nodes;
                }
            }
            update_state(app, &store_state.state, |state| {
                state.state = if save.is_ok() {
                    if stopped {
                        "stopped"
                    } else {
                        "completed"
                    }
                } else {
                    "failed"
                }
                .into();
                state.stage = state.state.clone();
                state.retained_total = store_state
                    .nodes
                    .lock()
                    .map(|nodes| nodes.len())
                    .unwrap_or_default();
                state.completed_at = Some(now());
                state.message = Some(match save {
                    Ok(()) if stopped => {
                        format!(
                            "检测已停止，已保留 {} 个完成测速的节点",
                            state.retained_total
                        )
                    }
                    Ok(()) => format!("检测完成，已导入 {} 个节点", state.retained_total),
                    Err(error) => error,
                });
            });
        }
        Err(error) => update_state(app, &store_state.state, |state| {
            state.state = if stopped { "stopped" } else { "failed" }.into();
            state.stage = state.state.clone();
            state.completed_at = Some(now());
            state.message = Some(if stopped {
                "检测已停止，但本轮尚无完成测速的节点；原有结果保持不变".into()
            } else {
                error
            });
        }),
    }
    if let Ok(snapshot) = store_state.state.lock().map(|state| state.clone()) {
        let _ = store::save_scan_state(app, &snapshot);
    }
    let _ = store::remove_runtime_directory(app, job_id);
}

pub fn start(
    app: AppHandle,
    runtime: &SubsCheckRuntime,
    store_state: &CommunityNodeStore,
) -> Result<CommunityScanState, String> {
    let _operation = store_state
        .operations
        .lock()
        .map_err(|_| "公共节点任务锁不可用")?;
    if runtime.running.load(Ordering::SeqCst) {
        return Err("节点检测已经在运行".into());
    }
    if scanner::has_active_retests(store_state) {
        return Err("公共节点复测正在运行，请等待复测结束后再开始获取".into());
    }
    if store_state
        .state
        .lock()
        .map(|state| matches!(state.state.as_str(), "running" | "paused" | "stopping"))
        .unwrap_or(true)
    {
        return Err("已有公共节点检测任务正在运行".into());
    }
    if !crate::process_utils::active_external_tun_adapters().is_empty() {
        return Err("检测到其他软件的 TUN 正在接管网络，请关闭后再开始获取节点".into());
    }
    let core_installation = installation(&app)?;
    let core = core_installation.path;
    let core_version = core_installation.version;
    let settings = store::load_settings(&app);
    let speed = crate::services::current_speed_test_settings();
    // Use KiNGO's reviewed 65-source snapshot so an ordinary run cannot silently
    // change its input set between releases.
    let sources = source_manifest::builtin_sources();
    let source_urls = sources
        .iter()
        .map(|source| source.url.clone())
        .collect::<Vec<_>>();
    if source_urls.is_empty() {
        return Err("内置节点订阅清单为空，无法开始检测".into());
    }
    let job_id = format!("subs-check-{}", job_stamp());
    let port = free_local_port()?;
    let directory = store::runtime_directory(&app, &job_id)?;
    let output = directory.join("output");
    if let Err(error) = fs::create_dir_all(&output) {
        let _ = store::remove_runtime_directory(&app, &job_id);
        return Err(format!("创建 SubsCheck 输出目录失败：{error}"));
    }
    let config = directory.join("config.yaml");
    let api_key = format!("kingo-{job_id}-{port}");
    let latency_url = speed
        .latency_urls()
        .into_iter()
        .next()
        .unwrap_or_else(|| "http://gstatic.com/generate_204".into());
    let download_url = if speed.download_url.contains("speed.cloudflare.com") {
        UPSTREAM_SPEED_TEST_URL
    } else {
        speed.download_url.as_str()
    };
    if let Err(error) = write_config(
        &config,
        &output,
        port,
        &api_key,
        &source_urls,
        settings.speed_concurrency,
        settings.speed_timeout_seconds,
        &latency_url,
        download_url,
    ) {
        let _ = store::remove_runtime_directory(&app, &job_id);
        return Err(error);
    }
    runtime
        .running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| "节点检测已经在运行".to_string())?;
    runtime.stop_requested.store(false, Ordering::SeqCst);
    let child = match hidden_command(&core)
        .arg("-f")
        .arg(&config)
        .current_dir(&directory)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            runtime.running.store(false, Ordering::SeqCst);
            let _ = store::remove_runtime_directory(&app, &job_id);
            return Err(format!("启动节点检测服务失败：{error}"));
        }
    };
    match runtime.child.lock() {
        Ok(mut slot) => *slot = Some(child),
        Err(_) => {
            runtime.running.store(false, Ordering::SeqCst);
            let mut child = child;
            let _ = child.kill();
            let _ = child.wait();
            let _ = store::remove_runtime_directory(&app, &job_id);
            return Err("SubsCheck 进程状态不可用".into());
        }
    }
    let initial = CommunityScanState {
        job_id: Some(job_id.clone()),
        state: "running".into(),
        stage: "subs_check_starting".into(),
        source_total: sources.len(),
        using_remote_manifest: false,
        started_at: Some(now()),
        updated_at: Some(now()),
        message: Some("正在准备节点检测".into()),
        ..CommunityScanState::default()
    };
    if let Err(error) = store::save_scan_state(&app, &initial) {
        if let Ok(mut child) = runtime.child.lock() {
            if let Some(process) = child.as_mut() {
                let _ = process.kill();
                let _ = process.wait();
            }
            *child = None;
        }
        runtime.running.store(false, Ordering::SeqCst);
        let _ = store::remove_runtime_directory(&app, &job_id);
        return Err(format!("保存节点检测初始状态失败：{error}"));
    }
    if let Ok(mut state) = store_state.state.lock() {
        *state = initial.clone();
    }
    emit_state(&app, &store_state.state);

    let worker_runtime = runtime.clone();
    let worker_store = store_state.clone();
    let worker_core_version = core_version.clone();
    std::thread::spawn(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(3))
            .no_proxy()
            .build();
        let result = (|| -> Result<Vec<CommunityNodeCandidate>, String> {
            let client =
                client.map_err(|error| format!("创建 SubsCheck 状态客户端失败：{error}"))?;
            let mut observed_running = false;
            let mut startup_ticks = 0usize;
            let mut stopping_ticks = 0usize;
            loop {
                let stopping = worker_runtime.stop_requested.load(Ordering::SeqCst);
                if stopping {
                    // SubsCheck's force-close endpoint cancels its pipeline but still
                    // lets the collector save every node that already completed the
                    // full speed stage. Repeat the request because an early click can
                    // arrive while subscriptions are still being parsed, before the
                    // upstream cancellation handle has been installed.
                    if stopping_ticks.is_multiple_of(2) {
                        let _ = request_graceful_stop(&client, port, &api_key);
                    }
                    stopping_ticks += 1;
                    update_state(&app, &worker_store.state, |state| {
                        state.state = "stopping".into();
                        state.stage = "stopping".into();
                        state.message = Some(format!(
                            "正在停止并整理已完成结果（已完成测速 {} 个，通过 {} 个）",
                            state.speed_done, state.speed_succeeded
                        ));
                    });
                }
                let exited = worker_runtime
                    .child
                    .lock()
                    .ok()
                    .and_then(|mut child| child.as_mut()?.try_wait().ok().flatten());
                if let Some(status) = status(&client, port, &api_key) {
                    observed_running |= status.checking;
                    let pipeline = status.pipeline;
                    update_state(&app, &worker_store.state, |state| {
                        if !stopping {
                            state.stage = if pipeline.speed_done > 0 {
                                "subs_check_speed".into()
                            } else if pipeline.alive_done > 0 {
                                "subs_check_alive".into()
                            } else {
                                "subs_check_fetch".into()
                            };
                        }
                        // The status API exposes only the candidate count after
                        // parsing and deduplication. Keep unavailable raw/source
                        // counters empty instead of presenting inferred values.
                        state.source_done = 0;
                        state.source_succeeded = 0;
                        state.raw_total = 0;
                        state.deduplicated_total = pipeline.total;
                        state.alive_total = pipeline.total;
                        state.alive_done = pipeline.alive_done;
                        state.alive_succeeded = pipeline.alive_pass;
                        state.speed_total = pipeline.filter_pass.max(pipeline.speed_done);
                        state.speed_done = pipeline.speed_done;
                        state.speed_succeeded = pipeline.speed_pass;
                        if !stopping {
                            state.message = Some(format!(
                                "候选 {} · 测活 {}/{}（通过 {}）· 测速 {}/{}（通过 {}）",
                                pipeline.total,
                                pipeline.alive_done,
                                pipeline.total,
                                pipeline.alive_pass,
                                pipeline.speed_done,
                                pipeline.filter_pass,
                                pipeline.speed_pass
                            ));
                        }
                    });
                    if (observed_running || output.join("all.yaml").is_file()) && !status.checking {
                        break;
                    }
                }
                if let Some(exit) = exited {
                    if !exit.success() {
                        return Err(format!("节点检测服务异常退出：{exit}"));
                    }
                    break;
                }
                startup_ticks += 1;
                if startup_ticks > 120 && !observed_running {
                    return Err("节点检测服务启动 60 秒后仍未进入检测状态".into());
                }
                if stopping && stopping_ticks > 60 {
                    return Err("等待检测服务整理部分结果超时".into());
                }
                std::thread::sleep(Duration::from_millis(500));
            }
            let output_file = output.join("all.yaml");
            for _ in 0..20 {
                if output_file.is_file() {
                    return import_output(
                        &output_file,
                        settings.retain_count,
                        &worker_core_version,
                    );
                }
                std::thread::sleep(Duration::from_millis(250));
            }
            Err("节点检测结束但没有生成结果文件".into())
        })();
        finish(&app, &worker_runtime, &worker_store, &job_id, result);
    });
    Ok(initial)
}

pub fn stop(
    app: &AppHandle,
    runtime: &SubsCheckRuntime,
    store_state: &CommunityNodeStore,
) -> Result<CommunityScanState, String> {
    if !runtime.running.load(Ordering::SeqCst) {
        return Err("当前没有运行中的节点检测".into());
    }
    runtime.stop_requested.store(true, Ordering::SeqCst);
    update_state(app, &store_state.state, |state| {
        state.state = "stopping".into();
        state.stage = "stopping".into();
        state.message = Some("正在停止并整理已完成测速的节点".into());
    });
    store_state
        .state
        .lock()
        .map(|state| state.clone())
        .map_err(|_| "公共节点状态不可用".into())
}

pub fn shutdown(runtime: &SubsCheckRuntime) {
    runtime.stop_requested.store(true, Ordering::SeqCst);
    if let Ok(mut child) = runtime.child.lock() {
        if let Some(process) = child.as_mut() {
            let _ = process.kill();
            let _ = process.wait();
        }
        *child = None;
    }
    runtime.running.store(false, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_upstream_country_and_speed_tags() {
        let (country, speed) = country_and_speed("🇯🇵JP_12|5.4MB/s");
        assert_eq!(country.as_deref(), Some("JP"));
        assert_eq!(speed, Some(5530));
        let (country, speed) = country_and_speed("🇩🇪DE_2|640KB/s");
        assert_eq!(country.as_deref(), Some("DE"));
        assert_eq!(speed, Some(640));
    }

    #[test]
    fn rejects_names_without_upstream_country_tag() {
        let (country, speed) = country_and_speed("ordinary node");
        assert!(country.is_none());
        assert!(speed.is_none());
    }

    #[test]
    fn imported_nodes_record_the_runtime_core_version() {
        let path = std::env::temp_dir().join(format!(
            "kingo-subs-check-import-{}-{}.yaml",
            std::process::id(),
            job_stamp()
        ));
        fs::write(
            &path,
            "proxies:\n  - name: JP_1|5.4MB/s\n    type: trojan\n    server: example.com\n    port: 443\n    password: test\n",
        )
        .unwrap();
        let nodes = import_output(&path, 50, "1.7.0").unwrap();
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].source_ids, vec!["subs-check-1.7.0"]);
        assert_eq!(nodes[0].country_code.as_deref(), Some("JP"));
        let _ = fs::remove_file(path);
    }
}
