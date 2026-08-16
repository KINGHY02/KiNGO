; Stop only KiNGO-owned background cores before NSIS replaces bundled files.
; Matching both process name and executable path avoids terminating cores that
; belong to Karing, Clash Verge, v2rayN, or another installation.
!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping KiNGO background processes..."
  nsExec::ExecToStack /TIMEOUT=20000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$$root=[IO.Path]::GetFullPath(''$INSTDIR'').TrimEnd(''\''); $$names=@(''KiNGO'',''xray'',''juicity-client'',''subs-check'',''mihomo'',''sing-box'',''hysteria2'',''hysteria-tun-windows-6.0-386'',''naive'',''mieru'',''shadowquic''); $$owned=@(Get-Process -ErrorAction SilentlyContinue | Where-Object { try { $$_.Name -in $$names -and $$_.Path -and ([IO.Path]::GetFullPath($$_.Path).Equals((Join-Path $$root ''KiNGO.exe''),[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFullPath($$_.Path).StartsWith($$root + ''\resources\cores\'',[StringComparison]::OrdinalIgnoreCase)) } catch { $$false } }); if ($$owned.Count -gt 0) { $$owned | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 800 }; $$coreRoot=Join-Path $$root ''resources\cores''; for ($$attempt=0; $$attempt -lt 5; $$attempt++) { $$locked=$$false; Get-ChildItem -LiteralPath $$coreRoot -Recurse -Filter ''*.exe'' -ErrorAction SilentlyContinue | ForEach-Object { try { $$stream=[IO.File]::Open($$_.FullName,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None); $$stream.Dispose() } catch { $$locked=$$true } }; if (-not $$locked) { exit 0 }; Start-Sleep -Milliseconds 500 }; exit 32"'
  Pop $0
  Pop $1
  StrCmp $0 "0" kingo_core_cleanup_done
  DetailPrint "$1"
  MessageBox MB_ICONSTOP|MB_OK "KiNGO 或其内置代理核心仍在运行，安装器无法安全覆盖文件。$\r$\n$\r$\n请从系统托盘退出 KiNGO，并关闭正在运行的节点检测或连接任务后重试。若 KiNGO 以管理员身份运行，请以管理员身份启动本安装器。"
  Abort
kingo_core_cleanup_done:
!macroend
