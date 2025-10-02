const path = require('path')
const Kernel = require('../kernel')

async function main() {
  const mode = process.env.PINOKIO_SETUP_MODE || 'prod_dev'
  const home = process.env.PINOKIO_HOME || path.resolve(process.cwd(), '.pinokio')

  console.log(`[seed] mode=${mode} home=${home}`)

  const kernel = new Kernel({ store: {} })
  await kernel.init({})
  await kernel.shell.init()
  await kernel.bin.init()
  await kernel.bin.refreshInstalled()

  if (kernel.refresh_interval) {
    clearInterval(kernel.refresh_interval)
  }
  kernel.server_running = true

  await kernel.bin.check({ bin: kernel.bin.preset(mode) })
  await kernel.bin.install({ mode }, () => {})
  if (kernel.refresh_interval) {
    clearInterval(kernel.refresh_interval)
  }
  console.log('[seed] completed')
  process.exit(0)
}

main().catch((error) => {
  console.error('[seed] failed', error)
  process.exit(1)
})
