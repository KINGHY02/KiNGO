use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct V2rayNode {
    pub id: String,
    pub subscription_id: Option<String>,
    pub name: String,
    pub protocol: String,
    pub host: String,
    pub port: u16,
    pub core_id: String,
    pub raw_url: String,
    pub details: serde_json::Value,
    pub sort: i64,
    pub active: bool,
    pub delay: Option<u32>,
    pub speed: Option<u64>,
    pub ip_info: Option<String>,
    pub test_message: Option<String>,
    pub last_tested_at: Option<u64>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct V2raySubscription {
    pub id: String,
    pub name: String,
    pub url: String,
    pub enabled: bool,
    pub user_agent: String,
    pub filter: Option<String>,
    pub sort: i64,
    pub updated_at: Option<u64>,
    pub node_count: u32,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub imported: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
    pub nodes: Vec<V2rayNode>,
    pub subscriptions: Vec<SubscriptionUpdateResult>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionUpdateResult {
    pub subscription: V2raySubscription,
    pub imported: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct V2rayRuntimeState {
    pub active_node_id: Option<String>,
    pub core_id: Option<String>,
    pub running: bool,
    pub local_socks_port: u16,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeTestResult {
    pub node_id: String,
    pub delay: Option<u32>,
    pub speed: Option<u64>,
    pub ip_info: Option<String>,
    pub mode: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeTestBatchResult {
    pub results: Vec<NodeTestResult>,
    pub cancelled: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeShare {
    pub node_id: String,
    pub name: String,
    pub link: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeUpdateInput {
    pub name: String,
    pub protocol: String,
    pub host: String,
    pub port: u16,
    pub core_id: String,
    pub details: serde_json::Value,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionUpdateInput {
    pub name: String,
    pub url: String,
    pub enabled: bool,
    pub user_agent: String,
    pub filter: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionBatchResult {
    pub updated: Vec<SubscriptionUpdateResult>,
    pub errors: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct ParsedNode {
    pub name: String,
    pub protocol: String,
    pub host: String,
    pub port: u16,
    pub raw_url: String,
    pub details: serde_json::Value,
}
