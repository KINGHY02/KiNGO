; Stop only KiNGO-owned processes. New cores are materialized from .payload
; files into a versioned user-data directory, but an upgrade from an older
; release may still need to remove locked resources\cores\*.exe files.
; Ownership is determined by executable path, so cores belonging to Karing,
; Clash Verge, v2rayN, or another installation are never terminated.
; Capture this include file's directory now. Inside an expanded macro,
; __FILEDIR__ points at Tauri's generated installer directory instead.
!define KINGO_PREINSTALL_CLEANUP "${__FILEDIR__}\preinstall-cleanup.ps1"

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping KiNGO background processes..."
  InitPluginsDir
  File /oname=$PLUGINSDIR\kingo-preinstall-cleanup.ps1 "${KINGO_PREINSTALL_CLEANUP}"
  ; NSIS is a 32-bit process. On 64-bit Windows, $SYSDIR is redirected to
  ; SysWOW64 and 32-bit PowerShell cannot reliably read the executable path of
  ; 64-bit core processes. Sysnative deliberately bypasses that redirection.
  StrCpy $2 "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
  ${If} ${RunningX64}
    StrCpy $2 "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  ${EndIf}
  nsExec::ExecToStack /TIMEOUT=30000 '"$2" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\kingo-preinstall-cleanup.ps1" -InstallDir "$INSTDIR"'
  Pop $0
  Pop $1
  StrCmp $0 "0" kingo_core_cleanup_done
  StrCmp $0 "32" kingo_core_cleanup_locked
  DetailPrint "$1"
  MessageBox MB_ICONSTOP|MB_OK "安装前检查未能完成，安装器尚未写入任何文件。$\r$\n$\r$\n$1"
  Abort
kingo_core_cleanup_locked:
  DetailPrint "$1"
  MessageBox MB_ICONSTOP|MB_OK "KiNGO 或其连接核心仍在运行，安装器无法安全更新。$\r$\n$\r$\n请从系统托盘退出 KiNGO 后重试。若旧版 KiNGO 以管理员身份运行，请以管理员身份启动本安装器。"
  Abort
kingo_core_cleanup_done:
!macroend
