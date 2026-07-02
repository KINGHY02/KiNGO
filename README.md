# KiNGO

KiNGO 是一个面向 Windows 的多核心网络代理客户端。它希望让 Clash、V2rayN、Xray、sing-box 等生态的用户都能用熟悉的方式上手，同时保留简单的一键公共线路体验。

## 当前方向

- **Clash 模式**：面向 Clash Verge / Clash Party 用户，优先接入 mihomo 生态。
- **V2rayN 模式**：面向 v2rayN 用户，支持链接节点、订阅、分组、延迟和多核心连接。
- **公共线路**：封装第三方公开项目线路，作为开箱试用入口。
- **核心管理**：保留 Xray、sing-box、Hysteria、NaiveProxy、Juicity、Mieru、ShadowQUIC 等核心配置入口。

## 重要说明

KiNGO 不运营或提供代理线路。公共线路来自第三方公开项目，其可用性和稳定性不受 KiNGO 控制。

请遵守所在国家或地区的法律法规，仅在合法场景中使用 KiNGO。

## 开发

Electron 源码位于 `app/` 目录。

常用命令：

```bash
cd app
npm run dev
npm run build
npm run dist
```

如果本机没有 Node.js，可以使用 Codex 工作区内置 Node 运行相关脚本。

## 路线图

详见根目录的 `KINGO_ROADMAP.md`。

