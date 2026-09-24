// Optional PIN protection. Enabled when APP_PIN is set.
// Login returns a signed, expiring token (sent as "Authorization: Bearer ...").
// File downloads use a short-lived, per-job ticket, so the long-lived token never appears in URLs.
const crypto = require('node:crypto');
const config = require('./config');

const secret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const enabled = Boolean(config.appPin);

const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const TICKET_MS = 60 * 1000;
const MAX_FAILS_PER_IP = 5;
const LOCK_MS = 15 * 60 * 1000;
const GLOBAL_WINDOW_MS = 60 * 60 * 1000;
const MAX_GLOBAL_FAILS = 30;

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

function pinOk(pin) {
  return crypto.timingSafeEqual(sha(pin), sha(config.appPin));
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

/** Returns the payload if the token is valid, unexpired and of the given kind ('s' session, 't' ticket). */
function verify(token, kind) {
  if (typeof token !== 'string' || token.length > 1024) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (p.k !== kind || typeof p.exp !== 'number' || p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

const issueSession = () => sign({ k: 's', exp: Date.now() + SESSION_MS });
const issueTicket = (jobId) => sign({ k: 't', j: jobId, exp: Date.now() + TICKET_MS });

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

// --- brute-force protection ---
const perIp = new Map(); // ip -> { fails, lockUntil }
let globalFails = []; // timestamps

function lockRemaining(ip) {
  const now = Date.now();
  globalFails = globalFails.filter((t) => now - t < GLOBAL_WINDOW_MS);
  if (globalFails.length >= MAX_GLOBAL_FAILS) return GLOBAL_WINDOW_MS - (now - globalFails[0]);
  const e = perIp.get(ip);
  return e && e.lockUntil > now ? e.lockUntil - now : 0;
}

function recordFailure(ip) {
  const now = Date.now();
  globalFails.push(now);
  const e = perIp.get(ip) || { fails: 0, lockUntil: 0 };
  e.fails += 1;
  if (e.fails >= MAX_FAILS_PER_IP) {
    e.lockUntil = now + LOCK_MS;
    e.fails = 0;
  }
  perIp.set(ip, e);
}

const clearFailures = (ip) => perIp.delete(ip);

module.exports = { enabled, pinOk, verify, issueSession, issueTicket, bearer, lockRemaining, recordFailure, clearFailures };
