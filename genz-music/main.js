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
          onReady: () => { load(idx); if (playing) playLive(); },
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.ENDED) {
              if (repeat) {
                if (ytPlayer && tracks[idx] && tracks[idx].vid) { try { ytPlayer.seekTo(0, true); } catch (_) {} }
                else t = 0;
              }
              else next();
            } else if (e.data === YT.PlayerState.PLAYING && !playing) {
              play();
            }
          },
          onError: () => {
            if (tracks[idx] && tracks[idx].vid) {
              tracks[idx].vid = null;
              try { ytPlayer.stopVideo(); } catch (_) {}
            }
            next(playing);
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
    bollywood: { file: "playlist-bollywood-250.csv?v=3", tracks: null },
    hollywood: { file: "playlist-english-top.csv?v=1", tracks: null },
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
    load(0);
    syncGenreUI();
    if (autoplay) play();
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
    if (catalogs.bollywood.tracks) tracks = catalogs.bollywood.tracks;
    renderPlaylist();
    load(0);
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

  let idx = 0;
  let playing = false;
  let t = 0;
  let raf = null;
  let lastTs = null;
  let shuffle = false;
  let repeat = false;

  const fmtTime = (s) => `${Math.floor(s / 60)}:${fmt(s % 60)}`;

  const pickNext = (fwd) => {
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
    const items = playlistList.querySelectorAll(".playlist__item");
    items.forEach((el, i) => el.classList.toggle("is-active", i === idx));
    const active = items[idx];
    if (active) active.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const renderPlaylist = () => {
    if (!playlistList) return;
    playlistList.innerHTML = "";
    const frag = document.createDocumentFragment();
    tracks.forEach((tr, i) => {
      const li = document.createElement("li");
      li.className = "playlist__item";
      li.setAttribute("role", "button");
      li.tabIndex = 0;
      li.style.setProperty("--i", i);
      li.innerHTML = `
        <span class="playlist__num">${String(i + 1).padStart(2, "0")}</span>
        <span class="playlist__meta">
          <span class="playlist__name">${escapeHtml(tr.title)}</span>
          <span class="playlist__sub">${escapeHtml(tr.artist)}</span>
        </span>
        <span class="playlist__dur">${fmtDur(tr.dur)}</span>`;
      li.addEventListener("click", () => select(i));
      li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(i); } });
      frag.appendChild(li);
    });
    playlistList.appendChild(frag);
    playlistCount.textContent = `${tracks.length} songs`;
    updateActive();
  };

  const select = (i) => {
    load(i);
    play();
    updateActive();
  };

  const escapeHtml = (s) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const load = (i) => {
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
    t = 0;
    curEl.textContent = "0:00";
    fill.style.width = "0%";
    if (ytPlayer) {
      if (tr.vid) {
        if (playing) ytPlayer.loadVideoById(tr.vid);
        else ytPlayer.cueVideoById(tr.vid);
      } else {
        try { ytPlayer.stopVideo(); } catch (_) {}
      }
    } else if (apiFailed && iframeEl) {
      iframeEl.src = tr.vid ? embedSrc(tr.vid, playing) : "about:blank";
    }
    updateActive();
  };

  const step = (ts) => {
    if (lastTs === null) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (ytPlayer && tracks[idx] && tracks[idx].vid) {
      const dur = ytPlayer.getDuration() || tracks[idx].dur;
      t = ytPlayer.getCurrentTime() || t + dt;
      if (Math.abs(dur - tracks[idx].dur) > 1) totalEl.textContent = fmtTime(dur);
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
    raf = requestAnimationFrame(step);
  };

  const play = () => {
    playing = true;
    bar.classList.add("is-playing");
    document.body.classList.add("is-playing");
    if (eq) eq.classList.add("is-on");
    playIcon.innerHTML = '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>';
    playBtn.setAttribute("aria-label", "Pause");
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
  };

  const toggle = () => (playing ? pause() : play());

  const next = (force = false) => { load(pickNext(true)); if (force || playing) play(); };
  const prev = (force = false) => {
    if (t > 3) {
      t = 0;
      curEl.textContent = "0:00";
      fill.style.width = "0%";
      if (ytPlayer) { try { ytPlayer.seekTo(0, true); } catch (_) {} }
    } else {
      load(pickNext(false));
      if (force || playing) play();
    }
  };

  playBtn.addEventListener("click", toggle);
  nextBtn.addEventListener("click", () => next(true));
  prevBtn.addEventListener("click", () => prev(true));

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
    if (open) updateActive();
  };

  listBtn.addEventListener("click", () => setList(playlistPanel.hidden));
  playlistScrim.addEventListener("click", () => setList(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setList(false); });

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
    if (ytPlayer) {
      try { ytPlayer.seekTo(t, true); } catch (_) {}
    }
  });

  load(0);
})();
