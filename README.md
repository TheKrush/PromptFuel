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
- **Snapshot imports and exports** - open an import folder, drop in aggregate-only snapshot JSON, or export a compatible aggregate snapshot for another install.
- **AgentBridge-compatible imports** - read compatible aggregate snapshot files directly, including safe source labels such as machine/source names.
- **Manual and auto refresh** - run **PromptFuel: Refresh Now** on demand, or use the configurable auto-refresh interval.

## Privacy & Data

- **Local history stays local.** Live quota reads are enabled by default when supported/configured and may contact provider services using existing provider auth state; set `promptFuel.liveQuotaEnabled` to `false` to turn them off.
- **No raw prompts, responses, or transcripts are collected or displayed.**
- **No secrets, tokens, or API keys are stored by PromptFuel.**
- **No telemetry** is sent by PromptFuel.
- Local history parsing uses aggregate metadata only.
- Snapshot imports are aggregate-only JSON; safe source labels may be displayed, while private labels, local paths, filenames, usernames, and raw provider payloads are not product data.
- Live quota reads use existing provider OAuth state when available; PromptFuel does not provide its own auth UI.
- You can inspect PromptFuel's extension storage via **PromptFuel: Open Data Folder**.

## Commands

| Command | Title |
| --- | --- |
| `promptFuel.openDashboard` | PromptFuel: Open Usage Dashboard |
| `promptFuel.refresh` | PromptFuel: Refresh Now |
| `promptFuel.openDataFolder` | PromptFuel: Open Data Folder |
| `promptFuel.openSnapshotImportsFolder` | PromptFuel: Open Snapshot Imports Folder |
| `promptFuel.exportUsageSnapshot` | PromptFuel: Export Usage Snapshot |

## Snapshot Imports

Run **PromptFuel: Open Snapshot Imports Folder** from the Command Palette to open the folder where PromptFuel looks for imported usage snapshots. Add PromptFuel snapshot JSON files or AgentBridge-compatible aggregate snapshot files there, then run **PromptFuel: Refresh Now** or wait for the next refresh.

By default, PromptFuel uses an import folder under its extension storage. Set `promptFuel.snapshotImportPath` to a local folder to read snapshots from that folder instead. Empty string means use the default storage folder. The command opens the effective import folder.

Snapshots are aggregate-only JSON files. They should contain provider totals for `claude` and/or `codex`; do not include prompts, responses, transcripts, raw provider payloads, secrets, auth tokens, local paths, usernames, or source filenames.

Imported snapshots appear in the dashboard source modes:

| Source mode | Dashboard data |
| --- | --- |
| Local only | Local history only |
| Snapshots only | Imported aggregate snapshots only |
| Combined | Local history plus imported aggregate snapshots |

Live quota remains separate and is not affected by the selected dashboard source mode.

PromptFuel imports supported versioned snapshot shapes automatically. It preserves existing PromptFuel schema v1 aggregate snapshots and also accepts the current AgentBridge-compatible schema 2 shape, including safe daily history buckets, model breakdowns, and source/machine labels when present. Safe labels such as `PHOENIX`, `WATCHER`, `DESKTOP-123`, `Laptop`, or `Workstation` may appear in the dashboard and tooltip; unsafe labels are replaced with a generic imported-snapshot label. Local paths, filenames, usernames, raw payloads, secrets, and tokens are never displayed.

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

## Snapshot Exports

Run **PromptFuel: Export Usage Snapshot** to write a latest-version aggregate snapshot. By default, PromptFuel writes to its default snapshot folder. Set `promptFuel.snapshotExportPath` to a local folder to write exports there instead. Empty string means use the default storage folder.

Exported snapshots are aggregate-only and use the latest compatible snapshot schema. They do not include prompts, responses, transcripts, raw provider payloads, filenames, local paths, usernames, machine names, secrets, auth tokens, or API keys.

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
| `promptFuel.snapshotImportPath` | Optional local folder for aggregate snapshot imports; empty uses PromptFuel extension storage | `""` |
| `promptFuel.snapshotExportPath` | Optional local folder for aggregate snapshot exports; empty uses PromptFuel extension storage | `""` |

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
