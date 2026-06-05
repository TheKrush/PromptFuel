# Contributing to PromptFuel

Thank you for taking an interest in **PromptFuel** — a VS Code extension for tracking AI coding assistant usage, remaining quota, and reset windows.

---

## Where to Start

- **Feature request or idea?** Open an issue describing the problem you're solving and how you imagine it working.
- **Bug fix or improvement?** Check existing issues first. If nothing matches, open a new issue with steps to reproduce and expected vs actual behavior.
- **Docs or README updates?** Open a PR directly. If changing behavior or APIs, please link or create an issue first.

---

## Local Setup

```bash
npm ci
npm run compile
```

Run smoke tests and validate:

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File ./tools/dev-validate-install.ps1 -SkipInstall
```

Launch Extension Development Host from VS Code's Run & Debug panel (`F5`), or:

```bash
code --extensionDevelopmentPath=.
```

---

## How to Contribute

1. **Fork or branch from `master`** — external contributors should fork; collaborators may create a feature branch.
2. **Create or link an issue** — reference an existing issue or open a new one outlining what you plan to do.
3. **Make focused, readable commits** — group related changes, use clear messages, and describe *why* a change was made.
4. **Add tests where appropriate** — update or add tests if the project has them; include validation steps for scripts or workflows. Unit tests and smoke tests use the compiled `out/` directory and may run without VS Code.
5. **Open a Pull Request** — describe the change, link the relevant issue, and call out anything that might affect CI, workflows, or other repos.
6. **Respond to review** — keep the conversation constructive; tidy follow-up commits are fine.

---

## Contribution Expectations

- **Settings** must be under `promptFuel.*` (e.g., `promptFuel.sources`).
- **Commands** must be under `promptFuel.*` (e.g., `promptFuel.openDashboard`).
- Authenticated live quota refresh is internal for enabled sources; source visibility is controlled through `promptFuel.sources`.
- Live quota requires existing provider OAuth/auth state. Do not add PromptFuel-specific auth UI unless explicitly scoped.
- Machine snapshots are aggregate-only sanitized JSON. Do not commit snapshot or cached provider state unless explicitly scoped.
- Do **not** commit raw prompts, responses, or conversation transcripts.
- Do **not** include authenticated provider credentials, tokens, or API keys.
- Do **not** reference reference-implementation branding, internal paths, or coordination infrastructure from PromptFuel source code.
- Marketplace publish is manual. Do not add publish automation unless explicitly scoped.

---

## Pull Requests

Describe the validation run in your PR or issue — include whether `.\tools\dev-validate-install.ps1` passed, or list any narrower diagnostic command used after a failure. Keep changes focused; split into separate PRs if a change touches multiple concerns.

---

## Code of Conduct

All contributions must follow the [PromptFuel Code of Conduct](./CODE_OF_CONDUCT.md). Be respectful, patient, and collaborative.

---

## Security & Vulnerabilities

If you discover a security issue, **do not** open a public issue. Report privately via [GitHub Security Advisories](../../security/advisories). See [SECURITY.md](./SECURITY.md) for details.

---

## Need Help?

If you're unsure whether a change belongs in this repo, how a behavior works, or what impact a change might have, open a **"Question"** issue with as much context as you can.
