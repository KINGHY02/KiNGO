use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommunitySource {
    pub id: String,
    pub url: String,
    pub enabled: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommunityNodeCandidate {
    pub id: String,
    pub source_ids: Vec<String>,
    pub original_name: String,
    #[serde(default)]
    pub display_name: String,
    pub protocol: String,
    pub server: String,
    pub port: u16,
    pub config: serde_json::Value,
    #[serde(default)]
    pub latency_samples: Vec<u32>,
    #[serde(default)]
    pub latency_median_ms: Option<u32>,
    #[serde(default)]
    pub speed_samples_kbps: Vec<u64>,
    #[serde(default)]
    pub speed_median_kbps: Option<u64>,
    #[serde(default)]
    pub country_code: Option<String>,
    #[serde(default)]
    pub country_name: Option<String>,
    #[serde(default)]
    pub exit_ip: Option<String>,
    #[serde(default)]
    pub exit_verified: bool,
    #[serde(default)]
    pub last_tested_at: Option<u64>,
    #[serde(default)]
    pub last_error_code: Option<String>,
    #[serde(default)]
    pub last_error_detail: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseBatch {
    pub nodes: Vec<CommunityNodeCandidate>,
    pub skipped: usize,
    pub errors: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommunityScanState {
    pub job_id: Option<String>,
    pub state: String,
    pub stage: String,
    pub source_total: usize,
    pub source_done: usize,
    pub source_succeeded: usize,
    pub source_failed: usize,
    pub raw_total: usize,
    pub deduplicated_total: usize,
    pub alive_total: usize,
    pub alive_done: usize,
    pub alive_succeeded: usize,
    pub speed_total: usize,
    pub speed_done: usize,
    pub speed_succeeded: usize,
    pub finalist_total: usize,
    pub finalist_done: usize,
    pub skipped_total: usize,
    pub retained_total: usize,
    pub bytes_downloaded: u64,
    pub started_at: Option<u64>,
    pub updated_at: Option<u64>,
    pub completed_at: Option<u64>,
    pub using_remote_manifest: bool,
    pub message: Option<String>,
}

impl Default for CommunityScanState {
    fn default() -> Self {
        Self {
            job_id: None,
            state: "idle".into(),
            stage: "idle".into(),
            source_total: 0,
            source_done: 0,
            source_succeeded: 0,
            source_failed: 0,
            raw_total: 0,
            deduplicated_total: 0,
            alive_total: 0,
            alive_done: 0,
            alive_succeeded: 0,
            speed_total: 0,
            speed_done: 0,
            speed_succeeded: 0,
            finalist_total: 0,
            finalist_done: 0,
            skipped_total: 0,
            retained_total: 0,
            bytes_downloaded: 0,
            started_at: None,
            updated_at: None,
            completed_at: None,
            using_remote_manifest: false,
            message: None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommunitySettings {
    pub retain_count: usize,
    pub sort_mode: String,
    pub speed_concurrency: usize,
    pub speed_timeout_seconds: u64,
}

impl Default for CommunitySettings {
    fn default() -> Self {
        Self {
            retain_count: 50,
            sort_mode: "speed".into(),
            speed_concurrency: 4,
            speed_timeout_seconds: 10,
        }
    }
}
