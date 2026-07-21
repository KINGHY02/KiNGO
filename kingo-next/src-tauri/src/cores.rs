use serde::Serialize;
use std::path::PathBuf;
use tauri::AppHandle;

use crate::paths;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreProfile {
    pub id: String,
    pub name: String,
    pub family: String,
    pub executable: String,
    pub config_format: String,
    pub default_http_port: Option<u16>,
    pub default_socks_port: Option<u16>,
    pub controller_port: Option<u16>,
    pub supports_tun: bool,
    pub supports_subscriptions: bool,
    pub supports_external_controller: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreStatus {
    pub profile: CoreProfile,
    pub available: bool,
    pub source: String,
    pub executable_path: Option<String>,
}

pub fn profiles() -> Vec<CoreProfile> {
    vec![
        CoreProfile {
            id: "mihomo".into(),
            name: "mihomo".into(),
            family: "mihomo".into(),
            executable: "mihomo.exe".into(),
            config_format: "yaml".into(),
            default_http_port: Some(7890),
            default_socks_port: Some(7891),
            controller_port: Some(9090),
            supports_tun: true,
            supports_subscriptions: true,
            supports_external_controller: true,
        },
        CoreProfile {
            id: "mihomo-alpha".into(),
            name: "mihomo Alpha".into(),
            family: "mihomo".into(),
            executable: "mihomo-alpha.exe".into(),
            config_format: "yaml".into(),
            default_http_port: Some(7890),
            default_socks_port: Some(7891),
            controller_port: Some(9090),
            supports_tun: true,
            supports_subscriptions: true,
            supports_external_controller: true,
        },
        CoreProfile {
            id: "xray".into(),
            name: "Xray".into(),
            family: "xray".into(),
            executable: "xray.exe".into(),
            config_format: "json".into(),
            default_http_port: None,
            default_socks_port: Some(10808),
            controller_port: None,
            supports_tun: false,
            supports_subscriptions: true,
            supports_external_controller: false,
        },
        CoreProfile {
            id: "sing-box".into(),
            name: "sing-box".into(),
            family: "sing-box".into(),
            executable: "sing-box.exe".into(),
            config_format: "json".into(),
            default_http_port: None,
            default_socks_port: Some(20808),
            controller_port: None,
            supports_tun: true,
            supports_subscriptions: true,
            supports_external_controller: false,
        },
        CoreProfile {
            id: "hysteria2".into(),
            name: "Hysteria 2".into(),
            family: "hysteria2".into(),
            executable: "hysteria2.exe".into(),
            config_format: "json".into(),
            default_http_port: None,
            default_socks_port: Some(1080),
            controller_port: None,
            supports_tun: false,
            supports_subscriptions: false,
            supports_external_controller: false,
        },
        CoreProfile {
            id: "hysteria".into(),
            name: "Hysteria".into(),
            family: "hysteria".into(),
            executable: "hysteria-tun-windows-6.0-386.exe".into(),
            config_format: "json".into(),
            default_http_port: None,
            default_socks_port: Some(1080),
            controller_port: None,
            supports_tun: false,
            supports_subscriptions: false,
            supports_external_controller: false,
        },
        CoreProfile {
            id: "naiveproxy".into(),
            name: "NaiveProxy".into(),
            family: "naiveproxy".into(),
            executable: "naive.exe".into(),
            config_format: "json".into(),
            default_http_port: None,
            default_socks_port: Some(1080),
            controller_port: None,
            supports_tun: false,
            supports_subscriptions: false,
            supports_external_controller: false,
        },
        CoreProfile {
            id: "juicity".into(),
            name: "Juicity".into(),
            family: "juicity".into(),
            executable: "juicity-client.exe".into(),
            config_format: "json".into(),
            default_http_port: None,
            default_socks_port: Some(1080),
            controller_port: None,
            supports_tun: false,
            supports_subscriptions: false,
            supports_external_controller: false,
        },
        CoreProfile {
            id: "mieru".into(),
            name: "Mieru".into(),
            family: "mieru".into(),
            executable: "mieru.exe".into(),
            config_format: "json".into(),
            default_http_port: None,
            default_socks_port: Some(3080),
            controller_port: None,
            supports_tun: false,
            supports_subscriptions: false,
            supports_external_controller: false,
        },
        CoreProfile {
            id: "shadowquic".into(),
            name: "ShadowQUIC".into(),
            family: "shadowquic".into(),
            executable: "shadowquic.exe".into(),
            config_format: "yaml".into(),
            default_http_port: None,
            default_socks_port: Some(4080),
            controller_port: None,
            supports_tun: false,
            supports_subscriptions: false,
            supports_external_controller: false,
        },
    ]
}

pub fn statuses(app: &AppHandle) -> Result<Vec<CoreStatus>, String> {
    let runtime = paths::ensure(app)?;
    Ok(profiles()
        .into_iter()
        .map(|profile| {
            let user_path = PathBuf::from(&runtime.cores_dir)
                .join(&profile.id)
                .join(&profile.executable);
            let resource_core_id = if profile.id == "hysteria2" {
                "hy2"
            } else {
                &profile.id
            };
            let bundled_path = paths::resource_file(
                app,
                PathBuf::from("cores")
                    .join(resource_core_id)
                    .join(&profile.executable),
            )
            .ok();
            let (available, source, executable_path) = if user_path.is_file() {
                (
                    true,
                    "user".into(),
                    Some(user_path.to_string_lossy().into_owned()),
                )
            } else if let Some(bundled_path) = bundled_path {
                (
                    true,
                    "bundled".into(),
                    Some(bundled_path.to_string_lossy().into_owned()),
                )
            } else {
                (false, "missing".into(), None)
            };
            CoreStatus {
                profile,
                available,
                source,
                executable_path,
            }
        })
        .collect())
}
