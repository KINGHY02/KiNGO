mod config;
mod formatter;
mod models;
mod parser;
mod qr;
mod settings;
mod store;

pub use models::*;
pub use settings::V2raySettings;

use crate::{core_runtime, process_utils::hidden_command, services, system_proxy};
use std::{
    collections::VecDeque,
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream, ToSocketAddrs, UdpSocket},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

static TEST_CANCELLED: AtomicBool = AtomicBool::new(false);
static TEST_RUNNING: AtomicBool = AtomicBool::new(false);

pub fn get_settings(app: &AppHandle) -> V2raySettings {
    settings::load(app)
}

pub fn save_settings(app: &AppHandle, value: V2raySettings) -> Result<V2raySettings, String> {
    settings::save(app, value)
}

pub fn start_subscription_scheduler(app: AppHandle) {
    settings::start_subscription_scheduler(app);
}

fn parse_many(text: &str) -> (Vec<ParsedNode>, Vec<String>) {
    let mut nodes = Vec::new();
    let mut errors = Vec::new();
    for (index, line) in parser::subscription_lines(text).into_iter().enumerate() {
        match parser::parse_line(&line) {
            Ok(node) => nodes.push(node),
            Err(error) => errors.push(format!("第 {} 行：{}", index + 1, error)),
        }
    }
    (nodes, errors)
}

fn download_subscription(subscription: &V2raySubscription) -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(25))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|error| format!("创建订阅请求失败：{error}"))?;
    let configured = subscription.user_agent.trim();
    let fallback = "v2rayN/7.12.5";
    let user_agents = if configured.is_empty() || configured == fallback {
        vec![fallback]
    } else {
        vec![configured, fallback]
    };
    let mut last_error = String::new();
    for attempt in 0..3 {
        let user_agent = user_agents[attempt % user_agents.len()];
        let response = client
            .get(&subscription.url)
            .header("User-Agent", user_agent)
            .header("Accept", "text/plain,application/octet-stream,*/*")
            .send();
        let mut response = match response {
            Ok(response) if response.status().is_success() => response,
            Ok(response) => {
                last_error = format!("HTTP {}", response.status());
                continue;
            }
            Err(error) => {
                last_error = error.to_string();
                continue;
            }
        };
        if response
            .content_length()
            .is_some_and(|size| size > 5 * 1024 * 1024)
        {
            return Err("订阅响应超过 5 MiB 安全限制".into());
        }
        let mut bytes = Vec::new();
        if let Err(error) = response
            .by_ref()
            .take(5 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
        {
            last_error = format!("读取响应失败：{error}");
            continue;
        }
        if bytes.len() > 5 * 1024 * 1024 {
            return Err("订阅响应超过 5 MiB 安全限制".into());
        }
        let content = match String::from_utf8(bytes) {
            Ok(content) => content,
            Err(_) => return Err("订阅内容不是 UTF-8 文本".into()),
        };
        let normalized = content.trim_start().to_ascii_lowercase();
        if normalized.starts_with("<!doctype html") || normalized.starts_with("<html") {
            last_error = "服务端返回了网页而不是订阅内容".into();
            continue;
        }
        if !content.trim().is_empty() {
            return Ok(content);
        }
        last_error = "订阅响应为空".into();
    }
    Err(format!("下载订阅失败（已重试 3 次）：{last_error}"))
}

pub fn list_nodes(
    app: &AppHandle,
    subscription_id: Option<String>,
) -> Result<Vec<V2rayNode>, String> {
    store::list_nodes(app, subscription_id.as_deref())
}

pub fn import_nodes(app: &AppHandle, text: String) -> Result<ImportResult, String> {
    let lines = parser::subscription_lines(&text);
    let mut node_lines = Vec::new();
    let mut subscription_urls = Vec::new();
    for line in lines {
        if line.starts_with("https://") || line.starts_with("http://") {
            subscription_urls.push(line);
        } else {
            node_lines.push(line);
        }
    }
    let (parsed, mut errors) = parse_many(&node_lines.join("\n"));
    if parsed.is_empty() && subscription_urls.is_empty() {
        return Err(errors
            .first()
            .cloned()
            .unwrap_or_else(|| "没有识别到支持的节点、订阅或配置".into()));
    }
    let requested = parsed.len();
    let ids = store::import_nodes(app, &parsed, None)?;
    let nodes = ids
        .iter()
        .filter_map(|id| store::get_node(app, id).ok())
        .collect::<Vec<_>>();
    let mut subscriptions = Vec::new();
    for url in subscription_urls {
        let subscription = match store::find_subscription_by_url(app, &url)? {
            Some(existing) => existing,
            None => {
                let name = url::Url::parse(&url)
                    .ok()
                    .and_then(|parsed| {
                        parsed
                            .query_pairs()
                            .find(|(key, _)| key == "remarks")
                            .map(|(_, value)| value.into_owned())
                            .or_else(|| parsed.host_str().map(str::to_string))
                    })
                    .unwrap_or_else(|| "导入订阅".into());
                store::add_subscription(app, &name, &url, Some("v2rayN/7.22.7"))?
            }
        };
        match update_subscription(app, subscription.id.clone()) {
            Ok(result) => subscriptions.push(result),
            Err(error) => errors.push(format!("订阅“{}”更新失败：{error}", subscription.name)),
        }
    }
    Ok(ImportResult {
        imported: nodes.len(),
        skipped: requested.saturating_sub(nodes.len()),
        errors,
        nodes,
        subscriptions,
    })
}

pub fn decode_qr_image(app: &AppHandle, bytes: Vec<u8>) -> Result<ImportResult, String> {
    import_nodes(app, qr::decode_image(&bytes)?.join("\n"))
}

pub fn scan_qr_screens(app: &AppHandle) -> Result<ImportResult, String> {
    import_nodes(app, qr::scan_screens()?.join("\n"))
}

pub fn create_node(app: &AppHandle, input: NodeUpdateInput) -> Result<V2rayNode, String> {
    store::create_node(app, &input)
}

pub fn delete_nodes(app: &AppHandle, node_ids: Vec<String>) -> Result<usize, String> {
    if node_ids.is_empty() {
        return Ok(0);
    }
    store::delete_nodes(app, &node_ids)
}

pub fn set_active_node(app: &AppHandle, node_id: String) -> Result<V2rayNode, String> {
    store::set_active(app, &node_id)
}

pub fn update_node(
    app: &AppHandle,
    node_id: String,
    input: NodeUpdateInput,
) -> Result<V2rayNode, String> {
    store::update_node(app, &node_id, &input)
}

pub fn move_nodes(
    app: &AppHandle,
    node_ids: Vec<String>,
    direction: String,
) -> Result<Vec<V2rayNode>, String> {
    store::move_nodes(app, &node_ids, &direction)
}

pub fn reorder_nodes(app: &AppHandle, node_ids: Vec<String>) -> Result<Vec<V2rayNode>, String> {
    store::reorder_nodes(app, &node_ids)
}

pub fn sort_nodes(app: &AppHandle, by: String) -> Result<Vec<V2rayNode>, String> {
    store::sort_nodes(app, &by)
}

pub fn duplicate_node(app: &AppHandle, node_id: String) -> Result<V2rayNode, String> {
    store::duplicate_node(app, &node_id)
}

pub fn move_node_group(
    app: &AppHandle,
    node_id: String,
    subscription_id: Option<String>,
) -> Result<V2rayNode, String> {
    store::move_node_group(app, &node_id, subscription_id.as_deref())
}

pub fn remove_duplicates(app: &AppHandle) -> Result<usize, String> {
    store::remove_duplicates(app)
}

pub fn share_nodes(app: &AppHandle, node_ids: Vec<String>) -> Result<Vec<NodeShare>, String> {
    let nodes = if node_ids.is_empty() {
        store::list_nodes(app, None)?
    } else {
        node_ids
            .iter()
            .map(|id| store::get_node(app, id))
            .collect::<Result<Vec<_>, _>>()?
    };
    nodes
        .into_iter()
        .map(|node| {
            Ok(NodeShare {
                node_id: node.id.clone(),
                name: node.name.clone(),
                link: formatter::share_link(&node)?,
            })
        })
        .collect()
}

pub fn export_nodes(app: &AppHandle, node_ids: Vec<String>) -> Result<String, String> {
    let content = share_nodes(app, node_ids)?
        .into_iter()
        .map(|item| item.link)
        .collect::<Vec<_>>()
        .join("\n");
    if content.is_empty() {
        return Err("没有可导出的节点".into());
    }
    let directory = std::path::PathBuf::from(crate::paths::ensure(app)?.data_dir).join("exports");
    std::fs::create_dir_all(&directory).map_err(|error| format!("创建导出目录失败：{error}"))?;
    let path = directory.join(format!("v2ray-nodes-{}.txt", store::now()));
    std::fs::write(&path, content).map_err(|error| format!("导出节点失败：{error}"))?;
    Ok(path.to_string_lossy().into_owned())
}

pub fn node_qr_svg(app: &AppHandle, node_id: String) -> Result<String, String> {
    let node = store::get_node(app, &node_id)?;
    let link = formatter::share_link(&node)?;
    qrcode::QrCode::new(link.as_bytes())
        .map_err(|error| format!("生成二维码失败：{error}"))
        .map(|code| {
            code.render::<qrcode::render::svg::Color>()
                .min_dimensions(260, 260)
                .dark_color(qrcode::render::svg::Color("#102a43"))
                .light_color(qrcode::render::svg::Color("#ffffff"))
                .build()
        })
}

pub fn list_subscriptions(app: &AppHandle) -> Result<Vec<V2raySubscription>, String> {
    store::list_subscriptions(app)
}

pub fn add_subscription(
    app: &AppHandle,
    name: String,
    url: String,
    user_agent: Option<String>,
) -> Result<V2raySubscription, String> {
    store::add_subscription(app, &name, &url, user_agent.as_deref())
}

pub fn update_subscription_settings(
    app: &AppHandle,
    subscription_id: String,
    input: SubscriptionUpdateInput,
) -> Result<V2raySubscription, String> {
    store::update_subscription_settings(app, &subscription_id, &input)
}

pub fn update_subscription(
    app: &AppHandle,
    subscription_id: String,
) -> Result<SubscriptionUpdateResult, String> {
    let subscription = store::get_subscription(app, &subscription_id)?;
    let content = match download_subscription(&subscription) {
        Ok(value) => value,
        Err(error) => {
            let _ = store::set_subscription_error(app, &subscription_id, Some(&error));
            return Err(error);
        }
    };
    let (mut parsed, errors) = parse_many(&content);
    if let Some(filter) = subscription
        .filter
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        parsed.retain(|node| node.name.contains(filter));
    }
    if parsed.is_empty() {
        let error = errors
            .first()
            .cloned()
            .unwrap_or_else(|| "订阅中没有可用节点".into());
        let _ = store::set_subscription_error(app, &subscription_id, Some(&error));
        return Err(error);
    }
    let total = parsed.len();
    let ids = store::replace_subscription_nodes(app, &subscription_id, &parsed)?;
    let subscription = store::get_subscription(app, &subscription_id)?;
    Ok(SubscriptionUpdateResult {
        subscription,
        imported: ids.len(),
        skipped: total.saturating_sub(ids.len()),
        errors,
    })
}

pub fn update_all_subscriptions(app: &AppHandle) -> Result<SubscriptionBatchResult, String> {
    let subscriptions = store::list_subscriptions(app)?;
    let mut updated = Vec::new();
    let mut errors = Vec::new();
    for subscription in subscriptions.into_iter().filter(|item| item.enabled) {
        match update_subscription(app, subscription.id) {
            Ok(result) => updated.push(result),
            Err(error) => errors.push(format!("{}: {error}", subscription.name)),
        }
    }
    Ok(SubscriptionBatchResult { updated, errors })
}

pub fn delete_subscription(app: &AppHandle, subscription_id: String) -> Result<(), String> {
    store::delete_subscription(app, &subscription_id)
}

#[allow(dead_code)]
fn curl_proxy_output(
    port: u16,
    url: &str,
    timeout: u32,
    write_out: Option<&str>,
) -> Result<String, String> {
    let timeout = timeout.to_string();
    let proxy = format!("socks5h://127.0.0.1:{port}");
    let mut command = hidden_command("curl.exe");
    command.args([
        "-fsS",
        "--connect-timeout",
        &timeout,
        "--max-time",
        &timeout,
        "--proxy",
        &proxy,
    ]);
    if let Some(format) = write_out {
        command.args(["-o", "NUL", "-w", format]);
    }
    let output = command
        .arg(url)
        .output()
        .map_err(|error| format!("启动代理请求失败：{error}"))?;
    if !output.status.success() {
        return Err(format!("代理请求失败：{}", output.status));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn curl_proxy_output_cancelable(
    port: u16,
    url: &str,
    timeout: u32,
    write_out: Option<&str>,
) -> Result<String, String> {
    let timeout = timeout.to_string();
    let proxy = format!("socks5h://127.0.0.1:{port}");
    let mut command = hidden_command("curl.exe");
    command.args([
        "-fsS",
        "--connect-timeout",
        &timeout,
        "--max-time",
        &timeout,
        "--proxy",
        &proxy,
    ]);
    if let Some(format) = write_out {
        command.args(["-o", "NUL", "-w", format]);
    }
    let mut child = command
        .arg(url)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("启动代理请求失败：{error}"))?;
    loop {
        if TEST_CANCELLED.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("测速已取消".into());
        }
        if child
            .try_wait()
            .map_err(|error| format!("读取代理请求状态失败：{error}"))?
            .is_some()
        {
            break;
        }
        std::thread::sleep(Duration::from_millis(80));
    }
    let output = child
        .wait_with_output()
        .map_err(|error| format!("读取代理请求结果失败：{error}"))?;
    if !output.status.success() {
        return Err(format!("代理请求失败：{}", output.status));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn real_delay(port: u16, url: &str, timeout: u32) -> Result<u32, String> {
    let mut samples = Vec::new();
    for _ in 0..2 {
        let seconds = curl_proxy_output_cancelable(port, url, timeout, Some("%{time_total}"))?
            .parse::<f64>()
            .map_err(|_| "测速返回了无效耗时".to_string())?;
        samples.push((seconds * 1000.0).round().max(1.0) as u32);
        std::thread::sleep(Duration::from_millis(100));
    }
    samples.into_iter().min().ok_or("真实延迟测试失败".into())
}

fn exit_ip_info(port: u16, url: &str, timeout: u32) -> Option<String> {
    let content = curl_proxy_output_cancelable(port, url, timeout, None).ok()?;
    let value = serde_json::from_str::<serde_json::Value>(&content).ok();
    if let Some(value) = value {
        let ip = value
            .get("ip")
            .or_else(|| value.get("query"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        let country = value
            .get("country_code")
            .or_else(|| value.get("countryCode"))
            .or_else(|| value.get("country"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        return Some(match (country.is_empty(), ip.is_empty()) {
            (false, false) => format!("{country} · {ip}"),
            (true, false) => ip.to_string(),
            (false, true) => country.to_string(),
            (true, true) => content,
        });
    }
    (!content.is_empty()).then_some(content)
}

fn download_speed(port: u16, url: &str, timeout: u32) -> Result<u64, String> {
    let value = curl_proxy_output_cancelable(port, url, timeout, Some("%{speed_download}"))?
        .parse::<f64>()
        .map_err(|_| "下载测速返回了无效速度".to_string())?;
    if value <= 0.0 {
        Err("下载测速没有收到数据".into())
    } else {
        Ok(value.round() as u64)
    }
}

fn read_socks_address(stream: &mut TcpStream, atyp: u8) -> Result<SocketAddr, String> {
    let ip = match atyp {
        1 => {
            let mut bytes = [0_u8; 4];
            stream
                .read_exact(&mut bytes)
                .map_err(|error| error.to_string())?;
            std::net::IpAddr::V4(bytes.into())
        }
        4 => {
            let mut bytes = [0_u8; 16];
            stream
                .read_exact(&mut bytes)
                .map_err(|error| error.to_string())?;
            std::net::IpAddr::V6(bytes.into())
        }
        _ => return Err("SOCKS UDP中继返回了不支持的地址类型".into()),
    };
    let mut port = [0_u8; 2];
    stream
        .read_exact(&mut port)
        .map_err(|error| error.to_string())?;
    Ok(SocketAddr::new(ip, u16::from_be_bytes(port)))
}

fn udp_delay(port: u16, target: &str) -> Result<u32, String> {
    let target = target
        .parse::<SocketAddr>()
        .map_err(|_| "UDP测试目标格式无效".to_string())?;
    let mut control = TcpStream::connect_timeout(
        &SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_secs(5),
    )
    .map_err(|error| format!("连接SOCKS UDP入口失败：{error}"))?;
    control
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| error.to_string())?;
    control
        .write_all(&[5, 1, 0])
        .map_err(|error| error.to_string())?;
    let mut greeting = [0_u8; 2];
    control
        .read_exact(&mut greeting)
        .map_err(|error| error.to_string())?;
    if greeting != [5, 0] {
        return Err("SOCKS入口不支持无认证UDP测试".into());
    }
    control
        .write_all(&[5, 3, 0, 1, 0, 0, 0, 0, 0, 0])
        .map_err(|error| error.to_string())?;
    let mut header = [0_u8; 4];
    control
        .read_exact(&mut header)
        .map_err(|error| error.to_string())?;
    if header[1] != 0 {
        return Err(format!("SOCKS UDP关联失败：代码{}", header[1]));
    }
    let mut relay = read_socks_address(&mut control, header[3])?;
    if relay.ip().is_unspecified() {
        relay.set_ip(control.peer_addr().map_err(|error| error.to_string())?.ip());
    }
    let socket = UdpSocket::bind(("0.0.0.0", 0)).map_err(|error| error.to_string())?;
    socket
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| error.to_string())?;
    let mut packet = vec![0, 0, 0];
    match target.ip() {
        std::net::IpAddr::V4(ip) => {
            packet.push(1);
            packet.extend_from_slice(&ip.octets());
        }
        std::net::IpAddr::V6(ip) => {
            packet.push(4);
            packet.extend_from_slice(&ip.octets());
        }
    }
    packet.extend_from_slice(&target.port().to_be_bytes());
    packet.extend_from_slice(&[
        0x4b, 0x49, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 7, b'e', b'x',
        b'a', b'm', b'p', b'l', b'e', 3, b'c', b'o', b'm', 0, 0, 1, 0, 1,
    ]);
    let started = Instant::now();
    socket
        .send_to(&packet, relay)
        .map_err(|error| error.to_string())?;
    let mut response = [0_u8; 2048];
    socket
        .recv_from(&mut response)
        .map_err(|error| format!("UDP响应超时：{error}"))?;
    Ok(started.elapsed().as_millis().max(1).min(u32::MAX as u128) as u32)
}

fn proxy_test_node(
    app: &AppHandle,
    node: &V2rayNode,
    port: u16,
    mode: &str,
    settings: &V2raySettings,
) -> NodeTestResult {
    let suffix = format!("test-{port}");
    let (config_path, _) = match config::generate_for_port(app, node, port, &suffix) {
        Ok(value) => value,
        Err(error) => {
            return NodeTestResult {
                node_id: node.id.clone(),
                delay: None,
                speed: None,
                ip_info: None,
                mode: mode.into(),
                message: format!("配置生成失败：{error}"),
            }
        }
    };
    let mut child = match core_runtime::spawn_transient(app, &node.core_id, &config_path) {
        Ok(value) => value,
        Err(error) => {
            return NodeTestResult {
                node_id: node.id.clone(),
                delay: None,
                speed: None,
                ip_info: None,
                mode: mode.into(),
                message: error,
            }
        }
    };
    let result = if TEST_CANCELLED.load(Ordering::Relaxed) {
        NodeTestResult {
            node_id: node.id.clone(),
            delay: None,
            speed: None,
            ip_info: None,
            mode: mode.into(),
            message: "测速已取消".into(),
        }
    } else if !wait_for_port(port, Duration::from_secs(6)) {
        NodeTestResult {
            node_id: node.id.clone(),
            delay: None,
            speed: None,
            ip_info: None,
            mode: mode.into(),
            message: "核心未能在6秒内启动测速代理".into(),
        }
    } else if TEST_CANCELLED.load(Ordering::Relaxed) {
        NodeTestResult {
            node_id: node.id.clone(),
            delay: None,
            speed: None,
            ip_info: None,
            mode: mode.into(),
            message: "测速已取消".into(),
        }
    } else if child.try_wait().ok().flatten().is_some() {
        NodeTestResult {
            node_id: node.id.clone(),
            delay: None,
            speed: None,
            ip_info: None,
            mode: mode.into(),
            message: "测速核心已提前退出，请检查节点参数或核心日志".into(),
        }
    } else {
        if mode == "udp" {
            match udp_delay(port, &settings.udp_test_target) {
                Ok(delay) => NodeTestResult {
                    node_id: node.id.clone(),
                    delay: Some(delay),
                    speed: None,
                    ip_info: None,
                    mode: mode.into(),
                    message: "UDP可用".into(),
                },
                Err(error) => NodeTestResult {
                    node_id: node.id.clone(),
                    delay: None,
                    speed: None,
                    ip_info: None,
                    mode: mode.into(),
                    message: error,
                },
            }
        } else {
            match real_delay(
                port,
                &settings.latency_test_url,
                settings.speed_test_timeout_seconds.min(30),
            ) {
                Ok(delay) => {
                    let ip_info = exit_ip_info(port, &settings.ip_info_url, 10);
                    if mode == "speed" || mode == "mixed" {
                        match download_speed(
                            port,
                            &settings.speed_test_url,
                            settings.speed_test_timeout_seconds,
                        ) {
                            Ok(speed) => NodeTestResult {
                                node_id: node.id.clone(),
                                delay: Some(delay),
                                speed: Some(speed),
                                ip_info,
                                mode: mode.into(),
                                message: "下载测速完成".into(),
                            },
                            Err(error) => NodeTestResult {
                                node_id: node.id.clone(),
                                delay: Some(delay),
                                speed: None,
                                ip_info,
                                mode: mode.into(),
                                message: error,
                            },
                        }
                    } else {
                        NodeTestResult {
                            node_id: node.id.clone(),
                            delay: Some(delay),
                            speed: None,
                            ip_info,
                            mode: mode.into(),
                            message: "真实代理可用".into(),
                        }
                    }
                }
                Err(error) => NodeTestResult {
                    node_id: node.id.clone(),
                    delay: None,
                    speed: None,
                    ip_info: None,
                    mode: mode.into(),
                    message: error,
                },
            }
        }
    };
    let _ = child.kill();
    let _ = child.wait();
    result
}

fn available_test_port() -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("分配测速端口失败：{error}"))?;
    listener
        .local_addr()
        .map(|address| address.port())
        .map_err(|error| format!("读取测速端口失败：{error}"))
}

pub fn test_nodes(
    app: &AppHandle,
    node_ids: Vec<String>,
    mode: Option<String>,
) -> Result<NodeTestBatchResult, String> {
    if TEST_RUNNING.swap(true, Ordering::AcqRel) {
        return Err("V2ray测速正在运行".into());
    }
    let result = run_test_nodes(app, node_ids, mode);
    TEST_RUNNING.store(false, Ordering::Release);
    result
}

pub fn start_tests(
    app: AppHandle,
    node_ids: Vec<String>,
    mode: Option<String>,
) -> Result<NodeTestStartResult, String> {
    if TEST_RUNNING.swap(true, Ordering::AcqRel) {
        return Err("V2ray测速正在运行".into());
    }
    let total = if node_ids.is_empty() {
        match store::list_nodes(&app, None) {
            Ok(nodes) => nodes.len(),
            Err(error) => {
                TEST_RUNNING.store(false, Ordering::Release);
                return Err(error);
            }
        }
    } else {
        node_ids
            .iter()
            .filter(|id| store::get_node(&app, id).is_ok())
            .count()
    };
    let worker_app = app.clone();
    std::thread::spawn(move || {
        let result = run_test_nodes(&worker_app, node_ids, mode);
        match &result {
            Ok(batch) => {
                let _ = worker_app.emit("v2ray-test-complete", batch);
            }
            Err(error) => {
                let _ = worker_app.emit("v2ray-test-error", error);
            }
        }
        TEST_RUNNING.store(false, Ordering::Release);
    });
    Ok(NodeTestStartResult { total })
}

fn run_test_nodes(
    app: &AppHandle,
    node_ids: Vec<String>,
    mode: Option<String>,
) -> Result<NodeTestBatchResult, String> {
    TEST_CANCELLED.store(false, Ordering::Relaxed);
    let nodes = if node_ids.is_empty() {
        store::list_nodes(app, None)?
    } else {
        node_ids
            .iter()
            .filter_map(|id| store::get_node(app, id).ok())
            .collect()
    };
    let total = nodes.len();
    let mode = mode.unwrap_or_else(|| "tcp".into());
    if !matches!(
        mode.as_str(),
        "tcp" | "real" | "speed" | "udp" | "mixed" | "fast-real"
    ) {
        return Err("未知的V2ray测速模式".into());
    }
    store::clear_test_metrics(
        app,
        &nodes.iter().map(|node| node.id.clone()).collect::<Vec<_>>(),
        &mode,
    )?;
    let settings = settings::load(app);
    let concurrency = match mode.as_str() {
        "tcp" | "fast-real" | "real" | "udp" | "mixed" => settings.mixed_concurrency,
        "speed" => 1,
        _ => 1,
    }
    .clamp(1, 16)
    .min(total.max(1));
    let queue = Arc::new(Mutex::new(
        nodes.into_iter().enumerate().collect::<VecDeque<_>>(),
    ));
    let results = Arc::new(Mutex::new(Vec::<(usize, NodeTestResult)>::new()));
    let completed = Arc::new(AtomicUsize::new(0));
    std::thread::scope(|scope| {
        for _ in 0..concurrency {
            let queue = Arc::clone(&queue);
            let results = Arc::clone(&results);
            let completed = Arc::clone(&completed);
            let app = app.clone();
            let mode = mode.clone();
            let settings = settings.clone();
            scope.spawn(move || loop {
                if TEST_CANCELLED.load(Ordering::Relaxed) {
                    break;
                }
                let Some((index, node)) = queue.lock().ok().and_then(|mut queue| queue.pop_front()) else { break; };
                let result = if mode == "tcp" {
            let started = Instant::now();
            let address = format!("{}:{}", node.host, node.port);
            let result = address
                .to_socket_addrs()
                .map_err(|error| error.to_string())
                .and_then(|mut values| values.next().ok_or_else(|| "DNS 未返回地址".to_string()))
                .and_then(|address| {
                    TcpStream::connect_timeout(&address, Duration::from_secs(4))
                        .map_err(|error| error.to_string())
                });
            match result {
                        Ok(_) => {
                            // Avoid presenting a sub-millisecond local/TUN acknowledgement as
                            // a meaningful zero-millisecond remote TCP result.
                            let elapsed_micros = started.elapsed().as_micros();
                            let delay = elapsed_micros
                                .saturating_add(999)
                                .checked_div(1_000)
                                .unwrap_or(1)
                                .clamp(1, u32::MAX as u128) as u32;
                            NodeTestResult { node_id: node.id.clone(), delay: Some(delay), speed: None, ip_info: None, mode: mode.clone(), message: "TCP可达".into() }
                        },
                        Err(error) => NodeTestResult { node_id: node.id.clone(), delay: None, speed: None, ip_info: None, mode: mode.clone(), message: format!("TCP失败：{error}") },
                    }
                } else {
                    match available_test_port() {
                        Ok(port) => proxy_test_node(&app, &node, port, if mode == "fast-real" { "real" } else { &mode }, &settings),
                        Err(error) => NodeTestResult { node_id: node.id.clone(), delay: None, speed: None, ip_info: None, mode: mode.clone(), message: error },
                    }
                };
                let _ = store::save_metric(&app, &node.id, result.delay, result.speed, result.ip_info.as_deref(), &result.message);
                let done = completed.fetch_add(1, Ordering::Relaxed) + 1;
                let _ = app.emit("v2ray-test-progress", serde_json::json!({
                    "completed": done, "total": total, "nodeId": node.id, "delay": result.delay,
                    "speed": result.speed, "ipInfo": result.ip_info, "mode": result.mode, "message": result.message
                }));
                if let Ok(mut values) = results.lock() {
                    values.push((index, result));
                }
            }
            );
        }
    });
    let mut indexed = Arc::try_unwrap(results)
        .map_err(|_| "读取测速结果失败")?
        .into_inner()
        .map_err(|_| "读取测速结果失败")?;
    indexed.sort_by_key(|(index, _)| *index);
    let output = indexed
        .into_iter()
        .map(|(_, result)| result)
        .collect::<Vec<_>>();
    let cancelled = TEST_CANCELLED.load(Ordering::Relaxed);
    if cancelled {
        let _ = app.emit(
            "v2ray-test-cancelled",
            serde_json::json!({
                "completed": output.len(), "total": total
            }),
        );
    }
    Ok(NodeTestBatchResult {
        results: output,
        cancelled,
    })
}

pub fn cancel_tests() {
    TEST_CANCELLED.store(true, Ordering::Relaxed);
}

fn wait_for_port(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&address, Duration::from_millis(200)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(120));
    }
    false
}

fn query_exit(port: u16) -> Option<(String, String)> {
    let output = hidden_command("curl.exe")
        .args([
            "-fsS",
            "--connect-timeout",
            "4",
            "--max-time",
            "8",
            "--proxy",
            &format!("socks5h://127.0.0.1:{port}"),
            "https://api.country.is/",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
    Some((
        value.get("ip")?.as_str()?.to_string(),
        value
            .get("country")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("未知")
            .to_string(),
    ))
}

pub fn start_connection(
    app: AppHandle,
    store: &services::ConnectionStore,
    runtime: &core_runtime::CoreRuntime,
    node_id: Option<String>,
) -> Result<V2rayRuntimeState, String> {
    let node = match node_id {
        Some(id) => store::set_active(&app, &id)?,
        None => store::active_node(&app)?.ok_or("请先选择一个 V2ray 节点")?,
    };
    if store.state.lock().map_err(|_| "连接状态不可用")?.connecting {
        return Err("已有连接任务正在执行".into());
    }
    let settings = settings::load(&app);
    if settings.tun_enabled && !crate::process_utils::is_elevated() {
        crate::process_utils::relaunch_elevated()?;
        app.exit(0);
        return Err("KiNGO 已请求管理员权限并重新启动，请在新窗口中再次连接".into());
    }
    let mut runtime_node = node.clone();
    if settings.tun_enabled {
        runtime_node.core_id = "sing-box".into();
    }
    services::cancel_connection(&app, store, runtime)?;
    {
        let mut state = store.state.lock().map_err(|_| "连接状态不可用")?;
        state.mode = "v2ray".into();
        state.connecting = true;
        state.connected = false;
        state.stage = "generating-config".into();
        state.core_id = Some(runtime_node.core_id.clone());
        state.display_name = Some(node.name.clone());
        state.error = None;
        state.exit_ip = None;
        state.country = None;
        state.latency = node.delay;
    }
    let cancel = std::sync::Arc::new(AtomicBool::new(false));
    *store.cancel.lock().map_err(|_| "连接控制不可用")? = Some(cancel.clone());
    services::emit_snapshot(&app, store);
    let result: Result<V2rayRuntimeState, String> = (|| -> Result<V2rayRuntimeState, String> {
        let (config_path, port) = config::generate(&app, &runtime_node)?;
        if cancel.load(Ordering::Relaxed) {
            return Err("连接已取消".into());
        }
        {
            let mut state = store.state.lock().map_err(|_| "连接状态不可用")?;
            state.stage = "starting-core".into();
        }
        services::emit_snapshot(&app, store);
        core_runtime::start(&app, runtime, runtime_node.core_id.clone(), config_path)?;
        if !wait_for_port(port, Duration::from_secs(8)) {
            return Err("核心未能在 8 秒内启动本地代理端口，请检查节点参数".into());
        }
        if cancel.load(Ordering::Relaxed) {
            return Err("连接已取消".into());
        }
        if settings.tun_enabled {
            system_proxy::disable(&store.proxy)?;
        } else if settings.system_proxy {
            let socks5 = runtime_node.core_id != "sing-box";
            system_proxy::enable(&store.proxy, port, socks5, settings.bypass_lan)?;
        }
        let exit = query_exit(port);
        {
            let mut state = store.state.lock().map_err(|_| "连接状态不可用")?;
            state.connecting = false;
            state.connected = true;
            state.stage = "connected".into();
            state.core_id = Some(runtime_node.core_id.clone());
            state.tun_enabled = settings.tun_enabled;
            state.display_name = Some(node.name.clone());
            state.exit_ip = exit.as_ref().map(|value| value.0.clone());
            state.country = exit.as_ref().map(|value| value.1.clone());
            state.error = None;
        }
        services::emit_snapshot(&app, store);
        let _ = app.emit("connection-log", serde_json::json!({ "level": "success", "message": format!("V2ray 节点已连接：{}（{}）", node.name, node.core_id) }));
        Ok(V2rayRuntimeState {
            active_node_id: Some(node.id.clone()),
            core_id: Some(runtime_node.core_id.clone()),
            running: true,
            local_socks_port: port,
        })
    })();
    if let Err(error) = &result {
        let _ = core_runtime::stop(runtime, &runtime_node.core_id);
        let _ = system_proxy::disable(&store.proxy);
        if let Ok(mut state) = store.state.lock() {
            state.connecting = false;
            state.connected = false;
            state.stage = "error".into();
            state.error = Some(error.clone());
            state.tun_enabled = false;
        }
        services::emit_snapshot(&app, store);
        let _ = app.emit(
            "connection-log",
            serde_json::json!({ "level": "error", "message": format!("V2ray 连接失败：{error}") }),
        );
    }
    result
}

pub fn runtime_state(
    app: &AppHandle,
    store: &services::ConnectionStore,
) -> Result<V2rayRuntimeState, String> {
    let state = services::snapshot(store);
    let node = store::active_node(app)?;
    let local_socks_port = settings::load(app).local_port;
    let core_id = if state.mode == "v2ray" {
        state.core_id.clone()
    } else {
        None
    };
    Ok(V2rayRuntimeState {
        active_node_id: node.map(|value| value.id),
        core_id,
        running: state.mode == "v2ray" && state.connected,
        local_socks_port,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{TcpListener, UdpSocket};
    use std::thread;

    #[test]
    fn udp_delay_uses_socks5_udp_associate() {
        let relay = UdpSocket::bind(("127.0.0.1", 0)).expect("bind UDP relay");
        relay
            .set_read_timeout(Some(Duration::from_secs(3)))
            .expect("set UDP timeout");
        let relay_port = relay.local_addr().expect("UDP address").port();
        let udp_thread = thread::spawn(move || {
            let mut packet = [0_u8; 2048];
            let (size, sender) = relay.recv_from(&mut packet).expect("receive UDP packet");
            assert!(size > 10, "SOCKS UDP packet should include a DNS payload");
            relay
                .send_to(&packet[..size], sender)
                .expect("return UDP response");
        });

        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind SOCKS listener");
        let socks_port = listener.local_addr().expect("SOCKS address").port();
        let tcp_thread = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept SOCKS control");
            let mut greeting = [0_u8; 3];
            stream.read_exact(&mut greeting).expect("read greeting");
            assert_eq!(greeting, [5, 1, 0]);
            stream.write_all(&[5, 0]).expect("write greeting");

            let mut associate = [0_u8; 10];
            stream
                .read_exact(&mut associate)
                .expect("read UDP associate");
            assert_eq!(&associate[..4], &[5, 3, 0, 1]);
            let [high, low] = relay_port.to_be_bytes();
            stream
                .write_all(&[5, 0, 0, 1, 127, 0, 0, 1, high, low])
                .expect("write relay address");
            thread::sleep(Duration::from_millis(250));
        });

        let delay = udp_delay(socks_port, "1.1.1.1:53").expect("UDP delay succeeds");
        assert!(delay >= 1);
        tcp_thread.join().expect("SOCKS thread");
        udp_thread.join().expect("UDP thread");
    }
}
