# PromptFuel

Track AI coding assistant usage, remaining quota, reset windows, and API-equivalent estimates — all locally.

## Features

- **Status bar fuel display** — remaining Claude and Codex usage at a glance with aggregate token counts
- **Usage dashboard** — webview panel with local usage history overview and per-provider cards
- **Auto-refresh** — configurable interval to re-read local history
- **Opt-in live quota** — fetch authenticated usage quotas from Claude API and Codex backend (`promptFuel.liveQuotaEnabled`, defaults `false`)

## Privacy & Data

- **All data is local.** No data leaves your machine unless you opt in to live quota.
- **No raw prompts, responses, or transcripts are collected.**
- **No secrets, tokens, or API keys are stored or transmitted by PromptFuel.**
- **No telemetry** is sent by default.
- Usage data is read from local Claude and Codex history files on your machine.
- Live quota reads existing provider OAuth state; PromptFuel does not provide its own auth UI.
- You can inspect all stored data via the "PromptFuel: Open Data Folder" command.

## Commands

| Command | Title |
| --- | --- |
| `promptFuel.openDashboard` | PromptFuel: Open Usage Dashboard |
| `promptFuel.refresh` | PromptFuel: Refresh Now |
| `promptFuel.openDataFolder` | PromptFuel: Open Data Folder |

## Settings

| Setting | Description | Default |
| --- | --- | --- |
| `promptFuel.enabledProviders` | Providers to track | `["claude", "codex"]` |
| `promptFuel.displayMode` | Status bar display mode | `"compact"` |
| `promptFuel.refreshIntervalMinutes` | Auto-refresh interval (0 to disable) | `5` |
| `promptFuel.liveQuotaEnabled` | Fetch live quota from provider APIs (opt-in; requires existing provider auth) | `false` |

## Development

```bash
npm install
npm run compile
```

Run smoke tests:

```bash
npm run smoke:core
npm run smoke:providers
```

Validate manifest:

```bash
npm run validate:manifest
```

Package VSIX:

```bash
npm run package
```

Launch Extension Development Host from VS Code's Run & Debug panel (`F5`), or:

```bash
code --extensionDevelopmentPath=.
```

## Marketplace

Marketplace publish is manual. Run `npm run package` and upload the generated `.vsix` to the VS Code Marketplace publisher dashboard.

## License

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

This project is licensed under the [MIT License](https://opensource.org/licenses/MIT).

For the complete license text, see the [LICENSE](LICENSE) file in this repository.
