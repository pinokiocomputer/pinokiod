const path = require("path")

const filterSelectors = (preferred) => {
  if (Array.isArray(preferred)) {
    return preferred.filter((value) => typeof value === "string" && value.trim().length > 0)
  }
  if (typeof preferred === "string" && preferred.trim().length > 0) {
    return [preferred]
  }
  return []
}

const appendInputValue = (input, key, value) => {
  if (Object.prototype.hasOwnProperty.call(input, key)) {
    if (Array.isArray(input[key])) {
      input[key].push(value)
    } else {
      input[key] = [input[key], value]
    }
  } else {
    input[key] = value
  }
}

const menuTarget = (item) => {
  if (!item || typeof item.href !== "string") {
    return null
  }
  let href = item.href.trim()
  if (!href) {
    return null
  }
  let queryIndex = href.indexOf("?")
  let uri = queryIndex >= 0 ? href.slice(0, queryIndex) : href
  let searchParams = new URLSearchParams(queryIndex >= 0 ? href.slice(queryIndex + 1) : "")
  if (item.params && typeof item.params === "object") {
    for (let [key, rawValue] of Object.entries(item.params)) {
      if (Array.isArray(rawValue)) {
        for (let value of rawValue) {
          searchParams.append(key, String(value))
        }
      } else if (typeof rawValue !== "undefined") {
        searchParams.append(key, String(rawValue))
      }
    }
  }
  let input = {}
  for (let [key, value] of searchParams.entries()) {
    appendInputValue(input, key, value)
  }
  return {
    uri,
    href: searchParams.toString() ? `${uri}?${searchParams.toString()}` : uri,
    input,
  }
}

const selectorMatches = (selector, target) => {
  if (typeof selector !== "string" || !target) {
    return false
  }
  let candidate = selector.trim()
  if (!candidate) {
    return false
  }
  let queryIndex = candidate.indexOf("?")
  let candidateUri = queryIndex >= 0 ? candidate.slice(0, queryIndex) : candidate
  if (candidateUri !== target.uri) {
    return false
  }
  if (queryIndex === -1) {
    return Object.keys(target.input).length === 0
  }
  let selectorParams = new URLSearchParams(candidate.slice(queryIndex + 1))
  for (let key of new Set(selectorParams.keys())) {
    if (!Object.prototype.hasOwnProperty.call(target.input, key)) {
      return false
    }
    let expected = selectorParams.getAll(key)
    let actual = Array.isArray(target.input[key]) ? target.input[key] : [target.input[key]]
    if (expected.length !== actual.length) {
      return false
    }
    for (let i = 0; i < expected.length; i++) {
      if (expected[i] !== actual[i]) {
        return false
      }
    }
  }
  return true
}

const loadMenu = async (api, repoPath) => {
  let launcher = await api.launcher({
    path: repoPath
  })
  let config = launcher.script
  if (!config || !config.menu) {
    return []
  }
  if (typeof config.menu === "function") {
    if (config.menu.constructor.name === "AsyncFunction") {
      config.menu = await config.menu(api.kernel, api.kernel.info)
    } else {
      config.menu = config.menu(api.kernel, api.kernel.info)
    }
  }
  return Array.isArray(config.menu) ? config.menu : []
}

module.exports = async (api, repoPath, preferred = []) => {
  let defaultTarget = await api.get_default(repoPath)
  if (defaultTarget) {
    return {
      uri: defaultTarget
    }
  }
  let selectors = filterSelectors(preferred)
  if (selectors.length === 0) {
    return undefined
  }
  let stack = [...(await loadMenu(api, repoPath))]
  while (stack.length > 0) {
    let item = stack.shift()
    if (!item || typeof item !== "object") {
      continue
    }
    if (Array.isArray(item.menu)) {
      stack.unshift(...item.menu)
    }
    let target = menuTarget(item)
    if (!target) {
      continue
    }
    for (let selector of selectors) {
      if (!selectorMatches(selector, target)) {
        continue
      }
      if (target.uri.startsWith("http")) {
        return {
          uri: target.href
        }
      }
      return {
        uri: path.resolve(repoPath, target.uri),
        input: Object.keys(target.input).length > 0 ? target.input : undefined
      }
    }
  }
}
