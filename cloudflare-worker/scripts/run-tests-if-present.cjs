const { existsSync } = require('node:fs')
const { spawnSync } = require('node:child_process')

if (!existsSync('test')) {
  console.log('No worker tests found')
  process.exit(0)
}

const result = spawnSync(process.execPath, ['--test', 'test'], {
  stdio: 'inherit',
})

if (result.error) {
  throw result.error
}

process.exit(result.status ?? 1)
