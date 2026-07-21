use crate::clash_controller::{parse_connection_value, ClashConnection};
use serde::Serialize;
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter};
use tungstenite::{client::IntoClientRequest, connect, http::HeaderValue, Message};

const CONTROLLER: &str = "ws://127.0.0.1:9090";
const SECRET: &str = "KiNGO";

#[derive(Clone, Default)]
pub struct ClashRealtimeHub {
    running: Arc<AtomicBool>,
    generation: Arc<AtomicU64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RealtimeStatus {
    channel: &'static str,
    connected: bool,
    error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrafficEvent {
    upload_bps: u64,
    download_bps: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionsEvent {
    connections: Vec<ClashConnection>,
    upload_total: u64,
    download_total: u64,
}

impl ClashRealtimeHub {
    pub fn start(&self, app: AppHandle) {
        if self
            .running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return;
        }
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        for channel in ["traffic", "connections", "logs"] {
            spawn_channel(
                app.clone(),
                channel,
                self.running.clone(),
                self.generation.clone(),
                generation,
            );
        }
    }

    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
        self.generation.fetch_add(1, Ordering::SeqCst);
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }
}

fn spawn_channel(
    app: AppHandle,
    channel: &'static str,
    running: Arc<AtomicBool>,
    generation: Arc<AtomicU64>,
    expected_generation: u64,
) {
    std::thread::spawn(move || {
        while running.load(Ordering::SeqCst)
            && generation.load(Ordering::SeqCst) == expected_generation
        {
            let url = if channel == "logs" {
                format!("{CONTROLLER}/logs?level=debug")
            } else {
                format!("{CONTROLLER}/{channel}")
            };
            let result = run_channel(
                &app,
                channel,
                &url,
                &running,
                &generation,
                expected_generation,
            );
            if running.load(Ordering::SeqCst)
                && generation.load(Ordering::SeqCst) == expected_generation
            {
                let _ = app.emit(
                    "clash-realtime-status",
                    RealtimeStatus {
                        channel,
                        connected: false,
                        error: result.err(),
                    },
                );
                std::thread::sleep(Duration::from_secs(1));
            }
        }
    });
}

fn run_channel(
    app: &AppHandle,
    channel: &'static str,
    url: &str,
    running: &AtomicBool,
    generation: &AtomicU64,
    expected_generation: u64,
) -> Result<(), String> {
    let mut request = url
        .into_client_request()
        .map_err(|error| format!("创建 {channel} WebSocket 请求失败：{error}"))?;
    request.headers_mut().insert(
        "Authorization",
        HeaderValue::from_str(&format!("Bearer {SECRET}"))
            .map_err(|error| format!("设置 WebSocket 密钥失败：{error}"))?,
    );
    let (mut socket, _) = connect(request)
        .map_err(|error| format!("连接 mihomo {channel} WebSocket 失败：{error}"))?;
    let _ = app.emit(
        "clash-realtime-status",
        RealtimeStatus {
            channel,
            connected: true,
            error: None,
        },
    );
    while running.load(Ordering::SeqCst) && generation.load(Ordering::SeqCst) == expected_generation
    {
        match socket.read() {
            Ok(Message::Text(text)) => handle_message(app, channel, text.as_str())?,
            Ok(Message::Close(_)) => return Err(format!("mihomo {channel} WebSocket 已关闭")),
            Ok(_) => {}
            Err(error) => return Err(format!("读取 mihomo {channel} WebSocket 失败：{error}")),
        }
    }
    let _ = socket.close(None);
    Ok(())
}

fn handle_message(app: &AppHandle, channel: &str, text: &str) -> Result<(), String> {
    let value: serde_json::Value = serde_json::from_str(text)
        .map_err(|error| format!("解析 mihomo {channel} 实时数据失败：{error}"))?;
    match channel {
        "traffic" => {
            let _ = app.emit(
                "clash-realtime-traffic",
                TrafficEvent {
                    upload_bps: value
                        .get("up")
                        .and_then(serde_json::Value::as_u64)
                        .unwrap_or(0),
                    download_bps: value
                        .get("down")
                        .and_then(serde_json::Value::as_u64)
                        .unwrap_or(0),
                },
            );
        }
        "connections" => {
            let _ = app.emit(
                "clash-realtime-connections",
                ConnectionsEvent {
                    connections: parse_connections(&value),
                    upload_total: value
                        .get("uploadTotal")
                        .and_then(serde_json::Value::as_u64)
                        .unwrap_or(0),
                    download_total: value
                        .get("downloadTotal")
                        .and_then(serde_json::Value::as_u64)
                        .unwrap_or(0),
                },
            );
        }
        "logs" => {
            let level = value
                .get("type")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("info");
            let payload = value
                .get("payload")
                .and_then(serde_json::Value::as_str)
                .unwrap_or(text);
            let _ = app.emit(
                "connection-log",
                serde_json::json!({ "level": level, "message": format!("[mihomo] {payload}") }),
            );
        }
        _ => {}
    }
    Ok(())
}

fn parse_connections(value: &serde_json::Value) -> Vec<ClashConnection> {
    value
        .get("connections")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(parse_connection_value)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::parse_connections;

    #[test]
    fn parses_mihomo_connection_snapshot() {
        let value = serde_json::json!({
            "connections": [{
                "id": "connection-1",
                "metadata": {
                    "host": "example.com",
                    "network": "tcp",
                    "process": "browser.exe"
                },
                "rule": "DOMAIN",
                "chains": ["Proxy", "Node A"],
                "download": 2048,
                "upload": 512
            }]
        });
        let connections = parse_connections(&value);
        assert_eq!(connections.len(), 1);
        assert_eq!(connections[0].host, "example.com");
        assert_eq!(connections[0].chains, vec!["Proxy", "Node A"]);
        assert_eq!(connections[0].download, 2048);
    }
}
