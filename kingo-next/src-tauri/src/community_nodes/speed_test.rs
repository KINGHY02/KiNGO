use super::{
    models::CommunityNodeCandidate,
    probe::{available_port_pair, wait_port, write_config},
    store,
};
use crate::core_runtime;
use std::{
    collections::HashSet,
    io::Read,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    time::{Duration, Instant},
};
use tauri::AppHandle;

#[derive(Clone, Debug)]
pub struct SpeedResult {
    pub speed_kbps: Option<u64>,
    pub country_code: Option<String>,
    pub country_name: Option<String>,
    pub exit_ip: Option<String>,
    pub error_code: Option<String>,
    pub error_detail: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ExitIdentity {
    ip: String,
    country_code: String,
    country_name: Option<String>,
}

fn select_node(
    client: &reqwest::blocking::Client,
    controller: u16,
    node_id: &str,
) -> Result<(), String> {
    client
        .put(format!("http://127.0.0.1:{controller}/proxies/COMMUNITY"))
        .json(&serde_json::json!({ "name": node_id }))
        .send()
        .and_then(|response| response.error_for_status())
        .map(|_| ())
        .map_err(|error| format!("切换测试节点失败：{error}"))
}

fn response_ip(value: &serde_json::Value) -> Option<String> {
    value
        .get("ip")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn response_text(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn parse_exit_identity(value: &serde_json::Value) -> Option<ExitIdentity> {
    if value.get("success").and_then(|value| value.as_bool()) == Some(false) {
        return None;
    }
    let ip = response_ip(value)?;
    let country = response_text(value, "country");
    let country_code = response_text(value, "countryCode")
        .or_else(|| response_text(value, "country_code"))
        .or_else(|| {
            country
                .as_ref()
                .filter(|value| value.len() == 2 && value.chars().all(|c| c.is_ascii_alphabetic()))
                .cloned()
        })?;
    if country_code.len() != 2 || !country_code.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    let country_name = country.filter(|value| value.len() > 2);
    Some(ExitIdentity {
        ip,
        country_code: country_code.to_ascii_uppercase(),
        country_name,
    })
}

fn query_exit_identity(client: &reqwest::blocking::Client) -> Option<ExitIdentity> {
    let mut code_only_fallback = None;
    for url in [
        "https://my.ippure.com/v1/info",
        "https://api.country.is/",
        "https://ipwho.is/",
    ] {
        let value = client
            .get(url)
            .timeout(Duration::from_secs(5))
            .send()
            .and_then(|response| response.error_for_status())
            .and_then(|response| response.json::<serde_json::Value>())
            .ok();
        if let Some(identity) = value.as_ref().and_then(parse_exit_identity) {
            let translated = crate::services::country_name_zh(Some(&identity.country_code), None);
            if identity.country_name.is_some() || translated != "未知地区" {
                return Some(identity);
            }
            code_only_fallback = Some(identity);
        }
    }
    code_only_fallback
}

fn matches_direct_exit(exit_ip: Option<&str>, direct_ips: &HashSet<String>) -> bool {
    exit_ip.is_some_and(|exit_ip| direct_ips.contains(exit_ip))
}

fn direct_exit_ips() -> HashSet<String> {
    let Ok(client) = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(4))
        .no_proxy()
        .build()
    else {
        return HashSet::new();
    };
    let mut ips = HashSet::new();
    for url in [
        "https://my.ippure.com/v1/info",
        "https://api.country.is/",
        "https://api4.ipify.org?format=json",
        "https://api6.ipify.org?format=json",
    ] {
        let ip = client
            .get(url)
            .send()
            .and_then(|response| response.error_for_status())
            .and_then(|response| response.json::<serde_json::Value>())
            .ok()
            .as_ref()
            .and_then(response_ip);
        if let Some(ip) = ip {
            ips.insert(ip);
        }
    }
    ips
}

fn proxy_client(mixed_port: u16, timeout: Duration) -> Result<reqwest::blocking::Client, String> {
    let proxy = reqwest::Proxy::all(format!("http://127.0.0.1:{mixed_port}"))
        .map_err(|error| error.to_string())?;
    reqwest::blocking::Client::builder()
        .timeout(timeout)
        .no_proxy()
        .proxy(proxy)
        .build()
        .map_err(|error| error.to_string())
}

#[allow(clippy::result_large_err)]
fn verified_exit(
    client: &reqwest::blocking::Client,
    direct_ips: &HashSet<String>,
) -> Result<ExitIdentity, SpeedResult> {
    if direct_ips.is_empty() {
        return Err(failed(
            "direct_baseline_unavailable",
            "无法取得本机 IPv4/IPv6 出口基线，本次检测已停止",
        ));
    }
    let Some(exit) = query_exit_identity(client) else {
        return Err(failed(
            "exit_verification_failed",
            "无法通过该节点取得可靠的出口 IP 与国家信息",
        ));
    };
    if matches_direct_exit(Some(&exit.ip), direct_ips) {
        return Err(failed(
            "proxy_bypass_detected",
            "出口识别返回了本机公网 IP，节点未通过代理隔离校验",
        ));
    }
    Ok(exit)
}

fn download_test(
    mixed_port: u16,
    url: &str,
    timeout: Duration,
    direct_ips: &HashSet<String>,
    max_bytes: u64,
) -> SpeedResult {
    let client = match proxy_client(mixed_port, timeout) {
        Ok(client) => client,
        Err(error) => return failed("speed_client_failed", &error),
    };
    // Verify the actual egress before consuming the speed-test payload.
    let exit = match verified_exit(&client, direct_ips) {
        Ok(exit) => exit,
        Err(result) => return result,
    };
    let started = Instant::now();
    let mut response = match client
        .get(url)
        .header(
            reqwest::header::RANGE,
            format!("bytes=0-{}", max_bytes.saturating_sub(1)),
        )
        .send()
    {
        Ok(response) if response.status().is_success() => response,
        Ok(response) if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS => {
            return failed(
                "speed_provider_rate_limited",
                "测速服务请求过多，请稍后重试",
            );
        }
        Ok(response) => {
            return failed(
                "speed_download_http_failed",
                &format!("测速地址返回 HTTP {}", response.status()),
            );
        }
        Err(error) => return failed("speed_download_failed", &error.to_string()),
    };
    let mut buffer = [0u8; 64 * 1024];
    let mut bytes = 0u64;
    loop {
        match response.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => {
                bytes = bytes.saturating_add(count as u64);
                if bytes >= max_bytes {
                    break;
                }
            }
            Err(error) => {
                if bytes == 0 {
                    return failed("speed_read_failed", &error.to_string());
                }
                break;
            }
        }
    }
    let elapsed = started.elapsed().as_secs_f64();
    if bytes == 0 || elapsed <= 0.0 {
        return failed("speed_empty", "测速未收到有效数据");
    }
    SpeedResult {
        speed_kbps: Some(((bytes as f64 / 1024.0) / elapsed).round() as u64),
        country_code: Some(exit.country_code),
        country_name: exit.country_name,
        exit_ip: Some(exit.ip),
        error_code: None,
        error_detail: None,
    }
}

#[cfg(test)]
#[allow(clippy::items_after_test_module)]
mod tests {
    use super::*;

    #[test]
    fn dual_stack_direct_exit_matches_either_address_family() {
        let direct = HashSet::from([
            "183.11.70.109".to_string(),
            "240e:3b1:3470:d470::1".to_string(),
        ]);
        assert!(matches_direct_exit(Some("183.11.70.109"), &direct));
        assert!(matches_direct_exit(Some("240e:3b1:3470:d470::1"), &direct));
        assert!(!matches_direct_exit(Some("8.8.8.8"), &direct));
        assert!(!matches_direct_exit(None, &direct));
    }

    #[test]
    fn parses_primary_ippure_exit_response() {
        let value = serde_json::json!({
            "ip": "203.0.113.8",
            "country": "Japan",
            "countryCode": "jp",
            "city": "Tokyo"
        });
        assert_eq!(
            parse_exit_identity(&value),
            Some(ExitIdentity {
                ip: "203.0.113.8".into(),
                country_code: "JP".into(),
                country_name: Some("Japan".into()),
            })
        );
    }

    #[test]
    fn parses_both_fallback_provider_formats() {
        let country_is = serde_json::json!({"ip": "203.0.113.9", "country": "DE"});
        assert_eq!(parse_exit_identity(&country_is).unwrap().country_code, "DE");
        let ipwho = serde_json::json!({
            "success": true,
            "ip": "203.0.113.10",
            "country": "Mexico",
            "country_code": "MX"
        });
        let parsed = parse_exit_identity(&ipwho).unwrap();
        assert_eq!(parsed.country_code, "MX");
        assert_eq!(parsed.country_name.as_deref(), Some("Mexico"));
    }

    #[test]
    fn rejects_failed_or_incomplete_exit_responses() {
        assert!(parse_exit_identity(
            &serde_json::json!({"success": false, "ip": "1.1.1.1", "country_code": "US"})
        )
        .is_none());
        assert!(
            parse_exit_identity(&serde_json::json!({"ip": "1.1.1.1", "country": "Unknown"}))
                .is_none()
        );
    }
}

fn failed(code: &str, detail: &str) -> SpeedResult {
    SpeedResult {
        speed_kbps: None,
        country_code: None,
        country_name: None,
        exit_ip: None,
        error_code: Some(code.into()),
        error_detail: Some(detail.into()),
    }
}

#[allow(clippy::too_many_arguments)]
fn run_worker(
    app: AppHandle,
    job_id: String,
    worker: usize,
    nodes: Vec<CommunityNodeCandidate>,
    url: String,
    timeout: Duration,
    cancel: std::sync::Arc<AtomicBool>,
    environment_invalid: std::sync::Arc<AtomicBool>,
    paused: std::sync::Arc<AtomicBool>,
    direct_ips: Arc<HashSet<String>>,
    max_bytes: u64,
    sender: mpsc::Sender<SpeedResult>,
) {
    if nodes.is_empty() {
        return;
    }
    let directory = match store::runtime_directory(&app, &job_id) {
        Ok(directory) => directory,
        Err(error) => {
            for _ in nodes {
                let _ = sender.send(failed("runtime_directory_failed", &error));
            }
            return;
        }
    };
    let (mixed, controller) = match available_port_pair() {
        Ok(ports) => ports,
        Err(error) => {
            for _ in nodes {
                let _ = sender.send(failed("port_unavailable", &error));
            }
            return;
        }
    };
    let config = match write_config(
        &directory,
        &format!("speed-{worker}"),
        &nodes,
        mixed,
        controller,
    ) {
        Ok(config) => config,
        Err(error) => {
            for _ in nodes {
                let _ = sender.send(failed("config_failed", &error));
            }
            return;
        }
    };
    let config_path = config.to_string_lossy().into_owned();
    let mut child = match core_runtime::spawn_transient(&app, "mihomo", &config_path) {
        Ok(child) => child,
        Err(error) => {
            let _ = std::fs::remove_file(&config);
            for _ in nodes {
                let _ = sender.send(failed("core_failed", &error));
            }
            return;
        }
    };
    if let Err(error) = wait_port(controller, &mut child) {
        let _ = child.kill();
        let _ = child.wait();
        let _ = std::fs::remove_file(&config);
        for _ in nodes {
            let _ = sender.send(failed("core_failed", &error));
        }
        return;
    }
    let controller_client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(3))
        .no_proxy()
        .build();
    for node in nodes {
        while paused.load(Ordering::SeqCst)
            && !cancel.load(Ordering::SeqCst)
            && !environment_invalid.load(Ordering::SeqCst)
        {
            std::thread::sleep(Duration::from_millis(120));
        }
        if cancel.load(Ordering::SeqCst) || environment_invalid.load(Ordering::SeqCst) {
            break;
        }
        let result = match &controller_client {
            Ok(client) => match select_node(client, controller, &node.id) {
                Ok(()) => download_test(mixed, &url, timeout, direct_ips.as_ref(), max_bytes),
                Err(error) => failed("speed_select_failed", &error),
            },
            Err(error) => failed("speed_controller_failed", &error.to_string()),
        };
        if sender.send(result).is_err() {
            break;
        }
    }
    let _ = child.kill();
    let _ = child.wait();
    let _ = std::fs::remove_file(&config);
}

#[allow(clippy::too_many_arguments)]
pub fn test_nodes(
    app: &AppHandle,
    job_id: &str,
    nodes: &[CommunityNodeCandidate],
    url: &str,
    concurrency: usize,
    timeout: Duration,
    max_bytes: u64,
    cancel: std::sync::Arc<AtomicBool>,
    environment_invalid: std::sync::Arc<AtomicBool>,
    paused: std::sync::Arc<AtomicBool>,
    mut on_result: impl FnMut(&SpeedResult),
) -> Vec<SpeedResult> {
    if nodes.is_empty() {
        return Vec::new();
    }
    // Use one frozen IPv4/IPv6 baseline for the whole run. A per-worker
    // baseline made isolation decisions inconsistent and multiplied lookups.
    let direct_ips = Arc::new(direct_exit_ips());
    if direct_ips.is_empty() {
        return nodes
            .iter()
            .map(|_| {
                let result = failed(
                    "direct_baseline_unavailable",
                    "无法取得本机 IPv4/IPv6 出口基线，本次测速已停止，未保存可能被污染的结果",
                );
                on_result(&result);
                result
            })
            .collect();
    }
    let workers = concurrency.clamp(1, 8).min(nodes.len());
    let mut partitions = vec![Vec::new(); workers];
    for (index, node) in nodes.iter().cloned().enumerate() {
        partitions[index % workers].push(node);
    }
    let (sender, receiver) = mpsc::channel();
    for (worker, nodes) in partitions.into_iter().enumerate() {
        let app = app.clone();
        let job_id = job_id.to_string();
        let url = url.to_string();
        let sender = sender.clone();
        let cancel = cancel.clone();
        let environment_invalid = environment_invalid.clone();
        let paused = paused.clone();
        let direct_ips = direct_ips.clone();
        std::thread::spawn(move || {
            run_worker(
                app,
                job_id,
                worker,
                nodes,
                url,
                timeout,
                cancel,
                environment_invalid,
                paused,
                direct_ips,
                max_bytes.max(64 * 1024),
                sender,
            )
        });
    }
    drop(sender);
    let mut results = Vec::with_capacity(nodes.len());
    for result in receiver {
        on_result(&result);
        results.push(result);
    }
    results
}
