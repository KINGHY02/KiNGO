use crate::paths;
use serde_json::json;
use std::{
    collections::HashSet,
    fs,
    net::{IpAddr, Ipv4Addr, Ipv6Addr},
    path::{Path, PathBuf},
    sync::{Arc, OnceLock},
};
use tauri::AppHandle;

#[derive(Clone, Debug)]
pub struct CountryRules {
    full_domains: HashSet<String>,
    root_domains: HashSet<String>,
    keyword_domains: Vec<String>,
    regex_domains: Vec<String>,
    regex_matchers: Vec<regex::Regex>,
    ipv4: Vec<HashSet<u32>>,
    ipv6: Vec<HashSet<u128>>,
    cidrs: Vec<String>,
}

impl Default for CountryRules {
    fn default() -> Self {
        Self {
            full_domains: HashSet::new(),
            root_domains: HashSet::new(),
            keyword_domains: Vec::new(),
            regex_domains: Vec::new(),
            regex_matchers: Vec::new(),
            ipv4: (0..=32).map(|_| HashSet::new()).collect(),
            ipv6: (0..=128).map(|_| HashSet::new()).collect(),
            cidrs: Vec::new(),
        }
    }
}

impl CountryRules {
    #[cfg(test)]
    pub(crate) fn with_root_domain(domain: &str) -> Self {
        let mut rules = Self::default();
        rules.root_domains.insert(domain.to_string());
        rules
    }

    #[cfg(test)]
    pub(crate) fn with_ipv4_network(address: Ipv4Addr, prefix: usize) -> Self {
        let mut rules = Self::default();
        let mask = if prefix == 0 {
            0
        } else {
            u32::MAX << (32 - prefix)
        };
        rules.ipv4[prefix].insert(u32::from(address) & mask);
        rules
    }

    pub fn matches_host(&self, host: &str) -> bool {
        let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
        if let Ok(address) = host.parse::<IpAddr>() {
            return self.matches_ip(address);
        }
        if self.full_domains.contains(&host) || self.root_domains.contains(&host) {
            return true;
        }
        let mut suffix = host.as_str();
        while let Some((_, parent)) = suffix.split_once('.') {
            if self.root_domains.contains(parent) {
                return true;
            }
            suffix = parent;
        }
        self.keyword_domains
            .iter()
            .any(|keyword| host.contains(keyword))
            || self
                .regex_matchers
                .iter()
                .any(|pattern| pattern.is_match(&host))
    }

    pub(crate) fn matches_ip(&self, address: IpAddr) -> bool {
        match address {
            IpAddr::V4(address) => {
                let value = u32::from(address);
                self.ipv4.iter().enumerate().any(|(prefix, networks)| {
                    if networks.is_empty() {
                        return false;
                    }
                    let mask = if prefix == 0 {
                        0
                    } else {
                        u32::MAX << (32 - prefix)
                    };
                    networks.contains(&(value & mask))
                })
            }
            IpAddr::V6(address) => {
                let value = u128::from(address);
                self.ipv6.iter().enumerate().any(|(prefix, networks)| {
                    if networks.is_empty() {
                        return false;
                    }
                    let mask = if prefix == 0 {
                        0
                    } else {
                        u128::MAX << (128 - prefix)
                    };
                    networks.contains(&(value & mask))
                })
            }
        }
    }

    pub fn write_singbox_source(&self, target: &Path) -> Result<(), String> {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("创建规则目录失败：{error}"))?;
        }
        let mut full: Vec<_> = self.full_domains.iter().cloned().collect();
        let mut root: Vec<_> = self.root_domains.iter().cloned().collect();
        full.sort_unstable();
        root.sort_unstable();
        let content = serde_json::to_vec(&json!({
            "version": 3,
            "rules": [{
                "domain": full,
                "domain_suffix": root,
                "domain_keyword": self.keyword_domains,
                "domain_regex": self.regex_domains,
                "ip_cidr": self.cidrs,
            }]
        }))
        .map_err(|error| format!("生成 sing-box 中国规则失败：{error}"))?;
        let pending = target.with_extension("json.pending");
        fs::write(&pending, content).map_err(|error| format!("写入中国规则失败：{error}"))?;
        fs::rename(&pending, target).map_err(|error| format!("安装中国规则失败：{error}"))
    }
}

enum Field<'a> {
    Varint(u64),
    Bytes(&'a [u8]),
    Other,
}

fn read_varint(data: &[u8], offset: &mut usize) -> Result<u64, String> {
    let mut value = 0_u64;
    for shift in (0..70).step_by(7) {
        let byte = *data.get(*offset).ok_or("GeoData varint 数据不完整")?;
        *offset += 1;
        value |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Ok(value);
        }
    }
    Err("GeoData varint 超出范围".into())
}

fn next_field<'a>(data: &'a [u8], offset: &mut usize) -> Result<Option<(u32, Field<'a>)>, String> {
    if *offset >= data.len() {
        return Ok(None);
    }
    let key = read_varint(data, offset)?;
    let number = (key >> 3) as u32;
    let field = match key & 7 {
        0 => Field::Varint(read_varint(data, offset)?),
        1 => {
            *offset = offset.checked_add(8).ok_or("GeoData 偏移溢出")?;
            Field::Other
        }
        2 => {
            let length = read_varint(data, offset)? as usize;
            let end = offset.checked_add(length).ok_or("GeoData 长度溢出")?;
            let bytes = data.get(*offset..end).ok_or("GeoData 字段不完整")?;
            *offset = end;
            Field::Bytes(bytes)
        }
        5 => {
            *offset = offset.checked_add(4).ok_or("GeoData 偏移溢出")?;
            Field::Other
        }
        _ => return Err("GeoData 包含不支持的字段类型".into()),
    };
    if *offset > data.len() {
        return Err("GeoData 字段越界".into());
    }
    Ok(Some((number, field)))
}

fn string_field(data: &[u8], wanted: u32) -> Result<Option<String>, String> {
    let mut offset = 0;
    while let Some((number, field)) = next_field(data, &mut offset)? {
        if number == wanted {
            if let Field::Bytes(bytes) = field {
                return String::from_utf8(bytes.to_vec())
                    .map(Some)
                    .map_err(|_| "GeoData 字符串不是 UTF-8".into());
            }
        }
    }
    Ok(None)
}

fn parse_cidr(data: &[u8], rules: &mut CountryRules) -> Result<(), String> {
    let mut offset = 0;
    let mut address = None;
    let mut prefix = None;
    while let Some((number, field)) = next_field(data, &mut offset)? {
        match (number, field) {
            (1, Field::Bytes(bytes)) => address = Some(bytes.to_vec()),
            (2, Field::Varint(value)) => prefix = Some(value as usize),
            _ => {}
        }
    }
    let address = address.ok_or("GeoIP CIDR 缺少地址")?;
    let prefix = prefix.ok_or("GeoIP CIDR 缺少前缀")?;
    match address.len() {
        4 if prefix <= 32 => {
            let address = Ipv4Addr::new(address[0], address[1], address[2], address[3]);
            let value = u32::from(address);
            let mask = if prefix == 0 {
                0
            } else {
                u32::MAX << (32 - prefix)
            };
            let network = Ipv4Addr::from(value & mask);
            rules.ipv4[prefix].insert(u32::from(network));
            rules.cidrs.push(format!("{network}/{prefix}"));
        }
        16 if prefix <= 128 => {
            let bytes: [u8; 16] = address.try_into().map_err(|_| "IPv6 地址长度无效")?;
            let address = Ipv6Addr::from(bytes);
            let value = u128::from(address);
            let mask = if prefix == 0 {
                0
            } else {
                u128::MAX << (128 - prefix)
            };
            let network = Ipv6Addr::from(value & mask);
            rules.ipv6[prefix].insert(u128::from(network));
            rules.cidrs.push(format!("{network}/{prefix}"));
        }
        _ => return Err("GeoIP CIDR 地址或前缀无效".into()),
    }
    Ok(())
}

fn parse_geoip(path: &Path, rules: &mut CountryRules) -> Result<(), String> {
    let data = fs::read(path).map_err(|error| format!("读取 geoip.dat 失败：{error}"))?;
    let mut offset = 0;
    while let Some((number, field)) = next_field(&data, &mut offset)? {
        let Field::Bytes(entry) = field else { continue };
        if number != 1 || string_field(entry, 1)?.as_deref() != Some("CN") {
            continue;
        }
        let mut entry_offset = 0;
        while let Some((field_number, field)) = next_field(entry, &mut entry_offset)? {
            if field_number == 2 {
                if let Field::Bytes(cidr) = field {
                    parse_cidr(cidr, rules)?;
                }
            }
        }
        return Ok(());
    }
    Err("geoip.dat 中没有 CN 规则".into())
}

fn parse_domain(data: &[u8], rules: &mut CountryRules) -> Result<(), String> {
    let mut offset = 0;
    let mut kind = None;
    let mut value = None;
    while let Some((number, field)) = next_field(data, &mut offset)? {
        match (number, field) {
            (1, Field::Varint(number)) => kind = Some(number),
            (2, Field::Bytes(bytes)) => {
                value =
                    Some(String::from_utf8(bytes.to_vec()).map_err(|_| "GeoSite 域名不是 UTF-8")?)
            }
            _ => {}
        }
    }
    let value = value
        .unwrap_or_default()
        .trim()
        .trim_end_matches('.')
        .to_ascii_lowercase();
    if value.is_empty() {
        return Ok(());
    }
    match kind.unwrap_or(0) {
        0 => rules.keyword_domains.push(value),
        1 => {
            if let Ok(pattern) = regex::Regex::new(&value) {
                rules.regex_domains.push(value);
                rules.regex_matchers.push(pattern);
            }
        }
        2 => {
            rules.root_domains.insert(value);
        }
        3 => {
            rules.full_domains.insert(value);
        }
        _ => {}
    }
    Ok(())
}

fn parse_geosite(path: &Path, rules: &mut CountryRules) -> Result<(), String> {
    let data = fs::read(path).map_err(|error| format!("读取 geosite.dat 失败：{error}"))?;
    let mut offset = 0;
    while let Some((number, field)) = next_field(&data, &mut offset)? {
        let Field::Bytes(entry) = field else { continue };
        if number != 1 || string_field(entry, 1)?.as_deref() != Some("CN") {
            continue;
        }
        let mut entry_offset = 0;
        while let Some((field_number, field)) = next_field(entry, &mut entry_offset)? {
            if field_number == 2 {
                if let Field::Bytes(domain) = field {
                    parse_domain(domain, rules)?;
                }
            }
        }
        return Ok(());
    }
    Err("geosite.dat 中没有 CN 规则".into())
}

fn load_from_paths(geoip: &Path, geosite: &Path) -> Result<CountryRules, String> {
    let mut rules = CountryRules::default();
    parse_geoip(geoip, &mut rules)?;
    parse_geosite(geosite, &mut rules)?;
    Ok(rules)
}

pub fn load_cn_rules(app: &AppHandle) -> Result<Arc<CountryRules>, String> {
    static RULES: OnceLock<Result<Arc<CountryRules>, String>> = OnceLock::new();
    RULES
        .get_or_init(|| {
            let geoip = paths::resource_file(app, PathBuf::from("cores/xray/geoip.dat"))?;
            let geosite = paths::resource_file(app, PathBuf::from("cores/xray/geosite.dat"))?;
            load_from_paths(&geoip, &geosite).map(Arc::new)
        })
        .clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_cn_geodata_matches_domains_and_ips() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let rules = load_from_paths(
            &root.join("resources/cores/xray/geoip.dat"),
            &root.join("resources/cores/xray/geosite.dat"),
        )
        .unwrap();
        assert!(rules.matches_host("www.baidu.com"));
        assert!(rules.matches_host("223.5.5.5"));
        assert!(!rules.matches_host("www.google.com"));
        assert!(!rules.matches_host("8.8.8.8"));
    }
}
