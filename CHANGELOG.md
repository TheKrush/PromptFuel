# Changelog

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
