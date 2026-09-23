# GENZ MUSIC — Live Deployment Guide

This guide provides step-by-step instructions to take **GENZ MUSIC** from localhost to live production on the internet.

---

## Architecture Overview

GENZ MUSIC uses a **hybrid architecture** for maximum speed, 99.9% uptime, and zero hosting costs:

```
┌─────────────────────────────────┐       ┌─────────────────────────────────┐
│       Frontend (Static)         │       │        Backend (Docker)         │
│  Host: Vercel or Cloudflare     │──────>│          Host: Render           │
│  Files: HTML, CSS, JS, CSVs     │  API  │  Stack: Node.js, yt-dlp, ffmpeg │
│  Domain: *.vercel.app           │       │  Domain: *.onrender.com         │
└─────────────────────────────────┘       └─────────────────────────────────┘
```

- **Frontend**: Hosted on **Vercel** (or Render Static Site). Served via global CDN with zero latency and instant page loads.
- **Backend**: Hosted on **Render** using Docker. Houses `yt-dlp` and `ffmpeg` to power the real-time YouTube search and high-quality 320kbps MP3 conversion engine.

---

## Part 1: Deploy Backend to Render (Free Docker Web Service)

Render provides free Docker container hosting, which is required to execute `yt-dlp` and `ffmpeg`.

### 1. Create a Web Service on Render
1. Visit [Render Dashboard](https://dashboard.render.com/) and sign in with GitHub.
2. Click **New +** in the top right corner and select **Web Service**.
3. Choose **Build and deploy from a Git repository** &rarr; click **Next**.
4. Locate and select your repository: `chiren910/genz-music`.

### 2. Configure Service Settings
Fill in the following fields:

| Field | Value |
| :--- | :--- |
| **Name** | `genz-music-backend` |
| **Region** | `Oregon (US West)` or `Frankfurt (EU)` |
| **Branch** | `main` |
| **Root Directory** | *(Leave blank)* |
| **Runtime** | `Docker` *(auto-detected from Dockerfile)* |
| **Instance Type** | **Free** ($0/month) |

### 3. Environment Variables
Under **Advanced** &rarr; **Add Environment Variable**:
- Key: `PORT`
- Value: `10000`

### 4. Deploy
1. Click **Deploy Web Service** at the bottom.
2. Render will pull `node:20-slim`, install `ffmpeg`, `python3`, and download the latest `yt-dlp` binary automatically.
3. Wait 2–3 minutes for the build to finish. When ready, you will see:
   ```
   ==> Your service is live 🎉
   ```
4. Copy your backend service URL (e.g., `https://genz-music-backend.onrender.com`).

### 5. Verify Backend Health
Open the health check in your browser:
```
https://genz-music-backend.onrender.com/health
```
You should see:
```json
{"status":"ok","time":"2026-..."}
```

---

## Part 2: Deploy Frontend to Vercel (Fastest & Recommended)

Vercel provides a free global edge CDN with automatic SSL certificates.

### 1. Import Repository on Vercel
1. Visit [Vercel Dashboard](https://vercel.com/dashboard) and sign in with GitHub.
2. Click **Add New…** &rarr; **Project**.
3. Locate `chiren910/genz-music` and click **Import**.

### 2. Project Configuration
- **Framework Preset**: `Other`
- **Root Directory**: `./` (default)
- **Build and Output Settings**:
  - Build Command: *(Leave blank)*
  - Output Directory: *(Leave blank)*
- `.vercelignore` and `vercel.json` are already set up in the repository, so PHP files and backend code will automatically be excluded from Vercel's build.

### 3. Deploy
1. Click **Deploy**.
2. Within 10–15 seconds, your site will be live at a public URL (e.g., `https://genz-music.vercel.app`).

---

## Part 3: Connecting Frontend with Custom Backend URL (If applicable)

If your Render backend URL matches `https://genz-music-backend.onrender.com`, **no code change is needed** — it connects automatically!

If Render assigned you a different unique URL (e.g., `https://genz-music-backend-ab12.onrender.com`):

### Option A: Update in `main.js` (Permanent)
Edit line 836 in [`main.js`](file:///c:/xampp/htdocs/SONG/main.js):
```javascript
  const RENDER_BACKEND =
    (typeof window !== "undefined" && window.__GENZ_BACKEND_URL__) ||
    (typeof localStorage !== "undefined" && localStorage.getItem("GENZ_BACKEND_URL")) ||
    "https://YOUR-CUSTOM-RENDER-URL.onrender.com";
```
Commit and push to GitHub — Vercel will automatically redeploy.

### Option B: Quick Browser Test (Instant)
Open DevTools (`F12`) on your live site, switch to the **Console** tab, and run:
```javascript
localStorage.setItem("GENZ_BACKEND_URL", "https://YOUR-CUSTOM-RENDER-URL.onrender.com");
location.reload();
```

---

## Part 4: Prevent Render Free Tier Cold Starts (Keep-Alive Setup)

Render's free tier spins down after 15 minutes of inactivity. When a user visits after idle time, the first search or download may take 30–50 seconds to wake up.

**How to keep it awake 24/7 for free:**

1. Go to [UptimeRobot.com](https://uptimerobot.com/) (100% free account).
2. Click **Add New Monitor**.
3. Configure:
   - **Monitor Type**: `HTTP(s)`
   - **Friendly Name**: `GENZ MUSIC Backend Ping`
   - **URL (or IP)**: `https://genz-music-backend.onrender.com/health`
   - **Monitoring Interval**: Every `5 minutes` or `10 minutes`
4. Click **Create Monitor**.

UptimeRobot will send a lightweight ping every few minutes, keeping your Render container warm and responsive with zero cold starts!

---

## Part 5: Alternative: Deploying Everything on Render (All-in-One)

If you prefer having both frontend and backend on Render under a single account:

1. Follow **Part 1** to deploy your backend Web Service.
2. In the Render Dashboard, click **New +** &rarr; **Static Site**.
3. Select `chiren910/genz-music`.
4. Configure:
   - **Name**: `genz-music`
   - **Branch**: `main`
   - **Publish Directory**: `.`
   - **Build Command**: *(Leave empty)*
5. Click **Create Static Site**.
6. Render Static Sites are **100% free, do not sleep, and have unlimited bandwidth**.

---

## Part 6: Verification & Testing Checklist

Once both services are deployed, test your live site with these steps:

1. **Player Playback**: Open your live URL. Click any track in the playlist (e.g. *Highway Diaries*). Verify the YouTube embed player loads and audio plays.
2. **Fast Search**: Type a song name (e.g. `Arijit Singh`, `Believer`) in the search bar.
   - Results should load in **under 3 seconds** via the Innertube API endpoint.
3. **Song Download**: Click the download icon (⬇) on any search result or the main playbar.
   - You should see toast: `⬇ Converting to 320kbps MP3… please wait`.
   - Your browser should download `<SongName>.mp3` with clean ID3 tags.
4. **Fallback Test**: In the rare event YouTube restricts a stream, verify that the toast automatically opens Cobalt Tools (`https://cobalt.tools`) as a safety backup.

---

## Troubleshooting

| Issue | Cause | Solution |
| :--- | :--- | :--- |
| **Search fails with 502** | Render backend container is still spinning up | Wait 30 seconds for container to wake up, or set up UptimeRobot keep-alive. |
| **CORS error in browser console** | Backend didn't allow origin | Express backend has `cors({ origin: '*' })` enabled by default. Check if backend URL is HTTPS. |
| **Download shows "Converted MP3 not found"** | yt-dlp temporary stream issue | Check Render logs tab under dashboard to see yt-dlp output. |
| **Memory exceeded on Render** | Free tier 512MB RAM cap reached during multiple simultaneous conversions | Restart service in Render dashboard or consider Railway ($5/mo) if usage scales. |
