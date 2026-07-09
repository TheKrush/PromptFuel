# Model Pricing Estimates

This folder contains PromptFuel's local source-of-truth pricing table for API-equivalent estimates. These values are estimates only and are not billing records.

## Source Scope

Values in `model-pricing-estimates.csv` were refreshed from official provider pages on 2026-06-04. Claude Fable 5 rows were added from official Anthropic pricing on 2026-06-10. Claude Sonnet 5 introductory pricing was added from official Anthropic sources on 2026-06-30. GPT-5.6 Sol, Terra, and Luna rows were added from official OpenAI API pricing on 2026-07-09.

- Anthropic Claude model pricing: https://platform.claude.com/docs/en/about-claude/pricing
- Anthropic Claude Sonnet 5 launch pricing: https://www.anthropic.com/news/claude-sonnet-5
- Anthropic Claude Opus 4.8 launch and fast-mode pricing: https://www.anthropic.com/news/claude-opus-4-8
- OpenAI API pricing: https://developers.openai.com/api/docs/pricing
- OpenAI public API pricing summary: https://openai.com/api/pricing/
- OpenAI GPT-5.5 model page: https://developers.openai.com/api/docs/models/gpt-5.5

## Modeling Notes

- Claude rows use first-party Claude API global pricing. PromptFuel does not model Anthropic data residency, batch, partner cloud, or private-offer modifiers.
- `claude-sonnet-5` uses Anthropic's introductory API pricing through 2026-08-31; the future standard pricing that starts on 2026-09-01 is recorded in the CSV notes column instead of as a second scheduled row.
- `anthropic/claude-fable-5` is included as an OpenRouter-style alias for the first-party `claude-fable-5` API model id.
- Claude cache-write fields distinguish the official 5-minute and 1-hour prompt cache write prices. PromptFuel's current estimate path uses the 5-minute cache-write field for existing cache-write counters.
- Claude fast-mode rows are included for matching explicit fast-mode model labels. Fast mode can have additional modifiers; PromptFuel does not model those separately.
- Codex rows use standard OpenAI API pricing for the listed models. PromptFuel does not model OpenAI batch, flex, priority, long-context, regional processing, or private-contract modifiers.
- OpenAI cached input is represented as `cache_read_per_1m` because PromptFuel's Codex token counters expose cached input as read-style cache usage.
- GPT-5.6 OpenAI cache writes use the single published cache-write rate in both CSV cache-write fields.
- `codex-auto-review` is a PromptFuel model alias mapped to the official `gpt-5.3-codex` rate so existing local estimates continue to match the prior configured behavior.
