mod clash_controller;
mod clash_profiles;
mod clash_realtime;
mod community_nodes;
mod core_runtime;
mod core_update;
mod cores;
mod geo_rules;
mod paths;
mod process_utils;
mod services;
mod system_proxy;
mod traffic_bridge;
mod v2ray;

use services::{AppConnectionState, ConnectionStore, PublicRoute};
use tauri::{
    menu::{CheckMenuItem, MenuBuilder, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri::{Listener, Manager, State};

struct TrayMenuHandles {
    status: MenuItem<tauri::Wry>,
    connect: MenuItem<tauri::Wry>,
    best_route: MenuItem<tauri::Wry>,
    rule: CheckMenuItem<tauri::Wry>,
    global: CheckMenuItem<tauri::Wry>,
    tun: CheckMenuItem<tauri::Wry>,
}

#[derive(Default)]
struct TrayMenuState(std::sync::Mutex<Option<TrayMenuHandles>>);

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn report_tray_error(app: &tauri::AppHandle, error: String) {
    let store = app.state::<ConnectionStore>();
    if let Ok(mut state) = store.state.lock() {
        state.error = Some(error);
    }
    services::emit_snapshot(app, &store);
    show_main_window(app);
}

fn run_tray_action<F>(app: &tauri::AppHandle, action: F)
where
    F: FnOnce(tauri::AppHandle) -> Result<(), String> + Send + 'static,
{
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(error) = action(app.clone()) {
            report_tray_error(&app, error);
        }
    });
}

fn update_tray_visual(app: &tauri::AppHandle, state: &AppConnectionState) {
    let Some(tray) = app.tray_by_id("kingo-tray") else {
        return;
    };
    let bytes: &'static [u8] = if state.connected {
        include_bytes!("../icons/tray-connecting.png")
    } else {
        include_bytes!("../icons/tray.png")
    };
    if let Ok(icon) = tauri::image::Image::from_bytes(bytes) {
        let _ = tray.set_icon(Some(icon));
    }
    let routing = services::get_auto_routing_settings(app);
    let route_mode = if routing.mode == "global" {
        "全局模式"
    } else {
        "规则模式"
    };
    let network_mode = if state.tun_enabled {
        "TUN"
    } else {
        "系统代理"
    };
    let tooltip = if state.connected {
        match state.display_name.as_deref() {
            Some(name) => format!("KiNGO · 已连接 · {name} · {route_mode}/{network_mode}"),
            None => format!("KiNGO · 已连接 · {route_mode}/{network_mode}"),
        }
    } else if state.connecting || state.stage != "idle" {
        let action = match state.stage.as_str() {
            "switching" => "正在切换线路",
            "failover" => "正在故障切换",
            "disconnecting" => "正在断开",
            _ => "正在连接",
        };
        format!("KiNGO · {action}")
    } else {
        "KiNGO · 未连接".into()
    };
    let _ = tray.set_tooltip(Some(tooltip));

    let status_text = if state.connected {
        state
            .display_name
            .as_deref()
            .map(|name| format!("● 已连接 · {name}"))
            .unwrap_or_else(|| "● 已连接".into())
    } else if state.connecting || state.stage != "idle" {
        "◐ 正在处理连接".into()
    } else {
        "○ 未连接".into()
    };
    let action_text = if state.connected {
        "断开连接"
    } else if state.connecting || state.stage != "idle" {
        "取消连接"
    } else {
        "连接"
    };
    let best_route_text = if state.connected {
        "重新选择最佳线路"
    } else {
        "自动选择最佳线路"
    };
    if let Ok(handles) = app.state::<TrayMenuState>().0.lock() {
        if let Some(handles) = handles.as_ref() {
            let actions_enabled = !state.connecting && state.stage == "idle";
            let _ = handles.status.set_text(status_text);
            let _ = handles.connect.set_text(action_text);
            let _ = handles.connect.set_enabled(state.stage != "disconnecting");
            let _ = handles.best_route.set_text(best_route_text);
            let _ = handles.best_route.set_enabled(actions_enabled);
            let _ = handles.rule.set_enabled(actions_enabled);
            let _ = handles.rule.set_checked(routing.mode != "global");
            let _ = handles.global.set_enabled(actions_enabled);
            let _ = handles.global.set_checked(routing.mode == "global");
            let _ = handles.tun.set_enabled(actions_enabled);
            let _ = handles.tun.set_checked(state.tun_enabled);
        }
    }
}

#[tauri::command]
fn get_app_state(app: tauri::AppHandle, store: State<'_, ConnectionStore>) -> AppConnectionState {
    services::load_route_metrics(&app, &store);
    services::snapshot(&store)
}

#[tauri::command]
fn get_community_scan_state(
    app: tauri::AppHandle,
    store: State<'_, community_nodes::scanner::CommunityNodeStore>,
) -> community_nodes::models::CommunityScanState {
    community_nodes::scanner::restored_state(&app, &store)
}

#[tauri::command]
fn start_community_scan(
    app: tauri::AppHandle,
    store: State<'_, community_nodes::scanner::CommunityNodeStore>,
    subs_check: State<'_, community_nodes::subs_check::SubsCheckRuntime>,
    connection_store: State<'_, ConnectionStore>,
) -> Result<community_nodes::models::CommunityScanState, String> {
    let connection = services::snapshot(&connection_store);
    if connection.connecting {
        return Err("正在建立或切换连接，请完成后再获取节点".into());
    }
    if connection.connected && connection.source_type.as_deref() == Some("community") {
        return Err("当前正在使用获取节点列表中的节点，请先断开连接再重新检测".into());
    }
    community_nodes::subs_check::start(app, &subs_check, &store)
}

#[tauri::command]
fn stop_community_scan(
    app: tauri::AppHandle,
    store: State<'_, community_nodes::scanner::CommunityNodeStore>,
    subs_check: State<'_, community_nodes::subs_check::SubsCheckRuntime>,
) -> Result<community_nodes::models::CommunityScanState, String> {
    community_nodes::subs_check::stop(&app, &subs_check, &store)
}

#[tauri::command]
fn list_community_nodes(
    app: tauri::AppHandle,
    store: State<'_, community_nodes::scanner::CommunityNodeStore>,
) -> Vec<community_nodes::models::CommunityNodeCandidate> {
    community_nodes::scanner::nodes(&app, &store)
}

#[tauri::command]
fn clear_community_nodes(
    app: tauri::AppHandle,
    store: State<'_, community_nodes::scanner::CommunityNodeStore>,
    connection_store: State<'_, ConnectionStore>,
) -> Result<(), String> {
    let connection = services::snapshot(&connection_store);
    if connection.connecting {
        return Err("正在建立或切换连接，请完成后再清空节点结果".into());
    }
    if connection.connected && connection.source_type.as_deref() == Some("community") {
        return Err("当前正在使用列表中的节点，请先断开连接再清空结果".into());
    }
    community_nodes::scanner::clear(&app, &store)
}

#[tauri::command]
fn get_community_settings(app: tauri::AppHandle) -> community_nodes::models::CommunitySettings {
    community_nodes::store::load_settings(&app)
}

#[tauri::command]
fn save_community_settings(
    app: tauri::AppHandle,
    settings: community_nodes::models::CommunitySettings,
    store: State<'_, community_nodes::scanner::CommunityNodeStore>,
) -> Result<community_nodes::models::CommunitySettings, String> {
    if matches!(
        community_nodes::scanner::state(&store).state.as_str(),
        "running" | "paused" | "stopping"
    ) || community_nodes::scanner::has_active_retests(&store)
    {
        return Err("节点检测或复测期间不能修改检测设置".into());
    }
    community_nodes::store::save_settings(&app, settings)
}

#[tauri::command]
fn retest_community_node(
    app: tauri::AppHandle,
    node_id: String,
    store: State<'_, community_nodes::scanner::CommunityNodeStore>,
) -> Result<(), String> {
    community_nodes::scanner::retest(app, &store, node_id)
}

#[tauri::command]
fn retest_all_community_nodes(
    app: tauri::AppHandle,
    store: State<'_, community_nodes::scanner::CommunityNodeStore>,
) -> Result<usize, String> {
    community_nodes::scanner::retest_all(app, &store)
}

#[tauri::command]
fn connect_community_node(
    app: tauri::AppHandle,
    node_id: String,
    community_store: State<'_, community_nodes::scanner::CommunityNodeStore>,
    connection_store: State<'_, ConnectionStore>,
    runtime: State<'_, core_runtime::CoreRuntime>,
) -> Result<(), String> {
    let _operation = community_store
        .operations
        .lock()
        .map_err(|_| "公共节点操作状态不可用")?;
    let scan = community_nodes::scanner::state(&community_store);
    if matches!(scan.state.as_str(), "running" | "paused" | "stopping") {
        return Err("公共节点批量检测期间不能连接节点，请先停止或等待检测完成".into());
    }
    if community_nodes::scanner::has_active_retests(&community_store) {
        return Err("公共节点复测期间不能连接节点，请等待复测完成".into());
    }
    let node = community_nodes::scanner::nodes(&app, &community_store)
        .into_iter()
        .find(|node| node.id == node_id)
        .ok_or_else(|| "公共节点不存在，可能已被清理".to_string())?;
    services::start_community_connection(app, &connection_store, &runtime, node)
}

#[tauri::command]
fn enable_uwp_loopback() -> Result<String, String> {
    system_proxy::enable_uwp_loopback()
}

#[tauri::command]
fn list_public_routes(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
) -> Vec<PublicRoute> {
    services::public_routes_snapshot(&app, &store)
}

#[tauri::command]
fn test_public_routes(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
    runtime: State<'_, core_runtime::CoreRuntime>,
) -> Result<(), String> {
    services::test_public_routes(app, &store, &runtime)
}

#[tauri::command]
fn test_public_route(
    app: tauri::AppHandle,
    route_id: String,
    store: State<'_, ConnectionStore>,
    runtime: State<'_, core_runtime::CoreRuntime>,
) -> Result<(), String> {
    services::test_public_route(app, &store, &runtime, route_id)
}

#[tauri::command]
fn update_public_routes(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
) -> Result<(), String> {
    services::update_public_routes(app, &store)
}

#[tauri::command]
fn cancel_public_route_update(store: State<'_, ConnectionStore>) {
    services::cancel_public_route_update(&store);
}

#[tauri::command]
fn get_public_route_update_status(
    store: State<'_, ConnectionStore>,
) -> Option<services::RouteUpdateProgress> {
    services::route_update_status(&store)
}

#[tauri::command]
fn select_public_route(
    route_id: Option<String>,
    store: State<'_, ConnectionStore>,
) -> Result<(), String> {
    if route_id.as_ref().is_some_and(|id| {
        !services::default_public_routes()
            .iter()
            .any(|route| route.id == *id)
    }) {
        return Err("public route not found".into());
    }
    *store
        .selected_route
        .lock()
        .map_err(|_| "route selection unavailable")? = route_id;
    Ok(())
}

#[tauri::command]
fn start_public_connection(
    app: tauri::AppHandle,
    route_id: Option<String>,
    store: State<'_, ConnectionStore>,
    runtime: State<'_, core_runtime::CoreRuntime>,
) -> Result<(), String> {
    services::start_public_connection(app, &store, &runtime, route_id)
}

#[tauri::command]
fn get_auto_routing_settings(app: tauri::AppHandle) -> services::AutoRoutingSettings {
    services::get_auto_routing_settings(&app)
}

#[tauri::command]
fn set_auto_routing_settings(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
    runtime: State<'_, core_runtime::CoreRuntime>,
    settings: services::AutoRoutingSettings,
) -> Result<services::AutoRoutingApplyResult, String> {
    services::set_auto_routing_settings(&app, &store, &runtime, settings)
}

#[tauri::command]
fn cancel_connection(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
    runtime: State<'_, core_runtime::CoreRuntime>,
) -> Result<(), String> {
    services::cancel_connection(&app, &store, &runtime)
}

#[tauri::command]
fn disconnect(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
    runtime: State<'_, core_runtime::CoreRuntime>,
) -> Result<(), String> {
    services::cancel_connection(&app, &store, &runtime)
}

#[tauri::command]
fn refresh_exit_info(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
) -> Result<AppConnectionState, String> {
    services::refresh_exit_info(&app, &store)
}

#[tauri::command]
fn get_traffic(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
) -> Result<services::TrafficState, String> {
    services::get_traffic(&app, &store)
}

#[tauri::command]
fn set_auto_failover(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
    enabled: bool,
) -> Result<(), String> {
    services::set_auto_failover(&app, &store, enabled)
}

#[tauri::command]
fn get_speed_test_settings() -> services::SpeedTestSettings {
    services::get_speed_test_settings()
}

#[tauri::command]
fn set_speed_test_settings(
    app: tauri::AppHandle,
    settings: services::SpeedTestSettings,
) -> Result<services::SpeedTestSettings, String> {
    services::set_speed_test_settings(&app, settings)
}

#[tauri::command]
fn test_speed_test_url(
    url: String,
    timeout_seconds: u64,
) -> Result<services::SpeedTestUrlResult, String> {
    services::test_speed_test_url(url, timeout_seconds)
}

#[tauri::command]
fn list_core_profiles() -> Vec<cores::CoreProfile> {
    cores::profiles()
}

#[tauri::command]
fn list_core_status(app: tauri::AppHandle) -> Result<Vec<cores::CoreStatus>, String> {
    cores::statuses(&app)
}

#[tauri::command]
fn check_core_updates(app: tauri::AppHandle) -> Result<Vec<core_update::CoreVersionInfo>, String> {
    core_update::check_all(&app)
}

#[tauri::command]
fn check_app_update() -> Result<core_update::AppUpdateInfo, String> {
    core_update::check_app_update()
}

#[tauri::command]
fn prepare_app_update(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
    runtime: State<'_, core_runtime::CoreRuntime>,
) -> Result<(), String> {
    services::cancel_connection(&app, &store, &runtime)?;
    core_runtime::stop_all(&runtime)?;
    system_proxy::disable(&store.proxy)?;
    if system_proxy::has_pending_restore(&store.proxy) {
        return Err("更新前未能完全恢复 Windows 系统代理，请重试".into());
    }
    Ok(())
}

#[tauri::command]
fn update_core(
    app: tauri::AppHandle,
    core_id: String,
    store: State<'_, ConnectionStore>,
    runtime: State<'_, core_runtime::CoreRuntime>,
    subs_check: State<'_, community_nodes::subs_check::SubsCheckRuntime>,
) -> Result<core_update::CoreUpdateResult, String> {
    if core_id == "subs-check" && community_nodes::subs_check::is_running(&subs_check) {
        return Err("请先停止公共节点检测，再更新 SubsCheck".into());
    }
    let state = services::snapshot(&store);
    if state.connecting {
        return Err("正在连接或切换线路，请完成后再更新核心".into());
    }
    let active_core_id = store
        .active_route
        .lock()
        .ok()
        .and_then(|route| route.as_ref().map(|route| route.core_id.clone()));
    let reconnect_after_update = state.connected
        && state.mode == "auto"
        && active_core_id.as_deref() == Some(core_id.as_str());
    let selected_route = store
        .selected_route
        .lock()
        .ok()
        .and_then(|route| route.clone());
    let mut connection_stopped = false;
    let update_result = core_update::update_with_before_install(&app, &core_id, || {
        if core_id == "subs-check" {
            return if community_nodes::subs_check::is_running(&subs_check) {
                Err("公共节点检测已开始，本次 SubsCheck 更新已取消".into())
            } else {
                Ok(())
            };
        } else if reconnect_after_update {
            services::cancel_connection(&app, &store, &runtime)?;
            connection_stopped = true;
        } else {
            core_runtime::stop(&runtime, &core_id)?;
        }
        Ok(())
    });

    if connection_stopped {
        if let Err(reconnect_error) =
            services::start_public_connection(app.clone(), &store, &runtime, selected_route)
        {
            return Err(match update_result {
                Ok(_) => format!("核心已更新，但恢复代理连接失败：{reconnect_error}"),
                Err(update_error) => {
                    format!("{update_error}；恢复代理连接失败：{reconnect_error}")
                }
            });
        }
    }

    update_result.map(|mut result| {
        result.connection_restarted = connection_stopped;
        result
    })
}

#[tauri::command]
fn restore_bundled_core(
    app: tauri::AppHandle,
    core_id: String,
    subs_check: State<'_, community_nodes::subs_check::SubsCheckRuntime>,
) -> Result<(), String> {
    if core_id == "subs-check" && community_nodes::subs_check::is_running(&subs_check) {
        return Err("请先停止公共节点检测，再恢复 SubsCheck 内置版本".into());
    }
    let runtime = app.state::<core_runtime::CoreRuntime>();
    if core_id != "subs-check" {
        core_runtime::stop_all(&runtime)?;
    }
    core_update::restore_bundled(&app, &core_id)
}

#[tauri::command]
fn get_clash_core(app: tauri::AppHandle) -> Result<String, String> {
    clash_controller::active_core(&app)
}

#[tauri::command]
fn set_clash_core(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
    runtime: State<'_, core_runtime::CoreRuntime>,
    core_id: String,
) -> Result<AppConnectionState, String> {
    let state = services::snapshot(&store);
    let active_profile = if state.mode == "clash" && (state.connected || state.connecting) {
        clash_profiles::list(&app)?
            .into_iter()
            .find(|profile| profile.active)
            .map(|profile| profile.id)
    } else {
        None
    };
    if state.mode == "clash" && (state.connected || state.connecting) {
        services::cancel_connection(&app, &store, &runtime)?;
    }
    clash_controller::set_active_core(&app, &core_id)?;
    if let Some(profile_id) = active_profile {
        services::start_clash_connection(app.clone(), &store, &runtime, &profile_id)?;
    }
    Ok(services::snapshot(&store))
}

#[tauri::command]
fn check_clash_core_updates(
    app: tauri::AppHandle,
) -> Result<Vec<core_update::CoreVersionInfo>, String> {
    Ok(core_update::check_all(&app)?
        .into_iter()
        .filter(|core| matches!(core.core_id.as_str(), "mihomo" | "mihomo-alpha"))
        .collect())
}

#[tauri::command]
fn update_clash_core(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
    runtime: State<'_, core_runtime::CoreRuntime>,
) -> Result<core_update::CoreUpdateResult, String> {
    let core_id = clash_controller::active_core(&app)?;
    let state = services::snapshot(&store);
    if state.mode == "clash" && (state.connected || state.connecting) {
        services::cancel_connection(&app, &store, &runtime)?;
    } else {
        let _ = core_runtime::stop(&runtime, &core_id);
    }
    core_update::update(&app, &core_id)
}

#[tauri::command]
fn restart_clash_core(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
    runtime: State<'_, core_runtime::CoreRuntime>,
) -> Result<AppConnectionState, String> {
    let active_profile = clash_profiles::list(&app)?
        .into_iter()
        .find(|profile| profile.active)
        .map(|profile| profile.id)
        .ok_or("没有可重启的 Clash 配置")?;
    services::cancel_connection(&app, &store, &runtime)?;
    services::start_clash_connection(app.clone(), &store, &runtime, &active_profile)?;
    Ok(services::snapshot(&store))
}

#[tauri::command]
fn open_clash_core_dir(app: tauri::AppHandle) -> Result<(), String> {
    let core_id = clash_controller::active_core(&app)?;
    let dir = std::path::PathBuf::from(paths::ensure(&app)?.cores_dir).join(core_id);
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    process_utils::hidden_command("explorer")
        .arg(dir)
        .spawn()
        .map_err(|error| format!("打开内核目录失败：{error}"))?;
    Ok(())
}

#[tauri::command]
fn get_runtime_paths(app: tauri::AppHandle) -> Result<paths::RuntimePaths, String> {
    paths::ensure(&app)
}

#[tauri::command]
fn start_core(
    app: tauri::AppHandle,
    runtime: State<'_, core_runtime::CoreRuntime>,
    core_id: String,
    config_path: String,
) -> Result<core_runtime::CoreProcessStatus, String> {
    core_runtime::start(&app, &runtime, core_id, config_path)
}

#[tauri::command]
fn stop_core(runtime: State<'_, core_runtime::CoreRuntime>, core_id: String) -> Result<(), String> {
    core_runtime::stop(&runtime, &core_id)
}

#[tauri::command]
fn list_running_cores(
    runtime: State<'_, core_runtime::CoreRuntime>,
) -> Result<Vec<core_runtime::CoreProcessStatus>, String> {
    core_runtime::statuses(&runtime)
}

#[tauri::command]
fn list_clash_profiles(app: tauri::AppHandle) -> Result<Vec<clash_profiles::ClashProfile>, String> {
    clash_profiles::list(&app)
}

#[tauri::command]
fn import_clash_profile(
    app: tauri::AppHandle,
    url: String,
    name: Option<String>,
    options: Option<clash_profiles::ClashImportOptions>,
) -> Result<clash_profiles::ClashProfile, String> {
    clash_profiles::import(&app, url, name, options)
}

#[tauri::command]
fn import_clash_profile_content(
    app: tauri::AppHandle,
    name: String,
    content: String,
) -> Result<clash_profiles::ClashProfile, String> {
    clash_profiles::import_content(&app, name, content)
}

#[tauri::command]
fn import_clash_profile_local(
    app: tauri::AppHandle,
    name: String,
    description: String,
    content: String,
    update_interval: Option<u64>,
) -> Result<clash_profiles::ClashProfile, String> {
    clash_profiles::import_local(&app, name, description, content, update_interval)
}

#[tauri::command]
fn import_clash_profile_file(
    app: tauri::AppHandle,
    path: String,
) -> Result<clash_profiles::ClashProfile, String> {
    clash_profiles::import_file(&app, path)
}

#[tauri::command]
fn get_clash_profile_source(app: tauri::AppHandle, profile_id: String) -> Result<String, String> {
    clash_profiles::read_source(&app, &profile_id)
}

#[tauri::command]
fn save_clash_profile_source(
    app: tauri::AppHandle,
    profile_id: String,
    content: String,
) -> Result<clash_profiles::ClashProfile, String> {
    clash_profiles::save_source(&app, &profile_id, content)
}

#[tauri::command]
fn get_clash_runtime_config(app: tauri::AppHandle, profile_id: String) -> Result<String, String> {
    clash_profiles::read_runtime(&app, &profile_id)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ClashBatchFailure {
    profile_id: String,
    error: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ClashBatchResult {
    succeeded: Vec<String>,
    failed: Vec<ClashBatchFailure>,
}

#[tauri::command]
fn update_clash_profiles(app: tauri::AppHandle, profile_ids: Vec<String>) -> ClashBatchResult {
    let mut result = ClashBatchResult {
        succeeded: Vec::new(),
        failed: Vec::new(),
    };
    for profile_id in profile_ids {
        match clash_profiles::update(&app, &profile_id) {
            Ok(_) => result.succeeded.push(profile_id),
            Err(error) => result.failed.push(ClashBatchFailure { profile_id, error }),
        }
    }
    result
}

#[tauri::command]
fn update_clash_profile(
    app: tauri::AppHandle,
    profile_id: String,
) -> Result<clash_profiles::ClashProfile, String> {
    clash_profiles::update(&app, &profile_id)
}

#[tauri::command]
fn activate_clash_profile(
    app: tauri::AppHandle,
    profile_id: String,
) -> Result<clash_profiles::ClashProfile, String> {
    clash_profiles::activate(&app, &profile_id)
}

#[tauri::command]
fn start_clash_profile(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
    runtime: State<'_, core_runtime::CoreRuntime>,
    profile_id: String,
) -> Result<(), String> {
    services::start_clash_connection(app, &store, &runtime, &profile_id)
}

#[tauri::command]
fn delete_clash_profile(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
    runtime: State<'_, core_runtime::CoreRuntime>,
    profile_id: String,
) -> Result<(), String> {
    let profile = clash_profiles::get(&app, &profile_id)?;
    let state = services::snapshot(&store);
    if profile.active && state.mode == "clash" && (state.connected || state.connecting) {
        let replacement = clash_profiles::list(&app)?
            .into_iter()
            .find(|candidate| candidate.id != profile_id);
        if let Some(replacement) = replacement {
            if state.connecting {
                services::cancel_connection(&app, &store, &runtime)?;
            }
            services::start_clash_connection(app.clone(), &store, &runtime, &replacement.id)
                .map_err(|error| format!("切换到下一份配置失败，未删除当前配置：{error}"))?;
        } else {
            services::cancel_connection(&app, &store, &runtime)?;
        }
    }
    if let Err(error) = clash_profiles::delete(&app, &profile_id) {
        if profile.active && clash_profiles::get(&app, &profile_id).is_ok() {
            let _ = services::start_clash_connection(app.clone(), &store, &runtime, &profile_id);
        }
        return Err(error);
    }
    let _ = clash_controller::remove_saved_selections(&app, &profile_id);
    Ok(())
}

#[tauri::command]
fn delete_clash_profiles(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
    runtime: State<'_, core_runtime::CoreRuntime>,
    profile_ids: Vec<String>,
) -> ClashBatchResult {
    let state = services::snapshot(&store);
    let mut result = ClashBatchResult {
        succeeded: Vec::new(),
        failed: Vec::new(),
    };
    let active_selected = clash_profiles::list(&app).ok().and_then(|profiles| {
        profiles
            .into_iter()
            .find(|profile| profile.active && profile_ids.contains(&profile.id))
    });
    if active_selected.is_some() && state.mode == "clash" && (state.connected || state.connecting) {
        let replacement = clash_profiles::list(&app).ok().and_then(|profiles| {
            profiles
                .into_iter()
                .find(|profile| !profile_ids.contains(&profile.id))
        });
        let switched = if let Some(replacement) = replacement {
            if state.connecting {
                let _ = services::cancel_connection(&app, &store, &runtime);
            }
            services::start_clash_connection(app.clone(), &store, &runtime, &replacement.id)
                .map_err(|error| format!("切换到未删除配置失败：{error}"))
        } else {
            services::cancel_connection(&app, &store, &runtime)
        };
        if let Err(error) = switched {
            for profile_id in profile_ids {
                result.failed.push(ClashBatchFailure {
                    profile_id,
                    error: error.clone(),
                });
            }
            return result;
        }
    }
    for profile_id in profile_ids {
        let operation = (|| {
            clash_profiles::get(&app, &profile_id)?;
            clash_profiles::delete(&app, &profile_id)?;
            let _ = clash_controller::remove_saved_selections(&app, &profile_id);
            Ok::<(), String>(())
        })();
        match operation {
            Ok(()) => result.succeeded.push(profile_id),
            Err(error) => result.failed.push(ClashBatchFailure { profile_id, error }),
        }
    }
    result
}

#[tauri::command]
fn list_v2ray_nodes(
    app: tauri::AppHandle,
    subscription_id: Option<String>,
) -> Result<Vec<v2ray::V2rayNode>, String> {
    v2ray::list_nodes(&app, subscription_id)
}

#[tauri::command]
fn import_v2ray_nodes(app: tauri::AppHandle, text: String) -> Result<v2ray::ImportResult, String> {
    v2ray::import_nodes(&app, text)
}

#[tauri::command]
fn import_v2ray_qr_image(
    app: tauri::AppHandle,
    bytes: Vec<u8>,
) -> Result<v2ray::ImportResult, String> {
    v2ray::decode_qr_image(&app, bytes)
}

#[tauri::command]
fn scan_v2ray_qr_screen(app: tauri::AppHandle) -> Result<v2ray::ImportResult, String> {
    let window = app.get_webview_window("main");
    if let Some(window) = &window {
        let _ = window.hide();
    }
    std::thread::sleep(std::time::Duration::from_millis(250));
    let result = v2ray::scan_qr_screens(&app);
    if let Some(window) = window {
        let _ = window.show();
        let _ = window.set_focus();
    }
    result
}

#[tauri::command]
fn create_v2ray_node(
    app: tauri::AppHandle,
    input: v2ray::NodeUpdateInput,
) -> Result<v2ray::V2rayNode, String> {
    v2ray::create_node(&app, input)
}

#[tauri::command]
fn delete_v2ray_nodes(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
    runtime: State<'_, core_runtime::CoreRuntime>,
    node_ids: Vec<String>,
) -> Result<usize, String> {
    let state = services::snapshot(&store);
    if state.mode == "v2ray" && state.connecting {
        return Err("V2ray 服务正在切换节点，请稍后再删除".into());
    }
    let deleting_active = v2ray::list_nodes(&app, None)?
        .iter()
        .any(|node| node.active && node_ids.contains(&node.id));
    let deleted = v2ray::delete_nodes(&app, node_ids)?;
    if state.mode == "v2ray" && state.connected && deleting_active {
        if v2ray::list_nodes(&app, None)?
            .iter()
            .any(|node| node.active)
        {
            v2ray::start_connection(app.clone(), &store, &runtime, None)?;
        } else {
            services::cancel_connection(&app, &store, &runtime)?;
        }
    }
    Ok(deleted)
}

#[tauri::command]
fn set_active_v2ray_node(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
    runtime: State<'_, core_runtime::CoreRuntime>,
    node_id: String,
) -> Result<v2ray::V2rayNode, String> {
    let state = services::snapshot(&store);
    let target = v2ray::list_nodes(&app, None)?
        .into_iter()
        .find(|node| node.id == node_id)
        .ok_or("V2ray 节点不存在")?;
    if state.mode == "v2ray" && state.connecting {
        return Err("V2ray 服务正在切换节点，请稍后再试".into());
    }
    if state.mode == "v2ray" && state.connected && !target.active {
        v2ray::start_connection(app.clone(), &store, &runtime, Some(node_id.clone()))?;
        return v2ray::list_nodes(&app, None)?
            .into_iter()
            .find(|node| node.id == node_id)
            .ok_or_else(|| "切换后读取活动节点失败".to_string());
    }
    v2ray::set_active_node(&app, node_id)
}

#[tauri::command]
fn update_v2ray_node(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
    node_id: String,
    input: v2ray::NodeUpdateInput,
) -> Result<v2ray::V2rayNode, String> {
    let state = services::snapshot(&store);
    if state.mode == "v2ray"
        && (state.connected || state.connecting)
        && v2ray::list_nodes(&app, None)?
            .iter()
            .any(|node| node.id == node_id && node.active)
    {
        return Err("当前活动节点正在运行，请先断开连接再编辑".into());
    }
    v2ray::update_node(&app, node_id, input)
}

#[tauri::command]
fn move_v2ray_nodes(
    app: tauri::AppHandle,
    node_ids: Vec<String>,
    direction: String,
) -> Result<Vec<v2ray::V2rayNode>, String> {
    v2ray::move_nodes(&app, node_ids, direction)
}

#[tauri::command]
fn reorder_v2ray_nodes(
    app: tauri::AppHandle,
    node_ids: Vec<String>,
) -> Result<Vec<v2ray::V2rayNode>, String> {
    v2ray::reorder_nodes(&app, node_ids)
}

#[tauri::command]
fn sort_v2ray_nodes(app: tauri::AppHandle, by: String) -> Result<Vec<v2ray::V2rayNode>, String> {
    v2ray::sort_nodes(&app, by)
}

#[tauri::command]
fn duplicate_v2ray_node(
    app: tauri::AppHandle,
    node_id: String,
) -> Result<v2ray::V2rayNode, String> {
    v2ray::duplicate_node(&app, node_id)
}

#[tauri::command]
fn move_v2ray_node_group(
    app: tauri::AppHandle,
    node_id: String,
    subscription_id: Option<String>,
) -> Result<v2ray::V2rayNode, String> {
    v2ray::move_node_group(&app, node_id, subscription_id)
}

#[tauri::command]
fn remove_duplicate_v2ray_nodes(app: tauri::AppHandle) -> Result<usize, String> {
    v2ray::remove_duplicates(&app)
}

#[tauri::command]
fn share_v2ray_nodes(
    app: tauri::AppHandle,
    node_ids: Vec<String>,
) -> Result<Vec<v2ray::NodeShare>, String> {
    v2ray::share_nodes(&app, node_ids)
}

#[tauri::command]
fn export_v2ray_nodes(app: tauri::AppHandle, node_ids: Vec<String>) -> Result<String, String> {
    v2ray::export_nodes(&app, node_ids)
}

#[tauri::command]
fn qrcode_v2ray_node(app: tauri::AppHandle, node_id: String) -> Result<String, String> {
    v2ray::node_qr_svg(&app, node_id)
}

#[tauri::command]
fn get_v2ray_settings(app: tauri::AppHandle) -> v2ray::V2raySettings {
    v2ray::get_settings(&app)
}

#[tauri::command]
fn set_v2ray_settings(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
    settings: v2ray::V2raySettings,
) -> Result<v2ray::V2raySettings, String> {
    let state = services::snapshot(&store);
    if state.mode == "v2ray" && (state.connected || state.connecting) {
        return Err("请先断开 V2ray 连接，再修改运行设置".into());
    }
    v2ray::save_settings(&app, settings)
}

#[tauri::command]
fn list_v2ray_subscriptions(
    app: tauri::AppHandle,
) -> Result<Vec<v2ray::V2raySubscription>, String> {
    v2ray::list_subscriptions(&app)
}

#[tauri::command]
fn add_v2ray_subscription(
    app: tauri::AppHandle,
    name: String,
    url: String,
    user_agent: Option<String>,
) -> Result<v2ray::V2raySubscription, String> {
    v2ray::add_subscription(&app, name, url, user_agent)
}

#[tauri::command]
fn update_v2ray_subscription_settings(
    app: tauri::AppHandle,
    subscription_id: String,
    input: v2ray::SubscriptionUpdateInput,
) -> Result<v2ray::V2raySubscription, String> {
    v2ray::update_subscription_settings(&app, subscription_id, input)
}

#[tauri::command]
fn update_v2ray_subscription(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
    subscription_id: String,
) -> Result<v2ray::SubscriptionUpdateResult, String> {
    let state = services::snapshot(&store);
    if state.mode == "v2ray" && (state.connected || state.connecting) {
        return Err("请先断开 V2ray 连接再更新订阅".into());
    }
    v2ray::update_subscription(&app, subscription_id)
}

#[tauri::command]
fn update_all_v2ray_subscriptions(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
) -> Result<v2ray::SubscriptionBatchResult, String> {
    let state = services::snapshot(&store);
    if state.mode == "v2ray" && (state.connected || state.connecting) {
        return Err("请先断开 V2ray 连接再更新订阅".into());
    }
    v2ray::update_all_subscriptions(&app)
}

#[tauri::command]
fn delete_v2ray_subscription(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
    subscription_id: String,
) -> Result<(), String> {
    let state = services::snapshot(&store);
    if state.mode == "v2ray"
        && (state.connected || state.connecting)
        && v2ray::list_nodes(&app, None)?
            .iter()
            .any(|node| node.active && node.subscription_id.as_deref() == Some(&subscription_id))
    {
        return Err("当前订阅中的活动节点正在运行，请先断开连接再删除订阅".into());
    }
    v2ray::delete_subscription(&app, subscription_id)
}

#[tauri::command]
fn test_v2ray_nodes(
    app: tauri::AppHandle,
    node_ids: Vec<String>,
    mode: Option<String>,
) -> Result<v2ray::NodeTestBatchResult, String> {
    v2ray::test_nodes(&app, node_ids, mode)
}

#[tauri::command]
fn start_v2ray_tests(
    app: tauri::AppHandle,
    node_ids: Vec<String>,
    mode: Option<String>,
) -> Result<v2ray::NodeTestStartResult, String> {
    v2ray::start_tests(app, node_ids, mode)
}

#[tauri::command]
fn cancel_v2ray_tests() {
    v2ray::cancel_tests();
}

#[tauri::command]
fn start_v2ray_connection(
    app: tauri::AppHandle,
    node_id: Option<String>,
    store: State<'_, ConnectionStore>,
    runtime: State<'_, core_runtime::CoreRuntime>,
) -> Result<v2ray::V2rayRuntimeState, String> {
    v2ray::start_connection(app, &store, &runtime, node_id)
}

#[tauri::command]
fn stop_v2ray_connection(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
    runtime: State<'_, core_runtime::CoreRuntime>,
) -> Result<(), String> {
    services::cancel_connection(&app, &store, &runtime)
}

#[tauri::command]
fn get_v2ray_runtime_state(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
) -> Result<v2ray::V2rayRuntimeState, String> {
    v2ray::runtime_state(&app, &store)
}

fn ensure_clash_connected(store: &ConnectionStore) -> Result<(), String> {
    let state = services::snapshot(store);
    if state.mode == "clash"
        && state.connected
        && matches!(state.core_id.as_deref(), Some("mihomo" | "mihomo-alpha"))
    {
        Ok(())
    } else {
        Err("请先启动一个 Clash 配置".into())
    }
}

#[tauri::command]
fn list_clash_proxy_groups(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
) -> Result<Vec<clash_controller::ClashProxyGroup>, String> {
    ensure_clash_connected(&store)?;
    clash_controller::list_groups(&app)
}

#[tauri::command]
fn select_clash_proxy(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
    group: String,
    proxy: String,
) -> Result<(), String> {
    ensure_clash_connected(&store)?;
    clash_controller::select_proxy(&app, &group, &proxy)
}

#[tauri::command]
fn test_clash_proxy_delay(store: State<'_, ConnectionStore>, proxy: String) -> Result<u64, String> {
    ensure_clash_connected(&store)?;
    clash_controller::test_delay(&proxy)
}

#[tauri::command]
fn test_clash_group_delay(
    store: State<'_, ConnectionStore>,
    group: String,
) -> Result<std::collections::HashMap<String, u64>, String> {
    ensure_clash_connected(&store)?;
    clash_controller::test_group_delay(&group)
}

#[tauri::command]
fn get_clash_mode(app: tauri::AppHandle) -> Result<String, String> {
    clash_controller::get_saved_mode(&app)
}

#[tauri::command]
fn set_clash_mode(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
    mode: String,
) -> Result<(), String> {
    let state = services::snapshot(&store);
    let apply_remote = state.mode == "clash"
        && state.connected
        && matches!(state.core_id.as_deref(), Some("mihomo" | "mihomo-alpha"));
    clash_controller::set_mode(&app, &mode, apply_remote)
}

#[tauri::command]
fn list_clash_proxy_providers(
    store: State<'_, ConnectionStore>,
) -> Result<Vec<clash_controller::ClashProxyProvider>, String> {
    ensure_clash_connected(&store)?;
    clash_controller::list_proxy_providers()
}

#[tauri::command]
fn update_clash_proxy_provider(
    store: State<'_, ConnectionStore>,
    name: String,
) -> Result<(), String> {
    ensure_clash_connected(&store)?;
    clash_controller::update_proxy_provider(&name)
}

#[tauri::command]
fn healthcheck_clash_proxy_provider(
    store: State<'_, ConnectionStore>,
    name: String,
) -> Result<(), String> {
    ensure_clash_connected(&store)?;
    clash_controller::healthcheck_proxy_provider(&name)
}

#[tauri::command]
fn get_clash_settings(app: tauri::AppHandle) -> Result<clash_controller::ClashSettings, String> {
    clash_controller::get_settings(&app)
}

#[tauri::command]
fn set_clash_boolean_setting(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
    key: String,
    value: bool,
) -> Result<clash_controller::ClashSettings, String> {
    let state = services::snapshot(&store);
    let apply_remote = state.mode == "clash"
        && state.connected
        && matches!(state.core_id.as_deref(), Some("mihomo" | "mihomo-alpha"));
    clash_controller::set_boolean_setting(&app, &key, value, apply_remote)
}

#[tauri::command]
fn set_clash_system_proxy(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
    enabled: bool,
) -> Result<AppConnectionState, String> {
    services::set_clash_system_proxy(&app, &store, enabled)
}

#[tauri::command]
fn set_clash_tun(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
    enabled: bool,
) -> Result<AppConnectionState, String> {
    services::set_clash_tun(&app, &store, enabled)
}

#[tauri::command]
fn set_auto_tun(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
    runtime: State<'_, core_runtime::CoreRuntime>,
    enabled: bool,
) -> Result<AppConnectionState, String> {
    services::set_auto_tun(app, &store, &runtime, enabled)
}

#[tauri::command]
fn restart_as_admin(app: tauri::AppHandle) -> Result<(), String> {
    process_utils::relaunch_elevated_delayed()?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn list_clash_connections(
    store: State<'_, ConnectionStore>,
) -> Result<Vec<clash_controller::ClashConnection>, String> {
    ensure_clash_connected(&store)?;
    clash_controller::list_connections()
}

#[tauri::command]
fn close_all_clash_connections(store: State<'_, ConnectionStore>) -> Result<(), String> {
    ensure_clash_connected(&store)?;
    clash_controller::close_connections()
}

#[tauri::command]
fn close_clash_connection(store: State<'_, ConnectionStore>, id: String) -> Result<(), String> {
    ensure_clash_connected(&store)?;
    clash_controller::close_connection(&id)
}

#[tauri::command]
fn list_clash_rules(
    store: State<'_, ConnectionStore>,
) -> Result<Vec<clash_controller::ClashRule>, String> {
    ensure_clash_connected(&store)?;
    clash_controller::list_rules()
}

#[tauri::command]
fn test_clash_service(
    store: State<'_, ConnectionStore>,
    url: String,
) -> Result<clash_controller::ClashServiceResult, String> {
    ensure_clash_connected(&store)?;
    clash_controller::test_service(&url)
}

#[tauri::command]
fn start_clash_realtime(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
    hub: State<'_, clash_realtime::ClashRealtimeHub>,
) -> Result<(), String> {
    ensure_clash_connected(&store)?;
    hub.start(app);
    Ok(())
}

#[tauri::command]
fn stop_clash_realtime(hub: State<'_, clash_realtime::ClashRealtimeHub>) {
    hub.stop();
}

#[tauri::command]
fn get_clash_realtime_state(hub: State<'_, clash_realtime::ClashRealtimeHub>) -> bool {
    hub.is_running()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(ConnectionStore::default())
        .manage(community_nodes::scanner::CommunityNodeStore::default())
        .manage(community_nodes::subs_check::SubsCheckRuntime::default())
        .manage(core_runtime::CoreRuntime::default())
        .manage(clash_realtime::ClashRealtimeHub::default())
        .manage(TrayMenuState::default())
        .setup(|app| {
            let store = app.state::<ConnectionStore>();
            let _ = system_proxy::recover_stale(&store.proxy);
            services::load_connection_settings(app.handle(), &store);
            services::load_speed_test_settings(app.handle());
            let tray_status = MenuItem::with_id(app, "tray-status", "KiNGO", false, None::<&str>)?;
            let tray_connect =
                MenuItem::with_id(app, "tray-connect-toggle", "连接", true, None::<&str>)?;
            let tray_best_route = MenuItem::with_id(
                app,
                "tray-best-route",
                "自动选择最佳线路",
                true,
                None::<&str>,
            )?;
            let tray_rule =
                CheckMenuItem::with_id(app, "tray-rule", "规则模式", true, true, None::<&str>)?;
            let tray_global =
                CheckMenuItem::with_id(app, "tray-global", "全局模式", true, false, None::<&str>)?;
            let tray_tun =
                CheckMenuItem::with_id(app, "tray-tun", "TUN 模式", true, false, None::<&str>)?;
            let tray_menu = MenuBuilder::new(app)
                .item(&tray_status)
                .separator()
                .item(&tray_connect)
                .item(&tray_best_route)
                .separator()
                .item(&tray_rule)
                .item(&tray_global)
                .item(&tray_tun)
                .separator()
                .text("show", "显示 KiNGO")
                .text("quit", "退出 KiNGO")
                .build()?;
            *app.state::<TrayMenuState>()
                .0
                .lock()
                .map_err(|_| std::io::Error::other("tray menu state unavailable"))? =
                Some(TrayMenuHandles {
                    status: tray_status,
                    connect: tray_connect,
                    best_route: tray_best_route,
                    rule: tray_rule,
                    global: tray_global,
                    tun: tray_tun,
                });
            let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
            TrayIconBuilder::with_id("kingo-tray")
                .icon(tray_icon)
                .tooltip("KiNGO")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main_window(app),
                    "tray-connect-toggle" => run_tray_action(app, |app| {
                        let store = app.state::<ConnectionStore>();
                        let runtime = app.state::<core_runtime::CoreRuntime>();
                        let state = services::snapshot(&store);
                        if state.connected || state.connecting || state.stage != "idle" {
                            services::cancel_connection(&app, &store, &runtime)
                        } else {
                            let selected = store
                                .selected_route
                                .lock()
                                .map_err(|_| "线路选择状态不可用")?
                                .clone();
                            services::start_public_connection(
                                app.clone(),
                                &store,
                                &runtime,
                                selected,
                            )
                        }
                    }),
                    "tray-best-route" => run_tray_action(app, |app| {
                        let store = app.state::<ConnectionStore>();
                        let runtime = app.state::<core_runtime::CoreRuntime>();
                        services::start_public_connection(app.clone(), &store, &runtime, None)
                    }),
                    "tray-rule" | "tray-global" => {
                        let mode = if event.id().as_ref() == "tray-global" {
                            "global"
                        } else {
                            "rule"
                        }
                        .to_string();
                        run_tray_action(app, move |app| {
                            let store = app.state::<ConnectionStore>();
                            let runtime = app.state::<core_runtime::CoreRuntime>();
                            let mut settings = services::get_auto_routing_settings(&app);
                            settings.mode = mode;
                            services::set_auto_routing_settings(&app, &store, &runtime, settings)?;
                            services::emit_snapshot(&app, &store);
                            Ok(())
                        });
                    }
                    "tray-tun" => run_tray_action(app, |app| {
                        let store = app.state::<ConnectionStore>();
                        let runtime = app.state::<core_runtime::CoreRuntime>();
                        let enabled = !services::snapshot(&store).tun_enabled;
                        services::set_auto_tun(app.clone(), &store, &runtime, enabled)?;
                        Ok(())
                    }),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } | TrayIconEvent::DoubleClick {
                            button: MouseButton::Left,
                            ..
                        }
                    ) {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;
            let tray_app = app.handle().clone();
            app.listen("connection-state", move |event| {
                if let Ok(state) = serde_json::from_str::<AppConnectionState>(event.payload()) {
                    update_tray_visual(&tray_app, &state);
                }
            });
            update_tray_visual(app.handle(), &services::snapshot(&store));
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_app_state,
            get_community_scan_state,
            start_community_scan,
            stop_community_scan,
            list_community_nodes,
            clear_community_nodes,
            get_community_settings,
            save_community_settings,
            retest_community_node,
            retest_all_community_nodes,
            connect_community_node,
            enable_uwp_loopback,
            list_public_routes,
            test_public_routes,
            test_public_route,
            update_public_routes,
            cancel_public_route_update,
            get_public_route_update_status,
            select_public_route,
            start_public_connection,
            get_auto_routing_settings,
            set_auto_routing_settings,
            cancel_connection,
            disconnect,
            refresh_exit_info,
            get_traffic,
            set_auto_failover,
            get_speed_test_settings,
            set_speed_test_settings,
            test_speed_test_url,
            list_core_profiles,
            list_core_status,
            check_core_updates,
            check_app_update,
            prepare_app_update,
            update_core,
            restore_bundled_core,
            get_clash_core,
            set_clash_core,
            check_clash_core_updates,
            update_clash_core,
            restart_clash_core,
            open_clash_core_dir,
            get_runtime_paths,
            start_core,
            stop_core,
            list_running_cores,
            list_clash_profiles,
            import_clash_profile,
            import_clash_profile_content,
            import_clash_profile_local,
            import_clash_profile_file,
            get_clash_profile_source,
            save_clash_profile_source,
            get_clash_runtime_config,
            update_clash_profile,
            update_clash_profiles,
            activate_clash_profile,
            start_clash_profile,
            delete_clash_profile,
            delete_clash_profiles,
            list_clash_proxy_groups,
            select_clash_proxy,
            test_clash_proxy_delay,
            test_clash_group_delay,
            get_clash_mode,
            set_clash_mode,
            list_clash_proxy_providers,
            update_clash_proxy_provider,
            healthcheck_clash_proxy_provider,
            get_clash_settings,
            set_clash_boolean_setting,
            set_clash_system_proxy,
            set_clash_tun,
            set_auto_tun,
            restart_as_admin,
            list_clash_connections,
            close_all_clash_connections,
            close_clash_connection,
            list_clash_rules,
            test_clash_service,
            start_clash_realtime,
            stop_clash_realtime,
            get_clash_realtime_state,
            list_v2ray_nodes,
            import_v2ray_nodes,
            import_v2ray_qr_image,
            scan_v2ray_qr_screen,
            create_v2ray_node,
            delete_v2ray_nodes,
            set_active_v2ray_node,
            update_v2ray_node,
            move_v2ray_nodes,
            reorder_v2ray_nodes,
            sort_v2ray_nodes,
            duplicate_v2ray_node,
            move_v2ray_node_group,
            remove_duplicate_v2ray_nodes,
            share_v2ray_nodes,
            export_v2ray_nodes,
            qrcode_v2ray_node,
            get_v2ray_settings,
            set_v2ray_settings,
            list_v2ray_subscriptions,
            add_v2ray_subscription,
            update_v2ray_subscription_settings,
            update_v2ray_subscription,
            update_all_v2ray_subscriptions,
            delete_v2ray_subscription,
            test_v2ray_nodes,
            start_v2ray_tests,
            cancel_v2ray_tests,
            start_v2ray_connection,
            stop_v2ray_connection,
            get_v2ray_runtime_state
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    app.run(|app_handle, event| {
        if let tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::CloseRequested { api, .. },
            ..
        } = &event
        {
            api.prevent_close();
            if let Some(window) = app_handle.get_webview_window(label) {
                let _ = window.hide();
            }
            return;
        }
        if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
            let subs_check = app_handle.state::<community_nodes::subs_check::SubsCheckRuntime>();
            community_nodes::subs_check::shutdown(&subs_check);
            let runtime = app_handle.state::<core_runtime::CoreRuntime>();
            let store = app_handle.state::<ConnectionStore>();
            if let Ok(cancel) = store.cancel.lock() {
                if let Some(flag) = cancel.as_ref() {
                    flag.store(true, std::sync::atomic::Ordering::Relaxed);
                }
            }
            let _ = core_runtime::stop_all(&runtime);
            let _ = system_proxy::disable(&store.proxy);
        }
    });
}
