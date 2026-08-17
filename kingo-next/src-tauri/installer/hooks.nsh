; Stop only KiNGO-owned processes. Core executables are versioned in the user
; data directory since 2.0.6, so an old core lock can no longer block setup.
; Matching both process name and executable path avoids terminating cores that
; belong to Karing, Clash Verge, v2rayN, or another installation.
!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping KiNGO background processes..."
  nsExec::ExecToStack /TIMEOUT=20000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$$root=[IO.Path]::GetFullPath(''$INSTDIR'').TrimEnd(''\''); $$names=@(''KiNGO'',''xray'',''juicity-client'',''subs-check'',''mihomo'',''sing-box'',''hysteria2'',''hysteria-tun-windows-6.0-386'',''naive'',''mieru'',''shadowquic''); $$owned=@(Get-Process -ErrorAction SilentlyContinue | Where-Object { try { $$_.Name -in $$names -and $$_.Path -and ([IO.Path]::GetFullPath($$_.Path).Equals((Join-Path $$root ''KiNGO.exe''),[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFullPath($$_.Path).StartsWith($$root + ''\resources\cores\'',[StringComparison]::OrdinalIgnoreCase)) } catch { $$false } }); if ($$owned.Count -gt 0) { $$owned | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 800 }; $$appFile=Join-Path $$root ''KiNGO.exe''; for ($$attempt=0; $$attempt -lt 5; $$attempt++) { try { if (Test-Path -LiteralPath $$appFile) { $$stream=[IO.File]::Open($$appFile,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None); $$stream.Dispose() }; exit 0 } catch { Start-Sleep -Milliseconds 500 } }; exit 32"'
  Pop $0
  Pop $1
  StrCmp $0 "0" kingo_core_cleanup_done
  DetailPrint "$1"
  MessageBox MB_ICONSTOP|MB_OK "KiNGO 主程序仍在运行，安装器无法安全更新。$\r$\n$\r$\n请从系统托盘退出 KiNGO 后重试。若 KiNGO 以管理员身份运行，请以管理员身份启动本安装器。"
  Abort
kingo_core_cleanup_done:
!macroend
