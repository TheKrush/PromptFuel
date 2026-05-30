# PromptFuel

Track AI coding assistant usage, remaining quota, reset windows, and API-equivalent estimates — all locally.

## MVP Scope

- Status bar display of Claude and Codex usage
- Usage dashboard webview (today cards, history chart, model distribution)
- Manual refresh command
- Open data folder for local inspection
- API-equivalent cost estimates (static, local-only)
- Compact and countdown display modes

## Privacy & Data

- **All data is local.** No data leaves your machine in the MVP.
- **No raw prompts, responses, or transcripts are collected.**
- **No secrets, tokens, or API keys are collected.**
- **No telemetry** is sent by default.
- Usage data is read from local Claude and Codex state files on your machine.
- You can inspect all stored data via the "PromptFuel: Open Data Folder" command.

## Commands

| Command | Title |
|---|---|
| `promptFuel.openDashboard` | PromptFuel: Open Usage Dashboard |
| `promptFuel.refresh` | PromptFuel: Refresh Now |
| `promptFuel.openDataFolder` | PromptFuel: Open Data Folder |

## Settings

| Setting | Description | Default |
|---|---|---|
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

MIT
