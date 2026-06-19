# Pinokio localization

This folder is the source of truth for Pinokio UI localization.

## Scope

Localize visible product UI text: navigation captions, headings, buttons, form labels, settings descriptions, modal text, placeholders, empty states, visible tooltips, first-party accessibility labels, and user-facing errors.

Do not localize internal logs, debug-only strings, third-party app metadata, third-party launcher text, terminal output, exported diagnostic/report payload bodies, API identifiers, config keys, stored option values, executable command examples, file paths, URLs, package names, and exhaustive kernel errors. `aria-label` and `title` values should be localized when they are first-party controls/tooltips; skip only internal or data-derived values.

## Runtime behavior

The selected preference is stored in `kernel.store` as `locale`. At runtime that means `~/.pinokio/config.json`.

Supported preference values:

- `auto`
- `en`
- `de`
- `fr`
- `es`
- `pt-BR`
- `id`
- `ja`
- `tr`
- `it`
- `zh-CN`
- `zh-TW`
- `ko`
- `vi`
- `ru`

Enabled locales must be complete production catalogs. Pinokio does not fall back to English per key. A missing or bad translation is a bug and must fail validation before release.

Current target locales:

- `de`
- `fr`
- `es`
- `pt-BR`
- `id`
- `ja`
- `tr`
- `it`
- `zh-CN`
- `zh-TW`
- `ko`
- `vi`
- `ru`

Resolution order:

1. If `locale` is set to a supported locale other than `auto`, use it.
2. If `locale` is `auto`, match the request `Accept-Language` header.
3. If nothing matches, use `en`.

Choosing `English` in Settings effectively turns localization off. Choosing `Auto` follows the user's browser/system language when it matches a supported locale.

## File layout

- `catalogs.json`: all static translations, keyed by locale code.
- `locales.json`: locale metadata used for the Settings selector.
- `terms.json`: product semantics, purpose, UI context, translation rules, and nuance for ambiguous terms.
- `QUALITY.md`: mandatory cross-locale quality contract, rejection criteria, review checklist, and visual smoke-test matrix.
- `styleguides/`: per-locale UI style rules for grammar, command labels, spacing, punctuation, and common translation traps.
- `README.md`: this workflow and policy.

## Exact update workflow

Any first-party UI caption change is a localization change. This includes changing an English button label, heading, placeholder, tooltip, empty state, status message, or accessibility label. Do not update only the English source string and leave other locales stale.

1. Before changing a caption, read this policy, `QUALITY.md`, `terms.json`, and the style guide for every locale you will update.
2. Add or change the English source string in `catalogs.json` under `en`.
3. Choose a stable key that describes meaning, not current placement. Prefer `settings.save` over `settings.button1`.
4. If a new or changed phrase depends on product nuance, update `terms.json` before translating. Include the term's purpose, UI context, translation rule, examples, and any meanings to avoid.
5. Verify the English source string is a complete translatable UI unit. Do not add catalog keys for internal fragments such as `Source copy prefix`, `Before turn on`, or `Same install flow`; rewrite them into full captions first.
6. Apply the changed caption to every enabled locale in `catalogs.json` in the same change.
7. Translate from the caption's intent and documented context, not from English word order.
8. Preserve placeholders exactly, including braces such as `{name}` and `{count}`.
9. Preserve literal product names and file names documented in `terms.json`.
10. Before replacing a string, verify it is display-only. Do not translate values used as protocol sentinels, persisted config values, request/response contracts, generated diagnostic report bodies, or text another system may parse.
11. Reject translations that contain raw keys, unexplained English carryover, mixed-language token output, literal English preposition artifacts, or sentence fragments assembled in English order.
12. Run `npm run validate:i18n`. This strict audit must pass: every enabled catalog must be complete, placeholder-correct, and free of quality lint failures.
13. Run `npm run validate:i18n:drafts` if disabled draft locales exist. It applies the same strict rules to every catalog.
14. Smoke test representative screens in `en`, one CJK locale, and one longer Latin-script locale. Use `QUALITY.md` for the required screen matrix.

## Translation rules

Use natural app UI language rather than literal word-for-word translation. Keep command labels short. Do not invent new product concepts. Translate visible labels, not stored config values.

Locale style guides are mandatory translation policy, not optional suggestions. When changing any caption, apply `terms.json` plus the target locale's `styleguides/<locale>.md` rules to every enabled locale in the same change.

A caption change is not complete until the changed key has been translated correctly for every enabled locale.

`QUALITY.md` is also mandatory. It defines generic cross-locale failure modes that automated JSON validation does not catch, including raw-key leaks, English carryover, mixed-language output, fragment concatenation, bad source strings, and literal preposition translation.

When translating ambiguous terms, read `terms.json` first. This is especially important for `app`, `plugin`, `launcher`, `home`, `This machine`, `Open without launching`, `terminal`, `mode`, and `Reset`.

Nuance alone is not enough. Each glossary entry should explain why the term exists, where it appears, what behavior the translation must preserve, what literal tokens must stay unchanged, and which common wrong meanings to avoid.

## Adding a locale

1. Add the locale to `locales.json`.
2. Start with `"enabled": false` and `"quality": "draft"` until there is at least a usable catalog and style guide.
3. Add a matching top-level locale object in `catalogs.json`.
4. Add `styleguides/<locale>.md`.
5. Update this README's target locale list.
6. Run `npm run validate:i18n`.
7. Promote the locale to `"enabled": true` and `"quality": "production"` only after `npm run validate:i18n:drafts` and visual QA pass.
