use super::models::{CommunityNodeCandidate, CommunitySource, ParseBatch};
use crate::v2ray::{parser as link_parser, ParsedNode};
use serde_json::{Map, Value};

fn value_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn value_port(value: &Value) -> Option<u16> {
    value.get("port").and_then(|port| {
        port.as_u64()
            .or_else(|| port.as_str()?.parse().ok())
            .filter(|port| *port > 0 && *port <= u16::MAX as u64)
            .map(|port| port as u16)
    })
}

fn candidate_from_clash(
    source: &CommunitySource,
    mut config: Value,
) -> Result<CommunityNodeCandidate, String> {
    let original_name = value_string(&config, "name").unwrap_or_else(|| "公共节点".into());
    let protocol = value_string(&config, "type").ok_or("节点缺少协议")?;
    let server = value_string(&config, "server").ok_or("节点缺少服务器地址")?;
    let port = value_port(&config).ok_or("节点端口无效")?;
    if let Value::Object(object) = &mut config {
        object.insert("name".into(), Value::String(original_name.clone()));
        object.insert("type".into(), Value::String(protocol.clone()));
        object.insert("server".into(), Value::String(server.clone()));
        object.insert("port".into(), Value::Number(port.into()));
    }
    Ok(CommunityNodeCandidate {
        id: String::new(),
        source_ids: vec![source.id.clone()],
        original_name,
        display_name: String::new(),
        protocol,
        server,
        port,
        config,
        latency_samples: Vec::new(),
        latency_median_ms: None,
        speed_samples_kbps: Vec::new(),
        speed_median_kbps: None,
        country_code: None,
        country_name: None,
        exit_ip: None,
        exit_verified: false,
        last_tested_at: None,
        last_error_code: None,
        last_error_detail: None,
    })
}

fn details_string(details: &Value, key: &str) -> Option<String> {
    details
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn candidate_from_link(source: &CommunitySource, node: ParsedNode) -> CommunityNodeCandidate {
    let mut config = Map::new();
    let clash_type = match node.protocol.as_str() {
        "shadowsocks" => "ss",
        other => other,
    };
    config.insert("name".into(), Value::String(node.name.clone()));
    config.insert("type".into(), Value::String(clash_type.into()));
    config.insert("server".into(), Value::String(node.host.clone()));
    config.insert("port".into(), Value::Number(node.port.into()));
    let details = &node.details;
    if node.protocol == "vless" || node.protocol == "vmess" {
        if let Some(uuid) = details_string(details, "password") {
            config.insert("uuid".into(), Value::String(uuid));
        }
    } else if let Some(password) = details_string(details, "password") {
        config.insert("password".into(), Value::String(password));
    }
    if let Some(username) = details_string(details, "username") {
        config.insert("username".into(), Value::String(username));
    }
    if let Some(cipher) =
        details_string(details, "method").or_else(|| details_string(details, "encryption"))
    {
        config.insert("cipher".into(), Value::String(cipher));
    }
    if let Some(network) = details_string(details, "network") {
        config.insert("network".into(), Value::String(network.clone()));
        if network == "ws" {
            let mut options = Map::new();
            if let Some(path) = details_string(details, "path") {
                options.insert("path".into(), Value::String(path));
            }
            if let Some(host) = details_string(details, "host") {
                options.insert("headers".into(), serde_json::json!({ "Host": host }));
            }
            if !options.is_empty() {
                config.insert("ws-opts".into(), Value::Object(options));
            }
        } else if network == "grpc" {
            if let Some(service_name) = details_string(details, "serviceName") {
                config.insert(
                    "grpc-opts".into(),
                    serde_json::json!({ "grpc-service-name": service_name }),
                );
            }
        }
    }
    if let Some(sni) = details_string(details, "sni") {
        config.insert("servername".into(), Value::String(sni));
    }
    let security = details_string(details, "security").unwrap_or_default();
    if matches!(security.as_str(), "tls" | "reality") {
        config.insert("tls".into(), Value::Bool(true));
    }
    if security == "reality" {
        let mut reality = Map::new();
        if let Some(public_key) = details_string(details, "publicKey") {
            reality.insert("public-key".into(), Value::String(public_key));
        }
        if let Some(short_id) = details_string(details, "shortId") {
            reality.insert("short-id".into(), Value::String(short_id));
        }
        if !reality.is_empty() {
            config.insert("reality-opts".into(), Value::Object(reality));
        }
    }
    if let Some(fingerprint) = details_string(details, "fingerprint") {
        config.insert("client-fingerprint".into(), Value::String(fingerprint));
    }
    if let Some(flow) = details_string(details, "flow") {
        config.insert("flow".into(), Value::String(flow));
    }
    if details
        .get("allowInsecure")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        config.insert("skip-cert-verify".into(), Value::Bool(true));
    }
    config.insert("udp".into(), Value::Bool(true));
    CommunityNodeCandidate {
        id: String::new(),
        source_ids: vec![source.id.clone()],
        original_name: node.name,
        display_name: String::new(),
        protocol: clash_type.into(),
        server: node.host,
        port: node.port,
        config: Value::Object(config),
        latency_samples: Vec::new(),
        latency_median_ms: None,
        speed_samples_kbps: Vec::new(),
        speed_median_kbps: None,
        country_code: None,
        country_name: None,
        exit_ip: None,
        exit_verified: false,
        last_tested_at: None,
        last_error_code: None,
        last_error_detail: None,
    }
}

fn parse_clash_yaml(source: &CommunitySource, text: &str) -> Option<ParseBatch> {
    let yaml: serde_yaml::Value = serde_yaml::from_str(text).ok()?;
    let proxies = yaml.get("proxies")?.as_sequence()?;
    let mut batch = ParseBatch::default();
    for (index, proxy) in proxies.iter().enumerate() {
        match serde_json::to_value(proxy)
            .map_err(|error| error.to_string())
            .and_then(|value| candidate_from_clash(source, value))
        {
            Ok(node) => batch.nodes.push(node),
            Err(error) => {
                batch.skipped += 1;
                if batch.errors.len() < 20 {
                    batch
                        .errors
                        .push(format!("第 {} 个节点：{error}", index + 1));
                }
            }
        }
    }
    Some(batch)
}

pub fn parse_subscription(source: &CommunitySource, content: &[u8]) -> ParseBatch {
    let text = match std::str::from_utf8(content) {
        Ok(text) => text.trim_start_matches('\u{feff}'),
        Err(_) => {
            return ParseBatch {
                skipped: 1,
                errors: vec!["订阅内容不是 UTF-8 文本".into()],
                ..ParseBatch::default()
            }
        }
    };
    if let Some(batch) = parse_clash_yaml(source, text) {
        return batch;
    }
    let lines = link_parser::subscription_lines(text);
    let mut batch = ParseBatch::default();
    for (index, line) in lines.into_iter().enumerate() {
        match link_parser::parse_line(&line) {
            Ok(node) => batch.nodes.push(candidate_from_link(source, node)),
            Err(error) => {
                batch.skipped += 1;
                if batch.errors.len() < 20 {
                    batch.errors.push(format!("第 {} 行：{error}", index + 1));
                }
            }
        }
    }
    if batch.nodes.is_empty() && batch.errors.is_empty() {
        batch.errors.push("订阅中没有可识别节点".into());
    }
    batch
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source() -> CommunitySource {
        CommunitySource {
            id: "source-test".into(),
            url: "https://example.com/sub".into(),
            enabled: true,
        }
    }

    #[test]
    fn parses_clash_yaml() {
        let batch = parse_subscription(
            &source(),
            br#"
proxies:
  - name: Demo
    type: vless
    server: example.com
    port: 443
    uuid: 00000000-0000-0000-0000-000000000000
    tls: true
"#,
        );
        assert_eq!(batch.nodes.len(), 1);
        assert_eq!(batch.nodes[0].original_name, "Demo");
        assert_eq!(batch.nodes[0].protocol, "vless");
    }

    #[test]
    fn parses_link_subscription() {
        let batch = parse_subscription(
            &source(),
            b"trojan://secret@example.com:443?sni=example.com#Demo",
        );
        assert_eq!(batch.nodes.len(), 1);
        assert_eq!(
            batch.nodes[0].config["password"],
            serde_json::json!("secret")
        );
    }

    #[test]
    fn invalid_nodes_are_reported_without_aborting_batch() {
        let content =
            b"trojan://secret@example.com:443#Good\ntrojan://missing-port.example.com#Bad";
        let batch = parse_subscription(&source(), content);
        assert_eq!(batch.nodes.len(), 1);
        assert_eq!(batch.skipped, 1);
        assert_eq!(batch.errors.len(), 1);
    }
}
