# Changelog

## 0.3.0

Dashboard with local usage history overview and per-provider cards. Status bar shows aggregate token counts with tooltip. Auto-refresh scheduler polls at configurable interval.

**Included in this release:**

- `src/panel/dashboardPanel.ts` — webview panel host for the dashboard
- `src/panel/dashboardModel.ts` — dashboard state model (local history snapshots, provider cards)
- `src/panel/dashboardHtml.ts` — dashboard HTML with CSP nonce, style CSP, message listener
- Dashboard refresh button wired to re-query local data
- `src/providers/claudeLocal.ts` — safe local Claude session parsing (aggregate usage metadata only)
- `src/providers/codexLocal.ts` — safe local Codex session parsing (aggregate usage metadata only)
- `src/providers/claudeUsageParser.ts` — Claude usage log parser
- `src/providers/codexUsageParser.ts` — Codex usage log parser
- `src/providers/readProviders.ts` — provider reader registry
- `src/core/providerReader.ts` — abstract provider reader interface
- `src/core/usageAggregate.ts` — aggregate usage types and merge logic
- `src/core/statusModel.ts` — status bar model with aggregate reader data
- `src/core/statusTooltip.ts` — status bar tooltip generation
- `src/core/refreshScheduler.ts` — auto-refresh scheduler with config reactiveness and dispose lifecycle
- `src/core/formatQuota.ts` — updated for aggregate states
- `src/core/quotaTypes.ts` — extended for aggregate usage
- `src/extension.ts` — dashboard command, status bar wiring, refresh command, auto-refresh lifecycle
- `src/config.ts` — config loader extended for refresh interval
- `src/core/configDefaults.ts` — defaults for `refreshIntervalSeconds`
- `package.json` — `promptFuel.refreshIntervalSeconds` setting
- `scripts/smoke-providers.cjs` — smoke tests for provider reader and usage parsing
- `scripts/smoke-core.cjs` — extended smoke tests for dashboard and scheduler
- `.vscodeignore` — updated for webview assets
- `assets/icon.png` — updated extension icon

**Scope notes:**

- Dashboard shows local history only. Cloud snapshots, authenticated provider data, and quota remaining are not yet included.
- Aggregate counts only. No prompts, responses, transcripts, raw JSONL, file paths, usernames, or machine names are displayed or stored.

## 0.2.0

Core model/config foundation. Provider usage import is not yet implemented.

**Included in this release:**

- `src/core/providers.ts` — provider IDs (`claude`, `codex`), labels, `isKnownProvider` guard
- `src/core/quotaTypes.ts` — quota window IDs (`5h`, `7d`), labels, `ProviderQuotaState` type
- `src/core/configDefaults.ts` — pure config defaults (no VS Code dependency; smokeable)
- `src/core/formatQuota.ts` — status bar text for `no-data`, `disabled`, `unknown` states
- `src/config.ts` — VS Code config loader under `promptFuel.*`
- `src/dataFolder.ts` — data folder path helper wrapping `context.globalStorageUri`
- `src/extension.ts` — status bar item wired with placeholder no-data status; refresh command updates bar; open data folder uses real extension storage URI
- `scripts/smoke-core.cjs` — pure-logic smoke tests (no VS Code dependency) covering provider validation, quota window labels, status text formatting, and config defaults
- `package.json` — added `promptFuel.refreshIntervalSeconds` setting; added `smoke:core` script

## 0.1.0

Initial skeleton. Marketplace identity reserved; extension is unpublished pending provider import implementation.

**Included in this release:**

- Extension scaffolding and TypeScript compilation pipeline
- Three registered commands (registered, placeholder output): `promptFuel.openDashboard`, `promptFuel.refresh`, `promptFuel.openDataFolder`
- Two settings: `promptFuel.enabledProviders`, `promptFuel.displayMode`
- Marketplace metadata: icon, categories, gallery banner, keywords, repository/bugs/homepage links
- Manifest validation script (`npm run validate:manifest`)
- CI workflow: compile, lint, validate manifest, package VSIX
- `SUPPORT.md` and `SECURITY.md` included in VSIX

Provider usage import (Claude, Codex) is not yet implemented.
