use std::{
    collections::HashMap,
    io::{Read, Write},
    net::{IpAddr, Ipv4Addr, Ipv6Addr, Shutdown, TcpListener, TcpStream, ToSocketAddrs},
    sync::{
        atomic::{AtomicBool, AtomicU16, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use crate::geo_rules::CountryRules;

#[derive(Clone, Default)]
pub struct BridgeRuntime {
    active: Arc<Mutex<Option<BridgeHandle>>>,
    download_total: Arc<AtomicU64>,
    upload_total: Arc<AtomicU64>,
    routing: Arc<Mutex<RoutingPolicy>>,
    country_rules: Arc<Mutex<Arc<CountryRules>>>,
    resolution_cache: Arc<Mutex<HashMap<String, (Instant, bool)>>>,
    connections: Arc<Mutex<HashMap<u64, TcpStream>>>,
    next_connection_id: Arc<AtomicU64>,
}

struct BridgeHandle {
    stop: Arc<AtomicBool>,
    socks_port: Arc<AtomicU16>,
    listener_port: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RouteMode {
    Rule,
    Global,
    Direct,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RouteAction {
    Direct,
    Proxy,
    Block,
}

#[derive(Clone, Debug)]
struct RouteRule {
    target: String,
    action: RouteAction,
}

#[derive(Clone, Debug)]
struct RoutingPolicy {
    mode: RouteMode,
    rules: Vec<RouteRule>,
}

impl Default for RoutingPolicy {
    fn default() -> Self {
        Self {
            mode: RouteMode::Global,
            rules: Vec::new(),
        }
    }
}

impl RoutingPolicy {
    fn from_parts(mode: &str, rules: Vec<(String, String)>) -> Result<Self, String> {
        let mode = match mode {
            "rule" => RouteMode::Rule,
            "global" => RouteMode::Global,
            "direct" => RouteMode::Direct,
            _ => return Err("本地分流模式无效".into()),
        };
        let mut normalized_rules = Vec::with_capacity(rules.len());
        for (target, action) in rules {
            let action = match action.as_str() {
                "direct" => RouteAction::Direct,
                "proxy" => RouteAction::Proxy,
                "block" => RouteAction::Block,
                _ => return Err("本地分流动作无效".into()),
            };
            normalized_rules.push(RouteRule {
                target: target.trim().trim_end_matches('.').to_ascii_lowercase(),
                action,
            });
        }
        Ok(Self {
            mode,
            rules: normalized_rules,
        })
    }

    fn action_for(&self, host: &str, country_rules: &CountryRules) -> RouteAction {
        let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
        if local_target(&host) {
            return RouteAction::Direct;
        }
        if let Some(rule) = self
            .rules
            .iter()
            .find(|rule| target_matches(&rule.target, &host))
        {
            return rule.action;
        }
        match self.mode {
            RouteMode::Global => RouteAction::Proxy,
            RouteMode::Direct => RouteAction::Direct,
            RouteMode::Rule if country_rules.matches_host(&host) => RouteAction::Direct,
            RouteMode::Rule => RouteAction::Proxy,
        }
    }

    fn should_try_cn_ip_fallback(&self, host: &str, country_rules: &CountryRules) -> bool {
        if self.mode != RouteMode::Rule || local_target(host) || country_rules.matches_host(host) {
            return false;
        }
        !self
            .rules
            .iter()
            .any(|rule| target_matches(&rule.target, host))
    }
}

impl BridgeRuntime {
    pub fn update_routing(&self, mode: &str, rules: Vec<(String, String)>) -> Result<(), String> {
        let policy = RoutingPolicy::from_parts(mode, rules)?;
        *self.routing.lock().map_err(|_| "本地分流策略状态不可用")? = policy;
        self.close_connections();
        Ok(())
    }

    pub fn set_country_rules(&self, rules: Arc<CountryRules>) -> Result<(), String> {
        *self
            .country_rules
            .lock()
            .map_err(|_| "中国路由规则状态不可用")? = rules;
        self.close_connections();
        Ok(())
    }

    pub fn start(&self, socks_port: u16) -> Result<u16, String> {
        if let Ok(active) = self.active.lock() {
            if let Some(handle) = active.as_ref() {
                handle.socks_port.store(socks_port, Ordering::Release);
                return Ok(handle.listener_port);
            }
        }
        self.stop();
        self.download_total.store(0, Ordering::Relaxed);
        self.upload_total.store(0, Ordering::Relaxed);
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .map_err(|error| format!("本地代理转接启动失败：{error}"))?;
        let port = listener
            .local_addr()
            .map_err(|error| format!("本地代理转接端口不可用：{error}"))?
            .port();
        listener
            .set_nonblocking(true)
            .map_err(|error| format!("本地代理转接配置失败：{error}"))?;
        let stop = Arc::new(AtomicBool::new(false));
        let upstream_port = Arc::new(AtomicU16::new(socks_port));
        let worker_stop = stop.clone();
        let worker_upstream_port = upstream_port.clone();
        let download_total = self.download_total.clone();
        let upload_total = self.upload_total.clone();
        let routing = self.routing.clone();
        let country_rules = self.country_rules.clone();
        let resolution_cache = self.resolution_cache.clone();
        let connections = self.connections.clone();
        let next_connection_id = self.next_connection_id.clone();
        thread::spawn(move || {
            while !worker_stop.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let connection_id = next_connection_id.fetch_add(1, Ordering::Relaxed);
                        if let Ok(clone) = stream.try_clone() {
                            if let Ok(mut active) = connections.lock() {
                                active.insert(connection_id, clone);
                            }
                        }
                        let download_total = download_total.clone();
                        let upload_total = upload_total.clone();
                        let routing = routing.clone();
                        let country_rules = country_rules.clone();
                        let resolution_cache = resolution_cache.clone();
                        let connections = connections.clone();
                        let socks_port = worker_upstream_port.load(Ordering::Acquire);
                        thread::spawn(move || {
                            let _ = stream.set_nonblocking(false);
                            if let Err(error) = handle_client(
                                stream,
                                socks_port,
                                routing,
                                country_rules,
                                resolution_cache,
                                download_total,
                                upload_total,
                            ) {
                                eprintln!("[traffic-bridge] {error}");
                            }
                            if let Ok(mut active) = connections.lock() {
                                active.remove(&connection_id);
                            }
                        });
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(50));
                    }
                    Err(_) => break,
                }
            }
        });
        if let Ok(mut active) = self.active.lock() {
            *active = Some(BridgeHandle {
                stop,
                socks_port: upstream_port,
                listener_port: port,
            });
        } else {
            return Err("local proxy bridge state unavailable".into());
        }
        Ok(port)
    }

    pub fn switch_upstream(&self, socks_port: u16) -> Result<(), String> {
        let active = self
            .active
            .lock()
            .map_err(|_| "local proxy bridge state unavailable".to_string())?;
        let handle = active
            .as_ref()
            .ok_or_else(|| "local proxy bridge is not running".to_string())?;
        handle.socks_port.store(socks_port, Ordering::Release);
        Ok(())
    }

    pub fn stop(&self) {
        if let Ok(mut active) = self.active.lock() {
            if let Some(handle) = active.take() {
                handle.stop.store(true, Ordering::Relaxed);
            }
        }
        self.close_connections();
    }

    pub fn traffic(&self) -> (u64, u64) {
        (
            self.download_total.load(Ordering::Relaxed),
            self.upload_total.load(Ordering::Relaxed),
        )
    }

    fn close_connections(&self) {
        if let Ok(mut connections) = self.connections.lock() {
            for (_, stream) in connections.drain() {
                let _ = stream.shutdown(Shutdown::Both);
            }
        }
    }
}

fn handle_client(
    mut client: TcpStream,
    socks_port: u16,
    routing: Arc<Mutex<RoutingPolicy>>,
    country_rules: Arc<Mutex<Arc<CountryRules>>>,
    resolution_cache: Arc<Mutex<HashMap<String, (Instant, bool)>>>,
    download_total: Arc<AtomicU64>,
    upload_total: Arc<AtomicU64>,
) -> Result<(), String> {
    client.set_read_timeout(Some(Duration::from_secs(8))).ok();
    let mut request = Vec::with_capacity(4096);
    let mut buffer = [0_u8; 2048];
    while !request.windows(4).any(|value| value == b"\r\n\r\n") && request.len() < 65536 {
        let read = client
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if read == 0 {
            return Ok(());
        }
        request.extend_from_slice(&buffer[..read]);
    }
    let header = String::from_utf8_lossy(&request);
    let first_line = header.lines().next().ok_or("HTTP 请求为空")?;
    let mut parts = first_line.split_whitespace();
    let method = parts.next().ok_or("HTTP 方法缺失")?;
    let destination = parts.next().ok_or("HTTP 目标缺失")?;
    let version = parts.next().unwrap_or("HTTP/1.1");
    let (host, port, path) = if method.eq_ignore_ascii_case("CONNECT") {
        let (host, port) = split_authority(destination, 443)?;
        (host, port, None)
    } else {
        let target = destination
            .strip_prefix("http://")
            .ok_or("仅支持 HTTP 和 HTTPS 代理请求")?;
        let slash = target.find('/').unwrap_or(target.len());
        let (host, port) = split_authority(&target[..slash], 80)?;
        let path = if slash == target.len() {
            "/"
        } else {
            &target[slash..]
        };
        (host, port, Some(path.to_string()))
    };
    let (mut action, try_cn_ip_fallback, country_rules) = {
        let routing = routing.lock().map_err(|_| "本地分流策略状态不可用")?;
        let country_rules = country_rules.lock().map_err(|_| "中国路由规则状态不可用")?;
        (
            routing.action_for(&host, &country_rules),
            routing.should_try_cn_ip_fallback(&host, &country_rules),
            country_rules.clone(),
        )
    };
    if try_cn_ip_fallback && resolved_host_is_cn(&host, port, &country_rules, &resolution_cache) {
        action = RouteAction::Direct;
    }
    if action == RouteAction::Block {
        client
            .write_all(b"HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
            .map_err(|error| error.to_string())?;
        return Ok(());
    }
    let mut upstream = match action {
        RouteAction::Direct => connect_direct(&host, port)?,
        RouteAction::Proxy => connect_socks5(socks_port, &host, port)?,
        RouteAction::Block => unreachable!("blocked requests return before connecting"),
    };
    if method.eq_ignore_ascii_case("CONNECT") {
        client
            .write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
            .map_err(|error| error.to_string())?;
    } else {
        let end = request
            .windows(4)
            .position(|value| value == b"\r\n\r\n")
            .map(|index| index + 4)
            .ok_or("HTTP 请求头不完整")?;
        let line_end = request
            .windows(2)
            .position(|value| value == b"\r\n")
            .map(|index| index + 2)
            .ok_or("HTTP 请求行不完整")?;
        upstream
            .write_all(format!("{method} {} {version}\r\n", path.unwrap()).as_bytes())
            .map_err(|error| error.to_string())?;
        upstream
            .write_all(&request[line_end..end])
            .map_err(|error| error.to_string())?;
        if end < request.len() {
            upstream
                .write_all(&request[end..])
                .map_err(|error| error.to_string())?;
        }
    }
    relay(client, upstream, download_total, upload_total)
}

fn resolved_host_is_cn(
    host: &str,
    port: u16,
    country_rules: &CountryRules,
    cache: &Arc<Mutex<HashMap<String, (Instant, bool)>>>,
) -> bool {
    const POSITIVE_TTL: Duration = Duration::from_secs(10 * 60);
    const NEGATIVE_TTL: Duration = Duration::from_secs(60);
    let key = host.trim().trim_end_matches('.').to_ascii_lowercase();
    if let Ok(values) = cache.lock() {
        if let Some((cached_at, is_cn)) = values.get(&key) {
            let ttl = if *is_cn { POSITIVE_TTL } else { NEGATIVE_TTL };
            if cached_at.elapsed() < ttl {
                return *is_cn;
            }
        }
    }
    let is_cn = (key.as_str(), port)
        .to_socket_addrs()
        .map(|addresses| {
            addresses
                .into_iter()
                .any(|item| country_rules.matches_ip(item.ip()))
        })
        .unwrap_or(false);
    if let Ok(mut values) = cache.lock() {
        if values.len() >= 2048 {
            values.retain(|_, (cached_at, is_cn)| {
                cached_at.elapsed() < if *is_cn { POSITIVE_TTL } else { NEGATIVE_TTL }
            });
        }
        values.insert(key, (Instant::now(), is_cn));
    }
    is_cn
}

fn target_matches(target: &str, host: &str) -> bool {
    if let Some((network, prefix)) = target.split_once('/') {
        let Ok(network) = network.parse::<IpAddr>() else {
            return false;
        };
        let Ok(prefix) = prefix.parse::<u8>() else {
            return false;
        };
        let Ok(host) = host.parse::<IpAddr>() else {
            return false;
        };
        return ip_in_network(host, network, prefix);
    }
    if target.parse::<IpAddr>().is_ok() {
        return host == target;
    }
    host == target || host.ends_with(&format!(".{target}"))
}

fn ip_in_network(address: IpAddr, network: IpAddr, prefix: u8) -> bool {
    match (address, network) {
        (IpAddr::V4(address), IpAddr::V4(network)) if prefix <= 32 => {
            let mask = if prefix == 0 {
                0
            } else {
                u32::MAX << (32 - prefix)
            };
            u32::from(address) & mask == u32::from(network) & mask
        }
        (IpAddr::V6(address), IpAddr::V6(network)) if prefix <= 128 => {
            let mask = if prefix == 0 {
                0
            } else {
                u128::MAX << (128 - prefix)
            };
            u128::from(address) & mask == u128::from(network) & mask
        }
        _ => false,
    }
}

fn local_target(host: &str) -> bool {
    if host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") {
        return true;
    }
    host.parse::<IpAddr>()
        .map(is_private_or_local)
        .unwrap_or(false)
}

fn is_private_or_local(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => {
            address.is_private()
                || address.is_loopback()
                || address.is_link_local()
                || address.is_unspecified()
                || address == Ipv4Addr::BROADCAST
        }
        IpAddr::V6(address) => {
            address.is_loopback()
                || address.is_unspecified()
                || address.is_unique_local()
                || address.is_unicast_link_local()
                || address == Ipv6Addr::LOCALHOST
        }
    }
}

fn connect_direct(host: &str, port: u16) -> Result<TcpStream, String> {
    let stream =
        TcpStream::connect((host, port)).map_err(|error| format!("直连目标失败：{error}"))?;
    stream.set_read_timeout(Some(Duration::from_secs(8))).ok();
    stream.set_write_timeout(Some(Duration::from_secs(8))).ok();
    Ok(stream)
}

fn split_authority(authority: &str, default_port: u16) -> Result<(String, u16), String> {
    if let Some(rest) = authority.strip_prefix('[') {
        let end = rest.find(']').ok_or("IPv6 地址格式无效")?;
        let host = rest[..end].to_string();
        let port = rest[end + 1..]
            .strip_prefix(':')
            .map(|value| value.parse::<u16>())
            .transpose()
            .map_err(|_| "代理目标端口无效")?
            .unwrap_or(default_port);
        return Ok((host, port));
    }
    match authority.rsplit_once(':') {
        Some((host, value)) if !host.contains(':') => Ok((
            host.to_string(),
            value.parse().map_err(|_| "代理目标端口无效")?,
        )),
        _ => Ok((authority.to_string(), default_port)),
    }
}

fn connect_socks5(socks_port: u16, host: &str, port: u16) -> Result<TcpStream, String> {
    let mut stream = TcpStream::connect(("127.0.0.1", socks_port))
        .map_err(|error| format!("SOCKS5 核心不可用：{error}"))?;
    stream.set_read_timeout(Some(Duration::from_secs(8))).ok();
    stream.set_write_timeout(Some(Duration::from_secs(8))).ok();
    stream
        .write_all(&[5, 1, 0])
        .map_err(|error| error.to_string())?;
    let mut hello = [0_u8; 2];
    stream
        .read_exact(&mut hello)
        .map_err(|error| error.to_string())?;
    if hello != [5, 0] {
        return Err("SOCKS5 核心拒绝无认证连接".into());
    }
    let host_bytes = host.as_bytes();
    if host_bytes.len() > 255 {
        return Err("代理目标域名过长".into());
    }
    let mut request = vec![5, 1, 0, 3, host_bytes.len() as u8];
    request.extend_from_slice(host_bytes);
    request.extend_from_slice(&port.to_be_bytes());
    stream
        .write_all(&request)
        .map_err(|error| error.to_string())?;
    let mut reply = [0_u8; 4];
    stream
        .read_exact(&mut reply)
        .map_err(|error| error.to_string())?;
    if reply[1] != 0 {
        return Err(format!("SOCKS5 连接目标失败，代码 {}", reply[1]));
    }
    let address_length = match reply[3] {
        1 => 4,
        3 => {
            let mut length = [0_u8; 1];
            stream
                .read_exact(&mut length)
                .map_err(|error| error.to_string())?;
            length[0] as usize
        }
        4 => 16,
        _ => return Err("SOCKS5 返回地址格式无效".into()),
    };
    let mut discard = vec![0_u8; address_length + 2];
    stream
        .read_exact(&mut discard)
        .map_err(|error| error.to_string())?;
    stream.set_read_timeout(None).ok();
    stream.set_write_timeout(None).ok();
    Ok(stream)
}

struct CountingReader<R> {
    inner: R,
    total: Arc<AtomicU64>,
}

impl<R: Read> Read for CountingReader<R> {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        let bytes = self.inner.read(buffer)?;
        self.total.fetch_add(bytes as u64, Ordering::Relaxed);
        Ok(bytes)
    }
}

fn relay(
    mut client: TcpStream,
    mut upstream: TcpStream,
    download_total: Arc<AtomicU64>,
    upload_total: Arc<AtomicU64>,
) -> Result<(), String> {
    let mut client_reader = client.try_clone().map_err(|error| error.to_string())?;
    let mut upstream_writer = upstream.try_clone().map_err(|error| error.to_string())?;
    let forward = thread::spawn(move || {
        let mut reader = CountingReader {
            inner: &mut client_reader,
            total: upload_total,
        };
        let _ = std::io::copy(&mut reader, &mut upstream_writer);
        let _ = upstream_writer.shutdown(Shutdown::Write);
    });
    let mut reader = CountingReader {
        inner: &mut upstream,
        total: download_total,
    };
    let _ = std::io::copy(&mut reader, &mut client);
    let _ = client.shutdown(Shutdown::Write);
    let _ = forward.join();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connect_tunnel_relays_through_socks5() {
        let echo = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let echo_address = echo.local_addr().unwrap();
        thread::spawn(move || {
            let (mut stream, _) = echo.accept().unwrap();
            let mut value = [0_u8; 4];
            stream.read_exact(&mut value).unwrap();
            assert_eq!(&value, b"ping");
            stream.write_all(b"pong").unwrap();
        });

        let socks = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let socks_port = socks.local_addr().unwrap().port();
        thread::spawn(move || {
            let (mut client, _) = socks.accept().unwrap();
            let mut hello = [0_u8; 3];
            client.read_exact(&mut hello).unwrap();
            assert_eq!(hello, [5, 1, 0]);
            client.write_all(&[5, 0]).unwrap();
            let mut request = [0_u8; 5];
            client.read_exact(&mut request).unwrap();
            assert_eq!(&request[..4], &[5, 1, 0, 3]);
            let mut domain_and_port = vec![0_u8; request[4] as usize + 2];
            client.read_exact(&mut domain_and_port).unwrap();
            let mut target = TcpStream::connect(echo_address).unwrap();
            client.write_all(&[5, 0, 0, 1, 127, 0, 0, 1, 0, 0]).unwrap();
            let mut client_reader = client.try_clone().unwrap();
            let mut target_writer = target.try_clone().unwrap();
            thread::spawn(move || {
                let _ = std::io::copy(&mut client_reader, &mut target_writer);
            });
            let _ = std::io::copy(&mut target, &mut client);
        });

        let bridge = BridgeRuntime::default();
        let bridge_port = bridge.start(socks_port).unwrap();
        let mut client = TcpStream::connect(("127.0.0.1", bridge_port)).unwrap();
        client
            .write_all(b"CONNECT example.com:443 HTTP/1.1\r\nHost: example.com\r\n\r\n")
            .unwrap();
        let mut response = [0_u8; 39];
        client.read_exact(&mut response).unwrap();
        assert!(String::from_utf8_lossy(&response).starts_with("HTTP/1.1 200"));
        client.write_all(b"ping").unwrap();
        let mut pong = [0_u8; 4];
        client.read_exact(&mut pong).unwrap();
        assert_eq!(&pong, b"pong");
        bridge.stop();
    }

    #[test]
    fn custom_rules_override_every_fallback_mode() {
        let country_rules = CountryRules::default();
        for mode in ["rule", "global", "direct"] {
            let policy = RoutingPolicy::from_parts(
                mode,
                vec![
                    ("example.com".into(), "block".into()),
                    ("1.1.1.0/24".into(), "direct".into()),
                ],
            )
            .unwrap();
            assert_eq!(
                policy.action_for("api.example.com", &country_rules),
                RouteAction::Block
            );
            assert_eq!(
                policy.action_for("1.1.1.1", &country_rules),
                RouteAction::Direct
            );
        }
    }

    #[test]
    fn rule_mode_bypasses_local_and_cn_targets() {
        let policy = RoutingPolicy::from_parts("rule", Vec::new()).unwrap();
        let country_rules = CountryRules::with_root_domain("example.cn");
        assert_eq!(
            policy.action_for("news.example.cn", &country_rules),
            RouteAction::Direct
        );
        assert_eq!(
            policy.action_for("192.168.1.1", &country_rules),
            RouteAction::Direct
        );
        assert_eq!(
            policy.action_for("example.com", &country_rules),
            RouteAction::Proxy
        );
    }

    #[test]
    fn rule_mode_uses_resolved_cn_ip_only_as_an_unmatched_fallback() {
        let policy = RoutingPolicy::from_parts("rule", Vec::new()).unwrap();
        let rules = CountryRules::with_ipv4_network(Ipv4Addr::LOCALHOST, 8);
        assert!(policy.should_try_cn_ip_fallback("unlisted.example", &rules));
        let cache = Arc::new(Mutex::new(HashMap::new()));
        assert!(resolved_host_is_cn("localhost", 80, &rules, &cache));

        let explicit_proxy =
            RoutingPolicy::from_parts("rule", vec![("unlisted.example".into(), "proxy".into())])
                .unwrap();
        assert!(!explicit_proxy.should_try_cn_ip_fallback("unlisted.example", &rules));
    }

    #[test]
    fn global_mode_still_bypasses_local_networks() {
        let policy = RoutingPolicy::from_parts("global", Vec::new()).unwrap();
        let country_rules = CountryRules::default();
        assert_eq!(
            policy.action_for("localhost", &country_rules),
            RouteAction::Direct
        );
        assert_eq!(
            policy.action_for("192.168.1.1", &country_rules),
            RouteAction::Direct
        );
        assert_eq!(
            policy.action_for("example.com", &country_rules),
            RouteAction::Proxy
        );
    }

    #[test]
    fn direct_and_block_actions_do_not_require_the_socks_core() {
        let echo = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let echo_port = echo.local_addr().unwrap().port();
        thread::spawn(move || {
            let (mut stream, _) = echo.accept().unwrap();
            let mut value = [0_u8; 4];
            stream.read_exact(&mut value).unwrap();
            stream.write_all(b"pong").unwrap();
        });

        let bridge = BridgeRuntime::default();
        bridge.update_routing("direct", Vec::new()).unwrap();
        let bridge_port = bridge.start(1).unwrap();
        let mut client = TcpStream::connect(("127.0.0.1", bridge_port)).unwrap();
        client
            .write_all(
                format!("CONNECT 127.0.0.1:{echo_port} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
                    .as_bytes(),
            )
            .unwrap();
        let mut response = [0_u8; 39];
        client.read_exact(&mut response).unwrap();
        assert!(String::from_utf8_lossy(&response).starts_with("HTTP/1.1 200"));
        client.write_all(b"ping").unwrap();
        let mut pong = [0_u8; 4];
        client.read_exact(&mut pong).unwrap();
        assert_eq!(&pong, b"pong");

        bridge
            .update_routing("global", vec![("blocked.example".into(), "block".into())])
            .unwrap();
        let mut blocked = TcpStream::connect(("127.0.0.1", bridge_port)).unwrap();
        blocked
            .write_all(b"CONNECT blocked.example:443 HTTP/1.1\r\nHost: blocked.example\r\n\r\n")
            .unwrap();
        let mut denied = [0_u8; 24];
        blocked.read_exact(&mut denied).unwrap();
        assert!(String::from_utf8_lossy(&denied).starts_with("HTTP/1.1 403"));
        bridge.stop();
    }
}
