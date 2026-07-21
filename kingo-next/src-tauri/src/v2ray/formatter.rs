use super::models::V2rayNode;
use base64::{engine::general_purpose, Engine as _};
use percent_encoding::{utf8_percent_encode, AsciiSet, CONTROLS};
use serde_json::{json, Value};

fn text(node: &V2rayNode, key: &str) -> String {
    node.details
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn flag(node: &V2rayNode, key: &str) -> bool {
    node.details
        .get(key)
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

const URL_VALUE: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'%')
    .add(b'&')
    .add(b'+')
    .add(b'/')
    .add(b'<')
    .add(b'=')
    .add(b'>')
    .add(b'?')
    .add(b'@')
    .add(b'[')
    .add(b'\\')
    .add(b']')
    .add(b'^')
    .add(b'`')
    .add(b'{')
    .add(b'|')
    .add(b'}');

fn encoded(value: &str) -> String {
    utf8_percent_encode(value, URL_VALUE).to_string()
}

fn authority_host(host: &str) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host.to_string()
    }
}

fn add_query(query: &mut Vec<String>, key: &str, value: impl AsRef<str>) {
    let value = value.as_ref();
    if !value.is_empty() {
        query.push(format!("{key}={}", encoded(value)));
    }
}

fn common_url(node: &V2rayNode, scheme: &str, credential: String) -> String {
    let mut query = Vec::new();
    add_query(&mut query, "type", text(node, "network"));
    add_query(&mut query, "security", text(node, "security"));
    add_query(&mut query, "encryption", text(node, "encryption"));
    add_query(&mut query, "flow", text(node, "flow"));
    add_query(&mut query, "sni", text(node, "sni"));
    add_query(&mut query, "fp", text(node, "fingerprint"));
    add_query(&mut query, "host", text(node, "host"));
    add_query(&mut query, "path", text(node, "path"));
    add_query(&mut query, "serviceName", text(node, "serviceName"));
    add_query(&mut query, "pbk", text(node, "publicKey"));
    add_query(&mut query, "sid", text(node, "shortId"));
    add_query(&mut query, "spx", text(node, "spiderX"));
    add_query(&mut query, "alpn", text(node, "alpn"));
    if flag(node, "allowInsecure") {
        query.push("allowInsecure=1".into());
    }
    let suffix = if query.is_empty() {
        String::new()
    } else {
        format!("?{}", query.join("&"))
    };
    format!(
        "{scheme}://{}@{}:{}{suffix}#{}",
        encoded(&credential),
        authority_host(&node.host),
        node.port,
        encoded(&node.name)
    )
}

pub fn share_link(node: &V2rayNode) -> Result<String, String> {
    match node.protocol.as_str() {
        "vmess" => {
            let value = json!({
                "v": "2",
                "ps": node.name,
                "add": node.host,
                "port": node.port.to_string(),
                "id": text(node, "password"),
                "aid": node.details.get("alterId").and_then(Value::as_i64).unwrap_or(0).to_string(),
                "scy": text(node, "encryption"),
                "net": text(node, "network"),
                "type": "none",
                "host": text(node, "host"),
                "path": text(node, "path"),
                "tls": text(node, "security"),
                "sni": text(node, "sni"),
                "fp": text(node, "fingerprint")
            });
            Ok(format!(
                "vmess://{}",
                general_purpose::STANDARD.encode(value.to_string())
            ))
        }
        "shadowsocks" => {
            let user = format!("{}:{}", text(node, "method"), text(node, "password"));
            Ok(format!(
                "ss://{}@{}:{}#{}",
                general_purpose::STANDARD_NO_PAD.encode(user),
                authority_host(&node.host),
                node.port,
                encoded(&node.name)
            ))
        }
        "socks" | "http" => {
            let username = text(node, "username");
            let password = text(node, "password");
            let credential = if username.is_empty() {
                password
            } else {
                format!("{username}:{password}")
            };
            Ok(common_url(node, &node.protocol, credential))
        }
        "tuic" => Ok(common_url(
            node,
            "tuic",
            format!("{}:{}", text(node, "username"), text(node, "password")),
        )),
        "vless" | "trojan" | "hysteria2" | "anytls" => {
            Ok(common_url(node, &node.protocol, text(node, "password")))
        }
        protocol => Err(format!("暂不支持导出 {protocol} 节点")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vless_node() -> V2rayNode {
        V2rayNode {
            id: "node-1".into(),
            subscription_id: None,
            name: "KiNGO QR-Test".into(),
            protocol: "vless".into(),
            host: "example.com".into(),
            port: 443,
            core_id: "xray".into(),
            raw_url: String::new(),
            details: json!({
                "password": "11111111-1111-4111-8111-111111111111",
                "network": "ws",
                "security": "tls",
                "host": "example.com",
                "path": "/test"
            }),
            sort: 0,
            active: false,
            delay: None,
            speed: None,
            ip_info: None,
            test_message: None,
            last_tested_at: None,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn keeps_url_unreserved_characters_in_share_link() {
        let link = share_link(&vless_node()).expect("share link");
        assert!(link.contains("11111111-1111-4111-8111-111111111111@example.com:443"));
        assert!(link.contains("host=example.com"));
        assert!(link.ends_with("#KiNGO%20QR-Test"));
    }
}
