#!/usr/bin/env bash
# macOS: double-click start.command. Linux: run ./start.sh
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null || { echo "Node.js is required: https://nodejs.org"; read -r -p "Press Enter"; exit 1; }
command -v yt-dlp >/dev/null || echo "WARNING: yt-dlp not found (macOS: brew install yt-dlp, or pip install -U yt-dlp)"
command -v ffmpeg >/dev/null || echo "WARNING: ffmpeg not found (macOS: brew install ffmpeg)"
[ -d node_modules ] || npm install
( sleep 2; { open http://localhost:3000 || xdg-open http://localhost:3000; } >/dev/null 2>&1 ) &
node server.js
