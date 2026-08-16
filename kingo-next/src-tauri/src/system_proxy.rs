use crate::process_utils::hidden_command;
use serde::{Deserialize, Serialize};
use std::fs;
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

const KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProxyBackup {
    pub enabled: Option<String>,
    pub server: Option<String>,
    #[serde(default)]
    pub auto_config_url: Option<String>,
    #[serde(default)]
    pub override_list: Option<String>,
}

#[derive(Clone, Default)]
pub struct ProxyState {
    backup: Arc<Mutex<Option<ProxyBackup>>>,
    bridge: crate::traffic_bridge::BridgeRuntime,
}

pub fn is_kingo_enabled(port: u16) -> bool {
    let enabled = read_value("ProxyEnable").unwrap_or_default();
    let server = read_value("ProxyServer").unwrap_or_default();
    matches!(enabled.trim(), "1" | "0x1" | "0X1")
        && server.eq_ignore_ascii_case(&format!("127.0.0.1:{port}"))
}

pub fn has_pending_restore(state: &ProxyState) -> bool {
    let in_memory = state
        .backup
        .lock()
        .map(|backup| backup.is_some())
        .unwrap_or(true);
    let persisted = backup_path().is_some_and(|path| path.exists());
    in_memory || persisted
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

fn backup_path() -> Option<PathBuf> {
    std::env::var("APPDATA").ok().map(|directory| {
        PathBuf::from(directory)
            .join("com.kingo.client")
            .join("proxy-backup.json")
    })
}

fn persist_backup(backup: &ProxyBackup) -> Result<(), String> {
    let path =
        backup_path().ok_or_else(|| "system proxy backup directory unavailable".to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("system proxy backup failed: {error}"))?;
    }
    let data = serde_json::to_string_pretty(backup)
        .map_err(|error| format!("system proxy backup failed: {error}"))?;
    fs::write(path, data).map_err(|error| format!("system proxy backup failed: {error}"))
}

fn load_backup() -> Option<ProxyBackup> {
    let data = fs::read_to_string(backup_path()?).ok()?;
    serde_json::from_str(&data).ok()
}

fn clear_backup() {
    if let Some(path) = backup_path() {
        let _ = fs::remove_file(path);
    }
}

fn read_value(name: &str) -> Option<String> {
    let output = hidden_command("reg")
        .args(["query", KEY, "/v", name])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let line = text.lines().find(|line| line.contains(name))?;
    let rest = line.trim_start().strip_prefix(name)?.trim_start();
    let mut parts = rest.splitn(2, char::is_whitespace);
    let _kind = parts.next()?;
    Some(parts.next().unwrap_or_default().trim().to_string())
}

fn write_value(name: &str, kind: &str, value: &str) -> Result<(), String> {
    let status = hidden_command("reg")
        .args(["add", KEY, "/v", name, "/t", kind, "/d", value, "/f"])
        .status()
        .map_err(|error| format!("system proxy command failed: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("system proxy update failed".into())
    }
}

fn delete_value(name: &str) -> Result<(), String> {
    let status = hidden_command("reg")
        .args(["delete", KEY, "/v", name, "/f"])
        .status()
        .map_err(|error| format!("system proxy restore failed: {error}"))?;
    if status.success() || status.code() == Some(1) {
        Ok(())
    } else {
        Err("system proxy restore failed".into())
    }
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
    let mut backup = state
        .backup
        .lock()
        .map_err(|_| "system proxy state unavailable")?;
    let transaction_previous = ProxyBackup {
        enabled: read_value("ProxyEnable"),
        server: read_value("ProxyServer"),
        auto_config_url: read_value("AutoConfigURL"),
        override_list: read_value("ProxyOverride"),
    };
    let created_backup = backup.is_none();
    if backup.is_none() {
        persist_backup(&transaction_previous)?;
        *backup = Some(transaction_previous.clone());
    }
    let proxy_port = if socks5 {
        match state.bridge.start(port) {
            Ok(port) => port,
            Err(error) => {
                if created_backup {
                    *backup = None;
                    clear_backup();
                }
                return Err(error);
            }
        }
    } else {
        state.bridge.stop();
        port
    };
    let bypass = if bypass_lan {
        "<local>;localhost;127.*;10.*;192.168.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*"
    } else {
        ""
    };
    let apply = (|| {
        write_value("AutoConfigURL", "REG_SZ", "")?;
        write_value("ProxyEnable", "REG_DWORD", "1")?;
        write_value("ProxyServer", "REG_SZ", &format!("127.0.0.1:{proxy_port}"))?;
        write_value("ProxyOverride", "REG_SZ", bypass)?;
        apply_wininet_proxy(&format!("127.0.0.1:{proxy_port}"), bypass)?;
        Ok::<(), String>(())
    })();
    if let Err(error) = apply {
        let rollback = restore_backup(transaction_previous);
        notify_system();
        if created_backup {
            state.bridge.stop();
            *backup = None;
            clear_backup();
        }
        return Err(match rollback {
            Ok(()) => format!("{error}；已恢复修改前的 Windows 系统代理"),
            Err(rollback_error) => {
                format!("{error}；恢复修改前的 Windows 系统代理失败：{rollback_error}")
            }
        });
    }
    notify_system();
    Ok(())
}

pub fn disable(state: &ProxyState) -> Result<(), String> {
    state.bridge.stop();
    let mut backup = state
        .backup
        .lock()
        .map_err(|_| "system proxy state unavailable")?;
    let Some(previous) = backup.take().or_else(load_backup) else {
        return Ok(());
    };
    restore_backup(previous)?;
    clear_backup();
    notify_system();
    Ok(())
}

fn restore_backup(previous: ProxyBackup) -> Result<(), String> {
    match previous.enabled {
        Some(value) => write_value("ProxyEnable", "REG_DWORD", &value)?,
        None => delete_value("ProxyEnable")?,
    }
    match previous.server {
        Some(value) => write_value("ProxyServer", "REG_SZ", &value)?,
        None => delete_value("ProxyServer")?,
    }
    match previous.auto_config_url {
        Some(value) => write_value("AutoConfigURL", "REG_SZ", &value)?,
        None => delete_value("AutoConfigURL")?,
    }
    match previous.override_list {
        Some(value) => write_value("ProxyOverride", "REG_SZ", &value)?,
        None => delete_value("ProxyOverride")?,
    }
    Ok(())
}

#[cfg(windows)]
fn apply_wininet_proxy(server: &str, bypass: &str) -> Result<(), String> {
    use std::{ffi::c_void, os::windows::ffi::OsStrExt};

    #[repr(C)]
    union OptionValue {
        number: u32,
        text: *mut u16,
        storage: u64,
    }
    #[repr(C)]
    struct PerConnectionOption {
        option: u32,
        value: OptionValue,
    }
    #[repr(C)]
    struct PerConnectionOptionList {
        size: u32,
        connection: *mut u16,
        option_count: u32,
        option_error: u32,
        options: *mut PerConnectionOption,
    }
    #[link(name = "wininet")]
    extern "system" {
        fn InternetSetOptionW(
            internet: *mut c_void,
            option: u32,
            buffer: *mut c_void,
            length: u32,
        ) -> i32;
    }

    let mut server_wide: Vec<u16> = std::ffi::OsStr::new(server)
        .encode_wide()
        .chain(Some(0))
        .collect();
    let mut bypass_wide: Vec<u16> = std::ffi::OsStr::new(bypass)
        .encode_wide()
        .chain(Some(0))
        .collect();
    let mut options = [
        PerConnectionOption {
            option: 1,
            value: OptionValue { number: 3 },
        },
        PerConnectionOption {
            option: 2,
            value: OptionValue {
                text: server_wide.as_mut_ptr(),
            },
        },
        PerConnectionOption {
            option: 3,
            value: OptionValue {
                text: bypass_wide.as_mut_ptr(),
            },
        },
    ];
    let mut list = PerConnectionOptionList {
        size: std::mem::size_of::<PerConnectionOptionList>() as u32,
        connection: std::ptr::null_mut(),
        option_count: options.len() as u32,
        option_error: 0,
        options: options.as_mut_ptr(),
    };
    let success = unsafe {
        InternetSetOptionW(
            std::ptr::null_mut(),
            75,
            (&mut list as *mut PerConnectionOptionList).cast(),
            list.size,
        )
    };
    if success == 0 {
        return Err(format!(
            "Windows 每连接代理设置失败：{}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

#[cfg(not(windows))]
fn apply_wininet_proxy(_server: &str, _bypass: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
fn notify_system() {
    use std::ffi::c_void;

    #[link(name = "wininet")]
    extern "system" {
        fn InternetSetOptionW(
            internet: *mut c_void,
            option: u32,
            buffer: *mut c_void,
            length: u32,
        ) -> i32;
    }
    const INTERNET_OPTION_REFRESH: u32 = 37;
    const INTERNET_OPTION_SETTINGS_CHANGED: u32 = 39;
    unsafe {
        InternetSetOptionW(
            std::ptr::null_mut(),
            INTERNET_OPTION_SETTINGS_CHANGED,
            std::ptr::null_mut(),
            0,
        );
        InternetSetOptionW(
            std::ptr::null_mut(),
            INTERNET_OPTION_REFRESH,
            std::ptr::null_mut(),
            0,
        );
    }
}

#[cfg(not(windows))]
fn notify_system() {}

pub fn recover_stale(state: &ProxyState) -> Result<bool, String> {
    let Some(previous) = load_backup() else {
        return Ok(false);
    };
    let current = read_value("ProxyServer").unwrap_or_default();
    let Some(port) = current
        .strip_prefix("127.0.0.1:")
        .and_then(|value| value.parse::<u16>().ok())
    else {
        return Ok(false);
    };
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    if TcpStream::connect_timeout(&address, Duration::from_millis(250)).is_ok() {
        return Ok(false);
    }
    restore_backup(previous)?;
    clear_backup();
    state.bridge.stop();
    if let Ok(mut current) = state.backup.lock() {
        *current = None;
    }
    Ok(true)
}

#[cfg(windows)]
pub fn enable_uwp_loopback() -> Result<String, String> {
    let output = hidden_command("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-AppxPackage | Where-Object { $_.Name -match 'ChatGPT|OpenAI' } | Select-Object -ExpandProperty PackageFamilyName",
        ])
        .output()
        .map_err(|error| format!("读取 Windows 应用列表失败：{error}"))?;
    let families: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|value| {
            !value.is_empty()
                && value
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric() || "._-".contains(character))
        })
        .map(str::to_string)
        .collect();
    if families.is_empty() {
        return Err("没有检测到 Microsoft Store 版 ChatGPT/OpenAI 应用".into());
    }
    let commands = families
        .iter()
        .map(|family| format!("& CheckNetIsolation.exe LoopbackExempt -a -n={family}"))
        .collect::<Vec<_>>()
        .join("; ");
    let encoded = commands.replace('"', "`\"");
    let status = hidden_command("powershell.exe")
        .args([
            "-NoProfile",
            "-Command",
            &format!(
                "Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList '-NoProfile','-Command','{encoded}'"
            ),
        ])
        .status()
        .map_err(|error| format!("启动 UWP 回环授权失败：{error}"))?;
    if !status.success() {
        return Err("UWP 回环授权被取消或执行失败".into());
    }
    Ok(format!(
        "已为 {} 个 ChatGPT/OpenAI 应用解除回环限制",
        families.len()
    ))
}

#[cfg(not(windows))]
pub fn enable_uwp_loopback() -> Result<String, String> {
    Err("UWP 回环设置仅适用于 Windows".into())
}
