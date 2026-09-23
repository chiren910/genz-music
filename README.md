# GENZ MUSIC 🎵

A sleek, high-performance web music player and 320kbps YouTube-to-MP3 converter tailored for GenZ vibes. Built with vanilla HTML/CSS/JavaScript, Docker, Node.js, `yt-dlp`, and `ffmpeg`.

---

## ✨ Features

- **Instant Streaming**: Embedded YouTube nocookie audio streaming with responsive visualizer and live listener counter.
- **Sub-3s Fast Search**: Parallelized Innertube API queries with multi-pass `yt-dlp` fallback and smart title relevance ranking.
- **Studio-Quality MP3 Downloads**: Converts YouTube audio to true **320kbps MP3** on the fly using `ffmpeg` and `yt-dlp`, complete with sanitized metadata and mobile-compatible download headers.
- **Fail-Safe Fallback**: Automatic redirection to Cobalt Tools downloader if YouTube stream restriction triggers.
- **Curated Playlists**: Built-in support for CSV-based playlists (English Top Hits, Bollywood 250+).
- **Responsive Cyberpunk / Retro Dark UI**: Glassmorphic styling, neon glows, mobile bottom-sheet playlist, and touch-optimized playbar.

---

## 🏗️ Architecture

- **Frontend**: Vanilla HTML5, CSS3, JavaScript ES6+ (Zero external UI dependencies, blazing fast).
- **Local Backend**: Apache/XAMPP PHP API (`api/search.php`, `api/download.php`).
- **Live Cloud Backend**: Docker container running on Render (`node:20-slim`, `ffmpeg`, `yt-dlp`, `server/index.js`).
- **Live Cloud Frontend**: Vercel or Render Static Site via global CDN.

---

## 🚀 Live Deployment

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/chiren910/genz-music)

Follow the complete, step-by-step instructions in our [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) to launch GENZ MUSIC live for free:

1. **Deploy Backend**: Click the button above or use [render.com/deploy](https://render.com/deploy?repo=https://github.com/chiren910/genz-music) to auto-deploy the Docker backend from `render.yaml`.
2. **Deploy Frontend**: Vercel (`vercel.json` and `.vercelignore` pre-configured).
3. **Prevent Cold Starts**: Free keep-alive ping via UptimeRobot.

---

## 💻 Local Development (XAMPP)

1. Clone repository to your local web server:
   ```bash
   git clone https://github.com/chiren910/genz-music.git c:/xampp/htdocs/SONG
   ```
2. Ensure `yt-dlp.exe` and `ffmpeg.exe` are placed in `tools/bin/` (or installed on system `PATH`).
3. Start Apache in the XAMPP Control Panel.
4. Open `http://localhost/SONG/` in your browser.

---

## 🛠️ Tech Stack

- **Frontend**: HTML5, CSS3, JavaScript ES6+
- **Backend**: Node.js, Express.js, Docker, PHP
- **Media Engine**: `yt-dlp`, `ffmpeg`
- **Deployment**: Render, Vercel

---

## 📄 License

MIT License. Designed with ❤️ for the GenZ music community.
