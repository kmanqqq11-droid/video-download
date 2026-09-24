const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

function platformExtractorArgs(url) {
  const lower = url.toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) {
    return ['--extractor-args', 'youtube:player_client=android,ios,tv_embedded'];
  }
  if (lower.includes('tiktok.com')) {
    return ['--extractor-args', 'tiktok:player_client=android,ios,tv_embedded'];
  }
  if (lower.includes('instagram.com')) {
    return ['--extractor-args', 'instagram:player_client=android,ios,tv_embedded'];
  }
  if (lower.includes('twitter.com')) {
    return ['--extractor-args', 'twitter:player_client=android,ios,tv_embedded'];
  }
  // Generic fallback for any other extractor
  return ['--extractor-args', '*:player_client=android,ios,tv_embedded'];
}
function baseArgs(url) {
  const args = [
    '--no-playlist', '--no-warnings', '--socket-timeout', '20',
    // Use a common desktop browser User-Agent – helps avoid bot detection on cloud IPs
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    // Platform‑specific client spoof → avoids captcha / bot verification
    ...platformExtractorArgs(url),
  ];
  // Optional proxy – set PROXY_URL env var to a residential/forward proxy URL (e.g., http://user:pass@proxyhost:port)
  if (process.env.PROXY_URL) args.push('--proxy', process.env.PROXY_URL);
  if (config.cookiesFile) args.push('--cookies', config.cookiesFile);
  return args;
}


function cleanError(stderr) {
  const line =
    String(stderr).split('\n').map((l) => l.trim()).filter(Boolean)
      .reverse().find((l) => l.startsWith('ERROR')) || 'Could not process this URL';
  return line.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, '').slice(0, 300);
}

function version() {
  return new Promise((resolve) => {
    const p = spawn(config.ytdlpPath, ['--version']);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', () => resolve(null));
    p.on('close', (code) => resolve(code === 0 ? out.trim() : null));
  });
}

/** Fetch metadata as JSON. Uses spawn with an argument array (no shell). */
function getInfo(url) {
  return new Promise((resolve, reject) => {
    const args = ['-J', ...baseArgs(url), '--', url];
    const p = spawn(config.ytdlpPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => p.kill('SIGKILL'), 45_000);
    p.stdout.on('data', (d) => {
      stdout += d;
      if (stdout.length > 25 * 1024 * 1024) p.kill('SIGKILL');
    });
    p.stderr.on('data', (d) => (stderr += d));
    p.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(e.code === 'ENOENT' ? 'yt-dlp is not installed on the server' : e.message));
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(cleanError(stderr)));
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error('Unexpected response from yt-dlp'));
      }
    });
  });
}

const STANDARD_HEIGHTS = [2160, 1440, 1080, 720, 480, 360, 240, 144];

/** Turn yt-dlp's format list into a short list of quality options. */
function summarize(info) {
  const heights = new Set();
  for (const f of info.formats || []) {
    if (f.vcodec && f.vcodec !== 'none' && f.height) heights.add(f.height);
  }
  const sorted = [...heights].sort((a, b) => b - a);
  const qualities = [];
  for (const std of STANDARD_HEIGHTS) {
    if (sorted.some((h) => h >= std && h < std * 1.35)) qualities.push({ id: String(std), label: `${std}p` });
  }
  if (qualities.length === 0) qualities.push({ id: 'best', label: 'Best available' });
  qualities.push({ id: 'audio', label: 'Audio only (MP3)' });
  return {
    title: info.title || 'Untitled',
    thumbnail: info.thumbnail || (info.thumbnails && info.thumbnails.slice(-1)[0]?.url) || null,
    duration: info.duration || null,
    uploader: info.uploader || info.channel || null,
    isLive: Boolean(info.is_live),
    qualities,
  };
}

/**
 * Download into `dir`. Returns { promise, cancel }.
 * promise resolves with the absolute path of the resulting file.
 */
function startDownload({ url, quality, dir, onProgress, onStage }) {
  const args = [
    ...baseArgs(url),
    '--newline',
    '--progress-template', 'download:PROGRESS %(progress._percent_str)s',
    '--max-filesize', config.maxFilesize,
    '--match-filter', `duration<=?${config.maxDurationSeconds} & !is_live`,
    '--windows-filenames',
    '--trim-filenames', '120',
    '-o', path.join(dir, '%(title)s.%(ext)s'),
  ];
  let expectedParts = 1;
  if (quality === 'audio') {
    args.push('-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0');
  } else if (quality === 'best') {
    args.push('-f', 'bv*+ba/b', '-S', 'res,ext', '--merge-output-format', 'mp4');
    expectedParts = 2;
  } else {
    args.push('-f', 'bv*+ba/b', '-S', `res:${quality},ext`, '--merge-output-format', 'mp4');
    expectedParts = 2;
  }
  args.push('--', url);

  const p = spawn(config.ytdlpPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  let part = 0;
  let lastPct = 0;
  let buf = '';

  const handleLine = (line) => {
    const m = line.match(/PROGRESS\s+([\d.]+)%/);
    if (m) {
      const pct = parseFloat(m[1]);
      if (pct + 10 < lastPct) part = Math.min(part + 1, expectedParts - 1);
      lastPct = pct;
      onProgress && onProgress(Math.min(0.98, (part + pct / 100) / expectedParts));
      onStage && onStage('downloading');
    } else if (/^\[(Merger|ExtractAudio|VideoConvertor|FFmpeg)/.test(line)) {
      onStage && onStage('processing');
    }
  };

  const promise = new Promise((resolve, reject) => {
    p.stdout.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop();
      lines.forEach(handleLine);
    });
    p.stderr.on('data', (d) => (stderr += d));
    p.on('error', (e) =>
      reject(new Error(e.code === 'ENOENT' ? 'yt-dlp is not installed on the server' : e.message)));
    p.on('close', (code, signal) => {
      if (signal) return reject(new Error('Download cancelled'));
      if (code !== 0) return reject(new Error(cleanError(stderr)));
      const files = fs.readdirSync(dir).filter((f) => !/\.(part|ytdl|temp)$/i.test(f));
      if (files.length === 0) {
        return reject(new Error('Video was rejected by the server limits (too long, too large, or live)'));
      }
      files.sort((a, b) => fs.statSync(path.join(dir, b)).size - fs.statSync(path.join(dir, a)).size);
      resolve(path.join(dir, files[0]));
    });
  });

  return { promise, cancel: () => p.kill('SIGKILL') };
}

module.exports = { version, getInfo, summarize, startDownload };
