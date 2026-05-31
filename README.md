# PromptFuel

Track AI coding assistant usage history and live quota status from the VS Code status bar.

## Features

- **Live quota first** - the status bar and dashboard prioritize live 5h/7d quota when provider APIs are available.
- **Codex and Claude live quota support** - PromptFuel attempts live quota reads for configured providers from existing provider auth state.
- **Safe stale states** - when a live quota refresh fails after a prior success, PromptFuel can show cached/stale quota instead of raw errors.
- **Local history secondary** - local Claude and Codex aggregate history remains visible in the dashboard and tooltip, but does not replace live quota as the primary status.
- **Dashboard tabs** - the dashboard includes Overview, Claude, and Codex tabs.
- **Local-history windows** - switch usage history between Today, Last 5h, Last 7d, and All local history.
- **Source modes** - switch dashboard usage history between Local only, Snapshots only, and Combined when imported snapshots are available.
- **Snapshot imports** - open an import folder and drop in aggregate-only snapshot JSON for dashboard history.
- **Manual and auto refresh** - run **PromptFuel: Refresh Now** on demand, or use the configurable auto-refresh interval.

## Privacy & Data

- **Local history stays local.** Live quota reads are enabled by default when supported/configured and may contact provider services using existing provider auth state; set `promptFuel.liveQuotaEnabled` to `false` to turn them off.
- **No raw prompts, responses, or transcripts are collected or displayed.**
- **No secrets, tokens, or API keys are stored by PromptFuel.**
- **No telemetry** is sent by PromptFuel.
- Local history parsing uses aggregate metadata only.
- Snapshot imports are aggregate-only JSON; private labels, local paths, filenames, usernames, machine names, and raw provider payloads are not product data.
- Live quota reads use existing provider OAuth state when available; PromptFuel does not provide its own auth UI.
- You can inspect PromptFuel's extension storage via **PromptFuel: Open Data Folder**.

## Commands

| Command | Title |
| --- | --- |
| `promptFuel.openDashboard` | PromptFuel: Open Usage Dashboard |
| `promptFuel.refresh` | PromptFuel: Refresh Now |
| `promptFuel.openDataFolder` | PromptFuel: Open Data Folder |
| `promptFuel.openSnapshotImportsFolder` | PromptFuel: Open Snapshot Imports Folder |

## Snapshot Imports

Run **PromptFuel: Open Snapshot Imports Folder** from the Command Palette to open the folder where PromptFuel looks for imported usage snapshots. Add PromptFuel snapshot JSON files there, then run **PromptFuel: Refresh Now** or wait for the next refresh.

Snapshots are aggregate-only JSON files. They should contain provider totals for `claude` and/or `codex`; do not include prompts, responses, transcripts, raw provider payloads, secrets, auth tokens, local paths, usernames, machine names, or source filenames.

Imported snapshots appear in the dashboard source modes:

| Source mode | Dashboard data |
| --- | --- |
| Local only | Local history only |
| Snapshots only | Imported aggregate snapshots only |
| Combined | Local history plus imported aggregate snapshots |

Live quota remains separate and is not affected by the selected dashboard source mode.

Minimal generic snapshot example:

```json
{
  "schemaVersion": 1,
  "generatedAtEpochMs": 1767225600000,
  "providers": [
    {
      "providerId": "claude",
      "generatedAtEpochMs": 1767225600000,
      "aggregate": {
        "totalInputTokens": 1000,
        "totalOutputTokens": 500,
        "totalCacheCreationInputTokens": 0,
        "totalCacheReadInputTokens": 0,
        "totalTokens": 1500,
        "totalAssistantMessages": 3
      }
    },
    {
      "providerId": "codex",
      "generatedAtEpochMs": 1767225600000,
      "aggregate": {
        "totalInputTokens": 800,
        "totalOutputTokens": 400,
        "totalCacheCreationInputTokens": 0,
        "totalCacheReadInputTokens": 0,
        "totalTokens": 1200,
        "totalAssistantMessages": 2
      }
    }
  ]
}
```

Malformed snapshot files, unsupported schema versions, unknown providers, and private source labels are ignored. Snapshot recent-window totals are used only when the snapshot provides them; otherwise those recent windows contribute 0 while All local history uses the snapshot aggregate total.

## Current Limitations

- Live quota can be unavailable when provider quota data, provider auth state, or provider endpoints are unavailable.
- PromptFuel does not include its own provider sign-in flow.
- Dashboard charts, notifications, additional providers, and Marketplace publish automation are not part of the MVP.
- Snapshot imports are read from JSON files placed in the imports folder; there is no in-dashboard upload flow yet.
- Local history and snapshots are aggregate-only and may not include every provider-side detail.

## Settings

| Setting | Description | Default |
| --- | --- | --- |
| `promptFuel.enabledProviders` | Providers to track | `["claude", "codex"]` |
| `promptFuel.refreshIntervalMinutes` | Auto-refresh interval (0 to disable) | `5` |
| `promptFuel.liveQuotaEnabled` | Attempt live quota from provider APIs; set to `false` to opt out | `true` |

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
