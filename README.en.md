<p align="center">
  <img src="docs/assets/logo.webp" alt="DSH Desk logo" width="132">
</p>

<h1 align="center">DSH Desk</h1>

<p align="center">
  <sub><a href="README.md">简体中文</a> · <b>English</b></sub>
</p>

<p align="center">
  <em>A live desktop pet and local usage workbench for DeepSeek Harness.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/DeepSeek-Harness-4c8492?style=flat-square" alt="DeepSeek Harness">
  &nbsp;
  <img src="https://img.shields.io/badge/Windows-10%2F11%20x64-4c8492?style=flat-square&logo=windows&logoColor=white" alt="Windows 10/11 x64">
  &nbsp;
  <img src="https://img.shields.io/badge/License-MIT-4c566a?style=flat-square" alt="License: MIT">
</p>

> [!NOTE]
> This is an unofficial community project and is not affiliated with DeepSeek or COVER Corp. The default pet uses Minato Aqua fan art; see [License and attribution](#license-and-attribution).

## About

DSH Desk is a Windows desktop app for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). A DSH plugin forwards session lifecycle, tool, completion, error, and approval events so the desktop pet can react in real time.

The integration targets the `npx @deepseek-ai/dsh` workflow used by end users. The DSH source checkout is only needed for protocol analysis; users do not need to build DSH from source.

## Supported today

- One-click installation of `dsh-desk-plugin` into both the DSH `web` and `headless` profiles.
- Live session start, running, tool call, tool result, completion, blocked, and error states.
- DSH approvals through desktop permission cards; when DSH Desk is absent, the request falls through to the next DSH approval handler.
- Local trajectories, tool performance, recent edits, token heatmaps, and model/project usage views.
- `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, and `reasoningTokens` capture.
- Pet themes, animation mapping, notifications, sounds, and sensitive-content masking.

## Privacy

The plugin sends bounded event metadata only to `127.0.0.1:17321`. Usage records contain a session ID, sequence number, timestamp, provider, model, cwd, and numeric token fields.

It does not send prompts, assistant output, tool results, credentials, or model request bodies. Usage is stored under Electron's DSH Desk user-data directory:

```text
%APPDATA%\DSH Desk\dsh-usage.ndjson
```

## Install

Requires Windows 10 / 11 x64, Node.js, and a DeepSeek Harness installation available through:

```powershell
npx @deepseek-ai/dsh web
```

1. Install DSH Desk from this repository's Releases page.
2. Launch the app and install the DSH plugin from Overview.
3. Restart any running DSH Web or Headless profile so it loads the new plugin.

The app uses the official DSH CLI to install the same plugin package into both profiles. Building DeepSeek Harness from source is not required.

## Build from source

```powershell
npm install
npm run dev:electron
npm test
npm run typecheck
npm run dist:win
```

`npm run build` first packs `dsh-plugin/` into a tarball. The Windows package includes that tarball as an app resource for the in-app installer.

Run the plugin tests separately with:

```powershell
npm test --prefix ./dsh-plugin
```

## License and attribution

The code is released under the [MIT License](LICENSE).

- **DeepSeek Harness**: DSH events, plugins, and approval protocols come from [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness).
- **Minato Aqua**: the default theme artwork is fan-made derivative work. The character belongs to COVER Corp. and the respective artists. Non-commercial use only, in line with the [hololive derivative works guidelines](https://hololivepro.com/terms/).
- **Clawd Companion**: parts of the UI and event pipeline evolved from [Clawd Companion](https://github.com/Doulor/Clawd-Companion) (MIT © Doulor).
- Pet themes remain compatible with the [codex-pet](https://codex-pet.org) package format.

---

<p align="center"><sub><em>A live desktop pet and local usage workbench for DeepSeek Harness.</em></sub></p>
