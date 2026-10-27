# Model Pricing Estimates

This folder contains PromptFuel's local source-of-truth pricing table for API-equivalent estimates. These values are estimates only and are not billing records.

## Source Scope

GPT-6.1 Terra was added at its 2026-10-26 launch using the official OpenAI model page and API changelog.

Values in `model-pricing-estimates.csv` were refreshed from official provider pages on 2026-06-04. Claude Fable 5 rows were added from official Anthropic pricing on 2026-06-10. Claude Sonnet 5 introductory pricing was added from official Anthropic sources on 2026-06-30. GPT-5.6 Sol, Terra, and Luna rows were added from official OpenAI API pricing on 2026-07-09. Claude Opus 5 row was added from official Anthropic pricing on 2026-07-25, using the same standard global API rates as Claude Opus 4.8. GPT-5.6 Terra and Luna effective-dated price reductions were added from official OpenAI API pricing on 2026-09-06, with the prior 2026-07-09 rows retained as historical pricing. GPT-6 Astra was added from official OpenAI API pricing on 2026-09-06. Claude Opus 5.5 and GPT-6 Sol/Luna rows were added from official provider pricing with 2026-09-22 effective dates. Claude Fable 5.1 (2026-09-01), Claude Sonnet 5.5 (2026-09-28), and GPT-6.1 Sol (2026-09-29) rows were added from official Anthropic and OpenAI documentation on 2026-10-01. The scheduled 2026-09-01 Claude Sonnet 5 $3/$15 row was removed because Anthropic cancelled that increase on 2026-08-10, and lifecycle notes on retired or deprecated Claude rows were refreshed against the official pricing and deprecations pages. On 2026-10-15 the table was re-audited against the official Anthropic and OpenAI pricing, model, deprecation, and changelog pages: Claude Haiku 5.5 (2026-10-07, lower prompt-size band only) was added, and an effective-dated Claude Sonnet 5.5 row (2026-10-07) was added for the cache-read reduction from $0.20 to $0.10 per 1M. No OpenAI rate changes were found since the 2026-10-01 refresh.

- Anthropic Claude model pricing: https://platform.claude.com/docs/en/about-claude/pricing
- Anthropic Claude Sonnet 5 launch pricing: https://www.anthropic.com/news/claude-sonnet-5
- Anthropic Claude Opus 4.8 launch and fast-mode pricing: https://www.anthropic.com/news/claude-opus-4-8
- Anthropic Claude model deprecations: https://platform.claude.com/docs/en/about-claude/model-deprecations
- Anthropic Claude models overview: https://platform.claude.com/docs/en/about-claude/models
- Anthropic Claude Haiku 5.5 launch and Sonnet 5.5 cache-read reduction: https://www.anthropic.com/claude-haiku-5-5
- Anthropic Claude Haiku 5.5 model page: https://platform.claude.com/docs/en/models/haiku-5-5/overview
- OpenAI API pricing: https://developers.openai.com/api/docs/pricing
- OpenAI public API pricing summary: https://openai.com/api/pricing/
- OpenAI GPT-5.5 model page: https://developers.openai.com/api/docs/models/gpt-5.5
- OpenAI GPT-6 Astra model page: https://developers.openai.com/api/docs/models/gpt-6-astra
- OpenAI GPT-6.1 Terra model page: https://developers.openai.com/api/docs/models/gpt-6.1-terra
- OpenAI GPT-6.1 Sol model page: https://developers.openai.com/api/docs/models/gpt-6.1-sol
- OpenAI API changelog: https://developers.openai.com/api/docs/changelog
- OpenAI GPT-5.6 pricing and updates: https://openai.com/index/advancing-the-price-performance-frontier-with-gpt-5-6/

## Modeling Notes

- Claude rows use first-party Claude API global pricing. PromptFuel does not model Anthropic data residency, batch, partner cloud, or private-offer modifiers.
- `claude-sonnet-5` has a single row at $2/$10. Launch pricing was announced as introductory through 2026-08-31, but Anthropic made it permanent on 2026-08-10 and cancelled the scheduled 2026-09-01 increase to $3/$15. The CSV schema still supports effective-dated rows resolved by `effective_date` using a UTC calendar-date `YYYY-MM-DD` as-of rule.
- `claude-fable-5-1` cache reads are priced at 0.025x base input ($0.25/1M), unlike `claude-fable-5` at 0.1x ($1/1M), so the Fable 5 row must not be copied for Fable 5.1. Claude Opus 5.5 cache reads are 0.05x base input ($0.20/1M), which its CSV row already reflects.
- `claude-sonnet-5-5` has two effective-dated rows: the 2026-09-28 launch row (cache read $0.20/1M) is preserved as historical pricing, and the 2026-10-07 row lowers cache reads to $0.10/1M (0.05x base input, matching Claude Opus 5.5) with every other rate unchanged. Estimates dated before 2026-10-07 keep the $0.20 rate.
- `claude-haiku-5-5` is the only Claude model priced by prompt length. Anthropic bills a request at higher rates when its prompt exceeds 100,000 tokens, where prompt length counts all input tokens including cache reads and cache writes: $0.50 input, $2.50 output, $0.625 5-minute cache write, $1.00 1-hour cache write, and $0.05 cache read per 1M, versus $0.10 / $0.50 / $0.125 / $0.20 / $0.01 up to the threshold. The CSV holds only the lower band, because PromptFuel's estimator receives aggregated per-model token totals and has no per-request prompt length; the band cannot be inferred from aggregates, so any usage above the threshold is underestimated (by up to 5x for the affected requests). Accurate Haiku 5.5 estimates for long prompts would need per-request prompt-size data from the scanners plus tier-aware pricing rows; that is deliberately not part of this refresh.
- Claude Mythos 5 and Claude Mythos 5.1 are not currently listed: they are limited-availability (restricted-access) models and the table has no existing Mythos pricing entries. Inclusion criteria for restricted-access models have not been formally established.
- Claude Opus 5 fast mode is listed by Anthropic at $10/$50 per 1M (research preview, same as Opus 4.8), but no `claude-opus-5-fast` row is included because no verified effective date for it was found; `claude-opus-5-5-fast` and `claude-opus-4-8-fast` are covered.
- `anthropic/claude-fable-5` is included as an OpenRouter-style alias for the first-party `claude-fable-5` API model id.
- Claude cache-write fields distinguish the official 5-minute and 1-hour prompt cache write prices. PromptFuel's current estimate path uses the 5-minute cache-write field for existing cache-write counters.
- Claude fast-mode rows are included for matching explicit fast-mode model labels. Fast mode can have additional modifiers; PromptFuel does not model those separately.
- Codex rows use standard OpenAI API pricing for the listed models. PromptFuel does not model OpenAI batch, flex, priority, long-context, regional processing, or private-contract modifiers.
- OpenAI cached input is represented as `cache_read_per_1m` because PromptFuel's Codex token counters expose cached input as read-style cache usage.
- GPT-5.6 OpenAI cache writes use the single published cache-write rate in both CSV cache-write fields.
- GPT-5.6 Terra and Luna each have two effective-dated rows: the original 2026-07-09 standard rates (historical) and the 2026-07-30 price reductions. The resolver selects the correct row by `effective_date` the same way Claude Sonnet 5's scheduled rows are resolved.
- GPT-6.1 Terra uses standard rates of $1 input, $5 output, $0.05 cached input, and $1.25 for 30-minute cache writes per million tokens. Both legacy cache-write fields contain the 30-minute rate as an approximation; their 5-minute and 1-hour labels do not describe OpenAI retention. The $2.50 per million 12-hour cache-write tariff is not represented. Requests above 272K input tokens use higher long-context rates, which the aggregate-based flat estimate cannot identify or apply. Fast, Batch, Flex, and regional modifiers are also excluded.
- GPT-6 Astra has separate long-context pricing above 272K input tokens. PromptFuel's current flat pricing schema does not model that tariff; only short-context rates are represented.
- GPT-6 Sol, GPT-6.1 Sol, and GPT-6 Luna carry the same >272K long-context caveat as GPT-6 Astra. `gpt-6.1-sol` is the newer Sol model and `gpt-6-sol` remains a current API model with its own row; their cached-input rates differ ($0.10 vs $0.20 per 1M).
- OpenAI Ultrafast mode (listed for GPT-6 Astra and GPT-6.1 Sol) and Fast/Batch/Flex tiers are separate modifiers that PromptFuel does not model. GPT-5.6 Cyber has no published model ID or pricing and is not listed.
- `codex-auto-review` is a PromptFuel model alias mapped to the official `gpt-5.3-codex` rate so existing local estimates continue to match the prior configured behavior.
