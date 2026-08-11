use crate::{cores, paths, process_utils::hidden_command};
use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
};
use tauri::AppHandle;

#[derive(Clone, Copy)]
struct Repo {
    id: &'static str,
    github: &'static str,
    version_arg: &'static str,
    keywords: &'static [&'static str],
    prerelease: bool,
}

const REPOS: &[Repo] = &[
    Repo {
        id: "mihomo",
        github: "MetaCubeX/mihomo",
        version_arg: "-v",
        keywords: &["windows", "amd64", "compatible"],
        prerelease: false,
    },
    Repo {
        id: "mihomo-alpha",
        github: "MetaCubeX/mihomo",
        version_arg: "-v",
        keywords: &["windows", "amd64", "compatible", "alpha"],
        prerelease: true,
    },
    Repo {
        id: "xray",
        github: "XTLS/Xray-core",
        version_arg: "version",
        keywords: &["windows", "64"],
        prerelease: false,
    },
    Repo {
        id: "sing-box",
        github: "SagerNet/sing-box",
        version_arg: "version",
        keywords: &["windows", "amd64"],
        prerelease: false,
    },
    Repo {
        id: "hysteria",
        github: "apernet/hysteria",
        version_arg: "version",
        keywords: &["windows", "386"],
        prerelease: false,
    },
    Repo {
        id: "hysteria2",
        github: "apernet/hysteria",
        version_arg: "version",
        keywords: &["windows", "amd64"],
        prerelease: false,
    },
    Repo {
        id: "naiveproxy",
        github: "klzgrad/naiveproxy",
        version_arg: "--version",
        keywords: &["win", "x64"],
        prerelease: false,
    },
    Repo {
        id: "juicity",
        github: "juicity/juicity",
        version_arg: "version",
        keywords: &["windows", "x86_64"],
        prerelease: false,
    },
    Repo {
        id: "mieru",
        github: "enfein/mieru",
        version_arg: "version",
        keywords: &["windows", "amd64"],
        prerelease: false,
    },
];

#[derive(Debug, Deserialize)]
struct Release {
    tag_name: String,
    assets: Vec<Asset>,
    html_url: Option<String>,
    #[serde(default)]
    prerelease: bool,
}
#[derive(Clone, Debug, Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
    size: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreVersionInfo {
    pub core_id: String,
    pub name: String,
    pub current_version: Option<String>,
    pub latest_version: Option<String>,
    pub outdated: bool,
    pub source: String,
    pub available: bool,
    pub update_supported: bool,
    pub asset_name: Option<String>,
    pub asset_size: Option<u64>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreUpdateResult {
    pub core_id: String,
    pub version: String,
    pub checksum_verified: bool,
    pub connection_restarted: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateInfo {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub outdated: bool,
    pub release_url: String,
}

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent(concat!("KiNGO/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

fn release(repo: Repo) -> Result<Release, String> {
    if repo.prerelease {
        let releases: Vec<Release> = client()?
            .get(format!(
                "https://api.github.com/repos/{}/releases",
                repo.github
            ))
            .send()
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?
            .json()
            .map_err(|e| e.to_string())?;
        return releases
            .into_iter()
            .find(|release| {
                release.prerelease || release.tag_name.to_ascii_lowercase().contains("alpha")
            })
            .ok_or_else(|| "没有找到 Alpha 内核发布版本".into());
    }
    client()?
        .get(format!(
            "https://api.github.com/repos/{}/releases/latest",
            repo.github
        ))
        .send()
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .map_err(|e| e.to_string())
}

fn version_from(text: &str) -> Option<String> {
    text.split(|c: char| !(c.is_ascii_digit() || c == '.'))
        .find(|part| {
            part.matches('.').count() >= 2
                && part.chars().next().is_some_and(|c| c.is_ascii_digit())
        })
        .map(str::to_string)
}

fn current_version(path: Option<&str>, arg: &str) -> Option<String> {
    let path = path?;
    let output = hidden_command(path).arg(arg).output().ok()?;
    let text = format!(
        "{} {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    version_from(&text)
}

fn version_parts(value: &str) -> Vec<u32> {
    value.split('.').filter_map(|v| v.parse().ok()).collect()
}
fn outdated(current: &str, latest: &str) -> bool {
    version_parts(current) < version_parts(latest)
}

fn asset_score(asset: &Asset, repo: Repo) -> i32 {
    let name = asset.name.to_ascii_lowercase();
    if name.contains("checksum")
        || name.contains("sha256")
        || name.ends_with(".sig")
        || (!name.contains("win") && !name.contains("windows"))
    {
        return -100;
    }
    if !(name.ends_with(".zip") || name.ends_with(".gz") || name.ends_with(".exe")) {
        return -50;
    }
    repo.keywords
        .iter()
        .map(|key| {
            if name.contains(&key.to_ascii_lowercase()) {
                10
            } else {
                -3
            }
        })
        .sum()
}

fn pick_asset(release: &Release, repo: Repo) -> Option<Asset> {
    release
        .assets
        .iter()
        .cloned()
        .max_by_key(|a| asset_score(a, repo))
        .filter(|a| asset_score(a, repo) >= 0)
}

pub fn check_all(app: &AppHandle) -> Result<Vec<CoreVersionInfo>, String> {
    let statuses = cores::statuses(app)?;
    Ok(statuses
        .into_iter()
        .map(|status| {
            let repo = REPOS
                .iter()
                .find(|repo| repo.id == status.profile.id)
                .copied();
            let current = repo.and_then(|repo| {
                current_version(status.executable_path.as_deref(), repo.version_arg)
            });
            let remote = repo.map(release);
            let (latest, asset_name, asset_size, error) = match remote {
                Some(Ok(value)) => {
                    let asset = repo.and_then(|r| pick_asset(&value, r));
                    (
                        version_from(&value.tag_name).or(Some(value.tag_name)),
                        asset.as_ref().map(|a| a.name.clone()),
                        asset.and_then(|a| a.size),
                        None,
                    )
                }
                Some(Err(error)) => (None, None, None, Some(error)),
                None => (None, None, None, None),
            };
            let is_outdated = match (&current, &latest) {
                (Some(a), Some(b)) => outdated(a, b),
                (None, Some(_)) => !status.available,
                _ => false,
            };
            CoreVersionInfo {
                core_id: status.profile.id,
                name: status.profile.name,
                current_version: current,
                latest_version: latest,
                outdated: is_outdated,
                source: status.source,
                available: status.available,
                update_supported: repo.is_some(),
                asset_name,
                asset_size,
                error,
            }
        })
        .collect())
}

pub fn check_app_update() -> Result<AppUpdateInfo, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let release: Release = client()?
        .get("https://api.github.com/repos/KINGHY02/KiNGO/releases/latest")
        .send()
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .map_err(|e| e.to_string())?;
    let latest = version_from(&release.tag_name).or(Some(release.tag_name));
    let is_outdated = latest
        .as_ref()
        .is_some_and(|value| outdated(&current, value));
    Ok(AppUpdateInfo {
        current_version: current,
        latest_version: latest,
        outdated: is_outdated,
        release_url: release
            .html_url
            .unwrap_or_else(|| "https://github.com/KINGHY02/KiNGO/releases/latest".into()),
    })
}

fn download(url: &str, target: &Path) -> Result<(), String> {
    let mut response = client()?
        .get(url)
        .send()
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let mut file = fs::File::create(target).map_err(|e| e.to_string())?;
    io::copy(&mut response, &mut file).map_err(|e| e.to_string())?;
    Ok(())
}

fn find_exe(dir: &Path) -> Option<PathBuf> {
    for entry in fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_exe(&path) {
                return Some(found);
            }
        } else if path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("exe"))
        {
            return Some(path);
        }
    }
    None
}

fn unpack(source: &Path, dir: &Path) -> Result<PathBuf, String> {
    let name = source
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if name.ends_with(".exe") {
        return Ok(source.to_path_buf());
    }
    if name.ends_with(".zip") {
        zip::ZipArchive::new(fs::File::open(source).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?
            .extract(dir)
            .map_err(|e| e.to_string())?;
    } else if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
        tar::Archive::new(GzDecoder::new(
            fs::File::open(source).map_err(|e| e.to_string())?,
        ))
        .unpack(dir)
        .map_err(|e| e.to_string())?;
    } else if name.ends_with(".gz") {
        let output = dir.join(source.file_stem().unwrap_or_default());
        let mut decoder = GzDecoder::new(fs::File::open(source).map_err(|e| e.to_string())?);
        let mut file = fs::File::create(&output).map_err(|e| e.to_string())?;
        io::copy(&mut decoder, &mut file).map_err(|e| e.to_string())?;
        return Ok(output);
    } else {
        return Err("不支持的核心压缩格式".into());
    }
    find_exe(dir).ok_or_else(|| "下载包中没有找到可执行文件".into())
}

fn checksum_asset(release: &Release, asset: &Asset) -> Option<Asset> {
    let target = asset.name.to_ascii_lowercase();
    release
        .assets
        .iter()
        .find(|a| {
            let name = a.name.to_ascii_lowercase();
            name == format!("{target}.sha256")
                || name.contains("checksum")
                || name.contains("sha256sum")
        })
        .cloned()
}

fn verify_checksum(file: &Path, checksum_file: &Path, asset_name: &str) -> Result<bool, String> {
    let text = fs::read_to_string(checksum_file).map_err(|e| e.to_string())?;
    let line = text
        .lines()
        .find(|line| {
            line.to_ascii_lowercase()
                .contains(&asset_name.to_ascii_lowercase())
        })
        .or_else(|| text.lines().next())
        .unwrap_or("");
    let expected = line
        .split_whitespace()
        .find(|part| part.len() == 64 && part.chars().all(|c| c.is_ascii_hexdigit()));
    let Some(expected) = expected else {
        return Ok(false);
    };
    let mut source = fs::File::open(file).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let read = source.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let actual = format!("{:x}", hasher.finalize());
    if actual.eq_ignore_ascii_case(expected) {
        Ok(true)
    } else {
        Err("核心文件 SHA-256 校验失败".into())
    }
}

pub fn update(app: &AppHandle, core_id: &str) -> Result<CoreUpdateResult, String> {
    update_with_before_install(app, core_id, || Ok(()))
}

pub fn update_with_before_install<F>(
    app: &AppHandle,
    core_id: &str,
    before_install: F,
) -> Result<CoreUpdateResult, String>
where
    F: FnOnce() -> Result<(), String>,
{
    let profile = cores::profiles()
        .into_iter()
        .find(|p| p.id == core_id)
        .ok_or("未知核心")?;
    let repo = REPOS
        .iter()
        .find(|r| r.id == core_id)
        .copied()
        .ok_or("该核心暂不支持自动更新")?;
    let release = release(repo)?;
    let asset = pick_asset(&release, repo).ok_or("没有找到适合 Windows 的核心资源")?;
    let temp = std::env::temp_dir().join(format!("kingo-core-{}-{}", core_id, std::process::id()));
    let _ = fs::remove_dir_all(&temp);
    fs::create_dir_all(&temp).map_err(|e| e.to_string())?;
    let archive = temp.join(&asset.name);
    download(&asset.browser_download_url, &archive)?;
    let checksum_verified = if let Some(checksum) = checksum_asset(&release, &asset) {
        let path = temp.join(&checksum.name);
        download(&checksum.browser_download_url, &path)?;
        verify_checksum(&archive, &path, &asset.name)?
    } else {
        false
    };
    let extract = temp.join("extract");
    fs::create_dir_all(&extract).map_err(|e| e.to_string())?;
    let executable = unpack(&archive, &extract)?;
    let target_dir = PathBuf::from(paths::ensure(app)?.cores_dir).join(core_id);
    fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    let target = target_dir.join(profile.executable);
    let staged = target.with_extension("exe.new");
    let backup = target.with_extension("exe.bak");
    fs::copy(executable, &staged).map_err(|e| e.to_string())?;
    // Keep the current proxy core alive for release lookup, download, unpacking,
    // and checksum verification. The caller only stops it at this final swap.
    if let Err(error) = before_install() {
        let _ = fs::remove_file(&staged);
        let _ = fs::remove_dir_all(&temp);
        return Err(error);
    }
    if target.exists() {
        let _ = fs::remove_file(&backup);
        fs::rename(&target, &backup).map_err(|e| e.to_string())?;
    }
    if let Err(error) = fs::rename(&staged, &target) {
        if backup.exists() {
            let _ = fs::rename(&backup, &target);
        }
        return Err(error.to_string());
    }
    let _ = fs::remove_file(backup);
    let _ = fs::remove_dir_all(temp);
    Ok(CoreUpdateResult {
        core_id: core_id.into(),
        version: release.tag_name,
        checksum_verified,
        connection_restarted: false,
    })
}

pub fn restore_bundled(app: &AppHandle, core_id: &str) -> Result<(), String> {
    let profile = cores::profiles()
        .into_iter()
        .find(|p| p.id == core_id)
        .ok_or("未知核心")?;
    let target = PathBuf::from(paths::ensure(app)?.cores_dir)
        .join(core_id)
        .join(profile.executable);
    if target.exists() {
        fs::remove_file(target).map_err(|e| e.to_string())?;
    }
    Ok(())
}
