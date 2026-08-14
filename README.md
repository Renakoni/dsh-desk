<p align="center">
  <img src="docs/assets/logo.webp" alt="DSH Desk 徽标" width="132">
</p>

<h1 align="center">DSH Desk</h1>

<p align="center">
  <sub><b>简体中文</b> · <a href="README.en.md">English</a></sub>
</p>

<p align="center">
  <em>DeepSeek Harness 的实时桌宠与本地用量工作台。</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/DeepSeek-Harness-4c8492?style=flat-square" alt="DeepSeek Harness">
  &nbsp;
  <img src="https://img.shields.io/badge/Windows-10%2F11%20x64-4c8492?style=flat-square&logo=windows&logoColor=white" alt="Windows 10/11 x64">
  &nbsp;
  <img src="https://img.shields.io/badge/License-MIT-4c566a?style=flat-square" alt="许可证：MIT">
</p>

> [!NOTE]
> 这是一个非官方社区项目，与 DeepSeek、COVER Corp. 均无关联。默认桌宠形象为凑阿库娅相关二次创作，详见[许可证与署名](#许可证与署名)。

## 简介

DSH Desk 是面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Windows 桌面应用。它通过 DSH 插件接收会话生命周期、工具调用、任务结果、错误和权限请求，并让桌宠实时响应。

当前适配专注于真实用户常用的 `npx @deepseek-ai/dsh` 工作流。DSH 源码仓库仅用于核对事件与用量协议，不要求用户从源码构建 DSH。

## 已支持

- 一键把 `dsh-desk-plugin` 安装到 DSH 的 `web` 与 `headless` profiles。
- 响应会话开始、处理中、工具调用、工具结果、完成、阻塞和错误事件。
- 在桌面权限卡片中处理 DSH approval；桌宠未运行时会回退给 DSH 的下一个 approval handler。
- 本地展示执行轨迹、工具性能、最近编辑、Token 热力图、模型与项目用量。
- 支持 `inputTokens`、`outputTokens`、`cacheReadTokens`、`cacheWriteTokens` 与 `reasoningTokens`。
- 保留宠物主题、动画映射、通知、音效和敏感内容遮罩。

## 隐私

插件只向 `127.0.0.1:17321` 发送桌宠所需的有限事件元数据。用量记录包含会话 ID、序号、时间、provider、model、cwd 和数值 Token 字段。

插件不会发送提示词、助手回复、工具结果、凭据或模型请求体。用量保存在 Electron 的 DSH Desk 用户数据目录下：

```text
%APPDATA%\DSH Desk\dsh-usage.ndjson
```

## 安装

需要 Windows 10 / 11 x64、Node.js，以及可通过以下命令运行的 DeepSeek Harness：

```powershell
npx @deepseek-ai/dsh web
```

1. 从本仓库的 Releases 安装 DSH Desk。
2. 启动应用，在“总览”中安装 DSH 插件。
3. 重启正在运行的 DSH Web 或 Headless profile，使新插件生效。

应用会使用官方 DSH CLI，把同一插件包分别安装到 `web` 和 `headless` profiles。无需构建 DeepSeek Harness 源码。

## 从源码构建

```powershell
npm install
npm run dev:electron
npm test
npm run typecheck
npm run dist:win
```

`npm run build` 会先把 `dsh-plugin/` 打成 tarball；Windows 安装包会把它放入应用资源目录，供界面中的插件安装操作使用。

插件自身测试：

```powershell
npm test --prefix ./dsh-plugin
```

## 许可证与署名

代码基于 [MIT 许可证](LICENSE) 发布。

- **DeepSeek Harness**：DSH 事件、插件和 approval 协议来自 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)。
- **凑阿库娅（Minato Aqua）**：默认主题素材为二次创作，角色版权归 COVER Corp. 及原绘制者所有，仅限非商业使用，并遵循 [hololive 二次创作指南](https://hololivepro.com/terms/)。
- **Clawd Companion**：部分界面与事件链路演化自 [Clawd Companion](https://github.com/Doulor/Clawd-Companion)（MIT © Doulor）。
- 宠物主题兼容 [codex-pet](https://codex-pet.org) 格式。

---

<p align="center"><sub><em>DeepSeek Harness 的实时桌宠与本地用量工作台。</em></sub></p>
