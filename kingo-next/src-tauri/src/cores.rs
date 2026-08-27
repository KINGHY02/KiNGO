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

fn platform_executable(windows: &str, macos: &str) -> String {
    if cfg!(target_os = "macos") {
        macos.into()
    } else {
        windows.into()
    }
}

pub fn profiles() -> Vec<CoreProfile> {
    vec![
        CoreProfile {
            id: "mihomo".into(),
            name: "mihomo".into(),
            family: "mihomo".into(),
            executable: platform_executable("mihomo.exe", "mihomo"),
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
            executable: platform_executable("mihomo-alpha.exe", "mihomo-alpha"),
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
            executable: platform_executable("xray.exe", "xray"),
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
            executable: platform_executable("sing-box.exe", "sing-box"),
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
            executable: platform_executable("hysteria2.exe", "hysteria2"),
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
            executable: platform_executable("hysteria-tun-windows-6.0-386.exe", "hysteria"),
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
            executable: platform_executable("naive.exe", "naive"),
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
            executable: platform_executable("juicity-client.exe", "juicity-client"),
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
            executable: platform_executable("mieru.exe", "mieru"),
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
            executable: platform_executable("shadowquic.exe", "shadowquic"),
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

fn resource_core_id(profile: &CoreProfile) -> &str {
    if profile.id == "hysteria2" {
        "hy2"
    } else {
        &profile.id
    }
}

pub fn executable(app: &AppHandle, core_id: &str) -> Result<(CoreProfile, PathBuf), String> {
    let profile = profiles()
        .into_iter()
        .find(|profile| profile.id == core_id)
        .ok_or_else(|| "核心不存在".to_string())?;
    let runtime = paths::ensure(app)?;
    let user_path = PathBuf::from(runtime.cores_dir)
        .join(&profile.id)
        .join(&profile.executable);
    let executable = if user_path.is_file() {
        user_path
    } else {
        paths::bundled_core_file(app, resource_core_id(&profile), &profile.executable)?
    };
    Ok((profile, executable))
}

pub fn statuses(app: &AppHandle) -> Result<Vec<CoreStatus>, String> {
    let runtime = paths::ensure(app)?;
    Ok(profiles()
        .into_iter()
        .map(|profile| {
            let user_path = PathBuf::from(&runtime.cores_dir)
                .join(&profile.id)
                .join(&profile.executable);
            let bundled_path =
                paths::bundled_core_file(app, resource_core_id(&profile), &profile.executable).ok();
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
