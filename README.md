# KiNGO

<p align="center">
  <strong>Windows 网络代理管理桌面客户端</strong>
</p>

<p align="center">
  集成 9 种主流代理核心，一键连接，系统级代理支持，便携式 Chrome 浏览器
</p>

---

## 功能特性

### 核心功能

- **9 合 1 代理集成** — 内置 Clash.Meta、Xray、Hysteria v1/v2、Sing-Box、NaiveProxy、Juicity、Mieru、ShadowQUIC，无需手动安装
- **仪表盘一键连接** — 仿快连风格 UI，大圆形连接按钮，线路卡片可视化切换
- **系统级代理** — 支持 Windows 系统代理设置（全局模式 / 规则模式），所有浏览器均可使用
- **规则模式** — 国内网站直连，国外网站走代理，基于 PAC 智能分流
- **全局模式** — 整台电脑所有流量通过代理
- **便携式 Chrome** — 内置 Chromium 浏览器，即开即用，不留历史记录

### 配置管理

- **Monaco 编辑器** — 集成 VS Code 同款代码编辑器，语法高亮、自动补全
- **多线路 IP 更新** — 支持下载多个线路配置，一键切换、自动更新
- **延迟测试** — 混合测速模式（TCP 握手 + 真实代理 HTTP 测速），UDP 代理智能识别

### 其他特性

- **亮色 / 暗色主题** — 全局切换，35 个颜色变量自适应
- **系统托盘** — 最小化到托盘，右键菜单快捷操作
- **开机自启** — 支持 Windows 开机自动启动
- **自动更新** — 基于 electron-updater，GitHub Releases 自动推送
- **日志查看器** — 实时日志，支持按代理核心筛选
- **无边框窗口** — 自定义标题栏，现代化视觉效果

---

## 支持的代理核心

| 核心 | 协议 | 传输层 | 本地端口 |
|------|------|--------|----------|
| **Clash.Meta** | 多协议（HTTP/SOCKS5） | TCP/UDP | 7890 |
| **Xray** | VLESS/VMess/Trojan | TCP | 1080 |
| **Hysteria v1** | 自研 QUIC | UDP/QUIC | 1080 |
| **Hysteria v2** | 自研 QUIC v2 | UDP/QUIC | 1080 |
| **Sing-Box** | TUIC/Hysteria2 | UDP/QUIC | 1080 |
| **NaiveProxy** | HTTPS/HTTP2 | TCP | 1080 |
| **Juicity** | 自研 QUIC | UDP/QUIC | 1080 |
| **Mieru** | 自研 TCP | TCP | 1080 |
| **ShadowQUIC** | 自研 QUIC | UDP/QUIC | 1080 |

---

## 技术栈

| 层 | 技术 |
|----|------|
| **桌面框架** | Electron 28 |
| **前端** | React 18 + TypeScript |
| **UI 组件库** | Ant Design 5 |
| **构建工具** | electron-vite |
| **代码编辑器** | Monaco Editor |
| **配置解析** | js-yaml |
| **持久化存储** | electron-store |
| **自动更新** | electron-updater |
| **打包分发** | electron-builder (NSIS) |

---

## 项目结构

```
KiNGO/
├── app/                          # Electron 应用
│   ├── main/                     # 主进程
│   │   ├── index.ts              # 入口，窗口管理，IPC 注册
│   │   ├── proxy-manager.ts      # 代理核心生命周期管理
│   │   ├── config-service.ts     # 配置文件读写与解析
│   │   ├── latency-tester.ts     # 延迟测试（TCP + HTTP 代理）
│   │   ├── system-proxy.ts       # Windows 系统代理（注册表操作）
│   │   ├── pac-server.ts         # PAC 文件 HTTP 服务器
│   │   ├── ip-updater.ts         # 线路 IP 更新与槽位管理
│   │   ├── ipc-handlers.ts       # IPC 通信处理
│   │   ├── settings-store.ts     # 用户设置持久化
│   │   ├── log-service.ts        # 日志收集
│   │   ├── tray-manager.ts       # 系统托盘
│   │   ├── chrome-launcher.ts    # 便携浏览器启动
│   │   └── updater.ts            # 自动更新
│   ├── preload/                  # 预加载脚本（contextBridge）
│   └── renderer/src/             # 渲染进程
│       ├── components/
│       │   ├── Dashboard/        # 仪表盘（连接、线路、代理模式切换）
│       │   ├── Settings/         # 设置页
│       │   ├── NodeManager/      # 节点管理（IP 更新 + 测速）
│       │   ├── ConfigEditor/     # 配置编辑器（Monaco）
│       │   ├── LogViewer/        # 日志查看器
│       │   ├── Layout/           # 侧边栏布局 + 自定义标题栏
│       │   └── UpdateNotification/ # 更新通知
│       ├── hooks/                # 自定义 Hook
│       └── services/             # IPC 客户端封装
├── clash.meta/                   # Clash.Meta 代理核心
├── Xray/                         # Xray 代理核心
├── hysteria/                     # Hysteria v1 代理核心
├── hysteria2/                    # Hysteria v2 代理核心
├── singbox/                      # Sing-Box 代理核心
├── naiveproxy/                   # NaiveProxy 代理核心
├── juicity/                      # Juicity 代理核心
├── mieru/                        # Mieru 代理核心
├── shadowquic/                   # ShadowQUIC 代理核心
├── Browser/                      # 便携式 Chrome
└── .github/workflows/            # CI/CD 自动发布
```

---

## 开发指南

### 环境要求

- **Node.js** >= 20
- **npm** >= 10
- **Windows** 10/11 x64
- **Git**

### 克隆仓库

```bash
git clone https://github.com/KINGHY02/KiNGO.git
cd KiNGO
```

### 安装依赖

```bash
cd app
npm install
```

### 开发模式

```bash
npm run dev
```

Electron 窗口会自动打开，渲染进程支持热重载，主进程修改需手动刷新。

### 构建安装包

```bash
npm run dist
```

输出在 `app/dist/` 目录，生成 NSIS 安装包（`.exe`）。

---

## 代理配置

每个代理核心目录下都有一个配置文件，可以在应用内通过配置编辑器直接修改：

| 代理 | 配置文件 | 格式 |
|------|----------|------|
| Clash.Meta | `clash.meta/config.yaml` | YAML |
| Xray | `Xray/config.json` | JSON |
| Hysteria v1 | `hysteria/config.json` | JSON |
| Hysteria v2 | `hysteria2/config.yaml` | YAML |
| Sing-Box | `singbox/config.json` | JSON |
| NaiveProxy | `naiveproxy/config.json` | JSON |
| Juicity | `juicity/config.json` | JSON |
| Mieru | `mieru/config.json` | JSON |
| ShadowQUIC | `shadowquic/config.json` | JSON |

也可以通过**节点管理**页面的 IP 更新功能，从远程下载新配置。

---

## 自动更新

软件基于 `electron-updater` 自动检测 GitHub Releases 中的新版本：

- 启动时自动检查更新（可在设置中关闭）
- 发现新版本后弹出通知，用户手动点击下载
- 下载完成后提示安装，点击即退出并运行安装程序
- 支持自定义更新镜像地址（设置页可配置）

### 发版流程

```bash
cd app
npm version patch          # 或 minor / major
git push origin master --tags
```

推送 tag 后，GitHub Actions 会自动：
1. 下载代理核心二进制包
2. 安装依赖
3. 构建完整 NSIS 安装包
4. 创建 Release 并上传 `.exe` 安装包和 `latest.yml`

用户下次启动软件时会收到更新通知。

---

## 系统代理原理

### Clash.Meta（HTTP 代理）

Clash.Meta 内置 HTTP 代理（端口 `7890`），可直接写入 Windows 系统代理注册表：

```
HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings
  ProxyEnable = 1
  ProxyServer = 127.0.0.1:7890
```

规则模式由 Clash.Meta 内部规则引擎处理分流；全局模式将所有流量转发至代理出口。

### SOCKS5 代理（Xray、Hysteria 等）

Windows 系统代理原生不支持 SOCKS5，需通过 PAC（Proxy Auto-Config）桥接：

1. 软件启动本地 PAC HTTP 服务器
2. 系统代理设置为 PAC URL：`http://127.0.0.1:{port}/proxy.pac`
3. 浏览器请求 PAC 文件，根据模式决定路由：
   - **规则模式**：国内域名（百度、淘宝、京东等）直连，其余走 SOCKS5
   - **全局模式**：所有请求走 SOCKS5 代理

> **注意**：Windows 注册表代理设置影响 Chrome、Edge 等 WinINET 浏览器，不影响 Firefox（需单独配置）和命令行工具（curl、git 等）。

---

## 贡献

本项目采用 **MIT License** 发布，欢迎提交 Issue 和 Pull Request。

---

## 免责声明

1. 本软件仅供学习、研究及个人合法使用，严禁用于任何违法违规活动
2. 使用者应遵守所在国家/地区的法律法规，因违规使用产生的任何法律责任由使用者自行承担
3. 本软件不提供任何代理服务，所有代理节点均需用户自行配置
4. 作者不对因使用本软件造成的任何直接或间接损失承担责任

---

## 许可

MIT License &copy; KINGHY02
