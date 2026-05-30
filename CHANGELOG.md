# Changelog

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
