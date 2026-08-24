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

DSH Desk 连接 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Web / Headless profiles，提供桌宠、状态通知、权限请求和用量记录。插件、Skill、主题、方案和市场入口集中在同一个桌面应用里。

## 核心亮点

**5000+ 桌宠生态**

兼容 [codex-pet](https://codex-pet.org) 宠物包格式。初始自带 Aqua、月薪喵和 DeepSeek 鲸鱼娘，可继续接入 codex-pet 生态中的 5000+ 桌宠。

**DSH 工作流联动**

`dsh-desk-plugin` 将 DSH 的任务、工具调用、完成状态、错误和权限事件接入 DSH Desk。任务状态变化会反映在桌宠动作、声音和桌面通知上，权限请求也可以直接在桌面端确认。

**方案化扩展管理**

统一管理 DSH 插件、Skill 和组件状态。插件和组件支持默认、启用、停用三种状态，并可在方案中组合；安装、启用、停用和移除都在同一个界面完成。

**插件与主题市场**

插件市场提供海量 DSH 插件和 Skill 的浏览与安装；主题市场提供 DSH Web 主题的预览、安装、更新，并兼容常见旧版主题注册方式。

## 开箱即用

初始自带三只可直接切换的桌宠：

- **Minato Aqua**
- **月薪喵**
- **DeepSeek 鲸鱼娘**

更多桌宠可以通过 codex-pet 宠物包或应用内的安装命令继续加入。

## 安装与快速开始

需要 Windows 10 / 11 x64、Node.js，以及可以运行的 DeepSeek Harness：

```powershell
npx @deepseek-ai/dsh web
```

下载 [Windows 安装包](https://github.com/Renakoni/dsh-desk/releases/download/v0.1.0/DSHDesk-Setup-0.1.0.exe) 并安装，或下载 [免安装 ZIP](https://github.com/Renakoni/dsh-desk/releases/download/v0.1.0/DSHDesk-0.1.0-portable.zip) 后解压。

启动 DSH Desk，在“总览”中安装 DSH 插件，然后重启正在运行的 DSH Web 或 Headless profile。

## 从源码运行

```powershell
npm install
npm run build
npm run start
```

插件自身测试：

```powershell
npm test --prefix ./dsh-plugin
```

## 许可证与署名

代码基于 [MIT 许可证](LICENSE) 发布。

- **DeepSeek Harness**：DSH 事件、插件和 approval 协议来自 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)。
- **Clawd Companion**：部分界面与事件链路演化自 [Clawd Companion](https://github.com/Doulor/Clawd-Companion)（MIT © Doulor）。
- **Codex Pets**：相关桌宠与自定义宠物说明见 [OpenAI 官方 Pets 文档](https://learn.chatgpt.com/docs/pets)。

---

<p align="center"><sub><em>桌宠是入口，DSH 的实时反馈与扩展管理才是完整的工作台。</em></sub></p>
