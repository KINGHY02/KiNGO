# KiNGO "我的节点" V2rayN 风格重构设计计划

---

## 一、背景与目标

### 1.1 现状

KiNGO 当前 "我的节点" 板块已具备基础功能：节点导入、订阅管理、延迟测试、节点列表展示。但存在以下不足：

- 节点数据模型简单，缺少 V2rayN 风格的扩展元数据（流量统计、IP 信息、排序权重）
- 订阅系统功能薄弱，缺少完整的编辑/启用/过滤/排序/备注能力
- 节点右键菜单大量操作标注 "即将推出" 占位符，体验不完整
- 节点排序依赖前端临时排序，缺少持久化排序机制
- 节点编辑功能粗糙，仅支持基本信息修改（名称/地址/端口），缺少协议详情编辑
- 缺少节点拖拽排序、批量移动分组等 V2rayN 核心交互

### 1.2 重构目标

**对标 V2rayN，实现"行为级对齐"，而非源码移植。**

具体目标：

1. **数据模型对齐**：建立 `ProfileItem`（节点实体）+ `ProfileExItem`（扩展元数据）+ `SubItem`（订阅实体）的三表模型
2. **功能完整性**：打通右键菜单中所有标注 "即将推出" 的功能
3. **交互体验对齐**：支持持久排序、分组拖拽、批量操作等 V2rayN 核心交互
4. **架构解耦**：节点管理与代理核心启动流程完全解耦，形成独立领域模块

### 1.3 非目标

- 不嵌入 .NET / ServiceLib 到 Electron 应用
- 不重写仪表盘、设置、托盘、自动更新、代理核心生命周期
- 不在第一阶段追求全部 V2rayN 特性（策略组生成、WireGuard 导入、速度测试等）

---

## 二、V2rayN 架构分析

### 2.1 核心数据模型（ServiceLib）

```
┌─────────────────────────────────────────────────────────┐
│  ProfileItem (节点实体)                                   │
│  ├─ IndexId (主键)                                       │
│  ├─ ConfigType (协议类型枚举)                              │
│  ├─ CoreType (可选核心类型)                                │
│  ├─ Subid (订阅ID)                                       │
│  ├─ Remarks (备注)                                       │
│  ├─ Address / Port                                       │
│  ├─ Network / StreamSecurity / SNI / ALPN                │
│  ├─ ProtoExtra (协议扩展: flow, ss-method, flow...)       │
│  └─ TransportExtra (传输扩展: gRPC, WebSocket, KCP...)   │
├─────────────────────────────────────────────────────────┤
│  ProfileExItem (扩展元数据 - 显示/运行时)                  │
│  ├─ IndexId (主键 = ProfileItem.IndexId)                  │
│  ├─ Delay (延迟ms)                                       │
│  ├─ Speed (速度B/s)                                      │
│  ├─ Sort (排序权重)                                       │
│  ├─ Message (测试结果消息)                                 │
│  └─ IpInfo (IP地理信息)                                   │
├─────────────────────────────────────────────────────────┤
│  SubItem (订阅实体)                                       │
│  ├─ Id (主键)                                            │
│  ├─ Remarks (订阅名称)                                    │
│  ├─ Url                                                │
│  ├─ MoreUrl (备用URL)                                    │
│  ├─ Enabled (启用状态)                                    │
│  ├─ UserAgent                                           │
│  ├─ Sort (订阅排序)                                       │
│  ├─ Filter (节点名称过滤器)                                 │
│  ├─ AutoUpdateInterval (自动更新间隔, 小时)                  │
│  ├─ ConvertTarget (转换目标)                               │
│  ├─ PrevProfile / NextProfile (策略组前后节点)               │
│  └─ Memo (备注)                                          │
├─────────────────────────────────────────────────────────┤
│  ServerStatItem (流量统计)                                 │
│  ├─ IndexId (主键)                                       │
│  ├─ TotalUp / TotalDown                                  │
│  ├─ TodayUp / TodayDown                                  │
│  └─ DateNow (日期标记)                                    │
└─────────────────────────────────────────────────────────┘
```

### 2.2 核心设计模式

V2rayN 的核心设计哲学是 **"实体与元数据分离"**：

- **ProfileItem** 存储节点的"是什么"（协议、地址、配置参数）
- **ProfileExItem** 存储节点的"表现"（延迟、速度、排序、IP信息）
- **SubItem** 存储订阅的"策略"（更新、过滤、排序、启用）
- **ServerStatItem** 存储节点的"用量"（上行/下行流量）

这种分离让节点配置和运行/显示数据互不干扰，可以独立增删改。

### 2.3 V2rayN 关键交互

| 交互 | 说明 |
|---|---|
| 双击连接 | 双击节点直接连接推荐核心 |
| Enter 连接 | 选中单个节点按 Enter 连接 |
| Delete 删除 | 选中节点按 Delete 删除 |
| Ctrl+A 全选 | 选中全部节点 |
| Ctrl+O TCPing | 批量 TCP 延迟测试 |
| Ctrl+R 真实Ping | 批量真实延迟测试 |
| T/U/D/B 移动 | Top/Up/Down/Bottom 快捷键 |
| 右键菜单 | 与 V2rayN ProfilesView 菜单结构一致 |
| 排序列点击 | 点击表头排序，箭头指示方向 |

---

## 三、重构数据模型设计

### 3.1 实体关系图

```
┌──────────────────┐       ┌──────────────────────┐
│  StoredNode      │──┐    │  ProfileExItem       │
│  (节点实体)       │  │    │  (扩展元数据)          │
│                  │  │    │                      │
│  id (PK)         │  └──►│  nodeId (FK=PK)       │
│  groupId         │       │  delay               │
│  name            │       │  speed               │
│  protocol        │       │  sort                │
│  host            │       │  ipInfo              │
│  port            │       │  lastTested          │
│  rawUrl          │       │  totalUp / totalDown │
│  details (JSON)  │       │  todayUp / todayDown │
│  latency         │       │  todayResetDate      │
│  lastTested      │       └──────────────────────┘
│  createdAt       │
├──────────────────┤       ┌──────────────────────┐
│                  │──┐    │  ServerStatItem        │
│  StoredSubItem   │  └──►│  (流量统计)             │
│  (订阅实体)       │      │                      │
│                  │      │  nodeId (FK=PK)       │
│  id (PK)         │      │  sessionUp / sessionDown
│  remarks         │      │  totalUp / totalDown   │
│  url             │      │  todayUp / todayDown   │
│  moreUrl         │      │  dateKey (yyyy-MM-dd)  │
│  enabled         │      └──────────────────────┘
│  userAgent       │
│  sort            │
│  filter          │
│  autoUpdate      │
│  updateInterval  │
│  convertTarget   │
│  memo            │
│  lastUpdated     │
└──────────────────┘
└──────────────────┘
```

### 3.2 TypeScript 类型定义

```typescript
// ===== 节点实体（扩展版） =====
export interface ProfileItem {
  id: string                          // PK, node_xxx
  groupId: string                     // "manual" 或 sub_xxx
  name: string                        // 备注
  protocol: string                    // vmess, vless, trojan...
  host: string                        // 地址
  port: number                        // 端口
  rawUrl: string                      // 原始分享链接
  details: Record<string, unknown>    // 协议详细参数
  // 扩展字段
  coreType?: string                   // 推荐核心类型 (ECoreType 对齐)
  protocolExtra?: Record<string, unknown>  // 协议扩展 (flow, ss-method...)
  transportExtra?: Record<string, unknown>  // 传输扩展 (gRPC, WS...)
  displayLog?: boolean                // 是否显示日志
  createdAt: number
}

// ===== 节点扩展元数据 =====
export interface ProfileExItem {
  nodeId: string                      // FK -> ProfileItem.id, PK
  delay: number                       // 延迟ms, -1=不可达, 0=未测试
  speed: number                       // 速度 B/s
  sort: number                        // 排序权重
  ipInfo: string                      // IP地理信息
  lastTested: number | null           // 最后测试时间戳
  // 流量统计
  totalUp: number                     // 累计上行 (bytes)
  totalDown: number                   // 累计下行 (bytes)
  todayUp: number                     // 今日上行
  todayDown: number                   // 今日下行
  todayResetDate: string              // 统计周期日期键 yyyy-MM-dd（每日 0 点自动归零 todayUp/todayDown）
}

// ===== 订阅实体（对齐 SubItem） =====
export interface SubItem {
  id: string                          // PK, sub_xxx
  remarks: string                     // 订阅名称
  url: string                         // 订阅URL
  moreUrl: string                     // 备用URL
  enabled: boolean                    // 启用状态
  userAgent: string                   // 请求头
  sort: number                        // 订阅排序权重
  filter: string                      // 节点名称正则过滤器
  autoUpdate: boolean                 // 自动更新开关
  updateInterval: number              // 更新间隔(小时)
  convertTarget: string               // 转换目标
  memo: string                        // 备注
  lastUpdated: number | null          // 最后更新时间
}
```

---

## 四、主进程模块设计

### 4.1 新增/修改文件清单

```
app/main/
├── profile-store.ts              ← [新增] ProfileExItem 持久化层（替代 profile-ex-store）
├── stat-store.ts                 ← [新增] ServerStatItem 流量统计持久化
├── profile-service.ts           ← [新增] ProfileItem CRUD + 排序 + 移动
├── sub-item-store.ts            ← [新增] SubItem 持久化（对齐 V2rayN SubItem）
├── subscription-manager.ts      ← [重构] 从 subscription-service.ts 拆分出 SubItem 管理
├── protocol-parser.ts           ← [修改] 增加 protocolExtra / transportExtra 字段解析
├── nodes-store.ts               ← [修改] 精简为纯 ProfileItem 存储
├── ipc-handlers.ts              ← [修改] 增加 Profile / SubItem IPC 通道
└── latency-tester.ts            ← [修改] 增加 RealPing / SpeedTest 测试接口
```

### 4.2 ProfileService 设计

```typescript
// 职责：ProfileItem 的完整 CRUD + 排序 + 移动
export class ProfileService {
  // 基本操作
  list(groupId?: string): ProfileItem[]
  getById(id: string): ProfileItem | null
  add(input: ProfileItemCreateInput, groupId: string): ProfileItem
  update(id: string, fields: Partial<ProfileItem>): ProfileItem
  delete(id: string, groupId: string): void
  clone(id: string): ProfileItem
}

// ===== 节点创建输入类型 =====
export interface ProfileItemCreateInput {
  name: string
  protocol: string
  host: string
  port: number
  rawUrl?: string
  details?: Record<string, unknown>
  coreType?: string
  protocolExtra?: Record<string, unknown>
  transportExtra?: Record<string, unknown>
  displayLog?: boolean
}

  // 排序与移动（对齐 V2rayN EMove）
  moveToTop(groupId: string, ids: string[]): void
  moveUp(groupId: string, ids: string[]): void
  moveDown(groupId: string, ids: string[]): void
  moveToBottom(groupId: string, ids: string[]): void
  moveBetween(groupId: string, ids: string[], targetGroupId: string): void

  // 排序规则
  sortByDelay(groupId: string, asc: boolean): ProfileItem[]
  sortBySpeed(groupId: string, asc: boolean): ProfileItem[]
  sortBySortField(groupId: string): ProfileItem[]  // 按 sort 字段排序
}
```

### 4.3 ProfileExService 设计

```typescript
// 职责：ProfileExItem 的读写（延迟/速度/IP/排序权重）
export class ProfileExService {
  get(nodeId: string): ProfileExItem
  getAll(): Map<string, ProfileExItem>
  setDelay(nodeId: string, delay: number): void
  setSpeed(nodeId: string, speed: number): void
  setIpInfo(nodeId: string, ipInfo: string): void
  setSort(nodeId: string, sort: number): void
  batchSetDelay(nodes: { nodeId: string; delay: number }[]): void
  batchSetSpeed(nodes: { nodeId: string; speed: number }[]): void
  clearInvalid(groupId?: string): void  // 清除 -1 延迟结果
  resetTodayStats(): void               // 重置今日流量统计
}
```

### 4.4 SubItemManager 设计

```typescript
// 职责：订阅实体的完整 CRUD（对齐 V2rayN SubEditWindow）
export class SubItemManager {
  list(sortAsc = true): SubItem[]
  getById(id: string): SubItem | null
  upsert(input: SubItemUpsertInput): SubItem  // 新增/更新统一接口
  delete(id: string): void
  toggleAuto(id: string, enabled: boolean): void
  reorder(ids: string[]): void  // 拖拽排序
  refresh(id: string): SubDiff  // 触发订阅更新并返回 diff
}

export interface SubItemUpsertInput {
  id?: string
  remarks: string
  url: string
  moreUrl?: string
  enabled?: boolean
  userAgent?: string
  sort?: number
  filter?: string
  autoUpdate?: boolean
  updateInterval?: number
  convertTarget?: string
  memo?: string
}
```

### 4.5 IPC 通道设计

```typescript
// ===== ProfileItem IPC =====
ipcMain.handle('profile:list', (_, groupId?: string) => profileService.list(groupId))
ipcMain.handle('profile:get', (_, id: string) => profileService.getById(id))
ipcMain.handle('profile:add', (_, node: StoredNode, groupId: string) => profileService.add(node, groupId))
ipcMain.handle('profile:update', (_, id: string, fields: Partial<ProfileItem>) => profileService.update(id, fields))
ipcMain.handle('profile:delete', (_, id: string, groupId: string) => profileService.delete(id, groupId))
ipcMain.handle('profile:clone', (_, id: string) => profileService.clone(id))

// 排序与移动
ipcMain.handle('profile:move-top', (_, groupId: string, ids: string[]) => profileService.moveToTop(groupId, ids))
ipcMain.handle('profile:move-up', (_, groupId: string, ids: string[]) => profileService.moveUp(groupId, ids))
ipcMain.handle('profile:move-down', (_, groupId: string, ids: string[]) => profileService.moveDown(groupId, ids))
ipcMain.handle('profile:move-bottom', (_, groupId: string, ids: string[]) => profileService.moveToBottom(groupId, ids))
ipcMain.handle('profile:move-between', (_, fromGroupId: string, toGroupId: string, ids: string[]) =>
  profileService.moveBetween(fromGroupId, toGroupId, ids))
ipcMain.handle('profile:sort-by', (_, groupId: string, colName: string, asc: boolean) => {
  switch (colName) {
    case 'DelayVal': return profileService.sortByDelay(groupId, asc)
    case 'SpeedVal': return profileService.sortBySpeed(groupId, asc)
    case 'Sort': return profileService.sortBySortField(groupId)
    default: return profileService.sortByDelay(groupId, asc)
  }
})

// ===== ProfileExItem IPC =====
ipcMain.handle('profile-ex:get', (_, nodeId: string) => profileExService.get(nodeId))
ipcMain.handle('profile-ex:get-all', () => profileExService.getAll())
ipcMain.handle('profile-ex:set-delay', (_, nodeId: string, delay: number) => profileExService.setDelay(nodeId, delay))
ipcMain.handle('profile-ex:set-speed', (_, nodeId: string, speed: number) => profileExService.setSpeed(nodeId, speed))
ipcMain.handle('profile-ex:batch-set-delay', (_, items: { nodeId: string; delay: number }[]) =>
  profileExService.batchSetDelay(items))
ipcMain.handle('profile-ex:clear-invalid', (_, groupId?: string) => profileExService.clearInvalid(groupId))
ipcMain.handle('profile-ex:reset-today-stats', () => profileExService.resetTodayStats())

// ===== SubItem IPC =====
ipcMain.handle('sub-item:list', (_, sortAsc = true) => subItemManager.list(sortAsc))
ipcMain.handle('sub-item:get', (_, id: string) => subItemManager.getById(id))
ipcMain.handle('sub-item:upsert', (_, input: SubItemUpsertInput) => subItemManager.upsert(input))
ipcMain.handle('sub-item:delete', (_, id: string) => subItemManager.delete(id))
ipcMain.handle('sub-item:toggle-auto', (_, id: string, enabled: boolean) => subItemManager.toggleAuto(id, enabled))
ipcMain.handle('sub-item:reorder', (_, ids: string[]) => subItemManager.reorder(ids))
ipcMain.handle('sub-item:refresh', (_, id: string) => subItemManager.refresh(id))
```

---

## 五、渲染进程模块设计

### 5.1 组件树重构

```
MyNodes.tsx                          ← 页面协调器（不变，精简逻辑）
├── GroupFilter.tsx                   ← 分组筛选器（增强：支持拖拽排序）
├── NodeTable.tsx                     ← 节点表格（增强：全功能 DataGrid）
│   ├── ProtocolTag                   ← 协议标签组件
│   ├── LatencyTag                    ← 延迟标签组件
│   ├── SpeedTag                      ← 速度标签组件
│   └── ActionButtons                 ← 操作按钮组
├── NodeContextMenu.tsx               ← 右键菜单（去掉占位符，全部实现）
├── EditNodeModal.tsx                 ← 节点编辑（大幅增强：分面板编辑）
├── ConnectCoreModal.tsx              ← 连接核心（增强：支持默认核心记忆）
├── ImportBatchModal.tsx              ← 批量导入（不变）
├── SubEditModal.tsx                  ← [新增] 订阅编辑（对齐 V2rayN SubEditWindow）
└── SubListModal.tsx                  ← [新增] 订阅管理列表
```

### 5.2 EditNodeModal 增强设计

当前 EditNodeModal 仅支持编辑名称/地址/端口和 JSON details。重构后分为三个面板：

```
┌── 节点编辑 ──────────────────────────────┐
│ [基本信息] [传输配置] [高级选项]           │
│                                           │
│ 协议: vmess    核心: Xray ▼              │
│ 备注: 测试节点                              │
│ 地址: example.com                          │
│ 端口: 443                                  │
│ 用户ID: xxx-xxx-xxx                       │
│ 加密: auto                                 │
│                                           │
│ 传输: websocket                            │
│ 路径: /ws                                  │
│ Host: example.com                          │
│ TLS: reality                               │
│ SNI: example.com                           │
│                                           │
│ 显示日志: ☑                                │
│ 默认核心: Xray                             │
└──────────────────────────────────────────┘
```

各协议对应的表单字段从 `protocol-parser.ts` 的解析逻辑反向生成。

### 5.3 SubEditModal 设计（新增）

对齐 V2rayN `SubEditWindow`：

```
┌── 订阅设置 ──────────────────────────────┐
│ 订阅名称: 海外节点                         │
│ 订阅URL: https://...                     │
│ 备用URL: https://..., https://...        │
│                                           │
│ [启用] ☑  自动更新: ☑ 间隔(小时): 12     │
│ User-Agent: KiNGO/1.0                    │
│ 名称过滤: ^香港.* (正则)                  │
│ 转换目标: clashmeta                       │
│ 备注: 主要使用的海外节点                   │
└──────────────────────────────────────────┘
```

### 5.4 NodeContextMenu 功能对齐

| 菜单项 | 当前状态 | 重构后 |
|---|---|---|
| 设为默认服务器 | ✅ | ✅ 保持 |
| 选择核心连接 | ✅ | ✅ 增强：记忆上次选择 |
| 编辑服务器 | ✅ | ✅ 增强：分面板编辑 |
| 复制服务器 | ✅ | ✅ 保持 |
| 删除服务器 | ✅ | ✅ 保持 |
| 删除重复服务器 | ✅ | ✅ 基于 protocol:host:port 去重 |
| 清除无效测速结果 | ✅ | ✅ 调用 ProfileExService.clearInvalid |
| TCPing 测试 | ✅ | ✅ 保持 |
| 真实延迟测试 | ⚠️ 即将推出 | ✅ 实现 RealPing |
| UDP 测试 | ⚠️ 即将推出 | 🔄 后续阶段 |
| 速度测试 | ⚠️ 即将推出 | 🔄 后续阶段 |
| 混合测试 | ⚠️ 即将推出 | 🔄 后续阶段 |
| 按测速结果排序 | ✅ | ✅ 调用 ProfileService.sortByDelay |
| 移至顶部 | ⚠️ 即将推出 | ✅ 调用 ProfileService.moveToTop |
| 上移 | ⚠️ 即将推出 | ✅ 调用 ProfileService.moveUp |
| 下移 | ⚠️ 即将推出 | ✅ 调用 ProfileService.moveDown |
| 移至底部 | ⚠️ 即将推出 | ✅ 调用 ProfileService.moveToBottom |
| 移至分组 | ⚠️ 即将推出 | ✅ 调用 ProfileService.moveBetween |
| 全选 | ✅ | ✅ 保持 |
| 分享服务器 | ⚠️ 即将推出 | ✅ 调用 generateShareUrl |
| 导出客户端配置到文件 | ⚠️ 即将推出 | ✅ 调用 config-generator |
| 导出客户端配置到剪贴板 | ⚠️ 即将推出 | ✅ 调用 config-generator |
| 复制分享链接 | ⚠️ 即将推出 | ✅ 调用 generateShareUrl |
| Base64 分享链接 | ⚠️ 即将推出 | ✅ 同分享链接 |
| 生成全部策略组 | ⚠️ 即将推出 | 🔄 后续阶段 |
| 按地区生成策略组 | ⚠️ 即将推出 | 🔄 后续阶段 |

---

## 六、useNodesData Hook 重构

当前 hook 使用模块级缓存，但数据结构为 FlatNode（扁平合并表）。重构后改为：

```typescript
// useNodesData.ts - 重构后
export function useNodesData() {
  // profiles: ProfileItem[] （从 ProfileService 获取）
  const [profiles, setProfiles] = useState<ProfileItem[]>([])
  // profileExMap: Map<nodeId, ProfileExItem>
  const [profileExMap, setProfileExMap] = useState<Map<string, ProfileExItem>>(new Map())
  // subs: SubItem[] （从 SubItemManager 获取）
  const [subs, setSubs] = useState<SubItem[]>([])
  // conn: ActiveConnection | null
  const [conn, setConn] = useState<ActiveConnection | null>(null)

  const load = useCallback(async () => {
    try {
      const [items, exItems, subs, conn] = await Promise.all([
        api.profileList(),
        api.profileExGetAll(),
        api.subItemList(),
        api.getActiveConnection(),
      ])
      const exMap = new Map(exItems.map((e) => [e.nodeId, e]))
      setProfiles(items)
      setProfileExMap(exMap)
      setSubs(subs)
      setConn(conn)
    } catch (err) {
      console.error('[useNodesData] load failed:', err)
      // 降级：store 损坏时尝试重新初始化空数据
      setProfiles([])
      setProfileExMap(new Map())
      setSubs([])
    }
  }, [])}, [])

  // flatNodes: 虚拟合并 view（不存储，按需计算）
  const flatNodes = useMemo(() => {
    return profiles.map((p) => {
      const ex = profileExMap.get(p.id) || { delay: 0, speed: 0, sort: 0, ipInfo: '' }
      const sub = subs.find((s) => s.id === p.groupId)
      return {
        ...p,
        ...ex,
        groupName: p.groupId === 'manual' ? '手动添加' : sub?.remarks || '未知',
        isActive: conn?.nodeId === p.id,
      }
    })
  }, [profiles, profileExMap, subs, conn])

  return {
    profiles,
    flatNodes,
    subs,
    profileExMap,
    loading,
    conn,
    reload: () => load(),
  }
}
```

**关键变更**：
- `profiles` 和 `profileExMap` 分开存储，按需合并
- `flatNodes` 通过 `useMemo` 计算，不单独存储
- 新增 `subs` 返回 SubItem 数组

---

## 七、实施阶段

### 阶段一：数据模型层（预计 2.5-3 天）

| 步骤 | 文件 | 内容 |
|---|---|---|
| 1.1 | `profile-store.ts` | 新建 ProfileExItem 持久化层（electron-store） |
| 1.2 | `stat-store.ts` | 新建流量统计持久化层 |
| 1.3 | `sub-item-store.ts` | 新建 SubItem 持久化层 |
| 1.4 | `profile-service.ts` | 新建 ProfileItem CRUD + 移动 + 排序 |
| 1.5 | `profile-ex-service.ts` | 新建 ProfileExItem 读写 + 批量延迟/速度设置 |
| 1.6 | `sub-item-manager.ts` | 新建 SubItem 管理（upsert/toggle/reorder） |
| 1.7 | `nodes-store.ts` | 精简为纯 ProfileItem 存储（去掉旧字段） |
| 1.8 | `protocol-parser.ts` | 增加 protocolExtra / transportExtra 字段解析 |

### 阶段二：IPC 层（预计 1 天）

| 步骤 | 文件 | 内容 |
|---|---|---|
| 2.1 | `ipc-handlers.ts` | 新增 Profile/SubItem/ProfileEx IPC 通道 |
| 2.2 | `preload/index.ts` | 暴露新 IPC API 到 preload |
| 2.3 | `services/ipc-client.ts` | 前端类型安全封装 |
| 2.4 | 旧 IPC 兼容 | 保留 `node:*` 旧通道作为适配层 |

### 阶段三：渲染组件层（预计 2 天）

| 步骤 | 文件 | 内容 |
|---|---|---|
| 3.1 | `types.ts` | 更新类型定义（对齐 V2rayN） |
| 3.2 | `useNodesData.ts` | 重构 hook，支持 ProfileEx + SubItem |
| 3.3 | `EditNodeModal.tsx` | 重构为分面板编辑 |
| 3.4 | `SubEditModal.tsx` | 新建订阅编辑弹窗 |
| 3.5 | `NodeContextMenu.tsx` | 去掉占位符，全部实现 |
| 3.6 | `NodeTable.tsx` | 增强：列可拖拽排序、流量统计列 |
| 3.7 | `GroupFilter.tsx` | 增强：订阅拖拽排序 |
| 3.8 | `MyNodes.tsx` | 精简逻辑，去掉占位符处理 |
| 3.9 | `ConnectCoreModal.tsx` | 增强：默认核心记忆 |

### 阶段四：联调与清理（预计 1 天）

| 步骤 | 内容 |
|---|---|
| 4.1 | 全量测试所有右键菜单功能 |
| 4.2 | 验证排序持久化（刷新页面后排序不变） |
| 4.3 | 清理旧 IPC 通道（`node:*` 适配层） |
| 4.4 | 清理旧 store 中的废弃字段 |
| 4.5 | 修复所有 TypeScript 诊断 |

### 阶段五：后续增强（下一阶段）

- [ ] RealPing / SpeedTest / MixedTest 测试引擎
- [ ] 流量统计自动采集（通过代理核心 API 或系统网络接口）
- [ ] 策略组生成（按地区/按核心分组）
- [ ] WireGuard / AnyTLS / Inner 协议导入
- [ ] 拖拽排序 UI（React DnD 或 dnd-kit）
- [ ] 节点分享二维码

---

## 八、关键设计决策

### 8.5 数据迁移策略

升级时自动将旧 StoredNode 数据迁移到新的三表模型：

`
迁移流程：
1. 读取旧 nodes-store.json 中的所有 StoredNode
2. 转换为 ProfileItem（字段映射：StoredNode.id → ProfileItem.id, StoredNode.name → ProfileItem.name...）
3. 为每个 ProfileItem 创建 ProfileExItem（初始值：delay=0, speed=0, sort=原索引, ipInfo=''）
4. 将 StoredSubItem 转换为 SubItem
5. 写入新的 profile-store / profile-ex-store / sub-item-store
6. 备份旧 store 为 nodes-store.bak.json，删除旧文件
`

**兼容层**：
- 阶段二期间，旧 
ode:* IPC 通道作为适配层，内部调用新的 ProfileService
- 迁移未完成前，新旧 store 同时读取，优先使用新 store 的数据
- 迁移失败时自动回滚到旧 store，记录错误日志到 Electron devtools

**回滚机制**：
- 每次迁移前先备份旧 store
- 迁移过程中捕获异常，恢复备份文件
- 提供 --migrate-reset 命令行参数强制回滚

### 8.1 为什么不直接用 SQLite？

当前使用 `electron-store`（JSON 文件）足以满足节点管理需求：

- KiNGO 典型节点数 < 500，JSON 读写性能足够
- `electron-store` 天然支持字段级增删改
- 避免引入额外依赖和编译问题
- V2rayN 使用 SQLite 是因为 .NET 生态成熟，Electron 生态中 JSON + IndexedDB 更合适

**未来如果节点数 > 2000，可考虑迁移到 `better-sqlite3`。**

### 8.2 节点与订阅的关系

```
SubItem (订阅)
  └── ProfileItem[] (节点，groupId = sub.id)
        └── ProfileExItem (扩展元数据)
```

- 手动添加的节点：`groupId = 'manual'`
- 订阅导入的节点：`groupId = sub.id`
- 订阅更新时，基于 `protocol:host:port` key 匹配旧节点，保留 ProfileEx 数据
- 手动编辑订阅节点后，再次更新订阅时可能被覆盖（有提示）

### 8.3 排序机制

```
排序优先级：
1. 分组筛选（手动添加 vs 各订阅）
2. ProfileEx.sort 字段（持久化排序权重）
3. 测速结果排序（按 delay/speed 临时排序，不持久化）
4. 节点名称字母序（兜底）
```

手动拖拽排序会更新 `ProfileEx.sort`，持久化到 store。

### 8.4 延迟与速度的写入时机

| 事件 | ProfileEx 字段 |
|---|---|
| TCPing 完成 | `delay` + `lastTested` |
| RealPing 完成 | `delay` + `lastTested` |
| 速度测试完成 | `speed` |
| 清除无效 | `delay = 0` |
| 连接建立 | 不修改任何字段 |

---

## 九、与 V2rayN 的差异与取舍

| 功能 | V2rayN | KiNGO 方案 | 原因 |
|---|---|---|---|
| 持久化 | SQLite | electron-store (JSON) | Electron 生态更简单 |
| 流量统计 | Core API 实时采集 | 手动统计（后续阶段） | 需要对接各核心 API |
| 策略组 | 本地策略组文件 | 暂不支持 | 非核心需求 |
| 路由规则 | 内置路由规则编辑 | 由代理核心自带规则引擎处理 | Clash.Meta/SingBox 已有 |
| 核心管理 | 自动检测下载 | 内置 + 版本检查 | KiNGO 是便携版 |
| 分享二维码 | ZXing 生成 | 暂不支持 | 手机端使用少 |
| 自动更新 | 内置 | electron-updater | 更成熟 |

---

## 十、风险评估

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| 订阅节点更新时丢失 ProfileEx 数据 | 中 | 基于 key 合并时保留旧 ProfileEx |
| ProfileItem 与 StoredNode 双模型并存 | 中 | 阶段二完成后统一为 ProfileItem |
| ProtocolParser 改动影响其他模块 | 高 | 仅增加可选字段，不破坏已有结构 |
| electron-store 大 JSON 读写性能 | 低 | 分文件存储（profile-store / sub-item-store） |
| 节点数量多时表格渲染卡顿 | 中 | 虚拟滚动（antd Table 已支持） |

---

## 十一、验收标准

### 阶段一验收

- [ ] `profile-store.ts` 可以独立读写 ProfileExItem
- [ ] `sub-item-store.ts` 可以独立读写 SubItem
- [ ] `profile-service.ts` 支持完整 CRUD + Top/Up/Down/Bottom 移动
- [ ] `profile-ex-service.ts` 支持批量设置延迟/速度
- [ ] `sub-item-manager.ts` 支持 upsert / toggleAuto / reorder
- [ ] `protocol-parser.ts` 兼容现有所有分享链接格式

### 阶段二验收

- [ ] 所有新增 IPC 通道正常工作
- [ ] preload 暴露完整的 API 表面
- [ ] ipc-client.ts 类型安全无警告
- [ ] 旧 `node:*` IPC 通道作为适配层兼容

### 阶段三验收

- [ ] EditNodeModal 支持分面板编辑（基本/传输/高级）
- [ ] SubEditModal 支持编辑订阅所有字段
- [ ] 右键菜单无 "即将推出" 占位符
- [ ] 移动 Top/Up/Down/Bottom 排序持久化
- [ ] 移至分组功能正常工作
- [ ] 复制分享链接/Base64 正常工作
- [ ] 导出客户端配置正常工作

### 全量验收

- [ ] 右键菜单所有功能均工作
- [ ] 排序在页面刷新后保持一致
- [ ] 订阅更新不丢失已有测试/排序数据
- [ ] 手动编辑订阅节点后有提示
- [ ] 无 TypeScript 诊断错误
- [ ] 节点数 200+ 时表格流畅
- [ ] 节点数 500 时 store JSON 读写 < 50ms
- [ ] 批量延迟测试 100 节点内存峰值 < 200MB

---

## 附录 A：V2rayN EConfigType 对照表

| KiNGO protocol | V2rayN EConfigType |
|---|---|
| vmess | VMess (1) |
| vless | VLESS (5) |
| trojan | Trojan (6) |
| ss | Shadowsocks (3) |
| ssr | — (无对应，KiNGO 特有) |
| hysteria | — |
| hysteria2 | Hysteria2 (7) |
| tuic | TUIC (8) |
| naive | Naive (12) |
| socks | SOCKS (4) |
| http | HTTP (10) |
| wireguard | WireGuard (9) |
| mieru | — |
| juicity | — |
| shadowquic | — |

## 附录 B：V2rayN EMove 对照

| 操作 | EMove | KiNGO IPC |
|---|---|---|
| 移至顶部 | Top (1) | `profile:move-top` |
| 上移 | Up (2) | `profile:move-up` |
| 下移 | Down (3) | `profile:move-down` |
| 移至底部 | Bottom (4) | `profile:move-bottom` |
| 移至位置 | Position (5) | `profile:move-between` |

## 附录 C：V2rayN EServerColName 列顺序

```
Def(0) → ConfigType(1) → Remarks(2) → Address(3) → Port(4)
→ Network(5) → StreamSecurity(6) → SubRemarks(7)
→ DelayVal(8) → SpeedVal(9) → IpInfo(10)
→ TodayDown(11) → TodayUp(12) → TotalDown(13) → TotalUp(14)
```

KiNGO 当前表格列顺序与 V2rayN 高度一致，只需新增 `IpInfo`、`TodayDown`、`TodayUp`、`TotalDown`、`TotalUp` 列。









