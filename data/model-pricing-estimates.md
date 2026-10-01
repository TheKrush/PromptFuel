# Model Pricing Estimates

This folder contains PromptFuel's local source-of-truth pricing table for API-equivalent estimates. These values are estimates only and are not billing records.

## Source Scope

Values in `model-pricing-estimates.csv` were refreshed from official provider pages on 2026-06-04. Claude Fable 5 rows were added from official Anthropic pricing on 2026-06-10. Claude Sonnet 5 introductory pricing was added from official Anthropic sources on 2026-06-30. GPT-5.6 Sol, Terra, and Luna rows were added from official OpenAI API pricing on 2026-07-09. Claude Opus 5 row was added from official Anthropic pricing on 2026-07-25, using the same standard global API rates as Claude Opus 4.8. GPT-5.6 Terra and Luna effective-dated price reductions were added from official OpenAI API pricing on 2026-09-06, with the prior 2026-07-09 rows retained as historical pricing. GPT-6 Astra was added from official OpenAI API pricing on 2026-09-06. Claude Opus 5.5 and GPT-6 Sol/Luna rows were added from official provider pricing with 2026-09-22 effective dates. Claude Fable 5.1 (2026-09-01), Claude Sonnet 5.5 (2026-09-28), and GPT-6.1 Sol (2026-09-29) rows were added from official Anthropic and OpenAI documentation on 2026-10-01. The scheduled 2026-09-01 Claude Sonnet 5 $3/$15 row was removed because Anthropic cancelled that increase on 2026-08-10, and lifecycle notes on retired or deprecated Claude rows were refreshed against the official pricing and deprecations pages.

- Anthropic Claude model pricing: https://platform.claude.com/docs/en/about-claude/pricing
- Anthropic Claude Sonnet 5 launch pricing: https://www.anthropic.com/news/claude-sonnet-5
- Anthropic Claude Opus 4.8 launch and fast-mode pricing: https://www.anthropic.com/news/claude-opus-4-8
- Anthropic Claude model deprecations: https://platform.claude.com/docs/en/about-claude/model-deprecations
- OpenAI API pricing: https://developers.openai.com/api/docs/pricing
- OpenAI public API pricing summary: https://openai.com/api/pricing/
- OpenAI GPT-5.5 model page: https://developers.openai.com/api/docs/models/gpt-5.5
- OpenAI GPT-6 Astra model page: https://developers.openai.com/api/docs/models/gpt-6-astra
- OpenAI GPT-6.1 Sol model page: https://developers.openai.com/api/docs/models/gpt-6.1-sol
- OpenAI API changelog: https://developers.openai.com/api/docs/changelog
- OpenAI GPT-5.6 pricing and updates: https://openai.com/index/advancing-the-price-performance-frontier-with-gpt-5-6/

## Modeling Notes

- Claude rows use first-party Claude API global pricing. PromptFuel does not model Anthropic data residency, batch, partner cloud, or private-offer modifiers.
- `claude-sonnet-5` has a single row at $2/$10. Launch pricing was announced as introductory through 2026-08-31, but Anthropic made it permanent on 2026-08-10 and cancelled the scheduled 2026-09-01 increase to $3/$15. The CSV schema still supports effective-dated rows resolved by `effective_date` using a UTC calendar-date `YYYY-MM-DD` as-of rule.
- `claude-fable-5-1` cache reads are priced at 0.025x base input ($0.25/1M), unlike `claude-fable-5` at 0.1x ($1/1M), so the Fable 5 row must not be copied for Fable 5.1. Claude Opus 5.5 cache reads are 0.05x base input ($0.20/1M), which its CSV row already reflects.
- Claude Mythos 5.1 is not currently listed: it is restricted-access (invite-only through Project Glasswing) and the table has no existing Mythos pricing entries. Inclusion criteria for restricted-access models have not been formally established.
- `anthropic/claude-fable-5` is included as an OpenRouter-style alias for the first-party `claude-fable-5` API model id.
- Claude cache-write fields distinguish the official 5-minute and 1-hour prompt cache write prices. PromptFuel's current estimate path uses the 5-minute cache-write field for existing cache-write counters.
- Claude fast-mode rows are included for matching explicit fast-mode model labels. Fast mode can have additional modifiers; PromptFuel does not model those separately.
- Codex rows use standard OpenAI API pricing for the listed models. PromptFuel does not model OpenAI batch, flex, priority, long-context, regional processing, or private-contract modifiers.
- OpenAI cached input is represented as `cache_read_per_1m` because PromptFuel's Codex token counters expose cached input as read-style cache usage.
- GPT-5.6 OpenAI cache writes use the single published cache-write rate in both CSV cache-write fields.
- GPT-5.6 Terra and Luna each have two effective-dated rows: the original 2026-07-09 standard rates (historical) and the 2026-07-30 price reductions. The resolver selects the correct row by `effective_date` the same way Claude Sonnet 5's scheduled rows are resolved.
- GPT-6 Astra has separate long-context pricing above 272K input tokens. PromptFuel's current flat pricing schema does not model that tariff; only short-context rates are represented.
- GPT-6 Sol, GPT-6.1 Sol, and GPT-6 Luna carry the same >272K long-context caveat as GPT-6 Astra. `gpt-6.1-sol` is the newer Sol model and `gpt-6-sol` remains a current API model with its own row; their cached-input rates differ ($0.10 vs $0.20 per 1M).
- `codex-auto-review` is a PromptFuel model alias mapped to the official `gpt-5.3-codex` rate so existing local estimates continue to match the prior configured behavior.
