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
    '-N', '8',
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
    '--print', 'after_move:%(title)s',
    watchUrl
  ];

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

app.get('/download', handleDownload);
app.get('/download/:filename', handleDownload);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`GENZ MUSIC backend listening on port ${PORT}`);
});
