#!/usr/bin/env node
/**
 * update-playlist.js
 * Daily playlist updater for GENZ MUSIC Radio.
 * Pulls latest videos from official YouTube channels via RSS (no API key),
 * filters to real songs, dedupes, and rewrites the CSV playlists.
 *
 * Usage:
 *   node tools/update-playlist.js            normal run
 *   node tools/update-playlist.js --dry-run  fetch + report only, no writes
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DRY_RUN = process.argv.includes("--dry-run");
const CACHE_FILE = path.join(__dirname, ".channel-cache.json");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/* ------------------------- EDIT YOUR CHANNELS HERE ------------------------ */
const GENRES = [
  {
    key: "bollywood",
    csv: "playlist-bollywood-250.csv",
    channels: ["@tseries", "@zeemusiccompany", "@sonymusicindia"],
  },
  {
    key: "hollywood",
    csv: "playlist-english-top.csv",
    channels: [
      "@AtlanticRecords",
      "@RepublicRecords",
      "@InterscopeRecords",
      "@warnerrecords",
    ],
  },
];

const MIN_SECONDS = 90; // ignore shorts / teasers
const MAX_SECONDS = 600; // 10 min cap

const TITLE_BLACKLIST =
  /trailer|teaser|motion poster|poster|interview|making of|behind the scenes|\bbts\b|reaction|announcement|promo|dj mix|non-?stop mix|jukebox|audio jukebox|full album|lo-?fi|cinematic flip|slowed|reverb|remix|cover|lesson|karaoke|\bshorts?\b|#shorts?|bedtime|fairy tales?|moral storie?s?|storie?s for kids|\bkids\b|kids adventure|story|social justice|dialogues|highlights|live stream|panel discussion|celebration|broadway/i;

const MAX_PER_CHANNEL = 6; // max new songs added per channel per run

/* -------------------------------------------------------------------------- */

async function get(url) {
  const res = await fetch(url, {
    headers: { "user-agent": UA, "accept-language": "en" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch (_) {
    return {};
  }
}

function saveCache(cache) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (_) {}
}

async function resolveChannelId(handle) {
  const cache = loadCache();
  if (cache[handle]) return cache[handle];
  const html = await get(`https://www.youtube.com/${handle}/videos`);
  const m =
    html.match(/"externalId":"(UC[\w-]{22})"/) ||
    html.match(/<link rel="canonical" href="[^"]*\/channel\/(UC[\w-]{22})"/);
  if (!m) throw new Error(`Could not resolve ${handle}`);
  cache[handle] = m[1];
  saveCache(cache);
  return m[1];
}

async function fetchRss(channelId) {
  const xml = await get(
    `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
  );
  const entries = [];
  const blocks = xml.split("<entry>").slice(1);
  for (const b of blocks) {
    const vid =
      (b.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/) || [])[1] || null;
    const title = decodeXml((b.match(/<title>(.*?)<\/title>/) || [])[1] || "");
    const published = (b.match(/<published>(.*?)<\/published>/) || [])[1] || "";
    if (vid && title) entries.push({ vid, title, published });
  }
  return entries;
}

function decodeXml(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&(apos);/g, "'");
}

function isSongTitle(title) {
  return !TITLE_BLACKLIST.test(title);
}

async function probeVideo(vid) {
  const html = await get(
    `https://www.youtube.com/watch?v=${vid}&hl=en&has_verified=1`
  );
  const lm = html.match(/"lengthSeconds":"(\d+)"/);
  const am = html.match(/"author":"((?:\\.|[^"\\])*)"/);
  const seconds = lm ? parseInt(lm[1], 10) : 0;
  let author = "";
  if (am) {
    try {
      author = JSON.parse(`"${am[1]}"`);
    } catch (_) {
      author = am[1];
    }
  }
  author = author.replace(/\s*-\s*Topic$/i, "").trim();
  return { seconds, author };
}

function cleanTitle(title) {
  let t = title;
  t = t.replace(/[([{][^)\]}]*?(official|video|audio|song|lyrical|lyrics|music)[^)\]}]*?[)\]}]/gi, " ");
  t = t.replace(/\s*[|·]\s*(official|full song|video song).*$/gi, "");
  t = t.replace(/\s{2,}/g, " ").trim();
  t = t.replace(/^["'`]+|["'`]+$/g, "").trim();
  t = t.replace(/\s*[-–|]\s*$/, "").trim();
  return t || title;
}

function deriveArtist(title, fallbackChannel) {
  const parts = title.split(/\s+[-–]\s+/);
  if (parts.length >= 2 && parts[0].length <= 40) return parts[0].trim();
  return fallbackChannel || "";
}

function fmtDuration(s) {
  s = Math.max(1, Math.round(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/* Site's parsePlaylist() uses a naive split(","), so every field must be
   free of commas and quote characters to survive the round-trip. */
function safeField(v) {
  v = String(v ?? "")
    .replace(/"/g, "'")
    .replace(/,/g, " |")
    .replace(/\s{2,}/g, " ")
    .trim();
  return v;
}

/* Parse existing CSV -> { ids:Set, header:string, rows:[rawLine...] } */
function readCsv(file) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const ids = new Set();
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    if (c.length >= 8 && c[6]) ids.add(c[6].trim());
    rows.push(lines[i]);
  }
  return { header: lines[0] || "", rows, ids };
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

async function updateGenre(g) {
  const file = path.join(ROOT, g.csv);
  console.log(`\n=== ${g.key} (${g.csv}) ===`);
  const db = readCsv(file);
  console.log(`existing songs: ${db.ids.size}`);

  const seen = new Set(db.ids);
  const candidates = [];

  for (const handle of g.channels) {
    try {
      const channelId = await resolveChannelId(handle);
      const entries = await fetchRss(channelId);
      let added = 0;
      for (const e of entries) {
        if (seen.has(e.vid)) continue;
        if (!isSongTitle(e.title)) continue;
        if (added >= MAX_PER_CHANNEL) break;
        seen.add(e.vid); // dedupe within batch too
        candidates.push({ ...e, channel: handle });
        added++;
      }
      console.log(`${handle}: ${entries.length} feed items, ${added} candidates`);
    } catch (err) {
      console.log(`${handle}: SKIPPED (${err.message})`);
    }
    await sleep(400);
  }

  const fresh = [];
  for (const c of candidates) {
    try {
      const { seconds, author } = await probeVideo(c.vid);
      if (seconds < MIN_SECONDS || seconds > MAX_SECONDS) {
        console.log(`  drop ${c.vid} "${cleanTitle(c.title)}" (${fmtDuration(seconds || 0)})`);
        continue;
      }
      fresh.push({
        title: cleanTitle(c.title),
        artist: deriveArtist(c.title, author) || c.channel,
        movie: "",
        dur: fmtDuration(seconds),
        url: `https://www.youtube.com/watch?v=${c.vid}`,
        vid: c.vid,
        year: (new Date(c.published)).getFullYear() || new Date().getFullYear(),
      });
      console.log(`  ADD  ${fresh[fresh.length - 1].dur}  ${fresh[fresh.length - 1].title}`);
    } catch (err) {
      console.log(`  probe failed ${c.vid}: ${err.message}`);
    }
    await sleep(600);
  }

  const allRows = [];
  for (const f of fresh) {
    allRows.push(
      [0, f.title, f.artist, f.movie, f.dur, f.url, f.vid, f.year]
        .map(safeField)
        .join(",")
    );
  }
  allRows.push(...db.rows);

  const outLines = [db.header, ...allRows.map((row, i) => {
    const c = parseCsvLine(row);
    c[0] = String(i + 1);
    return c.map(safeField).join(",");
  })];
  const outText = outLines.join("\n") + "\n";
  const changed = outText !== fs.readFileSync(file, "utf8");

  if (!fresh.length && !changed) {
    console.log("no new songs. CSV untouched.");
    return { genre: g.key, added: 0 };
  }

  if (DRY_RUN) {
    console.log(`DRY RUN: would add ${fresh.length} song(s).`);
  } else {
    fs.copyFileSync(file, file + ".bak");
    fs.writeFileSync(file, outText, "utf8");
    console.log(`DONE: +${fresh.length} new song(s). Backup: ${g.csv}.bak`);
  }
  return { genre: g.key, added: fresh.length };
}

(async () => {
  const stamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  console.log(`playlist updater start — ${stamp}${DRY_RUN ? " [DRY RUN]" : ""}`);
  const summary = [];
  for (const g of GENRES) {
    try {
      summary.push(await updateGenre(g));
    } catch (err) {
      console.error(`${g.key} FAILED: ${err.message}`);
    }
  }
  console.log("\nsummary:", JSON.stringify(summary));
})();
