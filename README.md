<h1 align="center">
  <img src="./app/renderer/src/assets/KiNGO.png" alt="KiNGO" width="96" />
  <br />
  KiNGO
</h1>

<h3 align="center">
  面向 Windows 的多模式网络代理客户端
</h3>

<p align="center">
  公共线路 · Clash 模式 · V2rayN 模式 · mihomo · Xray · sing-box
</p>

<p align="center">
  <a href="https://github.com/KINGHY02/KiNGO/releases">下载最新版</a>
  ·
  <a href="https://github.com/KINGHY02/KiNGO/issues">问题反馈</a>
  ·
  <a href="https://t.me/kingovpn">Telegram 交流群</a>
</p>

## KiNGO 是什么？

KiNGO 是一款面向 Windows 的网络代理客户端，提供公共线路、Clash 模式和 V2rayN 模式三种入口。

它的目标是让不同使用习惯的用户都能快速上手：

- 新用户可以从首页一键连接公共线路，先体验 KiNGO 的基本流程。
- Clash 用户可以进入 Clash 模式，导入订阅或 YAML 配置，管理代理组和节点。
- v2rayN 用户可以进入 V2rayN 模式，按分组、订阅和节点列表的方式管理节点。

KiNGO 只负责客户端连接、配置管理和本地代理控制，不运营、不销售、也不提供代理线路。

## 主要功能

- 首页一键连接/断开，显示当前模式、节点/线路、延迟和连接状态。
- 公共线路自动选择，支持快速体验 KiNGO 的连接流程。
- Clash 模式支持 Clash YAML 和常见订阅链接，默认使用 mihomo 核心。
- V2rayN 模式支持订阅分组、手动分组、批量导入、删除、排序和节点测速。
- 支持系统代理开关，并提供 TUN 模式入口。
- 托盘常驻，支持快速查看状态、打开主窗口和断开连接。
- 提供连接日志，方便排查订阅更新、核心启动和系统代理问题。
- 支持亮色、暗色、粉色、冰川蓝等界面主题。
- 支持代理核心版本检测、下载更新、打开核心目录和恢复内置核心。

## 三种使用入口

### 首页 / 公共线路

首页适合快速连接。点击主按钮后，KiNGO 会根据当前设置选择公共线路并尝试连接。

公共线路来自第三方公开项目，KiNGO 不运营或提供代理线路，其可用性和稳定性不受 KiNGO 控制。

### Clash 模式

适合 Clash Verge、Clash Party、Clash for Windows 等用户。

- 导入 Clash 订阅或 YAML 配置。
- 查看代理组和节点。
- 切换代理组中的节点。
- 使用规则、全局、直连等常见模式。
- 通过 mihomo 核心提供 Clash 生态兼容能力。

### V2rayN 模式

适合 v2rayN 用户。

- 支持订阅分组和手动分组。
- 支持粘贴导入节点链接。
- 支持批量删除、键盘 Delete 删除、表格排序和节点测速。
- 以接近 v2rayN 的列表方式管理节点。

## 核心管理

KiNGO 内置常用代理核心，首次安装后即可使用。

如果用户手动更新核心，KiNGO 会把更新后的核心保存到用户数据目录，并在启动时优先使用用户更新版核心：

```text
用户更新版核心 > 安装包内置核心 > 缺失提示
```

这样软件升级不会覆盖用户自己更新过的核心。

如果更新后的核心出现问题，可以在设置中恢复内置核心。

## 下载与安装

请前往 GitHub Releases 下载最新 Windows 安装包：

[KiNGO Releases](https://github.com/KINGHY02/KiNGO/releases)

安装后运行 KiNGO，根据需要选择首页公共线路、Clash 模式或 V2rayN 模式。

## 使用提示

1. 如果只是想快速体验，可以在首页直接点击连接按钮。
2. 如果你有 Clash 订阅，请进入「Clash 模式」导入订阅。
3. 如果你有 v2rayN 节点或订阅，请进入「V2rayN 模式」管理分组和节点。
4. 如果连接失败，请查看「连接日志」，日志中会显示订阅更新、核心启动和系统代理相关错误。

## 重要声明

KiNGO 是网络连接客户端，不运营、不销售、也不提供代理线路。

公共线路来自第三方公开项目，仅用于软件功能体验。其可用性、速度、稳定性和安全性不由 KiNGO 保证。

请遵守所在国家或地区的法律法规，仅在合法场景中使用 KiNGO。

## 反馈

如果遇到问题或希望提出建议，可以通过以下方式反馈：

- GitHub Issues：[提交问题](https://github.com/KINGHY02/KiNGO/issues)
- Telegram：[加入 KiNGO 交流群](https://t.me/kingovpn)
