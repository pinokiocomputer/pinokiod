const catalogs = require('../server/locales/catalogs.json')
const locales = require('../server/locales/locales.json')
const fs = require('fs')
const path = require('path')

const INCLUDE_DRAFTS = process.argv.includes('--include-drafts')
const PLACEHOLDER_RE = /\{[a-zA-Z0-9_]+\}/g
const RAW_KEY_VALUE_RE = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/i
const TRANSLATION_FUNCTION_NAMES = [
  'tr',
  'trj',
  'sidebarT',
  'homeT',
  'browserPopoutT',
  'peerT',
  'tabLinkT',
  'fsTr',
  'runTr',
  'installT',
  'modalInputT',
  'simpleModalT',
  't',
  'tt',
  'pinokioT',
  'translate'
]
const TRANSLATION_CALL_RE = new RegExp(`\\b(?:${TRANSLATION_FUNCTION_NAMES.join('|')})\\s*\\(([^)]*)\\)`, 'gs')
const QUOTED_KEY_RE = /["']([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)["']/gi
const SOURCE_KEY_PATTERNS = TRANSLATION_FUNCTION_NAMES.map((name) => {
  return new RegExp(`\\b${name}\\(\\s*["']([^"']+)["']`, 'g')
})
const SOURCE_SCAN_ROOTS = [
  path.resolve(__dirname, '../server/views'),
  path.resolve(__dirname, '../server/public'),
  path.resolve(__dirname, '../server/index.js'),
  path.resolve(__dirname, '../server/lib/i18n.js')
]
const STYLEGUIDE_DIR = path.resolve(__dirname, '../server/locales/styleguides')
const SOURCE_SKIP_DIRS = new Set([
  'ace',
  'css',
  'oldxterm',
  'serve',
  'webfonts'
])
const SOURCE_SKIP_FILES = new Set([
  'dropzone-min.js',
  'fuse.js',
  'highlight-js.js',
  'highlight.js',
  'hotkeys.common.min.js',
  'hotkeys.min.js',
  'jsoneditor.min.js',
  'mark.min.js',
  'noty.js',
  'popper.min.js',
  'redoc.standalone.js',
  'swagger-ui-bundle.js',
  'sweetalert2.js',
  'timeago.min.js',
  'tippy-bundle.umd.min.js',
  'tom-select.complete.min.js'
])
const CATALOG_BOOTSTRAP_SCRIPT_RE = /<script\s+[^>]*src=["']([^"']+)["'][^>]*>/g
const SCRIPTS_REQUIRING_PRESEEDED_CATALOG = new Set([
  '/common.js',
  '/run-task-save.js',
  '/task-launcher.js',
  '/task-share.js',
  '/terminal-settings.js',
  '/urldropdown.js'
])
const OPEN_COMMAND_KEY_RE = /(^|[._-])open([._-]|$)/
const LOCALE_LINT_RULES = {
  ja: [
    {
      test: (key, value) => OPEN_COMMAND_KEY_RE.test(key) && /^開く\s+/.test(value),
      message: (key) => `ja.${key} appears to use English open-command order; use natural Japanese object + を + verb per styleguides/ja.md`
    }
  ],
  ko: [
    {
      test: (key, value) => OPEN_COMMAND_KEY_RE.test(key) && /^열기\s+/.test(value),
      message: (key) => `ko.${key} appears to use English open-command order; use natural Korean object + action per styleguides/ko.md`
    },
    {
      test: (key, value) => /설치됨\s+\S/.test(value),
      message: (key) => `ko.${key} uses the status noun "설치됨" in English order; rephrase as natural Korean`
    },
    {
      test: (key, value) => /아님\s+설치됨/.test(value),
      message: (key) => `ko.${key} uses English not-installed order; use "설치되지 않음"`
    },
    {
      test: (key, value) => /^만들기\s+앱$/.test(value),
      message: (key) => `ko.${key} uses English create-app order; use "앱 만들기"`
    },
    {
      test: (key, value) => /^입력\s+(채널|패키지 이름)$/.test(value),
      message: (key) => `ko.${key} uses English input-command order; use object + action, such as "채널 입력"`
    },
    {
      test: (key, value) => /^설치\s+번들$/.test(value),
      message: (key) => `ko.${key} uses English install-command order; use "번들 설치"`
    },
    {
      test: (key, value) => /^실행\s+\{command\}$/.test(value),
      message: (key) => `ko.${key} uses English command order; use "{command} 실행"`
    },
    {
      test: (key, value) => /^실행 중\s+\{command\}$/.test(value),
      message: (key) => `ko.${key} uses English command order; use "{command} 실행 중"`
    }
  ]
}
const ALLOWED_LITERAL_VALUES = new Set([
  'API',
  'CPU',
  'CUDA',
  'DNS',
  'Discord',
  'ENV',
  'ENVIRONMENT',
  'GPU',
  'GitHub',
  'Hugging Face OAuth',
  'HTTP',
  'HTTPS',
  'ID',
  'JSON',
  'LAN',
  'OpenAI',
  'Pinokio.dev on X',
  'PATH',
  'Pinokio',
  'RAM',
  'SKILL.md',
  'SSH',
  'SSL',
  'URL',
  'VRAM',
  'YAML',
  'app.json',
  'ANSI 5 Magenta',
  'ANSI 6 Cyan',
  'A-Z',
  'bin',
  'conda',
  'Caddy',
  'git',
  'node',
  'pinokio.js',
  'TODO',
  'UI Monospace',
  'uv',
  'zsh'
])
const ALLOWED_LITERAL_RE = /\b(Pinokio|GitHub|OpenAI|ComfyUI|Hugging Face|API|URL|HTTP|HTTPS|SSH|JSON|YAML|ENVIRONMENT|ENV|PATH|CPU|GPU|RAM|VRAM|CUDA|SSL|DNS|LAN|ID|SKILL\.md|pinokio\.js|app\.json|conda|git|node|brew|uv|zsh|bash|PowerShell|Windows|macOS|Linux)\b/g
const ENGLISH_LEFTOVER_RE = /\b(Disable|Startup|Try fresh|Same|Requirements?|Requirement summary|Needs attention|Not working|How this works|Stored in|Downloaded|Before turn on|Source copy prefix|Source stays|Conflict untouched|Install refresh before reopen|Ready to continue|Review before continue|Update needed|Built-in|Commit before publishing|fallback used|Shell emit|Requires AI agent access|Ask a question|This is for importing|Arbitrary GitHub|To make your own|Opening the dev page|Setting up the new|Uploading your|starter files|This usually takes|guides used by|Blocks AI|accessing other|unless you allow it|every|needed|flow|prefix|before|after|checks|continue)\b/i
const BAD_ENGLISH_SOURCE_VALUES = new Set([
  'Source copy prefix',
  'Downloaded requires root',
  'Before turn on',
  'Into target folders',
  'Same install flow',
  'Install refresh before reopen',
  'Everything available continue',
  'No updates continue',
  'Delete bin confirm',
  'Remove confirm',
  'Add title community',
  'Add title community tooltip',
  'Delete confirm title',
  'Deleted title',
  'Applying secure localhost title'
])
const NON_LATIN_MIXED_LOCALES = new Set(['ja', 'zh-CN', 'zh-TW', 'ko', 'ru'])
const CJK_NO_SPACED_WORD_LOCALES = new Set(['ja', 'zh-CN', 'zh-TW'])
const CJK_SPACED_WORD_RE = /[\u3040-\u30ff\u3400-\u9fff][，。！？、：:.]?[ \t]+[\u3040-\u30ff\u3400-\u9fff]/
const LATIN_TRANSLITERATION_RULES = {
  de: {
    words: ['moeglich', 'oeffnen', 'veroeffentlichen', 'waehlen', 'zurueck', 'fuer', 'aenderungen'],
    phrases: ['Erstellen a launcher']
  },
  fr: {
    words: ['Echec', 'echec', 'Reinitialiser', 'reinitialiser', 'selectionne', 'selectionnes', 'supprimes', 'Demarrer', 'demarrer', 'defaut', 'deja', 'Creer', 'creer', 'deboguez', 'resultats', 'indexes', 'utilises', 'reseau'],
    phrases: ['Connecter vers', 'Impossible ouvrir', 'Echec ouvrir', 'Echec enregistrer', 'Enregistrer echec']
  },
  es: {
    words: ['Aplicacion', 'Configuracion', 'historico', 'aprobacion', 'Ejecucion', 'ejecucion', 'proteccion', 'inspeccion'],
    phrases: ['Fallo abrir', 'Fallo guardar', 'Fallo eliminar', 'esta requerido']
  },
  'pt-BR': {
    words: ['Nao', 'nao', 'possivel', 'repositorio', 'historico', 'padrao', 'permissoes', 'versoes', 'acao', 'Execucao', 'execucao', 'solucao', 'inspecao', 'variaveis', 'protecao'],
    phrases: ['falhou abrir', 'falhou salvar', 'nao attempted', 'Vai nao']
  },
  id: {
    words: [],
    phrases: ['Buat a launcher', 'Workspace Mode', 'ini plugin', 'ke simpan']
  },
  tr: {
    words: ['Ac', 'ac', 'Basarisiz', 'basarisiz', 'calisma', 'Calisma', 'Baglan', 'baglan', 'gunluk', 'surum', 'varsayilan', 'saglayici', 'guvenilir', 'Yapilamiyor', 'Olustur', 'Olusturuluyor', 'Guncelle', 'Hazir', 'klasor', 'gorev', 'istem', 'Calistir', 'Secildi', 'icin'],
    phrases: ['kaydet surumler', 'yayinla bu plugin', 'yayınla bu plugin', 'load betikler']
  },
  it: {
    words: [],
    phrases: ['Crea a launcher', 'Non riuscito apri', 'Impossibile apri']
  },
  vi: {
    words: [],
    phrases: [
      'Cai dat',
      'Khong the',
      'khong the',
      'khong gian lam viec',
      'duong dan',
      'tuyet doi',
      'thu muc',
      'phien ban',
      'ung dung',
      'Tao ung dung',
      'Che do',
      'Ket noi',
      'Tai xuong',
      'tai xuong',
      'Dang tao',
      'Dang tai',
      'That bai',
      'that bai',
      'nhat ky',
      'Cac peer',
      'Nhap prompt',
      'xay dung app',
      'cong cu coding',
      'mang cuc bo'
    ]
  }
}
const NON_LATIN_ALLOWED_TOKENS = new Set([
  'AI',
  'API',
  'ANSI',
  'ASCII',
  'A-Z',
  'Backups',
  'Caddy',
  'CLI',
  'Cloudflare',
  'Codex',
  'Claude',
  'ComfyUI',
  'CPU',
  'CUDA',
  'DNS',
  'Discord',
  'ENV',
  'ENVIRONMENT',
  'Esc',
  'EventSource',
  'Face',
  'Gemini',
  'Git',
  'GitHub',
  'HEAD',
  'HTTP',
  'HTTPS',
  'Hugging',
  'ID',
  'JSON',
  'LAN',
  'LM',
  'Markdown',
  'Monospace',
  'Network',
  'Node',
  'Node.js',
  'OAuth',
  'Ollama',
  'OpenAI',
  'PATH',
  'PINOKIO_HOME',
  'Pinokio',
  'Pinokio.dev',
  'PowerShell',
  'Python',
  'RAM',
  'README.md',
  'Registry',
  'SKILL',
  'SKILL.md',
  'SSH',
  'SSL',
  'Studio',
  'TODO',
  'Tunnel',
  'UI',
  'URL',
  'VRAM',
  'X',
  'X-ray',
  'X.com',
  'YAML',
  'YOLO',
  'ZIP',
  'app.json',
  'auth',
  'bash',
  'bin',
  'brew',
  'checkpoint',
  'cmd',
  'commit',
  'conda',
  'create-react-app',
  'cwd',
  'diff',
  'exFAT',
  'fa-solid',
  'filepond--label-action',
  'gepeto',
  'git',
  'iframe',
  'init',
  'install',
  'live',
  'llama.cpp',
  'localhost',
  'my',
  'my-cli-tool',
  'my-launcher',
  'my-project',
  'node',
  'npm',
  'npx',
  'pinokio',
  'pinokio.co',
  'pinokio.js',
  'pinokiofs',
  'pre',
  'pterm',
  'push',
  'python3',
  'ref',
  'shell',
  'shell.run',
  'start',
  'state',
  'true',
  'uv',
  'venv',
  'zip',
  'zsh'
])

const errors = []
const codes = locales.map((locale) => locale.code)
const codeSet = new Set(codes)
const enabledLocales = locales.filter((locale) => locale && locale.enabled === true)
const validationLocales = INCLUDE_DRAFTS ? locales : enabledLocales
const validationCodes = validationLocales.map((locale) => locale.code)

if (!catalogs.en || typeof catalogs.en !== 'object') {
  errors.push('catalogs.json must include an en catalog')
}

if (!enabledLocales.some((locale) => locale.code === 'en')) {
  errors.push('English must be enabled as the source locale')
}

for (const locale of locales) {
  if (!locale || typeof locale !== 'object') {
    errors.push('Each locales.json entry must be an object')
    continue
  }
  if (!locale.code || typeof locale.code !== 'string') {
    errors.push('Each locales.json entry must include a string code')
    continue
  }
  if (typeof locale.enabled !== 'boolean') {
    errors.push(`${locale.code} must declare enabled: true or enabled: false`)
  }
  if (locale.enabled === true && locale.quality !== 'production') {
    errors.push(`${locale.code} is enabled but quality is not "production"`)
  }
  if (locale.enabled === false && locale.quality !== 'draft') {
    errors.push(`${locale.code} is disabled but quality is not "draft"`)
  }
}

const englishKeys = catalogs.en ? Object.keys(catalogs.en).sort() : []
const englishKeySet = new Set(englishKeys)
const englishKeyPrefixes = new Set(englishKeys.map((key) => key.split('.')[0]))

function placeholders(value) {
  return (value.match(PLACEHOLDER_RE) || []).sort().join(',')
}

function strippedForEnglishLint(value) {
  return value
    .replace(PLACEHOLDER_RE, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[A-Za-z]:\\[^\s,)]+/g, '')
    .replace(/~?\/[A-Za-z0-9._~/-]+/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(ALLOWED_LITERAL_RE, '')
}

function strippedForNonLatinMixedLint(value) {
  return value
    .replace(PLACEHOLDER_RE, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[A-Za-z]:\\[^\s,)]+/g, '')
    .replace(/~?\/[A-Za-z0-9._~/-]+/g, '')
    .replace(/<code>[^<]*<\/code>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/Pinokio Network/g, '')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function containsIsolatedWord(value, word) {
  return new RegExp(`(^|[^\\p{L}])${escapeRegExp(word)}($|[^\\p{L}])`, 'iu').test(value)
}

function containsLiteralPhrase(value, phrase) {
  return new RegExp(`(^|[^\\p{L}])${escapeRegExp(phrase)}($|[^\\p{L}])`, 'iu').test(value)
}

function strippedForCjkSpacingLint(value) {
  return value
    .replace(PLACEHOLDER_RE, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[A-Za-z]:\\[^\s,)]+/g, '')
    .replace(/~?\/[A-Za-z0-9._~/-]+/g, '')
    .replace(/<code>[^<]*<\/code>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/`[^`]+`/g, '')
}

function disallowedNonLatinTokens(value) {
  const scrubbed = strippedForNonLatinMixedLint(value)
  const words = scrubbed.match(/[A-Za-z][A-Za-z0-9_.-]*/g) || []
  return Array.from(new Set(words
    .map((word) => word.replace(/^[.:-]+|[.:-]+$/g, ''))
    .filter(Boolean)
    .filter((word) => !NON_LATIN_ALLOWED_TOKENS.has(word))
    .filter((word) => !/^(d|g|mo|w|y)$/.test(word))
    .filter((word) => !/^(fa-|filepond)/.test(word))
  ))
}

function isAllowedUntranslatedValue(value) {
  const trimmed = value.trim()
  if (!trimmed) {
    return true
  }
  if (ALLOWED_LITERAL_VALUES.has(trimmed)) {
    return true
  }
  if (/^\{[a-zA-Z0-9_]+\}$/.test(trimmed)) {
    return true
  }
  if (/^https?:\/\//.test(trimmed)) {
    return true
  }
  if (/^~?\//.test(trimmed)) {
    return true
  }
  return false
}

function validateQuality(code, key, value, englishValue) {
  if (code === 'en') {
    if (BAD_ENGLISH_SOURCE_VALUES.has(value)) {
      errors.push(`en.${key} is a bad translation source: "${value}"`)
    }
    return
  }

  if (RAW_KEY_VALUE_RE.test(value)) {
      errors.push(`${code}.${key} looks like a raw catalog key: ${JSON.stringify(value)}`)
  }

  if (value === englishValue && /[A-Za-z]/.test(value) && !isAllowedUntranslatedValue(value)) {
    errors.push(`${code}.${key} is unchanged English: ${JSON.stringify(value)}`)
  }

  const scrubbed = strippedForEnglishLint(value)
  if (ENGLISH_LEFTOVER_RE.test(scrubbed)) {
    errors.push(`${code}.${key} contains likely English carryover: ${JSON.stringify(value)}`)
  }

  if (NON_LATIN_MIXED_LOCALES.has(code)) {
    const tokens = disallowedNonLatinTokens(value)
    if (tokens.length > 0) {
      errors.push(`${code}.${key} contains untranslated English token(s): ${tokens.join(', ')} in ${JSON.stringify(value)}`)
    }
  }

  if (CJK_NO_SPACED_WORD_LOCALES.has(code) && CJK_SPACED_WORD_RE.test(strippedForCjkSpacingLint(value))) {
    errors.push(`${code}.${key} appears to contain spaced CJK word fragments: ${JSON.stringify(value)}`)
  }

  const transliterationRules = LATIN_TRANSLITERATION_RULES[code]
  if (transliterationRules) {
    const badWord = transliterationRules.words.find((word) => containsIsolatedWord(value, word))
    const badPhrase = transliterationRules.phrases.find((phrase) => containsLiteralPhrase(value, phrase))
    if (badWord || badPhrase) {
      errors.push(`${code}.${key} appears to contain accentless or literal word-by-word UI text: ${JSON.stringify(value)}`)
    }
  }
}

for (const code of codes) {
  const styleguidePath = path.join(STYLEGUIDE_DIR, `${code}.md`)
  if (!fs.existsSync(styleguidePath)) {
    errors.push(`Missing style guide for ${code}: server/locales/styleguides/${code}.md`)
    continue
  }
  if (!fs.statSync(styleguidePath).isFile()) {
    errors.push(`Style guide for ${code} must be a file: server/locales/styleguides/${code}.md`)
    continue
  }
  if (fs.readFileSync(styleguidePath, 'utf8').trim().length === 0) {
    errors.push(`Style guide for ${code} is empty: server/locales/styleguides/${code}.md`)
  }
}

for (const code of validationCodes) {
  if (!catalogs[code] || typeof catalogs[code] !== 'object') {
    errors.push(`Missing catalog for ${code}`)
    continue
  }

  const catalog = catalogs[code]
  const keys = Object.keys(catalog).sort()
  const keySet = new Set(keys)

  for (const key of englishKeys) {
    if (!keySet.has(key)) {
      errors.push(`${code} missing key ${key}`)
    }
  }

  for (const key of keys) {
    if (!englishKeySet.has(key)) {
      errors.push(`${code} has extra key ${key}`)
    }
  }

  for (const key of englishKeys) {
    if (!Object.prototype.hasOwnProperty.call(catalog, key)) {
      continue
    }
    if (typeof catalog[key] !== 'string') {
      errors.push(`${code}.${key} must be a string`)
      continue
    }
    const expected = placeholders(catalogs.en[key])
    const actual = placeholders(catalog[key])
    if (expected !== actual) {
      errors.push(`${code}.${key} placeholder mismatch: expected ${expected || '(none)'}, got ${actual || '(none)'}`)
      continue
    }

    validateQuality(code, key, catalog[key], catalogs.en[key])

    const localeRules = LOCALE_LINT_RULES[code] || []
    for (const rule of localeRules) {
      if (rule.test(key, catalog[key])) {
        errors.push(rule.message(key, catalog[key]))
      }
    }
  }
}

for (const code of Object.keys(catalogs)) {
  if (!codeSet.has(code)) {
    errors.push(`Catalog ${code} is not declared in locales.json`)
  }
}

function collectSourceFiles(targetPath, files = []) {
  if (!fs.existsSync(targetPath)) {
    return files
  }
  const stat = fs.statSync(targetPath)
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
      if (entry.isDirectory() && SOURCE_SKIP_DIRS.has(entry.name)) {
        continue
      }
      collectSourceFiles(path.join(targetPath, entry.name), files)
    }
    return files
  }
  if (!/\.(ejs|js)$/.test(targetPath)) {
    return files
  }
  const basename = path.basename(targetPath)
  if (/\.min\.js$/.test(basename) || SOURCE_SKIP_FILES.has(basename)) {
    return files
  }
  files.push(targetPath)
  return files
}

function recordReference(referencedKeys, key, sourceFile) {
  if (!key || !key.includes('.')) {
    return
  }
  if (!englishKeyPrefixes.has(key.split('.')[0])) {
    return
  }
  if (!referencedKeys.has(key)) {
    referencedKeys.set(key, new Set())
  }
  referencedKeys.get(key).add(path.relative(path.resolve(__dirname, '..'), sourceFile))
}

const sourceFiles = SOURCE_SCAN_ROOTS.flatMap((root) => collectSourceFiles(root))
const referencedKeys = new Map()
let sourceUsesTrj = false
for (const sourceFile of sourceFiles) {
  const source = fs.readFileSync(sourceFile, 'utf8')
  if (sourceFile.endsWith('.ejs')) {
    let catalogScriptMatch
    while ((catalogScriptMatch = CATALOG_BOOTSTRAP_SCRIPT_RE.exec(source)) !== null) {
      const scriptSrc = catalogScriptMatch[1]
      if (!SCRIPTS_REQUIRING_PRESEEDED_CATALOG.has(scriptSrc)) {
        continue
      }
      const beforeScript = source.slice(0, catalogScriptMatch.index)
      if (!/\bwindow\.PINOKIO_I18N\s*=/.test(beforeScript)) {
        errors.push(`${path.relative(path.resolve(__dirname, '..'), sourceFile)} includes ${scriptSrc} without initializing window.PINOKIO_I18N first`)
      }
    }
  }
  if (/\btrj\(\s*["']/.test(source)) {
    sourceUsesTrj = true
  }

  for (const pattern of SOURCE_KEY_PATTERNS) {
    let match
    while ((match = pattern.exec(source)) !== null) {
      recordReference(referencedKeys, match[1], sourceFile)
    }
  }

  let callMatch
  while ((callMatch = TRANSLATION_CALL_RE.exec(source)) !== null) {
    let keyMatch
    while ((keyMatch = QUOTED_KEY_RE.exec(callMatch[1])) !== null) {
      recordReference(referencedKeys, keyMatch[1], sourceFile)
    }
  }
}

if (sourceUsesTrj) {
  const serverIndexPath = path.resolve(__dirname, '../server/index.js')
  const serverIndexSource = fs.readFileSync(serverIndexPath, 'utf8')
  if (!/\bres\.locals\.trj\s*=/.test(serverIndexSource)) {
    errors.push('Source uses trj(...) but server/index.js does not expose res.locals.trj')
  }
}

for (const [key, files] of Array.from(referencedKeys.entries()).sort(([a], [b]) => a.localeCompare(b))) {
  if (!englishKeySet.has(key)) {
    errors.push(`Source references missing key ${key} in ${Array.from(files).join(', ')}`)
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exit(1)
}

const skippedDraftCount = codes.length - validationCodes.length
const draftNote = skippedDraftCount > 0 && !INCLUDE_DRAFTS
  ? `, ${skippedDraftCount} draft locales skipped`
  : ''
console.log(`i18n catalogs valid (${validationCodes.length} validated locales${draftNote}, ${englishKeys.length} keys, ${referencedKeys.size} referenced keys)`)
