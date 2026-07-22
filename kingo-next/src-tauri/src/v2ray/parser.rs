use super::models::ParsedNode;
use base64::{engine::general_purpose, Engine as _};
use percent_encoding::percent_decode_str;
use serde_json::{json, Value};
use url::Url;

fn decode_base64(value: &str) -> Result<Vec<u8>, String> {
    let cleaned = value.trim().replace(['\r', '\n', ' '], "");
    for engine in [
        &general_purpose::STANDARD,
        &general_purpose::STANDARD_NO_PAD,
        &general_purpose::URL_SAFE,
        &general_purpose::URL_SAFE_NO_PAD,
    ] {
        if let Ok(bytes) = engine.decode(&cleaned) {
            return Ok(bytes);
        }
    }
    Err("Base64 内容无效".into())
}

fn decoded_text(value: &str) -> Result<String, String> {
    String::from_utf8(decode_base64(value)?).map_err(|_| "Base64 内容不是 UTF-8 文本".into())
}

fn query(url: &Url, key: &str) -> Option<String> {
    url.query_pairs()
        .find(|(name, _)| name == key)
        .map(|(_, value)| value.into_owned())
        .filter(|value| !value.is_empty())
}

fn decoded_fragment(value: &str) -> String {
    percent_decode_str(value).decode_utf8_lossy().into_owned()
}

fn parse_url_node(raw: &str) -> Result<ParsedNode, String> {
    let url = Url::parse(raw).map_err(|error| format!("链接格式错误：{error}"))?;
    let protocol = url.scheme().to_ascii_lowercase();
    let supported = [
        "vless",
        "trojan",
        "socks",
        "socks5",
        "http",
        "https",
        "hysteria2",
        "hy2",
        "tuic",
        "anytls",
    ];
    if !supported.contains(&protocol.as_str()) {
        return Err(format!("暂不支持 {protocol} 链接"));
    }
    let host = url.host_str().ok_or("链接缺少服务器地址")?.to_string();
    let port = url.port().ok_or("链接缺少有效端口")?;
    let name = url
        .fragment()
        .map(decoded_fragment)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| format!("{} {}:{}", protocol.to_uppercase(), host, port));
    let username = url.username().to_string();
    let password = match protocol.as_str() {
        "vless" | "trojan" | "hysteria2" | "hy2" | "anytls" => username.clone(),
        _ => url.password().unwrap_or_default().to_string(),
    };
    let normalized = match protocol.as_str() {
        "socks5" => "socks",
        "https" => "http",
        "hy2" => "hysteria2",
        other => other,
    };
    Ok(ParsedNode {
        name,
        protocol: normalized.into(),
        host,
        port,
        raw_url: raw.into(),
        details: json!({
            "password": password,
            "username": username,
            "network": query(&url, "type").unwrap_or_else(|| "tcp".into()),
            "security": query(&url, "security").unwrap_or_else(|| if protocol == "https" { "tls".into() } else { "none".into() }),
            "encryption": query(&url, "encryption").unwrap_or_else(|| "none".into()),
            "flow": query(&url, "flow"),
            "sni": query(&url, "sni"),
            "fingerprint": query(&url, "fp"),
            "publicKey": query(&url, "pbk"),
            "shortId": query(&url, "sid"),
            "path": query(&url, "path"),
            "host": query(&url, "host"),
            "serviceName": query(&url, "serviceName"),
            "allowInsecure": query(&url, "allowInsecure").is_some_and(|value| value == "1" || value.eq_ignore_ascii_case("true")),
        }),
    })
}

fn parse_vmess(raw: &str) -> Result<ParsedNode, String> {
    let encoded = raw.strip_prefix("vmess://").ok_or("VMess 链接无效")?;
    let text = decoded_text(encoded)?;
    let value: Value =
        serde_json::from_str(&text).map_err(|error| format!("VMess JSON 无效：{error}"))?;
    let host = value
        .get("add")
        .and_then(Value::as_str)
        .ok_or("VMess 缺少地址")?
        .to_string();
    let port = value
        .get("port")
        .and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))
        .filter(|value| *value > 0 && *value <= u16::MAX as u64)
        .ok_or("VMess 端口无效")? as u16;
    let name = value
        .get("ps")
        .and_then(Value::as_str)
        .unwrap_or("VMess 节点")
        .to_string();
    Ok(ParsedNode {
        name,
        protocol: "vmess".into(),
        host,
        port,
        raw_url: raw.into(),
        details: json!({
            "password": value.get("id").and_then(Value::as_str).unwrap_or_default(),
            "alterId": value.get("aid").and_then(|v| v.as_u64().or_else(|| v.as_str()?.parse().ok())).unwrap_or(0),
            "encryption": value.get("scy").and_then(Value::as_str).unwrap_or("auto"),
            "network": value.get("net").and_then(Value::as_str).unwrap_or("tcp"),
            "security": value.get("tls").and_then(Value::as_str).filter(|v| !v.is_empty()).unwrap_or("none"),
            "sni": value.get("sni").and_then(Value::as_str),
            "fingerprint": value.get("fp").and_then(Value::as_str),
            "path": value.get("path").and_then(Value::as_str),
            "host": value.get("host").and_then(Value::as_str),
            "serviceName": value.get("path").and_then(Value::as_str),
        }),
    })
}

fn parse_ss(raw: &str) -> Result<ParsedNode, String> {
    let body = raw.strip_prefix("ss://").ok_or("Shadowsocks 链接无效")?;
    let (without_fragment, fragment) = body
        .split_once('#')
        .map_or((body, None), |(a, b)| (a, Some(b)));
    let value = if without_fragment.contains('@') {
        without_fragment.to_string()
    } else {
        decoded_text(without_fragment)?
    };
    let (credentials, server) = value.rsplit_once('@').ok_or("Shadowsocks 链接缺少服务器")?;
    let credentials = if credentials.contains(':') {
        credentials.to_string()
    } else {
        decoded_text(credentials)?
    };
    let (method, password) = credentials
        .split_once(':')
        .ok_or("Shadowsocks 认证信息无效")?;
    let server_url =
        Url::parse(&format!("socks://{server}")).map_err(|_| "Shadowsocks 地址无效")?;
    let host = server_url
        .host_str()
        .ok_or("Shadowsocks 缺少地址")?
        .to_string();
    let port = server_url.port().ok_or("Shadowsocks 端口无效")?;
    Ok(ParsedNode {
        name: fragment
            .filter(|v| !v.is_empty())
            .map(decoded_fragment)
            .unwrap_or_else(|| "Shadowsocks 节点".to_string()),
        protocol: "shadowsocks".into(),
        host,
        port,
        raw_url: raw.into(),
        details: json!({ "method": method, "password": password, "network": "tcp", "security": "none" }),
    })
}

pub fn parse_line(raw: &str) -> Result<ParsedNode, String> {
    let value = raw.trim();
    if value.starts_with("vmess://") {
        parse_vmess(value)
    } else if value.starts_with("ss://") {
        parse_ss(value)
    } else {
        parse_url_node(value)
    }
}

pub fn subscription_lines(content: &str) -> Vec<String> {
    let trimmed = content.trim();
    let decoded = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        decoded_text(trimmed).unwrap_or_else(|_| trimmed.to_string())
    };
    decoded
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(str::to_string)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_vless() {
        let node = parse_line("vless://00000000-0000-0000-0000-000000000000@example.com:443?security=tls&type=ws&path=%2Fws#demo").unwrap();
        assert_eq!(node.protocol, "vless");
        assert_eq!(node.name, "demo");
        assert_eq!(node.port, 443);
    }

    #[test]
    fn decodes_url_fragment_name() {
        let node = parse_line("vless://00000000-0000-0000-0000-000000000000@example.com:443#%E7%BC%96%E8%BE%91%E5%99%A8%E6%B5%8B%E8%AF%95").unwrap();
        assert_eq!(node.name, "编辑器测试");
    }

    #[test]
    fn rejects_missing_port() {
        assert!(parse_line("trojan://secret@example.com#bad").is_err());
    }
}
