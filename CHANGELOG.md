# Changelog

## 1.0.4

Adds Claude Fable 5 to PromptFuel's API-equivalent pricing estimates.

**Included in this release:**

- Added first-party Anthropic `claude-fable-5` pricing at $10 input / $50 output per MTok, with $12.50 5-minute cache write, $20 1-hour cache write, and $1 cache hit / refresh per MTok.
- Added `anthropic/claude-fable-5` as an OpenRouter-style pricing alias that maps to the same Claude Fable 5 rates.

## 1.0.3

Getting package.json / package-lock.json correctly aligned.

## 1.0.2

Fixes Codex 5h quota showing 0% remaining after the first message in a fresh window.

**Included in this release:**

- Fixed a misidentification of Codex's `used_percent` field as a 0–1 fraction. The Codex API returns `used_percent` as a 0–100 value, but the parser was applying a fraction-conversion heuristic (`× 100`) to any value ≤ 1. Sending a single message into a fresh 5h window produces a `used_percent` near `1` (≈1% used), which the heuristic inflated to 100% used → 0% remaining. The fix clamps `used_percent` and `usedPercentage` directly to [0, 100] without scaling; the `utilization` field (a genuine 0–1 fraction) continues to be scaled. Applied to both the live authenticated-quota path and the local Codex session-log scanner.

## 1.0.1

Fixes a false-critical quota display when the server's reset time has already passed and a live refresh fails.

**Included in this release:**

- Fixed expired cached quota windows showing as critical / 0% remaining after a live refresh failure. When the provider's reset boundary is in the past, the stale usage value is no longer meaningful — the window is now treated as fully reset (0% used, 100% remaining) until a fresh value arrives from the server. The cached source label and incident indicator (e.g. network error) are preserved so the fallback state is still visible.
- Local heuristic sources (local session, status line, hook) with expired windows continue to be marked unavailable rather than reset, since they carry no authoritative reset boundary from the provider.

## 1.0.0

PromptFuel is ready for its public 1.0.0 release with a unified source configuration model, cleaner snapshot import behavior, CSV-backed model pricing estimates, and a more polished dashboard/status-bar surface.

**Included in this release:**

- Added `promptFuel.sources` as the canonical configuration for local providers and imported snapshot sources, including `label`, `shortLabel`, `enabled`, and `statusBar` controls.
- Added top-level `promptFuel.refreshIntervalMinutes` for periodic local scanning and authenticated quota refresh.
- Restored `promptFuel.statusBarDensity` for choosing `standard` or `compact` status bar display.
- Removed older scattered provider, authenticated-quota, snapshot-source, status-bar-source, and public threshold settings from the public configuration surface.
- Kept snapshot writer/reader settings separate as `promptFuel.snapshot.enabled`, `promptFuel.snapshot.machineLabel`, and `promptFuel.snapshot.path`.
- Updated source semantics so omitted local providers do not appear as unavailable in the dashboard or status bar.
- Improved imported snapshot source labels, including compact status-bar short labels and full labels in dashboard/tooltip views.
- Removed the unsupported `blocked` status-bar label while preserving raw 7d/5h remaining values.
- Simplified the status-bar tooltip and set the dashboard webview tab icon to the PromptFuel icon.
- Moved model pricing estimates to `data/model-pricing-estimates.csv`, loaded at extension startup and cached in memory.
- Updated the model distribution table with Provider, Model, Tokens, Share, Est. API Cost, and Rate / 1M columns, including right-aligned numeric fields and tighter model/provider spacing.
- Reduced hardcoded model pricing to fallback estimate behavior and documented the `codex-auto-review` alias mapping.
- Updated validation so `.\tools\dev-validate-install.ps1` runs unit tests as part of the dev package/install pass.
- Decoupled smoke coverage from brittle UI text where practical while preserving behavior checks for source filtering, snapshots, dashboard rendering, status text, and pricing.

**Breaking/config changes from 0.9.1:**

- Use `promptFuel.sources` instead of the removed provider/snapshot/status-bar source settings.
- Use top-level `promptFuel.refreshIntervalMinutes` instead of removed authenticated-quota refresh interval settings.
- Use `promptFuel.statusBarDensity` to choose standard or compact status bar display.
- Public quota threshold settings were removed; PromptFuel uses its built-in 6-level remaining-quota scale.
- API-equivalent cost estimates are approximate and based on PromptFuel's configured model-rate table. They are not actual billing records.

## 0.9.0

PromptFuel simplifies its dashboard rendering model by removing the Merged/Separate layout toggle, unifying the aggregate card path, and adding consistent contributor breakdowns across all tabs.

**Included in this release:**

- Removed the Merged / Separate dashboard layout toggle.
- Kept the existing Overview, Claude, and Codex tabs while simplifying the dashboard rendering model.
- Combined Overview Today cards into one aggregate provider-level card set.
- Unified the dashboard aggregate rendering path below At-a-glance.
- Added consistent contributor breakdowns:
  - Overview breaks down by provider: Claude / Codex.
  - Claude and Codex tabs break down by source: Local / remote alias.
- Aligned API-equivalent footer breakdowns with the metric cards.
- Preserved honest API-equivalent unavailable behavior: no fake partial dollar breakdowns.
- Improved At-a-glance quota rows with stable aligned columns.
- Aligned dashboard quota bar colors with the same threshold scale used by status bar indicators.
- Removed dead dashboard model-distribution render/test path.
- Retargeted dashboard smoke coverage to the live render path.

## 0.8.0

PromptFuel hardens its snapshot schema, surfaces remote Today activity counts, sharpens the quota display scale, and refactors the extension internals into focused modules.

**Included in this release:**

- Snapshot schema simplified to V1 as the sole supported baseline; the private V2–V4 upgrade chain is removed. Existing snapshot files can be migrated to V1 with the new `npm run maintenance:normalize-snapshot-schema` script (creates `.bak` backups; supports dry-run).
- Remote Today dashboard cards now show assistant-message and turn activity counts when the snapshot provides them, replacing the "Activity count not available from snapshot data" placeholder.
- Merged/Overview Today section suppresses empty provider groups when another provider has real local or remote data.
- Separate-view remote Today cards now populate correctly when a provider has no local today data but a remote snapshot does.
- Quota threshold display expanded to a 6-level scale: purple (91–100%), blue (71–90%), green (51–70%), yellow (31–50%), orange (11–30%), red (0–10%).
- Dashboard placeholder copy updated to neutral loading wording.
- `extension.ts` refactored into focused modules: `statusBar.ts` (status bar helpers), `watchers.ts` (file watchers and debounce timers), and `refreshController.ts` (refresh orchestration and history-scan cache). Runtime behavior is unchanged.
- Dashboard webview styles and scripts moved to media assets; inline injection removed.
- Token count formatting unified across status bar and dashboard (locale-independent output).
- Model usage contribution mapping centralized across Claude and Codex paths.
- CI workflow now gates on unit tests and dashboard smoke before packaging.
- Dead code, unreferenced imports, and unused variables removed.

**Scope notes:**

- PromptFuel continues to display aggregate usage only.
- PromptFuel does not display prompts, responses, transcripts, raw JSONL, local paths, usernames, secrets, tokens, or raw provider payloads.
- Snapshot imports and exports remain aggregate-only, with safe source labels permitted only after sanitization.
- Live quota remains independent from the selected dashboard usage source.
- Live authenticated quota refresh stays opt-in and makes no live calls when disabled.

## 0.7.0

PromptFuel rebuilds its usage engine and dashboard around a faster aggregation pipeline, combined per-metric cards, model-stacked history, configurable alert thresholds, and a reorganized cross-machine snapshot schema.

**Included in this release:**

- Usage aggregation rebuilt around day-bucket scanning for Claude and Codex, with per-model totals, provider pricing, and API-equivalent cost estimates.
- Dashboard at-a-glance redesigned as one compact row per source on a shared grid, showing 7d and 5h bars, reset time, and a current/snapshot/stale badge across local and remote lanes.
- Today and Overview merged into combined metric cards (Tokens, Input/Output, Cache, API-equivalent) that sum Claude and Codex with a per-provider breakdown line.
- History charts now use model-stacked bars across 1D, 1W, 1M, 1Y, and ALL ranges, with inline model-distribution sections per provider.
- `promptFuel.statusBarDensity` setting added (`standard`/`compact`) to control status bar countdown detail; countdown display simplified to a single highest unit (days, hours, or minutes).
- `promptFuel.lowRemainingPercent`, `promptFuel.warnRemainingPercent`, and `promptFuel.criticalRemainingPercent` settings added for configurable low, warning, and critical remaining-quota icons.
- `promptFuel.authenticatedQuota.refreshIntervalSeconds` renamed to `promptFuel.authenticatedQuota.refreshIntervalMinutes` (default 5, minimum 1).
- Snapshot settings reorganized under the `promptFuel.snapshot.*` namespace: a single `promptFuel.snapshot.path` replaces the separate import and export path settings, alongside `promptFuel.snapshot.enabled` and `promptFuel.snapshot.machineLabel` for the local snapshot writer.
- Remote snapshot lanes are now configured through `promptFuel.snapshot.remoteSources`, `promptFuel.snapshot.statusBarSources`, and `promptFuel.snapshot.remoteMachineLabels` for dashboard cards, status bar entries, and display aliases.
- Snapshot files upgraded to schema V4 (flattened machine label and writer version, source labels, always-written daily history buckets), with older schema 2 and 3 files upgraded automatically on read.
- `PromptFuel: Upgrade Snapshot Files to Current Schema` command added for migrating older snapshot files in place.
- Dashboard webview content security policy tightened: inline script execution replaced with a per-request nonce.
- Display defaults hardcoded (countdown display, combined status bar layout); the `promptFuel.configureClaudeHooks` command and unused separate-layout settings removed.
- Local install tooling hardened: `install.ps1` gains isolated-profile options and explicit exit-code checks, and `dev-validate-install.ps1` verifies the packaged entrypoint and runs the aggregate smoke suite.
- Smoke and unit coverage reorganized into focused suites for chart binning, tooltips, dashboards, model breakdowns, remote history merge, pricing, and snapshot read/write.

**Scope notes:**

- PromptFuel continues to display aggregate usage only.
- PromptFuel does not display prompts, responses, transcripts, raw JSONL, local paths, usernames, secrets, tokens, or raw provider payloads.
- Snapshot imports and exports remain aggregate-only, with safe source labels permitted only after sanitization.
- Live quota remains independent from the selected dashboard usage source.
- Live authenticated quota refresh stays opt-in and makes no live calls when disabled.

## 0.6.0

PromptFuel now adds configurable cross-machine snapshot imports/exports, model-level usage breakdowns, imported quota visibility, and a more range-driven dashboard experience.

**Included in this release:**

- `PromptFuel: Export Usage Snapshot` command added for writing aggregate-only snapshot files from local usage history.
- `promptFuel.snapshotImportPath` setting added for choosing a custom aggregate snapshot import folder.
- `promptFuel.snapshotExportPath` setting added for choosing a custom aggregate snapshot export folder.
- `promptFuel.localMachineLabel` setting added for stable exported machine labels and local-import deduplication.
- `promptFuel.snapshotImportLabels` setting added for allowlisting imported machine/source labels.
- Snapshot import support expanded for compatible schema 2 snapshots, including archive files, daily history buckets, model breakdowns, safe machine/source labels, and imported quota windows.
- Snapshot import deduplication now skips snapshots from the local machine label and respects the configured import allowlist.
- Snapshot source labels are sanitized, preserved, combined, and surfaced in dashboard and tooltip views when safe.
- Imported snapshot quota windows can now appear in the status bar, tooltip, and dashboard alongside live quota state.
- Dashboard usage source defaults to Combined, with Local only and Snapshots only modes still available.
- Dashboard history now uses range controls for 1W, 1M, 1Y, and ALL views, driving history bars, summary totals, usage distribution, and model distribution together.
- Dashboard charts now use model-stacked history bars, improved empty-bin handling, larger donut visuals, cleaner center labels, and clearer provider labels.
- Provider usage tabs now appear only when the selected source has data for that provider.
- Model usage aggregation added for Claude, Codex, imported snapshots, local-history windows, dashboard rows, and tooltip summaries.
- Claude local history parsing now tracks per-model aggregates and daily history buckets while ignoring incomplete malformed tail lines safely.
- Codex local history parsing now uses completed-turn deltas, turn/model context, timestamps, per-model aggregates, and daily history buckets.
- JSONL parsing now trims boundary NUL characters and shares line-break tail handling helpers.
- Live quota status bar and tooltip formatting polished with quota indicators, reset countdown alignment, snapshot quota rows, model summaries, and clearer parse-error wording.
- Snapshot validation hardened against forbidden content, unexpected fields, unsafe labels, unsupported schemas, unknown providers, and excessive imported file counts.
- Manifest validation expanded for the new command, settings, configured snapshot paths, package exclusions, and copy that avoids unimplemented API-estimate claims.
- README and contribution notes updated for combined dashboard usage, snapshot imports/exports, cross-machine labels, live quota defaults, and current privacy boundaries.

**Scope notes:**

- PromptFuel continues to display aggregate usage only.
- PromptFuel does not display prompts, responses, transcripts, raw JSONL, local paths, usernames, secrets, tokens, raw provider responses, or raw provider payloads.
- Snapshot imports and exports remain aggregate-only, with safe source labels permitted only after sanitization.
- Live quota remains independent from the selected dashboard usage source.
- `promptFuel.snapshotImportLabels` can restrict imported snapshots by machine/source label, and local-machine snapshots are skipped to avoid double-counting.
- Live quota can still be disabled with `promptFuel.liveQuotaEnabled: false`.

## 0.5.0

PromptFuel now centers live quota remaining values, reset countdowns, provider-isolated fallback states, and aggregate-only imported history as the release-ready experience.

**Included in this release:**

- Live quota visibility added for Claude and Codex in the status bar, tooltip, and dashboard.
- Live quota displays now emphasize remaining quota instead of used quota.
- Reset countdown labels added alongside live quota remaining values when provider reset times are available.
- Last-known-good quota caching added so prior quota data can remain visible as cached or stale when a provider is temporarily unavailable.
- Provider isolation added so one unavailable provider does not hide quota data from providers that are still working.
- Dashboard provider tabs added for Overview, Claude, and Codex.
- Dashboard local-history windows added for Today, Last 5h, Last 7d, and All local history.
- Dashboard source modes added for Local only, Snapshots only, and Combined usage views, with live quota kept independent from the selected history source.
- Aggregate-only snapshot imports added for external Claude and Codex usage totals.
- `PromptFuel: Open Snapshot Imports Folder` command added for discoverable snapshot import placement.
- Snapshot validation added for known providers and sanitized source labels.
- Tooltip and dashboard copy updated to distinguish live quota, cached/stale quota, unavailable quota, local history, and imported snapshots.
- Local history is now presented as secondary to live quota in status, tooltip, and dashboard copy.
- `promptFuel.displayMode` setting removed; PromptFuel now shows reset countdowns when reset timing is available.
- Manifest validation updated to reject `promptFuel.displayMode` if it is accidentally reintroduced.
- Package exclusions tightened so generated VSIX artifacts and local test output are not included in release packages.
- README and package description text updated for default-on live quota behavior and provider-auth expectations.

**Scope notes:**

- PromptFuel continues to display aggregate usage only.
- PromptFuel does not display prompts, responses, transcripts, raw JSONL, local paths, usernames, machine names, secrets, tokens, or raw provider responses.
- Imported snapshots remain aggregate-only and sanitized before being used in the dashboard.
- Live quota can be disabled with `promptFuel.liveQuotaEnabled: false`.

## 0.4.0

Live quota visibility is now PromptFuel's primary product path. The extension attempts live quota reads automatically, shows safe loading/unavailable/stale states, and keeps local history clearly secondary.

**Included in this release:**

- `promptFuel.liveQuotaEnabled` setting added and now defaults to `true` in the manifest and runtime defaults.
- Live quota status types, freshness labels, quota window helpers, and provider reader plumbing added.
- Authenticated quota adapter added for attempting provider quota reads from existing provider auth state.
- Refresh flow now runs live quota readers when enabled and preserves explicit opt-out.
- Status bar now prioritizes live quota remaining percentages and reset countdown labels when available.
- Status bar now shows safe live quota loading, unavailable, and disabled states instead of silently falling back to local history as the primary experience.
- Tooltip copy now separates live quota from local history, shows remaining quota only, and avoids local-history-only wording by default.
- Tooltip copy now reports snapshot import state instead of using stale fixed snapshot wording.
- Dashboard now includes live quota visibility, including loading, unavailable, cached/stale, remaining percentage, reset countdown, and disabled states.
- Dashboard now includes Overview, Claude, and Codex tabs.
- Dashboard local-history windows now include Today, Last 5h, Last 7d, and All local history.
- Dashboard source modes now include Local only, Snapshots only, and Combined, with live quota kept independent from the selected usage-history source.
- Imported snapshot support added for aggregate-only PromptFuel JSON snapshots.
- `PromptFuel: Open Snapshot Imports Folder` command added for discoverable snapshot import placement.
- Live quota UX copy polished for unavailable/auth-missing cases and sanitized errors.
- Manifest and package validation updated, including a check that `promptFuel.liveQuotaEnabled` defaults to `true`.
- `.vscodeignore` updated for package contents.
- README and contributor docs updated for live quota behavior, snapshot imports, source modes, privacy boundaries, and current validation workflows.
- Smoke coverage expanded for live quota status formatting, explicit opt-out, unavailable/error/stale states, remaining percentages, reset countdown labels, dashboard tabs, local-history windows, source modes, snapshot imports, CSP nonce checks, provider window parsing, and local history not masking live quota states.

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
- Initial `promptFuel.enabledProviders` setting
- Marketplace metadata: icon, categories, gallery banner, keywords, repository/bugs/homepage links
- Manifest validation script (`npm run validate:manifest`)
- CI workflow: compile, lint, validate manifest, package VSIX
- `SUPPORT.md` and `SECURITY.md` included in VSIX

Provider usage import (Claude, Codex) is not yet implemented.
