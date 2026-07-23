use crate::{
    clash_controller, clash_profiles, core_runtime, paths, process_utils::hidden_command,
    system_proxy,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    fs,
    net::IpAddr,
    net::TcpStream,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConnectionState {
    pub mode: String,
    pub connected: bool,
    pub connecting: bool,
    pub stage: String,
    pub core_id: Option<String>,
    pub display_name: Option<String>,
    pub latency: Option<u32>,
    pub exit_ip: Option<String>,
    pub country: Option<String>,
    pub tun_enabled: bool,
    pub system_proxy_enabled: bool,
    pub auto_failover: bool,
    pub error: Option<String>,
    pub download_bps: u64,
    pub upload_bps: u64,
    pub download_total: u64,
    pub upload_total: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrafficState {
    pub download_bps: u64,
    pub upload_bps: u64,
    pub download_total: u64,
    pub upload_total: u64,
}

#[derive(Clone, Debug, serde::Deserialize)]
struct ExitInfoResponse {
    ip: Option<String>,
    country: Option<String>,
    #[serde(rename = "countryCode")]
    country_code: Option<String>,
    city: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicRoute {
    pub id: String,
    pub name: String,
    pub core_id: String,
    pub slot: u32,
    pub protocol_label: String,
    pub config_format: String,
    pub config_path: String,
    pub downloaded: bool,
    pub active: bool,
    pub connection_state: String,
    pub last_success_at: Option<u64>,
    pub last_error: Option<String>,
    pub latency: Option<u32>,
    pub country: Option<String>,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublicRouteSeed {
    id: String,
    name: String,
    core_id: String,
    slot: u32,
    protocol_label: String,
    config_format: String,
    config_path: String,
}

pub struct ConnectionStore {
    pub state: Arc<Mutex<AppConnectionState>>,
    pub selected_route: Arc<Mutex<Option<String>>>,
    pub cancel: Arc<Mutex<Option<Arc<AtomicBool>>>>,
    pub proxy: system_proxy::ProxyState,
    pub route_metrics: Arc<Mutex<HashMap<String, RouteMetric>>>,
    pub active_route: Arc<Mutex<Option<PublicRoute>>>,
    pub traffic_sample: Arc<Mutex<Option<TrafficSample>>>,
    pub route_update_running: Arc<AtomicBool>,
    pub route_update_cancel: Arc<AtomicBool>,
    pub route_update_progress: Arc<Mutex<Option<RouteUpdateProgress>>>,
}

#[derive(Clone, Debug)]
pub struct TrafficSample {
    pub at_ms: u128,
    pub download_total: u64,
    pub upload_total: u64,
}

#[derive(Clone, Debug, Default, Serialize, serde::Deserialize)]
pub struct RouteMetric {
    pub latency: Option<u32>,
    pub error: Option<String>,
    pub last_success_at: Option<u64>,
    #[serde(default)]
    pub country: Option<String>,
}

#[derive(Default, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionSettings {
    auto_failover: bool,
}

#[derive(Clone, Debug, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoRoutingRule {
    pub id: String,
    pub target: String,
    pub action: String,
    pub enabled: bool,
}

#[derive(Clone, Debug, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoRoutingSettings {
    pub mode: String,
    pub rules: Vec<AutoRoutingRule>,
}

impl Default for AutoRoutingSettings {
    fn default() -> Self {
        Self {
            mode: "rule".into(),
            rules: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedTestSettings {
    pub url: String,
    pub timeout_seconds: u64,
    pub concurrency: usize,
}

impl Default for SpeedTestSettings {
    fn default() -> Self {
        Self {
            url: "https://www.gstatic.com/generate_204".into(),
            timeout_seconds: 4,
            concurrency: 6,
        }
    }
}

static SPEED_TEST_SETTINGS: OnceLock<Mutex<SpeedTestSettings>> = OnceLock::new();

fn speed_test_settings() -> &'static Mutex<SpeedTestSettings> {
    SPEED_TEST_SETTINGS.get_or_init(|| Mutex::new(SpeedTestSettings::default()))
}

fn current_speed_test_settings() -> SpeedTestSettings {
    speed_test_settings()
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default()
}

impl Default for ConnectionStore {
    fn default() -> Self {
        Self {
            state: Arc::new(Mutex::new(AppConnectionState {
                mode: "auto".into(),
                connected: false,
                connecting: false,
                stage: "idle".into(),
                core_id: None,
                display_name: None,
                latency: None,
                exit_ip: None,
                country: None,
                tun_enabled: false,
                system_proxy_enabled: false,
                auto_failover: false,
                error: None,
                download_bps: 0,
                upload_bps: 0,
                download_total: 0,
                upload_total: 0,
            })),
            selected_route: Arc::new(Mutex::new(None)),
            cancel: Arc::new(Mutex::new(None)),
            proxy: system_proxy::ProxyState::default(),
            route_metrics: Arc::new(Mutex::new(HashMap::new())),
            active_route: Arc::new(Mutex::new(None)),
            traffic_sample: Arc::new(Mutex::new(None)),
            route_update_running: Arc::new(AtomicBool::new(false)),
            route_update_cancel: Arc::new(AtomicBool::new(false)),
            route_update_progress: Arc::new(Mutex::new(None)),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteUpdateError {
    pub route_id: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteUpdateSummary {
    pub success: bool,
    pub cancelled: bool,
    pub updated: usize,
    pub failed: usize,
    pub errors: Vec<RouteUpdateError>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteUpdateProgress {
    pub completed: usize,
    pub total: usize,
    pub route_id: String,
    pub route_name: String,
    pub success: bool,
    pub error: Option<String>,
}

fn emit_log(app: &AppHandle, level: &str, message: &str) {
    let _ = app.emit(
        "connection-log",
        serde_json::json!({ "level": level, "message": message }),
    );
}

pub fn update_public_routes(app: AppHandle, store: &ConnectionStore) -> Result<(), String> {
    let connection_busy = store
        .state
        .lock()
        .map_err(|_| "连接状态不可用")
        .map(|state| state.connecting || state.connected)?;
    if connection_busy {
        return Err("请先结束测速或断开连接再更新线路".into());
    }
    if store
        .route_update_running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("公共线路更新任务已在运行".into());
    }
    let running = store.route_update_running.clone();
    store.route_update_cancel.store(false, Ordering::SeqCst);
    let cancel = store.route_update_cancel.clone();
    let metrics = store.route_metrics.clone();
    let progress = store.route_update_progress.clone();
    if let Ok(mut value) = progress.lock() {
        *value = Some(RouteUpdateProgress {
            completed: 0,
            total: default_public_routes().len(),
            route_id: String::new(),
            route_name: "准备中".into(),
            success: true,
            error: None,
        });
    }
    std::thread::spawn(move || {
        let routes = default_public_routes();
        let total = routes.len();
        let mut updated = 0usize;
        let mut errors = Vec::new();
        emit_log(&app, "info", "开始更新公共线路资源");
        for (index, route) in routes.iter().enumerate() {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            let result = download_and_install_route(&app, route);
            let error = result.as_ref().err().cloned();
            if result.is_ok() {
                updated += 1;
                if let Ok(mut values) = metrics.lock() {
                    values.remove(&route.id);
                }
                persist_route_metrics(&metrics);
            } else if let Some(message) = error.clone() {
                errors.push(RouteUpdateError {
                    route_id: route.id.clone(),
                    message,
                });
            }
            let current_progress = RouteUpdateProgress {
                completed: index + 1,
                total,
                route_id: route.id.clone(),
                route_name: route.name.clone(),
                success: result.is_ok(),
                error,
            };
            if let Ok(mut value) = progress.lock() {
                *value = Some(current_progress.clone());
            }
            let _ = app.emit("public-route-update-progress", &current_progress);
        }
        let summary = RouteUpdateSummary {
            success: errors.is_empty() && !cancel.load(Ordering::Relaxed),
            cancelled: cancel.load(Ordering::Relaxed),
            updated,
            failed: errors.len(),
            errors,
        };
        running.store(false, Ordering::SeqCst);
        if let Ok(mut value) = progress.lock() {
            *value = None;
        }
        emit_log(
            &app,
            if summary.success { "info" } else { "warn" },
            &if summary.cancelled {
                format!("公共线路更新已取消：已更新 {}", summary.updated)
            } else {
                format!(
                    "公共线路更新完成：成功 {}，失败 {}",
                    summary.updated, summary.failed
                )
            },
        );
        let _ = app.emit("public-route-update-complete", &summary);
    });
    Ok(())
}

pub fn route_update_status(store: &ConnectionStore) -> Option<RouteUpdateProgress> {
    if !store.route_update_running.load(Ordering::SeqCst) {
        return None;
    }
    store.route_update_progress.lock().ok()?.clone()
}

pub fn cancel_public_route_update(store: &ConnectionStore) {
    store.route_update_cancel.store(true, Ordering::SeqCst);
}

fn download_and_install_route(app: &AppHandle, route: &PublicRoute) -> Result<(), String> {
    let remote_dir = match route.core_id.as_str() {
        "mihomo" => "clash.meta2",
        "xray" => "xray",
        "sing-box" => "singbox",
        "hysteria2" => "hysteria2",
        "hysteria" => "hysteria",
        "naiveproxy" => "naiveproxy",
        "juicity" => "juicity",
        "mieru" => "mieru",
        "shadowquic" => "shadowquic",
        other => return Err(format!("不支持的线路核心：{other}")),
    };
    let file_name = if route.core_id == "shadowquic" {
        "client.yaml"
    } else if route.config_format == "yaml" {
        "config.yaml"
    } else {
        "config.json"
    };
    let urls = [
        format!("https://www.gitlabip.xyz/Alvin9999/PAC/refs/heads/master/backup/img/1/2/ipp/{remote_dir}/{}/{file_name}", route.slot),
        format!("https://gitlab.com/free9999/ipupdate/-/raw/master/backup/img/1/2/ipp/{remote_dir}/{}/{file_name}", route.slot),
    ];
    let mut failures = Vec::new();
    for url in urls {
        match download_route(&url).and_then(|bytes| {
            validate_route_config(route, &bytes)?;
            install_route_config(app, route, &bytes)
        }) {
            Ok(()) => return Ok(()),
            Err(error) => failures.push(error),
        }
    }
    Err(failures.join("；备用源："))
}

fn download_route(url: &str) -> Result<Vec<u8>, String> {
    let output = hidden_command("curl.exe")
        .args([
            "-fsSL",
            "--ssl-no-revoke",
            "--connect-timeout",
            "8",
            "--max-time",
            "30",
            url,
        ])
        .output()
        .map_err(|error| format!("无法启动系统下载器：{error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            format!("下载失败（{}）", output.status)
        } else {
            format!("下载失败：{detail}")
        });
    }
    Ok(output.stdout)
}

fn validate_route_config(route: &PublicRoute, bytes: &[u8]) -> Result<(), String> {
    if route.config_format == "json" {
        let value: serde_json::Value =
            serde_json::from_slice(bytes).map_err(|error| format!("JSON 校验失败：{error}"))?;
        if !value.is_object() {
            return Err("JSON 配置不是对象".into());
        }
    } else {
        let text = std::str::from_utf8(bytes).map_err(|_| "YAML 不是 UTF-8 文本")?;
        let lower = text.trim_start().to_ascii_lowercase();
        let expected_marker = if route.core_id == "shadowquic" {
            "inbound:"
        } else {
            "mixed-port:"
        };
        if text.trim().is_empty() || lower.starts_with('<') || !text.contains(expected_marker) {
            return Err("YAML 配置格式不完整".into());
        }
    }
    Ok(())
}

fn install_route_config(app: &AppHandle, route: &PublicRoute, bytes: &[u8]) -> Result<(), String> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("数据目录不可用：{error}"))?;
    let cache_dir = data.join("routes").join(route.id.replace(':', "_"));
    fs::create_dir_all(&cache_dir).map_err(|error| format!("缓存目录创建失败：{error}"))?;
    let extension = if route.config_format == "yaml" {
        "yaml"
    } else {
        "json"
    };
    let target = cache_dir.join(format!("config.{extension}"));
    let pending = cache_dir.join(format!("config.download.{extension}"));
    let previous = cache_dir.join(format!("config.previous.{extension}"));
    fs::write(&pending, bytes).map_err(|error| format!("临时配置写入失败：{error}"))?;
    if target.is_file() {
        fs::copy(&target, &previous).map_err(|error| format!("旧配置备份失败：{error}"))?;
        fs::remove_file(&target).map_err(|error| format!("旧配置替换失败：{error}"))?;
    }
    if let Err(error) = fs::rename(&pending, &target) {
        if previous.is_file() {
            let _ = fs::copy(&previous, &target);
        }
        let _ = fs::remove_file(&pending);
        return Err(format!("新配置安装失败：{error}"));
    }
    if route.core_id == "mihomo" {
        ensure_mihomo_controller(&target)?;
    }
    Ok(())
}

pub fn default_public_routes() -> Vec<PublicRoute> {
    let seeds: Vec<PublicRouteSeed> =
        serde_json::from_str(include_str!("../resources/public-routes.json")).unwrap_or_default();
    seeds
        .into_iter()
        .map(|seed| PublicRoute {
            id: seed.id,
            name: seed.name,
            core_id: seed.core_id,
            slot: seed.slot,
            protocol_label: seed.protocol_label,
            config_format: seed.config_format,
            config_path: seed.config_path,
            downloaded: true,
            active: false,
            connection_state: "idle".into(),
            last_success_at: None,
            last_error: None,
            latency: None,
            country: None,
        })
        .collect()
}

pub fn public_routes_snapshot(app: &AppHandle, store: &ConnectionStore) -> Vec<PublicRoute> {
    let mut routes = default_public_routes();
    let active_id = store
        .active_route
        .lock()
        .ok()
        .and_then(|route| route.as_ref().map(|route| route.id.clone()));
    if let Ok(metrics) = store.route_metrics.lock() {
        for route in &mut routes {
            route.downloaded = cached_config(app, route).is_ok();
            route.active = active_id.as_deref() == Some(route.id.as_str());
            if let Some(metric) = metrics.get(&route.id) {
                route.last_error = metric.error.clone();
                route.last_success_at = metric.last_success_at;
                route.latency = if metric.error.is_some() {
                    None
                } else {
                    metric.latency
                };
                route.country = metric.country.clone();
            }
            route.connection_state = if route.active {
                "connected".into()
            } else if route.last_error.is_some() {
                "failed".into()
            } else if route.latency.is_some() {
                "available".into()
            } else {
                "idle".into()
            };
        }
    }
    routes.sort_by_key(|route| {
        (
            route.latency.is_none(),
            route.latency.unwrap_or(u32::MAX),
            route.country.clone().unwrap_or_default(),
        )
    });
    routes
}

pub fn test_public_routes(
    app: AppHandle,
    store: &ConnectionStore,
    runtime: &core_runtime::CoreRuntime,
) -> Result<(), String> {
    test_routes(app, store, runtime, None)
}

pub fn test_public_route(
    app: AppHandle,
    store: &ConnectionStore,
    runtime: &core_runtime::CoreRuntime,
    route_id: String,
) -> Result<(), String> {
    if !default_public_routes()
        .iter()
        .any(|route| route.id == route_id)
    {
        return Err("公共线路不存在".into());
    }
    test_routes(app, store, runtime, Some(route_id))
}

fn test_routes(
    app: AppHandle,
    store: &ConnectionStore,
    runtime: &core_runtime::CoreRuntime,
    route_id: Option<String>,
) -> Result<(), String> {
    if store.route_update_running.load(Ordering::SeqCst) {
        return Err("请先等待线路更新完成或取消更新".into());
    }
    {
        let mut state = store
            .state
            .lock()
            .map_err(|_| "connection state unavailable")?;
        if state.connected {
            return Err("请先断开当前连接再进行独立测速".into());
        }
        if state.connecting {
            return Err("已有连接或测速任务正在运行".into());
        }
        state.connecting = true;
        state.stage = "testing".into();
        state.display_name = Some("准备测试公共线路".into());
        state.error = None;
    }
    let routes: Vec<_> = default_public_routes()
        .into_iter()
        .filter(|route| route_id.as_ref().map(|id| id == &route.id).unwrap_or(true))
        .collect();
    core_runtime::stop_all(runtime)?;
    let cancel = Arc::new(AtomicBool::new(false));
    *store
        .cancel
        .lock()
        .map_err(|_| "connection control unavailable")? = Some(cancel.clone());
    emit_snapshot(&app, store);
    let state = store.state.clone();
    let cancel_slot = store.cancel.clone();
    let metrics = store.route_metrics.clone();
    std::thread::spawn(move || {
        let total = routes.len();
        let completed = Arc::new(AtomicUsize::new(0));
        let succeeded = Arc::new(AtomicUsize::new(0));
        let mut groups: HashMap<u16, Vec<(PublicRoute, u16)>> = HashMap::new();
        let mut socks_lane = 0_u16;
        for route in routes {
            let original_port = proxy_port(&route);
            let test_port = if original_port == 1080 {
                let port = 11080 + socks_lane;
                socks_lane = (socks_lane + 1) % 3;
                port
            } else {
                original_port
            };
            groups
                .entry(test_port)
                .or_default()
                .push((route, test_port));
        }
        let settings = current_speed_test_settings();
        let queue = Arc::new(Mutex::new(VecDeque::from_iter(groups.into_values())));
        let worker_count = settings
            .concurrency
            .min(queue.lock().map(|value| value.len()).unwrap_or(1))
            .max(1);
        let mut workers = Vec::with_capacity(worker_count);
        for _ in 0..worker_count {
            let app = app.clone();
            let state = state.clone();
            let metrics = metrics.clone();
            let cancel = cancel.clone();
            let completed = completed.clone();
            let succeeded = succeeded.clone();
            let queue = queue.clone();
            workers.push(std::thread::spawn(move || {
                let runtime = core_runtime::CoreRuntime::default();
                while let Some(group) = queue.lock().ok().and_then(|mut value| value.pop_front()) {
                    for (route, test_port) in group {
                        if cancel.load(Ordering::Relaxed) {
                            break;
                        }
                        let result = probe_route(&app, &runtime, &route, test_port, &cancel);
                        if cancel.load(Ordering::Relaxed) {
                            break;
                        }
                        let current = completed.fetch_add(1, Ordering::SeqCst) + 1;
                        match result {
                            Ok((latency, country)) => {
                                succeeded.fetch_add(1, Ordering::SeqCst);
                                record_metric(&metrics, &route.id, Some(latency), None);
                                record_route_country(&metrics, &route.id, country);
                                emit_probe_progress(
                                    &app,
                                    &state,
                                    current,
                                    total,
                                    &route,
                                    Some(latency),
                                    None,
                                );
                            }
                            Err(error) => {
                                record_metric(&metrics, &route.id, None, Some(error.clone()));
                                emit_probe_progress(
                                    &app,
                                    &state,
                                    current,
                                    total,
                                    &route,
                                    None,
                                    Some(error),
                                );
                            }
                        }
                    }
                    if cancel.load(Ordering::Relaxed) {
                        break;
                    }
                }
                let _ = core_runtime::stop_all(&runtime);
            }));
        }
        for worker in workers {
            let _ = worker.join();
        }
        let succeeded = succeeded.load(Ordering::SeqCst);
        let cancelled = cancel.load(Ordering::Relaxed);
        if let Ok(mut current) = state.lock() {
            current.connecting = false;
            current.stage = "idle".into();
            current.display_name = None;
            current.latency = None;
            current.error = None;
        }
        let _ = app.emit(
            "connection-state",
            state.lock().ok().map(|value| value.clone()),
        );
        let _ = app.emit(
            "public-route-test-complete",
            serde_json::json!({
                "cancelled": cancelled, "succeeded": succeeded, "total": total
            }),
        );
        let _ = app.emit("connection-log", serde_json::json!({
            "level": if cancelled { "warning" } else { "success" },
            "message": if cancelled { "公共线路测速已取消".to_string() } else { format!("公共线路测速完成：{succeeded}/{total} 条可用") }
        }));
        if let Ok(mut slot) = cancel_slot.lock() {
            if slot
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, &cancel))
            {
                *slot = None;
            }
        }
    });
    Ok(())
}

pub fn load_route_metrics(app: &AppHandle, store: &ConnectionStore) {
    let Ok(data_dir) = app.path().app_data_dir() else {
        return;
    };
    let path = data_dir.join("routes").join("metrics.json");
    let Ok(data) = fs::read_to_string(path) else {
        return;
    };
    let Ok(metrics) = serde_json::from_str::<HashMap<String, RouteMetric>>(&data) else {
        return;
    };
    if let Ok(mut current) = store.route_metrics.lock() {
        if current.is_empty() {
            *current = metrics;
        }
    }
}

pub fn load_connection_settings(app: &AppHandle, store: &ConnectionStore) {
    let Ok(data_dir) = app.path().app_data_dir() else {
        return;
    };
    let path = data_dir.join("connection-settings.json");
    let Ok(content) = fs::read_to_string(path) else {
        return;
    };
    let Ok(settings) = serde_json::from_str::<ConnectionSettings>(&content) else {
        return;
    };
    if let Ok(mut state) = store.state.lock() {
        state.auto_failover = settings.auto_failover;
    }
}

pub fn load_speed_test_settings(app: &AppHandle) {
    let Ok(data_dir) = app.path().app_data_dir() else {
        return;
    };
    let Ok(content) = fs::read_to_string(data_dir.join("speed-test-settings.json")) else {
        return;
    };
    let Ok(value) = serde_json::from_str::<SpeedTestSettings>(&content) else {
        return;
    };
    if validate_speed_test_settings(&value).is_ok() {
        if let Ok(mut current) = speed_test_settings().lock() {
            *current = value;
        }
    }
}

pub fn get_speed_test_settings() -> SpeedTestSettings {
    current_speed_test_settings()
}

fn validate_speed_test_settings(value: &SpeedTestSettings) -> Result<(), String> {
    let url = value.url.trim();
    if url.len() > 2048 || !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("测速地址必须是有效的 HTTP 或 HTTPS URL".into());
    }
    if !(2..=30).contains(&value.timeout_seconds) {
        return Err("测速超时必须在 2 到 30 秒之间".into());
    }
    if !(1..=12).contains(&value.concurrency) {
        return Err("测速并发必须在 1 到 12 之间".into());
    }
    Ok(())
}

pub fn set_speed_test_settings(
    app: &AppHandle,
    mut value: SpeedTestSettings,
) -> Result<SpeedTestSettings, String> {
    value.url = value.url.trim().to_string();
    validate_speed_test_settings(&value)?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
    let content = serde_json::to_string_pretty(&value).map_err(|error| error.to_string())?;
    fs::write(data_dir.join("speed-test-settings.json"), content)
        .map_err(|error| error.to_string())?;
    if let Ok(mut current) = speed_test_settings().lock() {
        *current = value.clone();
    }
    Ok(value)
}

fn persist_connection_settings(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
    let content = serde_json::to_string_pretty(&ConnectionSettings {
        auto_failover: enabled,
    })
    .map_err(|error| error.to_string())?;
    fs::write(data_dir.join("connection-settings.json"), content).map_err(|error| error.to_string())
}

fn persist_route_metrics(metrics: &Arc<Mutex<HashMap<String, RouteMetric>>>) {
    let Ok(data_dir) = std::env::var("APPDATA") else {
        return;
    };
    let path = std::path::PathBuf::from(data_dir)
        .join("com.kingo.client")
        .join("routes")
        .join("metrics.json");
    let Ok(values) = metrics.lock() else { return };
    let Ok(data) = serde_json::to_string_pretty(&*values) else {
        return;
    };
    drop(values);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(path, data);
}

pub fn snapshot(store: &ConnectionStore) -> AppConnectionState {
    store
        .state
        .lock()
        .expect("connection state lock poisoned")
        .clone()
}

pub fn set_clash_system_proxy(
    app: &AppHandle,
    store: &ConnectionStore,
    enabled: bool,
) -> Result<AppConnectionState, String> {
    let current = snapshot(store);
    if current.mode != "clash" || !current.connected || current.core_id.as_deref() != Some("mihomo")
    {
        return Err("请先启动 Clash 配置，再切换系统代理".into());
    }
    if enabled {
        if let Err(error) = system_proxy::enable(&store.proxy, 7890, false, true) {
            let _ = system_proxy::disable(&store.proxy);
            return Err(error);
        }
        if !system_proxy::is_kingo_enabled(7890) {
            let _ = system_proxy::disable(&store.proxy);
            return Err("Windows 系统代理状态校验失败，已回滚".into());
        }
    } else {
        system_proxy::disable(&store.proxy)?;
        if system_proxy::is_kingo_enabled(7890) {
            return Err("Windows 系统代理仍指向 KiNGO，关闭失败".into());
        }
    }
    if let Err(error) = clash_controller::save_system_proxy(app, enabled) {
        if enabled {
            let _ = system_proxy::disable(&store.proxy);
        } else {
            let _ = system_proxy::enable(&store.proxy, 7890, false, true);
        }
        return Err(format!("保存系统代理设置失败：{error}；已回滚"));
    }
    store
        .state
        .lock()
        .map_err(|_| "连接状态不可用")?
        .system_proxy_enabled = enabled;
    emit_snapshot(app, store);
    Ok(snapshot(store))
}

pub fn set_clash_tun(
    app: &AppHandle,
    store: &ConnectionStore,
    enabled: bool,
) -> Result<AppConnectionState, String> {
    let current = snapshot(store);
    if current.mode != "clash" || !current.connected || current.core_id.as_deref() != Some("mihomo")
    {
        return Err("请先启动 Clash 配置，再切换虚拟网卡".into());
    }
    clash_controller::set_tun_enabled(app, enabled)?;
    store
        .state
        .lock()
        .map_err(|_| "连接状态不可用")?
        .tun_enabled = enabled;
    emit_snapshot(app, store);
    Ok(snapshot(store))
}
pub fn emit_snapshot(app: &AppHandle, store: &ConnectionStore) {
    let _ = app.emit("connection-state", snapshot(store));
}

fn monitor_clash_runtime(
    app: &AppHandle,
    store: &ConnectionStore,
    runtime: &core_runtime::CoreRuntime,
    cancel: Arc<AtomicBool>,
) {
    let app_monitor = app.clone();
    let state = store.state.clone();
    let runtime_monitor = runtime.clone();
    let proxy = store.proxy.clone();
    let active_route = store.active_route.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));
        if cancel.load(Ordering::Relaxed) {
            return;
        }
        let running = core_runtime::statuses(&runtime_monitor)
            .map(|items| {
                items
                    .iter()
                    .any(|item| item.core_id == "mihomo" && item.running)
            })
            .unwrap_or(false);
        if running {
            continue;
        }
        let _ = system_proxy::disable(&proxy);
        if let Ok(mut active) = active_route.lock() {
            *active = None;
        }
        if let Ok(mut current) = state.lock() {
            current.connected = false;
            current.connecting = false;
            current.stage = "failed".into();
            current.error = Some("mihomo 核心意外退出".into());
            current.download_bps = 0;
            current.upload_bps = 0;
        }
        let _ = app_monitor.emit(
            "connection-state",
            state.lock().ok().map(|value| value.clone()),
        );
        return;
    });
}

fn listening_port_owner(port: u16) -> Option<String> {
    let output = hidden_command("netstat.exe")
        .args(["-ano", "-p", "tcp"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let pid = text.lines().find_map(|line| {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 5 || !fields[3].eq_ignore_ascii_case("LISTENING") {
            return None;
        }
        fields[1]
            .trim_matches(['[', ']'])
            .ends_with(&format!(":{port}"))
            .then(|| fields[4].to_string())
    })?;
    let task = hidden_command("tasklist.exe")
        .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
        .output()
        .ok()
        .map(|value| String::from_utf8_lossy(&value.stdout).into_owned())
        .unwrap_or_default();
    let process = task
        .lines()
        .next()
        .and_then(|line| line.split(',').next())
        .map(|value| value.trim().trim_matches('"').to_string())
        .filter(|value| !value.is_empty() && !value.starts_with("INFO:"));
    Some(match process {
        Some(process) => format!("{process}（PID {pid}）"),
        None => format!("PID {pid}"),
    })
}

fn ensure_clash_ports_available(runtime: &core_runtime::CoreRuntime) -> Result<(), String> {
    let own_mihomo_running = core_runtime::statuses(runtime)
        .unwrap_or_default()
        .iter()
        .any(|status| status.core_id == "mihomo" && status.running);
    if own_mihomo_running {
        return Ok(());
    }
    for (port, purpose) in [(7890, "代理"), (9090, "控制器")] {
        let address = format!("127.0.0.1:{port}")
            .parse()
            .expect("valid local address");
        if TcpStream::connect_timeout(&address, Duration::from_millis(180)).is_ok() {
            let owner = listening_port_owner(port).unwrap_or_else(|| "其他程序".into());
            return Err(format!(
                "Clash {purpose}端口 {port} 已被 {owner} 占用。请关闭 Clash Verge 或修改占用该端口的程序后重试"
            ));
        }
    }
    Ok(())
}

pub fn start_clash_connection(
    app: AppHandle,
    store: &ConnectionStore,
    runtime: &core_runtime::CoreRuntime,
    profile_id: &str,
) -> Result<(), String> {
    if store.state.lock().map_err(|_| "连接状态不可用")?.connecting {
        return Err("已有连接任务正在执行".into());
    }
    let previous_state = snapshot(store);
    let previous_route = store
        .active_route
        .lock()
        .map_err(|_| "活动配置状态不可用")?
        .clone();
    let profile = clash_profiles::get(&app, profile_id)?;
    let clash_core = clash_controller::active_core(&app)?;
    ensure_clash_ports_available(runtime)?;
    let config = clash_profiles::prepare_runtime(&app, profile_id)?;

    cancel_connection(&app, store, runtime)?;
    {
        let mut state = store.state.lock().map_err(|_| "连接状态不可用")?;
        state.mode = "clash".into();
        state.connected = false;
        state.connecting = true;
        state.stage = "connecting".into();
        state.core_id = Some(clash_core.clone());
        state.display_name = Some(profile.name.clone());
        state.error = None;
        state.exit_ip = None;
        state.country = None;
    }
    let cancel = Arc::new(AtomicBool::new(false));
    *store.cancel.lock().map_err(|_| "连接控制不可用")? = Some(cancel.clone());
    let route = PublicRoute {
        id: profile.id.clone(),
        name: profile.name.clone(),
        core_id: clash_core.clone(),
        slot: 0,
        protocol_label: "Clash".into(),
        config_format: "yaml".into(),
        config_path: config.clone(),
        downloaded: true,
        active: true,
        connection_state: "connecting".into(),
        last_success_at: None,
        last_error: None,
        latency: None,
        country: None,
    };
    *store
        .active_route
        .lock()
        .map_err(|_| "活动配置状态不可用")? = Some(route.clone());
    emit_snapshot(&app, store);

    let result = (|| {
        core_runtime::start(&app, runtime, clash_core.clone(), config)?;
        if !wait_for_port(7890, Duration::from_secs(8)) {
            let exited = core_runtime::statuses(runtime)
                .unwrap_or_default()
                .iter()
                .any(|status| status.core_id == clash_core && !status.running);
            if exited {
                return Err("mihomo 启动后立即退出，请查看运行日志中的首条错误".into());
            }
            return Err("mihomo 已启动，但 Mixed 7890 端口未就绪".into());
        }
        clash_controller::apply_saved_mode(&app)?;
        let _ = clash_controller::apply_saved_selections(&app, profile_id);
        let latency = proxy_request_latency(&route)?;
        let clash_settings = clash_controller::get_settings(&app)?;
        if clash_settings.system_proxy {
            system_proxy::enable(&store.proxy, 7890, false, true)?;
            if !system_proxy::is_kingo_enabled(7890) {
                let _ = system_proxy::disable(&store.proxy);
                return Err("Windows 系统代理状态校验失败".into());
            }
        }
        clash_profiles::activate(&app, profile_id)?;
        let exit = query_exit_info(&route).ok();
        let mut state = store.state.lock().map_err(|_| "连接状态不可用")?;
        state.connected = true;
        state.connecting = false;
        state.stage = "connected".into();
        state.latency = Some(latency);
        state.exit_ip = exit.as_ref().map(|value| value.ip.clone());
        state.country = exit.as_ref().map(|value| value.country.clone());
        state.tun_enabled = clash_settings.tun_enabled;
        state.system_proxy_enabled = clash_settings.system_proxy;
        state.error = None;
        Ok::<(), String>(())
    })();

    if let Err(error) = result {
        let _ = core_runtime::stop(runtime, &clash_core);
        let _ = system_proxy::disable(&store.proxy);
        let rollback = previous_route
            .filter(|route| {
                previous_state.connected
                    && previous_state.mode == "clash"
                    && matches!(route.core_id.as_str(), "mihomo" | "mihomo-alpha")
                    && route.id != profile_id
            })
            .map(|route| {
                let restored = (|| {
                    core_runtime::start(
                        &app,
                        runtime,
                        route.core_id.clone(),
                        route.config_path.clone(),
                    )?;
                    if !wait_for_port(7890, Duration::from_secs(8)) {
                        return Err("上一配置的 Mixed 7890 端口未就绪".into());
                    }
                    clash_controller::apply_saved_mode(&app)?;
                    let _ = clash_controller::apply_saved_selections(&app, &route.id);
                    if previous_state.system_proxy_enabled {
                        system_proxy::enable(&store.proxy, 7890, false, true)?;
                    }
                    *store
                        .active_route
                        .lock()
                        .map_err(|_| "活动配置状态不可用")? = Some(route);
                    let mut state = store.state.lock().map_err(|_| "连接状态不可用")?;
                    *state = previous_state.clone();
                    state.connecting = false;
                    state.connected = true;
                    state.stage = "connected".into();
                    state.error = Some(format!("新配置启动失败，已恢复上一配置：{error}"));
                    Ok::<(), String>(())
                })();
                if restored.is_err() {
                    let _ = core_runtime::stop(runtime, &clash_core);
                    let _ = system_proxy::disable(&store.proxy);
                }
                restored
            });
        if matches!(rollback.as_ref(), Some(Ok(()))) {
            emit_snapshot(&app, store);
            monitor_clash_runtime(&app, store, runtime, cancel);
            return Err(format!("{error}；已自动恢复上一配置"));
        }
        if let Ok(mut active) = store.active_route.lock() {
            *active = None;
        }
        if let Ok(mut state) = store.state.lock() {
            state.connected = false;
            state.connecting = false;
            state.stage = "failed".into();
            state.error = Some(match rollback.as_ref() {
                Some(Err(rollback_error)) => {
                    format!("{error}；恢复上一配置失败：{rollback_error}")
                }
                _ => error.clone(),
            });
        }
        emit_snapshot(&app, store);
        return Err(match rollback.as_ref() {
            Some(Err(rollback_error)) => {
                format!("{error}；恢复上一配置失败：{rollback_error}")
            }
            _ => error,
        });
    }

    emit_snapshot(&app, store);
    monitor_clash_runtime(&app, store, runtime, cancel);
    Ok(())
}

pub fn start_public_connection(
    app: AppHandle,
    store: &ConnectionStore,
    runtime: &core_runtime::CoreRuntime,
    route_id: Option<String>,
) -> Result<(), String> {
    if store.route_update_running.load(Ordering::SeqCst) {
        return Err("请先等待线路更新完成或取消更新".into());
    }
    let routes = default_public_routes();
    let explicit_route = route_id.is_some();
    let selected = route_id.and_then(|id| routes.iter().find(|route| route.id == id).cloned());
    if explicit_route && selected.is_none() {
        return Err("public route not found".to_string());
    }
    let previous_route = store
        .active_route
        .lock()
        .map_err(|_| "active route state unavailable")?
        .clone();
    let previous_selected = store
        .selected_route
        .lock()
        .map_err(|_| "route selection unavailable")?
        .clone();
    let switching = {
        let state = store.state.lock().map_err(|_| "连接状态不可用")?;
        if state.connecting {
            return Err("已有连接或测速任务正在执行".into());
        }
        if state.connected && state.mode != "auto" {
            return Err("其他模式正在连接，请先断开后再启动全自动模式".into());
        }
        state.connected && state.mode == "auto"
    };
    if switching {
        cancel_connection(&app, store, runtime)?;
    }
    {
        let mut state = store
            .state
            .lock()
            .map_err(|_| "connection state unavailable")?;
        state.mode = "auto".into();
        state.connected = false;
        state.connecting = true;
        state.stage = if switching {
            "switching".into()
        } else {
            "preparing".into()
        };
        state.core_id = None;
        state.display_name = selected.as_ref().map(|route| route.name.clone());
        state.error = None;
        state.exit_ip = None;
        state.country = None;
        state.download_bps = 0;
        state.upload_bps = 0;
        state.download_total = 0;
        state.upload_total = 0;
    }
    let cancel = Arc::new(AtomicBool::new(false));
    *store
        .cancel
        .lock()
        .map_err(|_| "connection control unavailable")? = Some(cancel.clone());
    emit_snapshot(&app, store);
    if switching {
        let _ = app.emit("connection-log", serde_json::json!({
            "level": "info",
            "message": selected.as_ref().map(|route| format!("正在切换到 {}", route.name)).unwrap_or_else(|| "正在切换到自动选择线路".into())
        }));
    }
    let state = store.state.clone();
    let cancel_slot = store.cancel.clone();
    let proxy = store.proxy.clone();
    let route_metrics = store.route_metrics.clone();
    let active_route = store.active_route.clone();
    let selected_route = store.selected_route.clone();
    let traffic_sample = store.traffic_sample.clone();
    let runtime = runtime.clone();
    std::thread::spawn(move || {
        let result = connect_auto_or_selected(
            &app,
            &state,
            &runtime,
            &proxy,
            &routes,
            selected.as_ref(),
            &cancel,
            &route_metrics,
            &active_route,
        );
        if result.is_ok() {
            let committed_selection = selected.as_ref().map(|route| route.id.clone());
            if let Ok(mut current) = selected_route.lock() {
                *current = committed_selection.clone();
            }
            let _ = app.emit("public-route-selection", committed_selection);
            monitor_connection(
                &app,
                &state,
                &runtime,
                &proxy,
                &active_route,
                &traffic_sample,
                &cancel,
                &routes,
                &route_metrics,
            );
        } else if let Err(error) = result {
            let _ = core_runtime::stop_all(&runtime);
            let _ = system_proxy::disable(&proxy);
            let rollback = if switching && !cancel.load(Ordering::Relaxed) {
                previous_route.as_ref().map(|route| {
                    connect_route(
                        &app,
                        &state,
                        &runtime,
                        &proxy,
                        route,
                        &cancel,
                        false,
                        &active_route,
                    )
                })
            } else {
                None
            };
            if matches!(rollback.as_ref(), Some(Ok(()))) {
                if let Ok(mut current) = selected_route.lock() {
                    *current = previous_selected.clone();
                }
                if let Ok(mut current) = state.lock() {
                    current.error = Some(format!("新线路连接失败，已恢复原线路：{error}"));
                }
                let _ = app.emit("public-route-selection", previous_selected);
                let _ = app.emit(
                    "connection-state",
                    state.lock().ok().map(|value| value.clone()),
                );
                monitor_connection(
                    &app,
                    &state,
                    &runtime,
                    &proxy,
                    &active_route,
                    &traffic_sample,
                    &cancel,
                    &routes,
                    &route_metrics,
                );
                if let Ok(mut slot) = cancel_slot.lock() {
                    if slot
                        .as_ref()
                        .is_some_and(|current| Arc::ptr_eq(current, &cancel))
                    {
                        *slot = None;
                    }
                }
                return;
            }
            if let Ok(mut route) = active_route.lock() {
                *route = None;
            }
            if let Ok(mut sample) = traffic_sample.lock() {
                *sample = None;
            }
            if let Ok(mut current) = state.lock() {
                current.connecting = false;
                current.connected = false;
                current.stage = if cancel.load(Ordering::Relaxed) {
                    "idle".into()
                } else {
                    "failed".into()
                };
                current.error = if cancel.load(Ordering::Relaxed) {
                    None
                } else {
                    Some(match rollback.as_ref() {
                        Some(Err(rollback_error)) => {
                            format!("{error}；恢复原线路失败：{rollback_error}")
                        }
                        _ => error,
                    })
                };
            }
            let _ = app.emit(
                "connection-state",
                state.lock().ok().map(|value| value.clone()),
            );
        }
        if let Ok(mut slot) = cancel_slot.lock() {
            if slot
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, &cancel))
            {
                *slot = None;
            }
        }
    });
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn monitor_connection(
    app: &AppHandle,
    state: &Arc<Mutex<AppConnectionState>>,
    runtime: &core_runtime::CoreRuntime,
    proxy: &system_proxy::ProxyState,
    active_route: &Arc<Mutex<Option<PublicRoute>>>,
    traffic_sample: &Arc<Mutex<Option<TrafficSample>>>,
    cancel: &Arc<AtomicBool>,
    routes: &[PublicRoute],
    route_metrics: &Arc<Mutex<HashMap<String, RouteMetric>>>,
) {
    let mut last_health_check = Instant::now();
    let mut health_failures = 0_u8;
    'monitor: loop {
        if cancel.load(Ordering::Relaxed) {
            return;
        }
        std::thread::sleep(Duration::from_secs(1));
        if cancel.load(Ordering::Relaxed) {
            return;
        }
        let core_id = state.lock().ok().and_then(|value| value.core_id.clone());
        let Some(core_id) = core_id else { return };
        let running = core_runtime::statuses(runtime)
            .map(|items| {
                items
                    .iter()
                    .any(|item| item.core_id == core_id && item.running)
            })
            .unwrap_or(false);
        let mut unhealthy = !running;
        if running && last_health_check.elapsed() >= Duration::from_secs(10) {
            last_health_check = Instant::now();
            let route = active_route.lock().ok().and_then(|value| value.clone());
            if let Some(route) = route {
                match proxy_request_latency(&route) {
                    Ok(_) => health_failures = 0,
                    Err(_) => {
                        health_failures = health_failures.saturating_add(1);
                        unhealthy = health_failures >= 3;
                    }
                }
            }
        }
        if !unhealthy {
            continue;
        }
        let failed_route = active_route.lock().ok().and_then(|route| route.clone());
        let _ = core_runtime::stop_all(runtime);
        let _ = system_proxy::disable(proxy);
        if let Ok(mut route) = active_route.lock() {
            *route = None;
        }
        if let Ok(mut sample) = traffic_sample.lock() {
            *sample = None;
        }
        if let Some(route) = failed_route.as_ref() {
            record_metric(
                route_metrics,
                &route.id,
                None,
                Some(if running {
                    "代理链路连续健康检查失败".into()
                } else {
                    "代理核心意外退出".into()
                }),
            );
        }
        let auto_failover = state
            .lock()
            .map(|value| value.auto_failover)
            .unwrap_or(false);
        if auto_failover && !cancel.load(Ordering::Relaxed) {
            if let Ok(mut current) = state.lock() {
                current.connected = false;
                current.connecting = true;
                current.stage = "failover".into();
                current.core_id = None;
                current.display_name = Some("线路故障，正在自动切换".into());
                current.download_bps = 0;
                current.upload_bps = 0;
                current.error = Some("当前线路异常，正在尝试其他公共线路".into());
            }
            let _ = app.emit(
                "connection-state",
                state.lock().ok().map(|value| value.clone()),
            );
            let _ = app.emit(
                "connection-log",
                serde_json::json!({
                    "level": "warning",
                    "message": if running { "当前公共线路链路不可用，开始自动切换" } else { "当前公共线路核心意外退出，开始自动切换" }
                }),
            );
            let candidates = ordered_candidates(
                routes,
                route_metrics,
                failed_route.as_ref().map(|route| route.id.as_str()),
            );
            for route in &candidates {
                if cancel.load(Ordering::Relaxed) {
                    return;
                }
                set_stage(
                    app,
                    state,
                    "failover",
                    Some(format!("正在切换 · {}", route.name)),
                );
                match connect_route(
                    app,
                    state,
                    runtime,
                    proxy,
                    route,
                    cancel,
                    false,
                    active_route,
                ) {
                    Ok(()) => {
                        let latency = state.lock().ok().and_then(|value| value.latency);
                        record_metric(route_metrics, &route.id, latency, None);
                        let _ = app.emit(
                            "connection-log",
                            serde_json::json!({
                                "level": "success",
                                "message": format!("已自动切换到 {}", route.name)
                            }),
                        );
                        continue 'monitor;
                    }
                    Err(error) => record_metric(route_metrics, &route.id, None, Some(error)),
                }
            }
        }
        if let Ok(mut current) = state.lock() {
            current.connected = false;
            current.connecting = false;
            current.stage = "failed".into();
            current.core_id = None;
            current.display_name = None;
            current.download_bps = 0;
            current.upload_bps = 0;
            current.error = Some(if auto_failover {
                "公共线路自动切换失败，系统代理已恢复".into()
            } else {
                "代理核心意外退出，系统代理已恢复".into()
            });
        }
        let _ = app.emit(
            "connection-state",
            state.lock().ok().map(|value| value.clone()),
        );
        return;
    }
}

fn auto_routing_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("data directory unavailable: {error}"))?;
    Ok(data_dir.join("auto-routing-settings.json"))
}

fn normalize_rule_target(input: &str) -> Result<String, String> {
    let mut value = input.trim().to_ascii_lowercase();
    if value.is_empty() {
        return Err("请输入要匹配的网站或 IP".into());
    }
    if let Some(rest) = value
        .strip_prefix("http://")
        .or_else(|| value.strip_prefix("https://"))
    {
        value = rest.into();
    }
    if let Some((host, _)) = value.split_once('/') {
        value = host.into();
    }
    if let Some((host, _)) = value.split_once('?') {
        value = host.into();
    }
    if value.starts_with("*.") {
        value = value.trim_start_matches("*.").into();
    }
    value = value.trim_matches('.').into();
    if value.is_empty()
        || value.contains('*')
        || value.contains(' ')
        || value.contains('\\')
        || value.contains('@')
    {
        return Err("规则格式无效，请输入 baidu.com、*.example.com 或 1.1.1.1".into());
    }
    Ok(value)
}

fn normalize_auto_routing_settings(
    settings: AutoRoutingSettings,
) -> Result<AutoRoutingSettings, String> {
    if !matches!(settings.mode.as_str(), "rule" | "global" | "direct") {
        return Err("不支持的全自动代理模式".into());
    }
    let mut rules = Vec::new();
    for (index, rule) in settings.rules.into_iter().enumerate() {
        if !matches!(rule.action.as_str(), "direct" | "proxy" | "block") {
            return Err("不支持的规则动作".into());
        }
        let target = normalize_rule_target(&rule.target)?;
        let id = if rule.id.trim().is_empty() {
            format!("rule-{}-{target}", index + 1)
        } else {
            rule.id.trim().to_string()
        };
        rules.push(AutoRoutingRule {
            id,
            target,
            action: rule.action,
            enabled: rule.enabled,
        });
    }
    Ok(AutoRoutingSettings {
        mode: settings.mode,
        rules,
    })
}

pub fn get_auto_routing_settings(app: &AppHandle) -> AutoRoutingSettings {
    let Ok(path) = auto_routing_settings_path(app) else {
        return AutoRoutingSettings::default();
    };
    let Ok(content) = fs::read_to_string(path) else {
        return AutoRoutingSettings::default();
    };
    let Ok(settings) = serde_json::from_str::<AutoRoutingSettings>(&content) else {
        return AutoRoutingSettings::default();
    };
    normalize_auto_routing_settings(settings).unwrap_or_default()
}

pub fn set_auto_routing_settings(
    app: &AppHandle,
    settings: AutoRoutingSettings,
) -> Result<AutoRoutingSettings, String> {
    let settings = normalize_auto_routing_settings(settings)?;
    let path = auto_routing_settings_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建自动规则目录失败：{error}"))?;
    }
    let content = serde_json::to_string_pretty(&settings).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| format!("保存自动规则失败：{error}"))?;
    Ok(settings)
}

pub fn set_auto_failover(
    app: &AppHandle,
    store: &ConnectionStore,
    enabled: bool,
) -> Result<(), String> {
    persist_connection_settings(app, enabled)?;
    store
        .state
        .lock()
        .map_err(|_| "connection state unavailable")?
        .auto_failover = enabled;
    emit_snapshot(app, store);
    let _ = app.emit("connection-log", serde_json::json!({
        "level": "info",
        "message": if enabled { "公共线路故障自动切换已开启" } else { "公共线路故障自动切换已关闭" }
    }));
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn connect_auto_or_selected(
    app: &AppHandle,
    state: &Arc<Mutex<AppConnectionState>>,
    runtime: &core_runtime::CoreRuntime,
    proxy: &system_proxy::ProxyState,
    routes: &[PublicRoute],
    selected: Option<&PublicRoute>,
    cancel: &Arc<AtomicBool>,
    route_metrics: &Arc<Mutex<HashMap<String, RouteMetric>>>,
    active_route: &Arc<Mutex<Option<PublicRoute>>>,
) -> Result<(), String> {
    if let Some(route) = selected {
        return connect_route(
            app,
            state,
            runtime,
            proxy,
            route,
            cancel,
            false,
            active_route,
        );
    }

    let candidates = ordered_candidates(routes, route_metrics, None);
    let total = candidates.len();
    let mut failures = Vec::new();
    for (index, route) in candidates.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            return Err("connection cancelled".into());
        }
        set_stage(
            app,
            state,
            "connecting",
            Some(format!("正在尝试 {}/{} · {}", index + 1, total, route.name)),
        );
        match connect_route(
            app,
            state,
            runtime,
            proxy,
            route,
            cancel,
            false,
            active_route,
        ) {
            Ok(()) => {
                let latency = state.lock().ok().and_then(|value| value.latency);
                record_metric(route_metrics, &route.id, latency, None);
                return Ok(());
            }
            Err(error) => {
                if cancel.load(Ordering::Relaxed) {
                    return Err("connection cancelled".into());
                }
                record_metric(route_metrics, &route.id, None, Some(error.clone()));
                failures.push(format!("{}：{error}", route.name));
            }
        }
    }
    Err(if failures.is_empty() {
        "没有可用的公共线路".into()
    } else {
        format!("没有可用的公共线路（已尝试 {} 条）", failures.len())
    })
}

fn ordered_candidates(
    routes: &[PublicRoute],
    route_metrics: &Arc<Mutex<HashMap<String, RouteMetric>>>,
    excluded_id: Option<&str>,
) -> Vec<PublicRoute> {
    let metrics = route_metrics
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default();
    let mut candidates: Vec<_> = routes
        .iter()
        .filter(|route| excluded_id != Some(route.id.as_str()))
        .cloned()
        .collect();
    candidates.sort_by_key(|route| {
        let metric = metrics.get(&route.id);
        (
            metric.and_then(|value| value.error.as_ref()).is_some(),
            metric.and_then(|value| value.latency).is_none(),
            metric.and_then(|value| value.latency).unwrap_or(u32::MAX),
            std::cmp::Reverse(metric.and_then(|value| value.last_success_at).unwrap_or(0)),
        )
    });
    candidates
}

fn record_metric(
    metrics: &Arc<Mutex<HashMap<String, RouteMetric>>>,
    route_id: &str,
    latency: Option<u32>,
    error: Option<String>,
) {
    if let Ok(mut values) = metrics.lock() {
        let metric = values.entry(route_id.to_string()).or_default();
        if let Some(value) = latency {
            metric.latency = Some(value);
            metric.error = None;
            metric.last_success_at = Some(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|value| value.as_secs())
                    .unwrap_or_default(),
            );
        } else {
            metric.error = error;
            metric.latency = None;
        }
    }
    persist_route_metrics(metrics);
}

fn record_route_country(
    metrics: &Arc<Mutex<HashMap<String, RouteMetric>>>,
    route_id: &str,
    country: Option<String>,
) {
    if let Some(country) = country {
        if let Ok(mut values) = metrics.lock() {
            values.entry(route_id.to_string()).or_default().country = Some(country);
        }
        persist_route_metrics(metrics);
    }
}

fn emit_probe_progress(
    app: &AppHandle,
    state: &Arc<Mutex<AppConnectionState>>,
    completed: usize,
    total: usize,
    route: &PublicRoute,
    latency: Option<u32>,
    error: Option<String>,
) {
    let _ = app.emit(
        "public-route-progress",
        serde_json::json!({
            "completed": completed,
            "total": total,
            "routeId": route.id,
            "routeName": route.name,
            "latency": latency,
            "error": error,
        }),
    );
    if let Ok(mut current) = state.lock() {
        current.display_name = Some(format!("正在测速 {completed}/{total} · {}", route.name));
        current.latency = latency;
    }
    let _ = app.emit(
        "connection-state",
        state.lock().ok().map(|value| value.clone()),
    );
}

fn set_stage(
    app: &AppHandle,
    state: &Arc<Mutex<AppConnectionState>>,
    stage: &str,
    display_name: Option<String>,
) {
    if let Ok(mut current) = state.lock() {
        current.stage = stage.into();
        if display_name.is_some() {
            current.display_name = display_name;
        }
    }
    let _ = app.emit(
        "connection-state",
        state.lock().ok().map(|value| value.clone()),
    );
}

fn probe_route(
    app: &AppHandle,
    runtime: &core_runtime::CoreRuntime,
    route: &PublicRoute,
    test_port: u16,
    cancel: &Arc<AtomicBool>,
) -> Result<(u32, Option<String>), String> {
    prepare_route(app, route)?;
    core_runtime::stop_all(runtime)?;
    let original_config = runtime_config(app, route)?;
    let (config, temporary) = probe_config_for_port(route, &original_config, test_port)?;
    core_runtime::start(app, runtime, route.core_id.clone(), config.clone())?;
    let result = (|| {
        if !wait_for_port(test_port, Duration::from_secs(8)) {
            return Err("核心未能启动代理端口（节点握手失败或配置无效）".into());
        }
        if cancel.load(Ordering::Relaxed) {
            return Err("connection cancelled".into());
        }
        let latency = proxy_request_latency_on_port(route, test_port)?;
        let country = query_exit_info_on_port(route, test_port)
            .ok()
            .map(|value| value.country);
        Ok((latency, country))
    })();
    let cleanup = core_runtime::stop_all(runtime);
    if temporary {
        let _ = fs::remove_file(config);
    }
    match (result, cleanup) {
        (Err(error), _) => Err(error),
        (Ok(_), Err(error)) => Err(error),
        (Ok(latency), Ok(())) => Ok(latency),
    }
}

fn probe_config_for_port(
    route: &PublicRoute,
    config: &str,
    test_port: u16,
) -> Result<(String, bool), String> {
    if test_port == proxy_port(route) {
        return Ok((config.to_string(), false));
    }
    let data = fs::read(config).map_err(|error| format!("测速配置读取失败：{error}"))?;
    let mut value: serde_json::Value =
        serde_json::from_slice(&data).map_err(|error| format!("测速配置解析失败：{error}"))?;
    match route.core_id.as_str() {
        "xray" => {
            let inbounds = value["inbounds"]
                .as_array_mut()
                .ok_or_else(|| "Xray 测速配置缺少入站".to_string())?;
            for inbound in inbounds {
                match inbound["protocol"].as_str() {
                    Some("socks") => inbound["port"] = test_port.into(),
                    Some("http") => inbound["port"] = (test_port + 1000).into(),
                    _ => {}
                }
            }
        }
        "sing-box" => value["inbounds"][0]["listen_port"] = test_port.into(),
        "hysteria" | "hysteria2" => {
            value["socks5"]["listen"] = format!("127.0.0.1:{test_port}").into()
        }
        "naiveproxy" => value["listen"] = format!("socks://127.0.0.1:{test_port}").into(),
        "juicity" => value["listen"] = format!("127.0.0.1:{test_port}").into(),
        other => return Err(format!("{other} 不支持动态测速端口")),
    }
    let path = std::path::Path::new(config).with_file_name(format!("probe-{test_port}.json"));
    let content =
        serde_json::to_vec_pretty(&value).map_err(|error| format!("测速配置生成失败：{error}"))?;
    fs::write(&path, content).map_err(|error| format!("测速配置写入失败：{error}"))?;
    Ok((path.to_string_lossy().into_owned(), true))
}

#[allow(clippy::too_many_arguments)]
fn connect_route(
    app: &AppHandle,
    state: &Arc<Mutex<AppConnectionState>>,
    runtime: &core_runtime::CoreRuntime,
    proxy: &system_proxy::ProxyState,
    route: &PublicRoute,
    cancel: &Arc<AtomicBool>,
    already_prepared: bool,
    active_route: &Arc<Mutex<Option<PublicRoute>>>,
) -> Result<(), String> {
    if cancel.load(Ordering::Relaxed) {
        return Err("connection cancelled".into());
    }
    let resource = paths::resource_file(app, &route.config_path)?;
    if !resource.is_file() {
        return Err("route configuration is missing".into());
    }
    if !already_prepared {
        prepare_route(app, route)?;
    }
    let config = runtime_config(app, route)?;
    if let Ok(mut current) = state.lock() {
        current.stage = "connecting".into();
        current.display_name = Some(route.name.clone());
        current.core_id = Some(route.core_id.clone());
    }
    if let Ok(mut current) = active_route.lock() {
        *current = Some(route.clone());
    }
    let _ = app.emit(
        "connection-state",
        state.lock().ok().map(|value| value.clone()),
    );
    if cancel.load(Ordering::Relaxed) {
        return Err("connection cancelled".into());
    }
    core_runtime::stop_all(runtime)?;
    let started = core_runtime::start(app, runtime, route.core_id.clone(), config)?;
    let port = proxy_port(route);
    if !wait_for_port(port, Duration::from_secs(8)) {
        return Err("core started but local proxy port is not ready".into());
    }
    if cancel.load(Ordering::Relaxed) {
        return Err("connection cancelled".into());
    }
    let verified_latency = proxy_request_latency(route)?;
    system_proxy::enable(proxy, port, route.core_id != "mihomo", true)?;
    let mut display_name = route.name.clone();
    if let Ok(exit) = query_exit_info(route) {
        let country_name = exit.country.split(" · ").next().unwrap_or(&exit.country);
        display_name = format!("{country_name} · {}", route.protocol_label);
        if let Ok(mut current) = state.lock() {
            current.exit_ip = Some(exit.ip);
            current.country = Some(exit.country);
        }
    }
    if let Ok(mut current) = state.lock() {
        current.connecting = false;
        current.connected = true;
        current.stage = "connected".into();
        current.core_id = Some(started.core_id);
        current.display_name = Some(display_name);
        current.latency = Some(verified_latency);
        current.error = None;
    }
    let _ = app.emit(
        "connection-state",
        state.lock().ok().map(|value| value.clone()),
    );
    Ok(())
}

struct ExitInfo {
    ip: String,
    country: String,
}

fn query_exit_info(route: &PublicRoute) -> Result<ExitInfo, String> {
    query_exit_info_on_port(route, proxy_port(route))
}

fn query_exit_info_on_port(route: &PublicRoute, port: u16) -> Result<ExitInfo, String> {
    let proxy = if route.core_id == "mihomo" {
        format!("http://127.0.0.1:{port}")
    } else {
        format!("socks5h://127.0.0.1:{port}")
    };
    if let Ok(value) = proxy_json_request(&proxy, "https://my.ippure.com/v1/info", 8) {
        if let Ok(value) = serde_json::from_value::<ExitInfoResponse>(value) {
            if let Some(ip) = value.ip {
                let country =
                    country_name_zh(value.country_code.as_deref(), value.country.as_deref());
                let country = match value.city {
                    Some(city) if !city.is_empty() => format!("{country} · {city}"),
                    _ => country,
                };
                if country != "未知地区" {
                    return Ok(ExitInfo { ip, country });
                }
            }
        }
    }
    for url in ["https://api.country.is/", "https://ipwho.is/"] {
        if let Ok(value) = proxy_json_request(&proxy, url, 5) {
            let ip = value
                .get("ip")
                .and_then(|value| value.as_str())
                .unwrap_or_default();
            let code = value
                .get("country")
                .filter(|value| value.as_str().is_some_and(|value| value.len() == 2))
                .or_else(|| value.get("country_code"))
                .and_then(|value| value.as_str());
            let fallback = value
                .get("country")
                .and_then(|value| value.as_str())
                .filter(|value| value.len() > 2);
            let country = country_name_zh(code, fallback);
            if !ip.is_empty() && country != "未知地区" {
                return Ok(ExitInfo {
                    ip: ip.to_string(),
                    country,
                });
            }
        }
    }
    Err("出口国家查询失败".into())
}

fn proxy_json_request(
    proxy: &str,
    url: &str,
    max_time_seconds: u32,
) -> Result<serde_json::Value, String> {
    let output = hidden_command("curl.exe")
        .args([
            "-fsS",
            "--connect-timeout",
            "3",
            "--max-time",
            &max_time_seconds.to_string(),
            "--ssl-no-revoke",
            "--proxy",
            proxy,
            "-H",
            "Accept: application/json",
            url,
        ])
        .output()
        .map_err(|error| format!("出口信息请求失败：{error}"))?;
    if !output.status.success() {
        return Err("出口信息请求失败".into());
    }
    serde_json::from_slice(&output.stdout).map_err(|error| format!("出口信息格式错误：{error}"))
}

fn proxy_request_latency(route: &PublicRoute) -> Result<u32, String> {
    proxy_request_latency_on_port(route, proxy_port(route))
}

fn proxy_request_latency_on_port(route: &PublicRoute, port: u16) -> Result<u32, String> {
    let settings = current_speed_test_settings();
    let connect_timeout = settings.timeout_seconds.min(5).to_string();
    let max_time = settings.timeout_seconds.to_string();
    let proxy = if route.core_id == "mihomo" {
        format!("http://127.0.0.1:{port}")
    } else {
        format!("socks5h://127.0.0.1:{port}")
    };
    let output = hidden_command("curl.exe")
        .args([
            "-sS",
            "-o",
            "NUL",
            "-w",
            "%{time_total}",
            "--connect-timeout",
            &connect_timeout,
            "--max-time",
            &max_time,
            "--ssl-no-revoke",
            "--proxy",
            &proxy,
            &settings.url,
        ])
        .output()
        .map_err(|error| format!("无法启动线路探测：{error}"))?;
    if !output.status.success() {
        return Err("线路代理请求失败或已超时".into());
    }
    let seconds: f32 = String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse()
        .map_err(|_| "线路探测返回了无效延迟".to_string())?;
    Ok((seconds * 1000.0).round() as u32)
}

fn country_name_zh(code: Option<&str>, fallback: Option<&str>) -> String {
    let name = match code.unwrap_or_default().to_uppercase().as_str() {
        "CN" => "中国",
        "HK" => "中国香港",
        "MO" => "中国澳门",
        "TW" => "中国台湾",
        "JP" => "日本",
        "KR" => "韩国",
        "SG" => "新加坡",
        "US" => "美国",
        "CA" => "加拿大",
        "GB" => "英国",
        "DE" => "德国",
        "FR" => "法国",
        "NL" => "荷兰",
        "RU" => "俄罗斯",
        "AU" => "澳大利亚",
        "IN" => "印度",
        "MY" => "马来西亚",
        "TH" => "泰国",
        "VN" => "越南",
        "PH" => "菲律宾",
        "ID" => "印度尼西亚",
        "TR" => "土耳其",
        "SE" => "瑞典",
        "CH" => "瑞士",
        "FI" => "芬兰",
        "NO" => "挪威",
        "DK" => "丹麦",
        "PL" => "波兰",
        "ES" => "西班牙",
        "IT" => "意大利",
        "BR" => "巴西",
        "AR" => "阿根廷",
        _ => fallback.unwrap_or("未知地区"),
    };
    name.to_string()
}

fn prepare_route(app: &AppHandle, route: &PublicRoute) -> Result<(), String> {
    let resource = paths::resource_file(app, &route.config_path)?;
    if !resource.is_file() {
        return Err("route configuration is missing".into());
    }
    let data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("data directory unavailable: {error}"))?;
    let cache_dir = data.join("routes").join(route.id.replace(':', "_"));
    fs::create_dir_all(&cache_dir)
        .map_err(|error| format!("route cache directory failed: {error}"))?;
    let config = cache_dir.join(if route.config_format == "yaml" {
        "config.yaml"
    } else {
        "config.json"
    });
    if !config.is_file() {
        fs::copy(&resource, &config).map_err(|error| format!("route cache failed: {error}"))?;
    }
    if route.core_id == "mihomo" {
        ensure_mihomo_controller(&config)?;
    } else if route.core_id == "xray" {
        ensure_xray_socks_inbound(&config)?;
    }
    Ok(())
}

fn ensure_xray_socks_inbound(config: &std::path::Path) -> Result<(), String> {
    let data = fs::read(config).map_err(|error| format!("Xray 配置读取失败：{error}"))?;
    let mut value: serde_json::Value =
        serde_json::from_slice(&data).map_err(|error| format!("Xray 配置解析失败：{error}"))?;
    let mut changed = false;
    if let Some(inbounds) = value["inbounds"].as_array_mut() {
        for inbound in inbounds {
            if inbound["protocol"].as_str() == Some("mixed") {
                inbound["protocol"] = "socks".into();
                changed = true;
            }
        }
    }
    if changed {
        let content = serde_json::to_vec_pretty(&value)
            .map_err(|error| format!("Xray 配置生成失败：{error}"))?;
        fs::write(config, content).map_err(|error| format!("Xray 配置修复失败：{error}"))?;
    }
    Ok(())
}

fn ensure_mihomo_controller(config: &std::path::Path) -> Result<(), String> {
    let content =
        fs::read_to_string(config).map_err(|error| format!("mihomo 配置读取失败：{error}"))?;
    let lines: Vec<&str> = content.lines().collect();
    let document_starts: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter_map(|(index, line)| line.starts_with("secret:").then_some(index))
        .collect();
    // Some public sources occasionally concatenate two complete YAML documents
    // without a `---` separator. Mihomo rejects every duplicated top-level key.
    // The last document is the newest one, so discard the stale prefix.
    let start = if document_starts.len() > 1 {
        *document_starts.last().unwrap_or(&0)
    } else {
        0
    };
    let mut normalized = Vec::new();
    let mut mixed_port_added = false;
    let mut controller_added = false;
    for line in &lines[start..] {
        let trimmed = line.trim_start();
        if trimmed.starts_with("mixed-port:") {
            if !mixed_port_added {
                normalized.push("mixed-port: 7890".to_string());
                mixed_port_added = true;
            }
            continue;
        }
        if trimmed.starts_with("external-controller:") {
            if !controller_added {
                normalized.push("external-controller: 127.0.0.1:9090".to_string());
                controller_added = true;
            }
            continue;
        }
        normalized.push((*line).to_string());
    }
    if !mixed_port_added {
        normalized.insert(0, "mixed-port: 7890".to_string());
    }
    if !controller_added {
        normalized.push("external-controller: 127.0.0.1:9090".to_string());
    }
    fs::write(config, format!("{}\n", normalized.join("\n")))
        .map_err(|error| format!("mihomo 控制接口配置失败：{error}"))?;
    Ok(())
}

fn cached_config(app: &AppHandle, route: &PublicRoute) -> Result<String, String> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("data directory unavailable: {error}"))?;
    let config = data.join("routes").join(route.id.replace(':', "_")).join(
        if route.config_format == "yaml" {
            "config.yaml"
        } else {
            "config.json"
        },
    );
    if config.is_file() {
        Ok(config.to_string_lossy().into_owned())
    } else {
        Err("route cache is missing".into())
    }
}

fn rule_outbound(action: &str) -> &str {
    match action {
        "direct" => "direct",
        "block" => "block",
        _ => "proxy",
    }
}

fn mihomo_rule_target(target: &str) -> String {
    if target.parse::<IpAddr>().is_ok() || target.contains('/') {
        format!("IP-CIDR,{target},")
    } else {
        format!("DOMAIN-SUFFIX,{target},")
    }
}

fn inject_mihomo_routing(
    mut value: serde_yaml::Value,
    settings: &AutoRoutingSettings,
) -> Result<serde_yaml::Value, String> {
    use serde_yaml::{Mapping, Value};

    let proxy_name = value
        .get("proxy-groups")
        .and_then(Value::as_sequence)
        .and_then(|groups| groups.first())
        .and_then(|group| group.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("PROXY")
        .to_string();
    let final_policy = match settings.mode.as_str() {
        "direct" => "DIRECT".to_string(),
        _ => proxy_name.clone(),
    };
    let mut rules = Vec::new();
    if settings.mode == "rule" {
        for rule in settings.rules.iter().filter(|rule| rule.enabled) {
            let outbound = match rule.action.as_str() {
                "direct" => "DIRECT",
                "block" => "REJECT",
                _ => &proxy_name,
            };
            rules.push(Value::String(format!(
                "{}{outbound}",
                mihomo_rule_target(&rule.target)
            )));
        }
        rules.push(Value::String("IP-CIDR,10.0.0.0/8,DIRECT,no-resolve".into()));
        rules.push(Value::String(
            "IP-CIDR,172.16.0.0/12,DIRECT,no-resolve".into(),
        ));
        rules.push(Value::String(
            "IP-CIDR,192.168.0.0/16,DIRECT,no-resolve".into(),
        ));
        rules.push(Value::String("GEOIP,CN,DIRECT".into()));
    }
    rules.push(Value::String(format!("MATCH,{final_policy}")));
    if let Value::Mapping(map) = &mut value {
        map.insert(Value::String("rules".into()), Value::Sequence(rules));
        map.entry(Value::String("mode".into()))
            .or_insert(Value::String("rule".into()));
    } else {
        let mut map = Mapping::new();
        map.insert(Value::String("rules".into()), Value::Sequence(rules));
        value = Value::Mapping(map);
    }
    Ok(value)
}

fn xray_rule(target: &str, outbound: &str) -> serde_json::Value {
    if target.parse::<IpAddr>().is_ok() || target.contains('/') {
        serde_json::json!({ "type": "field", "ip": [target], "outboundTag": outbound })
    } else {
        serde_json::json!({ "type": "field", "domain": [format!("domain:{target}")], "outboundTag": outbound })
    }
}

fn singbox_rule(target: &str, outbound: &str) -> serde_json::Value {
    if target.parse::<IpAddr>().is_ok() || target.contains('/') {
        serde_json::json!({ "ip_cidr": [target], "outbound": outbound })
    } else {
        serde_json::json!({ "domain_suffix": [target], "outbound": outbound })
    }
}

fn inject_json_routing(
    route: &PublicRoute,
    mut value: serde_json::Value,
    settings: &AutoRoutingSettings,
) -> Result<serde_json::Value, String> {
    let final_outbound = if settings.mode == "direct" {
        "direct"
    } else {
        "proxy"
    };
    if route.core_id == "sing-box" {
        let mut rules = Vec::new();
        if settings.mode == "rule" {
            for rule in settings.rules.iter().filter(|rule| rule.enabled) {
                rules.push(singbox_rule(&rule.target, rule_outbound(&rule.action)));
            }
            rules.push(serde_json::json!({ "ip_is_private": true, "outbound": "direct" }));
            rules.push(serde_json::json!({ "domain_suffix": [".cn"], "outbound": "direct" }));
        }
        value["route"] = serde_json::json!({
            "rules": rules,
            "final": final_outbound,
            "auto_detect_interface": true
        });
        return Ok(value);
    }
    if route.core_id == "xray" {
        let mut rules = Vec::new();
        if settings.mode == "rule" {
            for rule in settings.rules.iter().filter(|rule| rule.enabled) {
                rules.push(xray_rule(&rule.target, rule_outbound(&rule.action)));
            }
            rules.push(serde_json::json!({ "type": "field", "ip": ["geoip:private"], "outboundTag": "direct" }));
            rules.push(serde_json::json!({ "type": "field", "domain": ["geosite:private"], "outboundTag": "direct" }));
            rules.push(serde_json::json!({ "type": "field", "domain": ["geosite:cn"], "outboundTag": "direct" }));
            rules.push(
                serde_json::json!({ "type": "field", "ip": ["geoip:cn"], "outboundTag": "direct" }),
            );
        } else if settings.mode == "direct" {
            rules.push(serde_json::json!({ "type": "field", "network": "tcp,udp", "outboundTag": "direct" }));
        }
        value["routing"] = serde_json::json!({
            "domainStrategy": "IPIfNonMatch",
            "rules": rules
        });
    }
    Ok(value)
}

fn runtime_config(app: &AppHandle, route: &PublicRoute) -> Result<String, String> {
    let source = cached_config(app, route)?;
    if !matches!(route.core_id.as_str(), "mihomo" | "xray" | "sing-box") {
        return Ok(source);
    }
    let settings = get_auto_routing_settings(app);
    let source_path = PathBuf::from(&source);
    let runtime = source_path.with_file_name(format!(
        "config.runtime.{}",
        if route.config_format == "yaml" {
            "yaml"
        } else {
            "json"
        }
    ));
    if route.config_format == "yaml" {
        let content = fs::read_to_string(&source_path)
            .map_err(|error| format!("读取线路配置失败：{error}"))?;
        let value = serde_yaml::from_str::<serde_yaml::Value>(&content)
            .map_err(|error| format!("解析线路 YAML 失败：{error}"))?;
        let value = inject_mihomo_routing(value, &settings)?;
        let content = serde_yaml::to_string(&value).map_err(|error| error.to_string())?;
        fs::write(&runtime, content).map_err(|error| format!("写入运行时规则失败：{error}"))?;
    } else {
        let data = fs::read(&source_path).map_err(|error| format!("读取线路配置失败：{error}"))?;
        let value = serde_json::from_slice::<serde_json::Value>(&data)
            .map_err(|error| format!("解析线路 JSON 失败：{error}"))?;
        let value = inject_json_routing(route, value, &settings)?;
        let content = serde_json::to_vec_pretty(&value).map_err(|error| error.to_string())?;
        fs::write(&runtime, content).map_err(|error| format!("写入运行时规则失败：{error}"))?;
    }
    Ok(runtime.to_string_lossy().into_owned())
}

fn proxy_port(route: &PublicRoute) -> u16 {
    match route.core_id.as_str() {
        "mihomo" => 7890,
        "mieru" => 3080,
        "shadowquic" => 4080,
        _ => 1080,
    }
}

pub fn cancel_connection(
    app: &AppHandle,
    store: &ConnectionStore,
    runtime: &core_runtime::CoreRuntime,
) -> Result<(), String> {
    if let Some(flag) = store
        .cancel
        .lock()
        .map_err(|_| "connection control unavailable")?
        .take()
    {
        flag.store(true, Ordering::Relaxed);
    }
    let _ = core_runtime::stop_all(runtime);
    let _ = system_proxy::disable(&store.proxy);
    if let Ok(mut route) = store.active_route.lock() {
        *route = None;
    }
    if let Ok(mut sample) = store.traffic_sample.lock() {
        *sample = None;
    }
    let mut state = store
        .state
        .lock()
        .map_err(|_| "connection state unavailable")?;
    state.connecting = false;
    state.connected = false;
    state.stage = "idle".into();
    state.core_id = None;
    state.display_name = None;
    state.error = None;
    state.download_bps = 0;
    state.upload_bps = 0;
    state.download_total = 0;
    state.upload_total = 0;
    state.tun_enabled = false;
    drop(state);
    emit_snapshot(app, store);
    Ok(())
}

pub fn refresh_exit_info(app: &AppHandle, store: &ConnectionStore) -> Result<(), String> {
    let route = store
        .active_route
        .lock()
        .map_err(|_| "active route state unavailable")?
        .clone()
        .ok_or_else(|| "当前没有活动线路".to_string())?;
    let exit = query_exit_info(&route)?;
    let mut state = store
        .state
        .lock()
        .map_err(|_| "connection state unavailable")?;
    state.exit_ip = Some(exit.ip);
    state.country = Some(exit.country);
    drop(state);
    emit_snapshot(app, store);
    Ok(())
}

pub fn get_traffic(app: &AppHandle, store: &ConnectionStore) -> Result<TrafficState, String> {
    let v2ray_active = store
        .state
        .lock()
        .map(|state| state.mode == "v2ray" && state.connected)
        .unwrap_or(false);
    let route = store
        .active_route
        .lock()
        .map_err(|_| "active route state unavailable")?
        .clone();
    let (download_total, upload_total) = if v2ray_active {
        store.proxy.traffic()
    } else if route
        .as_ref()
        .is_some_and(|route| route.core_id == "mihomo")
    {
        let route = route.as_ref().expect("mihomo route exists");
        let config = cached_config(app, route)?;
        let secret = fs::read_to_string(config)
            .ok()
            .and_then(|content| {
                content.lines().find_map(|line| {
                    line.strip_prefix("secret:")
                        .map(str::trim)
                        .map(|value| value.trim_matches(['\'', '"']).to_string())
                })
            })
            .unwrap_or_default();
        let mut command = hidden_command("curl.exe");
        command.args(["-fsS", "--connect-timeout", "1", "--max-time", "2"]);
        if !secret.is_empty() {
            command.args(["-H", &format!("Authorization: Bearer {secret}")]);
        }
        let output = command
            .arg("http://127.0.0.1:9090/connections")
            .output()
            .map_err(|error| format!("mihomo 流量接口请求失败：{error}"))?;
        if !output.status.success() {
            return Err("mihomo 流量接口不可用".into());
        }
        let value: serde_json::Value = serde_json::from_slice(&output.stdout)
            .map_err(|error| format!("mihomo 流量数据格式错误：{error}"))?;
        let mut download_total = 0_u64;
        let mut upload_total = 0_u64;
        if let Some(connections) = value.get("connections").and_then(|value| value.as_array()) {
            for connection in connections {
                download_total = download_total.saturating_add(
                    connection
                        .get("download")
                        .and_then(|value| value.as_u64())
                        .unwrap_or_default(),
                );
                upload_total = upload_total.saturating_add(
                    connection
                        .get("upload")
                        .and_then(|value| value.as_u64())
                        .unwrap_or_default(),
                );
            }
        }
        (download_total, upload_total)
    } else if route.is_some() {
        store.proxy.traffic()
    } else {
        return Err("当前没有活动线路".into());
    };
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or_default();
    let (download_bps, upload_bps) = {
        let mut previous = store
            .traffic_sample
            .lock()
            .map_err(|_| "traffic state unavailable")?;
        let rates = previous
            .as_ref()
            .map(|sample| {
                let elapsed = now_ms.saturating_sub(sample.at_ms).max(1) as u64;
                (
                    download_total
                        .saturating_sub(sample.download_total)
                        .saturating_mul(1000)
                        / elapsed,
                    upload_total
                        .saturating_sub(sample.upload_total)
                        .saturating_mul(1000)
                        / elapsed,
                )
            })
            .unwrap_or((0, 0));
        *previous = Some(TrafficSample {
            at_ms: now_ms,
            download_total,
            upload_total,
        });
        rates
    };
    let traffic = TrafficState {
        download_bps,
        upload_bps,
        download_total,
        upload_total,
    };
    if let Ok(mut state) = store.state.lock() {
        state.download_bps = traffic.download_bps;
        state.upload_bps = traffic.upload_bps;
        state.download_total = traffic.download_total;
        state.upload_total = traffic.upload_total;
    }
    emit_snapshot(app, store);
    Ok(traffic)
}

fn wait_for_port(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}
