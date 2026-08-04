# KiNGO 2.0

这里是 KiNGO 当前正式架构：Tauri 2、Rust、React 19、TypeScript 和 Vite。

完整的产品介绍、安装说明和功能清单请查看[仓库主 README](../README.md)。

## 开发命令

```powershell
npm ci
npm run dev
npm run check
npm test
npm run bundle
```

`npm ci` 会根据 `core-assets/manifest.json` 校验并还原构建所需的内置核心。

`npm run bundle` 会构建 Windows x64 NSIS 安装包，输出目录为：

```text
src-tauri\target\release\bundle\nsis\
```

正式发布同时生成 Tauri 软件内更新包、`.sig` 签名和 `latest.json`。更新签名私钥不得进入仓库：

- 本机私钥默认保存在 `%USERPROFILE%\.kingo-signing\kingo-updater.key`，仅当前 Windows 用户可读取。
- GitHub 仓库需配置 `TAURI_SIGNING_PRIVATE_KEY` Secret，内容为私钥文件全文。
- 当前私钥未设置密码，`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 可留空；如后续轮换为加密私钥，应同步配置密码 Secret。
- 私钥丢失后，已安装版本无法验证新密钥签发的更新；发布前必须离线备份。

本地签名构建可在当前 PowerShell 会话设置：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$env:USERPROFILE\.kingo-signing\kingo-updater.key" -Raw
npm run bundle
```

Pull Request 构建使用 `src-tauri/tauri.pr.conf.json` 关闭更新产物生成，因此不会向不受信任的PR暴露发布私钥。

如需重新生成安装器图片和应用图标：

```powershell
npm run assets:installer
npm run tauri -- icon src-tauri/icons/app-icon-source.png
```

## 目录

```text
src/                       React 用户界面
core-assets/               内置核心压缩包分片与校验清单
src-tauri/src/             Rust 后端与系统集成
src-tauri/resources/       内置核心和线路配置
src-tauri/installer/       安装器文案与视觉素材
scripts/                   可重复执行的素材生成脚本
```

用户订阅、私有节点、SQLite 数据库和运行日志只应写入系统应用数据目录，不得加入源码或公开构建上下文。
