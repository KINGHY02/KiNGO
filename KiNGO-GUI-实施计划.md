# KiNGO Windows 桌面客户端 — 完整实施计划

---

## 一、项目背景

`e:\KiNGO` 是一个便携式 Windows 网络代理工具包，集成了 **9 个代理核心** + 便携版 Chrome。目前用户只能通过带编号的 `.cmd` 终端脚本操作——对非技术用户极不友好。

**目标：** 不动现有文件，新增 `app/` 构建 Electron 桌面应用。**前 6 个阶段全部在 `npm run dev` 本地热重载模式下开发验证**，最后阶段才打包为 Windows NSIS 安装包。类似 Clash Verge、Clash Party 这种可以像正常软件一样安装使用的桌面应用。

---

## 二、开发理念：先跑稳，再打包

```
┌─────────────────────────────────────────────────────┐
│  阶段 1-6（14天）           │  阶段 7（2天）        │
│  npm run dev 热重载开发     │  npm run build 一次性  │
│  改代码 → 秒级刷新 → 验证   │  构建 NSIS .exe 安装包 │
│  无需反复打包调试           │  桌面快捷方式 + 卸载   │
└─────────────────────────────────────────────────────┘
```

和 Clash Verge 的开发方式完全一样：本地 `pnpm dev` 跑起来 → 所有功能验证通过 → 最后 `pnpm build` 出包。

---

## 三、技术选型

| 层面 | 选择 | 原因 |
|---|---|---|
| 桌面框架 | Electron 28+ | Windows 支持成熟，NSIS 生态完善 |
| 构建工具 | electron-vite (React+TS) | Vite HMR 热重载，改代码秒刷 |
| UI 组件库 | React 18 + Ant Design 5 | 中文组件库最完善 |
| 代码编辑器 | `@monaco-editor/react`（懒加载） | YAML/JSON 语法高亮 + 校验 |
| YAML 处理 | `js-yaml` | Clash / ShadowQUIC 的 yaml 配置 |
| 配置存储 | `electron-store` | 存 `%APPDATA%\KiNGO\settings.json` |
| IPC | `contextBridge` + `ipcRenderer.invoke` | 安全隔离，类型安全 |
| 打包 | electron-builder + NSIS | 仅最后一步，生成 .exe 安装包 |

---

## 四、目录结构

```
e:\KiNGO\
  app/                                    ← 新增，不动现有任何文件
    package.json
    electron-builder.yml                  # 打包配置（开发阶段不用管）
    tsconfig.json
    main/                                 ← 主进程
      index.ts                            # 入口：窗口、托盘、IPC 注册
      ipc-handlers.ts                     # 所有 IPC 通道处理
      proxy-manager.ts                    # 9 个代理进程启停管理
      config-service.ts                   # YAML/JSON 配置读写
      latency-tester.ts                   # TCP 连接测速
      chrome-launcher.ts                  # 启动便携 Chrome
      ip-updater.ts                       # GitLab 下载新配置（替代 .bat）
      log-service.ts                      # 环形缓冲区日志
      settings-store.ts                   # electron-store 封装
      tray-manager.ts                     # 系统托盘
      system-proxy.ts                     # Windows 系统代理开关
    preload/
      preload.ts                          # contextBridge API
    renderer/                             ← React 渲染进程
      index.html / index.tsx / App.tsx
      components/
        Layout/                           # 侧边栏 + Header
        Dashboard/                        # 第1层：仪表盘
        ProxyDetail/                      # 第2层：配置编辑
        NodeManager/                      # 第3层：节点管理
        Settings/                         # 第4层：设置
        LogViewer/                        # 第5层：日志
      hooks/                              # useProxyStatus, useLogs 等
      services/ipc-client.ts              # IPC 类型封装
      i18n/zh-CN.json                     # 中文文案
    electron-resources/
      icon.ico                            # 从 ../icons/KiNGO-icon.png 转换

  icons/                                  ← 已有，不动
  clash.meta/ Xray/ hysteria/ ...        ← 现有 9 个代理目录，不动
  Browser/ chrome-user-data/ wget.exe     ← 现有，不动
```

---

## 五、五层 UI 架构

侧边栏导航：**仪表盘 → 节点配置 → 节点管理 → 设置 → 连接日志**

### 第1层：仪表盘 (Dashboard)

9 张代理卡片，每张显示：
- 代理名称 + 协议标签（HTTP/SOCKS5）
- 状态灯：🟢 运行中 / ⚫ 已停止 / 🟡 启动中
- 本机地址（如 `SOCKS5 127.0.0.1:1080`）
- 远端延迟（如 `142ms`）
- 「连接」（start.png）/「断开」（stop.png）按钮
- 「...」菜单：编辑配置、更新 IP、测试延迟、查看日志

顶部栏：「启动浏览器」（browser.png）、「全部停止」

约束：启动同端口代理时自动停止前一个。

### 第2层：节点配置 (ProxyDetail)

左侧代理列表，右侧两个标签页：
- 「基本信息」：只读显示服务器/端口/协议
- 「配置编辑」：Monaco 编辑器（懒加载），自动 YAML/JSON 语法高亮，底部「保存配置」「恢复备份」。代理运行中保存弹窗提示重启。

### 第3层：节点管理 (NodeManager)

- **IP 更新区**：选代理 → 显示可用槽位（基于 `ip_Update/*.bat`）→ 点击更新 → 进度条 → 完成
- **延迟测试区**：解析远端节点 → 表格（地址、端口、延迟、状态）→ 「全部测试」

### 第4层：设置 (Settings)

| 设置项 | 默认 |
|---|---|
| 系统代理 | 关 |
| 开机启动 | 关 |
| 浏览器路径 | `Browser\chrome.exe` |
| 关闭行为 | 最小化到托盘 |
| 主题 | 亮色 |

### 第5层：连接日志 (LogViewer)

表格列：时间戳、代理、等级(INFO/WARN/ERROR 三色)、消息。筛选、搜索、自动滚动、清空、导出。

---

## 六、核心服务

### 6.1 ProxyManager — 代理进程管理

| 代理 | 可执行文件 | 参数 | 配置 (格式) | 端口 | 协议 |
|---|---|---|---|---|---|
| Clash.Meta | clash.meta-windows-386.exe | `-d {dir}` | config.yaml | 7890 | HTTP |
| Xray | xray.exe | `-c {path}` | config.json | 1080 | SOCKS5 |
| Hysteria v1 | hysteria-tun-windows-6.0-386.exe | `-c {path}` | config.json | 1080 | SOCKS5 |
| Hysteria v2 | hysteria2.exe | `-c {path}` | config.json | 1080 | SOCKS5 |
| Sing-Box | sing-box.exe | `-c {path}` | config.json | 1080 | SOCKS5 |
| NaiveProxy | naive.exe | `{path}` | config.json | 1080 | SOCKS5 |
| Juicity | juicity-client.exe | `-c {path}` | config.json | 1080 | SOCKS5 |
| Mieru | mieru.exe | `-c {path}` | config.json | 3080 | SOCKS5 |
| ShadowQUIC | shadowquic.exe | `{path}` | client.yaml | 4080 | SOCKS5 |

- `start()`: `cwd`=代理目录，stdout/stderr → LogService，同端口互斥
- `stop()`: SIGTERM → 5s → SIGKILL
- `stopAll()`: 遍历停止，`app.on('before-quit')` 注册清理

### 6.2 ConfigService — 配置读写

每代理的服务器地址提取路径：

| 代理 | 地址路径 | 端口路径 |
|---|---|---|
| Clash.Meta | `proxies[0].server` | `proxies[0].port` |
| Xray | `outbounds[0].settings.vnext[0].address` | 同上 `.port` |
| Hysteria v1/v2 | 解析 `server` 字段 `"host:port"` | — |
| Sing-Box | `outbounds[0].server` | `outbounds[0].server_port` |
| NaiveProxy | `proxy` URL 格式 → `new URL()` | — |
| Juicity | 解析 `server` 字段 | — |
| Mieru | `profiles[0].servers[0].ipAddress` | `portBindings[0].port` |
| ShadowQUIC | 解析 `outbound.addr` 字段 | — |

保存前验证 JSON/YAML 语法，解析失败不写入，旧文件重命名为 `_backup`。

### 6.3 LatencyTester

`net.createConnection` → `performance.now()` 测连接耗时 → 销毁 socket。3s 超时，结果缓存 60s。

### 6.4 ChromeLauncher

1. 找 Chrome：`Browser\chrome.exe` → 注册表后备
2. 取第一个运行中代理的端口/协议 → 构建 `--proxy-server`
3. `spawn(chrome, [--user-data-dir, --proxy-server, url], {detached:true})`
4. user-data-dir 指向可写路径

### 6.5 IPUpdater

URL 映射（⚠️关键差异）：

| 目录 | GitLab 路径名 | 配置文件 |
|---|---|---|
| clash.meta | `clash.meta2` | config.yaml |
| Xray | `xray` | config.json |
| hysteria | `hysteria` | config.json |
| hysteria2 | `hysteria2` | config.json |
| singbox | `singbox` | config.json |
| naiveproxy | `naiveproxy` | config.json |
| juicity | `juicity` | config.json |
| mieru | `mieru` | config.json |
| shadowquic | `shadowquic` | client.yaml |

双 URL 下载，`rejectUnauthorized:false`，先备份再替换。

### 6.6 系统托盘

图标用 `icons/16.png`、`icons/32.png`。右键菜单：显示窗口 / 启动浏览器 / 各代理停止 / 全部停止 / 退出。关闭窗口→最小化到托盘。

---

## 七、IPC 通信

请求-响应（`ipcMain.handle`）：`proxy:start|stop|status|get-config|save-config|restore-backup|test-latency|update-ip|get-slots`、`chrome:launch`、`settings:get|set`、`logs:get|clear`

推送（`webContents.send`）：`proxy:status-changed`、`proxy:log`、`proxy:update-progress`

---

## 八、图标资源

项目已有 `icons/`，直接复用：

| 文件 | 用途 |
|---|---|
| KiNGO-icon.png | 应用主图标 → 打包时转 .ico |
| 16.png / 32.png | 系统托盘图标 |
| start.png | 连接按钮 |
| stop.png | 断开按钮 |
| browser.png | 启动浏览器按钮 |

---

## 九、实施阶段（全流程 dev 模式，最后才打包）

### 阶段一：脚手架 ✅ 验证点：窗口出现

```bash
cd e:\KiNGO\app
npm create @quick-start/electron@latest . -- --template react-ts
npm install antd @ant-design/icons js-yaml electron-store @monaco-editor/react
npm run dev   # 应该看到 Electron 窗口
```

1. 初始化 electron-vite 项目
2. 安装全部依赖
3. 搭建 Layout（antd 侧边栏 + Header + Content 路由）
4. 写 `zh-CN.json`
5. 配置 `electron-builder.yml`（仅写配置，不构建）

### 阶段二：核心服务 ✅ 验证点：能通过 UI 启动/停止代理

1. `settings-store.ts` — electron-store
2. `proxy-manager.ts` — 9 代理定义 + spawn/kill
3. `config-service.ts` — YAML/JSON 读写
4. `log-service.ts` — 环形缓冲
5. `ipc-handlers.ts` + `preload.ts`
6. **用 `npm run dev` 验证：Task Manager 能看到代理进程启动和退出**

### 阶段三：仪表盘 ✅ 验证点：9 张卡片 + 状态指示灯

1. `ipc-client.ts` 封装
2. Dashboard 9 张代理卡片
3. `useProxyStatus` Hook（3s 轮询 + 推送合并）
4. 连接/断开/全部停止
5. **用 `npm run dev` 验证：卡片状态实时更新**

### 阶段四：配置 + 节点管理 ✅ 验证点：编辑保存恢复 + 延迟测速 + IP 更新

1. ProxyDetail（Monaco 懒加载 + 基本信息）
2. NodeManager（IP 槽位 + 延迟表格）
3. `latency-tester.ts` + `ip-updater.ts`
4. **用 `npm run dev` 验证：改配置 → 保存 → 磁盘文件变更 → 恢复备份还原**

### 阶段五：浏览器 + 设置 + 日志 ✅ 验证点：Chrome 代理上网 + 日志实时流

1. `chrome-launcher.ts`
2. Settings 表单
3. `system-proxy.ts`
4. LogViewer（筛选、搜索、导出）
5. **用 `npm run dev` 验证：启动浏览器 → Google 可访问 → 日志实时滚动**

### 阶段六：托盘 + 打磨 ✅ 验证点：托盘右键菜单正常

1. `tray-manager.ts` + 右键菜单
2. 关闭窗口→最小化到托盘
3. UI 细节（加载态、空状态、错误提示）
4. **用 `npm run dev` 验证：关闭窗口 → 托盘图标出现 → 右键菜单可用**

### 阶段七：打包 ✅ 验证点：安装包可用

**⚠️ 所有功能在 dev 模式确认正常后再执行这一步**

```bash
npm run build    # electron-builder 构建 NSIS .exe
```

1. 构建生产版本
2. 在干净 Windows 虚拟机测试：安装 → 桌面快捷方式 → 连接代理 → 启动浏览器
3. 测试卸载

---

## 十、打包配置（阶段七才用）

```yaml
# electron-builder.yml
appId: com.kingo.desktop
productName: KiNGO
extraResources:
  - from: ../clash.meta     to: clash.meta
  - from: ../Xray           to: Xray
  - from: ../hysteria       to: hysteria
  - from: ../hysteria2      to: hysteria2
  - from: ../singbox        to: singbox
  - from: ../naiveproxy     to: naiveproxy
  - from: ../juicity        to: juicity
  - from: ../mieru          to: mieru
  - from: ../shadowquic     to: shadowquic
  - from: ../Browser        to: Browser
  - from: ../wget.exe       to: wget.exe
win:
  target: [{ target: nsis, arch: [x64] }]
  requestedExecutionLevel: requireAdministrator
  icon: electron-resources/icon.ico
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
  shortcutName: KiNGO
```

**路径解析（开发 vs 打包）：**
```typescript
const BASE_DIR = app.isPackaged
  ? process.resourcesPath    // 打包后: C:\Program Files\KiNGO\resources\
  : path.join(__dirname, '..', '..');  // 开发: e:\KiNGO\

const proxyDir = path.join(BASE_DIR, 'clash.meta');
```

**可写目录（打包后 Program Files 只读）：**

| 用途 | 路径 |
|---|---|
| 设置 | `%APPDATA%\KiNGO\settings.json` |
| Chrome 数据 | `%APPDATA%\KiNGO\chrome-user-data\` |
| 日志 | `%APPDATA%\KiNGO\logs\` |

---

## 十一、风险与应对

| 风险 | 应对 |
|---|---|
| 杀毒误报 | 安装说明注明添加信任区 |
| IP 更新源失效 | 保留 wget.exe 备用 |
| 管理员权限不足 | NSIS 设 `requireAdministrator` |
| 便携 Chrome 缺失 | 自动使用系统 Chrome |
| 打包路径错误 | 阶段二中就设计好 `isPackaged` 分支，早验证 |
