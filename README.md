<p align="center">
  <img src="docs/assets/logo.webp" alt="DSH Desk 徽标" width="132">
</p>

<h1 align="center">DSH Desk</h1>

<p align="center">
  <sub><b>简体中文</b> · <a href="README.en.md">English</a></sub>
</p>

<p align="center">
  <strong>让 DeepSeek Harness 变成一个会回应你的桌面工作台。</strong>
</p>

<p align="center">
  <a href="https://github.com/Renakoni/dsh-desk/releases/download/v0.1.0/DSHDesk-Setup-0.1.0.exe">下载安装版</a>
  ·
  <a href="https://github.com/Renakoni/dsh-desk/releases/download/v0.1.0/DSHDesk-0.1.0-portable.zip">下载免安装版</a>
  ·
  <a href="https://github.com/Renakoni/dsh-desk/releases/tag/v0.1.0">查看 v0.1.0 Release</a>
</p>

<p align="center">
  <a href="https://github.com/Renakoni/dsh-desk/releases/tag/v0.1.0"><img src="https://img.shields.io/github/v/release/Renakoni/dsh-desk?display_name=tag&style=flat-square" alt="最新版本"></a>
  &nbsp;
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/DeepSeek-Harness-4c8492?style=flat-square" alt="DeepSeek Harness"></a>
  &nbsp;
  <img src="https://img.shields.io/badge/Windows-10%2F11%20x64-4c8492?style=flat-square&logo=windows&logoColor=white" alt="Windows 10/11 x64">
  &nbsp;
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-4c566a?style=flat-square" alt="许可证：MIT"></a>
</p>

## DSH Desk 是什么

DSH Desk 把 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 带到桌面：实时显示会话、工具、权限和用量，统一管理桌宠、插件、Skill 与 DSH Web 主题。

## 核心能力

| 5000+ 桌宠生态 | DSH 实时联动 |
| --- | --- |
| 兼容 [codex-pet](https://codex-pet.org) 宠物包格式。内置 Aqua、月薪喵和 DeepSeek 鲸鱼娘，可继续接入 5000+ 桌宠。 | 接收会话、工具、任务、错误和权限事件。支持 DSH Web / Headless，桌宠、通知和声音随状态响应。 |
| **统一扩展管理** | **插件市场与主题市场** |
| 统一管理 DSH 插件、Skill 和组件。把 Plugin、Skill、DSH Web 主题组合成方案，按工作场景一键切换。 | 浏览并安装插件和 Skill；预览、安装、更新、卸载 DSH Web 主题，缓存预览资源，处理常见旧版注册方式。 |

## 开箱即用

安装包已经包含三只可直接切换的桌宠：

- **Minato Aqua**
- **月薪喵**
- **DeepSeek 鲸鱼娘**（`maid-deepseek-whale`）

更多桌宠可以通过 codex-pet 宠物包或应用内的安装命令继续加入。

## 安装与快速开始

需要 Windows 10 / 11 x64、Node.js，以及可以运行的 DeepSeek Harness：

```powershell
npx @deepseek-ai/dsh web
```

### 安装版

1. 下载 [DSHDesk-Setup-0.1.0.exe](https://github.com/Renakoni/dsh-desk/releases/download/v0.1.0/DSHDesk-Setup-0.1.0.exe) 并安装。
2. 启动 DSH Desk，在“总览”中安装 DSH 插件。
3. 重启正在运行的 DSH Web 或 Headless profile，使插件生效。

### 免安装版

下载 [DSHDesk-0.1.0-portable.zip](https://github.com/Renakoni/dsh-desk/releases/download/v0.1.0/DSHDesk-0.1.0-portable.zip)，解压后直接运行其中的 `DSH Desk.exe`。

DSH Desk 使用官方 DSH CLI 将插件安装到对应 profile，无需构建 DeepSeek Harness 源码。

## 从源码构建

```powershell
npm install
npm run dev:electron
npm test
npm run typecheck
npm run dist:win
```

`npm run build` 会先把 `dsh-plugin/` 打包成 tarball；Windows 安装包会将它放入应用资源目录，供界面中的插件安装操作使用。

插件自身测试：

```powershell
npm test --prefix ./dsh-plugin
```

## 许可证与署名

代码基于 [MIT 许可证](LICENSE) 发布。

- **DeepSeek Harness**：DSH 事件、插件和 approval 协议来自 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)。
- **凑阿库娅（Minato Aqua）**：内置桌宠素材为二次创作，角色版权归 COVER Corp. 及原绘制者所有，仅限非商业使用，并遵循 [hololive 二次创作指南](https://hololivepro.com/terms/)。
- **Clawd Companion**：部分界面与事件链路演化自 [Clawd Companion](https://github.com/Doulor/Clawd-Companion)（MIT © Doulor）。
- 宠物主题兼容 [codex-pet](https://codex-pet.org) 格式。

---

<p align="center"><sub><em>桌宠是入口，DSH 的实时反馈与扩展管理才是完整的工作台。</em></sub></p>
