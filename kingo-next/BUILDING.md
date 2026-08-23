# KiNGO 构建与打包

本目录是 KiNGO 当前唯一正式产品源码。版本号以 `package.json` 与
`src-tauri/tauri.conf.json` 为准，不要从旧 Electron 工程构建发行版。

## 软件范围

- React + TypeScript 界面：`src/`
- Tauri + Rust 后端：`src-tauri/src/`
- 内置连接核心：`src-tauri/resources/cores/`
- 安装载荷：构建时生成到 `src-tauri/resources/core-payloads/`
- 公共线路、规则、许可证、图标与安装器资源：`src-tauri/resources/`、`src-tauri/icons/`、`src-tauri/installer/`
- GitHub 自动发布：仓库根目录 `.github/workflows/release.yml`

## 本地命令

```powershell
E:\KiNGO\build-current.ps1 -Mode verify
E:\KiNGO\build-current.ps1 -Mode package
```

安装包和 SHA-256 清单输出到：

```text
E:\KiNGO\product-main\kingo-next\artifacts\v<版本号>\
```

本地安装包使用 `tauri.pr.conf.json`，不会生成软件更新签名文件。正式标签由
GitHub Actions 使用仓库 Secrets 中的私钥生成签名及 `latest.json`。

发布前必须确认工作树、版本号、完整构建、安装、连接、TUN、托盘和更新功能；
用户确认前不要创建标签或推送新版本。

## macOS Apple Silicon

Apple Silicon 原生 DMG 的源码适配、固定核心资源、M1 CI、签名/公证门禁和已知限制见：

```text
MACOS_APPLE_SILICON_BUILD.md
```

当前 macOS 工作流生成 ad-hoc 签名的测试 artifact；未配置 Developer ID 和 Apple
公证凭据前，不得把该 artifact 作为正式公开发行版。
