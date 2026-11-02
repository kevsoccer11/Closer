# Card Authoring Guide (for AI agents and contributors)

## File structure
- `cards.json` — non-explicit cards (`life`, `sexuality` modules).
- `explicit-cards.json` — `explicit` module cards (18+).
- Top-level: `{ "version": "<version label>", "cards": [ ... ] }`.

## Required fields per card
| Field | Type | Rules |
|---|---|---|
| `id` | string | Unique across all files. Use prefix like `mycard-001`. |
| `module` | string | `life`, `sexuality`, or `explicit`. |
| `category` | string | ≤50 chars. Use existing categories when possible. |
| `intensity` | number | 1 = mild, 2 = moderate, 3 = wild, 4 = most intense. |
| `prompt` | string | 1–280 chars. Questions end with `?`; activities with `.`. |
| `contextType` | string | One of: story, action, consent, poll, alignment, discovery, humor, reflection, vulnerability, preference, game, flirting, intimacy, growth, trial, connection, trust, fantasy, honesty, sensory, nostalgia, thrill, spontaneity, anticipation, playful, couple. |
| `promptStyle` | string | `question` or `activity`. |
| `pillar` | string | `spark` (light and fun), `heat` (flirty and romantic), `closer` (emotional connection), `together` (Life Together: home, money, family, future) or `afterhours` (explicit deck). |
| `followUp` | string, optional | ≤200 chars, shown as "Dig deeper". Must be unique per card; used on story and dating cards. |

## Multiple-choice cards
- Add `"options": ["A", "B", ...]` (2–6 items, ≤120 chars each, unique).
- `contextType` must be `"poll"`.
- `promptStyle` should be `"question"`.

## Style guidelines
- Keep prompts conversational and personable (not clinical).
- Aim for ≤140 characters for readability.
- Ensure options are grammatically parallel.
- Avoid duplicate prompts, and don't open more than 60 prompts with the same five words.
- Story cards (`contextType: story`) need a fresh topic, not a variation of an existing one.
- Packs are defined once in `getCuratedPackSelection` (`js/app-logic.js`); add the matching card to `index.html` and update the pack count in `smoke-test.js`.

## Validation
Run:
```
node validate-cards.js cards.json
node validate-cards.js explicit-cards.json
```

## After editing
- Bump `CACHE_NAME` in `sw.js` so installed apps fetch the update.