use crate::process_utils::hidden_command;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    net::{SocketAddr, TcpStream},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

const NETWORKSETUP: &str = "/usr/sbin/networksetup";

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
struct ProxyConfig {
    enabled: bool,
    server: String,
    port: u16,
    authenticated: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct ServiceBackup {
    name: String,
    web: ProxyConfig,
    secure_web: ProxyConfig,
    socks: ProxyConfig,
    bypass_domains: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct ProxyBackup {
    services: Vec<ServiceBackup>,
}

#[derive(Clone, Default)]
pub struct ProxyState {
    backup: Arc<Mutex<Option<ProxyBackup>>>,
    bridge: crate::traffic_bridge::BridgeRuntime,
}

impl ProxyState {
    pub fn traffic(&self) -> (u64, u64) {
        self.bridge.traffic()
    }

    pub fn update_routing(&self, mode: &str, rules: Vec<(String, String)>) -> Result<(), String> {
        self.bridge.update_routing(mode, rules)
    }

    pub fn set_country_rules(
        &self,
        rules: Arc<crate::geo_rules::CountryRules>,
    ) -> Result<(), String> {
        self.bridge.set_country_rules(rules)
    }

    pub fn switch_socks_upstream(&self, port: u16) -> Result<(), String> {
        self.bridge.switch_upstream(port)
    }
}

fn command_output(program: &str, args: &[&str], context: &str) -> Result<String, String> {
    let output = hidden_command(program)
        .args(args)
        .output()
        .map_err(|error| format!("{context}：{error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            format!("{context}（{}）", output.status)
        } else {
            format!("{context}：{detail}")
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn networksetup(args: &[&str], context: &str) -> Result<String, String> {
    command_output(NETWORKSETUP, args, context)
}

fn default_interface() -> Option<String> {
    command_output(
        "/sbin/route",
        &["-n", "get", "default"],
        "读取默认网络接口失败",
    )
    .ok()?
    .lines()
    .find_map(|line| {
        line.trim()
            .strip_prefix("interface:")
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

fn service_for_interface(text: &str, interface: &str) -> Option<String> {
    let mut service = None;
    for line in text.lines().map(str::trim) {
        if line.starts_with('(') && !line.starts_with("(Hardware Port:") {
            service = line
                .split_once(") ")
                .map(|(_, name)| name.trim_start_matches('*').trim().to_string())
                .filter(|name| !name.is_empty());
        } else if line.contains("Device:") {
            let device = line
                .split_once("Device:")
                .map(|(_, value)| value.trim().trim_end_matches(')'));
            if device == Some(interface) {
                return service;
            }
        }
    }
    None
}

fn enabled_services() -> Result<Vec<String>, String> {
    if let Some(interface) = default_interface() {
        let order = networksetup(&["-listnetworkserviceorder"], "读取 macOS 网络服务顺序失败")?;
        if let Some(service) = service_for_interface(&order, &interface) {
            return Ok(vec![service]);
        }
    }

    let output = networksetup(&["-listallnetworkservices"], "读取 macOS 网络服务失败")?;
    let services = output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| !line.starts_with("An asterisk"))
        .filter(|line| !line.starts_with('*'))
        .map(str::to_string)
        .collect::<Vec<_>>();
    if services.is_empty() {
        Err("没有找到可配置的 macOS 网络服务".into())
    } else {
        Ok(services)
    }
}

fn parse_proxy(text: &str) -> ProxyConfig {
    let mut value = ProxyConfig::default();
    for line in text.lines().map(str::trim) {
        let Some((key, raw)) = line.split_once(':') else {
            continue;
        };
        let raw = raw.trim();
        match key {
            "Enabled" => value.enabled = raw.eq_ignore_ascii_case("yes") || raw == "1",
            "Server" => value.server = raw.to_string(),
            "Port" => value.port = raw.parse().unwrap_or_default(),
            "Authenticated Proxy Enabled" => {
                value.authenticated = raw.eq_ignore_ascii_case("yes") || raw == "1"
            }
            _ => {}
        }
    }
    value
}

fn get_proxy(service: &str, kind: &str) -> Result<ProxyConfig, String> {
    let flag = match kind {
        "web" => "-getwebproxy",
        "secure" => "-getsecurewebproxy",
        "socks" => "-getsocksfirewallproxy",
        _ => return Err("未知 macOS 代理类型".into()),
    };
    networksetup(&[flag, service], "读取 macOS 代理设置失败").map(|text| parse_proxy(&text))
}

fn get_bypass_domains(service: &str) -> Result<Vec<String>, String> {
    let output = networksetup(
        &["-getproxybypassdomains", service],
        "读取 macOS 代理绕过列表失败",
    )?;
    if output.contains("There aren't any") {
        return Ok(Vec::new());
    }
    Ok(output
        .lines()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect())
}

fn snapshot() -> Result<ProxyBackup, String> {
    let mut backups = Vec::new();
    for name in enabled_services()? {
        let backup = ServiceBackup {
            web: get_proxy(&name, "web")?,
            secure_web: get_proxy(&name, "secure")?,
            socks: get_proxy(&name, "socks")?,
            bypass_domains: get_bypass_domains(&name)?,
            name,
        };
        if backup.web.authenticated || backup.secure_web.authenticated || backup.socks.authenticated
        {
            return Err(format!(
                "网络服务“{}”正在使用需要密码的系统代理；为避免丢失钥匙串凭据，KiNGO 未修改该配置",
                backup.name
            ));
        }
        backups.push(backup);
    }
    Ok(ProxyBackup { services: backups })
}

fn backup_path() -> Option<PathBuf> {
    std::env::var("HOME").ok().map(|home| {
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("com.kingo.client")
            .join("proxy-backup-macos.json")
    })
}

fn persist_backup(backup: &ProxyBackup) -> Result<(), String> {
    let path = backup_path().ok_or_else(|| "macOS 代理备份目录不可用".to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建代理备份目录失败：{error}"))?;
    }
    let pending = path.with_extension("json.pending");
    fs::write(
        &pending,
        serde_json::to_vec_pretty(backup).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("写入代理备份失败：{error}"))?;
    fs::rename(&pending, &path).map_err(|error| format!("保存代理备份失败：{error}"))
}

fn load_backup() -> Option<ProxyBackup> {
    serde_json::from_slice(&fs::read(backup_path()?).ok()?).ok()
}

fn clear_backup() {
    if let Some(path) = backup_path() {
        let _ = fs::remove_file(path);
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn applescript_quote(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn run_privileged(commands: Vec<Vec<String>>, context: &str) -> Result<(), String> {
    let script = commands
        .into_iter()
        .map(|args| {
            std::iter::once(NETWORKSETUP.to_string())
                .chain(args)
                .map(|value| shell_quote(&value))
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect::<Vec<_>>()
        .join(" && ");
    let source = format!(
        "do shell script \"{}\" with administrator privileges",
        applescript_quote(&script)
    );
    command_output("/usr/bin/osascript", &["-e", &source], context).map(|_| ())
}

fn proxy_commands(prefix: &str, service: &str, config: &ProxyConfig) -> Vec<Vec<String>> {
    let server = if config.server.is_empty() {
        "127.0.0.1"
    } else {
        &config.server
    };
    vec![
        vec![
            format!("-set{prefix}proxy"),
            service.to_string(),
            server.to_string(),
            config.port.to_string(),
        ],
        vec![
            format!("-set{prefix}proxystate"),
            service.to_string(),
            if config.enabled { "on" } else { "off" }.into(),
        ],
    ]
}

fn restore_backup(backup: &ProxyBackup) -> Result<(), String> {
    let mut commands = Vec::new();
    for service in &backup.services {
        commands.extend(proxy_commands("web", &service.name, &service.web));
        commands.extend(proxy_commands(
            "secureweb",
            &service.name,
            &service.secure_web,
        ));
        commands.extend(proxy_commands(
            "socksfirewall",
            &service.name,
            &service.socks,
        ));
        let mut bypass = vec!["-setproxybypassdomains".into(), service.name.clone()];
        if service.bypass_domains.is_empty() {
            bypass.push("Empty".into());
        } else {
            bypass.extend(service.bypass_domains.iter().cloned());
        }
        commands.push(bypass);
    }
    run_privileged(commands, "恢复 macOS 系统代理失败")
}

fn apply_proxy(services: &[String], port: u16, bypass_lan: bool) -> Result<(), String> {
    let mut commands = Vec::new();
    for service in services {
        for prefix in ["web", "secureweb"] {
            commands.push(vec![
                format!("-set{prefix}proxy"),
                service.clone(),
                "127.0.0.1".into(),
                port.to_string(),
            ]);
            commands.push(vec![
                format!("-set{prefix}proxystate"),
                service.clone(),
                "on".into(),
            ]);
        }
        commands.push(vec![
            "-setsocksfirewallproxystate".into(),
            service.clone(),
            "off".into(),
        ]);
        let mut bypass = vec!["-setproxybypassdomains".into(), service.clone()];
        if bypass_lan {
            bypass.extend(
                [
                    "localhost",
                    "127.0.0.1",
                    "*.local",
                    "169.254/16",
                    "10.0.0.0/8",
                    "172.16.0.0/12",
                    "192.168.0.0/16",
                ]
                .into_iter()
                .map(str::to_string),
            );
        } else {
            bypass.push("Empty".into());
        }
        commands.push(bypass);
    }
    run_privileged(commands, "设置 macOS 系统代理失败")
}

pub fn is_kingo_enabled(port: u16) -> bool {
    enabled_services().ok().is_some_and(|services| {
        !services.is_empty()
            && services.iter().all(|service| {
                [get_proxy(service, "web"), get_proxy(service, "secure")]
                    .into_iter()
                    .all(|value| {
                        value.is_ok_and(|proxy| {
                            proxy.enabled && proxy.server == "127.0.0.1" && proxy.port == port
                        })
                    })
            })
    })
}

pub fn has_pending_restore(state: &ProxyState) -> bool {
    state
        .backup
        .lock()
        .map(|backup| backup.is_some())
        .unwrap_or(true)
        || backup_path().is_some_and(|path| path.exists())
}

pub fn enable(state: &ProxyState, port: u16, socks5: bool, bypass_lan: bool) -> Result<(), String> {
    state.update_routing("global", Vec::new())?;
    enable_inner(state, port, socks5, bypass_lan)
}

pub fn enable_with_routing(
    state: &ProxyState,
    port: u16,
    socks5: bool,
    bypass_lan: bool,
    mode: &str,
    rules: Vec<(String, String)>,
) -> Result<(), String> {
    state.update_routing(mode, rules)?;
    enable_inner(state, port, socks5, bypass_lan)
}

fn enable_inner(
    state: &ProxyState,
    port: u16,
    socks5: bool,
    bypass_lan: bool,
) -> Result<(), String> {
    let mut saved = state
        .backup
        .lock()
        .map_err(|_| "macOS 系统代理状态不可用")?;
    let transaction_previous = snapshot()?;
    let created_backup = saved.is_none();
    if created_backup {
        persist_backup(&transaction_previous)?;
        *saved = Some(transaction_previous.clone());
    }
    let proxy_port = if socks5 {
        match state.bridge.start(port) {
            Ok(port) => port,
            Err(error) => {
                if created_backup {
                    *saved = None;
                    clear_backup();
                }
                return Err(error);
            }
        }
    } else {
        state.bridge.stop();
        port
    };
    let services = transaction_previous
        .services
        .iter()
        .map(|service| service.name.clone())
        .collect::<Vec<_>>();
    if let Err(error) = apply_proxy(&services, proxy_port, bypass_lan) {
        let rollback = restore_backup(&transaction_previous);
        if created_backup {
            state.bridge.stop();
            *saved = None;
            clear_backup();
        }
        return Err(match rollback {
            Ok(()) => format!("{error}；已恢复修改前的 macOS 系统代理"),
            Err(rollback_error) => {
                format!("{error}；恢复修改前的 macOS 系统代理失败：{rollback_error}")
            }
        });
    }
    Ok(())
}

pub fn disable(state: &ProxyState) -> Result<(), String> {
    state.bridge.stop();
    let mut saved = state
        .backup
        .lock()
        .map_err(|_| "macOS 系统代理状态不可用")?;
    let Some(previous) = saved.take().or_else(load_backup) else {
        return Ok(());
    };
    restore_backup(&previous)?;
    clear_backup();
    Ok(())
}

pub fn recover_stale(state: &ProxyState) -> Result<bool, String> {
    let Some(previous) = load_backup() else {
        return Ok(false);
    };
    let current_port = enabled_services().ok().and_then(|services| {
        services.into_iter().find_map(|service| {
            get_proxy(&service, "web").ok().and_then(|proxy| {
                (proxy.enabled && proxy.server == "127.0.0.1").then_some(proxy.port)
            })
        })
    });
    let Some(port) = current_port else {
        return Ok(false);
    };
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    if TcpStream::connect_timeout(&address, Duration::from_millis(250)).is_ok() {
        return Ok(false);
    }
    restore_backup(&previous)?;
    clear_backup();
    state.bridge.stop();
    if let Ok(mut current) = state.backup.lock() {
        *current = None;
    }
    Ok(true)
}

pub fn enable_uwp_loopback() -> Result<String, String> {
    Err("UWP 回环设置仅适用于 Windows".into())
}

#[cfg(test)]
mod tests {
    use super::{parse_proxy, service_for_interface};

    #[test]
    fn parses_networksetup_proxy_output() {
        let value = parse_proxy(
            "Enabled: Yes\nServer: 127.0.0.1\nPort: 7890\nAuthenticated Proxy Enabled: 0\n",
        );
        assert!(value.enabled);
        assert_eq!(value.server, "127.0.0.1");
        assert_eq!(value.port, 7890);
        assert!(!value.authenticated);
    }

    #[test]
    fn maps_default_interface_to_network_service() {
        let order = "(1) Wi-Fi\n(Hardware Port: Wi-Fi, Device: en0)\n(2) USB LAN\n(Hardware Port: USB LAN, Device: en5)\n";
        assert_eq!(
            service_for_interface(order, "en0").as_deref(),
            Some("Wi-Fi")
        );
    }
}
