use crate::paths;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct V2raySettings {
    pub local_port: u16,
    pub allow_lan: bool,
    pub system_proxy: bool,
    pub bypass_lan: bool,
    pub routing_mode: String,
    pub log_level: String,
    pub subscription_update_minutes: u32,
    pub latency_test_url: String,
    pub speed_test_url: String,
    pub ip_info_url: String,
    pub udp_test_target: String,
    pub speed_test_timeout_seconds: u32,
    pub mixed_concurrency: usize,
    pub tun_enabled: bool,
    pub tun_stack: String,
    pub tun_mtu: u32,
    pub tun_strict_route: bool,
    pub tun_ipv6: bool,
    pub tun_route_exclude: Vec<String>,
}

impl Default for V2raySettings {
    fn default() -> Self {
        Self {
            local_port: 10808,
            allow_lan: false,
            system_proxy: true,
            bypass_lan: true,
            routing_mode: "bypass-cn".into(),
            log_level: "warning".into(),
            subscription_update_minutes: 0,
            latency_test_url: "https://www.gstatic.com/generate_204".into(),
            speed_test_url: "https://speed.cloudflare.com/__down?bytes=10000000".into(),
            ip_info_url: "https://api.ip.sb/geoip".into(),
            udp_test_target: "1.1.1.1:53".into(),
            speed_test_timeout_seconds: 15,
            mixed_concurrency: 5,
            tun_enabled: false,
            tun_stack: "system".into(),
            tun_mtu: 1500,
            tun_strict_route: true,
            tun_ipv6: false,
            tun_route_exclude: vec![
                "10.0.0.0/8".into(),
                "172.16.0.0/12".into(),
                "192.168.0.0/16".into(),
            ],
        }
    }
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(PathBuf::from(paths::ensure(app)?.data_dir).join("v2ray-settings.json"))
}

pub fn load(app: &AppHandle) -> V2raySettings {
    settings_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, value: V2raySettings) -> Result<V2raySettings, String> {
    if value.local_port < 1024 {
        return Err("本地代理端口需在 1024 到 65535 之间".into());
    }
    if !matches!(
        value.routing_mode.as_str(),
        "global" | "bypass-cn" | "direct"
    ) {
        return Err("未知的路由模式".into());
    }
    if !matches!(
        value.log_level.as_str(),
        "debug" | "info" | "warning" | "error"
    ) {
        return Err("未知的日志级别".into());
    }
    if value.subscription_update_minutes != 0 && value.subscription_update_minutes < 15 {
        return Err("订阅自动更新间隔不能少于 15 分钟".into());
    }
    for (label, url) in [
        ("真实延迟测试地址", &value.latency_test_url),
        ("下载测速地址", &value.speed_test_url),
        ("出口信息地址", &value.ip_info_url),
    ] {
        if !(url.starts_with("https://") || url.starts_with("http://")) {
            return Err(format!("{label}必须使用 HTTP 或 HTTPS"));
        }
    }
    if !(5..=120).contains(&value.speed_test_timeout_seconds) {
        return Err("测速超时时间必须在 5 到 120 秒之间".into());
    }
    if !(1..=16).contains(&value.mixed_concurrency) {
        return Err("混合测速并发数必须在 1 到 16 之间".into());
    }
    if !matches!(value.tun_stack.as_str(), "system" | "gvisor" | "mixed") {
        return Err("TUN 网络栈必须是 system、gvisor 或 mixed".into());
    }
    if !(1280..=9000).contains(&value.tun_mtu) {
        return Err("TUN MTU 必须在 1280 到 9000 之间".into());
    }
    for cidr in &value.tun_route_exclude {
        let Some((address, prefix)) = cidr.split_once('/') else {
            return Err(format!("TUN 排除网段格式无效：{cidr}"));
        };
        let ip = address
            .parse::<std::net::IpAddr>()
            .map_err(|_| format!("TUN 排除网段格式无效：{cidr}"))?;
        let prefix = prefix
            .parse::<u8>()
            .map_err(|_| format!("TUN 排除网段格式无效：{cidr}"))?;
        let max = if ip.is_ipv4() { 32 } else { 128 };
        if prefix > max {
            return Err(format!("TUN 排除网段前缀无效：{cidr}"));
        }
    }
    if value
        .udp_test_target
        .parse::<std::net::SocketAddr>()
        .is_err()
    {
        return Err("UDP 测试目标必须使用 IP:端口 格式".into());
    }
    let content = serde_json::to_vec_pretty(&value).map_err(|error| error.to_string())?;
    fs::write(settings_path(app)?, content)
        .map_err(|error| format!("保存 V2ray 设置失败：{error}"))?;
    Ok(value)
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub fn start_subscription_scheduler(app: AppHandle) {
    std::thread::spawn(move || {
        let marker = PathBuf::from(
            paths::ensure(&app)
                .map(|value| value.data_dir)
                .unwrap_or_default(),
        )
        .join("v2ray-subscription-last-run.txt");
        loop {
            std::thread::sleep(std::time::Duration::from_secs(60));
            let settings = load(&app);
            if settings.subscription_update_minutes == 0 {
                continue;
            }
            let previous = fs::read_to_string(&marker)
                .ok()
                .and_then(|value| value.trim().parse::<u64>().ok())
                .unwrap_or_else(now);
            let interval = u64::from(settings.subscription_update_minutes) * 60;
            if now().saturating_sub(previous) < interval {
                if !marker.exists() {
                    let _ = fs::write(&marker, previous.to_string());
                }
                continue;
            }
            let result = super::update_all_subscriptions(&app);
            let _ = fs::write(&marker, now().to_string());
            match result {
                Ok(summary) => {
                    let _ = app.emit("v2ray-subscriptions-auto-updated", &summary);
                }
                Err(error) => {
                    let _ = app.emit("v2ray-subscriptions-auto-update-error", error);
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_settings_files_receive_speed_test_defaults() {
        let value: V2raySettings = serde_json::from_str(
            r#"{
                "localPort": 10809,
                "allowLan": true,
                "systemProxy": false,
                "bypassLan": true,
                "routingMode": "bypass-cn",
                "logLevel": "warning",
                "subscriptionUpdateMinutes": 0
            }"#,
        )
        .expect("legacy settings should remain readable");

        assert_eq!(value.local_port, 10809);
        assert_eq!(value.mixed_concurrency, 5);
        assert_eq!(value.speed_test_timeout_seconds, 15);
        assert!(value.speed_test_url.starts_with("https://"));
        assert!(!value.tun_enabled);
        assert_eq!(value.tun_stack, "system");
        assert_eq!(value.tun_mtu, 1500);
    }
}
