# ⚡ Video Downloader

Mobile-first video downloader: paste a URL, the app detects the platform, shows the thumbnail and available
qualities, then downloads the file to your phone. It is a PWA (installable from the browser) backed by
Node.js/Express, with [yt-dlp](https://github.com/yt-dlp/yt-dlp) doing the actual extraction.

```
Phone (PWA) ──► Express API ──► URL allowlist ──► yt-dlp ──► temp file ──► phone
```

Supported: YouTube, TikTok, Pinterest, Facebook, Instagram, Reddit, Vimeo, X (Twitter), Twitch.
Support ultimately depends on what yt-dlp can extract; some sites need cookies for private/age-restricted content.

## Quick start (double-click)

1. Install [Node.js](https://nodejs.org), [yt-dlp](https://github.com/yt-dlp/yt-dlp/releases) and [ffmpeg](https://ffmpeg.org/).
   On Windows you can just drop `yt-dlp.exe` and `ffmpeg.exe` into this folder.
2. Double-click **Start-Windows.bat** (Windows) or **start.command** (macOS; Linux: `./start.sh`).
   It installs dependencies on first run, starts the server and opens your browser.

`video-downloader.html` is a single-file version of the same UI. It only provides the interface, so the server
above must be running (the dot at the bottom turns green when it is connected). A web page alone cannot
download from these sites because of browser security rules and because extraction needs yt-dlp.

## Requirements

- Node.js 18+
- [yt-dlp](https://github.com/yt-dlp/yt-dlp#installation) on your PATH (`pip install -U yt-dlp` or a release binary)
- [ffmpeg](https://ffmpeg.org/) on your PATH (needed to merge video+audio and to make MP3s)

## Run

```bash
npm install
cp .env.example .env    # optional, edit limits
npm start
```

Open http://localhost:3000. To use it from your phone, be on the same Wi-Fi and open
`http://<your-computer-ip>:3000`. Installing as a PWA and the clipboard "Paste" button require HTTPS
(or localhost), so put it behind a reverse proxy / tunnel (Caddy, nginx, Cloudflare Tunnel, Tailscale) for that.

### Docker

```bash
cp .env.example .env
docker compose up --build
```

The image bundles yt-dlp and ffmpeg. Keep yt-dlp updated (rebuild the image regularly), since sites change often.

## API

| Method | Path | Body | Description |
|---|---|---|---|
| POST | `/api/info` | `{ url }` | Platform, title, thumbnail, duration, quality options |
| POST | `/api/jobs` | `{ url, quality }` | Start a download (`quality`: `1080`, `720`, …, `best`, `audio`). Returns `{ id }` |
| GET | `/api/jobs/:id` | | `{ status, progress, error, filename }` (`queued`, `downloading`, `processing`, `done`, `error`) |
| GET | `/api/jobs/:id/file` | | The finished file |
| DELETE | `/api/jobs/:id` | | Cancel / clean up |
| GET | `/api/health` | | Server and yt-dlp version |

## Configuration (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 3000 | HTTP port |
| `YTDLP_PATH` | `yt-dlp` | yt-dlp binary |
| `YTDLP_COOKIES_FILE` | | Netscape cookies file |
| `MAX_CONCURRENT_JOBS` | 2 | Simultaneous downloads |
| `MAX_DURATION_SECONDS` | 3600 | Reject longer videos |
| `MAX_FILESIZE` | 500M | Reject larger files |
| `JOB_TTL_MINUTES` | 10 | Temp files are deleted after this |
| `RATE_LIMIT_PER_MINUTE` | 30 | Per-IP API limit |
| `APP_PIN` | | Turns on PIN login (6+ digits) |
| `SESSION_SECRET` | random | Keeps logins valid across restarts |
| `CORS_ORIGINS` | | Extra allowed origins for the standalone HTML |

## PIN protection

Set `APP_PIN` in `.env` (6+ digits) and restart. The app then shows a PIN screen and every API call needs the login.
After 5 wrong tries an IP is locked for 15 minutes, and there is a global cap on wrong tries per hour.
Logins last 30 days. Set `SESSION_SECRET` to a long random string if you want logins to survive server restarts.
A PIN is weaker than a real password: use it together with HTTPS, and pick a PIN that is not guessable.

## Security notes

- yt-dlp is launched with `spawn` and an argument array (no shell), and URLs are passed after `--`.
- Only hostnames on the allowlist in `src/platforms.js` are accepted (blocks localhost/internal addresses).
- Rate limiting, concurrency, duration and size caps are enabled by default. Files live in the OS temp dir and are auto-deleted.
- If you expose this publicly, set `APP_PIN`. An open downloader is easy to abuse.

## Legal

Downloading may violate a platform's terms of service and copyright law. Use this only for content you own or
have permission to download, ideally for personal/educational use.

## Tests

```bash
npm test
```
