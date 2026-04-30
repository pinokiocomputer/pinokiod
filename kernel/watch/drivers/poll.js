function poll(interval, callback, options = {}) {
  const delay = Math.max(100, Number(interval || options.interval || 1000))
  let stopped = false
  let running = false

  const tick = async () => {
    if (stopped || running) return
    running = true
    try {
      await callback()
    } catch (error) {
      if (typeof options.onError === "function") {
        options.onError(error)
      }
    } finally {
      running = false
    }
  }

  if (options.immediate !== false) {
    setTimeout(tick, 0)
  }
  const timer = setInterval(tick, delay)

  return async () => {
    stopped = true
    clearInterval(timer)
  }
}

module.exports = {
  poll
}
