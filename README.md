````bash
# WinPic

一款轻量的本地图库工具，专注于浏览与管理本地照片。

---

## 特性

- **多目录导入** —— 支持导入单个文件或整个文件夹，自动扫描子目录
- **缩略图缓存** —— 首次浏览后缓存到本地，二次打开秒开
- **收藏 / 搜索 / 排序** —— 按名称、时间排序，支持关键词过滤
- **查看器** —— 缩放、拖动、旋转、背景虚化，全键盘操作
- **文件操作** —— 重命名、移动到其他目录、删除到回收站
- **系统集成** —— 设为壁纸、在资源管理器中显示、以其他软件打开
- **个性化** —— 主题色（浅色 / 深色 / 跟随系统）、毛玻璃强度、渐变背景、自定义字体、缩略图尺寸和比例
- **保存旋转** —— 旋转结果可直接写回原文件（GIF / SVG 除外）

## 环境要求

- **Node.js** ≥ 18
- **Rust** ≥ 1.77（推荐用 [rustup](https://rustup.rs/) 安装）
- **Windows**：需要 [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/)（Win10/11 一般已预装）
- **macOS**：Xcode Command Line Tools
- **Linux**：`webkit2gtk`、`libayatana-appindicator3-dev` 等，详见 [Tauri 官方文档](https://tauri.app/start/prerequisites/)

## 快速开始

```bash
# 1. 安装前端依赖
npm install

# 2. 开发模式（带热重载）
npm run tauri dev

# 3. 打包发布版
npm run tauri build
```

打包产物位置：

- Windows：`src-tauri/target/release/bundle/nsis/` 和 `bundle/msi/`
- macOS：`src-tauri/target/release/bundle/dmg/`
- Linux：`src-tauri/target/release/bundle/appimage/` 和 `deb/`

## 快捷键

| 操作 | 快捷键 |
|---|---|
| 打开照片 | `Enter` 或 `Space`（光标在卡片上时） |
| 上一张 / 下一张 | `A` `←` ／ `D` `→` |
| 缩放 | 滚轮 ／ `+` `-` |
| 精细缩放 | `Shift` + 滚轮 |
| 逆时针旋转 90° | `W` 或 `↑` |
| 顺时针旋转 90° | `S` 或 `↓` |
| 慢速旋转（按住） | `Shift` + `W` / `S` |
| 重置缩放 / 位移 / 旋转 | `R` `0` 或双击图片 |
| 关闭查看器 | `Esc` |

## 支持的图片格式

`png` · `jpg` · `jpeg` · `gif` · `webp` · `bmp` · `svg` · `avif` · `ico` · `tiff`

> 不支持保存旋转：`gif` · `svg`

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | [Tauri 2](https://tauri.app/) |
| 前端 | 原生 HTML · CSS · JavaScript（无框架） |
| 后端 | Rust |
| 图片处理 | [`image`](https://crates.io/crates/image) crate |
| 回收站 | [`trash`](https://crates.io/crates/trash) crate |

## 项目结构

```
WinPic/
├── src/                        # 前端源码
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   └── logo.svg
├── src-tauri/                  # Tauri 桌面端
│   ├── src/
│   │   ├── main.rs
│   │   └── lib.rs              # 所有 Tauri 命令
│   ├── icons/                  # 应用图标
│   ├── capabilities/           # 权限配置
│   ├── Cargo.toml
│   ├── build.rs
│   └── tauri.conf.json
├── package.json
├── vite.config.js
└── README.md
```

## 打包说明

### Windows

```bash
npm run tauri build
```

### macOS / Linux

需在对应系统上构建（或使用 GitHub Actions 矩阵构建）。发布到终端用户前，macOS 需要 Apple 开发者账号做公证（Notarization）。

## 许可证

[MIT](./LICENSE)

## 致谢

- [DeepSeek] (https://www.deepseek.com/)
- [Tauri]    (https://tauri.app/)
- [image-rs] (https://github.com/image-rs/image)
- [trash-rs] (https://github.com/Byron/trash-rs)
