const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

// Minimal .env loader (no extra dependency)
try {
  const envFile = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  }
} catch { /* ignore */ }

const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);

// If YTDLP_COOKIES_BASE64 is set, decode it to a temp file for use on cloud platforms
// that have no persistent disk (e.g. Render free tier).
let resolvedCookiesFile = process.env.YTDLP_COOKIES_FILE || '';
if (!resolvedCookiesFile && process.env.YTDLP_COOKIES_BASE64) {
  try {
    const cookiesPath = path.join(os.tmpdir(), 'yt-dlp-cookies.txt');
    fs.writeFileSync(cookiesPath, Buffer.from(process.env.YTDLP_COOKIES_BASE64, 'base64'));
    resolvedCookiesFile = cookiesPath;
    console.log('Cookies loaded from YTDLP_COOKIES_BASE64 env var');
  } catch (e) {
    console.warn('Failed to decode YTDLP_COOKIES_BASE64:', e.message);
  }
}

module.exports = {
  port: int(process.env.PORT, 3000),
  appPin: (process.env.APP_PIN || '').trim(),
  ytdlpPath: process.env.YTDLP_PATH || 'yt-dlp',
  cookiesFile: resolvedCookiesFile,
  maxConcurrentJobs: int(process.env.MAX_CONCURRENT_JOBS, 2),
  maxDurationSeconds: int(process.env.MAX_DURATION_SECONDS, 3600),
  maxFilesize: process.env.MAX_FILESIZE || '500M',
  jobTtlMs: int(process.env.JOB_TTL_MINUTES, 10) * 60 * 1000,
  rateLimitPerMinute: int(process.env.RATE_LIMIT_PER_MINUTE, 30),
  tmpRoot: path.join(os.tmpdir(), 'video-downloader'),
};
