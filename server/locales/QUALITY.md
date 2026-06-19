# Localization quality contract

This document defines the minimum quality bar for Pinokio localization. It exists
because a catalog can be structurally valid while still being unusable: raw keys
can leak, English fragments can remain, sentences can be assembled from
translated pieces in an impossible order, and machine-generated text can sound
wrong in every target language.

These rules apply to every locale. Per-locale style guides add language-specific
details, but they never replace this contract.

## Core rule

Translate the user-facing intent of a complete UI caption in context. Do not
translate English tokens one by one.

A translation is not acceptable just because every English word has been
replaced. It must read like natural application UI in the target language, fit
the screen, preserve the product behavior, and keep all placeholders and literal
technical names intact.

## What counts as a localization change

Any change to first-party UI text is a localization change:

- Navigation labels, page headings, section headings, table headings.
- Buttons, menus, tabs, toggles, segmented controls, badges, and status pills.
- Placeholders, form labels, helper text, empty states, and confirmation text.
- Toasts, modals, visible errors, visible warnings, visible setup states.
- First-party tooltips, title text, and accessibility labels for controls.

If English copy changes, every supported locale must be updated in the same
change. Do not leave stale translations, and do not hide missing translations
with English substitution in enabled locales.

## What must not be localized

Do not translate values that are not UI captions:

- Stored config values, API identifiers, protocol values, route names, CSS
  classes, DOM ids, query parameters, event names, or sentinels.
- Third-party app metadata, third-party launcher text, terminal output, shell
  output, executable commands, stack traces, and raw logs.
- File paths, URLs, package names, executable names, code identifiers, model
  names, environment variable names, and literal file names such as `SKILL.md`.
- Generated diagnostic/report payload bodies that users copy into GitHub,
  Discord, or support channels.
- Any text another system, script, test, or parser may read.

If a string might be both visible and parseable, treat it as parseable until the
owning code path proves otherwise.

## Source string quality

The English source string must be a complete, translatable UI unit. Do not add
catalog keys for internal fragments unless the fragment is a standalone UI
caption in every target language.

Bad source strings:

- `Source copy prefix`
- `Downloaded requires root`
- `Before turn on`
- `Into target folders`
- `Same install flow`
- `Install refresh before reopen`

These are not good translation sources because they are internal shorthand or
English-only fragments. Before translating, rewrite the source as complete UI
copy with clear meaning.

Better source strings:

- `The source folder is copied into each target folder.`
- `Downloaded skills must include SKILL.md at the root before they can be turned on.`
- `Use the same install flow.`
- `Install updates before reopening {target}.`

## No sentence assembly from fragments

Do not build user-visible sentences by concatenating separately translated
fragments unless every fragment is independently grammatical in every supported
language.

Bad:

```js
t("skills.downloaded_requires_root") + " SKILL.md " + t("skills.before_turn_on")
```

This creates broken Korean, Japanese, Chinese, German, French, Spanish,
Portuguese, Turkish, Indonesian, Vietnamese, Italian, and Russian because word
order and particles/prepositions differ by language.

Good:

```js
t("skills.downloaded_requires_root_skill_file", { file: "SKILL.md" })
```

with English source:

```text
Downloaded skills must include {file} at the root before they can be turned on.
```

## Context package for every translation

Before translating a key, identify:

- The screen or component where it appears.
- The UI role: heading, button, badge, menu item, status, error, helper text.
- The workflow state: idle, running, failed, installed, publishing, confirming.
- The subject and object of the action.
- Whether the string is a command, a status, a warning, or explanatory copy.
- Placeholder meanings and allowed values.
- Literal tokens that must be preserved.
- Product terms that must follow `terms.json`.

If this context is missing, inspect the code and, when possible, the UI. Do not
guess from the English text alone.

## Placeholder rules

Placeholders are part of the contract.

- Preserve placeholder names exactly: `{name}` stays `{name}`.
- Do not translate placeholder names.
- Do not drop braces.
- Do not invent placeholders.
- Move placeholders wherever the target language needs them.
- If a placeholder represents a path, URL, command, file name, package, app name,
  repository name, or model name, leave the inserted value literal.

Examples:

```text
EN: {name} - review your latest changes before publishing.
Bad: {name} - revisar tu mas reciente cambios antes publicando.
Good intent: {name} - Review the latest changes before publishing.
```

The target translation should express the same instruction naturally. It should
not preserve English word order.

## Literal token rules

Keep product and technical names literal when the glossary says to preserve
them:

- `Pinokio`
- `GitHub`
- `SKILL.md`
- `pinokio.js`
- `ENVIRONMENT`
- `API`
- `URL`
- `HTTP`, `HTTPS`, `SSH`
- Paths such as `~/pinokio/key.json`
- Commands and executables such as `git`, `node`, `conda`, `brew`, `uv`, `zsh`

Translate surrounding grammar naturally. Do not translate English prepositions
literally around preserved names.

Examples:

- `Publish to GitHub` means publish/share on GitHub. It does not mean translate
  `to` as a standalone token.
- `View on GitHub` means open the GitHub page. It does not mean `on` as power-on
  or physical location in languages where that would be wrong.

## Mixed-language rule

Mixed-language UI is rejected unless every remaining English token is an allowed
literal product/technical name.

Rejected examples:

- `Disable 모두`
- `Startup スクリプト`
- `Try fresh 설치`
- `Same 安装 flow`
- `준비됨 to 계속`
- `Protection beta dang bat cho app nay`
- `Built-in плагин`

Allowed examples:

- `GitHub`
- `Pinokio`
- `SKILL.md`
- `ComfyUI`
- `CUDA`
- `URL`

Borrowed technical words are allowed only when the locale style guide says they
are natural UI language for that locale. English leftovers are never acceptable
just because the source was technical.

## Raw-key rule

No user should ever see a catalog key.

Rejected examples:

- `setup.update_needed_one`
- `tasks.remote_repository`
- `app.publish_review_subtitle`

A raw key on screen means one of these happened:

- The catalog is missing the requested key.
- Runtime code constructed a key such as `_one` or `_many` that was not defined.
- The translation helper was called with arguments in the wrong order.
- A missing translation reached runtime.

Any raw-key leak blocks shipping.

## English carryover rule

For non-English locales, unchanged English is rejected unless the full value is
an allowed literal, brand, file name, package name, command, or widely accepted
technical token documented by the locale style guide.

Rejected examples in non-English catalogs:

- `How this works`
- `Stored in`
- `Requirements need attention`
- `Requirement summary`
- `Not working`
- `Commit before publishing`

Some strings can legitimately remain English, but that decision must be
intentional and documented. Do not assume unchanged English is acceptable.

## Grammar and word-order rule

Every translated caption must be reviewed as a whole sentence or whole UI label.
It must not reveal English grammar underneath it.

Rejected patterns:

- A verb placed before the object only because English does it.
- English prepositions translated as standalone particles.
- English possessives translated literally where the target language would omit
  them.
- Adjectives and nouns left in English noun-stack order when the target language
  requires a different structure.
- Commands translated as infinitives when the locale expects imperative or noun
  phrase commands.

The style guides document frequent traps, but they are not textbooks. If a
translation sounds like English with target-language words inserted, reject it.

## UI role rule

Translate based on UI role, not dictionary meaning.

Examples:

- `Run` on a button is a command to execute a script.
- `Running` in a badge is a status.
- `Open` may mean open a file/folder/page, not run a script.
- `Install` means set up inside Pinokio unless the UI explicitly says OS
  package/dependency.
- `Publish` means push/share through GitHub, not save locally.
- `Save version` means create a local tracked version/checkpoint.
- `This machine` means the current computer running Pinokio, not a website,
  remote server, or abstract device.

Use `terms.json` for these distinctions.

## Count and plural rule

Counts must be grammatical in the target language and must not leak runtime key
suffixes.

Rules:

- Define every runtime key that code can request.
- If code asks for `_one`, `_many`, or `_other`, every locale must include those
  exact keys.
- Do not assume every language has English singular/plural behavior.
- If a locale does not need a separate singular form, it may repeat a natural
  same string, but the key must still exist if runtime asks for it.
- Avoid generic English `of`, `count`, or `checks` fragments. Use full count
  captions where possible, such as `{count} of {total}` as one key.

Raw `_one` or `_other` text on screen is a blocking bug.

## Direction, spacing, and punctuation

Follow each locale style guide for:

- Spaces around Latin product names.
- Full-width vs half-width punctuation.
- Sentence-ending punctuation.
- Button capitalization.
- Quotation marks.
- Parentheses.
- Ellipses.
- Colon usage.

Do not copy English capitalization into languages that do not use it in the same
way.

## Layout rule

A translation must fit the UI component where it appears.

Before shipping:

- Check narrow sidebars.
- Check buttons with icons.
- Check badges and status pills.
- Check modals.
- Check tables and cards.
- Check CJK and longer European translations.

Do not shorten by creating ungrammatical fragments. If the natural translation
does not fit, adjust the UI layout or choose a concise natural caption.

## AI-generated translation policy

AI-generated translations are drafts until they pass quality review.

An AI translation pass must:

1. Read `README.md`, this file, `terms.json`, and every edited locale style
   guide before translating.
2. Translate by full key context, not by exported word lists alone.
3. Reject or rewrite bad English source strings before translating them.
4. Preserve placeholders and documented literals.
5. Self-audit every locale for raw keys, English carryover, mixed-language text,
   and English word order.
6. Run validation scripts.
7. Visually inspect representative screens in at least English, one CJK locale,
   and one longer Latin-script locale.
8. State clearly whether translations are production-ready or draft.

Do not claim a generated catalog is shippable just because JSON validates.

## Required human-style review checklist

For each changed key in each locale, answer yes to all of these:

- Does it say the same thing as the English source in this UI context?
- Does it preserve Pinokio product semantics from `terms.json`?
- Does it read naturally as native app UI?
- Is it free of unexplained English?
- Is it free of English word order and preposition artifacts?
- Are placeholders preserved exactly?
- Are literal technical tokens preserved exactly?
- Does it fit the component?
- Would a user understand what action or state it represents?
- Would the text still be correct if read outside the English sentence structure?

One "no" means the translation is not done.

## Required automated checks

`npm run validate:i18n` validates every enabled locale strictly. Enabled locales
must be complete, placeholder-correct, and free of quality lint failures.

`npm run validate:i18n:drafts` applies the same strict audit to every catalog,
including disabled drafts. It is expected to fail while draft catalogs are
incomplete or machine-generated. It must pass before a draft locale can be
enabled.

Structural validation must include:

- Every locale has the same key set as English.
- No extra keys and no missing keys.
- Placeholder sets match English exactly.
- Source references only existing keys.
- Runtime plural/key variants are defined.
- Translation helpers used in templates are available at render time.

Quality linting should also flag likely problems:

- Raw key-shaped values.
- Values identical to English outside an allowlist.
- Obvious mixed-language strings.
- English stop words left inside non-English UI.
- Known bad English fragments such as `prefix`, `flow`, `needed`, `every`,
  `before`, `after`, `checks`, and `continue` when they appear as untranslated
  English in non-English values. Do not lint language-shared short words such as
  `in` globally; catch those through context review and locale-specific rules.
- Locale-specific command-order traps documented in style guides.

Automated checks are necessary but not sufficient. Passing them does not replace
context review.

## Visual smoke-test matrix

Before claiming a locale is complete, inspect screens that exercise different
text shapes:

- Home app list: search placeholder, sort menu, app action buttons, status text.
- Sidebar: section labels and navigation labels.
- Settings: selectors, descriptions, reset buttons, locale selector.
- Autolaunch: counters, disable-all action, app/script picker.
- Setup requirements: headings, badges, counts, install/update actions.
- Skills: managed-skill explanation, buttons, status badges, path copy.
- GitHub publish modal: heading, subtitles, terminal status, action buttons.
- Logs/report UI: page chrome only; copied diagnostic payload stays stable.
- Terminal modal: run/disconnect/reconnect controls and status messages.
- File/app browser: open/run/install/download/share actions.

Screenshots must be checked for raw keys, mixed language, clipped text, and
wrong grammar.

## Shipping policy

A locale is not production-ready if any of these are true:

- It contains machine-generated text that has not passed this contract.
- It contains raw keys.
- It contains broad English carryover outside documented literals.
- It contains mixed-language token translations.
- It was translated from fragments that should have been full sentences.
- It has not been visually inspected in representative UI.

If quality is uncertain, keep the locale disabled as draft until it is corrected.
Bad localization makes the app look broken and can mislead users about actions.

## Failure examples from this implementation

These are examples of what this contract is designed to prevent.

Raw key leak:

```text
setup.update_needed_one
```

Untranslated values:

```text
How this works
Stored in
Requirements need attention
```

Mixed-language token translations:

```text
Disable 모두
Startup スクリプト
Same 安装 flow
Try fresh Установить
```

Literal preposition translation:

```text
Publish to GitHub -> 게시 로 GitHub
View on GitHub -> 보기 켜짐 GitHub
```

Fragment assembly:

```text
Downloaded requires root SKILL.md Before turn on
```

Broken sentence translation:

```text
{name} - 검토 사용자 최신 변경사항 전에 게시 중.
```

Each of these is a blocking localization failure.
