use super::{models::CommunityNodeCandidate, store};
use crate::core_runtime;
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::json;
use std::{
    collections::VecDeque,
    fs,
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::AppHandle;

const CONFIG_CHUNK_SIZE: usize = 400;
const PROBE_CONCURRENCY: usize = 24;

#[derive(Clone, Debug)]
pub struct ProbeResult {
    pub latency: Option<u32>,
    pub error_code: Option<String>,
    pub error_detail: Option<String>,
}

pub(crate) fn available_port_pair() -> Result<(u16, u16), String> {
    let first = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("无法分配公共节点测试端口：{error}"))?;
    let second = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("无法分配公共节点测试端口：{error}"))?;
    let first_port = first
        .local_addr()
        .map_err(|error| format!("无法读取公共节点测试端口：{error}"))?
        .port();
    let second_port = second
        .local_addr()
        .map_err(|error| format!("无法读取公共节点测试端口：{error}"))?
        .port();
    Ok((first_port, second_port))
}

pub(crate) fn write_config(
    directory: &Path,
    name: &str,
    nodes: &[CommunityNodeCandidate],
    mixed_port: u16,
    controller_port: u16,
) -> Result<PathBuf, String> {
    let mut proxies = Vec::with_capacity(nodes.len());
    let mut names = Vec::with_capacity(nodes.len());
    for node in nodes {
        let mut config = node.config.clone();
        let object = config
            .as_object_mut()
            .ok_or_else(|| format!("节点 {} 的配置不是对象", node.id))?;
        object.insert("name".into(), serde_json::Value::String(node.id.clone()));
        proxies.push(config);
        names.push(node.id.clone());
    }
    let config = json!({
        "mixed-port": mixed_port,
        "external-controller": format!("127.0.0.1:{controller_port}"),
        "allow-lan": false,
        "mode": "global",
        "log-level": "silent",
        "ipv6": true,
        "proxies": proxies,
        "proxy-groups": [{
            "name": "COMMUNITY",
            "type": "select",
            "proxies": names
        }],
        "rules": ["MATCH,COMMUNITY"]
    });
    let path = directory.join(format!("{name}.yaml"));
    let content = serde_yaml::to_string(&config)
        .map_err(|error| format!("生成公共节点测试配置失败：{error}"))?;
    fs::write(&path, content).map_err(|error| format!("写入公共节点测试配置失败：{error}"))?;
    Ok(path)
}

pub(crate) fn wait_port(port: u16, child: &mut std::process::Child) -> Result<(), String> {
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(8) {
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!("公共节点测试核心提前退出：{status}"));
        }
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(80));
    }
    Err("公共节点测试核心端口未按时就绪".into())
}

fn probe_one(
    client: &reqwest::blocking::Client,
    controller_port: u16,
    node_id: &str,
    url: &str,
) -> ProbeResult {
    let node = utf8_percent_encode(node_id, NON_ALPHANUMERIC).to_string();
    let target = utf8_percent_encode(url, NON_ALPHANUMERIC).to_string();
    let endpoint = format!(
        "http://127.0.0.1:{controller_port}/proxies/{node}/delay?timeout=3000&url={target}"
    );
    let result = client
        .get(endpoint)
        .send()
        .and_then(|response| response.error_for_status())
        .and_then(|response| response.json::<serde_json::Value>());
    match result {
        Ok(value) => match value.get("delay").and_then(|delay| delay.as_u64()) {
            Some(delay) if delay > 0 && delay <= u32::MAX as u64 => ProbeResult {
                latency: Some(delay as u32),
                error_code: None,
                error_detail: None,
            },
            _ => ProbeResult {
                latency: None,
                error_code: Some("invalid_latency".into()),
                error_detail: Some("核心未返回有效延迟".into()),
            },
        },
        Err(error) => ProbeResult {
            latency: None,
            error_code: Some("probe_failed".into()),
            error_detail: Some(format!("节点测活失败：{error}")),
        },
    }
}

fn split_batch<T>(mut items: Vec<T>) -> (Vec<T>, Vec<T>) {
    let right = items.split_off(items.len() / 2);
    (items, right)
}

#[allow(clippy::too_many_arguments)]
fn probe_chunk(
    app: &AppHandle,
    directory: &Path,
    config_sequence: &AtomicUsize,
    nodes: Vec<CommunityNodeCandidate>,
    test_url: &str,
    cancel: &AtomicBool,
    finish_early: &AtomicBool,
    paused: &AtomicBool,
    on_result: &mut dyn FnMut(&ProbeResult),
) -> Vec<ProbeResult> {
    if nodes.is_empty() || cancel.load(Ordering::SeqCst) || finish_early.load(Ordering::SeqCst) {
        return Vec::new();
    }
    let (mixed_port, controller_port) = match available_port_pair() {
        Ok(ports) => ports,
        Err(error) => {
            let results = failed_chunk(&nodes, "port_unavailable", &error);
            for result in &results {
                on_result(result);
            }
            return results;
        }
    };
    let config_index = config_sequence.fetch_add(1, Ordering::SeqCst);
    let config = match write_config(
        directory,
        &format!("probe-{config_index}"),
        &nodes,
        mixed_port,
        controller_port,
    ) {
        Ok(path) => path,
        Err(error) => {
            let results = failed_chunk(&nodes, "config_failed", &error);
            for result in &results {
                on_result(result);
            }
            return results;
        }
    };
    let config_path = config.to_string_lossy().into_owned();
    if let Err(error) = core_runtime::validate_mihomo_config(app, &config_path) {
        let _ = fs::remove_file(&config);
        if nodes.len() > 1 {
            // Invalid subscription entries used to make us start one Mihomo process per node.
            // Split the batch instead, so valid neighbours stay grouped and only the failing
            // branch is narrowed down to an individual node.
            let (left, right) = split_batch(nodes);
            let mut isolated = probe_chunk(
                app,
                directory,
                config_sequence,
                left,
                test_url,
                cancel,
                finish_early,
                paused,
                on_result,
            );
            isolated.extend(probe_chunk(
                app,
                directory,
                config_sequence,
                right,
                test_url,
                cancel,
                finish_early,
                paused,
                on_result,
            ));
            return isolated;
        }
        let results = failed_chunk(&nodes, "config_failed", &error);
        for result in &results {
            on_result(result);
        }
        return results;
    }
    let mut child = match core_runtime::spawn_transient(app, "mihomo", &config_path) {
        Ok(child) => child,
        Err(error) => {
            let _ = fs::remove_file(&config);
            let results = failed_chunk(&nodes, "core_failed", &error);
            for result in &results {
                on_result(result);
            }
            return results;
        }
    };
    if let Err(error) = wait_port(controller_port, &mut child) {
        let _ = child.kill();
        let _ = child.wait();
        let _ = fs::remove_file(&config);
        let results = failed_chunk(&nodes, "core_failed", &error);
        for result in &results {
            on_result(result);
        }
        return results;
    }

    let queue = Arc::new(Mutex::new(VecDeque::from(nodes)));
    let (sender, receiver) = mpsc::channel();
    let count = queue.lock().map(|queue| queue.len()).unwrap_or_default();
    let workers = PROBE_CONCURRENCY.min(count.max(1));
    let mut results = Vec::with_capacity(count);
    std::thread::scope(|scope| {
        for _ in 0..workers {
            let queue = queue.clone();
            let sender = sender.clone();
            scope.spawn(move || {
                let client = reqwest::blocking::Client::builder()
                    .timeout(Duration::from_secs(4))
                    .no_proxy()
                    .build()
                    .ok();
                loop {
                    while paused.load(Ordering::SeqCst) && !cancel.load(Ordering::SeqCst) {
                        std::thread::sleep(Duration::from_millis(120));
                    }
                    if cancel.load(Ordering::SeqCst) || finish_early.load(Ordering::SeqCst) {
                        break;
                    }
                    let node = queue.lock().ok().and_then(|mut queue| queue.pop_front());
                    let Some(node) = node else { break };
                    let result = match &client {
                        Some(client) => probe_one(client, controller_port, &node.id, test_url),
                        None => ProbeResult {
                            latency: None,
                            error_code: Some("probe_client_failed".into()),
                            error_detail: Some("无法创建本地测活请求".into()),
                        },
                    };
                    if sender.send(result).is_err() {
                        break;
                    }
                }
            });
        }
        drop(sender);
        for result in receiver {
            on_result(&result);
            results.push(result);
        }
    });
    let _ = child.kill();
    let _ = child.wait();
    let _ = fs::remove_file(&config);
    results
}

fn failed_chunk(nodes: &[CommunityNodeCandidate], code: &str, detail: &str) -> Vec<ProbeResult> {
    nodes
        .iter()
        .map(|_| ProbeResult {
            latency: None,
            error_code: Some(code.into()),
            error_detail: Some(detail.into()),
        })
        .collect()
}

#[allow(clippy::too_many_arguments)]
pub fn quick_probe(
    app: &AppHandle,
    job_id: &str,
    nodes: &[CommunityNodeCandidate],
    test_url: &str,
    cancel: &AtomicBool,
    finish_early: &AtomicBool,
    paused: &AtomicBool,
    mut on_result: impl FnMut(&ProbeResult),
) -> Vec<ProbeResult> {
    let directory = match store::runtime_directory(app, job_id) {
        Ok(directory) => directory,
        Err(error) => return failed_chunk(nodes, "runtime_directory_failed", &error),
    };
    let config_sequence = AtomicUsize::new(0);
    let mut results = Vec::with_capacity(nodes.len());
    for chunk in nodes.chunks(CONFIG_CHUNK_SIZE) {
        if cancel.load(Ordering::SeqCst) || finish_early.load(Ordering::SeqCst) {
            break;
        }
        for result in probe_chunk(
            app,
            &directory,
            &config_sequence,
            chunk.to_vec(),
            test_url,
            cancel,
            finish_early,
            paused,
            &mut on_result,
        ) {
            results.push(result);
        }
    }
    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allocated_test_port_is_valid() {
        assert!(
            available_port_pair().is_ok_and(|(left, right)| left > 0 && right > 0 && left != right)
        );
    }

    #[test]
    fn invalid_batch_is_split_without_losing_or_reordering_items() {
        let (left, right) = split_batch(vec![1, 2, 3, 4, 5]);
        assert_eq!(left, vec![1, 2]);
        assert_eq!(right, vec![3, 4, 5]);
    }
}
