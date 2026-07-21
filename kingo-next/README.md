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

`npm run bundle` 会构建 Windows x64 NSIS 安装包，输出目录为：

```text
src-tauri\target\release\bundle\nsis\
```

如需重新生成安装器图片和应用图标：

```powershell
npm run assets:installer
npm run tauri -- icon src-tauri/icons/app-icon-source.png
```

## 目录

```text
src/                       React 用户界面
src-tauri/src/             Rust 后端与系统集成
src-tauri/resources/       内置核心和线路配置
src-tauri/installer/       安装器文案与视觉素材
scripts/                   可重复执行的素材生成脚本
```

用户订阅、私有节点、SQLite 数据库和运行日志只应写入系统应用数据目录，不得加入源码或公开构建上下文。
