mod clash_controller;
mod clash_profiles;
mod clash_realtime;
mod core_runtime;
mod core_update;
mod cores;
mod paths;
mod process_utils;
mod services;
mod system_proxy;
mod traffic_bridge;
mod v2ray;

use services::{AppConnectionState, ConnectionStore, PublicRoute};
use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri::{Listener, Manager, State};

fn update_tray_visual(app: &tauri::AppHandle, state: &AppConnectionState) {
    let Some(tray) = app.tray_by_id("kingo-tray") else {
        return;
    };
    let active = state.connected
        || state.connecting
        || matches!(
            state.stage.as_str(),
            "preparing" | "connecting" | "switching" | "failover" | "disconnecting"
        );
    let bytes: &'static [u8] = if active {
        include_bytes!("../../../icons/32x32_Connecting.png")
    } else {
        include_bytes!("../icons/tray.png")
    };
    if let Ok(icon) = tauri::image::Image::from_bytes(bytes) {
        let _ = tray.set_icon(Some(icon));
    }
    let tooltip = if state.connected {
        state
            .display_name
            .as_deref()
            .map(|name| format!("KiNGO ? ??? ? {name}"))
            .unwrap_or_else(|| "KiNGO ? ???".into())
    } else if state.connecting {
        "KiNGO ? ????".into()
    } else {
        "KiNGO ? ???".into()
    };
    let _ = tray.set_tooltip(Some(tooltip));
}

#[tauri::command]
fn get_app_state(app: tauri::AppHandle, store: State<'_, ConnectionStore>) -> AppConnectionState {
    services::load_route_metrics(&app, &store);
    services::snapshot(&store)
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
) -> Result<(), String> {
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
fn update_core(
    app: tauri::AppHandle,
    core_id: String,
) -> Result<core_update::CoreUpdateResult, String> {
    let runtime = app.state::<core_runtime::CoreRuntime>();
    core_runtime::stop_all(&runtime)?;
    core_update::update(&app, &core_id)
}

#[tauri::command]
fn restore_bundled_core(app: tauri::AppHandle, core_id: String) -> Result<(), String> {
    let runtime = app.state::<core_runtime::CoreRuntime>();
    core_runtime::stop_all(&runtime)?;
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
        .ok_or("?????? Clash ??")?;
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
        .map_err(|error| format!("?????????{error}"))?;
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
                .map_err(|error| format!("???????????????????{error}"))?;
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
                .map_err(|error| format!("???????????{error}"))
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
        return Err("V2ray ???????????????".into());
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
        .ok_or("V2ray ?????")?;
    if state.mode == "v2ray" && state.connecting {
        return Err("V2ray ??????????????".into());
    }
    if state.mode == "v2ray" && state.connected && !target.active {
        v2ray::start_connection(app.clone(), &store, &runtime, Some(node_id.clone()))?;
        return v2ray::list_nodes(&app, None)?
            .into_iter()
            .find(|node| node.id == node_id)
            .ok_or_else(|| "???????????".to_string());
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
        return Err("????????????????????".into());
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
        return Err("???? V2ray ??????????".into());
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
        return Err("???? V2ray ???????".into());
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
        return Err("???? V2ray ???????".into());
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
        return Err("??????????????????????????".into());
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
        Err("?????? Clash ??".into())
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
        .manage(core_runtime::CoreRuntime::default())
        .manage(clash_realtime::ClashRealtimeHub::default())
        .setup(|app| {
            let store = app.state::<ConnectionStore>();
            let _ = system_proxy::recover_stale(&store.proxy);
            services::load_connection_settings(app.handle(), &store);
            services::load_speed_test_settings(app.handle());
            v2ray::start_subscription_scheduler(app.handle().clone());
            clash_profiles::start_scheduler(app.handle().clone());
            let tray_menu = MenuBuilder::new(app)
                .text("show", "?? KiNGO")
                .separator()
                .text("quit", "?? KiNGO")
                .build()?;
            let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
            TrayIconBuilder::with_id("kingo-tray")
                .icon(tray_icon)
                .tooltip("KiNGO")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
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
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
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
        .invoke_handler(tauri::generate_handler![
            get_app_state,
            enable_uwp_loopback,
            list_public_routes,
            test_public_routes,
            test_public_route,
            update_public_routes,
            cancel_public_route_update,
            get_public_route_update_status,
            select_public_route,
            start_public_connection,
            cancel_connection,
            disconnect,
            refresh_exit_info,
            get_traffic,
            set_auto_failover,
            get_speed_test_settings,
            set_speed_test_settings,
            list_core_profiles,
            list_core_status,
            check_core_updates,
            check_app_update,
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
