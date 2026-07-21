use crate::{clash_profiles, paths};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs, time::Duration};
use tauri::AppHandle;

const CONTROLLER: &str = "http://127.0.0.1:9090";
const SECRET: &str = "KiNGO";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClashProxyNode {
    pub name: String,
    pub kind: String,
    pub delay: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClashProxyGroup {
    pub name: String,
    pub kind: String,
    pub now: Option<String>,
    pub nodes: Vec<ClashProxyNode>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClashProxyProvider {
    pub name: String,
    pub kind: String,
    pub vehicle_type: String,
    pub updated_at: Option<String>,
    pub node_count: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClashConnection {
    pub id: String,
    pub started_at: String,
    pub host: String,
    pub network: String,
    pub connection_type: String,
    pub source_ip: String,
    pub source_port: u64,
    pub destination_ip: String,
    pub destination_port: u64,
    pub process: String,
    pub process_path: String,
    pub rule: String,
    pub rule_payload: String,
    pub chains: Vec<String>,
    pub download: u64,
    pub upload: u64,
}

pub(crate) fn parse_connection_value(connection: &serde_json::Value) -> Option<ClashConnection> {
    let id = connection.get("id")?.as_str()?.to_owned();
    let metadata = connection.get("metadata");
    let text = |key: &str| {
        metadata
            .and_then(|item| item.get(key))
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .to_owned()
    };
    let number = |key: &str| {
        metadata
            .and_then(|item| item.get(key))
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0)
    };
    let destination_ip = text("destinationIP");
    let host = {
        let value = text("host");
        if value.is_empty() {
            if destination_ip.is_empty() {
                "未知目标".into()
            } else {
                destination_ip.clone()
            }
        } else {
            value
        }
    };
    Some(ClashConnection {
        id,
        started_at: connection
            .get("start")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .to_owned(),
        host,
        network: text("network"),
        connection_type: text("type"),
        source_ip: text("sourceIP"),
        source_port: number("sourcePort"),
        destination_ip,
        destination_port: number("destinationPort"),
        process: text("process"),
        process_path: text("processPath"),
        rule: connection
            .get("rule")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("-")
            .to_owned(),
        rule_payload: connection
            .get("rulePayload")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .to_owned(),
        chains: connection
            .get("chains")
            .and_then(serde_json::Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(serde_json::Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default(),
        download: connection
            .get("download")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0),
        upload: connection
            .get("upload")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0),
    })
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClashRule {
    pub kind: String,
    pub payload: String,
    pub proxy: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClashServiceResult {
    pub status: u16,
    pub latency: u128,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ClashSettings {
    pub mode: String,
    pub clash_core: String,
    pub allow_lan: bool,
    pub ipv6: bool,
    pub unified_delay: bool,
    pub system_proxy: bool,
    pub tun_enabled: bool,
}

impl Default for ClashSettings {
    fn default() -> Self {
        Self {
            mode: "rule".into(),
            clash_core: "mihomo".into(),
            allow_lan: false,
            ipv6: false,
            unified_delay: true,
            system_proxy: true,
            tun_enabled: false,
        }
    }
}

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|error| format!("创建 mihomo 控制请求失败：{error}"))
}

type SavedSelections = HashMap<String, HashMap<String, String>>;

fn selection_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let directory = std::path::PathBuf::from(paths::ensure(app)?.subscriptions_dir).join("clash");
    fs::create_dir_all(&directory).map_err(|error| format!("创建 Clash 选择目录失败：{error}"))?;
    Ok(directory.join("selections.json"))
}

fn settings_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(selection_path(app)?.with_file_name("settings.json"))
}

fn load_settings(app: &AppHandle) -> Result<ClashSettings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(ClashSettings::default());
    }
    let content =
        fs::read_to_string(path).map_err(|error| format!("读取 Clash 设置失败：{error}"))?;
    let settings: ClashSettings =
        serde_json::from_str(&content).map_err(|error| format!("Clash 设置格式错误：{error}"))?;
    if matches!(settings.mode.as_str(), "rule" | "global" | "direct") {
        Ok(settings)
    } else {
        Ok(ClashSettings::default())
    }
}

fn save_settings(app: &AppHandle, settings: &ClashSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    let content = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| format!("保存 Clash 设置失败：{error}"))
}

fn load_selections(app: &AppHandle) -> Result<SavedSelections, String> {
    let path = selection_path(app)?;
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let content =
        fs::read_to_string(path).map_err(|error| format!("读取 Clash 节点选择失败：{error}"))?;
    serde_json::from_str(&content).map_err(|error| format!("Clash 节点选择格式错误：{error}"))
}

fn save_selections(app: &AppHandle, selections: &SavedSelections) -> Result<(), String> {
    let path = selection_path(app)?;
    let temporary = path.with_extension("json.tmp");
    let content = serde_json::to_string_pretty(selections).map_err(|error| error.to_string())?;
    fs::write(&temporary, content).map_err(|error| format!("保存 Clash 节点选择失败：{error}"))?;
    if path.exists() {
        let backup = path.with_extension("json.bak");
        if backup.exists() {
            let _ = fs::remove_file(&backup);
        }
        fs::rename(&path, &backup).map_err(|error| format!("备份 Clash 节点选择失败：{error}"))?;
        if let Err(error) = fs::rename(&temporary, &path) {
            let _ = fs::rename(backup, &path);
            return Err(format!("提交 Clash 节点选择失败：{error}"));
        }
        let _ = fs::remove_file(backup);
        return Ok(());
    }
    fs::rename(temporary, path).map_err(|error| format!("提交 Clash 节点选择失败：{error}"))
}

fn controller_url(parts: &[&str]) -> Result<reqwest::Url, String> {
    let mut url = reqwest::Url::parse(CONTROLLER).map_err(|error| error.to_string())?;
    url.path_segments_mut()
        .map_err(|_| "mihomo Controller 地址无效")?
        .extend(parts.iter().copied());
    Ok(url)
}

fn group_order(app: &AppHandle) -> Vec<String> {
    let Ok(profiles) = clash_profiles::list(app) else {
        return Vec::new();
    };
    let Some(profile) = profiles.iter().find(|profile| profile.active) else {
        return Vec::new();
    };
    let Ok(runtime) = paths::ensure(app) else {
        return Vec::new();
    };
    let path = std::path::PathBuf::from(runtime.routes_dir)
        .join(&profile.id)
        .join("config.yaml");
    let Ok(content) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(value) = serde_yaml::from_str::<serde_yaml::Value>(&content) else {
        return Vec::new();
    };
    value
        .get("proxy-groups")
        .and_then(serde_yaml::Value::as_sequence)
        .map(|groups| {
            groups
                .iter()
                .filter_map(|group| {
                    group
                        .get("name")
                        .and_then(serde_yaml::Value::as_str)
                        .map(str::to_owned)
                })
                .collect()
        })
        .unwrap_or_default()
}

pub fn list_groups(app: &AppHandle) -> Result<Vec<ClashProxyGroup>, String> {
    let response = client()?
        .get(controller_url(&["proxies"])?)
        .bearer_auth(SECRET)
        .send()
        .map_err(|error| format!("读取 mihomo 代理组失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "读取 mihomo 代理组失败：HTTP {}",
            response.status()
        ));
    }
    let value: serde_json::Value = response
        .json()
        .map_err(|error| format!("解析 mihomo 代理组失败：{error}"))?;
    let proxies = value
        .get("proxies")
        .and_then(serde_json::Value::as_object)
        .ok_or("mihomo 没有返回代理数据")?;
    let mut groups = HashMap::new();
    for (name, group) in proxies {
        let Some(all) = group.get("all").and_then(serde_json::Value::as_array) else {
            continue;
        };
        let nodes = all
            .iter()
            .filter_map(serde_json::Value::as_str)
            .map(|node_name| {
                let node = proxies.get(node_name);
                let delay = node
                    .and_then(|item| item.get("history"))
                    .and_then(serde_json::Value::as_array)
                    .and_then(|items| items.last())
                    .and_then(|item| item.get("delay"))
                    .and_then(serde_json::Value::as_u64)
                    .filter(|delay| *delay > 0);
                ClashProxyNode {
                    name: node_name.into(),
                    kind: node
                        .and_then(|item| item.get("type"))
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("Unknown")
                        .into(),
                    delay,
                }
            })
            .collect();
        groups.insert(
            name.clone(),
            ClashProxyGroup {
                name: name.clone(),
                kind: group
                    .get("type")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("Selector")
                    .into(),
                now: group
                    .get("now")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_owned),
                nodes,
            },
        );
    }
    let mut output = Vec::new();
    for name in group_order(app) {
        if let Some(group) = groups.remove(&name) {
            output.push(group);
        }
    }
    let mut remaining: Vec<_> = groups.into_values().collect();
    remaining.sort_by(|left, right| left.name.cmp(&right.name));
    output.extend(remaining);
    Ok(output)
}

pub fn get_saved_mode(app: &AppHandle) -> Result<String, String> {
    Ok(load_settings(app)?.mode)
}

fn patch_configs(value: serde_json::Value) -> Result<(), String> {
    let response = client()?
        .patch(controller_url(&["configs"])?)
        .bearer_auth(SECRET)
        .json(&value)
        .send()
        .map_err(|error| format!("切换 mihomo 模式失败：{error}"))?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!("切换 mihomo 模式失败：HTTP {}", response.status()))
    }
}

fn set_mode_remote(mode: &str) -> Result<(), String> {
    patch_configs(serde_json::json!({ "mode": mode }))
}

pub fn set_mode(app: &AppHandle, mode: &str, apply_remote: bool) -> Result<(), String> {
    if !matches!(mode, "rule" | "global" | "direct") {
        return Err("不支持的 Clash 代理模式".into());
    }
    if apply_remote {
        set_mode_remote(mode)?;
    }
    let mut settings = load_settings(app)?;
    settings.mode = mode.into();
    save_settings(app, &settings)
}

pub fn apply_saved_mode(app: &AppHandle) -> Result<String, String> {
    let settings = load_settings(app)?;
    patch_configs(serde_json::json!({
        "mode": settings.mode,
        "allow-lan": settings.allow_lan,
        "ipv6": settings.ipv6,
        "unified-delay": settings.unified_delay,
        "tun": { "enable": settings.tun_enabled },
    }))?;
    Ok(settings.mode)
}

fn remote_tun_enabled() -> Result<bool, String> {
    let response = client()?
        .get(controller_url(&["configs"])?)
        .bearer_auth(SECRET)
        .send()
        .map_err(|error| format!("读取 Mihomo TUN 状态失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "读取 Mihomo TUN 状态失败：HTTP {}",
            response.status()
        ));
    }
    let value: serde_json::Value = response
        .json()
        .map_err(|error| format!("解析 Mihomo TUN 状态失败：{error}"))?;
    Ok(value
        .get("tun")
        .and_then(|tun| tun.get("enable"))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false))
}

pub fn set_tun_enabled(app: &AppHandle, enabled: bool) -> Result<ClashSettings, String> {
    let mut settings = load_settings(app)?;
    let previous = remote_tun_enabled()?;
    patch_configs(serde_json::json!({ "tun": { "enable": enabled } }))?;
    match remote_tun_enabled() {
        Ok(actual) if actual == enabled => {
            settings.tun_enabled = enabled;
            save_settings(app, &settings)?;
            Ok(settings)
        }
        Ok(_) => {
            let _ = patch_configs(serde_json::json!({ "tun": { "enable": previous } }));
            Err("Mihomo 未接受 TUN 状态变更，已回滚".into())
        }
        Err(error) => {
            let _ = patch_configs(serde_json::json!({ "tun": { "enable": previous } }));
            Err(format!("{error}；已回滚 TUN 设置"))
        }
    }
}

pub fn save_system_proxy(app: &AppHandle, enabled: bool) -> Result<ClashSettings, String> {
    let mut settings = load_settings(app)?;
    settings.system_proxy = enabled;
    save_settings(app, &settings)?;
    Ok(settings)
}

pub fn get_settings(app: &AppHandle) -> Result<ClashSettings, String> {
    load_settings(app)
}

pub fn active_core(app: &AppHandle) -> Result<String, String> {
    let settings = load_settings(app)?;
    if matches!(settings.clash_core.as_str(), "mihomo" | "mihomo-alpha") {
        Ok(settings.clash_core)
    } else {
        Ok("mihomo".into())
    }
}

pub fn set_active_core(app: &AppHandle, core_id: &str) -> Result<ClashSettings, String> {
    if !matches!(core_id, "mihomo" | "mihomo-alpha") {
        return Err("不支持的 Clash 内核".into());
    }
    let mut settings = load_settings(app)?;
    settings.clash_core = core_id.into();
    save_settings(app, &settings)?;
    Ok(settings)
}

pub fn set_boolean_setting(
    app: &AppHandle,
    key: &str,
    value: bool,
    apply_remote: bool,
) -> Result<ClashSettings, String> {
    let mut settings = load_settings(app)?;
    let remote_key = match key {
        "allowLan" => {
            settings.allow_lan = value;
            "allow-lan"
        }
        "ipv6" => {
            settings.ipv6 = value;
            "ipv6"
        }
        "unifiedDelay" => {
            settings.unified_delay = value;
            "unified-delay"
        }
        _ => return Err("不支持的 Clash 设置".into()),
    };
    if apply_remote {
        let mut change = serde_json::Map::new();
        change.insert(remote_key.into(), serde_json::Value::Bool(value));
        patch_configs(serde_json::Value::Object(change))?;
    }
    save_settings(app, &settings)?;
    Ok(settings)
}

pub fn list_proxy_providers() -> Result<Vec<ClashProxyProvider>, String> {
    let response = client()?
        .get(controller_url(&["providers", "proxies"])?)
        .bearer_auth(SECRET)
        .send()
        .map_err(|error| format!("读取 Proxy Provider 失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "读取 Proxy Provider 失败：HTTP {}",
            response.status()
        ));
    }
    let value: serde_json::Value = response
        .json()
        .map_err(|error| format!("解析 Proxy Provider 失败：{error}"))?;
    let providers = value
        .get("providers")
        .and_then(serde_json::Value::as_object)
        .ok_or("mihomo 没有返回 Proxy Provider")?;
    let mut output: Vec<_> = providers
        .iter()
        .map(|(name, provider)| ClashProxyProvider {
            name: name.clone(),
            kind: provider
                .get("type")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("Proxy")
                .into(),
            vehicle_type: provider
                .get("vehicleType")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("Unknown")
                .into(),
            updated_at: provider
                .get("updatedAt")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned),
            node_count: provider
                .get("proxies")
                .and_then(serde_json::Value::as_array)
                .map(Vec::len)
                .unwrap_or(0),
        })
        .collect();
    output.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(output)
}

pub fn update_proxy_provider(name: &str) -> Result<(), String> {
    let response = client()?
        .put(controller_url(&["providers", "proxies", name])?)
        .bearer_auth(SECRET)
        .send()
        .map_err(|error| format!("更新 Proxy Provider 失败：{error}"))?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!(
            "更新 Proxy Provider 失败：HTTP {}",
            response.status()
        ))
    }
}

pub fn healthcheck_proxy_provider(name: &str) -> Result<(), String> {
    let response = client()?
        .get(controller_url(&[
            "providers",
            "proxies",
            name,
            "healthcheck",
        ])?)
        .bearer_auth(SECRET)
        .send()
        .map_err(|error| format!("Proxy Provider 健康检查失败：{error}"))?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!(
            "Proxy Provider 健康检查失败：HTTP {}",
            response.status()
        ))
    }
}

fn select_proxy_remote(group: &str, proxy: &str) -> Result<(), String> {
    let response = client()?
        .put(controller_url(&["proxies", group])?)
        .bearer_auth(SECRET)
        .json(&serde_json::json!({ "name": proxy }))
        .send()
        .map_err(|error| format!("切换 mihomo 节点失败：{error}"))?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!("切换 mihomo 节点失败：HTTP {}", response.status()))
    }
}

pub fn select_proxy(app: &AppHandle, group: &str, proxy: &str) -> Result<(), String> {
    select_proxy_remote(group, proxy)?;
    let profile = clash_profiles::list(app)?
        .into_iter()
        .find(|profile| profile.active)
        .ok_or("当前没有活动 Clash 配置")?;
    let mut selections = load_selections(app)?;
    selections
        .entry(profile.id)
        .or_default()
        .insert(group.into(), proxy.into());
    save_selections(app, &selections)
}

pub fn apply_saved_selections(app: &AppHandle, profile_id: &str) -> Result<usize, String> {
    let mut selections = load_selections(app)?;
    let stored = selections.remove(profile_id).unwrap_or_default();
    let mut applied = 0;
    for (group, proxy) in stored {
        if select_proxy_remote(&group, &proxy).is_ok() {
            applied += 1;
        }
    }
    Ok(applied)
}

pub fn remove_saved_selections(app: &AppHandle, profile_id: &str) -> Result<(), String> {
    let mut selections = load_selections(app)?;
    if selections.remove(profile_id).is_some() {
        save_selections(app, &selections)?;
    }
    Ok(())
}

pub fn test_delay(proxy: &str) -> Result<u64, String> {
    let mut url = controller_url(&["proxies", proxy, "delay"])?;
    url.query_pairs_mut()
        .append_pair("url", "https://www.gstatic.com/generate_204")
        .append_pair("timeout", "5000");
    let response = client()?
        .get(url)
        .bearer_auth(SECRET)
        .send()
        .map_err(|error| format!("mihomo 节点测速失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("mihomo 节点测速失败：HTTP {}", response.status()));
    }
    let value: serde_json::Value = response
        .json()
        .map_err(|error| format!("解析测速结果失败：{error}"))?;
    value
        .get("delay")
        .and_then(serde_json::Value::as_u64)
        .filter(|delay| *delay > 0)
        .ok_or_else(|| "节点测速超时".into())
}

pub fn test_group_delay(group: &str) -> Result<HashMap<String, u64>, String> {
    let mut url = controller_url(&["group", group, "delay"])?;
    url.query_pairs_mut()
        .append_pair("url", "https://www.gstatic.com/generate_204")
        .append_pair("timeout", "5000");
    let response = client()?
        .get(url)
        .bearer_auth(SECRET)
        .send()
        .map_err(|error| format!("mihomo 整组测速失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("mihomo 整组测速失败：HTTP {}", response.status()));
    }
    response
        .json::<HashMap<String, u64>>()
        .map_err(|error| format!("解析整组测速结果失败：{error}"))
}

pub fn list_connections() -> Result<Vec<ClashConnection>, String> {
    let response = client()?
        .get(controller_url(&["connections"])?)
        .bearer_auth(SECRET)
        .send()
        .map_err(|error| format!("读取 mihomo 连接失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("读取 mihomo 连接失败：HTTP {}", response.status()));
    }
    let value: serde_json::Value = response
        .json()
        .map_err(|error| format!("解析 mihomo 连接失败：{error}"))?;
    let connections = value
        .get("connections")
        .and_then(serde_json::Value::as_array)
        .ok_or("mihomo 没有返回连接数据")?;
    Ok(connections
        .iter()
        .filter_map(parse_connection_value)
        .collect())
}

pub fn close_connections() -> Result<(), String> {
    let response = client()?
        .delete(controller_url(&["connections"])?)
        .bearer_auth(SECRET)
        .send()
        .map_err(|error| format!("关闭 mihomo 连接失败：{error}"))?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!("关闭 mihomo 连接失败：HTTP {}", response.status()))
    }
}

pub fn close_connection(id: &str) -> Result<(), String> {
    let response = client()?
        .delete(controller_url(&["connections", id])?)
        .bearer_auth(SECRET)
        .send()
        .map_err(|error| format!("关闭 mihomo 连接失败：{error}"))?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!("关闭 mihomo 连接失败：HTTP {}", response.status()))
    }
}

pub fn list_rules() -> Result<Vec<ClashRule>, String> {
    let response = client()?
        .get(controller_url(&["rules"])?)
        .bearer_auth(SECRET)
        .send()
        .map_err(|error| format!("读取 mihomo 规则失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("读取 mihomo 规则失败：HTTP {}", response.status()));
    }
    let value: serde_json::Value = response
        .json()
        .map_err(|error| format!("解析 mihomo 规则失败：{error}"))?;
    Ok(value
        .get("rules")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .map(|rule| ClashRule {
            kind: rule
                .get("type")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("-")
                .to_owned(),
            payload: rule
                .get("payload")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("-")
                .to_owned(),
            proxy: rule
                .get("proxy")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("-")
                .to_owned(),
        })
        .collect())
}

pub fn test_service(url: &str) -> Result<ClashServiceResult, String> {
    let proxy = reqwest::Proxy::all("http://127.0.0.1:7890")
        .map_err(|error| format!("创建 Mihomo 测试代理失败：{error}"))?;
    let client = reqwest::blocking::Client::builder()
        .proxy(proxy)
        .timeout(Duration::from_secs(12))
        .user_agent("Mozilla/5.0 KiNGO/2.0")
        .build()
        .map_err(|error| format!("创建服务测试请求失败：{error}"))?;
    let started = std::time::Instant::now();
    let response = client
        .get(url)
        .send()
        .map_err(|error| format!("服务连接失败：{error}"))?;
    Ok(ClashServiceResult {
        status: response.status().as_u16(),
        latency: started.elapsed().as_millis(),
    })
}
