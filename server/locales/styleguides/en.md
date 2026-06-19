# English UI Style

English is the source locale. Write source strings so every other locale can translate from intent without guessing.

- Use concise app UI language.
- Prefer clear command verbs: `Open logs`, `Save version`, `Reset selected`.
- Avoid ambiguous noun stacks when a short phrase with context is clearer.
- Do not encode behavior only in punctuation or capitalization.
- Include the object in command labels when it matters: `Open checkpoints folder`, not only `Open`.
- Use placeholders only for values that vary at runtime, such as `{name}`, `{count}`, `{path}`.
- Do not make placeholders grammatically necessary in ways that are hard to localize.
- Keep product names and code identifiers literal when `terms.json` says to preserve them.
- If a caption changes meaning or behavior, update `terms.json` before translating.
- Treat any first-party caption change as requiring updates to every supported locale.

