# KiNGO Windows 与 macOS 受控自动发布方案

更新时间：2026-08-27

## 1. 决策

KiNGO 采用“源码推送自动验证，人工决定版本，工作流完成构建与发布”的模式：

- Pull Request 和 `master` 源码推送自动构建 Windows x64 NSIS 与 macOS
  Apple Silicon DMG 测试产物，不创建 Tag 或 Release；
- 正式发布由默认分支上的 `Publish KiNGO Windows and macOS` 工作流手动触发；
- 操作者必须输入稳定版号 `X.Y.Z` 和确认词；
- Windows 和 macOS 从同一个完整 Git SHA 构建；
- 两端签名、测试、安装包检查、Apple 公证和统一更新元数据全部通过后，最后一个
  job 才创建 `vX.Y.Z` Tag 与 GitHub Release；
- 默认创建 Draft Release。只有明确选择 `public` 并输入 `PUBLISH`，才直接公开。

不采用“每次推送 `master` 就自动增加版本并公开 Release”。普通提交可能只是文档、
重构或中间状态，不能自动消耗正式版本号和生产签名凭据。

## 2. 目标与非目标

### 目标

1. 保证 Windows 和 macOS 安装包可追溯到同一个源码提交。
2. 自动生成 Windows 安装器、macOS DMG、两端更新包签名、统一
   `latest.json`、SHA-256 清单和构建来源清单。
3. 正式 macOS 产物必须经过 Developer ID 签名、Apple 公证、stapling 和
   Gatekeeper 检查，不能降级为 ad-hoc 正式版。
4. 构建 job 默认只有只读权限；只有最后的 Release job 可写仓库内容。
5. 失败时不创建公开 Release；失败产物仅保留在 Actions 中供诊断。

### 非目标

- 不在 CI 中自动运行 65 来源公共节点完整扫描；
- 不替用户生成、上传或读取 Apple Developer 私钥；
- 不在本方案中实现 Windows Authenticode 证书签名；现有 Tauri 更新签名仍会生成，
  但首次运行 Windows 安装器仍可能出现 SmartScreen 提示；
- 不在未完成真机验收前把 ad-hoc DMG 作为公开发行版。

## 3. 工作流结构

```text
Pull Request / push master
        │
        ├─ Windows x64：测试 + NSIS 测试安装包 → Actions Artifact
        └─ macOS arm64：测试 + ad-hoc DMG       → Actions Artifact

手动 Publish KiNGO Windows and macOS
        │
        ├─ Preflight
        │    ├─ 必须从 master 运行
        │    ├─ 确认词与发布模式匹配
        │    ├─ package.json / package-lock.json / Cargo.toml /
        │    │  tauri.conf.json 版本完全一致
        │    └─ 版本必须高于已有稳定 Tag
        │
        ├─ Reusable Windows release build
        │    ├─ fmt / clippy / Rust tests
        │    ├─ NSIS + Tauri updater signature
        │    └─ Windows build report + SHA-256
        │
        ├─ Reusable macOS production build
        │    ├─ macos-production Environment
        │    ├─ Developer ID 导入临时 Keychain
        │    ├─ 10 个内置 arm64 核心签名
        │    ├─ DMG + updater app.tar.gz
        │    ├─ notarization / stapling / Gatekeeper
        │    └─ macOS signing report + SHA-256
        │
        └─ release-production Environment
             ├─ 汇总并验证两个 Artifact
             ├─ 生成双平台 latest.json
             ├─ 生成 RELEASE-MANIFEST.json 与 SHA256SUMS.txt
             ├─ 生成 GitHub artifact attestation
             └─ 创建新 Tag 与 Draft/Public GitHub Release
```

## 4. 触发与权限

| 场景 | 触发 | 凭据 | 仓库写权限 | 结果 |
| --- | --- | --- | --- | --- |
| PR | 自动 | 无生产凭据 | 无 | 检查和测试安装包 |
| `master` push | 自动 | 无生产凭据 | 无 | 可下载的快照安装包 |
| 正式 Draft | 手动，`draft` + `RELEASE` | 更新签名与 Apple 凭据 | 仅最终 job | 新 Tag + Draft Release |
| 正式公开 | 手动，`public` + `PUBLISH` | 更新签名与 Apple 凭据 | 仅最终 job | 新 Tag + Public Release |

正式入口必须使用 `workflow_dispatch`，并且只能从 `master` 运行。构建 job 使用
`contents: read`；最后的 Release job 才使用 `contents: write`、
`id-token: write` 和 `attestations: write`。

## 5. 版本和 Tag 规则

- 输入只接受稳定 SemVer：`X.Y.Z`，不接受前导 `v`、预发布后缀或自由文本；
- 以下文件必须与输入完全一致：
  - `package.json`；
  - `package-lock.json` 顶层与根 package；
  - `src-tauri/Cargo.toml`；
  - `src-tauri/tauri.conf.json`；
- `vX.Y.Z` 不得已经存在；
- 新版本必须严格高于仓库中最高稳定 Tag；
- Release 必须指向工作流验证过的完整 SHA，不允许重新使用或移动已发布 Tag。

## 6. 正式产物契约

一个完整 Release 至少包含：

```text
KiNGO-Setup-X.Y.Z-x64.exe
KiNGO-Setup-X.Y.Z-x64.exe.sig
KiNGO-X.Y.Z-macOS-arm64.dmg
KiNGO-X.Y.Z-macOS-arm64.app.tar.gz
KiNGO-X.Y.Z-macOS-arm64.app.tar.gz.sig
WINDOWS-BUILD-REPORT.txt
MACOS-SIGNING-REPORT.txt
WINDOWS-SHA256SUMS.txt
MACOS-SHA256SUMS.txt
RELEASE-MANIFEST.json
SHA256SUMS.txt
latest.json
```

DMG 用于首次安装；`.app.tar.gz` 及其 `.sig` 用于 Tauri macOS 软件内更新。
`latest.json` 必须同时包含：

```text
windows-x86_64
darwin-aarch64
```

任何文件缺失、大小异常、签名为空、构建报告 SHA 不一致或平台条目不完整，最终发布
job 都必须失败。

## 7. Secrets 与 Environments

### Repository Secret

- `TAURI_SIGNING_PRIVATE_KEY`：两端 Tauri updater 签名私钥；
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：可选，私钥有密码时配置。

### `macos-production` Environment

建议启用 Required reviewers，并配置：

- `APPLE_CERTIFICATE`；
- `APPLE_CERTIFICATE_PASSWORD`；
- `APPLE_SIGNING_IDENTITY`（可选）；
- `APPLE_API_ISSUER`；
- `APPLE_API_KEY`；
- `APPLE_API_PRIVATE_KEY`。

### `release-production` Environment

建议启用 Required reviewers，不需要存放 Apple 私钥。它保护最后的 Tag/Release
创建 job。Environment 应只允许 `master` 部署。

Apple `.p12`、密码和 `.p8` 不能写入源码、Artifact、Release、日志或计划文档。
工作流只在临时 Keychain 和 Runner 临时目录使用，并在 `always()` 清理。

## 8. 失败、重试与恢复

- Preflight 失败：不启动昂贵的双平台构建；修正版本或分支后重新运行。
- Windows 或 macOS 失败：最终 Release job 不运行，不创建 Tag。
- Apple Secrets 缺失或证书类型错误：macOS job 立即失败，不上传伪正式产物。
- Release 上传过程中失败：GitHub CLI 先使用 Draft 组装资产；检查 Draft 后再重试，
  不覆盖已公开 Release。
- 已发布版本发现问题：发布更高版本，不移动旧 Tag、不覆盖旧资产。
- Actions 网络中断不代表构建失败，应读取 job 结论并核对实际 Release 资产。

## 9. 安全与供应链要求

- workflow Action 固定到完整提交 SHA；
- 第三方 Action 只在必要时使用；
- PR job 不接触签名私钥；
- Release job 使用最小 `GITHUB_TOKEN` 权限；
- 正式资产生成 GitHub artifact attestation；
- 所有下载的 macOS 核心继续使用固定 URL 与 SHA-256 清单；
- `SHA256SUMS.txt`、构建报告与 `RELEASE-MANIFEST.json` 一起上传；
- 对 `.github/workflows/**` 建议配置 CODEOWNERS 审核。

## 10. 实现文件

- `.github/workflows/release.yml`：Windows PR/master 快照构建，同时作为正式发布的
  reusable workflow；
- `.github/workflows/macos-arm64.yml`：macOS PR/master ad-hoc 快照构建；
- `.github/workflows/macos-arm64-notarized.yml`：独立公证构建，同时作为正式发布的
  reusable workflow；
- `.github/workflows/release-all.yml`：版本门禁、双端编排、统一元数据、Tag/Release；
- `scripts/release-tools.mjs`：版本一致性、资产契约、`latest.json`、manifest 和
  checksum；
- `src-tauri/tauri.macos-arm64.notarized.conf.json`：正式 DMG 与 macOS updater
  artifact 配置。

## 11. 验收清单

- [x] 发布辅助脚本 self-test 通过；
- [x] 当前源码版本一致性检查通过；
- [x] 所有 JSON 配置可解析；
- [x] 所有 workflow YAML 可解析，内嵌 Bash 语法通过；
- [x] Windows 前端、fmt、clippy、Rust tests 通过；
- [ ] PR 上 Windows、macOS 和发布策略检查通过；
- [ ] `macos-production` 已配置 Apple Secrets 和审核；
- [ ] `release-production` 已配置审核；
- [ ] 首次使用 `draft` 模式完成真实双平台发布演练；
- [ ] 下载 Draft 资产，复算 SHA-256 并验证 `latest.json` 两个平台；
- [ ] Apple Silicon 真机完成安装、启动、连接、断开、代理恢复和软件更新验收；
- [ ] 经人工确认后发布 Draft；连续稳定发布后再考虑默认公开模式。

## 12. 当前执行边界

本方案的源码与 CI 实现可在功能分支完成并由 PR 验证。以下动作仍需仓库所有者执行
或明确授权：

1. 在 GitHub Settings 中创建并保护两个 Environments；
2. 在 `macos-production` 中录入 Apple Secrets；
3. 合并包含工作流的 PR 到默认分支；
4. 将应用版本提升到尚未使用的新版本；
5. 首次运行正式发布工作流并完成 Environment 审批；
6. 在 Apple Silicon 真机验收 Draft 后公开 Release。

没有 Apple Developer 凭据时，可以继续获得 ad-hoc 测试 DMG，但正式工作流必须失败，
不能自动降级。

## 13. 本轮执行记录

2026-08-27 已完成以下本地验证：

- `npm run release:self-test` 通过，能够生成并验证双平台 `latest.json`、manifest 和
  checksum；
- 当前 `2.0.8` 在五处源码版本文件中一致；重复使用已有 `v2.0.8` 和输入非法版本
  `2.0` 均被门禁拒绝；
- `actionlint`、workflow 内嵌 Bash 语法和 PowerShell AST 检查通过；
- `npm run build` 通过；
- `cargo fmt --check` 与严格 Clippy 门禁通过；
- `cargo test` 通过，共 61 项测试，0 项失败。

GitHub Environments、Apple 凭据、PR 合并、版本升级、正式 Tag 和 Release 均未在本轮
执行；它们继续受第 12 节边界约束。
