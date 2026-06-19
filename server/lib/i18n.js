const catalogs = require('../locales/catalogs.json')
const locales = require('../locales/locales.json')

const DEFAULT_LOCALE = 'en'
const AUTO_LOCALE = 'auto'
const ENABLED_LOCALES = locales.filter((locale) => locale && locale.enabled === true)
const ENABLED_LOCALE_CODES = new Set(ENABLED_LOCALES.map((locale) => locale.code))
const TARGET_LOCALE_CODES = new Set(locales.map((locale) => locale.code))

const LANGUAGE_ALIASES = {
  pt: 'pt-BR',
  zh: 'zh-CN'
}

function normalizeLocaleCode(value) {
  if (typeof value !== 'string') {
    return ''
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }
  const parts = trimmed.replace(/_/g, '-').split('-').filter(Boolean)
  if (parts.length === 0) {
    return ''
  }
  return parts.map((part, index) => {
    if (index === 0) {
      return part.toLowerCase()
    }
    if (part.length === 2 || part.length === 3) {
      return part.toUpperCase()
    }
    return part[0].toUpperCase() + part.slice(1).toLowerCase()
  }).join('-')
}

function matchSupportedLocale(value) {
  const normalized = normalizeLocaleCode(value)
  if (!normalized) {
    return null
  }
  if (ENABLED_LOCALE_CODES.has(normalized)) {
    return normalized
  }

  const lower = normalized.toLowerCase()
  if (lower === 'zh-hant' || lower.startsWith('zh-hant-') || lower === 'zh-hk' || lower === 'zh-mo') {
    return 'zh-TW'
  }
  if (lower === 'zh-hans' || lower.startsWith('zh-hans-')) {
    return 'zh-CN'
  }

  const language = lower.split('-')[0]
  if (ENABLED_LOCALE_CODES.has(language)) {
    return language
  }
  const alias = LANGUAGE_ALIASES[language] || null
  return alias && ENABLED_LOCALE_CODES.has(alias) ? alias : null
}

function normalizePreference(value) {
  if (value === AUTO_LOCALE) {
    return AUTO_LOCALE
  }
  return matchSupportedLocale(value) || AUTO_LOCALE
}

function parseAcceptLanguage(header) {
  if (typeof header !== 'string' || !header.trim()) {
    return []
  }
  return header.split(',').map((entry, index) => {
    const [tag, ...params] = entry.trim().split(';')
    const qualityParam = params.find((param) => param.trim().startsWith('q='))
    const quality = qualityParam ? Number.parseFloat(qualityParam.trim().slice(2)) : 1
    return {
      tag,
      quality: Number.isFinite(quality) ? quality : 0,
      index
    }
  }).filter((entry) => entry.tag && entry.quality > 0)
    .sort((a, b) => {
      if (b.quality !== a.quality) {
        return b.quality - a.quality
      }
      return a.index - b.index
    })
}

function resolveLocale({ preference = AUTO_LOCALE, acceptLanguage = '' } = {}) {
  const normalizedPreference = normalizePreference(preference)
  if (normalizedPreference !== AUTO_LOCALE) {
    return normalizedPreference
  }

  for (const entry of parseAcceptLanguage(acceptLanguage)) {
    const matched = matchSupportedLocale(entry.tag)
    if (matched) {
      return matched
    }
  }

  return DEFAULT_LOCALE
}

function translate(locale, key, replacements = {}) {
  const matched = matchSupportedLocale(locale) || DEFAULT_LOCALE
  const catalog = catalogs[matched] || {}
  let value = catalog[key]
  if (typeof value !== 'string') {
    value = `[missing translation: ${matched}.${key}]`
  }
  if (value && replacements && typeof replacements === 'object') {
    for (const [name, replacement] of Object.entries(replacements)) {
      value = value.replace(new RegExp(`\\{${name}\\}`, 'g'), String(replacement))
    }
  }
  return value
}

function getCatalog(locale) {
  const matched = matchSupportedLocale(locale) || DEFAULT_LOCALE
  return Object.assign({}, catalogs[matched] || {})
}

function isSupportedPreference(value) {
  const normalized = normalizeLocaleCode(value)
  return value === AUTO_LOCALE || !!matchSupportedLocale(value) || TARGET_LOCALE_CODES.has(normalized)
}

module.exports = {
  AUTO_LOCALE,
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES: ENABLED_LOCALES,
  TARGET_LOCALES: locales,
  TARGET_LOCALE_CODES,
  isSupportedPreference,
  matchSupportedLocale,
  normalizePreference,
  resolveLocale,
  getCatalog,
  t: translate
}
