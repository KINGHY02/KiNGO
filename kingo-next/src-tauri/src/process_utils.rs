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

#[cfg(not(windows))]
pub fn is_elevated() -> bool {
    true
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

#[cfg(not(windows))]
pub fn relaunch_elevated() -> Result<(), String> {
    Ok(())
}
