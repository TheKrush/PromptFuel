# Working on PromptFuel

## Public-repository rule

PromptFuel is a public, MIT-licensed repository. Treat everything committed here — source, comments, commit messages, issues, and pull requests — as public and durable. Keep contributions scoped to PromptFuel and its documented public interfaces; do not add environment-specific paths, credentials, private operational details, or unrelated infrastructure information.

## Product and privacy contract

PromptFuel is a local-first VS Code extension that tracks AI coding assistant usage history and live quota status from the status bar and a usage dashboard, currently for Claude and Codex. This repository owns local aggregate usage/history discovery, authenticated live quota refresh, status-bar and dashboard presentation, local cache/state management, sanitized machine snapshots, and compatible cross-machine snapshot reading — nothing beyond that without an explicit product decision.

The privacy contract is architecture, not preference: no raw prompts, responses, or transcripts are collected or displayed; no telemetry is sent; no secrets, tokens, or API keys are stored; local history parsing uses aggregate metadata only; shared snapshot files are sanitized JSON. Treat this as a hard invariant: a feature that makes PromptFuel more informative must not achieve that by collecting or persisting more sensitive user content. A privacy regression is an architectural regression, not a trade-off to weigh against a nicer feature.

## Provider auth and live quota boundary

PromptFuel does not own provider sign-in and provides no authentication UI of its own. Live quota reads work by reading a provider's own existing local auth state just long enough to make one scoped quota request to that provider's endpoint; see README.md's "What PromptFuel reads and contacts" section for the exact files and endpoints — don't duplicate that detail here, it can drift out of sync with a second copy.

Provider credentials are used in memory only for the provider-authenticated operation and must never be persisted into PromptFuel state, logs, snapshots, diagnostics, or tests. Only sanitized quota and status fields — usage percentages, reset times, a status enum — survive into PromptFuel's authenticated-quota cache; that's an allowlist rebuild of the cached object, not a best-effort strip, and any new cache field needs the same treatment. Authentication failure or expiry should degrade to a safe, generic diagnostic state, never surface raw credential material, request headers, or response bodies.

Because live quota depends on existing provider auth state, adding PromptFuel-managed sign-in flows or its own credential store is an architectural and product decision, not a routine provider-parser refactor — see CONTRIBUTING.md's existing scope rule before proposing it.

## Provider payloads are untrusted and unstable

The quota endpoints PromptFuel reads are unofficial and undocumented, and README.md says plainly they can change, be rate-limited, or disappear without notice. Treat every provider response as untrusted and unstable: parse only the fields the product understands, keep parsing bounded and defensive, and let a failed or unrecognized read fall back to cached or local-history values rather than raising a hard error. When a provider changes shape, the fix is a focused parser update plus synthetic fixtures and tests — not logging or persisting the raw payload "to figure out later," and not surfacing unknown fields in the UI just because they exist.

This extends to generic usage meters: PromptFuel can display a meter a provider reports without knowing what that field measures, and README says so explicitly. Don't invent semantics for an undocumented meter, don't rename it into a stronger claim than the provider makes, and don't silently promote every newly observed field into first-class UI.

## Local history and runtime state

Local history scanning extracts aggregate usage metadata — token counts, timestamps, model names, message and turn counts — not conversation content. If a source mixes that metadata with actual prompt or response content, parse only the metadata; prompt text, response text, message contents, and full transcripts are never product data here.

Keep four things separate: repository source (code, tests, docs); extension runtime state (cache/history the installed extension keeps in its own VS Code storage); snapshot output (sanitized, exported aggregate state meant to be shared); and provider-owned state (external auth/history data PromptFuel may read but doesn't own). Runtime state isn't repository source and outlives a `git reset` — it lives in VS Code's per-installation storage — so a storage-format change needs real compatibility handling, not an assumption that a fresh checkout means fresh state. Tests should use synthetic or temporary fixtures, never a real local history directory, real extension storage, or a real shared snapshot folder.

## Snapshot sanitization and compatibility

Writing a machine snapshot is a publication boundary: local state that's fine in memory gets written into a file that may end up in a shared, synced folder outside PromptFuel's control. Acceptable in local runtime state does not mean acceptable in a snapshot. Before adding a snapshot field, ask whether it's necessary, aggregate and non-sensitive, whether it could reveal a local path, username, hostname, account identifier, session or transcript identifier, raw provider payload, or secret, whether writer and reader tests cover it, and whether its compatibility behavior is explicit. Default to leaving it out.

Shared snapshot files are untrusted input on read, like any file from outside the process boundary. The reader validates structurally against the declared schema and separately rejects field names and value shapes that look like credentials, session identifiers, local paths, or raw payloads — even for a field the schema has never heard of — and that rejection shouldn't be relaxed just to parse a newer or foreign file. Forward compatibility has bounded meaning: a genuinely harmless unrecognized field can be ignored so older and newer installs stay interoperable, but a field that merely looks unfamiliar isn't automatically safe — sensitive-field checks always win over accepting more data.

The snapshot schema is an externally visible compatibility surface, since snapshots can be read by other machines and other extension versions. A schema change means updating the writer, reader, and their fixtures/tests together, never reinterpreting an existing field's meaning silently, and never adding a destructive automatic migration without that being an explicit, reviewed decision. `promptFuel.upgradeSnapshotFiles` is a good example of why names mislead: despite its historical name, it performs compatibility validation only today and does not modify or migrate files — current source and README behavior are authoritative over what an old identifier implies. The same caution generalizes: don't infer current behavior, or a current count of anything, from a name or a number quoted in prose when the source or package manifest can simply be checked.

## Public settings and commands are compatibility surface

Every `promptFuel.*` setting and command is public API and UX surface, and `package.json`'s `contributes` block is the live, authoritative list of both — treat a settings count or list in any other document as a snapshot in time, not a current guarantee.

One semantic worth flagging because it's easy to get backwards: when `promptFuel.sources` is configured non-empty, that value is the complete configured source set, not an additive overlay on the built-in defaults — a provider left out is disabled, not silently defaulted back in. Don't change that replace-versus-merge behavior as incidental cleanup; it's a deliberate, user-visible contract.

Command IDs can be relied on by keybindings and external automation even when a displayed title changes, so an ID shouldn't be renamed, removed, or repurposed without a real compatibility reason. A settings or command behavior change should land its implementation, `package.json` entry, tests, and any relevant README update together, not as a partial code-only change.

## Logging and secrets

No telemetry should ship by accident: analytics SDKs, crash-reporting uploads, usage beacons, or hidden remote diagnostics are explicit product and security decisions, not incidental additions. A provider quota request a user opted into by enabling a source is a feature they asked for, not telemetry — keep those ideas distinct.

Never log tokens, authorization headers, raw request or response payloads, transcript content, or sensitive local paths. Provider and auth errors should be reduced to safe diagnostics — such as a status code or fixed category string — before logging, not passed through as raw data. Do not rely on logging to sanitize sensitive values; every call site must pass only already-safe diagnostics.

## Source, build, and package boundaries

`src/` is the TypeScript source of authority; `out/` is generated compiled output, is git-ignored, and should never be hand-edited as source. `npm run package` produces a local `.vsix` — packaging, not publication. README.md documents Marketplace upload as a manual step. This repository's committed GitHub Actions include workflows capable of version bumps, tags, and GitHub Releases. Review `.github/workflows/` before using release-related commit conventions or manually dispatching workflows; an ordinary code/docs task is not authorization to publish.

## Validation and its side effects

Validation commands here have different side effects worth knowing before running one casually. `npm run compile`, `npm run test:unit`, `npm run smoke`, `npm run validate:manifest`, and `npm run validate:encoding` are source- and test-level checks against synthetic fixtures and temporary directories — no real credentials, no network calls. `npm run package` and `npm run validate` go further: they rebuild `out/`, delete previously generated local `.vsix` files, and produce a new one — real mutation of generated local files, but nothing installed into your actual VS Code. `npm run validate:install` and `tools/install.ps1` do install or replace the extension in your real VS Code environment, so don't run either casually. A normal installed copy of PromptFuel will contact enabled providers live on its own refresh schedule — there's no need to trigger that just to validate an unrelated change. A script that rewrites snapshot or cache files in place is a maintenance or migration action, not a validation step, and should be treated as its own deliberate operation.

## Read when relevant

README.md is the product contract: what PromptFuel reads and contacts, the full settings and commands tables, and the privacy promises in one place. CONTRIBUTING.md covers contributor process and pull request expectations. SECURITY.md covers vulnerability reporting — use it instead of a public issue for anything sensitive. CHANGELOG.md shows how settings, schema, and behavior have actually evolved release to release.
