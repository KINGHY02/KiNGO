use super::models::{CommunityNodeCandidate, ParseBatch};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

fn canonical_value(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut entries = object
                .iter()
                .filter(|(key, _)| !matches!(key.as_str(), "name" | "sub_url" | "sub_tag"))
                .map(|(key, value)| (key.clone(), canonical_value(value)))
                .collect::<Vec<_>>();
            entries.sort_by(|left, right| left.0.cmp(&right.0));
            Value::Object(entries.into_iter().collect::<Map<_, _>>())
        }
        Value::Array(values) => Value::Array(values.iter().map(canonical_value).collect()),
        _ => value.clone(),
    }
}

pub fn node_fingerprint(config: &Value) -> String {
    let normalized = canonical_value(config);
    let bytes = serde_json::to_vec(&normalized).unwrap_or_default();
    let digest = Sha256::digest(bytes);
    format!("community-{}", &format!("{digest:x}")[..24])
}

pub fn deduplicate(mut batch: ParseBatch) -> ParseBatch {
    let mut positions = HashMap::<String, usize>::new();
    let mut unique = Vec::<CommunityNodeCandidate>::with_capacity(batch.nodes.len());
    for mut node in batch.nodes.drain(..) {
        node.id = node_fingerprint(&node.config);
        if let Some(position) = positions.get(&node.id).copied() {
            let existing = &mut unique[position];
            for source_id in node.source_ids {
                if !existing.source_ids.contains(&source_id) {
                    existing.source_ids.push(source_id);
                }
            }
            batch.skipped += 1;
        } else {
            positions.insert(node.id.clone(), unique.len());
            unique.push(node);
        }
    }
    batch.nodes = unique;
    batch
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn node(source: &str, name: &str) -> CommunityNodeCandidate {
        CommunityNodeCandidate {
            id: String::new(),
            source_ids: vec![source.into()],
            original_name: name.into(),
            display_name: String::new(),
            protocol: "vless".into(),
            server: "example.com".into(),
            port: 443,
            config: json!({
                "name": name,
                "type": "vless",
                "server": "example.com",
                "port": 443,
                "uuid": "00000000-0000-0000-0000-000000000000",
                "tls": true
            }),
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

    #[test]
    fn display_name_does_not_change_fingerprint() {
        assert_eq!(
            node_fingerprint(&node("a", "one").config),
            node_fingerprint(&node("b", "two").config)
        );
    }

    #[test]
    fn duplicate_nodes_merge_sources() {
        let batch = deduplicate(ParseBatch {
            nodes: vec![node("a", "one"), node("b", "two")],
            ..ParseBatch::default()
        });
        assert_eq!(batch.nodes.len(), 1);
        assert_eq!(batch.nodes[0].source_ids, vec!["a", "b"]);
        assert_eq!(batch.skipped, 1);
    }
}
