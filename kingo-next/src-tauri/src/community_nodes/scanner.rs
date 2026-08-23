use super::{
    models::{CommunityNodeCandidate, CommunityScanState},
    probe, ranking, speed_test, store,
};
use std::{
    collections::{HashMap, VecDeque},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};

const RETEST_SPEED_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Clone)]
pub struct CommunityNodeStore {
    pub state: Arc<Mutex<CommunityScanState>>,
    pub nodes: Arc<Mutex<Vec<CommunityNodeCandidate>>>,
    retesting: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    pub(crate) operations: Arc<Mutex<()>>,
}

impl Default for CommunityNodeStore {
    fn default() -> Self {
        Self {
            state: Arc::new(Mutex::new(CommunityScanState::default())),
            nodes: Arc::new(Mutex::new(Vec::new())),
            retesting: Arc::new(Mutex::new(HashMap::new())),
            operations: Arc::new(Mutex::new(())),
        }
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn job_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("community-{millis}")
}

pub(crate) fn has_active_retests(store: &CommunityNodeStore) -> bool {
    store
        .retesting
        .lock()
        .map(|active| !active.is_empty())
        .unwrap_or(true)
}

pub fn state(store: &CommunityNodeStore) -> CommunityScanState {
    store
        .state
        .lock()
        .map(|state| state.clone())
        .unwrap_or_default()
}

pub fn restored_state(app: &AppHandle, store: &CommunityNodeStore) -> CommunityScanState {
    if let Ok(mut current) = store.state.lock() {
        if current.state == "idle" {
            if let Some(mut saved) = store::load_scan_state(app) {
                let retained_nodes = store::load_nodes(app).len();
                if saved.retained_total != retained_nodes {
                    saved.retained_total = retained_nodes;
                }
                if matches!(
                    saved.state.as_str(),
                    "running" | "paused" | "stopping" | "interrupted"
                ) {
                    if let Some(job_id) = saved.job_id.as_deref() {
                        let _ = store::remove_runtime_directory(app, job_id);
                    }
                    saved.state = "stopped".into();
                    saved.stage = "stopped".into();
                    saved.completed_at = Some(now());
                    saved.message = Some("上次公共节点检测已结束，已有结果仍然保留".into());
                }
                saved.updated_at = Some(now());
                let _ = store::save_scan_state(app, &saved);
                *current = saved;
            }
        }
        return current.clone();
    }
    CommunityScanState::default()
}

pub fn nodes(app: &AppHandle, store: &CommunityNodeStore) -> Vec<CommunityNodeCandidate> {
    if let Ok(mut nodes) = store.nodes.lock() {
        if nodes.is_empty() {
            *nodes = store::load_nodes(app);
        }
        return nodes.clone();
    }
    Vec::new()
}

pub fn clear(app: &AppHandle, store: &CommunityNodeStore) -> Result<(), String> {
    let _operation = store
        .operations
        .lock()
        .map_err(|_| "公共节点操作状态不可用")?;
    if matches!(
        state(store).state.as_str(),
        "running" | "paused" | "stopping"
    ) {
        return Err("请先停止公共节点任务".into());
    }
    if has_active_retests(store) {
        return Err("请先等待公共节点复测完成，再清空结果".into());
    }
    store::clear_nodes(app)?;
    if let Ok(mut nodes) = store.nodes.lock() {
        nodes.clear();
    }
    let cleared = CommunityScanState {
        updated_at: Some(now()),
        message: Some("节点结果已清空".into()),
        ..CommunityScanState::default()
    };
    if let Ok(mut state) = store.state.lock() {
        *state = cleared.clone();
    }
    let persisted = store::save_scan_state(app, &cleared);
    let _ = app.emit("community-scan-progress", cleared);
    persisted
}

pub fn retest(
    app: AppHandle,
    store_state: &CommunityNodeStore,
    node_id: String,
) -> Result<(), String> {
    let _operation = store_state
        .operations
        .lock()
        .map_err(|_| "公共节点操作状态不可用")?;
    if matches!(
        state(store_state).state.as_str(),
        "running" | "paused" | "stopping"
    ) {
        return Err("请先等待公共节点批量检测结束或停止任务".into());
    }
    let node = nodes(&app, store_state)
        .into_iter()
        .find(|node| node.id == node_id)
        .ok_or_else(|| "公共节点不存在，可能已被清理".to_string())?;
    let cancel = {
        let mut active = store_state
            .retesting
            .lock()
            .map_err(|_| "公共节点复测状态不可用")?;
        if active.contains_key(&node.id) {
            return Err("该节点已经在复测中".into());
        }
        if active.len() >= 2 {
            return Err("最多同时复测 2 个节点，请等待当前复测完成".into());
        }
        let cancel = Arc::new(AtomicBool::new(false));
        active.insert(node.id.clone(), cancel.clone());
        cancel
    };
    let worker_store = store_state.clone();
    std::thread::spawn(move || retest_node_worker(app, worker_store, node, false, cancel));
    Ok(())
}

fn retest_node_worker(
    app: AppHandle,
    worker_store: CommunityNodeStore,
    node: CommunityNodeCandidate,
    batch: bool,
    cancel: Arc<AtomicBool>,
) {
    let _ = app.emit(
        "community-node-retest",
        serde_json::json!({ "nodeId": node.id, "state": "running", "batch": batch }),
    );
    let paused = Arc::new(AtomicBool::new(false));
    let latency_url = crate::services::current_speed_test_settings()
        .latency_urls()
        .into_iter()
        .next()
        .unwrap_or_else(|| "https://www.gstatic.com/generate_204".into());
    let retest_job = format!("retest-{}-{}", job_id(), node.id);
    let probe_result = probe::quick_probe(
        &app,
        &retest_job,
        std::slice::from_ref(&node),
        &latency_url,
        &cancel,
        &AtomicBool::new(false),
        &paused,
        |_| {},
    )
    .into_iter()
    .next();
    if cancel.load(Ordering::SeqCst) {
        finish_cancelled_retest(&app, &worker_store, &node.id, &retest_job, batch);
        return;
    }
    let mut updated = node.clone();
    updated.latency_samples.clear();
    updated.latency_median_ms = None;
    updated.speed_samples_kbps.clear();
    updated.speed_median_kbps = None;
    updated.country_code = None;
    updated.country_name = None;
    updated.exit_ip = None;
    updated.exit_verified = false;
    updated.last_error_code = None;
    updated.last_error_detail = None;
    if let Some(result) = probe_result {
        if let Some(latency) = result.latency {
            updated.latency_samples.push(latency);
            updated.latency_median_ms = Some(latency);
            let settings = store::load_settings(&app);
            let speed_settings = crate::services::current_speed_test_settings();
            if let Some(speed) = speed_test::test_nodes(
                &app,
                &retest_job,
                std::slice::from_ref(&updated),
                &speed_settings.download_url,
                1,
                Duration::from_secs(settings.speed_timeout_seconds),
                RETEST_SPEED_BYTES,
                cancel.clone(),
                Arc::new(AtomicBool::new(false)),
                paused.clone(),
                |_| {},
            )
            .into_iter()
            .next()
            {
                if let Some(value) = speed.speed_kbps {
                    updated.speed_samples_kbps.push(value);
                    updated.speed_median_kbps = Some(value);
                    updated.country_code = speed.country_code;
                    updated.country_name = speed.country_name;
                    updated.exit_ip = speed.exit_ip;
                    updated.exit_verified =
                        updated.exit_ip.is_some() && updated.country_code.is_some();
                } else if speed.error_code.as_deref() == Some("speed_provider_rate_limited") {
                    updated = node.clone();
                    updated.latency_samples = vec![latency];
                    updated.latency_median_ms = Some(latency);
                    updated.last_error_code = speed.error_code;
                    updated.last_error_detail = speed.error_detail;
                } else {
                    updated.last_error_code = speed.error_code;
                    updated.last_error_detail = speed.error_detail;
                }
            }
        } else {
            updated.last_error_code = result.error_code;
            updated.last_error_detail = result.error_detail;
        }
    } else {
        updated.last_error_code = Some("probe_failed".into());
        updated.last_error_detail = Some("节点复测未返回结果".into());
    }
    if cancel.load(Ordering::SeqCst) {
        finish_cancelled_retest(&app, &worker_store, &node.id, &retest_job, batch);
        return;
    }
    updated.country_name = Some(crate::services::country_name_zh(
        updated.country_code.as_deref(),
        updated.country_name.as_deref(),
    ));
    updated.last_tested_at = Some(now());
    let mut persistence_error = None;
    if let Ok(mut stored) = worker_store.nodes.lock() {
        let mut next = stored.clone();
        if let Some(target) = next.iter_mut().find(|item| item.id == updated.id) {
            *target = updated.clone();
        }
        let settings = store::load_settings(&app);
        ranking::sort_nodes(&mut next, &settings.sort_mode);
        let mut counters = std::collections::HashMap::<String, usize>::new();
        for item in &mut next {
            let country = item
                .country_name
                .clone()
                .unwrap_or_else(|| "未知地区".into());
            let counter = counters.entry(country.clone()).or_default();
            *counter += 1;
            item.display_name = format!("{country} {:02}", *counter);
        }
        match store::save_nodes(&app, &next) {
            Ok(()) => *stored = next,
            Err(error) => persistence_error = Some(error),
        }
    } else {
        persistence_error = Some("公共节点内存状态不可用，复测结果未提交".into());
    }
    if let Ok(mut active) = worker_store.retesting.lock() {
        active.remove(&updated.id);
    }
    let _ = store::remove_runtime_directory(&app, &retest_job);
    let _ = app.emit(
        "community-node-retest",
        serde_json::json!({
            "nodeId": updated.id,
            "state": "completed",
            "batch": batch,
            "success": updated.exit_verified && persistence_error.is_none(),
            "error": persistence_error.or(updated.last_error_detail)
        }),
    );
}

fn finish_cancelled_retest(
    app: &AppHandle,
    store_state: &CommunityNodeStore,
    node_id: &str,
    retest_job: &str,
    batch: bool,
) {
    if let Ok(mut active) = store_state.retesting.lock() {
        active.remove(node_id);
    }
    let _ = store::remove_runtime_directory(app, retest_job);
    let _ = app.emit(
        "community-node-retest",
        serde_json::json!({ "nodeId": node_id, "state": "stopped", "batch": batch }),
    );
}

pub fn retest_all(app: AppHandle, store_state: &CommunityNodeStore) -> Result<usize, String> {
    let _operation = store_state
        .operations
        .lock()
        .map_err(|_| "公共节点操作状态不可用")?;
    if matches!(
        state(store_state).state.as_str(),
        "running" | "paused" | "stopping"
    ) {
        return Err("请先等待公共节点批量检测结束或停止任务".into());
    }
    let queued = nodes(&app, store_state);
    if queued.is_empty() {
        return Err("当前没有可复测的公共节点".into());
    }
    let cancel = {
        let mut active = store_state
            .retesting
            .lock()
            .map_err(|_| "公共节点复测状态不可用")?;
        if !active.is_empty() {
            return Err("请等待当前单节点复测完成后再批量复测".into());
        }
        let cancel = Arc::new(AtomicBool::new(false));
        active.extend(queued.iter().map(|node| (node.id.clone(), cancel.clone())));
        cancel
    };
    let total = queued.len();
    let queue = Arc::new(Mutex::new(VecDeque::from(queued)));
    let coordinator_store = store_state.clone();
    std::thread::spawn(move || {
        let _ = app.emit(
            "community-retest-batch",
            serde_json::json!({ "state": "running", "done": 0, "total": total }),
        );
        let completed = Arc::new(AtomicUsize::new(0));
        std::thread::scope(|scope| {
            for _ in 0..2.min(total) {
                let app = app.clone();
                let queue = queue.clone();
                let worker_store = coordinator_store.clone();
                let completed = completed.clone();
                let worker_cancel = cancel.clone();
                scope.spawn(move || loop {
                    if worker_cancel.load(Ordering::SeqCst) {
                        break;
                    }
                    let node = queue.lock().ok().and_then(|mut queue| queue.pop_front());
                    let Some(node) = node else { break };
                    retest_node_worker(
                        app.clone(),
                        worker_store.clone(),
                        node,
                        true,
                        worker_cancel.clone(),
                    );
                    let done = completed.fetch_add(1, Ordering::SeqCst) + 1;
                    let _ = app.emit(
                        "community-retest-batch",
                        serde_json::json!({ "state": "running", "done": done, "total": total }),
                    );
                });
            }
        });
        let stopped = cancel.load(Ordering::SeqCst);
        let done = completed.load(Ordering::SeqCst);
        if let Ok(mut active) = coordinator_store.retesting.lock() {
            active.clear();
        }
        let _ = app.emit(
            "community-retest-batch",
            serde_json::json!({
                "state": if stopped { "stopped" } else { "completed" },
                "done": done,
                "total": total
            }),
        );
    });
    Ok(total)
}

pub fn stop_retest(store_state: &CommunityNodeStore, node_id: &str) -> Result<(), String> {
    let active = store_state
        .retesting
        .lock()
        .map_err(|_| "公共节点复测状态不可用")?;
    let cancel = active
        .get(node_id)
        .ok_or_else(|| "该节点当前没有正在运行的复测".to_string())?;
    cancel.store(true, Ordering::SeqCst);
    Ok(())
}

pub fn stop_retests(store_state: &CommunityNodeStore) -> Result<(), String> {
    let active = store_state
        .retesting
        .lock()
        .map_err(|_| "公共节点复测状态不可用")?;
    if active.is_empty() {
        return Err("当前没有正在运行的节点复测".into());
    }
    for cancel in active.values() {
        cancel.store(true, Ordering::SeqCst);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_state_is_idle() {
        assert_eq!(state(&CommunityNodeStore::default()).state, "idle");
    }

    #[test]
    fn active_retests_can_be_cancelled() {
        let store = CommunityNodeStore::default();
        assert!(stop_retests(&store).is_err());
        store
            .retesting
            .lock()
            .unwrap()
            .insert("node-1".into(), Arc::new(AtomicBool::new(false)));
        stop_retests(&store).unwrap();
        assert!(store
            .retesting
            .lock()
            .unwrap()
            .get("node-1")
            .unwrap()
            .load(Ordering::SeqCst));
    }

    #[test]
    fn a_single_retest_can_be_cancelled_without_touching_others() {
        let store = CommunityNodeStore::default();
        let first = Arc::new(AtomicBool::new(false));
        let second = Arc::new(AtomicBool::new(false));
        store.retesting.lock().unwrap().extend([
            ("first".into(), first.clone()),
            ("second".into(), second.clone()),
        ]);
        stop_retest(&store, "first").unwrap();
        assert!(first.load(Ordering::SeqCst));
        assert!(!second.load(Ordering::SeqCst));
    }
}
