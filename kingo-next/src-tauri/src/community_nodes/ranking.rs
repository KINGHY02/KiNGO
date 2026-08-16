use super::models::CommunityNodeCandidate;
use std::cmp::Ordering;

fn latency(node: &CommunityNodeCandidate) -> u32 {
    node.latency_median_ms.unwrap_or(u32::MAX)
}

fn speed(node: &CommunityNodeCandidate) -> u64 {
    node.speed_median_kbps.unwrap_or(0)
}

pub fn sort_nodes(nodes: &mut [CommunityNodeCandidate], mode: &str) {
    nodes.sort_by(|left, right| {
        let order = match mode {
            "speed" => speed(right)
                .cmp(&speed(left))
                .then_with(|| latency(left).cmp(&latency(right))),
            "latency" => latency(left)
                .cmp(&latency(right))
                .then_with(|| speed(right).cmp(&speed(left))),
            _ => latency(left)
                .cmp(&latency(right))
                .then_with(|| speed(right).cmp(&speed(left))),
        };
        if order == Ordering::Equal {
            left.id.cmp(&right.id)
        } else {
            order
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn node(id: &str, latency: u32, speed: u64) -> CommunityNodeCandidate {
        CommunityNodeCandidate {
            id: id.into(),
            source_ids: vec![],
            original_name: id.into(),
            display_name: String::new(),
            protocol: "vless".into(),
            server: "example.com".into(),
            port: 443,
            config: json!({}),
            latency_samples: vec![latency],
            latency_median_ms: Some(latency),
            speed_samples_kbps: vec![speed],
            speed_median_kbps: Some(speed),
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
    fn speed_mode_uses_latency_as_tie_breaker() {
        let mut nodes = vec![
            node("slow-latency", 200, 1000),
            node("fast-latency", 50, 1000),
        ];
        sort_nodes(&mut nodes, "speed");
        assert_eq!(nodes[0].id, "fast-latency");
    }
}
