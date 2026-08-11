<div align="center">
  <img src="./kingo-next/src/assets/kingo-logo.png" alt="KiNGO Logo" width="112" />
  <h1>KiNGO</h1>
  <p>面向 Windows 的多核心网络连接与代理管理客户端</p>

  [![Release](https://img.shields.io/github/v/release/KINGHY02/KiNGO?display_name=tag&sort=semver)](https://github.com/KINGHY02/KiNGO/releases/latest)
  [![Windows](https://img.shields.io/badge/Windows-x64-1677ff?logo=windows11)](https://github.com/KINGHY02/KiNGO/releases/latest)
  [![Tauri 2](https://img.shields.io/badge/Tauri-2-24c8db?logo=tauri)](https://v2.tauri.app/)

  [下载最新版](https://github.com/KINGHY02/KiNGO/releases/latest) · [提交问题](https://github.com/KINGHY02/KiNGO/issues) · [Telegram](https://t.me/kingovpn)
</div>

## 项目简介

KiNGO 2.0 使用 **Tauri 2 + Rust + React + TypeScript** 构建。仓库只维护 [`kingo-next`](./kingo-next) 新架构；安装包、软件内更新与 GitHub Actions 均以该目录为唯一源码入口。

当前版本采用单一的统一线路工作流，不再提供 Clash 模式或 V2ray 模式入口。用户只需选择线路并连接，KiNGO 会在后台管理不同网络核心的启动、检测、切换与清理。

## 主要功能

### 统一连接

- 首页一键连接，未指定线路时自动筛选并选择当前可用的最佳线路。
- 支持规则代理与全局代理切换，并可在连接期间立即应用。
- 展示当前线路、延迟、出口 IP、国家或地区、实时上传下载速度及累计流量。
- 支持刷新出口信息、查看连接详情、主动断开和取消正在进行的连接。

### 线路管理

- 查看内置公共线路及其状态、延迟、质量、成功率和最近测试时间。
- 支持单条线路测速、全部线路并行测速、取消测速和使用推荐线路。
- 支持在线更新线路配置、取消更新和刷新本地线路列表。
- 已连接时可以验证并切换到其他可用线路。
- 可启用线路故障自动切换，在当前线路异常时重新选择可用线路。

### 设置与维护

- 可配置延迟测速地址、备用地址、下载测速地址、超时时间和并发数量。
- 支持系统代理和 TUN 连接；TUN 仅对界面标记为兼容的线路开放。
- 支持 Microsoft Store 应用的本地代理回环兼容设置。
- 可检查、更新或恢复内置网络核心，并检查和安装 KiNGO 软件更新。
- 提供亮色、暗色、樱花粉和冰川蓝主题，可关闭界面动效。

### 桌面与运行安全

- 单实例运行，重复启动会唤醒已有窗口。
- 关闭主窗口后驻留系统托盘，可从托盘重新打开或退出。
- 所有代理核心、系统命令和探测命令均以隐藏窗口方式启动，不弹出控制台。
- 正常退出、连接取消、核心崩溃和下次启动恢复共用系统代理清理链路。
- 内置核心可检测版本、在线更新，也可以随时恢复安装包自带版本。

## 下载与安装

前往 [GitHub Releases](https://github.com/KINGHY02/KiNGO/releases/latest) 下载：

```text
KiNGO-Setup-<版本号>-x64.exe
```

安装器支持简体中文与英文，会自动跟随 Windows 显示语言。KiNGO 当前提供未签名的社区构建，因此 Windows 首次运行时可能显示 SmartScreen 提示；请只从本仓库的 Releases 页面下载安装包。

系统要求：

- Windows 10 / 11 x64
- Microsoft Edge WebView2 Runtime（多数受支持的 Windows 已预装）
- 使用系统代理模式通常不需要管理员权限；部分高级网络能力可能需要提升权限

## 快速使用

1. 直接在首页点击“连接”，由 KiNGO 自动选择当前可用的最佳线路。
2. 如需指定线路，进入“线路”页面测速并选择可用项。
3. 根据使用场景在首页切换“规则”或“全局”代理。
4. 遇到连接问题时，查看“日志”以及当前线路、系统代理和出口状态。

## 数据与隐私

- KiNGO 不要求注册账号，当前不提供云同步。
- 线路选择、运行配置、测速记录和日志保存在本机应用数据目录。
- KiNGO 会按用户操作访问连通性测试地址、GitHub Releases 和公共线路来源。
- 公共线路由第三方公开来源提供，其可用性、速度、稳定性和安全性不由 KiNGO 保证。

默认数据目录：

```text
%APPDATA%\com.kingo.client
```

## 从源码构建

准备 Node.js 20、Rust stable（MSVC 工具链）、Microsoft C++ Build Tools 和 WebView2 开发环境，然后执行：

```powershell
cd kingo-next
npm ci
npm run check
npm test
npm run bundle
```

`npm ci` 会校验仓库中的核心资源分片并自动还原 `src-tauri\resources\cores`，无需手工下载核心。

本地 NSIS 安装包输出到：

```text
kingo-next\src-tauri\target\release\bundle\nsis\
```

重新生成安装器素材和 Windows 图标：

```powershell
npm run assets:installer
npm run tauri -- icon src-tauri/icons/app-icon-source.png
```

## 项目结构

```text
kingo-next/
├─ core-assets/               内置核心压缩包分片与校验清单
├─ src/                       React 用户界面
├─ src-tauri/src/             Rust 服务、核心生命周期和系统代理
├─ src-tauri/resources/       内置核心与公共线路配置
├─ src-tauri/installer/       NSIS / WiX 文案与视觉素材
└─ scripts/                   安装器素材生成脚本
```

GitHub Actions 会在拉取请求中验证 Windows 安装包构建，并在推送 `v*` tag 时创建 Release、构建 NSIS 安装包并上传产物。

仓库默认分支为 `master`。功能开发、文档和发布配置都以该分支为准，历史版本通过 [Releases](https://github.com/KINGHY02/KiNGO/releases) 与 Git 标签保留。

## 当前边界

- 当前正式构建仅面向 Windows x64。
- 当前产品界面采用统一线路工作流，不提供 Clash 或 V2ray 独立模式。
- TUN 仅适用于受支持的线路核心；其他线路继续使用系统代理。
- 软件功能不等同于代理服务。KiNGO 不运营、不销售、也不提供代理线路。

## 反馈

- [GitHub Issues](https://github.com/KINGHY02/KiNGO/issues)
- [Telegram 交流](https://t.me/kingovpn)

请遵守所在国家或地区的法律法规，仅在合法场景中使用 KiNGO。
