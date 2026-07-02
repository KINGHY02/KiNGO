# KiNGO Roadmap

## Milestone Review: 2026-07-02 Clash Import Feedback

### Done

- Clash 订阅导入弹窗新增导入中提示。
- 保存按钮导入时显示 loading，取消按钮禁用，避免用户误以为卡死。
- 导入成功会提示“已保存并自动选中”。
- 导入失败会在弹窗内显示失败原因，同时弹出错误消息。
- Clash 配置表新增“最近结果”，展示订阅最近更新失败原因。
- 订阅直连超时从 30 秒缩短到 10 秒。
- 本地代理回退每个端口超时从 45 秒缩短到 15 秒，降低最坏等待时间。

### Good

- 用户现在能看到 KiNGO 正在做什么，不再像按钮失灵。
- 导入失败原因留在弹窗内，不会因为 toast 消失而丢失。
- 慢订阅场景下反馈更接近成熟客户端。

### Not Good Enough

- 还没有进度分阶段显示“直连中 / 7890 中 / 10808 中”等细粒度状态。
- 目前代理回退仍是后端串行尝试，后续可做更快的并发探测。

### Next Adjustment

- 增加显式“通过代理导入/更新”按钮，让用户不必等直连超时。
- 把订阅下载器抽成统一服务，Clash 与 V2rayN 共用下载状态和错误格式。

## Milestone Review: 2026-07-02 Subscription Fetch Proxy Fallback

### Done

- 确认 `https://www.010213.xyz/sub?token=king` 在当前环境下 DNS/TCP 可达，但 HTTP 层直连超时。
- 对照 v2rayN：它提供“通过代理更新订阅 / 不通过代理更新订阅”两种路径。
- KiNGO Clash 订阅下载新增直连失败后的本地代理回退。
- 本地代理回退顺序：
  - `http://127.0.0.1:7890`
  - `http://127.0.0.1:10808`
  - `http://127.0.0.1:10809`
  - `socks5://127.0.0.1:1080`
- 这样用户开启公共线路、Clash、V2rayN 或外部 v2rayN 后，KiNGO Clash 订阅导入可借用本地代理获取内容。

### Good

- 订阅下载策略开始接近 v2rayN，适配需要代理才能访问的订阅站点。
- 仍保留直连优先，不会强制所有订阅都走代理。
- 对 v2rayN 常见 Mixed 端口 10808 做了兼容。

### Not Good Enough

- 当前代理回退使用 Windows `curl.exe`，后续应改成内置 HTTP/SOCKS 代理客户端，减少外部命令依赖。
- UI 还没有显式提供“直连更新 / 通过代理更新”的按钮。
- 错误提示还可以进一步显示每个回退端口的失败原因。

### Next Adjustment

- Clash 与 V2rayN 订阅管理都应增加“通过代理更新”显式入口。
- 后续把订阅下载器抽成统一服务，Clash 与 V2rayN 共用同一套直连/代理/UA/超时策略。

## Milestone Review: 2026-07-02 Clash Usability Baseline

### Done

- Clash 模式新增 mihomo 运行模式读取与切换：规则、全局、直连。
- 代理组不再只能通过下拉框选择，新增组内节点按钮列表。
- 代理组新增节点名称筛选。
- 代理组新增默认排序、按延迟排序、按名称排序。
- 新增代理组“测速全部”，按小批量并发测试节点，结果直接显示在节点按钮上。
- 当前节点单独测速保留，但不再是唯一测速入口。

### Good

- Clash 模式从“能启动的原型”开始变成“能日常选节点的页面”。
- 操作逻辑更接近 Clash Verge：模式切换在顶部，代理组内直接切节点，测速结果直接贴近节点。
- 后端新增运行模式 IPC，为后续首页联动代理模式打基础。

### Not Good Enough

- 批量测速仍由前端逐个调用单节点 delay API，没有 provider healthcheck 那么高效。
- 节点按钮列表在超大订阅下还没有虚拟滚动，后续可能需要按组做虚拟列表。
- Clash 配置页仍在 Clash 模式标签里，还未独立成类似 Clash Verge 的 Profiles 页面。
- 规则、连接、测试仍是轻量版，离 Clash Verge 的完整能力还有差距。

### Next Adjustment

- 下一步补 Clash 模式启动诊断面板：配置解析、mihomo stderr、7890/9090 端口占用、当前配置文件路径。
- 再做首页 Clash 总览卡片：当前配置、当前代理节点、代理模式、系统代理/TUN、连接数。

## Milestone Review: 2026-07-02 Clash Verge IA Study

### Done

- 读取本地 `clash-verge-rev-dev` 源码的信息架构。
- 确认 Clash Verge 主要板块为：首页、代理、订阅/配置、连接、规则、日志、测试、设置。
- 明确其核心操作逻辑：
  - 首页是运行总览，不是复杂节点管理页。
  - 代理页只处理代理组、节点选择、规则/全局/直连模式、测速、筛选、排序。
  - 订阅/配置页只处理配置导入、更新、切换、排序、批量操作。
  - 连接、规则、日志、测试独立成页，避免挤在一个页面。
- KiNGO 的 Clash 模式已先从折叠面板改为标签页：代理组、订阅配置、TUN、规则模板、连接列表。

### Good

- KiNGO 开始向 Clash Verge 的“清晰分区”靠拢，降低 Clash 模式的一屏混乱感。
- 本轮只借鉴产品结构，没有复制 GPLv3 源码，避免许可证污染。
- 代理组成为 Clash 模式的第一入口，订阅配置成为独立标签，用户更容易理解下一步。

### Not Good Enough

- KiNGO 还没有独立的 Clash 订阅/配置页，当前仍在 Clash 模式内部通过标签页承载。
- 代理组缺少 Clash Verge 式筛选、按延迟排序、批量测速、显示详细/简洁模式。
- 首页还没有完整迁移 Clash Verge 式卡片：当前配置、当前节点、系统代理/TUN、代理模式、流量、测试、IP 信息。

### Next Adjustment

- 下一步优先做 Clash 代理组体验：筛选、排序、批量测速、超时标记。
- 然后把 KiNGO 首页改成更接近 Clash Verge 的运行总览卡片，而不是只强调一个连接按钮。
- 中期再考虑把 Clash 的“订阅配置”独立为侧栏页面，公共线路和 V2rayN 仍保持 KiNGO 自己的差异化。

## Milestone Review: 2026-07-02 Clash Delay Timeout Handling

### Done

- Clash 节点测速接口改为失败返回，不再把 mihomo 控制接口超时异常抛到前端。
- 节点测速超时文案改为“节点测速超时，请换一个节点或稍后重试”。
- delay 测试超时时间从 5 秒放宽到 8 秒，主进程 HTTP 等待时间同步放宽。
- Clash 页面新增单个测速按钮 loading 状态，避免重复点击造成卡顿感。

### Good

- 测速失败不再像程序故障，更像一个节点状态结果。
- 用户可以继续切换代理组和使用页面，不会被 remote method error 打断。

### Not Good Enough

- 目前仍是单个当前节点测速，未实现 Clash 常见的批量测速/按延迟排序。
- 测试 URL 固定为 Google 204，后续应允许设置备用测速地址。

### Next Adjustment

- Clash 模式下一步应增加代理组内批量测速，并把超时节点标为“超时”而不是弹消息。

## Milestone Review: 2026-07-02 mihomo Controller Readiness

### Done

- Clash 启动流程新增 mihomo 控制接口就绪等待。
- 进程 spawn 成功不再等同于 Clash 模式启动成功；必须等 9090 external-controller 可访问。
- 如果 mihomo 启动后秒退或控制接口不可用，会停止核心并返回用户可理解的错误。
- `clash:groups` / `clash:connections` IPC 在控制接口暂不可用时返回空列表，避免前端出现 remote method ECONNREFUSED 弹窗。

### Good

- Clash 模式连接状态更可信，不会“看起来运行中，但代理组读不到”。
- 用户看到的错误从底层 `ECONNREFUSED` 转成“控制接口未就绪 / 配置无效 / 核心启动失败”这类可理解信息。

### Not Good Enough

- 仍需要把 mihomo 启动失败时的 stderr 最后一段日志提取出来，直接展示在启动失败提示里。
- 9090 控制端口冲突还没有前置诊断，当前主要依靠启动等待后的失败提示。

### Next Adjustment

- Clash 启动失败诊断继续增强：检查配置 YAML、mihomo 可执行文件、7890/9090 端口占用、最近核心日志。

## Milestone Review: 2026-07-02 Clash Profile Selection Fix

### Done

- 修复 Clash 模式导入订阅后无法稳定选择的问题。
- Clash 配置列表自动刷新时，不再强制把用户选择切回当前运行配置或默认配置。
- 启动 Clash 时仍使用下拉框当前选择的配置；启动成功后该配置才成为当前运行配置。

### Good

- 导入订阅、选择配置、点击启动这条路径变得符合用户直觉。
- 保留自动刷新配置列表，不牺牲运行状态更新。

### Not Good Enough

- Clash 配置管理仍藏在折叠面板里，导入后“下一步点击启动”的引导还不够明显。

### Next Adjustment

- 后续可在导入成功后显示“已选择该配置，点击启动使用”的轻提示。
- Clash 模式页面需要继续简化：配置选择、启动、代理组切换三个区域应有更明确的主次层级。

## Milestone Review: 2026-07-02 Core Management IA Reduction

### Done

- 从主侧栏移除“核心管理”入口。
- 保留底层核心 IPC、配置生成、核心版本检查和按协议默认核心设置，避免破坏 Clash / V2rayN / 公共线路连接能力。
- 产品主导航收口为：首页、Clash 模式、V2rayN 模式、公共线路、设置、连接日志。

### Good

- 普通用户不再被核心路径、配置槽位、底层文件编辑等概念干扰。
- 首屏和侧栏更接近成熟代理客户端的使用路径：先连接，再进入对应模式管理节点。
- Monaco 配置编辑器不再能从主导航直接进入，进一步降低误触和性能负担。

### Not Good Enough

- 设置页里的“按协议默认核心”和“核心版本”仍偏高级，后续可以折叠为“高级/排障”区域。
- 底层 `ProxyDetail` 页面仍保留在代码中，后续如果确认不再需要，应彻底归档或改成开发者调试页。

### Next Adjustment

- 检查首页公共线路自动选择逻辑是否导致启动/点击时卡顿，必要时减少同步诊断数量。
- 下一步优先优化 V2rayN 大节点表性能：虚拟滚动、减少重复 profileEx 合并、键盘删除和排序体验继续贴近 v2rayN。

KiNGO 的主名称只使用“KiNGO”。产品方向是 Windows 多核心网络代理客户端，而不是“电脑加速器”。

## 当前产品方向

- 首页面向普通用户：一个主开关，默认连接公共线路，并联动显示 Clash / V2rayN / 公共线路的当前连接。
- Clash 模式面向 Clash Verge / Clash Party 用户：以 mihomo 为默认核心，围绕配置、代理组、规则、TUN、连接列表展开。
- V2rayN 模式面向 v2rayN 用户：以分组 + 节点表为主，支持订阅分组、空分组、粘贴导入、测速、排序、Delete 删除、核心推荐。
- 公共线路只是第三方公开项目的客户端封装：KiNGO 不运营或提供代理线路，不承诺速度、稳定性或长期可用。
- 订阅管理不再作为独立侧栏入口：Clash 订阅归 Clash 模式，V2rayN 订阅归 V2rayN 模式。

## 设计原则

- 普通用户先能一键连接，再进入专业功能。
- 首页不显示核心、slot、端口、配置路径等实现细节。
- 高风险功能例如 TUN 只在开启时提示风险，不在页面上堆长解释。
- Clash 与 V2rayN 不强行统一 UI：它们服务不同用户习惯。
- 所有连接入口最终读取同一份 `AppConnectionState`，避免首页、托盘、模式页各说各话。

## 已完成

- 全局命名统一为 KiNGO。
- 侧栏调整为：首页、Clash 模式、V2rayN 模式、公共线路、核心管理、设置、连接日志。
- 首页改为一键连接公共线路，并能展示 Clash / V2rayN / 公共线路当前连接。
- 公共线路模型和 IPC 已成型，支持选择、连接、断开、诊断、更新。
- Clash 模式已接入 mihomo external-controller 的基础能力：启动、停止、代理组、节点切换、延迟测试、连接列表。
- Clash 模式已支持 URL/YAML 配置导入、自动更新设置、TUN 入口与诊断、常见规则模板参考入口。
- V2rayN 模式已改为左侧分组 + 右侧节点表，支持空分组、重命名、删除空组、移动节点、测速、排序和 Delete 删除。
- 主进程新增统一连接状态 `AppConnectionState`。
- 首页已读取统一连接状态。
- 托盘已接入统一连接状态。
- 新增 `app:connection-state-changed` 事件推送，首页可即时刷新主要连接状态。
- 新增统一断开接口 `app:disconnect-all`，首页和托盘已接入。
- Clash / V2rayN 页面顶部已接入统一连接状态。
- 应用外部网站链接已统一交给系统默认浏览器打开。
- Clash / V2rayN 页面已减少重复断开入口，连接状态集中到顶部。
- V2rayN 本地空分组已升级为真实 `NodeGroup`，不再伪装成空订阅。
- 订阅节点移入本地/手动分组时会创建本地副本，不破坏订阅源节点。
- V2rayN 本地分组支持上移/下移排序。
- 1.0.5 发布前修复：首屏懒加载重页面、Clash base64 订阅、V2rayN 顶部分组、订阅更新和删除整组。

## 当前不足

- V2rayN 的空分组暂时复用订阅结构，后续应拆成真正的 `NodeGroup` 数据模型。
- Clash 规则模板目前只支持复制参考片段，还没有安全合并、diff 预览和一键应用。
- Clash/V2rayN 页面仍保留各自局部轮询，后续应更多使用统一状态事件。
- mihomo 仍兼容复用旧 `clash.meta` 目录和二进制，后续要引入真正的 mihomo 核心管理。
- Windows 安装包、退出恢复、崩溃恢复、系统代理守护还需要完整发布级验证。

## 下一步开发顺序

1. 继续完善 V2rayN `NodeGroup`：分组右键菜单、批量移动细节、删除非空组时的安全迁移。
2. Clash 规则模板做安全应用：解析当前 YAML、预览 diff、用户确认后写入。
3. 引入真正的 mihomo 核心版本检测、下载、替换与迁移。
4. 做 Windows 发布级检查：安装包、开机启动、退出恢复、崩溃恢复、系统代理清理。

## Milestone Review: 2026-07-02 Unified State Push

### Done

- 托盘菜单改为读取 `AppConnectionState`。
- 托盘当前连接文案能显示公共线路、Clash 或 V2rayN 的统一连接名称。
- 托盘“断开当前连接 / 全部停止”不再只处理公共线路。
- 主进程新增 `app:connection-state-changed` 推送事件。
- 首页订阅统一连接状态事件，减少完全依赖轮询的问题。
- 修复 renderer 类型文件中重复的 `AppConnectionState` 定义。
- 公共线路延迟读取改为按当前线路对应核心匹配，避免多个核心状态串线。

### Good

- 状态来源进一步集中，KiNGO 更接近成熟客户端的内部结构。
- 用户不会因为从托盘、首页、模式页看到不同连接状态而困惑。
- 这轮没有增加 UI 复杂度，只增强了底层一致性。

### Not Good Enough

- 还没有统一的 `disconnectAll()` IPC，首页仍按来源分别调用断开逻辑。
- Clash / V2rayN 页面仍有自己的刷新节奏，后续要逐步接入状态事件。
- 托盘停止逻辑已经更稳，但还应该迁移到主进程统一服务，避免托盘自己拼装业务逻辑。

### Next Adjustment

- 新增 `app:disconnect-all` IPC，并让首页、托盘、后续模式页统一调用它。
- 再把 Clash / V2rayN 页面顶部状态改为读取 `AppConnectionState`，保留局部数据刷新只用于代理组、节点表和连接列表。

## Milestone Review: 2026-07-02 Unified Disconnect

### Done

- 新增主进程统一断开服务 `disconnectAllConnections()`。
- 新增 `app:disconnect-all` IPC。
- 首页主按钮断开动作改为调用统一断开接口，不再按公共线路 / Clash / V2rayN 分支处理。
- 托盘“断开当前连接 / 全部停止”复用同一条断开链路。
- 统一断开会停止公共线路状态、停止所有核心、清空 V2rayN 活动连接、关闭 KiNGO 管理的系统代理。

### Good

- 断开逻辑开始集中，后续新增核心或模式时不需要在首页和托盘重复补分支。
- 系统代理清理使用 KiNGO 管理范围判断，减少误清用户手动代理设置的风险。
- 普通用户感知不到复杂度增加，只会觉得主开关更稳定。

### Not Good Enough

- Clash / V2rayN 页面内部的断开按钮还没有全部迁移到统一接口。
- 统一断开目前仍是函数级服务，后续可以抽成更完整的 `ConnectionCoordinator`。
- 连接动作仍分散在 PublicRoute / Mihomo / Node IPC 中，后续也应逐步集中协调。

### Next Adjustment

- Clash / V2rayN 页面顶部接入 `AppConnectionState`，让板块页与首页状态完全一致。
- 评估是否把各模式页的“停止/断开”主操作改为统一断开，仅保留高级局部停止能力。

## Milestone Review: 2026-07-02 External Links and Mode Status

### Done

- 主窗口拦截 `target="_blank"` 外链，统一用系统默认浏览器打开。
- 主窗口拦截外部网页导航，避免 GitHub 等网站在 KiNGO 内部窗口打开。
- Clash 模式顶部新增统一连接状态条。
- V2rayN 模式顶部新增统一连接状态条。
- Clash 模式的主要停止按钮改为统一安全断开接口。

### Good

- 设置里的项目地址、版本下载、更新日志会回到用户熟悉的默认浏览器体验。
- 首页、托盘、Clash、V2rayN 现在能看到同一套连接状态，产品割裂感进一步降低。
- 外链处理放在主窗口层，后续其他页面新增外链也能自动受保护。

### Not Good Enough

- V2rayN 节点表内部仍有局部“已连接”卡片和单核心断开按钮，后续要统一视觉层级。
- Clash 页面仍同时存在顶部统一断开和启动卡片里的停止按钮，后续可进一步减少重复。
- 外链 IPC 还未显式暴露给渲染层；当前靠窗口拦截已经够用，但未来可加 `openExternalUrl()` 供按钮调用。

### Next Adjustment

- 清理 V2rayN 内部重复连接提示，把“当前连接状态”集中到模式页顶部。
- 再处理 Clash 页面启动卡片的停止按钮，避免用户看到两个相似断开入口。

## Milestone Review: 2026-07-02 Mode UI Deduplication

### Done

- Clash 模式启动卡片移除重复“停止”按钮，断开统一保留在顶部连接状态条。
- V2rayN 节点表上方移除旧的“已连接/断开”提示卡片。
- V2rayN 连接状态集中到模式页顶部，节点表区域专注节点管理。

### Good

- 页面操作入口更少，用户不会同时看到多个功能相近的断开按钮。
- 首页、托盘、Clash、V2rayN 的连接心智进一步统一。
- 这轮只做 UI 减法，没有改变底层连接流程，风险较低。

### Not Good Enough

- V2rayN 内部仍通过 `useNodesData()` 维护活动连接缓存，后续要逐步从显示层弱化它。
- `NodeContextMenu` 仍保留未使用的 `hasActive` 参数，后续清理类型时可以一起去掉。
- Clash 启动卡片还可以进一步合并运行状态和顶部状态条，减少标签重复。

### Next Adjustment

- 开始处理 V2rayN 数据模型：把“空分组复用订阅结构”升级为真正的 `NodeGroup`。
- 在做数据模型前，先审查 nodes-store / subscription-store 当前持久化格式，避免破坏用户已有节点数据。

## Milestone Review: 2026-07-02 V2rayN NodeGroup Model

### Done

- `nodes-store` 新增真实 `StoredNodeGroup` / `nodeGroups` 持久化结构。
- 旧版本里 `url` 为空的伪订阅分组会自动迁移到 `nodeGroups`。
- `getAllNodes()`、`findNodeById()`、节点更新、测速延迟、删除、复制、移动节点都已覆盖本地分组。
- 新增 `group:list` IPC，前端可读取真实本地分组。
- V2rayN 左侧分组现在区分：手动节点、本地分组、订阅分组。
- 新建空组现在创建 `NodeGroup`，不再创建空订阅。

### Good

- 本地分组和订阅分组的概念终于分开，后续订阅同步不会再被“空组”污染。
- 旧数据有兼容迁移，不需要用户手动重建空分组。
- 这一步改的是数据骨架，但保持了原 UI 操作方式，用户学习成本不变。

### Not Good Enough

- 订阅节点移动到本地分组后的“订阅再次更新”关系仍需要更精细定义。
- 本地分组还没有排序、右键菜单和更完整的批量管理。
- `deleteSubscriptionNode` / `deleteSubscriptionNodes` 名称已不准确，后续应重命名为通用 group node 操作。

### Next Adjustment

- 明确订阅同步策略：订阅更新只更新订阅组本体，被移动到本地分组的节点应视为本地副本。
- 给本地分组补排序和右键菜单操作。

## Milestone Review: 2026-07-02 NodeGroup Polish

### Done

- 明确并实现订阅同步策略：订阅节点移动到本地/手动分组时创建本地副本，订阅组原节点保留。
- `moveNodesToGroup()` 返回 `moved/copied` 计数。
- V2rayN 移动节点提示能区分“移动节点”和“添加本地副本”。
- 本地分组新增上移/下移排序能力。

### Good

- 订阅同步和本地整理不会互相破坏，这是 V2rayN 体验成熟化的重要边界。
- 用户可以把订阅里的好节点收进自己的本地分组，同时保留订阅更新能力。
- 分组排序用简单按钮完成，避免过早引入复杂右键菜单。

### Not Good Enough

- 删除非空本地分组目前仍只能阻止，后续应提供“移动到手动节点后删除”的安全选项。
- 本地分组还没有右键菜单，操作入口仍占用左侧工具区空间。
- 移动到订阅分组仍允许发生，后续可能要限制或显式提示这是高级操作。

### Next Adjustment

- 增加删除非空本地分组时的安全迁移选项。
- 再考虑是否禁止把本地节点移动进订阅分组，避免污染订阅组。

## Milestone Review: 2026-07-02 Release Candidate Feedback

### Done

- 修复启动卡顿的主要结构问题：核心管理、公共线路、Clash、V2rayN、日志、设置页面改为懒加载，避免 Monaco 编辑器拖慢首屏。
- Clash 模式 URL 订阅支持 base64 分享链接订阅；会转换为 mihomo 可用 YAML。
- V2rayN 分组改为更接近 v2rayN 的顶部横向分组布局。
- V2rayN 订阅组新增更新入口。
- 删除组逻辑改为删除整个组及其中节点，不再要求先手动清空节点。
- 删除入口补回工具区，并明确显示“删除组及节点”。

### Good

- 性能优化方向正确：重页面延迟加载，首页启动应该明显轻。
- Clash 订阅兼容从“只吃 Clash YAML”扩展到常见 base64 分享链接订阅。
- V2rayN 分组布局更贴近用户熟悉的软件。

### Not Good Enough

- 还没有对大订阅节点表做虚拟滚动，超大订阅仍可能卡。
- V2rayN 顶部分组很多时需要继续优化横向滚动/换行体验。
- Clash base64 转换依赖现有节点解析器，少数特殊协议参数可能还要继续补。

### Next Adjustment

- 预览验证 1.0.5：重点看启动速度、Clash base64 导入、V2rayN 更新/删除分组。
- 如仍卡顿，下一步给节点表增加虚拟滚动，并减少首页公共线路诊断调用。
