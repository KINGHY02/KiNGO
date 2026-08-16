use super::models::CommunitySource;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
pub const BUILTIN_MANIFEST: &str = include_str!("../../resources/community-sources.txt");

fn source_id(url: &str) -> String {
    let digest = Sha256::digest(url.as_bytes());
    format!("source-{}", &format!("{digest:x}")[..16])
}

pub fn parse_manifest(content: &str) -> Vec<CommunitySource> {
    let mut seen = HashSet::new();
    content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .filter(|line| line.starts_with("https://") || line.starts_with("http://"))
        .filter(|line| seen.insert((*line).to_string()))
        .map(|url| CommunitySource {
            id: source_id(url),
            url: url.to_string(),
            enabled: true,
        })
        .collect()
}

pub fn builtin_sources() -> Vec<CommunitySource> {
    parse_manifest(BUILTIN_MANIFEST)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_manifest_contains_expected_sources() {
        let sources = builtin_sources();
        assert_eq!(sources.len(), 65);
        assert!(sources
            .iter()
            .all(|source| source.url.starts_with("https://")));
    }

    #[test]
    fn manifest_ignores_comments_invalid_lines_and_duplicates() {
        let sources =
            parse_manifest("# note\nhttps://example.com/a\ninvalid\nhttps://example.com/a\n");
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].url, "https://example.com/a");
    }
}
