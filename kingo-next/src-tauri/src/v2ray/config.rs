use super::{models::V2rayNode, settings::V2raySettings};
use serde_json::{json, Map, Value};
use std::{fs, path::PathBuf};
use tauri::AppHandle;

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or_default()
}

fn optional_text(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|item| !item.is_empty())
        .map(str::to_string)
}

fn text_list(value: &Value, key: &str) -> Vec<String> {
    text(value, key)
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_string)
        .collect()
}

fn xray_stream(node: &V2rayNode) -> Value {
    let details = &node.details;
    let network = text(details, "network");
    let network = if network.is_empty() { "tcp" } else { network };
    let security = text(details, "security");
    let mut stream = Map::new();
    stream.insert("network".into(), json!(network));
    stream.insert(
        "security".into(),
        json!(if security.is_empty() {
            "none"
        } else {
            security
        }),
    );
    match network {
        "ws" => {
            let mut settings = json!({ "path": text(details, "path") });
            if let Some(host) = optional_text(details, "host") {
                settings["headers"] = json!({ "Host": host });
            }
            stream.insert("wsSettings".into(), settings);
        }
        "grpc" => {
            stream.insert(
                "grpcSettings".into(),
                json!({ "serviceName": text(details, "serviceName") }),
            );
        }
        "httpupgrade" => {
            stream.insert(
                "httpupgradeSettings".into(),
                json!({ "path": text(details, "path"), "host": text(details, "host") }),
            );
        }
        "xhttp" => {
            stream.insert(
                "xhttpSettings".into(),
                json!({ "path": text(details, "path"), "host": text(details, "host") }),
            );
        }
        _ => {}
    }
    if let Some(finalmask) = optional_text(details, "finalmask")
        .and_then(|value| serde_json::from_str::<Value>(&value).ok())
    {
        stream.insert("finalmask".into(), finalmask);
    }
    let mut tls_base = json!({
        "serverName": optional_text(details, "sni").unwrap_or_else(|| node.host.clone()),
        "allowInsecure": details.get("allowInsecure").and_then(Value::as_bool).unwrap_or(false),
        "fingerprint": optional_text(details, "fingerprint").unwrap_or_else(|| "chrome".into())
    });
    let alpn = text_list(details, "alpn");
    if !alpn.is_empty() {
        tls_base["alpn"] = json!(alpn);
    }
    if let Some(value) = optional_text(details, "echConfigList") {
        tls_base["echConfigList"] = json!(value);
    }
    if let Some(value) = optional_text(details, "verifyPeerCertByName") {
        tls_base["verifyPeerCertByName"] = json!(value);
    }
    if let Some(certificate) = optional_text(details, "cert") {
        tls_base["certificates"] = json!([{
            "certificate": certificate.lines().collect::<Vec<_>>(),
            "usage": "verify"
        }]);
        tls_base["disableSystemRoot"] = json!(true);
        tls_base["allowInsecure"] = json!(false);
    } else if let Some(sha) = optional_text(details, "certSha") {
        tls_base["pinnedPeerCertSha256"] = json!(sha);
        tls_base["allowInsecure"] = json!(false);
    }
    if security == "tls" {
        stream.insert("tlsSettings".into(), tls_base);
    } else if security == "reality" {
        stream.insert(
            "realitySettings".into(),
            json!({
                "serverName": optional_text(details, "sni").unwrap_or_else(|| node.host.clone()),
                "fingerprint": optional_text(details, "fingerprint").unwrap_or_else(|| "chrome".into()),
                "publicKey": text(details, "publicKey"),
                "shortId": text(details, "shortId"),
                "spiderX": "/"
            }),
        );
    }
    Value::Object(stream)
}

fn xray_outbound(node: &V2rayNode) -> Result<Value, String> {
    let d = &node.details;
    let mut outbound = match node.protocol.as_str() {
        "vmess" => json!({
            "protocol": "vmess",
            "settings": { "vnext": [{ "address": node.host, "port": node.port, "users": [{
                "id": text(d, "password"), "alterId": d.get("alterId").and_then(Value::as_u64).unwrap_or(0),
                "security": optional_text(d, "encryption").unwrap_or_else(|| "auto".into())
            }]}]},
            "streamSettings": xray_stream(node), "tag": "proxy"
        }),
        "vless" => json!({
            "protocol": "vless",
            "settings": { "vnext": [{ "address": node.host, "port": node.port, "users": [{
                "id": text(d, "password"), "encryption": optional_text(d, "encryption").unwrap_or_else(|| "none".into()),
                "flow": text(d, "flow")
            }]}]},
            "streamSettings": xray_stream(node), "tag": "proxy"
        }),
        "trojan" => json!({
            "protocol": "trojan", "settings": { "servers": [{ "address": node.host, "port": node.port, "password": text(d, "password") }]},
            "streamSettings": xray_stream(node), "tag": "proxy"
        }),
        "shadowsocks" => json!({
            "protocol": "shadowsocks", "settings": { "servers": [{ "address": node.host, "port": node.port, "method": text(d, "method"), "password": text(d, "password") }]}, "tag": "proxy"
        }),
        "socks" => json!({
            "protocol": "socks", "settings": { "servers": [{ "address": node.host, "port": node.port,
              "users": [{ "user": text(d, "username"), "pass": text(d, "password") }] }]}, "tag": "proxy"
        }),
        "http" => json!({
            "protocol": "http", "settings": { "servers": [{ "address": node.host, "port": node.port,
              "users": [{ "user": text(d, "username"), "pass": text(d, "password") }] }]}, "tag": "proxy"
        }),
        protocol => return Err(format!("Xray 暂不支持 {protocol} 节点，请改用 sing-box")),
    };
    if d.get("muxEnabled")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        outbound["mux"] = json!({ "enabled": true });
    }
    Ok(outbound)
}

fn singbox_tls(node: &V2rayNode) -> Option<Value> {
    let d = &node.details;
    let security = text(d, "security");
    if !matches!(security, "tls" | "reality") {
        return None;
    }
    let mut tls = json!({
        "enabled": true,
        "server_name": optional_text(d, "sni").unwrap_or_else(|| node.host.clone()),
        "insecure": d.get("allowInsecure").and_then(Value::as_bool).unwrap_or(false),
        "utls": { "enabled": true, "fingerprint": optional_text(d, "fingerprint").unwrap_or_else(|| "chrome".into()) }
    });
    let alpn = text_list(d, "alpn");
    if !alpn.is_empty() {
        tls["alpn"] = json!(alpn);
    }
    if let Some(certificate) = optional_text(d, "cert") {
        tls["certificate"] = json!([certificate]);
        tls["insecure"] = json!(false);
    }
    if security == "reality" {
        tls["reality"] = json!({ "enabled": true, "public_key": text(d, "publicKey"), "short_id": text(d, "shortId") });
    }
    Some(tls)
}

fn singbox_transport(node: &V2rayNode) -> Option<Value> {
    let d = &node.details;
    match text(d, "network") {
        "ws" => Some(
            json!({ "type": "ws", "path": text(d, "path"), "headers": { "Host": text(d, "host") } }),
        ),
        "grpc" => Some(json!({ "type": "grpc", "service_name": text(d, "serviceName") })),
        "httpupgrade" => {
            Some(json!({ "type": "httpupgrade", "path": text(d, "path"), "host": text(d, "host") }))
        }
        _ => None,
    }
}

fn singbox_outbound(node: &V2rayNode) -> Result<Value, String> {
    let d = &node.details;
    let mut outbound = match node.protocol.as_str() {
        "vmess" => {
            json!({ "type": "vmess", "tag": "proxy", "server": node.host, "server_port": node.port, "uuid": text(d, "password"), "security": optional_text(d, "encryption").unwrap_or_else(|| "auto".into()), "alter_id": d.get("alterId").and_then(Value::as_u64).unwrap_or(0) })
        }
        "vless" => {
            json!({ "type": "vless", "tag": "proxy", "server": node.host, "server_port": node.port, "uuid": text(d, "password"), "flow": text(d, "flow") })
        }
        "trojan" => {
            json!({ "type": "trojan", "tag": "proxy", "server": node.host, "server_port": node.port, "password": text(d, "password") })
        }
        "shadowsocks" => {
            json!({ "type": "shadowsocks", "tag": "proxy", "server": node.host, "server_port": node.port, "method": text(d, "method"), "password": text(d, "password") })
        }
        "socks" => {
            json!({ "type": "socks", "tag": "proxy", "server": node.host, "server_port": node.port, "username": text(d, "username"), "password": text(d, "password") })
        }
        "http" => {
            json!({ "type": "http", "tag": "proxy", "server": node.host, "server_port": node.port, "username": text(d, "username"), "password": text(d, "password") })
        }
        "hysteria2" => {
            json!({ "type": "hysteria2", "tag": "proxy", "server": node.host, "server_port": node.port, "password": text(d, "password") })
        }
        "tuic" => {
            json!({ "type": "tuic", "tag": "proxy", "server": node.host, "server_port": node.port, "uuid": text(d, "username"), "password": text(d, "password"), "congestion_control": "bbr" })
        }
        "anytls" => {
            json!({ "type": "anytls", "tag": "proxy", "server": node.host, "server_port": node.port, "password": text(d, "password") })
        }
        protocol => return Err(format!("sing-box 暂不支持 {protocol} 节点")),
    };
    if let Some(tls) = singbox_tls(node) {
        outbound["tls"] = tls;
    }
    if let Some(transport) = singbox_transport(node) {
        outbound["transport"] = transport;
    }
    if d.get("muxEnabled")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        outbound["multiplex"] = json!({ "enabled": true });
    }
    Ok(outbound)
}

fn generate_with_settings(
    app: &AppHandle,
    node: &V2rayNode,
    port: u16,
    suffix: &str,
    settings: &V2raySettings,
) -> Result<(String, u16), String> {
    let listen = if settings.allow_lan {
        "0.0.0.0"
    } else {
        "127.0.0.1"
    };
    let final_outbound = if settings.routing_mode == "direct" {
        "direct"
    } else {
        "proxy"
    };
    // Keep the same practical ordering as v2rayN's built-in whitelist mode:
    // disable QUIC so desktop apps fall back to proxyable TCP, bypass private
    // and mainland destinations, then let the final outbound use the node.
    let mut xray_rules =
        vec![json!({ "type": "field", "network": "udp", "port": "443", "outboundTag": "block" })];
    if settings.bypass_lan {
        xray_rules
            .push(json!({ "type": "field", "ip": ["geoip:private"], "outboundTag": "direct" }));
        xray_rules.push(
            json!({ "type": "field", "domain": ["geosite:private"], "outboundTag": "direct" }),
        );
    }
    if settings.routing_mode == "bypass-cn" {
        xray_rules
            .push(json!({ "type": "field", "domain": ["geosite:cn"], "outboundTag": "direct" }));
        xray_rules.push(json!({ "type": "field", "ip": ["geoip:cn"], "outboundTag": "direct" }));
    } else if settings.routing_mode == "direct" {
        xray_rules.push(json!({ "type": "field", "network": "tcp,udp", "outboundTag": "direct" }));
    }
    let mut singbox_rules = vec![json!({ "network": "udp", "port": 443, "outbound": "block" })];
    if settings.bypass_lan {
        singbox_rules.push(json!({ "ip_is_private": true, "outbound": "direct" }));
    }
    if settings.routing_mode == "bypass-cn" {
        singbox_rules.push(json!({ "domain_suffix": [".cn"], "outbound": "direct" }));
    }
    let singbox_log_level = if settings.log_level == "warning" {
        "warn"
    } else {
        settings.log_level.as_str()
    };
    let mut singbox_inbounds =
        vec![json!({ "type": "mixed", "tag": "mixed-in", "listen": listen, "listen_port": port })];
    if settings.tun_enabled {
        let mut addresses = vec!["172.18.0.1/30"];
        if settings.tun_ipv6 {
            addresses.push("fdfe:dcba:9876::1/126");
        }
        singbox_inbounds.push(json!({
            "type": "tun",
            "tag": "tun-in",
            "interface_name": "kingo_tun",
            "address": addresses,
            "mtu": settings.tun_mtu,
            "auto_route": true,
            "strict_route": settings.tun_strict_route,
            "stack": settings.tun_stack,
            "route_exclude_address": settings.tun_route_exclude
        }));
        singbox_rules.insert(0, json!({ "inbound": ["tun-in"], "action": "sniff" }));
    }
    let config = if node.core_id == "sing-box" {
        json!({
            "log": { "level": singbox_log_level, "timestamp": true },
            "inbounds": singbox_inbounds,
            "outbounds": [singbox_outbound(node)?, { "type": "direct", "tag": "direct" }, { "type": "block", "tag": "block" }],
            "route": { "rules": singbox_rules, "final": final_outbound, "auto_detect_interface": true }
        })
    } else {
        json!({
            "log": { "loglevel": settings.log_level },
            "inbounds": [{
                "listen": listen,
                "port": port,
                "protocol": "socks",
                "settings": { "udp": true },
                "sniffing": { "enabled": true, "destOverride": ["http", "tls", "quic"], "routeOnly": false },
                "tag": "socks-in"
            }],
            "outbounds": [xray_outbound(node)?, { "protocol": "freedom", "tag": "direct" }, { "protocol": "blackhole", "tag": "block" }],
            "routing": { "domainStrategy": "IPIfNonMatch", "rules": xray_rules }
        })
    };
    let directory = PathBuf::from(crate::paths::ensure(app)?.data_dir)
        .join("runtime")
        .join("v2ray");
    fs::create_dir_all(&directory).map_err(|error| format!("创建 V2ray 运行目录失败：{error}"))?;
    let safe_suffix = suffix
        .chars()
        .filter(|value| value.is_ascii_alphanumeric() || *value == '-')
        .collect::<String>();
    let path = directory.join(format!("{}-{}.json", node.core_id, safe_suffix));
    let temporary = path.with_extension("json.tmp");
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(&config).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("写入 V2ray 配置失败：{error}"))?;
    if path.exists() {
        fs::remove_file(&path).map_err(|error| format!("替换旧 V2ray 配置失败：{error}"))?;
    }
    fs::rename(&temporary, &path).map_err(|error| format!("提交 V2ray 配置失败：{error}"))?;
    Ok((path.to_string_lossy().into_owned(), port))
}

pub fn generate_for_port(
    app: &AppHandle,
    node: &V2rayNode,
    port: u16,
    suffix: &str,
) -> Result<(String, u16), String> {
    let settings = V2raySettings {
        local_port: port,
        allow_lan: false,
        system_proxy: false,
        routing_mode: "global".into(),
        ..V2raySettings::default()
    };
    generate_with_settings(app, node, port, suffix, &settings)
}

pub fn generate(app: &AppHandle, node: &V2rayNode) -> Result<(String, u16), String> {
    let settings = super::settings::load(app);
    generate_with_settings(app, node, settings.local_port, "active", &settings)
}
