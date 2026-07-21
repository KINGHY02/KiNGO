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

KiNGO 2.0 已迁移到 **Tauri 2 + Rust + React + TypeScript**。当前正式构建来自 [`kingo-next`](./kingo-next)，仓库中的旧 Electron 工程仅用于历史参考，不参与 2.0 安装包构建。

KiNGO 提供三种彼此独立的使用入口：

| 模式 | 适用场景 | 主要能力 |
| --- | --- | --- |
| 全自动 | 希望快速选择并连接公共线路 | 批量测速、线路更新、自动优选、故障自动切换、出口 IP 与实时流量 |
| Clash | 使用 Clash / Mihomo 订阅或 YAML | 订阅与本地配置、代理组、节点切换与测速、Provider、规则、连接、实时日志 |
| V2ray | 使用 v2rayN 风格节点与订阅 | 分组与订阅、完整节点编辑、批量管理、去重排序、分享/二维码、真实代理测速 |

## 主要功能

### 全自动模式

- 一键测试和选择公共线路，支持自定义测速地址、超时与并发数。
- 连接失败或核心异常退出时恢复原 Windows 系统代理。
- 可选线路故障自动切换，并记录每次检测与切换结果。
- 展示当前线路、核心、延迟、出口 IP、国家/地区和实时流量。

### Clash / Mihomo 模式

- 导入远程订阅或本地 YAML，保存前执行 YAML 与 Mihomo 完整校验。
- 编辑原始配置、查看只读运行配置、批量更新和批量删除。
- 查看代理组，选择节点，执行单节点或整组延迟测试。
- 管理 Proxy Provider，支持更新与健康检查。
- 查看规则、活动连接、连接详情和本次运行的已关闭连接。
- 通过 Mihomo WebSocket 接收流量、连接和日志，断线时自动降级与重连。
- 管理局域网访问、IPv6、统一延迟和 Windows 系统代理状态。

### V2ray 模式

- 导入常见分享链接，并通过 SQLite 在本机持久化节点、订阅和测速结果。
- 支持节点新增、编辑、复制、分组移动、拖放排序、批量删除和去重。
- 支持订阅新增、编辑、启停、更新计划、名称过滤和批量更新。
- 支持 TCP 可达性测试与通过临时核心执行的真实代理测速。
- 支持分享链接、批量导出和二维码展示。
- 根据节点能力生成 Xray 或 sing-box 配置，端口就绪后再接管系统代理。

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

1. 只想快速体验时，在“全自动”模式测试线路并选择可用项。
2. 已有 Clash 订阅时，在“Clash → 订阅”中导入并启动配置。
3. 已有节点或 v2rayN 订阅时，在“V2ray → 配置项 / 订阅分组”中导入。
4. 遇到连接问题时，先查看“日志”以及当前核心、系统代理和出口状态。

## 数据与隐私

- KiNGO 不要求注册账号，当前不提供云同步。
- 订阅地址、私有节点、运行配置、SQLite 数据库和日志保存在本机应用数据目录。
- KiNGO 会按用户操作访问订阅地址、连通性测试地址、GitHub Releases 和公共线路来源。
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
├─ src/                       React 用户界面
├─ src-tauri/src/             Rust 服务、核心生命周期和系统代理
├─ src-tauri/resources/       内置核心与公共线路配置
├─ src-tauri/installer/       NSIS / WiX 文案与视觉素材
└─ scripts/                   安装器素材生成脚本
```

GitHub Actions 会在拉取请求中验证 Windows 安装包构建，并在推送 `v*` tag 时创建 Release、构建 NSIS 安装包并上传产物。

## 当前边界

- 当前正式构建仅面向 Windows x64。
- 2.0 以系统代理连接为主；完整 TUN、PAC 和高级 DNS 编辑能力仍在后续迭代中。
- 软件功能不等同于代理服务。KiNGO 不运营、不销售、也不提供代理线路。

## 反馈

- [GitHub Issues](https://github.com/KINGHY02/KiNGO/issues)
- [Telegram 交流](https://t.me/kingovpn)

请遵守所在国家或地区的法律法规，仅在合法场景中使用 KiNGO。
