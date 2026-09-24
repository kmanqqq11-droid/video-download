// Hostname allowlist: doubles as validation (SSRF protection) and the "Platform" label.
const PLATFORMS = [
  { name: 'YouTube', domains: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'] },
  { name: 'TikTok', domains: ['tiktok.com'] },
  { name: 'Pinterest', domains: ['pinterest.com', 'pin.it'] },
  { name: 'Facebook', domains: ['facebook.com', 'fb.watch', 'fb.com'] },
  { name: 'Instagram', domains: ['instagram.com'] },
  { name: 'Reddit', domains: ['reddit.com', 'redd.it'] },
  { name: 'Vimeo', domains: ['vimeo.com'] },
  { name: 'X', domains: ['x.com', 'twitter.com'] },
  { name: 'Twitch', domains: ['twitch.tv'] },
];

function hostMatches(host, domain) {
  return host === domain || host.endsWith('.' + domain);
}

/** Returns { url, platform } for a supported URL, or null. */
function detectPlatform(input) {
  if (typeof input !== 'string' || input.length > 2048) return null;
  let u;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  const p = PLATFORMS.find((pl) => pl.domains.some((d) => hostMatches(host, d)));
  return p ? { url: u.toString(), platform: p.name } : null;
}

module.exports = { PLATFORMS, detectPlatform };
