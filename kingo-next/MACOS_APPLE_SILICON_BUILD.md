# KiNGO macOS Apple Silicon DMG 构建与发布方案

更新时间：2026-08-23

## 1. 目标与交付边界

本方案以当前唯一正式源码 `kingo-next` 为准，为 Apple Silicon（M1/M2/M3/M4
及后续 arm64 芯片）构建原生 `aarch64-apple-darwin` 应用和 DMG。Windows
x64 的 NSIS 构建保持原样。

本轮分两级交付：

1. **可安装测试版**：GitHub `macos-15` M1 runner 原生编译，使用 ad-hoc
   签名，生成可下载的 DMG 和 SHA-256 清单。
2. **公开发行版**：在测试版通过真机连接、断开和恢复验收后，加入 Apple
   Developer ID Application 签名、公证和 stapling，再与 Windows 安装包一起发布。

没有 Apple Developer 证书时，ad-hoc DMG 可用于测试，但 Gatekeeper 仍可能要求
用户在“隐私与安全性”中手动允许。它不能冒充已公证的正式发行版。

## 2. 源码审计结论

直接执行 `tauri build --bundles dmg` 不可行，原工程存在以下 Windows 绑定：

- 构建脚本只恢复和复制 `.exe`；
- 10 个代理/检测核心均使用 Windows 文件名；
- 系统代理通过注册表和 WinINet 修改；
- 网络请求写死 `curl.exe`、`NUL`，端口占用检查写死 `netstat.exe/tasklist.exe`；
- 设置页和托盘暴露 Windows 管理员、UWP 回环与 TUN 操作；
- npm `postinstall` 只能调用 Windows PowerShell。

本实现把上述路径平台化，同时避免改写现有 Windows 行为。Apple Silicon 首版使用
macOS HTTP/HTTPS 系统代理；TUN 暂不开放，因为可靠的 macOS TUN 需要单独设计
Network Extension、权限、签名 entitlement 和卸载恢复流程。

## 3. 构建架构

| 层级 | Windows x64 | macOS Apple Silicon |
| --- | --- | --- |
| Runner | `windows-latest` | `macos-15`（M1/arm64） |
| Rust target | `x86_64-pc-windows-msvc` | `aarch64-apple-darwin` |
| 安装器 | NSIS `.exe` | Tauri `.dmg` |
| 核心资源 | 分卷 ZIP +外部 SubsCheck | 官方 release 资产 +固定 SHA-256 |
| 系统代理 | 注册表 + WinINet | `networksetup` +一次管理员授权 |
| 测试签名 | 无 Windows 代码签名 | ad-hoc `-` |
| 正式签名 | 可选 Windows 证书 | Developer ID + Apple 公证 |

官方依据：Tauri 要求在 Mac 上用 `tauri build --bundles dmg` 生成 DMG；Apple
Silicon 从互联网运行的应用至少需要签名，ad-hoc 可用于开发测试；GitHub 当前
`macos-15` 标准 runner 是 M1/arm64。

- https://v2.tauri.app/distribute/dmg/
- https://v2.tauri.app/distribute/sign/macos/
- https://github.com/actions/runner-images#available-images

## 4. 可复现的核心资源

`core-assets/macos-arm64.json` 固定下载地址和 SHA-256，不使用会漂移的 `latest`
链接。构建时在完整哈希通过后才解压，并只复制清单声明的文件。

| 核心 | 固定版本 | Apple Silicon 文件 |
| --- | --- | --- |
| mihomo | v1.19.20 | `mihomo` |
| Xray | v26.3.27 | `xray` + `geoip.dat` + `geosite.dat` |
| sing-box | v1.13.13 | `sing-box` |
| Hysteria 2 | v2.9.2 | `hysteria2` |
| Hysteria 1 | v1.3.5 | `hysteria` |
| NaiveProxy | v148.0.7778.96-5 | `naive` |
| Juicity | v0.5.0 | `juicity-client` |
| Mieru | v3.33.0 | `mieru` |
| ShadowQUIC | v0.3.3 | `shadowquic` |
| SubsCheck | v1.6.2 | `subs-check` |

`scripts/restore-core-assets.mjs` 是跨平台入口：Windows 委托现有、已经验证的
PowerShell 恢复脚本；M1 runner 下载 macOS 清单。`scripts/prepare-core-payloads.mjs`
和 Rust `build.rs` 再按目标平台生成不可变 payload。应用首次使用时把 payload
释放到每版本独立的数据目录并设置 `0755` 执行权限。

## 5. macOS 系统代理事务

`system_proxy_macos.rs` 只处理当前默认网络接口对应的网络服务；无法映射默认接口时
才回退到所有已启用服务。连接过程如下：

1. 读取 HTTP、HTTPS、SOCKS 和 bypass 原值；
2. 如发现带认证的既有代理，停止操作，避免覆盖钥匙串中无法安全导出的密码；
3. 把完整备份原子写入
   `~/Library/Application Support/com.kingo.client/proxy-backup-macos.json`；
4. 通过一个 macOS 管理员授权事务启用 KiNGO HTTP/HTTPS 代理；
5. 断开、失败或下次启动发现本地端口失效时，恢复原值后删除备份。

该流程不会静默取得管理员权限，也不会把应用整体以 root 身份运行。

## 6. 执行命令

### Windows 回归

```powershell
npm.cmd run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings -A linker_messages
cargo test --manifest-path src-tauri/Cargo.toml
```

### Apple Silicon 本机

```bash
npm ci
npm run sign:cores:macos
npm run build
cargo clippy --manifest-path src-tauri/Cargo.toml \
  --target aarch64-apple-darwin --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --target aarch64-apple-darwin
npm run tauri -- build \
  --target aarch64-apple-darwin \
  --bundles dmg \
  --config src-tauri/tauri.macos-arm64.conf.json
```

DMG 预期位置：

```text
src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/
```

### GitHub Actions

`.github/workflows/macos-arm64.yml` 在 Pull Request 或手动触发时执行相同流程，随后：

- 用 `file` 确认主程序是 arm64；
- 用 `codesign --verify --deep --strict` 验证应用签名；
- 用 `hdiutil verify` 验证 DMG；
- 生成 `SHA256SUMS.txt`；
- 上传保留 14 天的 DMG artifact。

## 7. 正式签名、公证与发布

当前仓库没有 Apple 签名 secrets，因此 CI 测试版使用 `signingIdentity: "-"`。
正式发布前由 Apple Developer Account Holder 提供以下 GitHub Secrets：

- `APPLE_CERTIFICATE`：Developer ID Application `.p12` 的 Base64；
- `APPLE_CERTIFICATE_PASSWORD`：导出密码；
- `APPLE_SIGNING_IDENTITY`：证书 identity；
- `APPLE_API_ISSUER`、`APPLE_API_KEY`、`APPLE_API_KEY_PATH`，或 Tauri 支持的
  Apple ID 公证凭据组合；
- 现有 `TAURI_SIGNING_PRIVATE_KEY` 继续用于 Tauri updater 产物签名。

正式工作流必须先用同一 Developer ID 对 10 个内嵌 Mach-O 核心签名，再签应用，
提交 Apple 公证并 stapling。Apple secrets 未配置或公证失败时，工作流必须失败，
不得降级后继续上传“正式版”。

## 8. 发布门禁

只有以下项目全部通过，才把 macOS job 合入现有 tag release：

- M1 runner：前端、fmt、clippy、Rust 测试、DMG 构建全部通过；
- 产物：主程序和 10 个核心均为 arm64，签名与 `hdiutil verify` 通过；
- 真机：安装、首次打开、管理员授权、连接、测速、流量、切线、断开均通过；
- 恢复：连接失败、强制退出、重启应用、切换 Wi-Fi 后原代理设置均可恢复；
- 节点：用户显式启动 SubsCheck，停止任务不会误杀外部进程；
- 正式版：Developer ID、notarization、stapling、Gatekeeper 验证通过；
- 更新：`latest.json` 同时包含 Windows x64 和 Darwin arm64，不发生平台覆盖。

## 9. 已知限制

- 当前是 Apple Silicon 原生版，不包含 Intel x64/universal binary。
- 首版不开放 TUN；所有可用线路通过系统代理工作。
- ad-hoc artifact 仅用于测试，不能替代 Apple 公证。
- Windows 主机不能生成或验证真实 DMG；最终产物证据必须来自 M1 runner 或真机。
- 公共节点完整检测会访问固定 65 个来源，构建和自动测试不会替用户启动该任务。

## 10. 本轮执行记录

- Windows 前端生产构建：通过；
- Windows Rust clippy：通过；
- Windows Rust 测试：59 passed；
- macOS 资源清单：12 个文件完成 SHA-256 校验，其中 10 个可执行文件均具有
  arm64 Mach-O magic；
- M1 DMG：由 Pull Request CI 生成后在此补充 run、artifact、文件大小和 SHA-256。
