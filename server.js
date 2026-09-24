const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./src/config');
const { detectPlatform, PLATFORMS } = require('./src/platforms');
const ytdlp = require('./src/ytdlp');
const jobs = require('./src/jobs');
const auth = require('./src/auth');

const app = express();
app.set('trust proxy', 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: null, // keep plain-HTTP LAN access working
      },
    },
    strictTransportSecurity: false, // set HSTS at your HTTPS reverse proxy instead
    referrerPolicy: { policy: 'no-referrer' }, // lets remote thumbnails load without hotlink blocks
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
app.use(express.json({ limit: '10kb' }));
// CORS: lets the standalone video-downloader.html (opened from disk, Origin "null") and
// localhost pages call the API. Add more origins with CORS_ORIGINS=https://a.com,https://b.com
const extraOrigins = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use('/api', (req, res, next) => {
  const o = req.headers.origin;
  if (o && (o === 'null' || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o) || extraOrigins.includes(o))) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.use(
  '/api',
  rateLimit({ windowMs: 60_000, limit: config.rateLimitPerMinute, standardHeaders: true, legacyHeaders: false })
);

const badRequest = (res, msg, status = 400) => res.status(status).json({ error: msg });

// PIN protection (only active when APP_PIN is set)
app.use('/api', (req, res, next) => {
  if (!auth.enabled) return next();
  if (req.path === '/login' || req.path === '/auth') return next();
  const m = req.method === 'GET' && req.path.match(/^\/jobs\/([^/]+)\/file$/);
  if (m) {
    const t = auth.verify(String(req.query.ticket || ''), 't');
    if (t && t.j === m[1]) return next();
  } else if (auth.verify(auth.bearer(req), 's')) {
    return next();
  }
  res.status(401).json({ error: 'Login required', code: 'auth' });
});

app.get('/api/auth', (req, res) => {
  res.json({ required: auth.enabled, authenticated: !auth.enabled || Boolean(auth.verify(auth.bearer(req), 's')) });
});

app.post('/api/login', (req, res) => {
  if (!auth.enabled) return res.json({ token: '' });
  const wait = auth.lockRemaining(req.ip);
  if (wait > 0) return badRequest(res, `Too many attempts. Try again in ${Math.ceil(wait / 60000)} min`, 429);
  const pin = String((req.body && req.body.pin) || '');
  if (!pin || pin.length > 64 || !auth.pinOk(pin)) {
    auth.recordFailure(req.ip);
    return badRequest(res, 'Wrong PIN', 401);
  }
  auth.clearFailures(req.ip);
  res.json({ token: auth.issueSession() });
});

const QUALITY_RE = /^(audio|best|\d{3,4})$/;

app.get('/api/health', async (_req, res) => {
  res.json({ ok: true, ytdlp: await ytdlp.version(), platforms: PLATFORMS.map((p) => p.name) });
});

app.post('/api/detect', (req, res) => {
  const d = detectPlatform(req.body && req.body.url);
  if (!d) return badRequest(res, 'Unsupported or invalid URL');
  res.json({ platform: d.platform });
});

app.post('/api/info', async (req, res) => {
  const d = detectPlatform(req.body && req.body.url);
  if (!d) return badRequest(res, 'Unsupported or invalid URL. Supported: ' + PLATFORMS.map((p) => p.name).join(', '));
  try {
    const info = await ytdlp.getInfo(d.url);
    const s = ytdlp.summarize(info);
    if (s.isLive) return badRequest(res, 'Live streams are not supported');
    if (s.duration && s.duration > config.maxDurationSeconds) {
      return badRequest(res, `Video is longer than the ${Math.round(config.maxDurationSeconds / 60)} minute limit`);
    }
    res.json({ url: d.url, platform: d.platform, ...s });
  } catch (e) {
    badRequest(res, e.message, 422);
  }
});

app.post('/api/jobs', (req, res) => {
  const d = detectPlatform(req.body && req.body.url);
  const quality = String((req.body && req.body.quality) || 'best');
  if (!d) return badRequest(res, 'Unsupported or invalid URL');
  if (!QUALITY_RE.test(quality) || (/^\d+$/.test(quality) && Number(quality) > 4320)) {
    return badRequest(res, 'Invalid quality');
  }
  try {
    const job = jobs.createJob({ url: d.url, quality });
    res.status(202).json({ id: job.id });
  } catch (e) {
    badRequest(res, e.message, e.status || 500);
  }
});

app.get('/api/jobs/:id', (req, res) => {
  const j = jobs.getJob(req.params.id);
  if (!j) return badRequest(res, 'Job not found or expired', 404);
  res.json({ status: j.status, progress: j.progress, error: j.error, filename: j.filename });
});

app.post('/api/jobs/:id/ticket', (req, res) => {
  const j = jobs.getJob(req.params.id);
  if (!j || j.status !== 'done') return badRequest(res, 'File not ready or expired', 404);
  res.json({ ticket: auth.issueTicket(req.params.id) });
});

app.get('/api/jobs/:id/file', (req, res) => {
  const j = jobs.getJob(req.params.id);
  if (!j || j.status !== 'done') return badRequest(res, 'File not ready or expired', 404);
  res.download(j.file, j.filename);
});

app.delete('/api/jobs/:id', (req, res) => {
  jobs.removeJob(req.params.id);
  res.status(204).end();
});

// ---- Admin: cookie upload ----
const os = require('node:os');
const fs = require('node:fs');
const COOKIE_PATH = require('node:path').join(os.tmpdir(), 'yt-dlp-cookies.txt');

app.post('/api/admin/cookies', (req, res) => {
  const b64 = req.body && req.body.cookies;
  if (!b64 || typeof b64 !== 'string') return badRequest(res, 'Missing cookies field');
  try {
    fs.writeFileSync(COOKIE_PATH, Buffer.from(b64, 'base64'));
    config.cookiesFile = COOKIE_PATH;
    res.json({ ok: true });
  } catch (e) {
    badRequest(res, 'Failed to save cookies: ' + e.message, 500);
  }
});

app.delete('/api/admin/cookies', (req, res) => {
  try {
    if (fs.existsSync(COOKIE_PATH)) fs.unlinkSync(COOKIE_PATH);
    config.cookiesFile = '';
    res.json({ ok: true });
  } catch (e) {
    badRequest(res, 'Failed to clear cookies: ' + e.message, 500);
  }
});


app.use('/api', (_req, res) => badRequest(res, 'Not found', 404));

const server = app.listen(config.port, async () => {
  const v = await ytdlp.version();
  console.log(`Video Downloader listening on http://localhost:${config.port}`);
  if (v) console.log(`yt-dlp version: ${v}`);
  else console.warn('WARNING: yt-dlp was not found. Install it (see README) or set YTDLP_PATH.');
  if (!auth.enabled) console.warn('NOTE: no APP_PIN set, so anyone who can reach this server can use it. Set APP_PIN in .env if it is exposed to the internet.');
  else if (config.appPin.length < 6) console.warn('WARNING: APP_PIN is shorter than 6 characters. Use 6+ digits.');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    jobs.cleanupAll();
    server.close(() => process.exit(0));
  });
}

module.exports = app;
