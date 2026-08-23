use std::{ffi::OsStr, process::Command};

/// Creates a background command that never opens a console window on Windows.
pub fn hidden_command<S: AsRef<OsStr>>(program: S) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

pub fn curl_command() -> Command {
    let mut command = if cfg!(windows) {
        hidden_command("curl.exe")
    } else {
        hidden_command("/usr/bin/curl")
    };
    #[cfg(windows)]
    command.arg("--ssl-no-revoke");
    command
}

pub fn null_device() -> &'static str {
    if cfg!(windows) {
        "NUL"
    } else {
        "/dev/null"
    }
}

#[cfg(windows)]
pub fn is_elevated() -> bool {
    hidden_command("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
        ])
        .output()
        .ok()
        .is_some_and(|output| String::from_utf8_lossy(&output.stdout).trim().eq_ignore_ascii_case("true"))
}

#[cfg(windows)]
pub fn active_external_tun_adapters() -> Vec<String> {
    let script = r#"$routes = Get-NetRoute -ErrorAction SilentlyContinue | Where-Object {
  $_.State -eq 'Alive' -and ($_.DestinationPrefix -in @('0.0.0.0/0','0.0.0.0/1','128.0.0.0/1','::/0','::/1','8000::/1'))
} | Select-Object -ExpandProperty InterfaceIndex -Unique
Get-NetAdapter -ErrorAction SilentlyContinue |
Where-Object {
  $_.Status -eq 'Up' -and
  $routes -contains $_.InterfaceIndex -and
  (($_.Name + ' ' + $_.InterfaceDescription) -match '(?i)(tun|wintun|tap|vpn)') -and
  (($_.Name + ' ' + $_.InterfaceDescription) -notmatch '(?i)kingo')
} | ForEach-Object { $_.Name }"#;
    hidden_command("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| {
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(target_os = "macos")]
pub fn is_elevated() -> bool {
    false
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn is_elevated() -> bool {
    true
}

#[cfg(not(windows))]
pub fn active_external_tun_adapters() -> Vec<String> {
    Vec::new()
}

#[cfg(windows)]
pub fn relaunch_elevated() -> Result<(), String> {
    let executable =
        std::env::current_exe().map_err(|error| format!("读取 KiNGO 程序路径失败：{error}"))?;
    let path = executable.to_string_lossy().replace('\'', "''");
    hidden_command("powershell.exe")
        .args([
            "-NoProfile",
            "-Command",
            &format!("Start-Process -FilePath '{path}' -Verb RunAs"),
        ])
        .status()
        .map_err(|error| format!("请求管理员权限失败：{error}"))?
        .success()
        .then_some(())
        .ok_or_else(|| "管理员授权被取消，TUN 模式未启动".into())
}

#[cfg(windows)]
pub fn relaunch_elevated_delayed() -> Result<(), String> {
    let executable =
        std::env::current_exe().map_err(|error| format!("读取 KiNGO 程序路径失败：{error}"))?;
    let path = executable.to_string_lossy().replace('\'', "''");
    hidden_command("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            &format!("Start-Sleep -Milliseconds 900; Start-Process -FilePath '{path}' -Verb RunAs"),
        ])
        .spawn()
        .map_err(|error| format!("请求管理员权限失败：{error}"))?;
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn relaunch_elevated() -> Result<(), String> {
    Err("macOS 版本暂不提供 TUN 提权启动，请使用系统代理模式".into())
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn relaunch_elevated() -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn relaunch_elevated_delayed() -> Result<(), String> {
    relaunch_elevated()
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn relaunch_elevated_delayed() -> Result<(), String> {
    Ok(())
}
