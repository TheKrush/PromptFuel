# Changelog

## 0.4.0

Live quota visibility is now PromptFuel's primary product path. The extension attempts live quota reads automatically, shows safe loading/unavailable/stale states, and keeps local history clearly secondary.

**Included in this release:**

- `promptFuel.liveQuotaEnabled` setting added and now defaults to `true` in the manifest and runtime defaults.
- Live quota status types, freshness labels, quota window helpers, and provider reader plumbing added.
- Authenticated quota adapter added for attempting provider quota reads from existing provider auth state.
- Refresh flow now runs live quota readers when enabled and preserves explicit opt-out.
- Status bar now prioritizes live quota percentages when available.
- Status bar now shows safe live quota loading, unavailable, and disabled states instead of silently falling back to local history as the primary experience.
- Tooltip copy now separates live quota from local history and avoids local-history-only wording by default.
- Tooltip copy now reports snapshot import state instead of using stale fixed snapshot wording.
- Dashboard now includes live quota visibility, including loading, unavailable, cached/stale, visible percentage, and disabled states.
- Dashboard now includes Overview, Claude, and Codex tabs.
- Dashboard local-history windows now include Today, Last 5h, Last 7d, and All local history.
- Dashboard source modes now include Local only, Snapshots only, and Combined, with live quota kept independent from the selected usage-history source.
- Imported snapshot support added for aggregate-only PromptFuel JSON snapshots.
- `PromptFuel: Open Snapshot Imports Folder` command added for discoverable snapshot import placement.
- Live quota UX copy polished for unavailable/auth-missing cases and sanitized errors.
- Manifest and package validation updated, including a check that `promptFuel.liveQuotaEnabled` defaults to `true`.
- `.vscodeignore` updated for package contents.
- README and contributor docs updated for live quota behavior, snapshot imports, source modes, privacy boundaries, and current validation workflows.
- Smoke coverage expanded for live quota status formatting, explicit opt-out, unavailable/error/stale states, available percentages, display modes, dashboard tabs, local-history windows, source modes, snapshot imports, CSP nonce checks, provider window parsing, and local history not masking live quota states.

**Scope notes:**

- PromptFuel still does not provide its own provider auth UI.
- Live quota can remain unavailable when provider quota data, existing provider auth, or provider endpoints are not available.
- Local history and imported snapshots remain aggregate-only and do not expose prompts, responses, transcripts, raw JSONL, file paths, usernames, machine names, secrets, or tokens.
- Dashboard charts, notifications, additional providers, and Marketplace publish automation remain post-MVP.

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
