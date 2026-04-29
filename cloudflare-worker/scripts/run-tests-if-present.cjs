const { existsSync, readdirSync, statSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const { join } = require('node:path')

if (!existsSync('test')) {
  console.log('No worker tests found')
  process.exit(0)
}

function findTestFiles(directory) {
  return readdirSync(directory).flatMap(entry => {
    const path = join(directory, entry)
    const stat = statSync(path)

    if (stat.isDirectory()) {
      return findTestFiles(path)
    }

    return /\.(cjs|mjs|js)$/.test(entry) ? [path] : []
  })
}

const testFiles = findTestFiles('test')

if (testFiles.length === 0) {
  console.log('No worker test files found')
  process.exit(0)
}

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  stdio: 'inherit',
})

if (result.error) {
  throw result.error
}

process.exit(result.status ?? 1)
