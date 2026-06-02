// Clean environment wrapper for electron-vite
// Removes VSCode/Trae IDE Electron environment variables that interfere with
// our Electron app's main process initialization
const { spawn } = require('child_process')

const CLEAN_VARS = [
  'ELECTRON_RUN_AS_NODE',
  'VSCODE_RUN_IN_ELECTRON',
  'ELECTRON_FORCE_IS_PACKAGED',
  'ICUBE_IS_ELECTRON',
  'ICUBE_ELECTRON_PATH'
]

// Clean environment
const env = { ...process.env }
for (const v of CLEAN_VARS) {
  delete env[v]
}

const args = process.argv.slice(2)
const cmd = args[0]
const cmdArgs = args.slice(1)

if (!cmd) {
  console.error('Usage: node scripts/clean-env.js <command> [args...]')
  process.exit(1)
}

const fullCmd = [cmd, ...cmdArgs].join(' ')
console.log(`[clean-env] Running: ${fullCmd}`)

const child = spawn(fullCmd, {
  stdio: 'inherit',
  env,
  shell: true
})

child.on('close', (code) => {
  process.exit(code || 0)
})

child.on('error', (err) => {
  console.error(`[clean-env] Failed: ${err.message}`)
  process.exit(1)
})
