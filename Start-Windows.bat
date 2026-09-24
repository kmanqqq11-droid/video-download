@echo off
title Video Downloader
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install it from https://nodejs.org then run this again.
  pause & exit /b 1
)
rem Optional: drop yt-dlp.exe and ffmpeg.exe into this folder and they will be used automatically
set "PATH=%~dp0;%PATH%"
where yt-dlp >nul 2>nul
if errorlevel 1 echo WARNING: yt-dlp not found. Download yt-dlp.exe from https://github.com/yt-dlp/yt-dlp/releases and put it in this folder.
where ffmpeg >nul 2>nul
if errorlevel 1 echo WARNING: ffmpeg not found. Put ffmpeg.exe in this folder or install it, otherwise merging and MP3 will fail.
if not exist node_modules call npm install
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000"
node server.js
pause
