# PromptFuel

Track AI coding assistant usage, remaining quota, reset windows, and API-equivalent estimates — all locally.

## Status

**0.1.x is an initial skeleton.** Marketplace identity and extension scaffolding are reserved. Provider usage import is not yet implemented — the commands and settings are registered but show placeholder output until that lands.

## Planned MVP Features

- **Status bar fuel display** — remaining Claude and Codex quota at a glance in the VS Code status bar
- **Usage dashboard** — full view of today's usage, history, and model distribution
- **Quota and reset window visibility** — know when your quota resets without leaving your editor
- **API-equivalent estimates** — local cost estimates for your usage (static, no data sent externally)
- **Local-first privacy** — all data stays on your machine; no prompts, responses, or tokens are ever transmitted

## Privacy & Data

- **All data is local.** No data leaves your machine in the MVP.
- **No raw prompts, responses, or transcripts are collected.**
- **No secrets, tokens, or API keys are collected.**
- **No telemetry** is sent by default.
- Usage data is read from local Claude and Codex state files on your machine.
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

## Development

```bash
npm install
npm run compile
```

Run tests:

```bash
npm test
```

Launch Extension Development Host from VS Code's Run & Debug panel (`F5`), or:

```bash
code --extensionDevelopmentPath=.
```

## License

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

This project is licensed under the [MIT License](https://opensource.org/licenses/MIT).

You are free to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the software, subject to the conditions outlined in the license.

For the complete license text, see the [LICENSE](LICENSE) file in this repository.
