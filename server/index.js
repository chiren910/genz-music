const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 10000;

// Enable CORS for frontend calls from Vercel or localhost
app.use(cors({ origin: '*' }));

const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const INNERTUBE_CLIENT = '2.20240625.01.00';

// In-memory search cache (2 min TTL)
const searchCache = new Map();
const searchCacheHit = (key) => {
  const hit = searchCache.get(key);
  if (hit && hit.t > Date.now()) return hit.results;
  searchCache.delete(key);
  return null;
};

const TMP_DIR = path.join(os.tmpdir(), 'song-dl');
if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

// Garbage-collect leftovers older than 30 minutes
setInterval(() => {
  try {
    const files = fs.readdirSync(TMP_DIR);
    const now = Date.now();
    for (const f of files) {
      const p = path.join(TMP_DIR, f);
      try {
        const stat = fs.statSync(p);
        if (now - stat.mtimeMs > 1800000) {
          fs.unlinkSync(p);
        }
      } catch (_) {}
    }
  } catch (_) {}
}, 600000);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

const handleDownload = (req, res) => {
  const vid = (req.query.v || '').toString().trim();
  if (!/^[\w-]{11}$/.test(vid)) {
    return res.status(400).send('Invalid video id');
  }

  const requestedName = (req.query.name || req.params.filename || '').toString().trim();
  const watchUrl = `https://www.youtube.com/watch?v=${vid}`;
  const outTemplate = path.join(TMP_DIR, `${vid}.%(ext)s`);

  const args = [
    '-f', 'bestaudio/best',
    '-S', 'abr,asr',
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', '320K',
    '--no-part',
    '--no-playlist',
    '--no-warnings',
    '--no-progress',
    '--no-check-certificates',
    '--no-cache-dir',
    '--embed-metadata',
    '-o', outTemplate,
    '--no-simulate',
    '--print', 'after_move:%(filepath)s',
    '--print', 'after_move:%(title)s'
  ];

  const cookieFile = path.join(TMP_DIR, 'cookies.txt');
  if (process.env.YOUTUBE_COOKIES && process.env.YOUTUBE_COOKIES.trim()) {
    try {
      const rawLines = process.env.YOUTUBE_COOKIES.trim().split(/\r?\n/);
      const cleanRows = ['# Netscape HTTP Cookie File'];
      for (const line of rawLines) {
        if (!line.trim() || line.startsWith('#')) continue;
        if (line.includes('\t') && line.split('\t').length >= 7) {
          cleanRows.push(line);
          continue;
        }
        const p = line.trim().split(/\s+/);
        if (p.length >= 7) {
          const row = [p[0], p[1], p[2], p[3], p[4], p[5], p.slice(6).join(' ')].join('\t');
          cleanRows.push(row);
          if (p[0].includes('google.com')) {
            cleanRows.push([p[0].replace('google.com', 'youtube.com'), p[1], p[2], p[3], p[4], p[5], p.slice(6).join(' ')].join('\t'));
          }
        }
      }
      fs.writeFileSync(cookieFile, cleanRows.join('\n'));
      args.push('--cookies', cookieFile);
    } catch (_) {}
  } else if (fs.existsSync(path.join(__dirname, 'cookies.txt'))) {
    args.push('--cookies', path.join(__dirname, 'cookies.txt'));
  }

  args.push(watchUrl);

  const proc = spawn('yt-dlp', args);
  let stdout = '';
  let stderr = '';

  proc.stdout.on('data', (d) => { stdout += d.toString(); });
  proc.stderr.on('data', (d) => { stderr += d.toString(); });

  proc.on('close', (code) => {
    if (code !== 0) {
      console.error('yt-dlp failed:', stderr);
      return res.status(502).send('Could not convert this track.');
    }

    const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    let filePath = '';
    let title = requestedName;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().endsWith('.mp3') && fs.existsSync(lines[i])) {
        filePath = lines[i];
        if (!title && lines[i + 1]) title = lines[i + 1];
        break;
      }
    }

    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(500).send('Converted MP3 not found.');
    }

    const safeTitle = (title || 'song').replace(/[\\/:*?"<>|\x00-\x1F]/g, '').trim() || 'song';
    const asciiSafe = safeTitle.replace(/[^a-zA-Z0-9_\-\. ]/g, '').trim() || 'song';
    const encoded = encodeURIComponent(`${safeTitle}.mp3`);
    const stat = fs.statSync(filePath);

    res.setHeader('Content-Description', 'File Transfer');
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${asciiSafe}.mp3"; filename*=UTF-8''${encoded}`);
    res.setHeader('Content-Transfer-Encoding', 'binary');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'must-revalidate, post-check=0, pre-check=0');
    res.setHeader('Pragma', 'public');

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);

    const cleanup = () => {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (_) {}
    };

    res.on('finish', cleanup);
    res.on('close', cleanup);
  });

  req.on('close', () => {
    try { proc.kill(); } catch (_) {}
  });
};

const scoreTitle = (title, tokens, plainLower) => {
  const hay = title.toLowerCase();
  const full = hay.includes(plainLower) ? 100 : 0;
  let matched = 0;
  for (const tk of tokens) if (hay.includes(tk)) matched++;
  let score = full + matched * 10;
  const penalties = [
    'teaser', 'trailer', 'intro', 'jukebox', 'full album', 'lofi', 'lo-fi',
    'mashup', 'replay', 'reaction', 'making of', 'behind the scenes',
    'bass boosted', 'slowed', 'reverb', 'remix', 'interview', 'review'
  ];
  for (const kw of penalties) {
    if (hay.includes(kw)) { score -= 25; break; }
  }
  return Math.max(0, score);
};

const runSearch = (searchArg) =>
  new Promise((resolve) => {
    const args = [
      '--flat-playlist',
      '--no-warnings',
      '--no-progress',
      '--no-check-certificates',
      '--no-cache-dir',
      '--dump-single-json',
      searchArg
    ];
    const proc = spawn('yt-dlp', args);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    const timer = setTimeout(() => { try { proc.kill(); } catch (_) {} }, 8000);
    proc.on('close', () => {
      clearTimeout(timer);
      let data = null;
      try { data = JSON.parse(stdout); } catch (_) {}
      const entries = data && Array.isArray(data.entries) ? data.entries : [];
      resolve(entries);
    });
  });

const innertubeSearch = async (query, limit) => {
  if (!query) return [];
  const payload = {
    query,
    params: 'EgIQAQ%3D%3D',
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: INNERTUBE_CLIENT,
        hl: 'en'
      }
    }
  };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const resp = await fetch(`https://www.youtube.com/youtubei/v1/search?key=${INNERTUBE_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-App-Name': 'youtube-web'
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
    clearTimeout(timer);
    if (!resp.ok) return [];
    const data = await resp.json();
    const sections =
      data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
    const videos = [];
    const parseDuration = (txt) => {
      if (typeof txt !== 'string' || !txt) return 0;
      const parts = txt.split(':').map((n) => parseInt(n, 10) || 0);
      return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2]
        : parts.length === 2 ? parts[0] * 60 + parts[1]
        : parts[0] || 0;
    };
    for (const section of sections) {
      const items = section.itemSectionRenderer?.contents || [];
      for (const item of items) {
        const v = item.videoRenderer;
        if (!v) continue;
        const id = String(v.videoId || '');
        const title = String((v.title?.runs || []).map((r) => r.text || '').join('')).trim();
        if (!/^[\w-]{11}$/.test(id) || !title) continue;
        const duration = parseDuration(v.lengthText?.simpleText);
        if (!duration || duration > 1800) continue;
        const channel = String(v.ownerText?.runs?.[0]?.text || '');
        videos.push({ id, title, channel, duration });
        if (videos.length >= limit) return videos;
      }
    }
    return videos;
  } catch (_) {
    return [];
  }
};

const handleSearch = async (req, res) => {
  const qRaw = (req.query.q || '').toString().trim();
  const count = Math.min(10, Math.max(1, parseInt(req.query.count, 10) || 8));
  if (!qRaw) {
    return res.status(400).json({ error: 'Missing search query.' });
  }

  const safe = qRaw.replace(/["\r\n\x00]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!safe) {
    return res.status(400).json({ error: 'Invalid search query.' });
  }

  const tokenParts = safe.toLowerCase().split(/\s+/).map((t) => t.trim().replace(/^[\s.,'"\-]+|[\s.,'"\-]+$/g, '')).filter((t) => t.length > 1);
  const tokens = tokenParts.length ? tokenParts : [safe.toLowerCase()];
  const plainLower = safe.toLowerCase();

  const cacheKey = `${safe.toLowerCase()}|${count}`;
  const cached = searchCacheHit(cacheKey);
  if (cached) {
    return res.json({ results: cached, cached: true });
  }

  const collect = (entries, priority, byId) => {
    for (const e of entries) {
      const id = String((e && e.id) || '');
      const title = String((e && e.title) || '').trim();
      if (!/^[\w-]{11}$/.test(id) || !title) continue;
      const duration = parseInt(e.duration, 10) || 0;
      if (duration > 1800) continue;
      const key = String(id);
      if (byId.has(key)) continue;
      const channel = String((e && (e.channel || e.uploader)) || '').trim();
      byId.set(key, {
        id,
        title,
        channel,
        duration,
        thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
        _score: scoreTitle(title, tokens, plainLower),
        _pri: priority
      });
    }
  };

  try {
    let byId = new Map();

    // Fast path: two innertube searches in parallel ("<q>", "<q> song").
    const [passA, passB] = await Promise.all([
      innertubeSearch(safe, count),
      innertubeSearch(`${safe} song`, count)
    ]);
    collect(passA, 0, byId);
    collect(passB, 1, byId);

    // Fallback: yt-dlp three-pass (only when innertube returned nothing).
    if (!byId.size) {
      const passes = await Promise.all([
        runSearch(`ytsearch${count}:${safe}`),
        runSearch(`ytsearch${count}:${safe} song`),
        runSearch(`ytsearch${count}:${safe} audio`)
      ]);
      byId = new Map();
      passes.forEach((entries, priority) => collect(entries, priority, byId));
    }

    if (!byId.size) {
      return res.status(502).json({ error: 'No songs found. Try a different artist or movie name.' });
    }

    const results = [...byId.values()]
      .sort((a, b) => (b._score - a._score) || (a._pri - b._pri) || (a.duration - b.duration))
      .slice(0, 12)
      .map(({ id, title, channel, duration, thumb }) => ({ id, title, channel, duration, thumb }));

    searchCache.set(cacheKey, { t: Date.now() + 120000, results });
    res.json({ results });
  } catch (err) {
    console.error('search failed:', err.message);
    res.status(502).json({ error: 'Search failed.' });
  }
};

app.get('/search', handleSearch);
app.get('/download', handleDownload);
app.get('/download/:filename', handleDownload);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`GENZ MUSIC backend listening on port ${PORT}`);
});
