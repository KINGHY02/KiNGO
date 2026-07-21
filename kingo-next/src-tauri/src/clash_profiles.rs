use crate::{core_runtime, paths};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::AppHandle;
use tauri::Emitter;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClashProfile {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(default = "default_profile_source")]
    pub source: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub user_agent: String,
    #[serde(default = "default_timeout")]
    pub timeout_seconds: u64,
    #[serde(default = "default_proxy_mode")]
    pub proxy_mode: String,
    #[serde(default)]
    pub accept_invalid_certs: bool,
    #[serde(default = "default_true")]
    pub allow_auto_update: bool,
    #[serde(default)]
    pub basic_routing: bool,
    #[serde(default)]
    pub update_interval: Option<u64>,
    #[serde(default)]
    pub next_update_at: Option<u64>,
    #[serde(default)]
    pub upload: u64,
    #[serde(default)]
    pub download: u64,
    #[serde(default)]
    pub total: u64,
    #[serde(default)]
    pub expire: u64,
    #[serde(default)]
    pub home_url: String,
    pub file_name: String,
    pub updated_at: Option<u64>,
    pub active: bool,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ClashImportOptions {
    pub description: String,
    pub user_agent: String,
    pub timeout_seconds: u64,
    pub proxy_mode: String,
    pub accept_invalid_certs: bool,
    pub allow_auto_update: bool,
    pub update_interval: Option<u64>,
    pub fallback_to_clash: bool,
    pub basic_routing: bool,
}

impl Default for ClashImportOptions {
    fn default() -> Self {
        Self {
            description: String::new(),
            user_agent: String::new(),
            timeout_seconds: default_timeout(),
            proxy_mode: default_proxy_mode(),
            accept_invalid_certs: false,
            allow_auto_update: true,
            update_interval: None,
            fallback_to_clash: true,
            basic_routing: false,
        }
    }
}

struct DownloadResult {
    content: String,
    suggested_name: Option<String>,
    update_interval: Option<u64>,
    upload: u64,
    download: u64,
    total: u64,
    expire: u64,
    home_url: String,
}

static PROFILE_WRITE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static SCHEDULER_STARTED: OnceLock<()> = OnceLock::new();

fn write_lock() -> &'static Mutex<()> {
    PROFILE_WRITE_LOCK.get_or_init(|| Mutex::new(()))
}

pub fn start_scheduler(app: AppHandle) {
    if SCHEDULER_STARTED.set(()).is_err() {
        return;
    }
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(30));
        let current = now();
        let due = list(&app)
            .unwrap_or_default()
            .into_iter()
            .filter(|profile| {
                profile.source == "url"
                    && profile.allow_auto_update
                    && profile.next_update_at.is_some_and(|next| next <= current)
            })
            .map(|profile| profile.id)
            .collect::<Vec<_>>();
        for profile_id in due {
            let result = update(&app, &profile_id);
            let _ = app.emit(
                "clash-profiles-changed",
                serde_json::json!({
                    "profileId": profile_id,
                    "updated": result.is_ok(),
                    "error": result.err()
                }),
            );
        }
    });
}

fn default_profile_source() -> String {
    "url".into()
}

fn default_timeout() -> u64 {
    20
}

fn default_proxy_mode() -> String {
    "system".into()
}

fn default_true() -> bool {
    true
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn profile_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let root = PathBuf::from(paths::ensure(app)?.subscriptions_dir).join("clash");
    fs::create_dir_all(&root).map_err(|error| format!("无法创建 Clash 订阅目录：{error}"))?;
    Ok(root)
}

fn index_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(profile_dir(app)?.join("profiles.json"))
}

pub fn list(app: &AppHandle) -> Result<Vec<ClashProfile>, String> {
    let path = index_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content =
        fs::read_to_string(path).map_err(|error| format!("读取 Clash 订阅索引失败：{error}"))?;
    serde_json::from_str(&content).map_err(|error| format!("Clash 订阅索引格式错误：{error}"))
}

pub fn get(app: &AppHandle, profile_id: &str) -> Result<ClashProfile, String> {
    list(app)?
        .into_iter()
        .find(|profile| profile.id == profile_id)
        .ok_or_else(|| "Clash 订阅不存在".into())
}

fn render_runtime(content: &str, tun_enabled: bool) -> Result<String, String> {
    let mut value: serde_yaml::Value =
        serde_yaml::from_str(content).map_err(|error| format!("Clash YAML 格式错误：{error}"))?;
    let root = value.as_mapping_mut().ok_or("Clash YAML 顶层必须是对象")?;
    root.insert(
        serde_yaml::Value::String("mixed-port".into()),
        serde_yaml::Value::Number(7890.into()),
    );
    root.insert(
        serde_yaml::Value::String("external-controller".into()),
        serde_yaml::Value::String("127.0.0.1:9090".into()),
    );
    root.insert(
        serde_yaml::Value::String("secret".into()),
        serde_yaml::Value::String("KiNGO".into()),
    );
    root.insert(
        serde_yaml::Value::String("geodata-mode".into()),
        serde_yaml::Value::Bool(true),
    );
    root.insert(
        serde_yaml::Value::String("geodata-loader".into()),
        serde_yaml::Value::String("memconservative".into()),
    );
    let tun_key = serde_yaml::Value::String("tun".into());
    let tun = root
        .entry(tun_key)
        .or_insert_with(|| serde_yaml::Value::Mapping(Default::default()));
    if !tun.is_mapping() {
        *tun = serde_yaml::Value::Mapping(Default::default());
    }
    let tun = tun.as_mapping_mut().expect("TUN mapping initialized");
    tun.insert(
        serde_yaml::Value::String("enable".into()),
        serde_yaml::Value::Bool(tun_enabled),
    );
    if tun_enabled {
        tun.entry(serde_yaml::Value::String("stack".into()))
            .or_insert_with(|| serde_yaml::Value::String("mixed".into()));
        tun.entry(serde_yaml::Value::String("auto-route".into()))
            .or_insert(serde_yaml::Value::Bool(true));
        tun.entry(serde_yaml::Value::String("auto-detect-interface".into()))
            .or_insert(serde_yaml::Value::Bool(true));
        tun.entry(serde_yaml::Value::String("dns-hijack".into()))
            .or_insert_with(|| {
                serde_yaml::Value::Sequence(vec![serde_yaml::Value::String("any:53".into())])
            });
    }
    serde_yaml::to_string(&value).map_err(|error| format!("生成 Clash 运行配置失败：{error}"))
}

fn ensure_mihomo_geodata(app: &AppHandle, directory: &std::path::Path) -> Result<(), String> {
    fs::create_dir_all(directory).map_err(|error| format!("创建 Clash 数据目录失败：{error}"))?;
    for (resource, file_name) in [
        ("cores/xray/geoip.dat", "geoip.dat"),
        ("cores/xray/geosite.dat", "geosite.dat"),
    ] {
        let source = paths::resource_file(app, resource)?;
        let target = directory.join(file_name);
        let needs_copy = fs::metadata(&target)
            .map(|metadata| metadata.len() == 0)
            .unwrap_or(true);
        if needs_copy {
            fs::copy(&source, &target)
                .map_err(|error| format!("准备 Clash 离线地理数据 {file_name} 失败：{error}"))?;
        }
    }
    Ok(())
}

fn validate_with_mihomo(
    app: &AppHandle,
    profile_id: &str,
    content: &str,
) -> Result<String, String> {
    validate(content)?;
    let tun_enabled = crate::clash_controller::get_settings(app)?.tun_enabled;
    let rendered = render_runtime(content, tun_enabled)?;
    let routes_dir = PathBuf::from(paths::ensure(app)?.routes_dir);
    let staging_dir = routes_dir.join(format!(".staging-{profile_id}"));
    if staging_dir.exists() {
        fs::remove_dir_all(&staging_dir)
            .map_err(|error| format!("清理 Clash 校验目录失败：{error}"))?;
    }
    fs::create_dir_all(&staging_dir)
        .map_err(|error| format!("创建 Clash 校验目录失败：{error}"))?;
    ensure_mihomo_geodata(app, &staging_dir)?;
    let staging_config = staging_dir.join("config.yaml");
    fs::write(&staging_config, &rendered)
        .map_err(|error| format!("写入 Clash 运行配置失败：{error}"))?;
    if let Err(error) = core_runtime::validate_mihomo_config(app, &staging_config.to_string_lossy())
    {
        let _ = fs::remove_dir_all(&staging_dir);
        return Err(error);
    }
    let _ = fs::remove_dir_all(&staging_dir);
    Ok(rendered)
}

pub fn prepare_runtime(app: &AppHandle, profile_id: &str) -> Result<String, String> {
    let profile = get(app, profile_id)?;
    let source = profile_dir(app)?.join(&profile.file_name);
    let content =
        fs::read_to_string(source).map_err(|error| format!("读取 Clash 配置失败：{error}"))?;
    let rendered = validate_with_mihomo(app, profile_id, &content)?;
    let routes_dir = PathBuf::from(paths::ensure(app)?.routes_dir);
    let runtime_dir = routes_dir.join(&profile.id);
    fs::create_dir_all(&runtime_dir)
        .map_err(|error| format!("创建 Clash 运行目录失败：{error}"))?;
    ensure_mihomo_geodata(app, &runtime_dir)?;
    let target = runtime_dir.join("config.yaml");
    let temporary = runtime_dir.join("config.yaml.tmp");
    fs::write(&temporary, rendered).map_err(|error| format!("写入 Clash 运行配置失败：{error}"))?;
    replace_file(&temporary, &target, "Clash 运行配置")?;
    Ok(target.to_string_lossy().into_owned())
}

fn save_index(app: &AppHandle, profiles: &[ClashProfile]) -> Result<(), String> {
    let path = index_path(app)?;
    let temporary = path.with_extension("json.tmp");
    let content = serde_json::to_string_pretty(profiles).map_err(|error| error.to_string())?;
    fs::write(&temporary, content).map_err(|error| format!("保存 Clash 订阅索引失败：{error}"))?;
    replace_file(&temporary, &path, "Clash 订阅索引")
}

fn replace_file(
    temporary: &std::path::Path,
    target: &std::path::Path,
    label: &str,
) -> Result<(), String> {
    let backup = target.with_extension("bak");
    if backup.exists() {
        fs::remove_file(&backup).map_err(|error| format!("清理 {label} 备份失败：{error}"))?;
    }
    if target.exists() {
        fs::rename(target, &backup).map_err(|error| format!("备份 {label} 失败：{error}"))?;
    }
    if let Err(error) = fs::rename(temporary, target) {
        if backup.exists() {
            let _ = fs::rename(&backup, target);
        }
        return Err(format!("提交 {label} 失败：{error}"));
    }
    if backup.exists() {
        let _ = fs::remove_file(backup);
    }
    Ok(())
}

fn subscription_value(value: &str, key: &str) -> u64 {
    value
        .split([',', ';'])
        .find_map(|part| {
            let (name, value) = part.trim().split_once('=')?;
            (name.eq_ignore_ascii_case(key))
                .then(|| value.parse().ok())
                .flatten()
        })
        .unwrap_or(0)
}

fn response_file_name(value: &str) -> Option<String> {
    for key in ["filename*=", "filename="] {
        if let Some(raw) = value.split(';').find_map(|part| {
            let part = part.trim();
            part.to_ascii_lowercase()
                .starts_with(key)
                .then(|| part[key.len()..].trim_matches([' ', '"', '\'']))
        }) {
            let raw = raw.split("''").last().unwrap_or(raw);
            let decoded = percent_encoding::percent_decode_str(raw)
                .decode_utf8_lossy()
                .trim()
                .to_owned();
            if !decoded.is_empty() {
                return Some(decoded);
            }
        }
    }
    None
}

fn url_file_name(value: &str) -> Option<String> {
    let url = url::Url::parse(value).ok()?;
    let raw = url.path_segments()?.next_back()?;
    let decoded = percent_encoding::percent_decode_str(raw)
        .decode_utf8_lossy()
        .trim()
        .to_owned();
    (!decoded.is_empty()).then_some(decoded)
}

fn download_once(url: &str, options: &ClashImportOptions) -> Result<DownloadResult, String> {
    let mut builder = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(options.timeout_seconds.clamp(5, 300)))
        .redirect(reqwest::redirect::Policy::limited(5))
        .danger_accept_invalid_certs(options.accept_invalid_certs);
    builder = match options.proxy_mode.as_str() {
        "direct" => builder.no_proxy(),
        "clash" => builder.proxy(
            reqwest::Proxy::all("http://127.0.0.1:7890")
                .map_err(|error| format!("创建 Clash 下载代理失败：{error}"))?,
        ),
        "system" => builder,
        _ => return Err("订阅下载方式无效".into()),
    };
    let client = builder
        .build()
        .map_err(|error| format!("创建订阅请求失败：{error}"))?;
    let user_agents = if options.user_agent.trim().is_empty() {
        vec!["clash-verge-rev/v2.5.2", "ClashforWindows/0.20.39"]
    } else {
        vec![options.user_agent.trim(), options.user_agent.trim()]
    };
    let mut last_error = String::new();
    for attempt in 0..3 {
        let user_agent = user_agents[attempt % user_agents.len()];
        match client
            .get(url)
            .header("User-Agent", user_agent)
            .header("Accept", "application/yaml,text/yaml,text/plain,*/*")
            .send()
        {
            Ok(response) if response.status().is_success() => {
                let headers = response.headers().clone();
                let suggested_name = headers
                    .get(reqwest::header::CONTENT_DISPOSITION)
                    .and_then(|value| value.to_str().ok())
                    .and_then(response_file_name);
                let subscription = headers
                    .get("subscription-userinfo")
                    .and_then(|value| value.to_str().ok())
                    .unwrap_or("");
                let header_interval = headers
                    .get("profile-update-interval")
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| value.parse::<u64>().ok())
                    .map(|hours| hours * 60);
                let home_url = headers
                    .get("profile-web-page-url")
                    .and_then(|value| value.to_str().ok())
                    .unwrap_or("")
                    .to_owned();
                match response.text() {
                    Ok(content) if !content.trim().is_empty() => {
                        return Ok(DownloadResult {
                            content: content.trim_start_matches('\u{feff}').into(),
                            suggested_name,
                            update_interval: header_interval,
                            upload: subscription_value(subscription, "upload"),
                            download: subscription_value(subscription, "download"),
                            total: subscription_value(subscription, "total"),
                            expire: subscription_value(subscription, "expire"),
                            home_url,
                        });
                    }
                    Ok(_) => last_error = "订阅响应为空".into(),
                    Err(error) => last_error = format!("读取响应失败：{error}"),
                }
            }
            Ok(response) => last_error = format!("HTTP {}", response.status()),
            Err(error) => last_error = error.to_string(),
        }
        if attempt < 2 {
            std::thread::sleep(Duration::from_millis(250));
        }
    }
    Err(format!("下载 Clash 订阅失败（已重试 3 次）：{last_error}"))
}

fn download(url: &str, options: &ClashImportOptions) -> Result<DownloadResult, String> {
    match download_once(url, options) {
        Ok(result) => Ok(result),
        Err(initial_error) if options.fallback_to_clash && options.proxy_mode != "clash" => {
            let mut fallback = options.clone();
            fallback.proxy_mode = "clash".into();
            fallback.fallback_to_clash = false;
            download_once(url, &fallback).map_err(|fallback_error| {
                format!("{initial_error}；使用当前 Clash 代理重试仍失败：{fallback_error}")
            })
        }
        Err(error) => Err(error),
    }
}

fn validate(content: &str) -> Result<(), String> {
    let value: serde_yaml::Value =
        serde_yaml::from_str(content).map_err(|error| format!("Clash YAML 格式错误：{error}"))?;
    let root = value.as_mapping().ok_or("Clash YAML 顶层必须是对象")?;
    let proxies = serde_yaml::Value::String("proxies".into());
    let providers = serde_yaml::Value::String("proxy-providers".into());
    if !root.contains_key(&proxies) && !root.contains_key(&providers) {
        return Err("配置中没有 proxies 或 proxy-providers，无法作为 Clash 订阅使用".into());
    }
    Ok(())
}

fn apply_basic_routing(content: &str) -> Result<(String, bool), String> {
    let mut value: serde_yaml::Value =
        serde_yaml::from_str(content).map_err(|error| format!("Clash YAML 格式错误：{error}"))?;
    let root = value.as_mapping_mut().ok_or("Clash YAML 顶层必须是对象")?;
    let groups_key = serde_yaml::Value::String("proxy-groups".into());
    let rules_key = serde_yaml::Value::String("rules".into());
    let groups_missing = root
        .get(&groups_key)
        .and_then(serde_yaml::Value::as_sequence)
        .is_none_or(Vec::is_empty);
    let rules_missing = root
        .get(&rules_key)
        .and_then(serde_yaml::Value::as_sequence)
        .is_none_or(Vec::is_empty);
    if !groups_missing && !rules_missing {
        return Ok((content.into(), false));
    }

    let mut route_target = root
        .get(&groups_key)
        .and_then(serde_yaml::Value::as_sequence)
        .and_then(|groups| groups.first())
        .and_then(serde_yaml::Value::as_mapping)
        .and_then(|group| group.get(serde_yaml::Value::String("name".into())))
        .and_then(serde_yaml::Value::as_str)
        .map(str::to_owned);

    if groups_missing {
        let proxy_names: Vec<_> = root
            .get(serde_yaml::Value::String("proxies".into()))
            .and_then(serde_yaml::Value::as_sequence)
            .into_iter()
            .flatten()
            .filter_map(|proxy| proxy.get("name").and_then(serde_yaml::Value::as_str))
            .map(|name| serde_yaml::Value::String(name.into()))
            .collect();
        let provider_names: Vec<_> = root
            .get(serde_yaml::Value::String("proxy-providers".into()))
            .and_then(serde_yaml::Value::as_mapping)
            .into_iter()
            .flat_map(|providers| providers.keys())
            .filter_map(serde_yaml::Value::as_str)
            .map(|name| serde_yaml::Value::String(name.into()))
            .collect();
        if proxy_names.is_empty() && provider_names.is_empty() {
            return Err("订阅没有可用于基础分流的节点或 Proxy Provider".into());
        }
        let group_name = "节点选择".to_string();
        let mut group = serde_yaml::Mapping::new();
        group.insert("name".into(), group_name.clone().into());
        group.insert("type".into(), "select".into());
        if !proxy_names.is_empty() {
            group.insert("proxies".into(), serde_yaml::Value::Sequence(proxy_names));
        }
        if !provider_names.is_empty() {
            group.insert("use".into(), serde_yaml::Value::Sequence(provider_names));
        }
        root.insert(
            groups_key,
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(group)]),
        );
        route_target = Some(group_name);
    }
    if rules_missing {
        let target = route_target.ok_or("无法确定基础分流的代理组")?;
        root.insert(
            rules_key,
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::String(format!("MATCH,{target}"))]),
        );
    }
    serde_yaml::to_string(&value)
        .map(|content| (content, true))
        .map_err(|error| format!("生成基础分流配置失败：{error}"))
}

fn write_profile(app: &AppHandle, file_name: &str, content: &str) -> Result<(), String> {
    let target = profile_dir(app)?.join(file_name);
    let temporary = target.with_extension("yaml.tmp");
    fs::write(&temporary, content).map_err(|error| format!("保存 Clash 配置失败：{error}"))?;
    replace_file(&temporary, &target, "Clash 配置")
}

pub fn import(
    app: &AppHandle,
    url: String,
    name: Option<String>,
    options: Option<ClashImportOptions>,
) -> Result<ClashProfile, String> {
    let _guard = write_lock().lock().map_err(|_| "Clash 订阅写入锁不可用")?;
    let url = url.trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("请输入有效的 HTTP 或 HTTPS 订阅地址".into());
    }
    let options = options.unwrap_or_default();
    let downloaded = download(url, &options)?;
    validate(&downloaded.content)?;
    let id = format!(
        "clash-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    let content = if options.basic_routing {
        apply_basic_routing(&downloaded.content)?.0
    } else {
        downloaded.content.clone()
    };
    validate_with_mihomo(app, &id, &content)?;
    let mut profiles = list(app)?;
    let file_name = format!("{id}.yaml");
    write_profile(app, &file_name, &content)?;
    let interval = options.update_interval.or(downloaded.update_interval);
    let profile = ClashProfile {
        id,
        name: name
            .filter(|value| !value.trim().is_empty())
            .or(downloaded.suggested_name)
            .or_else(|| url_file_name(url))
            .unwrap_or_else(|| format!("订阅 {}", profiles.len() + 1)),
        url: url.into(),
        source: "url".into(),
        description: options.description,
        user_agent: options.user_agent,
        timeout_seconds: options.timeout_seconds.clamp(5, 300),
        proxy_mode: options.proxy_mode,
        accept_invalid_certs: options.accept_invalid_certs,
        allow_auto_update: options.allow_auto_update,
        basic_routing: options.basic_routing,
        update_interval: interval,
        next_update_at: interval.map(|minutes| now() + minutes * 60),
        upload: downloaded.upload,
        download: downloaded.download,
        total: downloaded.total,
        expire: downloaded.expire,
        home_url: downloaded.home_url,
        file_name,
        updated_at: Some(now()),
        active: profiles.is_empty(),
        last_error: None,
    };
    profiles.push(profile.clone());
    save_index(app, &profiles)?;
    Ok(profile)
}

pub fn import_content(
    app: &AppHandle,
    name: String,
    content: String,
) -> Result<ClashProfile, String> {
    import_local(app, name, String::new(), content, None)
}

pub fn import_local(
    app: &AppHandle,
    name: String,
    description: String,
    content: String,
    update_interval: Option<u64>,
) -> Result<ClashProfile, String> {
    let _guard = write_lock().lock().map_err(|_| "Clash 订阅写入锁不可用")?;
    let name = name.trim();
    if name.is_empty() {
        return Err("请输入配置名称".into());
    }
    validate(&content)?;
    let mut profiles = list(app)?;
    let id = format!(
        "clash-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    validate_with_mihomo(app, &id, &content)?;
    let file_name = format!("{id}.yaml");
    write_profile(app, &file_name, &content)?;
    let profile = ClashProfile {
        id,
        name: name.into(),
        url: "local://yaml".into(),
        source: "local".into(),
        description,
        user_agent: String::new(),
        timeout_seconds: default_timeout(),
        proxy_mode: "direct".into(),
        accept_invalid_certs: false,
        allow_auto_update: false,
        basic_routing: false,
        update_interval,
        next_update_at: None,
        upload: 0,
        download: 0,
        total: 0,
        expire: 0,
        home_url: String::new(),
        file_name,
        updated_at: Some(now()),
        active: profiles.is_empty(),
        last_error: None,
    };
    profiles.push(profile.clone());
    save_index(app, &profiles)?;
    Ok(profile)
}

pub fn import_file(app: &AppHandle, path: String) -> Result<ClashProfile, String> {
    let path = PathBuf::from(path);
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if extension != "yaml" && extension != "yml" {
        return Err("只能导入 .yaml 或 .yml 文件".into());
    }
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("本地配置")
        .to_owned();
    let content =
        fs::read_to_string(&path).map_err(|error| format!("读取本地 Clash 配置失败：{error}"))?;
    import_local(app, name, String::new(), content, None)
}

pub fn read_source(app: &AppHandle, profile_id: &str) -> Result<String, String> {
    let profile = get(app, profile_id)?;
    fs::read_to_string(profile_dir(app)?.join(profile.file_name))
        .map_err(|error| format!("读取 Clash 原始配置失败：{error}"))
}

pub fn save_source(
    app: &AppHandle,
    profile_id: &str,
    content: String,
) -> Result<ClashProfile, String> {
    let _guard = write_lock().lock().map_err(|_| "Clash 订阅写入锁不可用")?;
    let mut profiles = list(app)?;
    let index = profiles
        .iter()
        .position(|profile| profile.id == profile_id)
        .ok_or("Clash 订阅不存在")?;
    validate_with_mihomo(app, profile_id, &content)?;
    write_profile(app, &profiles[index].file_name, &content)?;
    profiles[index].updated_at = Some(now());
    profiles[index].last_error = None;
    let profile = profiles[index].clone();
    save_index(app, &profiles)?;
    Ok(profile)
}

pub fn read_runtime(app: &AppHandle, profile_id: &str) -> Result<String, String> {
    let path = prepare_runtime(app, profile_id)?;
    fs::read_to_string(path).map_err(|error| format!("读取 Clash 运行配置失败：{error}"))
}

pub fn update(app: &AppHandle, profile_id: &str) -> Result<ClashProfile, String> {
    let _guard = write_lock().lock().map_err(|_| "Clash 订阅写入锁不可用")?;
    let mut profiles = list(app)?;
    let index = profiles
        .iter()
        .position(|profile| profile.id == profile_id)
        .ok_or("Clash 订阅不存在")?;
    if profiles[index].source == "local" || !profiles[index].url.starts_with("http") {
        return Err("本地 YAML 配置没有远程更新地址，请使用配置编辑器修改".into());
    }
    let options = ClashImportOptions {
        description: profiles[index].description.clone(),
        user_agent: profiles[index].user_agent.clone(),
        timeout_seconds: profiles[index].timeout_seconds,
        proxy_mode: profiles[index].proxy_mode.clone(),
        accept_invalid_certs: profiles[index].accept_invalid_certs,
        allow_auto_update: profiles[index].allow_auto_update,
        update_interval: profiles[index].update_interval,
        fallback_to_clash: true,
        basic_routing: profiles[index].basic_routing,
    };
    let downloaded = match download(&profiles[index].url, &options) {
        Ok(content) => content,
        Err(error) => {
            profiles[index].last_error = Some(error.clone());
            profiles[index].next_update_at = profiles[index]
                .update_interval
                .map(|minutes| now() + minutes.max(5) * 60);
            let _ = save_index(app, &profiles);
            return Err(error);
        }
    };
    let content = if profiles[index].basic_routing {
        apply_basic_routing(&downloaded.content)?.0
    } else {
        downloaded.content.clone()
    };
    validate(&content)?;
    validate_with_mihomo(app, profile_id, &content)?;
    write_profile(app, &profiles[index].file_name, &content)?;
    profiles[index].updated_at = Some(now());
    profiles[index].update_interval = profiles[index]
        .update_interval
        .or(downloaded.update_interval);
    profiles[index].next_update_at = profiles[index]
        .update_interval
        .map(|minutes| now() + minutes * 60);
    profiles[index].upload = downloaded.upload;
    profiles[index].download = downloaded.download;
    profiles[index].total = downloaded.total;
    profiles[index].expire = downloaded.expire;
    profiles[index].home_url = downloaded.home_url;
    profiles[index].last_error = None;
    let result = profiles[index].clone();
    save_index(app, &profiles)?;
    Ok(result)
}

pub fn activate(app: &AppHandle, profile_id: &str) -> Result<ClashProfile, String> {
    let _guard = write_lock().lock().map_err(|_| "Clash 订阅写入锁不可用")?;
    let mut profiles = list(app)?;
    if !profiles.iter().any(|profile| profile.id == profile_id) {
        return Err("Clash 订阅不存在".into());
    }
    for profile in &mut profiles {
        profile.active = profile.id == profile_id;
    }
    let result = profiles
        .iter()
        .find(|profile| profile.active)
        .cloned()
        .ok_or("Clash 订阅不存在")?;
    save_index(app, &profiles)?;
    Ok(result)
}

pub fn delete(app: &AppHandle, profile_id: &str) -> Result<(), String> {
    let _guard = write_lock().lock().map_err(|_| "Clash 订阅写入锁不可用")?;
    let mut profiles = list(app)?;
    let index = profiles
        .iter()
        .position(|profile| profile.id == profile_id)
        .ok_or("Clash 订阅不存在")?;
    let removed = profiles.remove(index);
    if removed.active && !profiles.is_empty() {
        profiles[0].active = true;
    }
    save_index(app, &profiles)?;
    let path = profile_dir(app)?.join(removed.file_name);
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("订阅已删除，但清理 Clash 配置文件失败：{error}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        apply_basic_routing, render_runtime, response_file_name, subscription_value, url_file_name,
        validate,
    };

    #[test]
    fn runtime_config_uses_bundled_geodata() {
        let rendered = render_runtime(
            "mixed-port: 1234\ngeodata-mode: false\nproxies:\n  - name: test\n    type: http\n    server: 127.0.0.1\n    port: 8080",
            false,
        )
        .expect("render Clash runtime config");
        let value: serde_yaml::Value =
            serde_yaml::from_str(&rendered).expect("parse rendered YAML");
        assert_eq!(value["mixed-port"].as_i64(), Some(7890));
        assert_eq!(value["geodata-mode"].as_bool(), Some(true));
        assert_eq!(value["geodata-loader"].as_str(), Some("memconservative"));
    }

    #[test]
    fn accepts_inline_and_provider_profiles() {
        assert!(validate(
            "proxies:\n  - name: test\n    type: http\n    server: 127.0.0.1\n    port: 8080"
        )
        .is_ok());
        assert!(validate(
            "proxy-providers:\n  remote:\n    type: http\n    url: https://example.com/sub"
        )
        .is_ok());
    }

    #[test]
    fn basic_routing_adds_group_and_match_rule() {
        let (content, changed) = apply_basic_routing(
            "proxies:\n  - name: test\n    type: http\n    server: 127.0.0.1\n    port: 8080",
        )
        .expect("generate basic routing");
        let value: serde_yaml::Value = serde_yaml::from_str(&content).expect("parse enhanced yaml");
        assert!(changed);
        assert_eq!(value["proxy-groups"][0]["name"].as_str(), Some("节点选择"));
        assert_eq!(value["rules"][0].as_str(), Some("MATCH,节点选择"));
    }

    #[test]
    fn basic_routing_preserves_complete_config() {
        let original = "proxies: []\nproxy-groups:\n  - name: Existing\n    type: select\n    proxies: [DIRECT]\nrules:\n  - MATCH,Existing\n";
        let (content, changed) = apply_basic_routing(original).expect("inspect complete routing");
        assert!(!changed);
        assert_eq!(content, original);
    }

    #[test]
    fn rejects_unusable_yaml() {
        assert!(validate("rules:\n  - MATCH,DIRECT").is_err());
        assert!(validate("not: [valid").is_err());
    }

    #[test]
    fn parses_subscription_headers() {
        let value = "upload=1024; download=2048; total=4096; expire=1893456000";
        assert_eq!(subscription_value(value, "download"), 2048);
        assert_eq!(subscription_value(value, "expire"), 1_893_456_000);
        assert_eq!(
            response_file_name("attachment; filename*=UTF-8''%E6%B5%8B%E8%AF%95.yaml"),
            Some("测试.yaml".into())
        );
        assert_eq!(
            url_file_name("https://example.com/files/profile.yaml?token=secret"),
            Some("profile.yaml".into())
        );
    }
}
