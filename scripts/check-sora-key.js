const fs = require('fs')
const path = require('path')

function parseDotEnv(filePath) {
  const content = fs.readFileSync(filePath, 'utf8')
  const lines = content.split(/\r?\n/)
  const env = {}
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    let val = trimmed.slice(idx + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    env[key] = val
  }
  return env
}

const envPath = path.join(__dirname, '..', '.env')
if (!fs.existsSync(envPath)) {
  console.error('.env file not found at', envPath)
  process.exit(2)
}

const env = parseDotEnv(envPath)
const key = env.SORA2_API_KEY || env.SORA_API_KEY || env.SORA_KEY
if (!key) {
  console.log('No Sora API key found in .env (SORA2_API_KEY, SORA_API_KEY or SORA_KEY)')
  process.exit(0)
}

// Mask key for safety in logs
const masked = key.length > 10 ? `${key.slice(0,6)}...${key.slice(-4)}` : key
console.log('Sora key found:', masked)

// Note: This script does NOT attempt to call external Sora endpoints.
// To actually test video generation, either provide SORA_API_BASE_URL in .env
// or run a small test against the Sora API with a known endpoint.

// Provide instructions for manual test
console.log('\nTo test generation:')
console.log('1) Ensure backend is running: npm run dev (in backend)')
console.log("2) If the app has a Sora integration endpoint, call it; otherwise request me to implement a small test that will POST a minimal job to the Sora API.")

process.exit(0)
