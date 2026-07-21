use super::models::{ParsedNode, V2rayNode, V2raySubscription};
use crate::paths;
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::AppHandle;

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn new_id(prefix: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!(
        "{prefix}-{nanos}-{}",
        NEXT_ID.fetch_add(1, Ordering::Relaxed)
    )
}

fn connection(app: &AppHandle) -> Result<Connection, String> {
    let path = std::path::PathBuf::from(paths::ensure(app)?.data_dir).join("v2ray.db");
    let connection =
        Connection::open(path).map_err(|error| format!("打开 V2ray 数据库失败：{error}"))?;
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS v2ray_subscriptions (
               id TEXT PRIMARY KEY,
               name TEXT NOT NULL,
               url TEXT NOT NULL,
               enabled INTEGER NOT NULL DEFAULT 1,
               user_agent TEXT NOT NULL DEFAULT 'v2rayN/7',
               filter TEXT,
               sort INTEGER NOT NULL DEFAULT 0,
               updated_at INTEGER,
               last_error TEXT
             );
             CREATE TABLE IF NOT EXISTS v2ray_nodes (
               id TEXT PRIMARY KEY,
               subscription_id TEXT REFERENCES v2ray_subscriptions(id) ON DELETE CASCADE,
               name TEXT NOT NULL,
               protocol TEXT NOT NULL,
               host TEXT NOT NULL,
               port INTEGER NOT NULL,
               core_id TEXT NOT NULL DEFAULT 'xray',
               raw_url TEXT NOT NULL,
               details TEXT NOT NULL,
               sort INTEGER NOT NULL DEFAULT 0,
               active INTEGER NOT NULL DEFAULT 0,
               created_at INTEGER NOT NULL,
               updated_at INTEGER NOT NULL,
               UNIQUE(subscription_id, raw_url)
             );
             CREATE TABLE IF NOT EXISTS v2ray_node_metrics (
               node_id TEXT PRIMARY KEY REFERENCES v2ray_nodes(id) ON DELETE CASCADE,
               delay INTEGER,
               speed INTEGER,
               ip_info TEXT,
               test_message TEXT,
               last_tested_at INTEGER
             );
             CREATE INDEX IF NOT EXISTS idx_v2ray_nodes_subscription ON v2ray_nodes(subscription_id, sort);
             CREATE INDEX IF NOT EXISTS idx_v2ray_nodes_active ON v2ray_nodes(active);",
        )
        .map_err(|error| format!("初始化 V2ray 数据库失败：{error}"))?;
    Ok(connection)
}

fn node_from_row(row: &Row<'_>) -> rusqlite::Result<V2rayNode> {
    let details: String = row.get(8)?;
    Ok(V2rayNode {
        id: row.get(0)?,
        subscription_id: row.get(1)?,
        name: row.get(2)?,
        protocol: row.get(3)?,
        host: row.get(4)?,
        port: row.get::<_, u16>(5)?,
        core_id: row.get(6)?,
        raw_url: row.get(7)?,
        details: serde_json::from_str(&details).unwrap_or(serde_json::Value::Null),
        sort: row.get(9)?,
        active: row.get::<_, i64>(10)? != 0,
        delay: row.get(11)?,
        speed: row.get(12)?,
        ip_info: row.get(13)?,
        test_message: row.get(14)?,
        last_tested_at: row.get(15)?,
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
    })
}

const NODE_SELECT: &str =
    "SELECT n.id,n.subscription_id,n.name,n.protocol,n.host,n.port,n.core_id,n.raw_url,n.details,n.sort,n.active,
            m.delay,m.speed,m.ip_info,m.test_message,m.last_tested_at,n.created_at,n.updated_at
       FROM v2ray_nodes n LEFT JOIN v2ray_node_metrics m ON m.node_id=n.id";

pub fn list_nodes(
    app: &AppHandle,
    subscription_id: Option<&str>,
) -> Result<Vec<V2rayNode>, String> {
    let connection = connection(app)?;
    let (sql, parameter) = if let Some(id) = subscription_id {
        (
            format!("{NODE_SELECT} WHERE n.subscription_id=?1 ORDER BY n.sort,n.created_at"),
            Some(id),
        )
    } else {
        (format!("{NODE_SELECT} ORDER BY n.sort,n.created_at"), None)
    };
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| error.to_string())?;
    let rows = if let Some(value) = parameter {
        statement.query_map([value], node_from_row)
    } else {
        statement.query_map([], node_from_row)
    }
    .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

pub fn get_node(app: &AppHandle, node_id: &str) -> Result<V2rayNode, String> {
    let connection = connection(app)?;
    connection
        .query_row(
            &format!("{NODE_SELECT} WHERE n.id=?1"),
            [node_id],
            node_from_row,
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "V2ray 节点不存在".into())
}

fn insert_node(
    tx: &Transaction<'_>,
    parsed: &ParsedNode,
    subscription_id: Option<&str>,
    sort: i64,
) -> Result<Option<String>, String> {
    let id = new_id("node");
    let timestamp = now();
    let changed = tx
        .execute(
            "INSERT INTO v2ray_nodes(id,subscription_id,name,protocol,host,port,core_id,raw_url,details,sort,created_at,updated_at)
             SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11
              WHERE NOT EXISTS (
                SELECT 1 FROM v2ray_nodes
                 WHERE COALESCE(subscription_id,'')=COALESCE(?2,'') AND raw_url=?8
              )",
            params![id, subscription_id, parsed.name, parsed.protocol, parsed.host, parsed.port, preferred_core(&parsed.protocol), parsed.raw_url, parsed.details.to_string(), sort, timestamp],
        )
        .map_err(|error| format!("保存节点失败：{error}"))?;
    Ok((changed > 0).then_some(id))
}

fn preferred_core(protocol: &str) -> &'static str {
    match protocol {
        "hysteria2" | "tuic" | "anytls" | "wireguard" | "naive" => "sing-box",
        _ => "xray",
    }
}

pub fn import_nodes(
    app: &AppHandle,
    parsed: &[ParsedNode],
    subscription_id: Option<&str>,
) -> Result<Vec<String>, String> {
    let mut connection = connection(app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let start: i64 = transaction
        .query_row(
            "SELECT COALESCE(MAX(sort),0)+1 FROM v2ray_nodes",
            [],
            |row| row.get(0),
        )
        .unwrap_or(1);
    let mut ids = Vec::new();
    for (index, node) in parsed.iter().enumerate() {
        if let Some(id) = insert_node(&transaction, node, subscription_id, start + index as i64)? {
            ids.push(id);
        }
    }
    transaction.commit().map_err(|error| error.to_string())?;
    ensure_active(app)?;
    Ok(ids)
}

pub fn create_node(
    app: &AppHandle,
    input: &super::models::NodeUpdateInput,
) -> Result<V2rayNode, String> {
    let parsed = ParsedNode {
        name: input.name.trim().to_string(),
        protocol: input.protocol.trim().to_ascii_lowercase(),
        host: input.host.trim().to_string(),
        port: input.port,
        raw_url: format!("manual:{}", new_id("source")),
        details: input.details.clone(),
    };
    let ids = import_nodes(app, &[parsed], None)?;
    let id = ids.first().ok_or("创建节点失败")?;
    match update_node(app, id, input) {
        Ok(node) => Ok(node),
        Err(error) => {
            let _ = delete_nodes(app, std::slice::from_ref(id));
            Err(error)
        }
    }
}

pub fn replace_subscription_nodes(
    app: &AppHandle,
    subscription_id: &str,
    parsed: &[ParsedNode],
) -> Result<Vec<String>, String> {
    let mut connection = connection(app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let active_raw_url = transaction
        .query_row(
            "SELECT raw_url FROM v2ray_nodes WHERE subscription_id=?1 AND active=1 LIMIT 1",
            [subscription_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "DELETE FROM v2ray_nodes WHERE subscription_id=?1",
            [subscription_id],
        )
        .map_err(|error| error.to_string())?;
    let mut ids = Vec::new();
    let mut restored_active_id = None;
    for (index, node) in parsed.iter().enumerate() {
        if let Some(id) = insert_node(&transaction, node, Some(subscription_id), index as i64)? {
            if active_raw_url.as_deref() == Some(node.raw_url.as_str()) {
                restored_active_id = Some(id.clone());
            }
            ids.push(id);
        }
    }
    if let Some(active_id) = restored_active_id {
        transaction
            .execute(
                "UPDATE v2ray_nodes SET active=CASE WHEN id=?1 THEN 1 ELSE 0 END",
                [active_id],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction
        .execute(
            "UPDATE v2ray_subscriptions SET updated_at=?2,last_error=NULL WHERE id=?1",
            params![subscription_id, now()],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    ensure_active(app)?;
    Ok(ids)
}

fn ensure_active(app: &AppHandle) -> Result<(), String> {
    let connection = connection(app)?;
    let active: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM v2ray_nodes WHERE active=1",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    if active == 0 {
        connection
            .execute(
                "UPDATE v2ray_nodes SET active=1 WHERE id=(SELECT id FROM v2ray_nodes ORDER BY sort,created_at LIMIT 1)",
                [],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn delete_nodes(app: &AppHandle, ids: &[String]) -> Result<usize, String> {
    let mut connection = connection(app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let mut deleted = 0;
    for id in ids {
        deleted += transaction
            .execute("DELETE FROM v2ray_nodes WHERE id=?1", [id])
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())?;
    ensure_active(app)?;
    Ok(deleted)
}

pub fn set_active(app: &AppHandle, node_id: &str) -> Result<V2rayNode, String> {
    let mut connection = connection(app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    if transaction
        .query_row(
            "SELECT COUNT(*) FROM v2ray_nodes WHERE id=?1",
            [node_id],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
        == 0
    {
        return Err("V2ray 节点不存在".into());
    }
    transaction
        .execute("UPDATE v2ray_nodes SET active=0", [])
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "UPDATE v2ray_nodes SET active=1,updated_at=?2 WHERE id=?1",
            params![node_id, now()],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    get_node(app, node_id)
}

pub fn update_node(
    app: &AppHandle,
    node_id: &str,
    input: &super::models::NodeUpdateInput,
) -> Result<V2rayNode, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("节点名称不能为空".into());
    }
    if !matches!(input.core_id.as_str(), "xray" | "sing-box") {
        return Err("节点核心只能选择 Xray 或 sing-box".into());
    }
    let protocol = input.protocol.trim().to_ascii_lowercase();
    if !matches!(
        protocol.as_str(),
        "vmess"
            | "vless"
            | "trojan"
            | "shadowsocks"
            | "socks"
            | "http"
            | "hysteria2"
            | "tuic"
            | "anytls"
    ) {
        return Err("不支持的节点协议".into());
    }
    let host = input.host.trim();
    if host.is_empty() {
        return Err("服务器地址不能为空".into());
    }
    if input.port == 0 {
        return Err("服务器端口必须在 1 到 65535 之间".into());
    }
    if !input.details.is_object() {
        return Err("节点扩展配置格式无效".into());
    }
    let details = serde_json::to_string(&input.details).map_err(|error| error.to_string())?;
    if details.len() > 65_536 {
        return Err("节点扩展配置过大".into());
    }
    if input.core_id == "xray"
        && !matches!(
            protocol.as_str(),
            "vmess" | "vless" | "trojan" | "shadowsocks" | "socks" | "http"
        )
    {
        return Err(format!("{protocol} 节点需要使用 sing-box 核心"));
    }
    let changed = connection(app)?
        .execute(
            "UPDATE v2ray_nodes
                SET name=?2,protocol=?3,host=?4,port=?5,core_id=?6,details=?7,updated_at=?8
              WHERE id=?1",
            params![
                node_id,
                name,
                protocol,
                host,
                input.port,
                input.core_id,
                details,
                now()
            ],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("V2ray 节点不存在".into());
    }
    get_node(app, node_id)
}

pub fn move_nodes(
    app: &AppHandle,
    ids: &[String],
    direction: &str,
) -> Result<Vec<V2rayNode>, String> {
    if ids.is_empty() {
        return list_nodes(app, None);
    }
    let mut nodes = list_nodes(app, None)?;
    match direction {
        "top" => nodes.sort_by_key(|node| (!ids.contains(&node.id), node.sort)),
        "bottom" => nodes.sort_by_key(|node| (ids.contains(&node.id), node.sort)),
        "up" => {
            for index in 1..nodes.len() {
                if ids.contains(&nodes[index].id) && !ids.contains(&nodes[index - 1].id) {
                    nodes.swap(index - 1, index);
                }
            }
        }
        "down" => {
            for index in (0..nodes.len().saturating_sub(1)).rev() {
                if ids.contains(&nodes[index].id) && !ids.contains(&nodes[index + 1].id) {
                    nodes.swap(index, index + 1);
                }
            }
        }
        _ => return Err("未知的节点移动方向".into()),
    }
    let mut connection = connection(app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    for (index, node) in nodes.iter().enumerate() {
        transaction
            .execute(
                "UPDATE v2ray_nodes SET sort=?2 WHERE id=?1",
                params![node.id, index as i64],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())?;
    list_nodes(app, None)
}

pub fn reorder_nodes(app: &AppHandle, ids: &[String]) -> Result<Vec<V2rayNode>, String> {
    let current = list_nodes(app, None)?;
    if ids.len() != current.len() || current.iter().any(|node| !ids.contains(&node.id)) {
        return Err("节点顺序与当前列表不一致，请刷新后重试".into());
    }
    let mut connection = connection(app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    for (index, id) in ids.iter().enumerate() {
        transaction
            .execute(
                "UPDATE v2ray_nodes SET sort=?2 WHERE id=?1",
                params![id, index as i64],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())?;
    list_nodes(app, None)
}

pub fn sort_nodes(app: &AppHandle, by: &str) -> Result<Vec<V2rayNode>, String> {
    let mut nodes = list_nodes(app, None)?;
    match by {
        "name" => nodes.sort_by_key(|node| node.name.to_lowercase()),
        "protocol" => nodes.sort_by_key(|node| (node.protocol.clone(), node.name.to_lowercase())),
        "delay" => nodes.sort_by_key(|node| (node.delay.is_none(), node.delay.unwrap_or(u32::MAX))),
        "subscription" => {
            nodes.sort_by_key(|node| (node.subscription_id.clone(), node.name.to_lowercase()))
        }
        _ => return Err("未知的节点排序方式".into()),
    }
    let ids = nodes.into_iter().map(|node| node.id).collect::<Vec<_>>();
    reorder_nodes(app, &ids)
}

pub fn duplicate_node(app: &AppHandle, node_id: &str) -> Result<V2rayNode, String> {
    let node = get_node(app, node_id)?;
    let parsed = ParsedNode {
        name: format!("{} - 副本", node.name),
        protocol: node.protocol.clone(),
        host: node.host.clone(),
        port: node.port,
        raw_url: format!("manual-copy:{}:{}", node.id, now()),
        details: node.details.clone(),
    };
    let ids = import_nodes(app, &[parsed], None)?;
    let id = ids.first().ok_or("复制节点失败")?;
    let input = super::models::NodeUpdateInput {
        name: format!("{} - 副本", node.name),
        protocol: node.protocol,
        host: node.host,
        port: node.port,
        core_id: node.core_id,
        details: node.details,
    };
    update_node(app, id, &input)
}

pub fn move_node_group(
    app: &AppHandle,
    node_id: &str,
    subscription_id: Option<&str>,
) -> Result<V2rayNode, String> {
    if let Some(id) = subscription_id {
        get_subscription(app, id)?;
    }
    let changed = connection(app)?
        .execute(
            "UPDATE v2ray_nodes SET subscription_id=?2,updated_at=?3 WHERE id=?1",
            params![node_id, subscription_id, now()],
        )
        .map_err(|error| format!("移动节点失败：{error}"))?;
    if changed == 0 {
        return Err("V2ray 节点不存在".into());
    }
    get_node(app, node_id)
}

pub fn remove_duplicates(app: &AppHandle) -> Result<usize, String> {
    use std::collections::HashMap;
    let nodes = list_nodes(app, None)?;
    let mut seen: HashMap<String, String> = HashMap::new();
    let mut duplicates = Vec::new();
    for node in nodes {
        let key = format!(
            "{}|{}|{}|{}",
            node.protocol,
            node.host.to_lowercase(),
            node.port,
            node.details
        );
        if let Some(existing) = seen.get(&key) {
            if node.active {
                duplicates.push(existing.clone());
                seen.insert(key, node.id);
            } else {
                duplicates.push(node.id);
            }
        } else {
            seen.insert(key, node.id);
        }
    }
    let deleted = delete_nodes(app, &duplicates)?;
    ensure_active(app)?;
    Ok(deleted)
}

pub fn active_node(app: &AppHandle) -> Result<Option<V2rayNode>, String> {
    let connection = connection(app)?;
    connection
        .query_row(
            &format!("{NODE_SELECT} WHERE n.active=1 LIMIT 1"),
            [],
            node_from_row,
        )
        .optional()
        .map_err(|error| error.to_string())
}

pub fn save_metric(
    app: &AppHandle,
    node_id: &str,
    delay: Option<u32>,
    speed: Option<u64>,
    ip_info: Option<&str>,
    message: &str,
) -> Result<(), String> {
    let connection = connection(app)?;
    connection
        .execute(
            "INSERT INTO v2ray_node_metrics(node_id,delay,speed,ip_info,test_message,last_tested_at) VALUES(?1,?2,?3,?4,?5,?6)
             ON CONFLICT(node_id) DO UPDATE SET delay=excluded.delay,speed=COALESCE(excluded.speed,v2ray_node_metrics.speed),ip_info=COALESCE(excluded.ip_info,v2ray_node_metrics.ip_info),test_message=excluded.test_message,last_tested_at=excluded.last_tested_at",
            params![node_id, delay, speed, ip_info, message, now()],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn clear_test_metrics(app: &AppHandle, node_ids: &[String], mode: &str) -> Result<(), String> {
    let mut connection = connection(app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    for id in node_ids {
        transaction
            .execute(
                "INSERT OR IGNORE INTO v2ray_node_metrics(node_id) VALUES(?1)",
                [id],
            )
            .map_err(|error| error.to_string())?;
        let sql = match mode {
            "speed" => "UPDATE v2ray_node_metrics SET speed=NULL,test_message=NULL WHERE node_id=?1",
            "mixed" => "UPDATE v2ray_node_metrics SET delay=NULL,speed=NULL,ip_info=NULL,test_message=NULL WHERE node_id=?1",
            "real" | "fast-real" => "UPDATE v2ray_node_metrics SET delay=NULL,ip_info=NULL,test_message=NULL WHERE node_id=?1",
            _ => "UPDATE v2ray_node_metrics SET delay=NULL,test_message=NULL WHERE node_id=?1",
        };
        transaction
            .execute(sql, [id])
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

fn subscription_from_row(row: &Row<'_>) -> rusqlite::Result<V2raySubscription> {
    Ok(V2raySubscription {
        id: row.get(0)?,
        name: row.get(1)?,
        url: row.get(2)?,
        enabled: row.get::<_, i64>(3)? != 0,
        user_agent: row.get(4)?,
        filter: row.get(5)?,
        sort: row.get(6)?,
        updated_at: row.get(7)?,
        last_error: row.get(8)?,
        node_count: row.get(9)?,
    })
}

const SUB_SELECT: &str = "SELECT s.id,s.name,s.url,s.enabled,s.user_agent,s.filter,s.sort,s.updated_at,s.last_error,
 (SELECT COUNT(*) FROM v2ray_nodes n WHERE n.subscription_id=s.id) node_count FROM v2ray_subscriptions s";

pub fn list_subscriptions(app: &AppHandle) -> Result<Vec<V2raySubscription>, String> {
    let connection = connection(app)?;
    let mut statement = connection
        .prepare(&format!("{SUB_SELECT} ORDER BY s.sort,s.name"))
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], subscription_from_row)
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

pub fn find_subscription_by_url(
    app: &AppHandle,
    url: &str,
) -> Result<Option<V2raySubscription>, String> {
    connection(app)?
        .query_row(
            &format!("{SUB_SELECT} WHERE s.url=?1 LIMIT 1"),
            [url.trim()],
            subscription_from_row,
        )
        .optional()
        .map_err(|error| error.to_string())
}

pub fn add_subscription(
    app: &AppHandle,
    name: &str,
    url: &str,
    user_agent: Option<&str>,
) -> Result<V2raySubscription, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("订阅地址必须使用 HTTP 或 HTTPS".into());
    }
    let connection = connection(app)?;
    let id = new_id("sub");
    let sort: i64 = connection
        .query_row(
            "SELECT COALESCE(MAX(sort),0)+1 FROM v2ray_subscriptions",
            [],
            |row| row.get(0),
        )
        .unwrap_or(1);
    connection
        .execute(
            "INSERT INTO v2ray_subscriptions(id,name,url,user_agent,sort) VALUES(?1,?2,?3,?4,?5)",
            params![
                id,
                if name.trim().is_empty() {
                    "V2ray 订阅"
                } else {
                    name.trim()
                },
                url.trim(),
                user_agent.unwrap_or("v2rayN/7.12.5"),
                sort
            ],
        )
        .map_err(|error| format!("保存订阅失败：{error}"))?;
    get_subscription(app, &id)
}

pub fn update_subscription_settings(
    app: &AppHandle,
    id: &str,
    input: &super::models::SubscriptionUpdateInput,
) -> Result<V2raySubscription, String> {
    if input.name.trim().is_empty() {
        return Err("订阅名称不能为空".into());
    }
    if !(input.url.starts_with("https://") || input.url.starts_with("http://")) {
        return Err("订阅地址必须使用 HTTP 或 HTTPS".into());
    }
    let changed = connection(app)?
        .execute(
            "UPDATE v2ray_subscriptions SET name=?2,url=?3,enabled=?4,user_agent=?5,filter=?6 WHERE id=?1",
            params![id, input.name.trim(), input.url.trim(), input.enabled, input.user_agent.trim(), input.filter.as_deref().map(str::trim).filter(|value| !value.is_empty())],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("V2ray 订阅不存在".into());
    }
    get_subscription(app, id)
}

pub fn get_subscription(app: &AppHandle, id: &str) -> Result<V2raySubscription, String> {
    let connection = connection(app)?;
    connection
        .query_row(
            &format!("{SUB_SELECT} WHERE s.id=?1"),
            [id],
            subscription_from_row,
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "V2ray 订阅不存在".into())
}

pub fn set_subscription_error(
    app: &AppHandle,
    id: &str,
    error: Option<&str>,
) -> Result<(), String> {
    connection(app)?
        .execute(
            "UPDATE v2ray_subscriptions SET last_error=?2 WHERE id=?1",
            params![id, error],
        )
        .map_err(|value| value.to_string())?;
    Ok(())
}

pub fn delete_subscription(app: &AppHandle, id: &str) -> Result<(), String> {
    let changed = connection(app)?
        .execute("DELETE FROM v2ray_subscriptions WHERE id=?1", [id])
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        Err("V2ray 订阅不存在".into())
    } else {
        Ok(())
    }
}
