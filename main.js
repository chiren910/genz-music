(() => {
  "use strict";

  /* ---------- Clock (IST) ---------- */
  const clock = document.querySelector(".clock");
  const fmt = (n) => String(Math.floor(Number(n))).padStart(2, "0");
  const tick = () => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: "Asia/Kolkata",
    }).formatToParts(new Date());
    const get = (t) => (parts.find((p) => p.type === t) || {}).value || "00";
    clock.textContent = `${get("hour")}:${get("minute")}:${get("second")}`;
  };
  tick();
  setInterval(tick, 1000);

  /* ---------- Listeners count (mock) ---------- */
  const countEl = document.querySelector(".listeners__count");
  const statListenersEl = document.getElementById("statListeners");
  let listeners = 1248;
  const renderListeners = () => {
    const s = listeners.toLocaleString("en-IN");
    countEl.textContent = s;
    if (statListenersEl) statListenersEl.textContent = s;
  };
  renderListeners();
  setInterval(() => {
    const delta = Math.round(Math.random() * 14 - 7);
    listeners = Math.max(900, listeners + delta);
    renderListeners();
  }, 3500);

  /* ---------- Mock player (playlist loaded from CSV) ---------- */
  const fallbackTracks = [
    { title: "Highway Diaries", artist: "GenZ Saloon Band", dur: 214 },
    { title: "Neon Dhol", artist: "DJ Aadi & Crew", dur: 187 },
    { title: "Raat Ka Bass", artist: "Kaka & Friends", dur: 243 },
    { title: "Full Volume, Zero Tension", artist: "Vibe Syndicate", dur: 201 },
    { title: "Midnight Drive", artist: "Scooter Baba", dur: 176 },
    { title: "Chai Pe Tension", artist: "Dhaba Beats", dur: 229 },
  ];

  let tracks = fallbackTracks.slice();

  const toSeconds = (ms) => {
    const p = String(ms).split(":").map(Number);
    return p.length === 2 ? p[0] * 60 + p[1] : (p[0] || 0);
  };

  const parsePlaylist = (csv) => {
    const rows = csv.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (rows.length < 2) return [];
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const c = rows[i].split(",");
      if (c.length < 5) continue;
      const title = (c[1] || "").trim();
      const artist = (c[2] || "").trim();
      const dur = toSeconds((c[4] || "").trim());
      const vid = (c[6] || "").trim();
      if (!title || !dur) continue;
      out.push({ title, artist, dur, vid });
    }
    return out;
  };

  let ytPlayer = null;
  let apiFailed = false;
  let iframeEl = null;

  const embedSrc = (vid, autoplay) =>
    `https://www.youtube-nocookie.com/embed/${vid}?playsinline=1&autoplay=${autoplay ? 1 : 0}&controls=0&rel=0`;

  const ensureIframe = () => {
    if (iframeEl) return iframeEl;
    iframeEl = document.createElement("iframe");
    iframeEl.setAttribute("allow", "autoplay; encrypted-media");
    iframeEl.setAttribute("title", "Audio player");
    iframeEl.style.width = "200px";
    iframeEl.style.height = "113px";
    document.getElementById("ytHost").appendChild(iframeEl);
    return iframeEl;
  };

  const apiFail = () => {
    if (!apiFailed && !ytPlayer) {
      apiFailed = true;
      if (iframeEl) { iframeEl.remove(); iframeEl = null; }
    }
  };

  const tag = document.createElement("script");
  tag.src = "https://www.youtube.com/iframe_api";
  tag.onerror = apiFail;
  document.head.appendChild(tag);

  window.onYouTubeIframeAPIReady = () => {
    try {
      if (iframeEl) { iframeEl.remove(); iframeEl = null; }
      ytPlayer = new YT.Player("ytPlayer", {
        width: 200,
        height: 113,
        playerVars: { playsinline: 1, rel: 0 },
        events: {
          onReady: () => {
            if (!bootDone) return; // restore init will cue the correct video
            const tr = tracks[idx];
            if (tr && tr.vid && !playing) {
              try { ytPlayer.cueVideoById(tr.vid, t > 0 ? t : undefined); } catch (_) {}
            }
          },
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.ENDED) {
              if (repeat) {
                if (ytPlayer && tracks[idx] && tracks[idx].vid) { try { ytPlayer.seekTo(0, true); } catch (_) {} }
                else t = 0;
              }
              else next();
            } else if (e.data === YT.PlayerState.PLAYING && !playing) {
              play();
            } else if (e.data === YT.PlayerState.PAUSED && playing && Date.now() > switchingUntil) {
              pause();
            }
          },
          onError: () => {
            if (tracks[idx] && tracks[idx].vid) {
              tracks[idx].vid = null;
              try { ytPlayer.stopVideo(); } catch (_) {}
            }
            next();
          },
        },
      });
    } catch (_) {
      apiFail();
    }
  };
  setTimeout(() => { if (!ytPlayer) apiFail(); }, 5000);

  const playLive = () => {
    if (!tracks[idx] || !tracks[idx].vid) return;
    if (ytPlayer) {
      try { ytPlayer.playVideo(); } catch (_) {}
    } else {
      apiFail();
      try { ensureIframe().src = embedSrc(tracks[idx].vid, true); } catch (_) {}
    }
  };

  const pauseLive = () => {
    if (!tracks[idx] || !tracks[idx].vid) return;
    if (ytPlayer) {
      try { ytPlayer.pauseVideo(); } catch (_) {}
    } else if (iframeEl) {
      try { iframeEl.src = embedSrc(tracks[idx].vid, false); } catch (_) {}
    }
  };

  const catalogs = {
    bollywood: { file: `playlist-bollywood-250.csv?v=${Date.now()}`, tracks: null },
    hollywood: { file: `playlist-english-top.csv?v=${Date.now()}`, tracks: null },
  };

  let genre = "bollywood";

  const fetchCatalog = (key) =>
    fetch(catalogs[key].file)
      .then((r) => r.text())
      .then((csv) => { catalogs[key].tracks = parsePlaylist(csv); })
      .catch(() => {});

  const genreLabel = (key) => (key === "hollywood" ? "Hollywood" : "Bollywood");

  const syncGenreUI = () => {
    document.querySelectorAll(".genre-tab__btn").forEach((b) => {
      const on = b.dataset.genre === genre;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    const sg = document.getElementById("statGenre");
    if (sg) sg.textContent = genreLabel(genre);
  };

  const useGenre = (key, autoplay) => {
    const list = catalogs[key] && catalogs[key].tracks && catalogs[key].tracks.length
      ? catalogs[key].tracks
      : fallbackTracks.slice();
    genre = key;
    tracks = list;
    idx = 0;
    renderPlaylist();
    if (autoplay) startTrack(0);
    else load(0);
    syncGenreUI();
  };

  document.querySelectorAll(".genre-tab__btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const g = btn.dataset.genre;
      if (g === genre) return;
      if (catalogs[g] && catalogs[g].tracks) {
        useGenre(g, true);
      } else {
        genre = g;
        syncGenreUI();
        fetchCatalog(g).then(() => useGenre(g, true));
      }
    });
  });

  Promise.all([fetchCatalog("bollywood"), fetchCatalog("hollywood")]).then(() => {
    const saved = readSaved();
    if (saved && saved.genre && catalogs[saved.genre] && catalogs[saved.genre].tracks && catalogs[saved.genre].tracks.length) {
      genre = saved.genre;
    }
    if (catalogs[genre] && catalogs[genre].tracks && catalogs[genre].tracks.length) {
      tracks = catalogs[genre].tracks;
    }
    const pastedSaved = loadPasted();
    for (let p = pastedSaved.length - 1; p >= 0; p--) {
      const pt = pastedSaved[p];
      if (pt && pt.vid && !tracks.some((tr) => tr.vid === pt.vid)) tracks.unshift(pt);
    }
    syncGenreUI();
    let startIdx = 0;
    let startT = 0;
    if (saved) {
      let i = -1;
      if (saved.vid) i = tracks.findIndex((tr) => tr.vid === saved.vid);
      if (i < 0 && saved.title) i = tracks.findIndex((tr) => tr.title === saved.title);
      if (i >= 0) {
        startIdx = i;
        startT = Math.max(0, Number(saved.t) || 0);
      }
    }
    renderPlaylist();
    bootDone = true;
    load(startIdx, startT);
  });

  const bar = document.getElementById("playerBar");
  const cover = document.getElementById("cover");
  const eq = document.getElementById("eq");
  const marqueeText = document.getElementById("marqueeText");
  const titleEl = document.getElementById("trackTitle");
  const artistEl = document.getElementById("trackArtist");
  const playBtn = document.getElementById("btnPlay");
  const playIcon = document.getElementById("playIcon");
  const prevBtn = document.getElementById("btnPrev");
  const nextBtn = document.getElementById("btnNext");
  const shuffleBtn = document.getElementById("btnShuffle");
  const repeatBtn = document.getElementById("btnRepeat");
  const listBtn = document.getElementById("btnList");
  const playlistPanel = document.getElementById("playlistPanel");
  const playlistScrim = document.getElementById("playlistScrim");
  const playlistList = document.getElementById("playlistList");
  const playlistCount = document.getElementById("playlistCount");
  const rail = document.getElementById("rail");
  const fill = document.getElementById("fill");
  const curEl = document.getElementById("timeCurrent");
  const totalEl = document.getElementById("timeTotal");
  const volInput = document.getElementById("volume");
  const searchInput = document.getElementById("playlistSearch");
  const viewAllBtn = document.getElementById("viewAll");
  const viewFavsBtn = document.getElementById("viewFavs");
  const btnFav = document.getElementById("btnFav");
  const ytLinkInput = document.getElementById("ytLink");
  const btnFetchLink = document.getElementById("btnFetchLink");

  let idx = 0;
  let playing = false;
  let t = 0;
  let raf = null;
  let lastTs = null;
  let shuffle = false;
  let repeat = false;

  /* ---------- Favourites + resume state ---------- */
  const LS_LAST = "gm:lastTrack";
  const LS_FAVS = "gm:favSongs";
  const LS_PASTED = "gm:pastedSongs";
  let view = "all";
  let searchTerm = "";
  let pendingSeek = null;
  let lastUiSync = 0;
  let bootDone = false;
  let silentSince = null;
  let switchingUntil = 0;

  let favs = (() => {
    try { return new Set(JSON.parse(localStorage.getItem(LS_FAVS)) || []); }
    catch (_) { return new Set(); }
  })();

  const favKey = (tr) => tr.vid || tr.title;
  const isFav = (tr) => favs.has(favKey(tr));

  const toggleFav = (i) => {
    if (!tracks[i]) return;
    const k = favKey(tracks[i]);
    if (favs.has(k)) favs.delete(k);
    else favs.add(k);
    try { localStorage.setItem(LS_FAVS, JSON.stringify([...favs])); } catch (_) {}
    renderPlaylist();
    syncFavBtn();
  };

  const syncFavBtn = () => {
    if (!btnFav || !tracks[idx]) return;
    const on = isFav(tracks[idx]);
    btnFav.classList.toggle("is-fav", on);
    btnFav.setAttribute("aria-pressed", String(on));
    btnFav.title = on ? "Remove from favourites" : "Add to favourites";
  };

  const persistPosition = () => {
    try {
      localStorage.setItem(LS_LAST, JSON.stringify({
        vid: tracks[idx].vid || null,
        title: tracks[idx].title,
        t,
        genre,
        playing,
      }));
    } catch (_) {}
  };

  const readSaved = () => {
    try { return JSON.parse(localStorage.getItem(LS_LAST)); }
    catch (_) { return null; }
  };

  /* ---------- Paste YouTube link -> play ---------- */
  const extractVideoId = (str) => {
    const s = String(str || "").trim();
    if (/^[\w-]{11}$/.test(s)) return s;
    const m = s.match(/(?:youtube\.com\/(?:watch\?[^#]*v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})/);
    return m ? m[1] : null;
  };

  const loadPasted = () => {
    try {
      const a = JSON.parse(localStorage.getItem(LS_PASTED));
      return Array.isArray(a) ? a : [];
    } catch (_) { return []; }
  };

  const savePasted = (arr) => {
    try { localStorage.setItem(LS_PASTED, JSON.stringify(arr.slice(0, 30))); } catch (_) {}
  };

  /* Same cleanup as tools/update-playlist.js — keeps names in the site's usual format */
  const cleanTitle = (title) => {
    let x = String(title || "");
    x = x.replace(/[([{][^)\]}]*?(official|video|audio|song|lyrical|lyrics|music)[^)\]}]*?[)\]}]/gi, " ");
    x = x.replace(/\s*[|·]\s*(official|full song|video song).*$/gi, "");
    x = x.replace(/\s{2,}/g, " ").trim();
    x = x.replace(/^["'`]+|["'`]+$/g, "").trim();
    x = x.replace(/\s*[-–|]\s*$/, "").trim();
    return x || title;
  };

  const deriveArtist = (title, fallbackChannel) => {
    const parts = String(title || "").split(/\s+[-–]\s+/);
    if (parts.length >= 2 && parts[0].length <= 40) return parts[0].trim();
    return fallbackChannel || "";
  };

  const handlePastedLink = async () => {
    const raw = ytLinkInput.value.trim();
    if (!raw || btnFetchLink.disabled) return;
    const vid = extractVideoId(raw);
    if (!vid) {
      ytLinkInput.classList.add("is-error");
      setTimeout(() => ytLinkInput.classList.remove("is-error"), 1200);
      return;
    }
    const existingIdx = tracks.findIndex((tr) => tr.vid === vid);
    if (existingIdx >= 0) {
      ytLinkInput.value = "";
      startTrack(existingIdx);
      updateActive();
      setList(true);
      return;
    }
    btnFetchLink.disabled = true;
    btnFetchLink.textContent = "...";
    let title = "YouTube Song";
    let artist = "Unknown artist";
    try {
      const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${vid}`);
      const data = await res.json();
      if (data && data.title) title = data.title;
      if (data && data.author_name) artist = data.author_name;
    } catch (_) {}
    title = cleanTitle(title);
    artist = deriveArtist(title, artist) || artist;
    const tr = { title, artist, dur: 0, vid };
    savePasted([tr, ...loadPasted().filter((p) => p.vid !== vid)]);
    tracks.unshift(tr);
    idx += 1; // existing indices shifted by the top insert
    renderPlaylist();
    ytLinkInput.value = "";
    btnFetchLink.disabled = false;
    btnFetchLink.textContent = "Play";
    startTrack(0);
    updateActive();
    setList(true);
  };

  const fmtTime = (s) => `${Math.floor(s / 60)}:${fmt(s % 60)}`;

  const favIndices = () => {
    const a = [];
    tracks.forEach((tr, i) => { if (isFav(tr)) a.push(i); });
    return a;
  };

  const pickNext = (fwd) => {
    const pool = view === "favs" ? favIndices() : null;
    if (pool && pool.length) {
      if (shuffle) {
        let n;
        do { n = pool[Math.floor(Math.random() * pool.length)]; } while (n === idx && pool.length > 1);
        return n;
      }
      const pos = pool.indexOf(idx);
      if (pos === -1) return fwd ? pool[0] : pool[pool.length - 1];
      return fwd ? pool[(pos + 1) % pool.length] : pool[(pos - 1 + pool.length) % pool.length];
    }
    if (shuffle) {
      let n;
      do { n = Math.floor(Math.random() * tracks.length); } while (n === idx && tracks.length > 1);
      return n;
    }
    if (fwd) return (idx + 1) % tracks.length;
    return (idx - 1 + tracks.length) % tracks.length;
  };

  const fmtDur = (s) => `${Math.floor(s / 60)}:${fmt(s % 60)}`;

  const updateActive = () => {
    if (!playlistList) return;
    playlistList.querySelectorAll(".playlist__item").forEach((el) => {
      el.classList.toggle("is-active", Number(el.dataset.i) === idx);
    });
    const active = playlistList.querySelector(`.playlist__item[data-i="${idx}"]`);
    if (active) active.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const matchesFilters = (tr) =>
    (view !== "favs" || isFav(tr)) &&
    (!searchTerm || `${tr.title} ${tr.artist}`.toLowerCase().includes(searchTerm));

  const renderPlaylist = () => {
    if (!playlistList) return;
    playlistList.innerHTML = "";
    const frag = document.createDocumentFragment();
    let shown = 0;
    tracks.forEach((tr, i) => {
      if (!matchesFilters(tr)) return;
      shown++;
      const li = document.createElement("li");
      li.className = "playlist__item";
      li.setAttribute("role", "button");
      li.tabIndex = 0;
      li.dataset.i = i;
      li.style.setProperty("--i", shown - 1);
      const shortName = tr.title.length > 20 ? `${tr.title.slice(0, 20).trimEnd()}...` : tr.title;
      li.innerHTML = `
        <button class="playlist__fav${isFav(tr) ? " is-fav" : ""}" title="Favourite" aria-label="Toggle favourite">
          <svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
        </button>
        <span class="playlist__num">${String(i + 1).padStart(2, "0")}</span>
        <span class="playlist__meta" title="${escapeHtml(tr.title)}">
          <span class="playlist__name">${escapeHtml(shortName)}</span>
          <span class="playlist__sub">${escapeHtml(tr.artist || "")}</span>
        </span>
        <span class="playlist__dur">${fmtDur(tr.dur)}</span>`;
      li.addEventListener("click", () => select(i));
      li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(i); } });
      li.querySelector(".playlist__fav").addEventListener("click", (e) => {
        e.stopPropagation();
        toggleFav(i);
      });
      frag.appendChild(li);
    });
    playlistList.appendChild(frag);
    playlistCount.textContent = `${shown} songs`;
    if (!shown) {
      const empty = document.createElement("li");
      empty.className = "playlist__empty";
      empty.textContent = view === "favs"
        ? "No favourites yet — tap the heart on any song"
        : `No songs found${searchTerm ? ` for "${searchInput.value.trim()}"` : ""}`;
      playlistList.appendChild(empty);
    }
    playlistList.scrollTop = 0;
    syncListHeight();
    updateActive();
  };

  const syncListHeight = () => {
    if (!playlistList || !playlistPanel || playlistPanel.hidden) return;
    const targetH = Math.min(
      Math.max(playlistList.scrollHeight, 120),
      Math.round(window.innerHeight * 0.58)
    );
    playlistList.style.height = `${targetH}px`;
  };

  const select = (i) => {
    startTrack(i);
    updateActive();
  };

  const escapeHtml = (s) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const updateMediaMetadata = () => {
    if (!("mediaSession" in navigator) || !window.MediaMetadata) return;
    try {
      const tr = tracks[idx];
      navigator.mediaSession.metadata = new MediaMetadata({
        title: tr.title,
        artist: tr.artist,
        album: "GENZ MUSIC Radio",
        artwork: tr.vid
          ? [{ src: `https://i.ytimg.com/vi/${tr.vid}/hqdefault.jpg`, sizes: "480x360", type: "image/jpeg" }]
          : [],
      });
    } catch (_) {}
  };

  const load = (i, resumeAt = 0, autoplay = false) => {
    idx = i;
    const tr = tracks[idx];
    titleEl.textContent = tr.title;
    artistEl.textContent = tr.artist;
    if (marqueeText) {
      const s = `Now playing — ${tr.title} · ${tr.artist} · GENZ MUSIC Radio · `;
      marqueeText.textContent = s + s;
    }
    if (cover) {
      const note = cover.querySelector("svg");
      if (tr.vid) {
        cover.style.backgroundImage = `url(https://i.ytimg.com/vi/${tr.vid}/hqdefault.jpg)`;
        cover.style.backgroundSize = "cover";
        cover.style.backgroundPosition = "center";
        if (note) note.style.display = "none";
      } else {
        cover.style.backgroundImage = "none";
        if (note) note.style.display = "";
      }
    }
    totalEl.textContent = fmtTime(tr.dur);
    t = Math.min(resumeAt || 0, tr.dur);
    curEl.textContent = fmtTime(Math.floor(t));
    fill.style.width = `${(t / tr.dur) * 100}%`;
    const wantPlay = autoplay || playing;
    if (ytPlayer) {
      if (tr.vid) {
        if (wantPlay) {
          ytPlayer.loadVideoById(tr.vid, resumeAt > 0 ? resumeAt : undefined);
        } else {
          ytPlayer.cueVideoById(tr.vid, resumeAt > 0 ? resumeAt : undefined);
        }
      } else {
        try { ytPlayer.stopVideo(); } catch (_) {}
      }
    } else if (apiFailed && iframeEl) {
      iframeEl.src = tr.vid ? embedSrc(tr.vid, wantPlay) : "about:blank";
    }
    updateMediaMetadata();
    persistPosition();
    updateActive();
    syncFavBtn();
  };

  const step = (ts) => {
    if (lastTs === null) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (pendingSeek != null && ytPlayer && typeof ytPlayer.seekTo === "function") {
      try { ytPlayer.seekTo(pendingSeek, true); } catch (_) {}
      pendingSeek = null;
    }
    let durNow = tracks[idx].dur;
    if (ytPlayer && tracks[idx] && tracks[idx].vid) {
      const dur = ytPlayer.getDuration() || tracks[idx].dur;
      durNow = dur;
      t = ytPlayer.getCurrentTime() || t + dt;
      if (Math.abs(dur - tracks[idx].dur) > 1) {
        totalEl.textContent = fmtTime(dur);
        if (dur > 1) {
          tracks[idx].dur = Math.round(dur);
          const durCell = playlistList && playlistList.querySelector(`li[data-i="${idx}"] .playlist__dur`);
          if (durCell) durCell.textContent = fmtDur(tracks[idx].dur);
          const pastedList = loadPasted();
          const hit = pastedList.find((x) => x && x.vid === tracks[idx].vid);
          if (hit && hit.dur !== tracks[idx].dur) {
            hit.dur = tracks[idx].dur;
            savePasted(pastedList);
          }
        }
      }
      curEl.textContent = fmtTime(Math.floor(t));
      fill.style.width = `${Math.min(100, (t / dur) * 100)}%`;
    } else {
      t = Math.min(t + dt, tracks[idx].dur);
      curEl.textContent = fmtTime(Math.floor(t));
      fill.style.width = `${(t / tracks[idx].dur) * 100}%`;
      if (t >= tracks[idx].dur) {
        if (repeat) { t = 0; }
        else { nextBtn.click(); }
      }
    }
    if (ts - lastUiSync > 1000) {
      lastUiSync = ts;
      persistPosition();
      if ("mediaSession" in navigator && navigator.mediaSession.setPositionState) {
        try {
          if (isFinite(durNow) && durNow > 0) {
            navigator.mediaSession.setPositionState({
              duration: durNow,
              position: Math.min(Math.max(0, t), durNow),
              playbackRate: 1,
            });
          }
        } catch (_) {}
      }
    }
    raf = requestAnimationFrame(step);
  };

  const play = () => {
    playing = true;
    bar.classList.add("is-playing");
    document.body.classList.add("is-playing");
    if (eq) eq.classList.add("is-on");
    playIcon.innerHTML = '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>';
    playBtn.setAttribute("aria-label", "Pause");
    if (pendingSeek != null) {
      const s = pendingSeek;
      pendingSeek = null;
      if (ytPlayer && tracks[idx] && tracks[idx].vid) {
        try {
          ytPlayer.loadVideoById({ videoId: tracks[idx].vid, startSeconds: s });
        } catch (_) {}
      }
    }
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
    playLive();
    lastTs = null;
    raf = requestAnimationFrame(step);
  };

  const pause = () => {
    playing = false;
    bar.classList.remove("is-playing");
    document.body.classList.remove("is-playing");
    if (eq) eq.classList.remove("is-on");
    playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
    playBtn.setAttribute("aria-label", "Play");
    pauseLive();
    cancelAnimationFrame(raf);
    persistPosition();
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
  };

  const toggle = () => (playing ? pause() : play());

  /* Hard-start a track: always loadVideoById (guaranteed autoplay), no cue+play races */
  const startTrack = (i) => {
    switchingUntil = Date.now() + 3000;
    silentSince = null;
    load(i, 0, true);
    if (!playing) {
      playing = true;
      bar.classList.add("is-playing");
      document.body.classList.add("is-playing");
      if (eq) eq.classList.add("is-on");
      playIcon.innerHTML = '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>';
      playBtn.setAttribute("aria-label", "Pause");
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
      lastTs = null;
      raf = requestAnimationFrame(step);
    }
  };

  const next = () => startTrack(pickNext(true));
  const prev = () => {
    if (t > 3) {
      t = 0;
      curEl.textContent = "0:00";
      fill.style.width = "0%";
      if (ytPlayer) { try { ytPlayer.seekTo(0, true); } catch (_) {} }
    } else {
      startTrack(pickNext(false));
    }
  };

  playBtn.addEventListener("click", toggle);
  nextBtn.addEventListener("click", next);
  prevBtn.addEventListener("click", prev);

  /* ---------- Headphone / earbuds hardware controls (Media Session) ---------- */
  const seekRel = (delta) => {
    if (!tracks[idx]) return;
    const d = (ytPlayer && tracks[idx].vid && ytPlayer.getDuration()) || tracks[idx].dur;
    t = Math.min(Math.max(0, t + delta), d);
    curEl.textContent = fmtTime(Math.floor(t));
    fill.style.width = `${(t / d) * 100}%`;
    pendingSeek = null;
    if (ytPlayer && tracks[idx].vid) {
      try { ytPlayer.seekTo(t, true); } catch (_) {}
    }
  };

  if ("mediaSession" in navigator) {
    const setHandler = (action, fn) => {
      try { navigator.mediaSession.setActionHandler(action, fn); } catch (_) {}
    };
    setHandler("play", () => { if (!playing) play(); });
    setHandler("pause", () => { if (playing) pause(); });
    setHandler("previoustrack", () => prev());
    setHandler("nexttrack", () => next());
    setHandler("seekbackward", (d) => seekRel(-(d.seekOffset || 10)));
    setHandler("seekforward", (d) => seekRel(d.seekOffset || 10));
  }

  /* ---------- Playlist views + search ---------- */
  const setView = (v) => {
    view = v;
    viewAllBtn.classList.toggle("is-active", v === "all");
    viewFavsBtn.classList.toggle("is-active", v === "favs");
    viewAllBtn.setAttribute("aria-pressed", String(v === "all"));
    viewFavsBtn.setAttribute("aria-pressed", String(v === "favs"));
    renderPlaylist();
  };

  viewAllBtn.addEventListener("click", () => setView("all"));
  viewFavsBtn.addEventListener("click", () => setView("favs"));
  btnFav.addEventListener("click", () => toggleFav(idx));
  ytLinkInput.addEventListener("keydown", (e) => { if (e.key === "Enter") handlePastedLink(); });
  btnFetchLink.addEventListener("click", handlePastedLink);
  searchInput.addEventListener("input", () => {
    searchTerm = searchInput.value.trim().toLowerCase();
    renderPlaylist();
  });

  window.addEventListener("pagehide", persistPosition);
  window.addEventListener("beforeunload", persistPosition);

  /* ---------- Truth-sync: keep UI in step with the real YT player state.
     Catches pauses/plays made by hardware buttons, lock screen, other tabs. ---------- */
  setInterval(() => {
    if (!ytPlayer || !bootDone || pendingSeek != null) return;
    if (Date.now() < switchingUntil) return; // track change in progress — hands off
    let st = -99;
    try { st = ytPlayer.getPlayerState(); } catch (_) { return; }
    if (st === 2 && playing) pause();
    else if (st === 1 && !playing) play();
    if (playing && tracks[idx] && tracks[idx].vid && (st === 5 || st === -1)) {
      if (!silentSince) {
        silentSince = Date.now();
      } else if (Date.now() - silentSince > 1500) {
        silentSince = null;
        try {
          ytPlayer.loadVideoById({ videoId: tracks[idx].vid, startSeconds: t > 3 ? t : 0 });
        } catch (_) {}
      }
    } else {
      silentSince = null;
    }
  }, 400);

  shuffleBtn.addEventListener("click", () => {
    shuffle = !shuffle;
    shuffleBtn.style.color = shuffle ? "var(--accent)" : "";
    shuffleBtn.style.textShadow = shuffle ? "0 0 10px rgba(230, 184, 76, 0.55)" : "";
  });

  repeatBtn.addEventListener("click", () => {
    repeat = !repeat;
    repeatBtn.style.color = repeat ? "var(--accent)" : "";
    repeatBtn.style.textShadow = repeat ? "0 0 10px rgba(230, 184, 76, 0.55)" : "";
  });

  const setList = (open) => {
    if (!playlistPanel || !playlistScrim) return;
    playlistPanel.hidden = !open;
    playlistScrim.hidden = !open;
    listBtn.setAttribute("aria-expanded", String(open));
    listBtn.title = open ? "Hide playlist" : "Show playlist";
    if (open) {
      updateActive();
      syncListHeight();
    }
  };

  listBtn.addEventListener("click", () => setList(playlistPanel.hidden));
  playlistScrim.addEventListener("click", () => setList(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setList(false); });

  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space") return;
    const el = document.activeElement;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
    e.preventDefault();
    toggle();
  });

  volInput.addEventListener("input", () => {
    const v = Number(volInput.value) || 0;
    if (ytPlayer) { try { ytPlayer.setVolume(v); } catch (_) {} }
  });

  rail.addEventListener("click", (e) => {
    const r = rail.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    t = p * tracks[idx].dur;
    curEl.textContent = fmtTime(Math.floor(t));
    fill.style.width = `${p * 100}%`;
    pendingSeek = null;
    if (ytPlayer) {
      try { ytPlayer.seekTo(t, true); } catch (_) {}
    }
    persistPosition();
  });
})();
