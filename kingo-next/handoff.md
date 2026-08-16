# KiNGO 新架构交接说明

更新时间：2026-08-16

工作目录：`E:\KiNGO\kingo-next`

Git 仓库根目录：`E:\KiNGO`

目标发布分支：`codex/fix-installer-core-lock`

## 1. 接手时先遵守的边界

1. `E:\KiNGO` 当前是脏工作树，包含大量既有修改和未跟踪文件；这些都是需要保护的工作成果。
2. 禁止使用 `git reset --hard`、`git clean`、`git checkout -- <file>` 或其他会覆盖、删除现有修改的命令。
3. 当前产品源代码以 `E:\KiNGO\kingo-next` 为准。旧 `app/` Electron 目录不是当前新架构的实现来源，不要把旧 Clash/V2ray 独立板块重新接回产品。
4. 当前版本号已切换为 `2.0.5`；用户已在 2026-08-16 明确要求重新推送修复后的安装包。后续仍需以 GitHub Actions 和 Release 资产实际完成为发布成功依据。
5. 获取节点会访问固定 65 条公共订阅并产生大量网络请求。可以编译、启动预览，但不要替用户自动启动完整检测。

## 2. 当前产品形态

- 技术栈：Tauri 2 + Rust + React 19 + TypeScript + Vite。
- 产品只保留自动连接主线：`首页 / 线路 / 获取节点 / 日志 / 设置`。
- 代理模式提供规则模式和全局模式，并复用现有系统代理、TUN、托盘、流量、DNS 与连接状态体系。
- 应用版本在以下文件中均为 `2.0.5`：
  - `package.json`
  - `src-tauri/Cargo.toml`
  - `src-tauri/tauri.conf.json`
- Tauri 标识：`com.kingo.client`。

## 3. 获取节点板块当前实现

### 3.1 检测引擎与资源

- 当前完整检测由官方 `beck-8/subs-check` 执行，内置基线版本为 `v1.6.2`。
- 核心位置由 `src-tauri/src/community_nodes/subs_check.rs` 管理；可通过设置页的核心更新功能跟随上游更新。
- 固定订阅清单位于 `src-tauri/resources/community-sources.txt`；本轮复核为 65 条非空来源、65 条唯一来源。
- 资源恢复与哈希校验由 `core-assets/manifest.json` 和 `scripts/restore-core-assets.ps1` 管理。
- GPL-3.0 与 NOTICE 位于 `src-tauri/resources/licenses/`。

### 3.2 主要代码入口

- 前端页面、状态订阅和交互：`src/App.tsx` 的 `CommunityNodesPage`。
- 页面样式：`src/App.css` 中的 `.community-*` 规则。
- Tauri 命令注册：`src-tauri/src/lib.rs`。
- 上游进程生命周期与状态映射：`src-tauri/src/community_nodes/subs_check.rs`。
- 数据模型：`src-tauri/src/community_nodes/models.rs`。
- 本地持久化：`src-tauri/src/community_nodes/store.rs`。
- 单节点/批量复测：`src-tauri/src/community_nodes/scanner.rs`、`probe.rs`、`speed_test.rs`。
- 来源解析与去重：`source_manifest.rs`、`parser.rs`、`fingerprint.rs`。
- 排序：`ranking.rs`。

主要 Tauri 命令：

- `start_community_scan`
- `stop_community_scan`
- `get_community_scan_state`
- `list_community_nodes`
- `clear_community_nodes`
- `retest_community_node`
- `retest_all_community_nodes`
- `connect_community_node`

### 3.3 最新的进度语义

本轮已修复容易误导用户的进度和计数：

- “订阅清单 65 条”只代表固定输入清单规模，不代表 65 条均已获取成功。
- 点击“开始获取”后立即进入“正在获取、解析并去重订阅”，订阅阶段使用不定进度，不再在结束时突然显示伪精确的 `65/65`。
- 上游状态接口只暴露解析并去重后的 `pipeline.total`，没有逐订阅完成状态，也没有可信的去重前节点总量。
- 因此界面只显示“去重后候选”，不再显示或推算“原始/去重”对比。不要重新用同一个值填充去重前后两个字段。
- 任务轨道拆为：`订阅处理 -> 节点测活 -> 下载测速`。
- 测活进度使用 `aliveDone / pipeline.total`。
- 下载测速进度使用 `speedDone / max(filterPass, speedDone)`。
- 进度条仅代表当前阶段，不是整轮任务耗时预测；进入下一阶段会重新从该阶段的进度计算。
- 正常检测状态不再在用户界面显示底层核心名称，技术日志和安装/校验错误仍可保留必要的诊断信息。

## 4. 本轮代码审查结论

已针对以下路径进行检查：

- 新任务与旧终态事件的接收顺序：`shouldAcceptCommunityScan` 会按任务 ID、时间戳和终态优先级防止状态倒退。
- 开始、停止、单项复测、批量复测和清空之间的互斥：前后端均有保护。
- 检测进程归属：只终止 KiNGO 自己启动并保存在 `SubsCheckRuntime` 中的子进程。
- 结果提交：完整检测成功后才替换保存结果；停止或失败保留上一轮节点。
- 去重计数：不再伪造无法从上游取得的数据。
- React 事件监听：卸载时会释放进度、单项复测和批量复测监听器。
- 获取节点相关生产路径未发现新的 `panic!`、`todo!` 或 `unimplemented!`；搜索到的 `unwrap()` 仅位于测试代码。

当前没有发现新的静态错误或可稳定复现的代码级 Bug，但这不等于完成了真实网络验收。

## 5. 2026-08-16 验证证据

在 `E:\KiNGO\kingo-next` 当前工作树执行并通过：

```powershell
npm.cmd run build
```

- TypeScript 编译通过。
- Vite 生产构建通过，共转换 3446 个模块。

在 `E:\KiNGO\kingo-next\src-tauri` 执行并通过：

```powershell
cargo +1.97.0-x86_64-pc-windows-msvc fmt --check
cargo +1.97.0-x86_64-pc-windows-msvc check --all-targets
cargo +1.97.0-x86_64-pc-windows-msvc test --lib
```

- Rust 全目标检查通过。
- Rust 库测试：55 passed，0 failed。

在 `E:\KiNGO` 执行：

```powershell
git diff --check
```

- 差异检查通过；输出中只有现有工作树的 LF/CRLF 提醒，没有空白错误。

本轮曾启动 Tauri 开发预览并确认 `kingo.exe` 窗口标题为 `KiNGO`、进程响应正常；交接前该预览已经退出，当前没有需要接管的预览进程。没有自动触发 65 源检测。

## 6. 尚未完成的真实运行验收

后续首要工作不是继续改布局，而是由用户在当前预览中显式执行一次检测并观察真实状态：

1. 点击“开始获取”后，界面应立即显示订阅处理状态和不定进度。
2. 订阅处理结束后，“去重后候选”应出现数值，并进入节点测活阶段。
3. 测活阶段的完成数应持续变化，不应长期无反馈后成批跳变。
4. 下载测速阶段应单独显示 `已完成 / 总数`，阶段切换时进度重新计算属于预期行为。
5. 完成后核对最终保留数量、国家命名、排序、单节点复测、批量复测与连接。
6. 分别验证停止任务、网络异常、外部 TUN 拦截、软件重启后的状态恢复和旧结果保护。

真实运行仍有两个明确限制：

- 上游没有逐条订阅获取进度，因此订阅阶段只能准确表示“处理中”，不能显示每条来源的成功/失败计数。
- 上游没有提供去重前节点总量，因此无法仅凭当前状态接口告诉用户“共删除了多少重复节点”。若产品必须提供该指标，需要扩展或修改上游输出协议，不能在前端推算。

## 7. 建议的下一步顺序

1. 先让用户完成一轮真实检测，记录三个阶段的截图、耗时和最终结果。
2. 如果阶段计数异常，优先保存上游状态接口原始响应和 KiNGO `CommunityScanState` 快照，再修改映射；不要根据界面猜测。
3. 验证停止、失败和重启恢复后，再检查单节点/批量复测与连接。
4. 只有上述流程稳定后才进行安装包构建和发布验收。
5. `2.0.5` 已获得发布授权；推送后需确认 GitHub Actions、安装包、签名文件和自动更新元数据全部生成成功。

## 8. 本地启动与排查命令

启动开发预览：

```powershell
cd E:\KiNGO\kingo-next
npm.cmd run tauri dev
```

若 Cargo 默认工具链异常，继续使用：

```powershell
cargo +1.97.0-x86_64-pc-windows-msvc <command>
```

排查时优先查看：

- 页面收到的 `community-scan-progress` 事件。
- `get_community_scan_state` 返回值。
- 应用数据目录中的扫描状态、节点结果和本轮临时运行目录。
- 是否存在其他软件的 TUN/Wintun/TAP/VPN 正在接管默认路由。
- 上游进程是否由当前 `SubsCheckRuntime` 启动和持有。

## 9. 交接完成时的保护状态

- 没有执行清理、重置、检出覆盖、提交、推送或发布。
- 旧 `app/` 目录的既有修改没有被本轮覆盖。
- `kingo-next` 的现有修改、公共节点模块、资源与计划文档均保持在当前工作树中。
- 新增本文件：`E:\KiNGO\kingo-next\handoff.md`。
