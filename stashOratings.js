(function () {
  "use strict";

  const PLUGIN_ID = "stashOratings";
  const KEY_R = "oRatings";   // ratings of every O (including the first): "sceneId|epochMs" -> rating100
  const KEY_C = "oComments";  // comments (any O):                    "sceneId|epochMs" -> text
  // O ratings are fully independent of the scene rating. By default the first O has
  // no rating; the button on the plugins page can snapshot the scene rating onto it.

  async function gql(query, variables) {
    const r = await fetch("/graphql", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: variables || {} }),
    });
    const j = await r.json();
    if (j.errors && j.errors.length) throw new Error(j.errors.map(e => e.message).join("; "));
    return j.data;
  }

  // ── Storage ───────────────────────────────────────────────────────────────
  const keyOf = (sceneId, ts) => `${sceneId}|${new Date(ts).getTime()}`;

  function normalize(raw) {
    const out = {};
    Object.keys(raw || {}).forEach(k => {
      const i = k.indexOf("|");
      if (i < 0) return;
      const rest = k.slice(i + 1);
      const ms = /^\d+$/.test(rest) ? Number(rest) : new Date(rest).getTime();
      if (!isNaN(ms)) out[`${k.slice(0, i)}|${ms}`] = raw[k];
    });
    return out;
  }

  let store = null, queue = Promise.resolve();

  async function readConfig() {
    const d = await gql(`query { configuration { plugins } }`);
    return (d.configuration.plugins || {})[PLUGIN_ID] || {};
  }
  async function loadStore() {
    if (!store) {
      const cfg = await readConfig();
      store = { ratings: normalize(cfg[KEY_R]), comments: normalize(cfg[KEY_C]) };
    }
    return store;
  }

  // Saves an O's rating/comment in the plugin config (never touches the scene rating).
  function saveEntry(sceneId, ts, { rating100, comment }) {
    const run = queue.catch(() => {}).then(async () => {
      const key = keyOf(sceneId, ts);
      const cfg = await readConfig();
      const ratings = normalize(cfg[KEY_R]), comments = normalize(cfg[KEY_C]);
      if (rating100 != null) ratings[key] = rating100;
      if (comment) comments[key] = comment; else delete comments[key];
      await gql(`mutation($id: ID!, $input: Map!) { configurePlugin(plugin_id:$id, input:$input) }`,
        { id: PLUGIN_ID, input: { ...cfg, [KEY_R]: ratings, [KEY_C]: comments } });
      store = { ratings, comments };
      scheduleDecorate();
    });
    queue = run;
    return run;
  }

  // ── Scene info (O history sorted oldest→newest + scene rating) ────────────
  let sceneCache = { sceneId: null, data: null };
  const invalidateScene = () => { sceneCache = { sceneId: null, data: null }; };

  async function getScene(sceneId) {
    if (sceneCache.sceneId !== sceneId || !sceneCache.data) {
      const d = await gql(`query($id: ID!) { findScene(id:$id) { o_history rating100 } }`, { id: sceneId });
      const s = d.findScene || {};
      const history = (s.o_history || [])
        .map(ts => ({ ts, ms: new Date(ts).getTime() })).filter(x => !isNaN(x.ms))
        .sort((a, b) => a.ms - b.ms);
      sceneCache = { sceneId, data: { rating100: s.rating100 == null ? null : s.rating100, history } };
    }
    return sceneCache.data;
  }

  async function latestOTimestamp(sceneId, res) {
    try {
      const data = await res.clone().json();
      const m = data && data.data && (data.data.sceneAddO || data.data.sceneIncrementO);
      if (m && Array.isArray(m.history) && m.history.length)
        return m.history.reduce((a, b) => new Date(a) > new Date(b) ? a : b);
    } catch (e) {}
    const h = (await getScene(sceneId)).history;
    return h.length ? h[h.length - 1].ts : null;
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  const style = document.createElement("style");
  style.textContent = `
    .stash-plus-orate{position:fixed;z-index:2000;background:#1f1f24;color:#e8e8e8;border:1px solid rgba(255,200,80,.5);
      border-radius:8px;padding:.6rem .7rem;box-shadow:0 6px 24px rgba(0,0,0,.5);font-size:.85rem;display:flex;flex-direction:column;gap:.4rem;width:260px}
    .stash-plus-orate input,.stash-plus-orate textarea{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.2);border-radius:5px;color:inherit;padding:.25rem .4rem;width:100%;font:inherit}
    .stash-plus-orate textarea{resize:vertical}
    .stash-plus-orate .row{display:flex;gap:.4rem}
    .stash-plus-orate button{flex:1;border-radius:5px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.07);color:inherit;padding:.25rem;cursor:pointer}
    .stash-plus-orate button.save{background:#ffc850;color:#2b2b2b;border-color:#ffc850;font-weight:700}
    .stash-plus-orate .note{font-size:.72rem;opacity:.65}
    .stash-plus-orate .err{color:#e06c75;font-size:.75rem}
    .stash-orate-badge,.stash-orate-comment{margin-left:.6rem;border:1px solid rgba(255,200,80,.5);background:rgba(255,200,80,.12);color:#ffc850;
      border-radius:5px;padding:0 .45rem;font-size:.75rem;line-height:1.5;cursor:pointer}
    .stash-orate-comment{margin-left:.35rem}
    .stash-orate-bubble{position:fixed;z-index:2100;max-width:320px;background:#ffc850;color:#2b2b2b;border-radius:16px 16px 16px 4px;
      padding:.6rem .85rem;box-shadow:0 6px 24px rgba(0,0,0,.5);font-size:.88rem;line-height:1.4;white-space:pre-wrap;word-break:break-word}`;
  document.head.appendChild(style);

  // ── Comment bubble ────────────────────────────────────────────────────────
  let bubble = null, bubbleOff = null;
  function closeBubble() {
    if (bubble) { bubble.remove(); bubble = null; }
    if (bubbleOff) { bubbleOff(); bubbleOff = null; }
  }
  function showComment(anchorEl, text) {
    closeBubble();
    const el = document.createElement("div");
    el.className = "stash-orate-bubble";
    el.textContent = text;
    document.body.appendChild(el);
    bubble = el;
    const a = anchorEl.getBoundingClientRect();
    const w = el.offsetWidth, hgt = el.offsetHeight;
    el.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, a.left)) + "px";
    const below = a.bottom + 8 + hgt < window.innerHeight;
    el.style.top = (below ? a.bottom + 8 : Math.max(8, a.top - hgt - 8)) + "px";
    const onDoc = e => { if (!el.contains(e.target)) closeBubble(); };
    const onKey = e => { if (e.key === "Escape") closeBubble(); };
    setTimeout(() => document.addEventListener("click", onDoc), 0);
    document.addEventListener("keydown", onKey);
    bubbleOff = () => { document.removeEventListener("click", onDoc); document.removeEventListener("keydown", onKey); };
  }

  // ── Rating + comment popup ────────────────────────────────────────────────
  let popup = null, lastClick = { el: null, t: 0 };
  document.addEventListener("click", e => {
    lastClick = { el: e.target.closest("button, a, [role=button]"), t: Date.now() };
  }, true);

  function closePopup() { if (popup) { popup.remove(); popup = null; } }

  async function showPopup(sceneId, ts) {
    closePopup();
    let scene, st;
    try { [scene, st] = await Promise.all([getScene(sceneId), loadStore()]); } catch (e) { return; }
    closePopup();

    const key = keyOf(sceneId, ts);
    const existingRating = st.ratings[key] != null ? st.ratings[key] : null;
    const existingComment = st.comments[key] || "";
    const isEdit = existingRating != null || !!existingComment;

    const el = document.createElement("div");
    el.className = "stash-plus-orate";
    el.innerHTML = `<div>${isEdit ? "Edit this O" : "Rate this O"} (0–10)</div>
      <input type="number" min="0" max="10" step="0.5" placeholder="e.g. 8.5">
      <textarea rows="3" placeholder="Comment (optional)"></textarea>
      <div class="err"></div>
      <div class="row"><button class="skip">${isEdit ? "Cancel" : "Skip"}</button><button class="save">Save</button></div>`;
    document.body.appendChild(el);
    popup = el;

    const a = lastClick.el && Date.now() - lastClick.t < 5000 ? lastClick.el.getBoundingClientRect() : null;
    const w = el.offsetWidth, hgt = el.offsetHeight;
    if (a) {
      el.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, a.left)) + "px";
      const below = a.bottom + 8 + hgt < window.innerHeight;
      el.style.top = (below ? a.bottom + 8 : Math.max(8, a.top - hgt - 8)) + "px";
    } else { el.style.right = "16px"; el.style.bottom = "16px"; }

    const input = el.querySelector("input"), ta = el.querySelector("textarea"), err = el.querySelector(".err");
    if (existingRating != null) input.value = existingRating / 10;
    ta.value = existingComment;
    input.focus();

    const save = async () => {
      const rv = input.value.trim();
      let rating100 = null;
      if (rv !== "") {
        const v = parseFloat(rv);
        if (isNaN(v) || v < 0 || v > 10) { err.textContent = "Rating must be 0–10"; return; }
        rating100 = Math.round(v * 10);
      }
      const comment = ta.value.trim();
      if (rating100 == null && !comment && !existingComment) { err.textContent = "Enter a rating or a comment"; return; }
      try {
        await saveEntry(sceneId, ts, { rating100, comment });
        closePopup();
      } catch (e) { err.textContent = "Save failed: " + e.message; }
    };
    el.querySelector(".save").onclick = save;
    el.querySelector(".skip").onclick = closePopup;
    el.addEventListener("keydown", e => {
      e.stopPropagation();
      if (e.key === "Escape") closePopup();
      else if (e.key === "Enter" && (e.target === input || e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
    });
  }

  // ── History tab: rating badge + comment icon next to each O ───────────────
  // The History tab only shows formatted local date/time text, so each row is
  // matched back to an O event by hour, minute, (seconds), day and year.
  const TIME_RE = /(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?/;
  const YEAR_RE = /\b(19|20)\d{2}\b/;
  const OWN = ".stash-orate-badge, .stash-orate-comment, .stash-orate-bubble, .stash-plus-orate, #stash-orate-fill";

  function matchEntry(text, history) {
    const m = text.match(TIME_RE);
    if (!m) return null;
    const hh = +m[1], mm = +m[2], ss = m[3] != null ? +m[3] : null;
    const rest = text.replace(m[0], " ");
    return history.find(e => {
      const d = new Date(e.ms);
      if (d.getMinutes() !== mm) return false;
      const h = d.getHours();
      if (h !== hh && h % 12 !== hh % 12) return false;
      if (ss != null && d.getSeconds() !== ss) return false;
      if (!text.includes(String(d.getFullYear()))) return false;
      return new RegExp(`(^|\\D)0?${d.getDate()}(\\D|$)`).test(rest);
    }) || null;
  }

  const textOf = el => {
    let t = el.textContent;
    el.querySelectorAll(".stash-orate-badge, .stash-orate-comment").forEach(b => { t = t.replace(b.textContent, ""); });
    return t;
  };
  const hasStamp = t => TIME_RE.test(t) && YEAR_RE.test(t);

  let decorateTimer = null;
  function scheduleDecorate() { clearTimeout(decorateTimer); decorateTimer = setTimeout(decorate, 250); }

  async function decorate() {
    injectSettingsButton();
    try {
      const m = location.pathname.match(/\/scenes\/(\d+)/);
      if (!m) return;
      const sceneId = m[1];
      const findRoot = () => document.querySelector('[id$="scene-history-panel"]') || document.querySelector(".tab-content");
      if (!findRoot()) return;
      const [scene, st] = await Promise.all([getScene(sceneId), loadStore()]);
      const history = scene.history;
      if (!history.length) return;
      const root = findRoot();
      if (!root) return;
      const all = Array.from(root.querySelectorAll("*"))
        .filter(el => !el.closest(OWN) && hasStamp(textOf(el)));
      const smallest = all.filter(el => !all.some(o => o !== el && el.contains(o)));

      smallest.forEach(el => {
        const entry = matchEntry(textOf(el), history);
        if (!entry) return;
        const key = keyOf(sceneId, entry.ts);
        const r = st.ratings[key];
        const c = st.comments[key];

        let b = el.querySelector(":scope > .stash-orate-badge");
        if (!b) {
          b = document.createElement("button");
          b.type = "button";
          b.className = "stash-orate-badge";
          b.onclick = e => { e.stopPropagation(); showPopup(sceneId, entry.ts); };
          el.appendChild(b);
        }
        b.title = "Click to edit rating / comment";
        const label = r != null ? `⭐ ${(r / 10).toFixed(1)}` : "＋ rate";
        if (b.textContent !== label) b.textContent = label;

        let ci = el.querySelector(":scope > .stash-orate-comment");
        if (c && !ci) {
          ci = document.createElement("button");
          ci.type = "button";
          ci.className = "stash-orate-comment";
          ci.title = "Read comment";
          ci.textContent = "💬";
          ci.onclick = async e => {
            e.stopPropagation();
            const anchor = e.currentTarget;
            const cur = (await loadStore()).comments[key];
            if (cur) showComment(anchor, cur);
          };
          b.after(ci);
        } else if (!c && ci) ci.remove();
      });
    } catch (e) {}
  }

  new MutationObserver(muts => {
    const own = n => { const el = n.nodeType === 1 ? n : n.parentElement; return el && el.closest && el.closest(OWN); };
    if (muts.every(m => own(m.target))) return;
    scheduleDecorate();
  }).observe(document.body, { childList: true, subtree: true });

  // ── Plugins page: one-time "first O = scene rating" snapshot ──────────────
  // Copies each scene's CURRENT rating onto its first O. It is a snapshot, not a
  // link: later changes to the scene rating do not touch the first O's rating.
  // Never overwrites a first-O rating that already exists.
  function fillFirstORatings() {
    const run = queue.catch(() => {}).then(async () => {
      const d = await gql(`query { findScenes(scene_filter:{o_counter:{value:0,modifier:GREATER_THAN},rating100:{value:0,modifier:NOT_NULL}} filter:{per_page:-1}) { scenes { id rating100 o_history } } }`);
      const cfg = await readConfig();
      const ratings = normalize(cfg[KEY_R]);
      let added = 0, skipped = 0;
      d.findScenes.scenes.forEach(s => {
        const first = (s.o_history || []).map(ts => new Date(ts).getTime()).filter(t => !isNaN(t)).sort((a, b) => a - b)[0];
        if (first == null || s.rating100 == null) return;
        const key = `${s.id}|${first}`;
        if (ratings[key] != null) { skipped++; return; }
        ratings[key] = s.rating100; added++;
      });
      await gql(`mutation($id: ID!, $input: Map!) { configurePlugin(plugin_id:$id, input:$input) }`,
        { id: PLUGIN_ID, input: { ...cfg, [KEY_R]: ratings } });
      store = { ratings, comments: normalize(cfg[KEY_C]) };
      scheduleDecorate();
      return { added, skipped };
    });
    queue = run;
    return run;
  }

  // Adds the button under this plugin's heading on the Settings > Plugins page.
  function injectSettingsButton() {
    if (!location.pathname.startsWith("/settings") || document.getElementById("stash-orate-fill")) return;
    const title = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"))
      .find(e => e.textContent.trim().length < 40 && /o\s*ratings/i.test(e.textContent));
    if (!title) return;
    const btn = document.createElement("button");
    btn.id = "stash-orate-fill";
    btn.type = "button";
    btn.className = "btn btn-secondary btn-sm";
    btn.textContent = "Set first O ratings from scene ratings";
    btn.onclick = async () => {
      if (!confirm("Copy each scene's current rating onto its first O? Existing first-O ratings are kept. This is a one-time snapshot, not a link.")) return;
      btn.disabled = true;
      try {
        const r = await fillFirstORatings();
        btn.textContent = `Done: ${r.added} set, ${r.skipped} already rated`;
      } catch (e) {
        btn.textContent = "Failed: " + e.message;
        btn.disabled = false;
      }
    };
    title.after(btn);
  }

  // ── Detect O events ───────────────────────────────────────────────────────
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const res = await origFetch.apply(this, arguments);
    try {
      const body = init && typeof init.body === "string" ? init.body : null;
      if (body && /sceneAddO|sceneIncrementO|sceneDeleteO|sceneDecrementO|sceneResetO|sceneUpdate/.test(body)) {
        invalidateScene();
        setTimeout(scheduleDecorate, 600);
      }
      if (body && /sceneAddO|sceneIncrementO/.test(body)) {
        const v = (JSON.parse(body).variables) || {};
        // only prompt for plain O-button clicks, not manual history edits (which pass `times`)
        if (v.id && (v.times == null || v.times.length === 0)) {
          latestOTimestamp(v.id, res).then(ts => { if (ts) showPopup(v.id, ts); }).catch(() => {});
        }
      }
    } catch (e) {}
    return res;
  };

  // Public API for other plugins (e.g. Stash+).
  //  getAll()      -> { "sceneId|epochMs": rating100 }  ratings of every O (first O included, if rated)
  //  getComments() -> { "sceneId|epochMs": text }
  //  fillFirstORatings() -> one-time snapshot of scene ratings onto first O's
  window.stashORatings = {
    getAll: async () => (await loadStore()).ratings,
    getComments: async () => (await loadStore()).comments,
    fillFirstORatings,
    showComment,
  };
})();
