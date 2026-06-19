# Locale style guides

These files define Pinokio UI localization style for each supported locale.

Use them whenever adding or changing any first-party UI caption in `catalogs.json`.
They are not full grammar references. They document product tone, command-label shape,
spacing, punctuation, placeholder handling, and repeatable mistakes to avoid.

Required workflow:

1. Read `server/locales/README.md`.
2. Read `server/locales/QUALITY.md` for cross-locale rejection criteria and QA gates.
3. Read `server/locales/terms.json` for product semantics.
4. Read the style guide for every locale you edit.
5. Translate complete UI captions from intent and context, not English word order.
6. Reject raw keys, unexplained English carryover, mixed-language token output, and fragment concatenation.
7. Preserve placeholders and documented literal tokens exactly.
8. Run `npm run validate:i18n`.
9. Run `npm run validate:i18n:drafts` before claiming any locale is fully production-ready.
