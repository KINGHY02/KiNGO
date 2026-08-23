use crate::{
    clash_controller, clash_profiles, core_runtime, geo_rules, paths,
    process_utils::hidden_command, system_proxy,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    fs,
    net::TcpStream,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex, OnceLock,
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
    #[serde(default)]
    pub source_type: Option<String>,
    #[serde(default)]
    pub node_id: Option<String>,
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
    pub success_rate: Option<u8>,
    pub jitter: Option<u32>,
    pub quality: String,
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
    pub active_proxy_port: Arc<Mutex<Option<u16>>>,
    pub traffic_sample: Arc<Mutex<Option<TrafficSample>>>,
    pub route_update_running: Arc<AtomicBool>,
    pub route_update_cancel: Arc<AtomicBool>,
    pub route_update_progress: Arc<Mutex<Option<RouteUpdateProgress>>>,
    pub routing_apply_in_progress: Arc<AtomicBool>,
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
    #[serde(default)]
    pub latency_samples: Vec<u32>,
    #[serde(default)]
    pub recent_results: Vec<bool>,
    #[serde(default)]
    pub consecutive_failures: u8,
    #[serde(default)]
    pub last_failure_at: Option<u64>,
}

#[derive(Default, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionSettings {
    #[serde(default)]
    auto_failover: bool,
    #[serde(default)]
    tun_enabled: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoRoutingRule {
    pub id: String,
    pub target: String,
    pub action: String,
    pub enabled: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoRoutingSettings {
    pub mode: String,
    pub rules: Vec<AutoRoutingRule>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoRoutingApplyResult {
    pub settings: AutoRoutingSettings,
    pub applied: bool,
    pub restarted: bool,
    pub message: String,
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
    #[serde(default = "default_speed_test_fallback_urls")]
    pub fallback_urls: Vec<String>,
    #[serde(default = "default_download_test_url")]
    pub download_url: String,
    pub timeout_seconds: u64,
    pub concurrency: usize,
}

fn default_speed_test_fallback_urls() -> Vec<String> {
    vec![
        "http://cp.cloudflare.com/generate_204".into(),
        "http://www.msftconnecttest.com/connecttest.txt".into(),
    ]
}

fn default_download_test_url() -> String {
    "https://speed.cloudflare.com/__down?bytes=10000000".into()
}

impl SpeedTestSettings {
    pub(crate) fn latency_urls(&self) -> Vec<String> {
        let mut urls = Vec::with_capacity(self.fallback_urls.len() + 1);
        for url in std::iter::once(&self.url).chain(self.fallback_urls.iter()) {
            let url = url.trim();
            if !url.is_empty() && !urls.iter().any(|current| current == url) {
                urls.push(url.to_string());
            }
        }
        urls
    }
}

impl Default for SpeedTestSettings {
    fn default() -> Self {
        Self {
            url: "https://www.gstatic.com/generate_204".into(),
            fallback_urls: default_speed_test_fallback_urls(),
            download_url: default_download_test_url(),
            timeout_seconds: 4,
            concurrency: 6,
        }
    }
}

static SPEED_TEST_SETTINGS: OnceLock<Mutex<SpeedTestSettings>> = OnceLock::new();

fn speed_test_settings() -> &'static Mutex<SpeedTestSettings> {
    SPEED_TEST_SETTINGS.get_or_init(|| Mutex::new(SpeedTestSettings::default()))
}

pub(crate) fn current_speed_test_settings() -> SpeedTestSettings {
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
                source_type: None,
                node_id: None,
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
            active_proxy_port: Arc::new(Mutex::new(None)),
            traffic_sample: Arc::new(Mutex::new(None)),
            route_update_running: Arc::new(AtomicBool::new(false)),
            route_update_cancel: Arc::new(AtomicBool::new(false)),
            route_update_progress: Arc::new(Mutex::new(None)),
            routing_apply_in_progress: Arc::new(AtomicBool::new(false)),
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
        .map(|state| state.connecting)?;
    if connection_busy {
        return Err("请先等待连接、切换或测速任务完成再更新线路".into());
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
    let download_proxy = store
        .active_route
        .lock()
        .ok()
        .and_then(|route| route.clone())
        .map(|route| {
            let port = store
                .active_proxy_port
                .lock()
                .ok()
                .and_then(|value| *value)
                .unwrap_or_else(|| proxy_port(&route));
            if route.core_id == "mihomo" {
                format!("http://127.0.0.1:{port}")
            } else {
                format!("socks5h://127.0.0.1:{port}")
            }
        });
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
            let result = download_and_install_route(&app, route, download_proxy.as_deref());
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

fn download_and_install_route(
    app: &AppHandle,
    route: &PublicRoute,
    download_proxy: Option<&str>,
) -> Result<(), String> {
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
        match download_route(&url, download_proxy).and_then(|bytes| {
            validate_route_config(route, &bytes)?;
            install_route_config(app, route, &bytes)
        }) {
            Ok(()) => return Ok(()),
            Err(error) => failures.push(error),
        }
    }
    Err(failures.join("；备用源："))
}

fn download_route(url: &str, download_proxy: Option<&str>) -> Result<Vec<u8>, String> {
    let mut command = hidden_command("curl.exe");
    command.args([
        "-fsSL",
        "--ssl-no-revoke",
        "--connect-timeout",
        "8",
        "--max-time",
        "30",
    ]);
    if let Some(proxy) = download_proxy {
        command.args(["--proxy", proxy]);
    }
    let output = command
        .arg(url)
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
        ensure_mihomo_controller(&target, 7890, 9090)?;
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
            success_rate: None,
            jitter: None,
            quality: "待测试".into(),
        })
        .collect()
}

fn metric_median(samples: &[u32]) -> Option<u32> {
    if samples.is_empty() {
        return None;
    }
    let mut values = samples.to_vec();
    values.sort_unstable();
    let middle = values.len() / 2;
    Some(if values.len().is_multiple_of(2) {
        ((values[middle - 1] as u64 + values[middle] as u64) / 2) as u32
    } else {
        values[middle]
    })
}

fn metric_jitter(metric: &RouteMetric) -> Option<u32> {
    let median = metric_median(&metric.latency_samples)?;
    let deviation = metric
        .latency_samples
        .iter()
        .map(|value| value.abs_diff(median) as u64)
        .sum::<u64>()
        / metric.latency_samples.len() as u64;
    Some(deviation as u32)
}

fn metric_success_rate(metric: &RouteMetric) -> Option<u8> {
    if metric.recent_results.is_empty() {
        return None;
    }
    let successes = metric.recent_results.iter().filter(|value| **value).count();
    Some(((successes * 100) / metric.recent_results.len()) as u8)
}

fn metric_quality(metric: &RouteMetric) -> &'static str {
    if metric.consecutive_failures >= 2 {
        return "暂不可用";
    }
    if metric.recent_results.len() < 3 || metric.latency_samples.len() < 3 {
        return if metric.last_success_at.is_some() {
            "可用"
        } else {
            "待测试"
        };
    }
    let Some(success_rate) = metric_success_rate(metric) else {
        return "待测试";
    };
    let jitter = metric_jitter(metric).unwrap_or_default();
    if success_rate >= 90 && jitter <= 80 {
        "稳定"
    } else if success_rate >= 70 && jitter <= 180 {
        "一般"
    } else {
        "波动"
    }
}

fn current_unix_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default()
}

fn metric_candidate_score(metric: Option<&RouteMetric>) -> i64 {
    let Some(metric) = metric else {
        return 4_000;
    };
    let latency = metric.latency.unwrap_or(2_500) as i64;
    let jitter = metric_jitter(metric).unwrap_or(500) as i64;
    let failure_rate = 100 - metric_success_rate(metric).unwrap_or(50) as i64;
    let mut score = latency + jitter * 2 + failure_rate * 8;
    score += metric.consecutive_failures as i64 * 600;
    if metric.error.is_some() {
        score += 2_000;
    }
    let cooldown_seconds = if metric.consecutive_failures >= 3 {
        30 * 60
    } else if metric.consecutive_failures >= 2 {
        10 * 60
    } else {
        0
    };
    if cooldown_seconds > 0
        && metric
            .last_failure_at
            .is_some_and(|at| current_unix_seconds().saturating_sub(at) < cooldown_seconds)
    {
        score += 10_000;
    }
    if metric
        .last_success_at
        .is_some_and(|at| current_unix_seconds().saturating_sub(at) < 30 * 60)
    {
        score -= 80;
    }
    score
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
                route.success_rate = metric_success_rate(metric);
                route.jitter = metric_jitter(metric);
                route.quality = metric_quality(metric).into();
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
        let groups: Vec<_> = groups.into_values().collect();
        let test_urls = settings.latency_urls();
        let mut succeeded = 0;
        for (attempt, test_url) in test_urls.iter().enumerate() {
            let attempt_results = Arc::new(Mutex::new(Vec::<(
                PublicRoute,
                Result<(u32, Option<String>), String>,
            )>::with_capacity(total)));
            let queue = Arc::new(Mutex::new(VecDeque::from_iter(groups.clone())));
            let worker_count = settings
                .concurrency
                .min(queue.lock().map(|value| value.len()).unwrap_or(1))
                .max(1);
            let mut workers = Vec::with_capacity(worker_count);
            for _ in 0..worker_count {
                let app = app.clone();
                let cancel = cancel.clone();
                let attempt_results = attempt_results.clone();
                let queue = queue.clone();
                let test_url = test_url.clone();
                workers.push(std::thread::spawn(move || {
                    let runtime = core_runtime::CoreRuntime::default();
                    while let Some(group) =
                        queue.lock().ok().and_then(|mut value| value.pop_front())
                    {
                        for (route, test_port) in group {
                            if cancel.load(Ordering::Relaxed) {
                                break;
                            }
                            let result =
                                probe_route(&app, &runtime, &route, test_port, &cancel, &test_url);
                            if cancel.load(Ordering::Relaxed) {
                                break;
                            }
                            if let Ok(mut values) = attempt_results.lock() {
                                values.push((route, result));
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
            let mut results = attempt_results
                .lock()
                .map(|mut values| std::mem::take(&mut *values))
                .unwrap_or_default();
            succeeded = results.iter().filter(|(_, result)| result.is_ok()).count();
            let is_final_attempt = succeeded > 0 || attempt + 1 >= test_urls.len();
            if !cancel.load(Ordering::Relaxed) && is_final_attempt {
                results.sort_by(|(left, _), (right, _)| left.id.cmp(&right.id));
                for (index, (route, result)) in results.into_iter().enumerate() {
                    match result {
                        Ok((latency, country)) => {
                            record_metric(&metrics, &route.id, Some(latency), None);
                            record_route_country(&metrics, &route.id, country);
                            emit_probe_progress(
                                &app,
                                &state,
                                index + 1,
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
                                index + 1,
                                total,
                                &route,
                                None,
                                Some(error),
                            );
                        }
                    }
                }
            }
            if cancel.load(Ordering::Relaxed) || is_final_attempt {
                break;
            }
            let next_url = &test_urls[attempt + 1];
            let _ = app.emit(
                "connection-log",
                serde_json::json!({
                    "level": "warning",
                    "message": format!("测速地址整体不可用，整批切换备用地址：{next_url}")
                }),
            );
        }
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
    let elevated = crate::process_utils::is_elevated();
    let tun_enabled = effective_tun_enabled(settings.tun_enabled, elevated);
    if settings.tun_enabled && !tun_enabled {
        let _ = persist_connection_settings(app, settings.auto_failover, false);
    }
    if let Ok(mut state) = store.state.lock() {
        state.auto_failover = settings.auto_failover;
        state.tun_enabled = tun_enabled;
    }
}

fn effective_tun_enabled(requested: bool, elevated: bool) -> bool {
    requested && elevated
}

fn get_connection_tun_enabled(app: &AppHandle) -> bool {
    let Ok(data_dir) = app.path().app_data_dir() else {
        return false;
    };
    fs::read_to_string(data_dir.join("connection-settings.json"))
        .ok()
        .and_then(|content| serde_json::from_str::<ConnectionSettings>(&content).ok())
        .is_some_and(|settings| settings.tun_enabled)
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

fn validate_speed_test_url(label: &str, url: &str) -> Result<(), String> {
    let url = url.trim();
    if url.is_empty()
        || url.len() > 2048
        || !(url.starts_with("https://") || url.starts_with("http://"))
    {
        return Err(format!("{label}必须是有效的 HTTP 或 HTTPS URL"));
    }
    Ok(())
}

fn validate_speed_test_settings(value: &SpeedTestSettings) -> Result<(), String> {
    validate_speed_test_url("延迟测试地址", &value.url)?;
    validate_speed_test_url("下载测速地址", &value.download_url)?;
    if value.fallback_urls.len() > 6 {
        return Err("备用延迟地址最多允许 6 个".into());
    }
    for url in &value.fallback_urls {
        validate_speed_test_url("备用延迟地址", url)?;
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
    value.download_url = value.download_url.trim().to_string();
    let primary_url = value.url.clone();
    let mut fallback_urls = Vec::with_capacity(value.fallback_urls.len());
    for url in value.fallback_urls {
        let url = url.trim().to_string();
        if url != primary_url && !fallback_urls.contains(&url) {
            fallback_urls.push(url);
        }
    }
    value.fallback_urls = fallback_urls;
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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedTestUrlResult {
    pub url: String,
    pub status: u16,
    pub latency_ms: u32,
}

pub fn test_speed_test_url(
    url: String,
    timeout_seconds: u64,
) -> Result<SpeedTestUrlResult, String> {
    validate_speed_test_url("测速地址", &url)?;
    if !(2..=30).contains(&timeout_seconds) {
        return Err("测速超时必须在 2 到 30 秒之间".into());
    }
    let timeout = timeout_seconds.to_string();
    let output = hidden_command("curl.exe")
        .args([
            "-sS",
            "-o",
            "NUL",
            "-w",
            "%{http_code}|%{time_total}",
            "--connect-timeout",
            &timeout,
            "--max-time",
            &timeout,
            "--range",
            "0-65535",
            "--ssl-no-revoke",
            url.trim(),
        ])
        .output()
        .map_err(|error| format!("无法启动测速地址检测：{error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "测速地址请求失败或超时".into()
        } else {
            format!("测速地址请求失败：{detail}")
        });
    }
    let result = String::from_utf8_lossy(&output.stdout);
    let (status, seconds) = result
        .trim()
        .split_once('|')
        .ok_or_else(|| "测速地址返回了无法识别的结果".to_string())?;
    let status = status
        .parse::<u16>()
        .map_err(|_| "测速地址没有返回有效的 HTTP 状态".to_string())?;
    if !(200..400).contains(&status) {
        return Err(format!("测速地址返回 HTTP {status}"));
    }
    let seconds = seconds
        .parse::<f32>()
        .map_err(|_| "测速地址没有返回有效耗时".to_string())?;
    Ok(SpeedTestUrlResult {
        url: url.trim().to_string(),
        status,
        latency_ms: (seconds * 1000.0).round() as u32,
    })
}

fn persist_connection_settings(
    app: &AppHandle,
    auto_failover: bool,
    tun_enabled: bool,
) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
    let content = serde_json::to_string_pretty(&ConnectionSettings {
        auto_failover,
        tun_enabled,
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
    core_id: String,
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
                    .any(|item| item.core_id == core_id && item.running)
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
            current.error = Some(format!("{core_id} 核心意外退出"));
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
        success_rate: None,
        jitter: None,
        quality: "待测试".into(),
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
            let restored_core = previous_state
                .core_id
                .clone()
                .unwrap_or_else(|| "mihomo".into());
            monitor_clash_runtime(&app, store, runtime, cancel, restored_core);
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
    monitor_clash_runtime(&app, store, runtime, cancel, clash_core);
    Ok(())
}

pub fn start_community_connection(
    app: AppHandle,
    store: &ConnectionStore,
    runtime: &core_runtime::CoreRuntime,
    node: crate::community_nodes::models::CommunityNodeCandidate,
) -> Result<(), String> {
    if store.routing_apply_in_progress.load(Ordering::Acquire) {
        return Err("正在切换线路或应用连接设置，请稍候".into());
    }
    // Public-node scans can run alongside another proxy client. Fixed Clash-style
    // ports (7890/9090) made every protocol fail whenever those ports were already
    // occupied, so reserve a fresh pair for each connection attempt.
    let (mixed_port, controller_port) = crate::community_nodes::probe::available_port_pair()?;
    let config = crate::community_nodes::store::write_connection_config(
        &app,
        &node,
        mixed_port,
        controller_port,
    )?;
    let route = PublicRoute {
        id: format!("community:{}", node.id),
        name: node.display_name.clone(),
        core_id: "mihomo".into(),
        slot: mixed_port as u32,
        protocol_label: node.protocol.to_uppercase(),
        config_format: "yaml".into(),
        config_path: config.to_string_lossy().into_owned(),
        downloaded: true,
        active: false,
        connection_state: "ready".into(),
        last_success_at: None,
        last_error: None,
        latency: node.latency_median_ms,
        country: node.country_name.clone(),
        success_rate: None,
        jitter: None,
        quality: "community".into(),
    };
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
        state.connected
    };
    let tun_enabled = store
        .state
        .lock()
        .map(|state| state.tun_enabled)
        .unwrap_or(false);
    if switching && !tun_enabled {
        return start_seamless_community_switch(
            app,
            store,
            runtime,
            node,
            route,
            previous_route.ok_or_else(|| "当前连接线路状态缺失".to_string())?,
        );
    }
    if switching {
        cancel_connection(&app, store, runtime)?;
    }
    if let Ok(mut port) = store.active_proxy_port.lock() {
        *port = None;
    }
    {
        let mut state = store.state.lock().map_err(|_| "连接状态不可用")?;
        state.mode = "auto".into();
        state.connected = false;
        state.connecting = true;
        state.stage = if switching {
            "switching".into()
        } else {
            "preparing".into()
        };
        state.core_id = None;
        state.source_type = Some("community".into());
        state.node_id = Some(node.id.clone());
        state.display_name = Some(node.display_name.clone());
        state.error = None;
        state.exit_ip = None;
        state.country = node.country_name.clone();
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

    let state = store.state.clone();
    let cancel_slot = store.cancel.clone();
    let proxy = store.proxy.clone();
    let route_metrics = store.route_metrics.clone();
    let active_route = store.active_route.clone();
    let active_proxy_port = store.active_proxy_port.clone();
    let selected_route = store.selected_route.clone();
    let traffic_sample = store.traffic_sample.clone();
    let routing_apply_in_progress = store.routing_apply_in_progress.clone();
    let runtime = runtime.clone();
    let routes = vec![route.clone()];
    std::thread::spawn(move || {
        let result = connect_route(
            &app,
            &state,
            &runtime,
            &proxy,
            &route,
            &cancel,
            false,
            &active_route,
        );
        if result.is_ok() {
            if let Ok(mut port) = active_proxy_port.lock() {
                *port = Some(proxy_port(&route));
            }
            if let Ok(mut selected) = selected_route.lock() {
                *selected = None;
            }
            if let Ok(mut current) = state.lock() {
                current.display_name = Some(node.display_name.clone());
                current.country = node.country_name.clone().or(current.country.clone());
                current.exit_ip = node.exit_ip.clone().or(current.exit_ip.clone());
                current.latency = node.latency_median_ms.or(current.latency);
            }
            let _ = app.emit("public-route-selection", Option::<String>::None);
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
                &routing_apply_in_progress,
                &routes,
                &route_metrics,
                &active_proxy_port,
            );
        } else if let Err(error) = result {
            let _ = core_runtime::stop_all(&runtime);
            let _ = system_proxy::disable(&proxy);
            let rollback = if switching && !cancel.load(Ordering::Relaxed) {
                previous_route.as_ref().map(|previous| {
                    connect_route(
                        &app,
                        &state,
                        &runtime,
                        &proxy,
                        previous,
                        &cancel,
                        false,
                        &active_route,
                    )
                })
            } else {
                None
            };
            if matches!(rollback.as_ref(), Some(Ok(()))) {
                if let Ok(mut selected) = selected_route.lock() {
                    *selected = previous_selected.clone();
                }
                if let Ok(mut current) = state.lock() {
                    current.error = Some(format!("公共节点连接失败，已恢复原线路：{error}"));
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
                    &routing_apply_in_progress,
                    &routes,
                    &route_metrics,
                    &active_proxy_port,
                );
            } else {
                if let Ok(mut active) = active_route.lock() {
                    *active = None;
                }
                if let Ok(mut current) = state.lock() {
                    current.connecting = false;
                    current.connected = false;
                    current.stage = "failed".into();
                    current.core_id = None;
                    current.error = Some(match rollback {
                        Some(Err(rollback_error)) => {
                            format!("公共节点连接失败：{error}；恢复原线路也失败：{rollback_error}")
                        }
                        _ => format!("公共节点连接失败：{error}"),
                    });
                }
                let _ = app.emit(
                    "connection-state",
                    state.lock().ok().map(|value| value.clone()),
                );
            }
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

fn start_seamless_community_switch(
    app: AppHandle,
    store: &ConnectionStore,
    runtime: &core_runtime::CoreRuntime,
    node: crate::community_nodes::models::CommunityNodeCandidate,
    route: PublicRoute,
    previous_route: PublicRoute,
) -> Result<(), String> {
    let cancel = Arc::new(AtomicBool::new(false));
    let previous_cancel = store
        .cancel
        .lock()
        .map_err(|_| "connection control unavailable")?
        .replace(cancel.clone());
    {
        let mut state = store.state.lock().map_err(|_| "连接状态不可用")?;
        state.connecting = true;
        state.stage = "switching".into();
        state.error = None;
    }
    emit_snapshot(&app, store);

    let state = store.state.clone();
    let cancel_slot = store.cancel.clone();
    let proxy = store.proxy.clone();
    let route_metrics = store.route_metrics.clone();
    let active_route = store.active_route.clone();
    let active_proxy_port = store.active_proxy_port.clone();
    let selected_route = store.selected_route.clone();
    let traffic_sample = store.traffic_sample.clone();
    let routing_apply_in_progress = store.routing_apply_in_progress.clone();
    let runtime = runtime.clone();
    std::thread::spawn(move || {
        let test_port = crate::community_nodes::probe::available_port_pair()
            .map(|ports| ports.0)
            .unwrap_or(16080);
        let prepared = prepare_candidate(&app, &route, test_port, &cancel, true);
        let candidate = match prepared {
            Ok(candidate) => candidate,
            Err(error) => {
                if let Ok(mut current) = state.lock() {
                    current.connecting = false;
                    current.stage = "connected".into();
                    current.error = Some(format!("新公共节点复核失败，原连接保持不变：{error}"));
                }
                if let Ok(mut slot) = cancel_slot.lock() {
                    if slot
                        .as_ref()
                        .is_some_and(|value| Arc::ptr_eq(value, &cancel))
                    {
                        *slot = previous_cancel;
                    }
                }
                let _ = app.emit(
                    "connection-state",
                    state.lock().ok().map(|value| value.clone()),
                );
                return;
            }
        };
        let verified_latency = candidate.latency;
        stop_prepared_candidate(&candidate);
        let _guard = match RoutingApplyGuard::acquire(&routing_apply_in_progress) {
            Ok(guard) => guard,
            Err(error) => {
                if let Ok(mut current) = state.lock() {
                    current.connecting = false;
                    current.stage = "connected".into();
                    current.error = Some(format!("公共节点切换未执行：{error}"));
                }
                if let Ok(mut slot) = cancel_slot.lock() {
                    if slot
                        .as_ref()
                        .is_some_and(|value| Arc::ptr_eq(value, &cancel))
                    {
                        *slot = previous_cancel;
                    }
                }
                let _ = app.emit(
                    "connection-state",
                    state.lock().ok().map(|value| value.clone()),
                );
                return;
            }
        };
        // Keep the existing connection monitor alive until the candidate has
        // passed verification and this switch owns the routing mutation lock.
        if let Some(previous) = previous_cancel.as_ref() {
            previous.store(true, Ordering::Relaxed);
        }
        let result = connect_route(
            &app,
            &state,
            &runtime,
            &proxy,
            &route,
            &cancel,
            false,
            &active_route,
        );
        drop(_guard);
        match result {
            Ok(()) => {
                if let Ok(mut port) = active_proxy_port.lock() {
                    *port = Some(proxy_port(&route));
                }
                if let Ok(mut selected) = selected_route.lock() {
                    *selected = None;
                }
                if let Ok(mut current) = state.lock() {
                    current.connected = true;
                    current.connecting = false;
                    current.stage = "connected".into();
                    current.display_name = Some(node.display_name.clone());
                    current.country = node.country_name.clone().or(current.country.clone());
                    current.exit_ip = node.exit_ip.clone().or(current.exit_ip.clone());
                    current.latency = node.latency_median_ms.or(Some(verified_latency));
                    current.error = None;
                }
                let _ = app.emit("public-route-selection", Option::<String>::None);
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
                    &routing_apply_in_progress,
                    std::slice::from_ref(&route),
                    &route_metrics,
                    &active_proxy_port,
                );
            }
            Err(error) => {
                let _ = core_runtime::stop_all(&runtime);
                let _ = system_proxy::disable(&proxy);
                let rollback = connect_route(
                    &app,
                    &state,
                    &runtime,
                    &proxy,
                    &previous_route,
                    &cancel,
                    false,
                    &active_route,
                );
                match rollback {
                    Ok(()) => {
                        if let Ok(mut port) = active_proxy_port.lock() {
                            *port = Some(proxy_port(&previous_route));
                        }
                        if let Ok(mut current) = state.lock() {
                            current.connecting = false;
                            current.stage = "connected".into();
                            current.error =
                                Some(format!("公共节点切换失败，已恢复原线路：{error}"));
                        }
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
                            &routing_apply_in_progress,
                            std::slice::from_ref(&previous_route),
                            &route_metrics,
                            &active_proxy_port,
                        );
                    }
                    Err(rollback_error) => {
                        if let Ok(mut current) = state.lock() {
                            current.connecting = false;
                            current.connected = false;
                            current.stage = "failed".into();
                            current.core_id = None;
                            current.system_proxy_enabled = false;
                            current.error = Some(format!(
                                "公共节点切换失败：{error}；恢复原线路也失败：{rollback_error}"
                            ));
                        }
                        let _ = app.emit(
                            "connection-state",
                            state.lock().ok().map(|value| value.clone()),
                        );
                    }
                }
            }
        }
        if let Ok(mut slot) = cancel_slot.lock() {
            if slot
                .as_ref()
                .is_some_and(|value| Arc::ptr_eq(value, &cancel))
            {
                *slot = None;
            }
        }
    });
    Ok(())
}

pub fn start_public_connection(
    app: AppHandle,
    store: &ConnectionStore,
    runtime: &core_runtime::CoreRuntime,
    route_id: Option<String>,
) -> Result<(), String> {
    if store.routing_apply_in_progress.load(Ordering::Acquire) {
        return Err("正在切换线路或应用连接设置，请稍候".into());
    }
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
            return Err("已有连接正在运行，请先断开后再重新连接".into());
        }
        state.connected && state.mode == "auto"
    };
    if switching {
        cancel_connection(&app, store, runtime)?;
    }
    if let Ok(mut port) = store.active_proxy_port.lock() {
        *port = None;
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
        state.source_type = None;
        state.node_id = None;
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
            "message": selected.as_ref().map(|route| format!("正在切换到 {}", route.name)).unwrap_or_else(|| "正在切换到推荐线路".into())
        }));
    }
    let state = store.state.clone();
    let cancel_slot = store.cancel.clone();
    let proxy = store.proxy.clone();
    let route_metrics = store.route_metrics.clone();
    let active_route = store.active_route.clone();
    let active_proxy_port = store.active_proxy_port.clone();
    let selected_route = store.selected_route.clone();
    let traffic_sample = store.traffic_sample.clone();
    let routing_apply_in_progress = store.routing_apply_in_progress.clone();
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
            &active_proxy_port,
        );
        if result.is_ok() {
            let committed_selection = selected.as_ref().map(|route| route.id.clone());
            if let Ok(mut current) = selected_route.lock() {
                *current = committed_selection.clone();
            }
            let _ = app.emit("public-route-selection", committed_selection);
            let tun_enabled = state.lock().map(|value| value.tun_enabled).unwrap_or(false);
            if selected.is_none() && !tun_enabled {
                spawn_background_route_optimizer(
                    app.clone(),
                    state.clone(),
                    runtime.clone(),
                    proxy.clone(),
                    routes.clone(),
                    route_metrics.clone(),
                    active_route.clone(),
                    active_proxy_port.clone(),
                    routing_apply_in_progress.clone(),
                    cancel.clone(),
                );
            }
            monitor_connection(
                &app,
                &state,
                &runtime,
                &proxy,
                &active_route,
                &traffic_sample,
                &cancel,
                &routing_apply_in_progress,
                &routes,
                &route_metrics,
                &active_proxy_port,
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
                    &routing_apply_in_progress,
                    &routes,
                    &route_metrics,
                    &active_proxy_port,
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
            if let Ok(mut port) = active_proxy_port.lock() {
                *port = None;
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
    routing_apply_in_progress: &Arc<AtomicBool>,
    routes: &[PublicRoute],
    route_metrics: &Arc<Mutex<HashMap<String, RouteMetric>>>,
    active_proxy_port: &Arc<Mutex<Option<u16>>>,
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
        if routing_apply_in_progress.load(Ordering::Acquire) {
            continue;
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
                let port = active_proxy_port
                    .lock()
                    .ok()
                    .and_then(|value| *value)
                    .unwrap_or_else(|| proxy_port(&route));
                match proxy_request_latency_on_port(&route, port) {
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
        let Ok(_recovery_guard) = RoutingApplyGuard::acquire(routing_apply_in_progress) else {
            continue;
        };
        let failed_route = active_route.lock().ok().and_then(|route| route.clone());
        let _ = core_runtime::stop_all(runtime);
        let _ = system_proxy::disable(proxy);
        if let Ok(mut route) = active_route.lock() {
            *route = None;
        }
        if let Ok(mut port) = active_proxy_port.lock() {
            *port = None;
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
            let tun_enabled = state.lock().map(|value| value.tun_enabled).unwrap_or(false);
            let candidates = ordered_candidates(
                routes,
                route_metrics,
                failed_route.as_ref().map(|route| route.id.as_str()),
                tun_enabled,
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
            current.source_type = None;
            current.node_id = None;
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

fn normalize_auto_routing_settings(
    settings: AutoRoutingSettings,
) -> Result<AutoRoutingSettings, String> {
    if !matches!(settings.mode.as_str(), "rule" | "global" | "direct") {
        return Err("不支持的代理模式".into());
    }
    Ok(AutoRoutingSettings {
        mode: if settings.mode == "global" {
            "global"
        } else {
            "rule"
        }
        .into(),
        rules: Vec::new(),
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
    let normalized = normalize_auto_routing_settings(settings.clone()).unwrap_or_default();
    if normalized != settings {
        let _ = persist_auto_routing_settings(app, &normalized);
    }
    normalized
}

fn persist_auto_routing_settings(
    app: &AppHandle,
    settings: &AutoRoutingSettings,
) -> Result<(), String> {
    let path = auto_routing_settings_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建自动规则目录失败：{error}"))?;
    }
    let content = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| format!("保存自动规则失败：{error}"))
}

fn bridge_routing_rules(settings: &AutoRoutingSettings) -> Vec<(String, String)> {
    let _ = settings;
    Vec::new()
}

fn update_bridge_routing(
    proxy: &system_proxy::ProxyState,
    settings: &AutoRoutingSettings,
) -> Result<(), String> {
    proxy.update_routing(&settings.mode, bridge_routing_rules(settings))
}

fn requires_core_routing_reload(route: &PublicRoute) -> bool {
    matches!(route.core_id.as_str(), "mihomo" | "xray" | "sing-box")
}

struct RoutingApplyGuard {
    flag: Arc<AtomicBool>,
}

impl RoutingApplyGuard {
    fn acquire(flag: &Arc<AtomicBool>) -> Result<Self, String> {
        flag.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "正在应用上一项分流设置，请稍候".to_string())?;
        Ok(Self { flag: flag.clone() })
    }
}

impl Drop for RoutingApplyGuard {
    fn drop(&mut self) {
        self.flag.store(false, Ordering::Release);
    }
}

pub fn set_auto_routing_settings(
    app: &AppHandle,
    store: &ConnectionStore,
    runtime: &core_runtime::CoreRuntime,
    settings: AutoRoutingSettings,
) -> Result<AutoRoutingApplyResult, String> {
    let settings = normalize_auto_routing_settings(settings)?;
    let previous = get_auto_routing_settings(app);
    let current = snapshot(store);
    if current.mode == "auto" && current.connecting {
        return Err("正在连接或测速，请完成后再修改分流设置".into());
    }
    let active_route = if current.mode == "auto" && current.connected {
        Some(
            store
                .active_route
                .lock()
                .map_err(|_| "活动线路状态不可用")?
                .clone()
                .ok_or_else(|| "当前连接缺少活动线路，无法应用分流设置".to_string())?,
        )
    } else {
        None
    };
    let requires_reload = active_route
        .as_ref()
        .is_some_and(requires_core_routing_reload);
    let _apply_guard = if active_route.is_some() {
        Some(RoutingApplyGuard::acquire(
            &store.routing_apply_in_progress,
        )?)
    } else {
        None
    };

    if settings == previous {
        return Ok(AutoRoutingApplyResult {
            settings,
            applied: active_route.is_some(),
            restarted: false,
            message: if active_route.is_some() {
                "分流设置未变化，当前连接已在使用".into()
            } else {
                "分流设置未变化".into()
            },
        });
    }

    let reload_cancel = if requires_reload {
        Some(
            store
                .cancel
                .lock()
                .map_err(|_| "连接控制状态不可用")?
                .as_ref()
                .cloned()
                .ok_or_else(|| "当前连接监控状态不可用，无法自动重载".to_string())?,
        )
    } else {
        None
    };

    persist_auto_routing_settings(app, &settings)?;
    if let Some(route) = active_route.as_ref() {
        if route.core_id != "mihomo" {
            if let Err(error) = update_bridge_routing(&store.proxy, &settings) {
                let rollback = persist_auto_routing_settings(app, &previous);
                return Err(match rollback {
                    Ok(()) => format!("应用分流设置失败：{error}；已恢复原设置"),
                    Err(rollback_error) => {
                        format!("应用分流设置失败：{error}；恢复原设置失败：{rollback_error}")
                    }
                });
            }
        }
    }

    let Some(route) = active_route else {
        let mode_name = match settings.mode.as_str() {
            "global" => "全局",
            "direct" => "直连",
            _ => "规则",
        };
        return Ok(AutoRoutingApplyResult {
            settings,
            applied: false,
            restarted: false,
            message: format!("已切换为{mode_name}模式"),
        });
    };

    if !requires_reload {
        let _ = app.emit(
            "connection-log",
            serde_json::json!({
                "level": "success",
                "message": "分流规则已即时应用到当前线路，无需重启"
            }),
        );
        return Ok(AutoRoutingApplyResult {
            settings,
            applied: true,
            restarted: false,
            message: "已即时生效，无需重启".into(),
        });
    }

    let cancel = reload_cancel.expect("reload cancellation state exists");
    set_stage(
        app,
        &store.state,
        "applying-routing",
        Some(format!("正在应用分流 · {}", route.name)),
    );
    let _ = app.emit(
        "connection-log",
        serde_json::json!({
            "level": "info",
            "message": format!("正在自动重载 {} 以应用分流设置", route.name)
        }),
    );
    match connect_route(
        app,
        &store.state,
        runtime,
        &store.proxy,
        &route,
        &cancel,
        false,
        &store.active_route,
    ) {
        Ok(()) => {
            if let Ok(mut port) = store.active_proxy_port.lock() {
                *port = Some(proxy_port(&route));
            }
            let _ = app.emit(
                "connection-log",
                serde_json::json!({
                    "level": "success",
                    "message": "分流设置已生效，核心重载完成"
                }),
            );
            Ok(AutoRoutingApplyResult {
                settings,
                applied: true,
                restarted: true,
                message: "已生效，KiNGO 已自动完成核心重载".into(),
            })
        }
        Err(apply_error) => {
            let settings_rollback = persist_auto_routing_settings(app, &previous);
            if route.core_id != "mihomo" {
                let _ = update_bridge_routing(&store.proxy, &previous);
            }
            let rollback = if settings_rollback.is_ok() {
                connect_route(
                    app,
                    &store.state,
                    runtime,
                    &store.proxy,
                    &route,
                    &cancel,
                    false,
                    &store.active_route,
                )
            } else {
                Err(settings_rollback
                    .err()
                    .unwrap_or_else(|| "恢复原分流设置失败".into()))
            };
            match rollback {
                Ok(()) => {
                    if let Ok(mut port) = store.active_proxy_port.lock() {
                        *port = Some(proxy_port(&route));
                    }
                    if let Ok(mut state) = store.state.lock() {
                        state.error =
                            Some(format!("新分流设置应用失败，已恢复原连接：{apply_error}"));
                    }
                    emit_snapshot(app, store);
                    Err(format!("应用失败，已自动恢复原连接：{apply_error}"))
                }
                Err(rollback_error) => {
                    let _ = core_runtime::stop_all(runtime);
                    let _ = system_proxy::disable(&store.proxy);
                    if let Ok(mut port) = store.active_proxy_port.lock() {
                        *port = None;
                    }
                    if let Ok(mut active) = store.active_route.lock() {
                        *active = None;
                    }
                    if let Ok(mut state) = store.state.lock() {
                        state.connected = false;
                        state.connecting = false;
                        state.stage = "failed".into();
                        state.core_id = None;
                        state.error = Some(format!(
                            "应用分流设置失败：{apply_error}；恢复原连接失败：{rollback_error}"
                        ));
                    }
                    emit_snapshot(app, store);
                    Err(format!(
                        "应用失败且恢复原连接失败：{apply_error}；{rollback_error}"
                    ))
                }
            }
        }
    }
}

pub fn set_auto_failover(
    app: &AppHandle,
    store: &ConnectionStore,
    enabled: bool,
) -> Result<(), String> {
    let tun_enabled = store
        .state
        .lock()
        .map_err(|_| "connection state unavailable")?
        .tun_enabled;
    persist_connection_settings(app, enabled, tun_enabled)?;
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

pub fn set_auto_tun(
    app: AppHandle,
    store: &ConnectionStore,
    runtime: &core_runtime::CoreRuntime,
    enabled: bool,
) -> Result<AppConnectionState, String> {
    if enabled && !crate::process_utils::is_elevated() {
        return Err("开启 TUN 模式需要管理员权限，请以管理员身份重新启动 KiNGO".into());
    }
    let (auto_failover, connecting, connected) = {
        let state = store
            .state
            .lock()
            .map_err(|_| "connection state unavailable")?;
        (state.auto_failover, state.connecting, state.connected)
    };
    if connecting {
        return Err("正在连接或切换线路，请完成后再切换 TUN 模式".into());
    }
    persist_connection_settings(&app, auto_failover, enabled)?;
    if let Ok(mut state) = store.state.lock() {
        state.tun_enabled = enabled;
    }
    emit_snapshot(&app, store);
    if connected {
        let route_id = if enabled {
            None
        } else {
            store
                .active_route
                .lock()
                .ok()
                .and_then(|route| route.as_ref().map(|route| route.id.clone()))
        };
        start_public_connection(app, store, runtime, route_id)?;
    }
    Ok(snapshot(store))
}

fn tun_route_supported(route: &PublicRoute) -> bool {
    matches!(route.core_id.as_str(), "mihomo" | "sing-box")
}

fn supports_dynamic_probe(route: &PublicRoute) -> bool {
    matches!(
        route.core_id.as_str(),
        "mihomo" | "xray" | "sing-box" | "hysteria" | "hysteria2" | "naiveproxy" | "juicity"
    )
}

struct PreparedCandidate {
    route: PublicRoute,
    runtime: core_runtime::CoreRuntime,
    port: u16,
    latency: u32,
    country: Option<String>,
    exit: Option<ExitInfo>,
}

enum QuickProbeResult {
    Ready(Box<PreparedCandidate>),
    Failed(String, String),
}

fn prepare_candidate(
    app: &AppHandle,
    route: &PublicRoute,
    port: u16,
    cancel: &Arc<AtomicBool>,
    precise: bool,
) -> Result<PreparedCandidate, String> {
    if cancel.load(Ordering::Relaxed) {
        return Err("connection cancelled".into());
    }
    prepare_route(app, route)?;
    let runtime = core_runtime::CoreRuntime::default();
    let original_config = runtime_config(app, route)?;
    let (config, temporary) = probe_config_for_port(route, &original_config, port)?;
    if let Err(error) = core_runtime::start(app, &runtime, route.core_id.clone(), config.clone()) {
        if temporary {
            let _ = fs::remove_file(&config);
        }
        let _ = core_runtime::stop_all(&runtime);
        return Err(error);
    }
    if temporary {
        if let Err(error) =
            core_runtime::register_temporary_config(&runtime, &route.core_id, &config)
        {
            let _ = core_runtime::stop_all(&runtime);
            let _ = fs::remove_file(&config);
            return Err(error);
        }
    }
    let result = (|| {
        if !wait_for_port(port, Duration::from_secs(6)) {
            return Err("核心未能及时启动临时代理端口".to_string());
        }
        if cancel.load(Ordering::Relaxed) {
            return Err("connection cancelled".into());
        }
        let latency = if precise {
            probe_latency_median(route, port, cancel)?
        } else {
            proxy_request_latency_on_port(route, port)?
        };
        let exit = precise
            .then(|| query_exit_info_on_port(route, port).ok())
            .flatten();
        let country = exit.as_ref().map(|value| value.country.clone());
        Ok(PreparedCandidate {
            route: route.clone(),
            runtime: runtime.clone(),
            port,
            latency,
            country,
            exit,
        })
    })();
    if result.is_err() {
        let _ = core_runtime::stop_all(&runtime);
    }
    result
}

fn stop_prepared_candidate(candidate: &PreparedCandidate) {
    let _ = core_runtime::stop_all(&candidate.runtime);
}

fn quick_select_candidate(
    app: &AppHandle,
    candidates: &[PublicRoute],
    cancel: &Arc<AtomicBool>,
    metrics: &Arc<Mutex<HashMap<String, RouteMetric>>>,
) -> Option<PreparedCandidate> {
    let candidates: Vec<_> = candidates
        .iter()
        .filter(|route| supports_dynamic_probe(route))
        .take(6)
        .cloned()
        .collect();
    if candidates.is_empty() {
        return None;
    }
    let (sender, receiver) = mpsc::channel();
    for (index, route) in candidates.iter().cloned().enumerate() {
        let app = app.clone();
        let sender = sender.clone();
        let cancel = cancel.clone();
        std::thread::spawn(move || {
            let route_id = route.id.clone();
            let result = match prepare_candidate(&app, &route, 12080 + index as u16, &cancel, false)
            {
                Ok(candidate) => QuickProbeResult::Ready(Box::new(candidate)),
                Err(error) => QuickProbeResult::Failed(route_id, error),
            };
            if let Err(error) = sender.send(result) {
                if let QuickProbeResult::Ready(candidate) = error.0 {
                    stop_prepared_candidate(&candidate);
                }
            }
        });
    }
    drop(sender);

    let deadline = Instant::now() + Duration::from_secs(8);
    let mut grace_deadline = None;
    let mut best: Option<PreparedCandidate> = None;
    while !cancel.load(Ordering::Relaxed) {
        let now = Instant::now();
        let end = grace_deadline.unwrap_or(deadline).min(deadline);
        if now >= end {
            break;
        }
        match receiver.recv_timeout((end - now).min(Duration::from_millis(100))) {
            Ok(QuickProbeResult::Ready(candidate)) => {
                let candidate = *candidate;
                record_metric(metrics, &candidate.route.id, Some(candidate.latency), None);
                record_route_country(metrics, &candidate.route.id, candidate.country.clone());
                if best
                    .as_ref()
                    .is_none_or(|current| candidate.latency < current.latency)
                {
                    if let Some(previous) = best.replace(candidate) {
                        stop_prepared_candidate(&previous);
                    }
                } else {
                    stop_prepared_candidate(&candidate);
                }
                grace_deadline.get_or_insert_with(|| Instant::now() + Duration::from_millis(650));
            }
            Ok(QuickProbeResult::Failed(route_id, error)) => {
                record_metric(metrics, &route_id, None, Some(error));
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    if cancel.load(Ordering::Relaxed) {
        if let Some(candidate) = best.as_ref() {
            stop_prepared_candidate(candidate);
        }
        return None;
    }
    best
}

#[allow(clippy::too_many_arguments)]
fn activate_prepared_candidate(
    app: &AppHandle,
    state: &Arc<Mutex<AppConnectionState>>,
    runtime: &core_runtime::CoreRuntime,
    proxy: &system_proxy::ProxyState,
    candidate: PreparedCandidate,
    active_route: &Arc<Mutex<Option<PublicRoute>>>,
    active_proxy_port: &Arc<Mutex<Option<u16>>>,
) -> Result<(), String> {
    core_runtime::stop_all(runtime)?;
    core_runtime::adopt(runtime, &candidate.runtime, &candidate.route.core_id)?;
    if let Err(error) = proxy.set_country_rules(geo_rules::load_cn_rules(app)?) {
        let _ = core_runtime::stop(runtime, &candidate.route.core_id);
        return Err(error);
    }
    let routing = get_auto_routing_settings(app);
    if let Err(error) = system_proxy::enable_with_routing(
        proxy,
        candidate.port,
        true,
        false,
        &routing.mode,
        bridge_routing_rules(&routing),
    ) {
        let _ = core_runtime::stop(runtime, &candidate.route.core_id);
        return Err(error);
    }
    if let Ok(mut route) = active_route.lock() {
        *route = Some(candidate.route.clone());
    }
    if let Ok(mut port) = active_proxy_port.lock() {
        *port = Some(candidate.port);
    }
    let route_for_exit = candidate.route.clone();
    let exit_port = candidate.port;
    let mut display_name = candidate.route.name.clone();
    if let Some(exit) = candidate.exit {
        display_name = exit
            .country
            .split(" · ")
            .next()
            .unwrap_or(&exit.country)
            .to_string();
        if let Ok(mut current) = state.lock() {
            current.exit_ip = Some(exit.ip);
            current.country = Some(exit.country);
        }
    }
    if let Ok(mut current) = state.lock() {
        current.connecting = false;
        current.connected = true;
        current.stage = "connected".into();
        current.core_id = Some(candidate.route.core_id);
        current.display_name = Some(display_name);
        current.latency = Some(candidate.latency);
        current.system_proxy_enabled = true;
        current.error = None;
    }
    let _ = app.emit(
        "connection-state",
        state.lock().ok().map(|value| value.clone()),
    );
    let app = app.clone();
    let state = state.clone();
    let active_route = active_route.clone();
    std::thread::spawn(move || {
        let Ok(exit) = query_exit_info_on_port(&route_for_exit, exit_port) else {
            return;
        };
        let still_active = active_route
            .lock()
            .ok()
            .and_then(|value| value.as_ref().map(|route| route.id == route_for_exit.id))
            .unwrap_or(false);
        if !still_active {
            return;
        }
        if let Ok(mut current) = state.lock() {
            current.exit_ip = Some(exit.ip);
            current.country = Some(exit.country.clone());
            current.display_name = Some(
                exit.country
                    .split(" · ")
                    .next()
                    .unwrap_or(&exit.country)
                    .to_string(),
            );
        }
        let _ = app.emit(
            "connection-state",
            state.lock().ok().map(|value| value.clone()),
        );
    });
    Ok(())
}

fn is_clear_latency_upgrade(current: u32, candidate: u32) -> bool {
    let required_gain = (current / 5).max(80);
    candidate.saturating_add(required_gain) < current
}

fn wait_for_low_traffic(state: &Arc<Mutex<AppConnectionState>>, cancel: &Arc<AtomicBool>) -> bool {
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut quiet_samples = 0_u8;
    while Instant::now() < deadline && !cancel.load(Ordering::Relaxed) {
        let quiet = state
            .lock()
            .map(|value| value.download_bps.saturating_add(value.upload_bps) < 64 * 1024)
            .unwrap_or(false);
        quiet_samples = if quiet {
            quiet_samples.saturating_add(1)
        } else {
            0
        };
        if quiet_samples >= 3 {
            return true;
        }
        std::thread::sleep(Duration::from_secs(1));
    }
    false
}

#[allow(clippy::too_many_arguments)]
fn switch_to_prepared_candidate(
    app: &AppHandle,
    state: &Arc<Mutex<AppConnectionState>>,
    runtime: &core_runtime::CoreRuntime,
    proxy: &system_proxy::ProxyState,
    active_route: &Arc<Mutex<Option<PublicRoute>>>,
    active_proxy_port: &Arc<Mutex<Option<u16>>>,
    routing_apply_in_progress: &Arc<AtomicBool>,
    expected_route_id: &str,
    candidate: PreparedCandidate,
) -> Result<(), String> {
    let _guard = RoutingApplyGuard::acquire(routing_apply_in_progress)?;
    let previous = active_route
        .lock()
        .map_err(|_| "active route state unavailable".to_string())?
        .clone()
        .ok_or_else(|| "active route is no longer available".to_string())?;
    if previous.id != expected_route_id {
        return Err("active route changed while background probing".into());
    }
    let connected = state
        .lock()
        .map(|value| value.connected && !value.tun_enabled)
        .unwrap_or(false);
    if !connected {
        return Err("connection is no longer eligible for background switching".into());
    }

    let same_core = previous.core_id == candidate.route.core_id;
    if !same_core {
        core_runtime::adopt(runtime, &candidate.runtime, &candidate.route.core_id)?;
    }
    let routing = get_auto_routing_settings(app);
    let proxy_result = if previous.core_id == "mihomo" {
        system_proxy::enable_with_routing(
            proxy,
            candidate.port,
            true,
            false,
            &routing.mode,
            bridge_routing_rules(&routing),
        )
    } else {
        proxy.switch_socks_upstream(candidate.port)
    };
    if let Err(error) = proxy_result {
        if !same_core {
            let _ = core_runtime::stop(runtime, &candidate.route.core_id);
        }
        return Err(error);
    }

    // New connections already use the verified candidate. Give the old core a
    // short drain window before stopping it so low-traffic switches rarely
    // interrupt an in-flight request.
    std::thread::sleep(Duration::from_millis(1500));
    core_runtime::stop(runtime, &previous.core_id)?;
    if same_core {
        core_runtime::adopt(runtime, &candidate.runtime, &candidate.route.core_id)?;
    }
    if let Ok(mut route) = active_route.lock() {
        *route = Some(candidate.route.clone());
    }
    if let Ok(mut port) = active_proxy_port.lock() {
        *port = Some(candidate.port);
    }
    let mut display_name = candidate.route.name.clone();
    if let Some(exit) = candidate.exit {
        display_name = exit
            .country
            .split(" · ")
            .next()
            .unwrap_or(&exit.country)
            .to_string();
        if let Ok(mut current) = state.lock() {
            current.exit_ip = Some(exit.ip);
            current.country = Some(exit.country);
        }
    }
    if let Ok(mut current) = state.lock() {
        current.core_id = Some(candidate.route.core_id.clone());
        current.display_name = Some(display_name);
        current.latency = Some(candidate.latency);
        current.error = None;
    }
    let _ = app.emit(
        "connection-state",
        state.lock().ok().map(|value| value.clone()),
    );
    let _ = app.emit(
        "connection-log",
        serde_json::json!({
            "level": "success",
            "message": format!(
                "后台精测发现明显更优线路，已从 {} 平滑切换到 {}（{} ms）",
                previous.name, candidate.route.name, candidate.latency
            )
        }),
    );
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn spawn_background_route_optimizer(
    app: AppHandle,
    state: Arc<Mutex<AppConnectionState>>,
    runtime: core_runtime::CoreRuntime,
    proxy: system_proxy::ProxyState,
    routes: Vec<PublicRoute>,
    metrics: Arc<Mutex<HashMap<String, RouteMetric>>>,
    active_route: Arc<Mutex<Option<PublicRoute>>>,
    active_proxy_port: Arc<Mutex<Option<u16>>>,
    routing_apply_in_progress: Arc<AtomicBool>,
    cancel: Arc<AtomicBool>,
) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(2));
        let candidates = ordered_candidates(&routes, &metrics, None, false);
        for (index, route) in candidates.into_iter().enumerate() {
            if cancel.load(Ordering::Relaxed) {
                return;
            }
            let current = active_route.lock().ok().and_then(|value| value.clone());
            let Some(current) = current else { return };
            if route.id == current.id || !supports_dynamic_probe(&route) {
                continue;
            }
            let prepared = prepare_candidate(&app, &route, 14080 + index as u16, &cancel, true);
            let candidate = match prepared {
                Ok(candidate) => {
                    record_metric(&metrics, &route.id, Some(candidate.latency), None);
                    record_route_country(&metrics, &route.id, candidate.country.clone());
                    candidate
                }
                Err(error) => {
                    if !cancel.load(Ordering::Relaxed) {
                        record_metric(&metrics, &route.id, None, Some(error));
                    }
                    continue;
                }
            };
            let current_latency = state.lock().ok().and_then(|value| value.latency);
            let should_switch = current_latency
                .is_some_and(|latency| is_clear_latency_upgrade(latency, candidate.latency));
            if should_switch && wait_for_low_traffic(&state, &cancel) {
                let candidate_runtime = candidate.runtime.clone();
                if switch_to_prepared_candidate(
                    &app,
                    &state,
                    &runtime,
                    &proxy,
                    &active_route,
                    &active_proxy_port,
                    &routing_apply_in_progress,
                    &current.id,
                    candidate,
                )
                .is_ok()
                {
                    std::thread::sleep(Duration::from_secs(3));
                    continue;
                }
                let _ = core_runtime::stop_all(&candidate_runtime);
            } else {
                stop_prepared_candidate(&candidate);
            }
            std::thread::sleep(Duration::from_millis(750));
        }
    });
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
    active_proxy_port: &Arc<Mutex<Option<u16>>>,
) -> Result<(), String> {
    let tun_enabled = state.lock().map(|value| value.tun_enabled).unwrap_or(false);
    if let Some(route) = selected {
        if tun_enabled && !tun_route_supported(route) {
            return Err("当前线路核心不支持原生 TUN，请选择 Mihomo 或 sing-box 线路".into());
        }
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

    let candidates = ordered_candidates(routes, route_metrics, None, tun_enabled);
    let has_recent_success = route_metrics
        .lock()
        .map(|metrics| {
            let now = current_unix_seconds();
            candidates.iter().any(|route| {
                metrics.get(&route.id).is_some_and(|metric| {
                    metric.error.is_none()
                        && metric
                            .last_success_at
                            .is_some_and(|at| now.saturating_sub(at) <= 30 * 60)
                })
            })
        })
        .unwrap_or(false);
    if !tun_enabled && !has_recent_success {
        set_stage(app, state, "probing", Some("正在快速筛选可用线路".into()));
        if let Some(candidate) = quick_select_candidate(app, &candidates, cancel, route_metrics) {
            activate_prepared_candidate(
                app,
                state,
                runtime,
                proxy,
                candidate,
                active_route,
                active_proxy_port,
            )?;
            return Ok(());
        }
    }
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
    tun_enabled: bool,
) -> Vec<PublicRoute> {
    let metrics = route_metrics
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default();
    let mut candidates: Vec<_> = routes
        .iter()
        .filter(|route| excluded_id != Some(route.id.as_str()))
        .filter(|route| !tun_enabled || tun_route_supported(route))
        .cloned()
        .collect();
    candidates.sort_by_key(|route| {
        let metric = metrics.get(&route.id);
        (
            metric_candidate_score(metric),
            std::cmp::Reverse(metric.and_then(|value| value.last_success_at).unwrap_or(0)),
            route.slot,
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
            metric.latency_samples.push(value);
            if metric.latency_samples.len() > 10 {
                metric.latency_samples.remove(0);
            }
            metric.latency = metric_median(&metric.latency_samples);
            metric.error = None;
            metric.last_success_at = Some(current_unix_seconds());
            metric.consecutive_failures = 0;
            metric.recent_results.push(true);
        } else {
            metric.error = error;
            metric.latency = None;
            metric.consecutive_failures = metric.consecutive_failures.saturating_add(1);
            metric.last_failure_at = Some(current_unix_seconds());
            metric.recent_results.push(false);
        }
        if metric.recent_results.len() > 10 {
            metric.recent_results.remove(0);
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
    test_url: &str,
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
        let latency = probe_latency_median_at_url(route, test_port, cancel, test_url)?;
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

fn probe_latency_median(
    route: &PublicRoute,
    port: u16,
    cancel: &Arc<AtomicBool>,
) -> Result<u32, String> {
    let settings = current_speed_test_settings();
    probe_latency_median_at_url(route, port, cancel, &settings.url)
}

fn probe_latency_median_at_url(
    route: &PublicRoute,
    port: u16,
    cancel: &Arc<AtomicBool>,
    test_url: &str,
) -> Result<u32, String> {
    let mut samples = Vec::with_capacity(3);
    let mut last_error = None;
    for _ in 0..3 {
        if cancel.load(Ordering::Relaxed) {
            return Err("connection cancelled".into());
        }
        match proxy_request_latency_on_port_with_url(route, port, test_url) {
            Ok(latency) => samples.push(latency),
            Err(error) => last_error = Some(error),
        }
        if samples.len() < 3 {
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    if samples.len() < 2 {
        return Err(last_error.unwrap_or_else(|| "线路连续探测失败".into()));
    }
    metric_median(&samples).ok_or_else(|| "线路探测没有有效延迟".into())
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
    if route.core_id == "mihomo" {
        let mut value: serde_yaml::Value = serde_yaml::from_slice(&data)
            .map_err(|error| format!("Mihomo 测速配置解析失败：{error}"))?;
        let mapping = value
            .as_mapping_mut()
            .ok_or_else(|| "Mihomo 测速配置不是有效对象".to_string())?;
        mapping.insert(
            serde_yaml::Value::String("mixed-port".into()),
            serde_yaml::Value::Number(test_port.into()),
        );
        mapping.remove(serde_yaml::Value::String("external-controller".into()));
        mapping.remove(serde_yaml::Value::String("secret".into()));
        let path = std::path::Path::new(config).with_file_name(format!("probe-{test_port}.yaml"));
        let content = serde_yaml::to_string(&value)
            .map_err(|error| format!("Mihomo 测速配置生成失败：{error}"))?;
        fs::write(&path, content).map_err(|error| format!("Mihomo 测速配置写入失败：{error}"))?;
        return Ok((path.to_string_lossy().into_owned(), true));
    }
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
    let tun_enabled = state.lock().map(|value| value.tun_enabled).unwrap_or(false);
    if tun_enabled {
        if !crate::process_utils::is_elevated() {
            return Err("TUN 模式需要管理员权限，请以管理员身份重新启动 KiNGO".into());
        }
        if !tun_route_supported(route) {
            return Err("当前线路核心不支持原生 TUN，请选择 Mihomo 或 sing-box 线路".into());
        }
    }
    let config = runtime_config(app, route)?;
    if route.core_id == "mihomo" {
        core_runtime::validate_mihomo_config(app, &config)?;
    }
    if let Ok(mut current) = state.lock() {
        current.stage = "connecting".into();
        current.display_name = Some(route.name.clone());
        current.core_id = Some(route.core_id.clone());
        if let Some(node_id) = route.id.strip_prefix("community:") {
            current.source_type = Some("community".into());
            current.node_id = Some(node_id.into());
        } else {
            current.source_type = Some("public".into());
            current.node_id = Some(route.id.clone());
        }
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
    // A public node may be healthy while a single captive-portal endpoint is
    // blocked or hijacked by its upstream network. Reuse the configured
    // fallback list here instead of rejecting the connection after only the
    // primary URL fails.
    let verified_latency = proxy_request_latency_with_fallbacks(route)?;
    proxy.set_country_rules(geo_rules::load_cn_rules(app)?)?;
    let routing = get_auto_routing_settings(app);
    if tun_enabled {
        system_proxy::disable(proxy)?;
    } else if route.core_id == "mihomo" {
        system_proxy::enable(proxy, port, false, false)?;
    } else {
        system_proxy::enable_with_routing(
            proxy,
            port,
            true,
            false,
            &routing.mode,
            bridge_routing_rules(&routing),
        )?;
    }
    let _ = app.emit(
        "connection-log",
        serde_json::json!({
            "level": "success",
            "message": if tun_enabled {
                "TUN 模式已生效：虚拟网卡与 DNS 劫持已启用"
            } else if routing.mode == "global" {
                "全局模式已生效：局域网直连，其他公网流量走代理"
            } else {
                "规则模式已生效：局域网和中国域名/IP 直连，其他流量走代理"
            }
        }),
    );
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
        current.tun_enabled = tun_enabled;
        current.system_proxy_enabled = !tun_enabled;
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
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or_default();
    if let Ok(value) = proxy_json_request(
        &proxy,
        &format!("https://my.ippure.com/v1/info?kingo_refresh={nonce}"),
        8,
    ) {
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
        if let Ok(value) = proxy_json_request(&proxy, &format!("{url}?kingo_refresh={nonce}"), 5) {
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
            "-H",
            "Cache-Control: no-cache",
            "-H",
            "Pragma: no-cache",
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

fn proxy_request_latency_with_fallbacks(route: &PublicRoute) -> Result<u32, String> {
    let settings = current_speed_test_settings();
    let urls = settings.latency_urls();
    first_successful_latency(&urls, |url| {
        proxy_request_latency_on_port_with_url(route, proxy_port(route), url)
    })
}

fn first_successful_latency<F>(urls: &[String], mut probe: F) -> Result<u32, String>
where
    F: FnMut(&str) -> Result<u32, String>,
{
    let mut failures = Vec::with_capacity(urls.len());
    for url in urls {
        match probe(url) {
            Ok(latency) => return Ok(latency),
            Err(error) => failures.push(format!("{url}: {error}")),
        }
    }
    Err(format!(
        "线路已启动，但 {} 个连接验证地址均不可用：{}",
        failures.len(),
        failures.join("；")
    ))
}

fn proxy_request_latency_on_port(route: &PublicRoute, port: u16) -> Result<u32, String> {
    let settings = current_speed_test_settings();
    proxy_request_latency_on_port_with_url(route, port, &settings.url)
}

fn proxy_request_latency_on_port_with_url(
    route: &PublicRoute,
    port: u16,
    test_url: &str,
) -> Result<u32, String> {
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
            test_url,
        ])
        .output()
        .map_err(|error| format!("无法启动线路探测：{error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            format!("线路代理请求失败或已超时（curl {}）", output.status)
        } else {
            format!("线路代理请求失败或已超时：{detail}")
        });
    }
    let seconds: f32 = String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse()
        .map_err(|_| "线路探测返回了无效延迟".to_string())?;
    Ok((seconds * 1000.0).round() as u32)
}

pub(crate) fn country_name_zh(code: Option<&str>, fallback: Option<&str>) -> String {
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
        // Keep a valid provider country name (for uncommon ISO codes not yet
        // translated above) instead of incorrectly relabeling the exit as unknown.
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
        let mixed_port = if route.id.starts_with("community:") {
            route.slot.try_into().map_err(|_| "公共节点代理端口无效")?
        } else {
            7890
        };
        ensure_mihomo_controller(&config, mixed_port, 9090)?;
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

fn ensure_mihomo_controller(
    config: &std::path::Path,
    mixed_port: u16,
    default_controller_port: u16,
) -> Result<(), String> {
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
    let mut secret_added = false;
    for line in &lines[start..] {
        let trimmed = line.trim_start();
        if trimmed.starts_with("secret:") {
            if !secret_added {
                normalized.push("secret: KiNGO".to_string());
                secret_added = true;
            }
            continue;
        }
        if trimmed.starts_with("mixed-port:") {
            if !mixed_port_added {
                normalized.push(format!("mixed-port: {mixed_port}"));
                mixed_port_added = true;
            }
            continue;
        }
        if trimmed.starts_with("external-controller:") {
            if !controller_added {
                let controller = if start > 0 || mixed_port == 7890 {
                    default_controller_port
                } else {
                    // Community configs are generated with an available controller
                    // port; preserve it instead of forcing the globally common 9090.
                    trimmed
                        .split_once(':')
                        .and_then(|(_, value)| value.trim().rsplit_once(':'))
                        .and_then(|(_, port)| port.parse::<u16>().ok())
                        .unwrap_or(default_controller_port)
                };
                normalized.push(format!("external-controller: 127.0.0.1:{controller}"));
                controller_added = true;
            }
            continue;
        }
        normalized.push((*line).to_string());
    }
    if !mixed_port_added {
        normalized.insert(0, format!("mixed-port: {mixed_port}"));
    }
    if !controller_added {
        normalized.push(format!(
            "external-controller: 127.0.0.1:{default_controller_port}"
        ));
    }
    if !secret_added {
        normalized.push("secret: KiNGO".to_string());
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

fn inject_mihomo_routing(
    mut value: serde_yaml::Value,
    settings: &AutoRoutingSettings,
    tun_enabled: bool,
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
    let mut rules = vec![
        Value::String("DOMAIN,localhost,DIRECT".into()),
        Value::String("DOMAIN-SUFFIX,local,DIRECT".into()),
        Value::String("IP-CIDR,127.0.0.0/8,DIRECT,no-resolve".into()),
        Value::String("IP-CIDR,10.0.0.0/8,DIRECT,no-resolve".into()),
        Value::String("IP-CIDR,172.16.0.0/12,DIRECT,no-resolve".into()),
        Value::String("IP-CIDR,192.168.0.0/16,DIRECT,no-resolve".into()),
        Value::String("IP-CIDR,169.254.0.0/16,DIRECT,no-resolve".into()),
        Value::String("IP-CIDR6,::1/128,DIRECT,no-resolve".into()),
        Value::String("IP-CIDR6,fc00::/7,DIRECT,no-resolve".into()),
        Value::String("IP-CIDR6,fe80::/10,DIRECT,no-resolve".into()),
    ];
    if settings.mode == "rule" {
        rules.push(Value::String("GEOSITE,CN,DIRECT".into()));
        rules.push(Value::String("GEOIP,CN,DIRECT".into()));
    }
    rules.push(Value::String(format!("MATCH,{proxy_name}")));

    let mut dns = Mapping::new();
    dns.insert(Value::String("enable".into()), Value::Bool(true));
    dns.insert(
        Value::String("enhanced-mode".into()),
        Value::String("redir-host".into()),
    );
    dns.insert(Value::String("ipv6".into()), Value::Bool(true));
    dns.insert(Value::String("use-hosts".into()), Value::Bool(true));
    dns.insert(Value::String("use-system-hosts".into()), Value::Bool(true));
    dns.insert(Value::String("respect-rules".into()), Value::Bool(true));
    dns.insert(
        Value::String("default-nameserver".into()),
        Value::Sequence(
            ["223.5.5.5", "119.29.29.29"]
                .into_iter()
                .map(|server| Value::String(server.into()))
                .collect(),
        ),
    );
    dns.insert(
        Value::String("proxy-server-nameserver".into()),
        Value::Sequence(
            ["223.5.5.5", "119.29.29.29"]
                .into_iter()
                .map(|server| Value::String(server.into()))
                .collect(),
        ),
    );
    dns.insert(
        Value::String("nameserver".into()),
        Value::Sequence(
            [
                "https://cloudflare-dns.com/dns-query#RULES",
                "https://dns.google/dns-query#RULES",
            ]
            .into_iter()
            .map(|server| Value::String(server.into()))
            .collect(),
        ),
    );
    if settings.mode == "rule" {
        dns.insert(
            Value::String("direct-nameserver".into()),
            Value::Sequence(
                [
                    "https://dns.alidns.com/dns-query",
                    "https://doh.pub/dns-query",
                ]
                .into_iter()
                .map(|server| Value::String(server.into()))
                .collect(),
            ),
        );
        dns.insert(
            Value::String("direct-nameserver-follow-policy".into()),
            Value::Bool(true),
        );
        let mut policy = Mapping::new();
        policy.insert(
            Value::String("geosite:cn".into()),
            Value::Sequence(
                [
                    "https://dns.alidns.com/dns-query",
                    "https://doh.pub/dns-query",
                ]
                .into_iter()
                .map(|server| Value::String(server.into()))
                .collect(),
            ),
        );
        dns.insert(
            Value::String("nameserver-policy".into()),
            Value::Mapping(policy),
        );
    }
    let tun = if tun_enabled {
        serde_yaml::from_str::<Value>(
            r#"
enable: true
stack: mixed
device: KiNGO
auto-route: true
auto-detect-interface: true
strict-route: true
dns-hijack:
  - any:53
"#,
        )
        .map_err(|error| format!("生成 Mihomo TUN 配置失败：{error}"))?
    } else {
        let mut disabled = Mapping::new();
        disabled.insert(Value::String("enable".into()), Value::Bool(false));
        Value::Mapping(disabled)
    };
    if let Value::Mapping(map) = &mut value {
        map.insert(Value::String("geodata-mode".into()), Value::Bool(true));
        map.insert(
            Value::String("geodata-loader".into()),
            Value::String("memconservative".into()),
        );
        map.insert(Value::String("geo-auto-update".into()), Value::Bool(false));
        map.insert(Value::String("rules".into()), Value::Sequence(rules));
        map.insert(Value::String("mode".into()), Value::String("rule".into()));
        map.insert(Value::String("dns".into()), Value::Mapping(dns));
        map.insert(Value::String("tun".into()), tun);
    } else {
        let mut map = Mapping::new();
        map.insert(Value::String("geodata-mode".into()), Value::Bool(true));
        map.insert(
            Value::String("geodata-loader".into()),
            Value::String("memconservative".into()),
        );
        map.insert(Value::String("geo-auto-update".into()), Value::Bool(false));
        map.insert(Value::String("rules".into()), Value::Sequence(rules));
        map.insert(Value::String("mode".into()), Value::String("rule".into()));
        map.insert(Value::String("dns".into()), Value::Mapping(dns));
        map.insert(Value::String("tun".into()), tun);
        value = Value::Mapping(map);
    }
    Ok(value)
}

fn ensure_singbox_routing_outbounds(value: &mut serde_json::Value) -> Result<String, String> {
    let outbounds = value["outbounds"]
        .as_array_mut()
        .ok_or_else(|| "sing-box 配置缺少出站".to_string())?;
    let proxy = outbounds
        .iter()
        .find(|outbound| {
            !matches!(
                outbound.get("type").and_then(serde_json::Value::as_str),
                Some("direct" | "block" | "dns")
            )
        })
        .and_then(|outbound| outbound.get("tag"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| "sing-box 配置缺少代理出站标签".to_string())?;
    if !outbounds
        .iter()
        .any(|outbound| outbound.get("tag").and_then(serde_json::Value::as_str) == Some("direct"))
    {
        outbounds.push(serde_json::json!({ "type": "direct", "tag": "direct" }));
    }
    if !outbounds
        .iter()
        .any(|outbound| outbound.get("tag").and_then(serde_json::Value::as_str) == Some("block"))
    {
        outbounds.push(serde_json::json!({ "type": "block", "tag": "block" }));
    }
    Ok(proxy)
}

fn ensure_xray_routing_outbounds(value: &mut serde_json::Value) -> Result<String, String> {
    let outbounds = value["outbounds"]
        .as_array_mut()
        .ok_or_else(|| "Xray 配置缺少出站".to_string())?;
    let proxy = outbounds
        .iter()
        .find(|outbound| {
            !matches!(
                outbound.get("protocol").and_then(serde_json::Value::as_str),
                Some("freedom" | "blackhole" | "dns")
            )
        })
        .and_then(|outbound| outbound.get("tag"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| "Xray 配置缺少代理出站标签".to_string())?;
    if !outbounds
        .iter()
        .any(|outbound| outbound.get("tag").and_then(serde_json::Value::as_str) == Some("direct"))
    {
        outbounds.push(serde_json::json!({ "protocol": "freedom", "tag": "direct" }));
    }
    if !outbounds
        .iter()
        .any(|outbound| outbound.get("tag").and_then(serde_json::Value::as_str) == Some("block"))
    {
        outbounds.push(serde_json::json!({ "protocol": "blackhole", "tag": "block" }));
    }
    Ok(proxy)
}

fn inject_json_routing(
    route: &PublicRoute,
    mut value: serde_json::Value,
    settings: &AutoRoutingSettings,
    singbox_country_rules: Option<&str>,
    tun_enabled: bool,
) -> Result<serde_json::Value, String> {
    if route.core_id == "sing-box" {
        let proxy = ensure_singbox_routing_outbounds(&mut value)?;
        if let Some(outbounds) = value["outbounds"].as_array_mut() {
            for outbound in outbounds {
                let tag = outbound.get("tag").and_then(serde_json::Value::as_str);
                if tag == Some("direct") {
                    outbound["domain_resolver"] = serde_json::json!("direct-dns");
                } else if tag == Some(proxy.as_str()) {
                    outbound["domain_resolver"] = serde_json::json!("bootstrap-dns");
                }
            }
        }
        let mut rules: Vec<serde_json::Value> = value["route"]["rules"]
            .as_array()
            .map(|rules| {
                rules
                    .iter()
                    .filter(|rule| rule.get("action").is_some())
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        if tun_enabled {
            let inbounds = value["inbounds"]
                .as_array_mut()
                .ok_or_else(|| "sing-box 配置缺少入站".to_string())?;
            inbounds.retain(|inbound| {
                inbound.get("tag").and_then(serde_json::Value::as_str) != Some("tun-in")
            });
            inbounds.insert(
                0,
                serde_json::json!({
                    "type": "tun",
                    "tag": "tun-in",
                    "interface_name": "KiNGO",
                    "address": ["172.19.0.1/30"],
                    "mtu": 1500,
                    "auto_route": true,
                    "strict_route": true,
                    "stack": "mixed"
                }),
            );
            rules.insert(
                0,
                serde_json::json!({ "protocol": "dns", "action": "hijack-dns" }),
            );
            rules.insert(
                0,
                serde_json::json!({ "inbound": "tun-in", "action": "sniff" }),
            );
        }
        rules.push(serde_json::json!({ "ip_is_private": true, "outbound": "direct" }));
        if settings.mode == "rule" {
            let country_rules =
                singbox_country_rules.ok_or_else(|| "sing-box 中国规则文件不可用".to_string())?;
            rules.push(serde_json::json!({ "rule_set": ["kingo-cn"], "outbound": "direct" }));
            value["route"]["rule_set"] = serde_json::json!([{
                "type": "local",
                "tag": "kingo-cn",
                "format": "source",
                "path": country_rules
            }]);
        }
        let dns_rules = if settings.mode == "rule" {
            serde_json::json!([
                { "domain_suffix": ["local", "lan"], "action": "route", "server": "direct-dns" },
                { "rule_set": ["kingo-cn"], "action": "route", "server": "direct-dns" }
            ])
        } else {
            serde_json::json!([
                { "domain_suffix": ["local", "lan"], "action": "route", "server": "direct-dns" }
            ])
        };
        value["dns"] = serde_json::json!({
            "servers": [
                { "type": "udp", "tag": "bootstrap-dns", "server": "223.5.5.5", "server_port": 53 },
                {
                    "type": "https",
                    "tag": "direct-dns",
                    "server": "223.5.5.5",
                    "server_port": 443,
                    "path": "/dns-query",
                    "tls": { "enabled": true, "server_name": "dns.alidns.com" },
                    "detour": "direct"
                },
                {
                    "type": "https",
                    "tag": "proxy-dns",
                    "server": "1.1.1.1",
                    "server_port": 443,
                    "path": "/dns-query",
                    "tls": { "enabled": true, "server_name": "cloudflare-dns.com" },
                    "detour": proxy
                }
            ],
            "rules": dns_rules,
            "final": "proxy-dns",
            "strategy": "prefer_ipv4",
            "disable_cache": false,
            "cache_capacity": 4096
        });
        value["route"] = serde_json::json!({
            "rules": rules,
            "final": proxy,
            "auto_detect_interface": true,
            "rule_set": value["route"]["rule_set"].clone()
        });
        return Ok(value);
    }
    if route.core_id == "xray" {
        let proxy = ensure_xray_routing_outbounds(&mut value)?;
        if let Some(outbounds) = value["outbounds"].as_array_mut() {
            for outbound in outbounds {
                if outbound.get("tag").and_then(serde_json::Value::as_str) == Some("direct") {
                    if !outbound
                        .get("settings")
                        .is_some_and(serde_json::Value::is_object)
                    {
                        outbound["settings"] = serde_json::json!({});
                    }
                    outbound["settings"]["domainStrategy"] = serde_json::json!("UseIP");
                }
            }
        }
        let mut rules = Vec::new();
        rules.push(serde_json::json!({ "type": "field", "ip": ["geoip:private"], "outboundTag": "direct" }));
        rules.push(serde_json::json!({ "type": "field", "domain": ["geosite:private"], "outboundTag": "direct" }));
        if settings.mode == "rule" {
            rules.push(serde_json::json!({ "type": "field", "domain": ["geosite:cn"], "outboundTag": "direct" }));
            rules.push(
                serde_json::json!({ "type": "field", "ip": ["geoip:cn"], "outboundTag": "direct" }),
            );
        }
        rules.push(serde_json::json!({
            "type": "field",
            "network": "tcp,udp",
            "outboundTag": proxy
        }));
        value["routing"] = serde_json::json!({
            "domainStrategy": "IPIfNonMatch",
            "rules": rules
        });
        let mut servers = vec![serde_json::json!({
            "address": "https+local://dns.alidns.com/dns-query",
            "domains": ["geosite:private"],
            "skipFallback": true,
            "queryStrategy": "UseIP"
        })];
        if settings.mode == "rule" {
            servers.push(serde_json::json!({
                "address": "https+local://dns.alidns.com/dns-query",
                "domains": ["geosite:cn"],
                "expectedIPs": ["geoip:cn", "*"],
                "skipFallback": true,
                "queryStrategy": "UseIP"
            }));
        }
        servers.push(serde_json::json!({
            "address": "https://cloudflare-dns.com/dns-query",
            "queryStrategy": "UseIP"
        }));
        value["dns"] = serde_json::json!({
            "hosts": {
                "dns.alidns.com": ["223.5.5.5", "223.6.6.6"],
                "cloudflare-dns.com": ["104.16.248.249", "104.16.249.249"]
            },
            "servers": servers,
            "queryStrategy": "UseIP",
            "disableCache": false,
            "disableFallbackIfMatch": true,
            "enableParallelQuery": true,
            "useSystemHosts": true
        });
    }
    Ok(value)
}

fn install_shared_rule_file(source: &PathBuf, shared: &PathBuf) -> Result<(), String> {
    let source_size = fs::metadata(source)
        .map_err(|error| format!("读取规则资源失败：{error}"))?
        .len();
    if fs::metadata(shared).map(|value| value.len()).ok() == Some(source_size) {
        return Ok(());
    }
    if let Some(parent) = shared.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建规则目录失败：{error}"))?;
    }
    let pending = shared.with_extension("dat.pending");
    fs::copy(source, &pending).map_err(|error| format!("复制规则资源失败：{error}"))?;
    if shared.is_file() {
        fs::remove_file(shared).map_err(|error| format!("替换旧规则资源失败：{error}"))?;
    }
    fs::rename(&pending, shared).map_err(|error| format!("安装规则资源失败：{error}"))?;
    Ok(())
}

fn ensure_mihomo_geodata(app: &AppHandle, runtime_dir: &std::path::Path) -> Result<(), String> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("数据目录不可用：{error}"))?;
    let shared_dir = data.join("rules").join("mihomo");
    for name in ["geoip.dat", "geosite.dat"] {
        let source = paths::resource_file(app, PathBuf::from("cores/xray").join(name))?;
        let shared = shared_dir.join(name);
        install_shared_rule_file(&source, &shared)?;
        let target = runtime_dir.join(name);
        if target.is_file() {
            continue;
        }
        if fs::hard_link(&shared, &target).is_err() {
            fs::copy(&shared, &target)
                .map_err(|error| format!("准备 Mihomo {name} 失败：{error}"))?;
        }
    }
    Ok(())
}

fn ensure_singbox_country_rules(app: &AppHandle) -> Result<PathBuf, String> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("数据目录不可用：{error}"))?;
    let target = data.join("rules").join("sing-box").join("kingo-cn.json");
    geo_rules::load_cn_rules(app)?.write_singbox_source(&target)?;
    Ok(target)
}

fn runtime_config(app: &AppHandle, route: &PublicRoute) -> Result<String, String> {
    let source = cached_config(app, route)?;
    if !matches!(route.core_id.as_str(), "mihomo" | "xray" | "sing-box") {
        return Ok(source);
    }
    let settings = get_auto_routing_settings(app);
    let tun_enabled = get_connection_tun_enabled(app);
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
        let runtime_dir = source_path.parent().ok_or("线路配置目录无效")?;
        ensure_mihomo_geodata(app, runtime_dir)?;
        let content = fs::read_to_string(&source_path)
            .map_err(|error| format!("读取线路配置失败：{error}"))?;
        let value = serde_yaml::from_str::<serde_yaml::Value>(&content)
            .map_err(|error| format!("解析线路 YAML 失败：{error}"))?;
        let value = inject_mihomo_routing(value, &settings, tun_enabled)?;
        let content = serde_yaml::to_string(&value).map_err(|error| error.to_string())?;
        fs::write(&runtime, content).map_err(|error| format!("写入运行时规则失败：{error}"))?;
    } else {
        let data = fs::read(&source_path).map_err(|error| format!("读取线路配置失败：{error}"))?;
        let value = serde_json::from_slice::<serde_json::Value>(&data)
            .map_err(|error| format!("解析线路 JSON 失败：{error}"))?;
        let singbox_country_rules = if route.core_id == "sing-box" && settings.mode == "rule" {
            Some(ensure_singbox_country_rules(app)?)
        } else {
            None
        };
        let value = inject_json_routing(
            route,
            value,
            &settings,
            singbox_country_rules
                .as_deref()
                .and_then(std::path::Path::to_str),
            tun_enabled,
        )?;
        let content = serde_json::to_vec_pretty(&value).map_err(|error| error.to_string())?;
        fs::write(&runtime, content).map_err(|error| format!("写入运行时规则失败：{error}"))?;
    }
    Ok(runtime.to_string_lossy().into_owned())
}

fn proxy_port(route: &PublicRoute) -> u16 {
    if route.id.starts_with("community:") {
        return u16::try_from(route.slot).unwrap_or(7890);
    }
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
    if store.routing_apply_in_progress.load(Ordering::Acquire) {
        return Err("正在切换线路或应用连接设置，请稍候".into());
    }
    if let Some(flag) = store
        .cancel
        .lock()
        .map_err(|_| "connection control unavailable")?
        .take()
    {
        flag.store(true, Ordering::Relaxed);
    }
    let core_error = core_runtime::stop_all(runtime).err();
    let proxy_error = system_proxy::disable(&store.proxy).err();
    if let Some(error) = proxy_error {
        if let Ok(mut state) = store.state.lock() {
            state.connecting = false;
            state.connected = false;
            state.stage = "failed".into();
            state.system_proxy_enabled = true;
            state.error = Some(format!("断开连接时恢复 Windows 系统代理失败：{error}"));
        }
        emit_snapshot(app, store);
        return Err(format!("断开连接时恢复 Windows 系统代理失败：{error}"));
    }
    if let Ok(mut route) = store.active_route.lock() {
        *route = None;
    }
    if let Ok(mut port) = store.active_proxy_port.lock() {
        *port = None;
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
    state.source_type = None;
    state.node_id = None;
    state.display_name = None;
    state.error = core_error
        .as_ref()
        .map(|error| format!("系统代理已恢复，但部分核心进程停止失败：{error}"));
    state.download_bps = 0;
    state.upload_bps = 0;
    state.download_total = 0;
    state.upload_total = 0;
    state.system_proxy_enabled = false;
    drop(state);
    emit_snapshot(app, store);
    if let Some(error) = core_error {
        Err(format!("系统代理已恢复，但部分核心进程停止失败：{error}"))
    } else {
        Ok(())
    }
}

pub fn refresh_exit_info(
    app: &AppHandle,
    store: &ConnectionStore,
) -> Result<AppConnectionState, String> {
    let route = store
        .active_route
        .lock()
        .map_err(|_| "active route state unavailable")?
        .clone()
        .ok_or_else(|| "当前没有活动线路".to_string())?;
    let port = store
        .active_proxy_port
        .lock()
        .ok()
        .and_then(|value| *value)
        .unwrap_or_else(|| proxy_port(&route));
    let exit = query_exit_info_on_port(&route, port)?;
    let latency = proxy_request_latency_on_port(&route, port).ok();
    let mut state = store
        .state
        .lock()
        .map_err(|_| "connection state unavailable")?;
    state.exit_ip = Some(exit.ip);
    state.country = Some(exit.country);
    if latency.is_some() {
        state.latency = latency;
    }
    let refreshed = state.clone();
    drop(state);
    emit_snapshot(app, store);
    emit_log(
        app,
        "info",
        &format!(
            "出口信息已刷新：{} · {}",
            refreshed.exit_ip.as_deref().unwrap_or("未知 IP"),
            refreshed.country.as_deref().unwrap_or("未知地区")
        ),
    );
    Ok(refreshed)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn routing_settings(mode: &str, action: &str) -> AutoRoutingSettings {
        AutoRoutingSettings {
            mode: mode.into(),
            rules: vec![AutoRoutingRule {
                id: "custom".into(),
                target: "example.com".into(),
                action: action.into(),
                enabled: true,
            }],
        }
    }

    fn route(core_id: &str) -> PublicRoute {
        PublicRoute {
            id: format!("{core_id}:test"),
            name: "test".into(),
            core_id: core_id.into(),
            slot: 1,
            protocol_label: "test".into(),
            config_format: "json".into(),
            config_path: "test.json".into(),
            downloaded: true,
            active: false,
            connection_state: "idle".into(),
            last_success_at: None,
            last_error: None,
            latency: None,
            country: None,
            success_rate: None,
            jitter: None,
            quality: "待测试".into(),
        }
    }

    #[test]
    fn persisted_tun_is_disabled_when_process_is_not_elevated() {
        assert!(!effective_tun_enabled(true, false));
        assert!(effective_tun_enabled(true, true));
        assert!(!effective_tun_enabled(false, true));
    }

    #[test]
    fn legacy_custom_rules_are_removed_during_normalization() {
        let normalized =
            normalize_auto_routing_settings(routing_settings("rule", "direct")).unwrap();
        assert_eq!(normalized.mode, "rule");
        assert!(normalized.rules.is_empty());
    }

    #[test]
    fn route_latency_uses_median_and_reports_jitter() {
        let metric = RouteMetric {
            latency_samples: vec![90, 92, 420, 95, 94],
            recent_results: vec![true, true, true, true, true],
            last_success_at: Some(current_unix_seconds()),
            ..Default::default()
        };
        assert_eq!(metric_median(&metric.latency_samples), Some(94));
        assert_eq!(metric_jitter(&metric), Some(66));
        assert_eq!(metric_success_rate(&metric), Some(100));
        assert_eq!(metric_quality(&metric), "稳定");
    }

    #[test]
    fn repeated_failures_push_route_behind_stable_candidate() {
        let stable = RouteMetric {
            latency: Some(180),
            latency_samples: vec![170, 180, 190],
            recent_results: vec![true, true, true],
            last_success_at: Some(current_unix_seconds()),
            ..Default::default()
        };
        let failed = RouteMetric {
            latency: None,
            error: Some("timeout".into()),
            latency_samples: vec![80, 82, 84],
            recent_results: vec![true, false, false],
            consecutive_failures: 2,
            last_failure_at: Some(current_unix_seconds()),
            ..Default::default()
        };
        assert!(metric_candidate_score(Some(&stable)) < metric_candidate_score(Some(&failed)));
        assert_eq!(metric_quality(&failed), "暂不可用");
    }

    #[test]
    fn mihomo_global_mode_protects_lan_and_ignores_legacy_rules() {
        let source: serde_yaml::Value = serde_yaml::from_str(
            r#"
proxy-groups:
  - name: PROXY
    type: select
    proxies: [node]
rules:
  - MATCH,PROXY
"#,
        )
        .unwrap();
        let output =
            inject_mihomo_routing(source, &routing_settings("global", "direct"), false).unwrap();
        let rules = output["rules"].as_sequence().unwrap();
        assert_eq!(rules[0].as_str(), Some("DOMAIN,localhost,DIRECT"));
        assert!(!rules.iter().any(|rule| rule
            .as_str()
            .is_some_and(|value| value.contains("example.com"))));
        assert!(!rules
            .iter()
            .any(|rule| rule.as_str() == Some("GEOIP,CN,DIRECT")));
        assert_eq!(
            rules.last().and_then(serde_yaml::Value::as_str),
            Some("MATCH,PROXY")
        );
        assert_eq!(output["mode"].as_str(), Some("rule"));
        assert_eq!(output["dns"]["enable"].as_bool(), Some(true));
        assert_eq!(output["dns"]["enhanced-mode"].as_str(), Some("redir-host"));
        assert!(output["dns"].get("nameserver-policy").is_none());
    }

    #[test]
    fn singbox_global_mode_uses_proxy_and_protects_private_ips() {
        let source = serde_json::json!({
            "outbounds": [
                { "type": "tuic", "tag": "upstream-node" },
                { "type": "direct", "tag": "direct" }
            ],
            "route": {
                "rules": [{ "inbound": "mixed-in", "action": "sniff" }],
                "final": "upstream-node"
            }
        });
        let output = inject_json_routing(
            &route("sing-box"),
            source,
            &routing_settings("global", "direct"),
            None,
            false,
        )
        .unwrap();
        assert_eq!(output["route"]["final"], "upstream-node");
        assert_eq!(output["route"]["rules"][1]["outbound"], "direct");
        assert_eq!(output["route"]["rules"][1]["ip_is_private"], true);
        assert_eq!(output["dns"]["final"], "proxy-dns");
        assert_eq!(output["dns"]["servers"][0]["tag"], "bootstrap-dns");
        assert_eq!(output["dns"]["servers"][1]["detour"], "direct");
        assert_eq!(output["dns"]["servers"][2]["detour"], "upstream-node");
        assert!(output["outbounds"]
            .as_array()
            .unwrap()
            .iter()
            .any(|outbound| outbound["tag"] == "block"));
    }

    #[test]
    fn xray_global_mode_protects_private_targets_before_proxy_fallback() {
        let source = serde_json::json!({
            "outbounds": [
                { "protocol": "vless", "tag": "node-a" },
                { "protocol": "freedom", "tag": "direct" },
                { "protocol": "blackhole", "tag": "block" }
            ]
        });
        let output = inject_json_routing(
            &route("xray"),
            source,
            &routing_settings("global", "direct"),
            None,
            false,
        )
        .unwrap();
        assert_eq!(output["routing"]["rules"][0]["outboundTag"], "direct");
        assert_eq!(output["routing"]["rules"][1]["outboundTag"], "direct");
        assert_eq!(output["routing"]["rules"][2]["outboundTag"], "node-a");
        assert_eq!(output["dns"]["servers"][0]["domains"][0], "geosite:private");
        assert_eq!(
            output["dns"]["servers"][1]["address"],
            "https://cloudflare-dns.com/dns-query"
        );
        assert_eq!(
            output["outbounds"][1]["settings"]["domainStrategy"],
            "UseIP"
        );
    }

    #[test]
    fn background_upgrade_requires_both_relative_and_absolute_gain() {
        assert!(is_clear_latency_upgrade(600, 399));
        assert!(!is_clear_latency_upgrade(600, 500));
        assert!(!is_clear_latency_upgrade(200, 125));
        assert!(is_clear_latency_upgrade(200, 110));
    }

    #[test]
    fn dynamically_rebindable_cores_join_parallel_probe_pool() {
        for core in [
            "mihomo",
            "xray",
            "sing-box",
            "hysteria",
            "hysteria2",
            "naiveproxy",
            "juicity",
        ] {
            assert!(supports_dynamic_probe(&route(core)), "{core}");
        }
        for core in ["mieru", "shadowquic"] {
            assert!(!supports_dynamic_probe(&route(core)), "{core}");
        }
    }

    #[test]
    fn mihomo_probe_config_uses_isolated_dynamic_port() {
        let path =
            std::env::temp_dir().join(format!("kingo-mihomo-probe-{}.yaml", std::process::id()));
        fs::write(
            &path,
            "mixed-port: 7890\nexternal-controller: 127.0.0.1:9090\nsecret: KiNGO\nproxies: []\nproxy-groups: []\nrules: []\n",
        )
        .expect("write fixture");
        let (generated, temporary) = probe_config_for_port(
            &route("mihomo"),
            path.to_str().expect("fixture path"),
            17890,
        )
        .expect("generate dynamic config");
        assert!(temporary);
        let content = fs::read_to_string(&generated).expect("read dynamic config");
        assert!(content.contains("mixed-port: 17890"));
        assert!(!content.contains("external-controller"));
        assert!(!content.contains("secret:"));
        let _ = fs::remove_file(path);
        let _ = fs::remove_file(generated);
    }

    #[test]
    fn community_connection_keeps_its_isolated_ports() {
        let path = std::env::temp_dir().join(format!(
            "kingo-community-connection-{}.yaml",
            std::process::id()
        ));
        fs::write(
            &path,
            "mixed-port: 17891\nexternal-controller: 127.0.0.1:19091\nsecret: KiNGO\nproxies: []\nproxy-groups: []\nrules: []\n",
        )
        .expect("write fixture");
        ensure_mihomo_controller(&path, 17891, 19091).expect("normalize community config");
        let content = fs::read_to_string(&path).expect("read normalized config");
        assert!(content.contains("mixed-port: 17891"));
        assert!(content.contains("external-controller: 127.0.0.1:19091"));

        let mut community = route("mihomo");
        community.id = "community:test".into();
        community.slot = 17891;
        assert_eq!(proxy_port(&community), 17891);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn connection_validation_keeps_primary_and_fallback_urls_in_order() {
        let settings = SpeedTestSettings {
            url: "https://primary.example/204".into(),
            fallback_urls: vec![
                "https://backup.example/204".into(),
                "https://primary.example/204".into(),
            ],
            download_url: default_download_test_url(),
            timeout_seconds: 4,
            concurrency: 2,
        };
        assert_eq!(
            settings.latency_urls(),
            vec![
                "https://primary.example/204".to_string(),
                "https://backup.example/204".to_string(),
            ]
        );
    }

    #[test]
    fn connection_validation_uses_backup_after_primary_fails() {
        let urls = vec!["primary".to_string(), "backup".to_string()];
        let mut attempted = Vec::new();
        let latency = first_successful_latency(&urls, |url| {
            attempted.push(url.to_string());
            if url == "primary" {
                Err("timeout".into())
            } else {
                Ok(86)
            }
        })
        .expect("backup endpoint should keep the connection valid");
        assert_eq!(latency, 86);
        assert_eq!(attempted, urls);
    }

    #[cfg(windows)]
    #[test]
    fn bundled_mihomo_accepts_generated_rule_config() {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let executable = manifest.join("resources/cores/mihomo/mihomo.exe");
        if !executable.is_file() {
            return;
        }
        let source: serde_yaml::Value = serde_yaml::from_str(include_str!(
            "../resources/route-configs/mihomo/slot_1_config.yaml"
        ))
        .unwrap();
        let output =
            inject_mihomo_routing(source, &routing_settings("rule", "direct"), true).unwrap();
        assert_eq!(output["geodata-mode"].as_bool(), Some(true));
        assert_eq!(output["geodata-loader"].as_str(), Some("memconservative"));
        assert_eq!(output["geo-auto-update"].as_bool(), Some(false));
        assert_eq!(output["tun"]["enable"].as_bool(), Some(true));
        assert_eq!(output["tun"]["strict-route"].as_bool(), Some(true));
        let directory =
            std::env::temp_dir().join(format!("kingo-routing-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        fs::copy(
            manifest.join("resources/cores/xray/geoip.dat"),
            directory.join("geoip.dat"),
        )
        .unwrap();
        fs::copy(
            manifest.join("resources/cores/xray/geosite.dat"),
            directory.join("geosite.dat"),
        )
        .unwrap();
        let config = directory.join("config.runtime.yaml");
        fs::write(&config, serde_yaml::to_string(&output).unwrap()).unwrap();
        let result = std::process::Command::new(executable)
            .args([
                "-t",
                "-d",
                directory.to_string_lossy().as_ref(),
                "-f",
                config.to_string_lossy().as_ref(),
            ])
            .output()
            .unwrap();
        let _ = fs::remove_dir_all(&directory);
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
    }

    #[cfg(windows)]
    #[test]
    fn bundled_json_cores_accept_generated_global_config() {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let cases = [
            (
                "xray",
                manifest.join("resources/cores/xray/xray.exe"),
                include_str!("../resources/route-configs/xray/slot_1_config.json"),
            ),
            (
                "sing-box",
                manifest.join("resources/cores/sing-box/sing-box.exe"),
                include_str!("../resources/route-configs/sing-box/slot_1_config.json"),
            ),
        ];
        for (core_id, executable, source) in cases {
            if !executable.is_file() {
                continue;
            }
            let source: serde_json::Value = serde_json::from_str(source).unwrap();
            let output = inject_json_routing(
                &route(core_id),
                source,
                &routing_settings("global", "direct"),
                None,
                false,
            )
            .unwrap();
            let directory = std::env::temp_dir().join(format!(
                "kingo-routing-test-{core_id}-{}",
                std::process::id()
            ));
            let _ = fs::remove_dir_all(&directory);
            fs::create_dir_all(&directory).unwrap();
            let config = directory.join("config.runtime.json");
            fs::write(&config, serde_json::to_vec_pretty(&output).unwrap()).unwrap();
            let mut command = std::process::Command::new(&executable);
            command.current_dir(executable.parent().unwrap());
            if core_id == "xray" {
                command.args(["run", "-test", "-config", config.to_string_lossy().as_ref()]);
            } else {
                command.args(["check", "-c", config.to_string_lossy().as_ref()]);
            }
            let result = command.output().unwrap();
            let _ = fs::remove_dir_all(&directory);
            assert!(
                result.status.success(),
                "{core_id}: {}",
                String::from_utf8_lossy(&result.stderr)
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn bundled_singbox_accepts_generated_country_rule_mode() {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let executable = manifest.join("resources/cores/sing-box/sing-box.exe");
        if !executable.is_file() {
            return;
        }
        let directory =
            std::env::temp_dir().join(format!("kingo-singbox-rule-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        let country_rules = directory.join("kingo-cn.json");
        fs::write(
            &country_rules,
            serde_json::to_vec(&serde_json::json!({
                "version": 3,
                "rules": [{ "domain_suffix": ["cn"], "ip_cidr": ["223.5.5.0/24"] }]
            }))
            .unwrap(),
        )
        .unwrap();
        let source: serde_json::Value = serde_json::from_str(include_str!(
            "../resources/route-configs/sing-box/slot_1_config.json"
        ))
        .unwrap();
        let output = inject_json_routing(
            &route("sing-box"),
            source,
            &routing_settings("rule", "direct"),
            country_rules.to_str(),
            true,
        )
        .unwrap();
        assert_eq!(output["inbounds"][0]["type"], "tun");
        assert_eq!(output["inbounds"][0]["strict_route"], true);
        let config = directory.join("config.runtime.json");
        fs::write(&config, serde_json::to_vec_pretty(&output).unwrap()).unwrap();
        let result = std::process::Command::new(&executable)
            .current_dir(executable.parent().unwrap())
            .args(["check", "-c", config.to_string_lossy().as_ref()])
            .output()
            .unwrap();
        let _ = fs::remove_dir_all(&directory);
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
    }
}
