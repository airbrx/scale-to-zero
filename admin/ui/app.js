// Admin UI. Nothing here is a security boundary: the Lambda re-verifies the
// Google ID token and re-checks the admin list on every single request. Hiding
// a button is a courtesy, not a control.

import * as auth from "./auth.js";

const $ = (id) => document.getElementById(id);
const show = (el, on = true) => { el.hidden = !on; };
const err = (el, msg) => { el.textContent = msg ?? ""; show(el, Boolean(msg)); };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let me = null;
let taxonomy = { categories: {}, flatStackAngles: {} };
let editing = null;
let editor = null;   // the CKEditor instance
let dirty = false;

// ------------------------------------------------------------------ startup
async function boot() {
  // Read the client id from a flat file beside this one, not from /api/health.
  // Loading the admin used to wake the Lambda on every page view for a value
  // that is a build-time constant; now the whole admin UI is static objects in
  // S3 and nothing here touches compute until you actually sign in.
  const cfg = await (await fetch("/admin/config.json")).json();
  if (!cfg.googleClientId) {
    err($("gateErr"), "No googleClientId in /admin/config.json. See docs/ADMIN.md.");
    return;
  }
  await auth.init(cfg.googleClientId, onAuthChange);
  auth.renderButton($("gbtn"));
  // Keep a local copy of whatever is in the editor, so an expired session or a
  // closed tab never costs an article. Cleared on a successful save.
  restoreLocalDraft();
}

async function onAuthChange(profile, message) {
  if (message) err($("gateErr"), message);
  if (!profile) {
    show($("gate"), true);
    ["articlesView", "editorView", "adminsView", "publishView", "statsView", "tabs", "who"]
      .forEach((i) => show($(i), false));
    return;
  }
  try {
    me = await auth.api("/me");
  } catch (e) {
    // Authenticated with Google but not on the admin list: say so plainly
    // rather than showing an empty console.
    err($("gateErr"), e.message);
    auth.signOut();
    return;
  }
  err($("gateErr"), null);
  $("whoEmail").textContent = `${me.email} (${me.role})`;
  show($("who"), true);
  show($("tabs"), true);
  show($("gate"), false);
  await loadTaxonomy();
  switchView("articles");
}

async function loadTaxonomy() {
  try {
    const res = await fetch("/taxonomy.json");
    if (res.ok) taxonomy = await res.json();
  } catch { /* fall through to whatever defaults exist */ }
}

// -------------------------------------------------------------------- views
function switchView(name) {
  const map = { articles: "articlesView", admins: "adminsView", publish: "publishView", stats: "statsView" };
  Object.values(map).forEach((v) => show($(v), false));
  show($("editorView"), false);
  show($(map[name]), true);
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-on", t.dataset.view === name));
  if (name === "articles") loadArticles();
  if (name === "admins") loadAdmins();
  if (name === "publish") loadChangeset();
  if (name === "stats") loadStats();
}

document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => {
    if (dirty && !confirm("You have unsaved changes. Leave anyway?")) return;
    switchView(t.dataset.view);
  }));
$("signOut").addEventListener("click", () => auth.signOut());

// Browsers only honour this if the page has been interacted with, which by the
// time you have typed an article it certainly has.
window.addEventListener("beforeunload", (e) => {
  if (!dirty) return;
  e.preventDefault();
  e.returnValue = "";
});

// ----------------------------------------------------------------- articles
async function loadArticles() {
  const list = $("articleList");
  list.innerHTML = "<li class='muted'>loading...</li>";
  try {
    const items = await auth.api("/articles");
    list.innerHTML = items.length
      ? ""
      : "<li class='muted'>No articles yet. The pipeline queue is a good place to start.</li>";
    for (const a of items) {
      const li = document.createElement("li");
      li.className = "item";
      li.innerHTML = `
        <div>
          <span class="pill ${esc(a.status)}">${esc(a.status)}</span>
          ${a.templateType === "podcast" ? '<span class="pill audio">audio</span>' : ""}
          <strong>${esc(a.headline)}</strong>
          <div class="muted small">${esc(a.date)} &middot; ${esc(a.categoryLabel ?? "")}</div>
        </div>
        <div>
          <button class="btn" data-edit="${esc(a.slug)}">Edit</button>
          <button class="btn danger" data-del="${esc(a.slug)}">Delete</button>
        </div>`;
      list.append(li);
    }
  } catch (e) {
    list.innerHTML = `<li class="err">${esc(e.message)}</li>`;
  }
}

$("articleList").addEventListener("click", async (ev) => {
  const edit = ev.target.dataset.edit;
  const del = ev.target.dataset.del;
  if (edit) return openEditor(await auth.api(`/articles/${edit}`));
  if (del) {
    if (!confirm(`Delete ${del}? This removes the article and its rendered page from staging.`)) return;
    await auth.api(`/articles/${del}`, { method: "DELETE" });
    loadArticles();
  }
});

$("newArticle").addEventListener("click", () => openEditor(null));
$("backToList").addEventListener("click", () => {
  if (dirty && !confirm("You have unsaved changes. Leave anyway?")) return;
  switchView("articles");
});

function fillSelect(el, entries, selected) {
  el.innerHTML = "";
  for (const [value, label] of entries) {
    const o = document.createElement("option");
    o.value = value; o.textContent = label;
    if (value === selected) o.selected = true;
    el.append(o);
  }
}

const countWords = (html) =>
  (html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").trim().match(/\S+/g) ?? []).length;

function markDirty() {
  dirty = true;
  $("saveState").textContent = "unsaved";
  $("saveState").className = "savestate dirty";
}

async function ensureEditor() {
  if (editor) return editor;
  editor = await ClassicEditor.create($("f-body"), {
    // A working writer's toolbar. Enough to restructure a piece properly --
    // headings, lists, quotes, links, tables -- without a ribbon of things
    // nobody uses on a text site.
    toolbar: [
      "heading", "|",
      "bold", "italic", "link", "blockQuote", "code", "codeBlock", "|",
      "bulletedList", "numberedList", "|",
      "outdent", "indent", "|",
      "insertTable", "horizontalLine", "|",
      "undo", "redo", "|",
      "sourceEditing",
    ],
    heading: {
      options: [
        { model: "paragraph", title: "Paragraph", class: "ck-heading_paragraph" },
        { model: "heading2", view: "h2", title: "Section", class: "ck-heading_heading2" },
        { model: "heading3", view: "h3", title: "Sub-section", class: "ck-heading_heading3" },
      ],
    },
    // The languages this site actually writes about. CodeBlock emits
    // <pre><code class="language-x">, which sanitizeHtml() leaves alone and
    // .article-body pre styles. Nothing highlights the code at render time --
    // the class is there so a highlighter can be added later without
    // re-authoring anything.
    codeBlock: {
      languages: [
        { language: "plaintext", label: "Plain text" },
        { language: "bash", label: "Shell" },
        { language: "javascript", label: "JavaScript" },
        { language: "json", label: "JSON" },
        { language: "yaml", label: "YAML" },
        { language: "python", label: "Python" },
        { language: "hcl", label: "Terraform" },
        { language: "sql", label: "SQL" },
      ],
    },
  });
  editor.model.document.on("change:data", () => {
    markDirty();
    $("wordCount").textContent = `${countWords(editor.getData())} words`;
  });
  return editor;
}

async function openEditor(a) {
  editing = a;
  err($("editErr"), null);
  $("editorTitle").textContent = a ? "Edit article" : "New article";

  fillSelect($("f-category"),
    Object.entries(taxonomy.categories ?? {}).map(([k, c]) => [k, c.label]),
    a?.category);
  fillSelect($("f-angle"),
    Object.keys(taxonomy.flatStackAngles ?? {}).map((k) => [k, k]),
    a?.flatStackAngle);

  $("f-headline").value = a?.headline ?? "";
  $("f-dek").value = a?.dek ?? "";
  $("f-status").value = a?.status ?? "draft";
  $("f-template").value = a?.templateType ?? "article";
  $("f-date").value = a?.date ?? new Date().toISOString().slice(0, 10);
  $("f-src-title").value = a?.source?.title ?? "";
  $("f-src-url").value = a?.source?.url ?? "";
  $("f-src-pub").value = a?.source?.publisher ?? "";
  $("f-src-fig").value = a?.source?.figure ?? "";
  $("f-src-disc").value = a?.source?.discussionUrl ?? "";
  $("f-pull").value = a?.pullQuote ?? "";
  $("f-audiourl").value = a?.audio?.url ?? "";
  $("audioMeta").textContent = a?.audio
    ? `${a.audio.mimeType ?? ""} ${a.audio.byteLength ?? 0} bytes${a.audio.durationSeconds ? `, ${Math.round(a.audio.durationSeconds)}s` : ""}`
    : "";

  const ed = await ensureEditor();
  // An article written before the free-form switch still has `sections`.
  // Fold them into HTML so it opens as editable prose instead of appearing blank.
  ed.setData(a?.body || sectionsToHtml(a?.sections) || "");
  $("wordCount").textContent = `${countWords(ed.getData())} words`;

  dirty = false;
  $("saveState").textContent = "";
  $("saveState").className = "savestate";

  toggleAudio();
  ["articlesView", "adminsView", "publishView", "statsView"].forEach((i) => show($(i), false));
  show($("editorView"), true);
}

const SECTION_LABELS = [
  ["whatHappened", "What happened"],
  ["theArchitectureUnderneath", "The architecture underneath"],
  ["whatItCost", "What it cost"],
  ["theFlatStackVersion", "The flat-stack version"],
  ["theUncomfortablePart", "The uncomfortable part"],
];

function sectionsToHtml(sections) {
  if (!sections) return "";
  let html = "";
  for (const [key, label] of SECTION_LABELS) {
    const text = sections[key];
    if (!text || !text.trim()) continue;
    html += `<h2>${esc(label)}</h2>`;
    for (const p of text.trim().split(/\n\s*\n/)) {
      html += `<p>${esc(p.trim())
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")}</p>`;
    }
  }
  return html;
}

const toggleAudio = () => show($("audioFields"), $("f-template").value === "podcast");
$("f-template").addEventListener("change", () => { toggleAudio(); markDirty(); });
for (const id of ["f-headline", "f-dek", "f-status", "f-date", "f-category", "f-angle",
  "f-src-title", "f-src-url", "f-src-pub", "f-src-fig", "f-src-disc", "f-pull"]) {
  $(id).addEventListener("input", markDirty);
}

// ---- inline images: uploaded to staging, then inserted at the cursor
$("insertImage").addEventListener("click", () => $("f-imagefile").click());
$("f-imagefile").addEventListener("change", async (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;
  const ed = await ensureEditor();
  try {
    $("saveState").textContent = "uploading image...";
    const res = await auth.api(`/media?kind=image&filename=${encodeURIComponent(file.name)}`, {
      method: "POST", body: file, headers: { "content-type": file.type || "image/jpeg" },
    });
    ed.model.change((writer) => {
      const el = writer.createElement("imageBlock", { src: res.url });
      ed.model.insertContent(el, ed.model.document.selection);
    });
    markDirty();
  } catch (e) {
    err($("editErr"), `Image upload failed: ${e.message}`);
  } finally {
    ev.target.value = "";
  }
});

// Duration is measured here because the Lambda would need ffmpeg to work it out,
// and that is a big dependency for one number.
$("f-audiofile").addEventListener("change", async (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;
  $("audioMeta").textContent = "uploading...";
  try {
    const durationSeconds = await new Promise((resolve) => {
      const el = new Audio();
      el.preload = "metadata";
      el.onloadedmetadata = () => resolve(Number.isFinite(el.duration) ? el.duration : null);
      el.onerror = () => resolve(null);
      el.src = URL.createObjectURL(file);
    });
    const res = await auth.api(`/media?kind=audio&filename=${encodeURIComponent(file.name)}`, {
      method: "POST", body: file, headers: { "content-type": file.type || "audio/mpeg" },
    });
    $("f-audiourl").value = res.url;
    $("f-audiourl").dataset.duration = durationSeconds ?? "";
    $("f-audiourl").dataset.mime = res.mimeType;
    $("f-audiourl").dataset.bytes = res.byteLength;
    $("audioMeta").textContent = `${res.mimeType}, ${res.byteLength} bytes${durationSeconds ? `, ${Math.round(durationSeconds)}s` : ""}`;
    markDirty();
  } catch (e) {
    $("audioMeta").textContent = `upload failed: ${e.message}`;
  }
});

$("saveArticle").addEventListener("click", async () => {
  err($("editErr"), null);
  const ed = await ensureEditor();
  const audioUrl = $("f-audiourl").value;
  const payload = {
    headline: $("f-headline").value.trim(),
    dek: $("f-dek").value.trim(),
    status: $("f-status").value,
    templateType: $("f-template").value,
    date: $("f-date").value,
    category: $("f-category").value,
    categoryLabel: taxonomy.categories?.[$("f-category").value]?.label ?? "",
    flatStackAngle: $("f-angle").value,
    source: {
      title: $("f-src-title").value.trim(),
      url: $("f-src-url").value.trim(),
      publisher: $("f-src-pub").value.trim(),
      figure: $("f-src-fig").value.trim() || null,
      discussionUrl: $("f-src-disc").value.trim() || null,
    },
    body: ed.getData(),
    // Once saved from this editor the article is free-form; drop the old
    // scaffolding so the renderer does not print it twice.
    sections: null,
    pullQuote: $("f-pull").value.trim(),
    audio: $("f-template").value === "podcast" && audioUrl ? {
      url: audioUrl,
      mimeType: $("f-audiourl").dataset.mime || "audio/mpeg",
      byteLength: Number($("f-audiourl").dataset.bytes || 0),
      durationSeconds: Number($("f-audiourl").dataset.duration || 0) || null,
    } : null,
  };

  if (!payload.headline) return err($("editErr"), "A headline is required.");
  if (payload.status === "published" && !payload.dek) {
    return err($("editErr"), "A published article needs a dek.");
  }
  if (payload.status === "published" && !payload.body.trim()) {
    return err($("editErr"), "A published article needs a body.");
  }

  const btn = $("saveArticle");
  btn.disabled = true;
  $("saveState").textContent = "saving...";
  try {
    if (editing) await auth.api(`/articles/${editing.slug}`, { method: "PUT", body: JSON.stringify(payload) });
    else await auth.api("/articles", { method: "POST", body: JSON.stringify(payload) });
    dirty = false;
    clearLocalDraft();
    $("saveState").textContent = "saved";
    $("saveState").className = "savestate ok";
    switchView("articles");
  } catch (e) {
    err($("editErr"), e.message);
    $("saveState").textContent = "";
  } finally {
    btn.disabled = false;
  }
});

// -------------------------------------------------------------------- stats
//
// Two endpoints behind one screen. /stats is the rolled-up summary and is what
// the Overview and Days tabs read. /stats/detail is the drill-down -- geography
// down to city, per-bot crawl paths, campaign parameters, the probe log -- and
// is fetched only when a tab that needs it is opened, then cached. Opening the
// admin should not pull a megabyte of tables nobody looked at.

const fmtBytes = (b) => {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), u.length - 1);
  return `${(b / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
};

const fmtMins = (sec) => (sec >= 60 ? `${Math.floor(sec / 60)}m ${sec % 60}s` : `${sec}s`);
const num = (n) => (n ?? 0).toLocaleString();

const tile = (label, value, sub = "") =>
  `<div class="tile"><div class="tile-v">${esc(value)}</div><div class="tile-l">${esc(label)}</div>${
    sub ? `<div class="tile-s">${esc(sub)}</div>` : ""}</div>`;

const table = (title, rows, opts = {}) => {
  const { fmt = num, note = "", labelKey = "key" } = opts;
  if (!rows?.length) return "";
  const max = Math.max(...rows.map((r) => r.count), 1);
  return `<div class="statbox"><h3>${esc(title)}</h3><ul class="bars">${rows.map((r) => {
    const label = r.label ?? r[labelKey] ?? "";
    return `<li><span class="bar-l" title="${esc(label)}">${esc(label)}</span>
     <span class="bar-t"><span class="bar-f" style="width:${Math.round((r.count / max) * 100)}%"></span></span>
     <span class="bar-c">${esc(fmt(r.count))}</span></li>`;
  }).join("")}</ul>${note ? `<p class="muted small">${esc(note)}</p>` : ""}</div>`;
};

// A plain table for rows that carry more than one number.
const grid = (title, cols, rows, note = "") => {
  if (!rows?.length) return "";
  return `<div class="statbox"><h3>${esc(title)}</h3>
    <div class="tblwrap"><table class="tbl"><thead><tr>${
      cols.map((c) => `<th${c.right ? ' class="r"' : ""}>${esc(c.head)}</th>`).join("")
    }</tr></thead><tbody>${rows.map((r) => `<tr>${
      cols.map((c) => `<td${c.right ? ' class="r"' : ""}>${c.raw ? c.get(r) : esc(String(c.get(r) ?? ""))}</td>`).join("")
    }</tr>`).join("")}</tbody></table></div>${note ? `<p class="muted small">${esc(note)}</p>` : ""}</div>`;
};

const place = (r) => [r.city, r.region, r.countryName || r.country].filter(Boolean).join(", ");
const latlng = (r) => (r.lat === null || r.lat === undefined ? "" : `${r.lat.toFixed(2)}, ${r.lng.toFixed(2)}`);

// ------------------------------------------------------------- state + tabs
let statsSummary = null;
let statsDetail = null;
// null = the whole window, or a YYYY-MM-DD. This used to scope only the
// drill-down tabs, which meant picking a day changed nothing on the tab you
// landed on and the feature read as broken. It now scopes the summary too --
// /stats takes the same ?date= the detail endpoint always took.
let statsScope = null;
let statsTab = "overview";

function statsWindowDays() {
  return $("statsWindow").value;
}

async function ensureDetail() {
  if (statsDetail !== null) return statsDetail;
  const q = statsScope
    ? `date=${encodeURIComponent(statsScope)}`
    : `days=${statsWindowDays()}`;
  statsDetail = await auth.api(`/stats/detail?${q}`);
  return statsDetail;
}

// Every panel opens with this, so the numbers below it are never ambiguous
// about what they cover.
function scopeLine() {
  const d = statsScope;
  return `<p class="muted small scope">${
    d ? `Showing <strong>${esc(d)}</strong> only.` : `Rolled across the last ${esc(statsWindowDays())} days.`
  }${d ? ' <button class="linkbtn" id="clearScope">show the whole window</button>' : ""}</p>`;
}

// The scope line's escape hatch. Attached after every render, not just the
// drill-down ones.
function wireScope(box) {
  const clear = box.querySelector("#clearScope");
  if (clear) clear.addEventListener("click", () => selectDay(null));
}

function fillDayPicker(dates) {
  const sel = $("statsDay");
  sel.innerHTML = `<option value="">every day in the window</option>${
    dates.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join("")}`;
  sel.value = statsScope ?? "";
}

// ------------------------------------------------------------------ panels
function panelOverview(s) {
  const t = s.totals;
  const peak = Math.max(...s.daily.map((d) => d.sessions), 1);
  return `${scopeLine()}
    <div class="tiles">
      ${tile("visits", num(t.sessions), "30 min session gap")}
      ${tile("page views", num(t.pageViews))}
      ${tile("pages / visit", t.pagesPerSession)}
      ${tile("bounce rate", t.bounceRate + "%", "saw one page")}
      ${tile("avg visit", fmtMins(t.avgSessionSec))}
      ${tile("bandwidth", fmtBytes(t.bandwidth))}
    </div>
    <div class="tiles">
      ${tile("requests", num(t.requests), "everything the CDN served")}
      ${tile("cache hits", t.cacheHitRate === null ? "n/a" : t.cacheHitRate + "%", "served from the edge")}
      ${tile("bots", num(t.bots), "not counted as visits")}
      ${tile("probes", num(t.probes), "scanners, counted apart")}
      ${tile("admin", num(t.internal), "your own editing")}
      ${tile("errors", num(t.errors))}
    </div>

    <div class="statbox"><h3>Visits per day</h3>
      <ul class="spark${statsScope ? " scoped" : ""}">${s.daily.slice().reverse().map((d) =>
        `<li class="${d.date === statsScope ? "is-on" : ""}" data-date="${esc(d.date)}"
          title="${esc(d.date)}: ${d.sessions} visits, ${d.pageViews} views"><span style="height:${
          Math.max(2, Math.round((d.sessions / peak) * 100))}%"></span></li>`).join("")}</ul>
      <p class="muted small">${esc(s.daily.at(-1).date)} to ${esc(s.daily[0].date)}${
        statsScope ? " &middot; the whole window, so the scoped day has something to sit against" : ""}</p>
    </div>

    ${s.audioListens?.length ? grid("Audio", [
      { head: "File", get: (a) => a.file },
      { head: "Plays", right: true, get: (a) => num(a.plays) },
      { head: "Listeners", right: true, get: (a) => num(a.uniqueListeners) },
      { head: "Finished", right: true, get: (a) => a.completionRate + "%" },
      { head: "Avg", right: true, get: (a) => a.avgCompletion + "%" },
    ], s.audioListens, "From HTTP range requests. A play is over 10% of the file; finished is 90% or more.") : ""}

    <div class="statgrid">
      ${table("How they arrived", s.channels)}
      ${table("Top pages", s.pages)}
      ${table("Referrers", s.referrers)}
      ${table("Countries", s.countries)}
    </div>
    <p class="muted small">${statsScope ? `Scoped to ${esc(statsScope)}. ` : ""}Window: ${
      esc(String(s.windowDays))} days.${
      s.lastRun ? ` Logs last processed ${esc(s.lastRun)}.` : ""} ${esc(s.geoQuality?.note ?? "")}</p>`;
}

function panelAudience(d, s) {
  const ch = d.acquisition?.channels ?? [];
  return `${scopeLine()}
    <div class="statgrid">
      ${table("Browsers", d.audience?.browsers)}
      ${table("Operating systems", d.audience?.os)}
      ${table("Devices", d.audience?.devices)}
      ${table("Device / OS", d.audience?.deviceCategories)}
      ${table("Entry pages", d.visits?.entryPages)}
      ${table("Exit pages", d.visits?.exitPages)}
    </div>
    ${grid("Visits by channel", [
      { head: "Channel", get: (r) => r.key },
      { head: "Visits", right: true, get: (r) => num(r.count) },
      { head: "Bounced", right: true, get: (r) => (r.count ? Math.round((r.bounces / r.count) * 100) + "%" : "-") },
      { head: "Pages/visit", right: true, get: (r) => (r.count ? (r.pageViews / r.count).toFixed(1) : "-") },
      { head: "Avg time", right: true, get: (r) => (r.count ? fmtMins(Math.round(r.seconds / r.count)) : "-") },
    ], ch)}`;
}

function panelContent(d) {
  return `${scopeLine()}
    <div class="statgrid">
      ${table("Pages", d.content?.pages)}
      ${table("Assets", d.content?.assets)}
      ${table("Audio files", d.content?.audio)}
      ${table("Status codes", d.content?.statuses)}
      ${table("Hostnames", d.content?.hosts)}
      ${table("CDN edge locations", d.content?.edgeLocations, {
        note: "The POP that served the request. Roughly where the reader was.",
      })}
    </div>`;
}

function panelGeo(d, s) {
  const g = d.geo ?? {};
  const anyCity = (g.cities?.length ?? 0) + (g.scannerCities?.length ?? 0) > 0;
  return `${scopeLine()}
    ${anyCity ? "" : `<p class="warn small">No city-level data in this window. Install a
      database with <code>node infra/fetch-geodb.mjs</code>, then process logs again.</p>`}
    <h2 class="subhead">Readers</h2>
    <div class="statgrid">
      ${table("Countries", g.countries)}
      ${grid("Regions", [
        { head: "Region", get: (r) => `${r.region}, ${r.countryName || r.country}` },
        { head: "Lat, lng", get: latlng },
        { head: "Hits", right: true, get: (r) => num(r.count) },
      ], g.regions)}
      ${grid("Cities", [
        { head: "City", get: place },
        { head: "Lat, lng", get: latlng },
        { head: "Hits", right: true, get: (r) => num(r.count) },
      ], g.cities)}
      ${grid("Top client addresses", [
        { head: "IP", get: (r) => r.ip },
        { head: "Where", get: place },
        { head: "Hits", right: true, get: (r) => num(r.count) },
      ], d.ips?.clients)}
    </div>
    <h2 class="subhead">Scanners</h2>
    <div class="statgrid">
      ${table("Scanner countries", g.scannerCountries)}
      ${grid("Scanner regions", [
        { head: "Region", get: (r) => `${r.region}, ${r.countryName || r.country}` },
        { head: "Lat, lng", get: latlng },
        { head: "Probes", right: true, get: (r) => num(r.count) },
      ], g.scannerRegions)}
      ${grid("Scanner cities", [
        { head: "City", get: place },
        { head: "Lat, lng", get: latlng },
        { head: "Probes", right: true, get: (r) => num(r.count) },
      ], g.scannerCities)}
    </div>
    <p class="muted small">${esc(s.geoQuality?.note ?? "")} City and region data from
      <a href="https://db-ip.com" rel="noopener">DB-IP</a>, CC BY 4.0. Free city databases
      are approximate; treat a city as a neighbourhood-sized guess.</p>`;
}

function panelAcquisition(d) {
  const a = d.acquisition ?? {};
  const empty = !["campaigns", "sources", "mediums", "terms", "content", "clickIds"]
    .some((k) => a[k]?.length);
  return `${scopeLine()}
    ${empty ? `<p class="muted small">No campaign parameters seen in this window. The
      tables below still show every query parameter that arrived, which is how you find
      out you are being linked with a tag you did not know about.</p>` : ""}
    <div class="statgrid">
      ${table("Channels", a.channels, { labelKey: "key" })}
      ${table("Campaigns (clicks)", a.campaigns)}
      ${table("Campaigns (visits)", a.campaignVisits, { note: "Read off the entry request of each visit." })}
      ${table("Sources", a.sources)}
      ${table("Mediums", a.mediums)}
      ${table("Source / medium", a.sourceMediums)}
      ${table("Terms", a.terms)}
      ${table("Ad content", a.content)}
      ${table("Click IDs", a.clickIds)}
      ${table("Every query parameter", a.queryKeys, {
        note: "Campaign or not. The fastest way to spot a tag we do not recognise.",
      })}
      ${table("Referrer hosts", a.referrers)}
      ${table("Referrer URLs", a.referrerUrls)}
      ${table("Landing pages by channel", a.landings)}
    </div>`;
}

function botBlock(title, rows, showUA) {
  if (!rows?.length) return "";
  return `<div class="statbox"><h3>${esc(title)}</h3>
    <div class="botlist">${rows.map((b, i) => `
      <details class="bot">
        <summary>
          <span class="bot-n">${esc(b.name)}</span>
          <span class="bot-c">${esc(b.category ?? "")}</span>
          <span class="bot-h">${num(b.count)} hits</span>
          <span class="bot-o">${num(b.objectsCrawled)} objects</span>
        </summary>
        ${showUA && b.sampleUA ? `<p class="ua">${esc(b.sampleUA)}</p>` : ""}
        <ul class="bars">${(b.topPaths ?? []).map((p) =>
          `<li><span class="bar-l" title="${esc(p.key)}">${esc(p.key)}</span>
           <span class="bar-t"></span><span class="bar-c">${num(p.count)}</span></li>`).join("")}</ul>
      </details>`).join("")}</div></div>`;
}

function panelBots(d) {
  const b = d.bots ?? {};
  return `${scopeLine()}
    <div class="tiles">
      ${tile("named bots", num(b.known?.length))}
      ${tile("unidentified", num(b.unknown?.length))}
      ${tile("bot requests", num((b.known ?? []).concat(b.unknown ?? []).reduce((n, x) => n + x.count, 0)))}
    </div>
    ${table("Bot categories", b.categories)}
    ${botBlock("Named bots", b.known, false)}
    ${botBlock("Unidentified crawlers", b.unknown, true)}
    <p class="muted small">Open a row for the paths it crawled. Unidentified crawlers show a
      sample user agent, which is what you need to decide whether to name one in
      <code>admin/lib/classify.mjs</code>.</p>`;
}

function panelSecurity(d) {
  const sec = d.security ?? {};
  return `${scopeLine()}
    <div class="statgrid">
      ${table("Probe patterns", sec.probePatterns)}
      ${table("Most-requested probe paths", sec.probePaths)}
      ${table("404 paths", sec.top404Paths)}
      ${table("403 paths", sec.top403Paths)}
      ${grid("Top scanner addresses", [
        { head: "IP", get: (r) => r.ip },
        { head: "Where", get: place },
        { head: "Probes", right: true, get: (r) => num(r.count) },
      ], d.ips?.scanners)}
    </div>
    ${grid("Probe log", [
      { head: "Time", get: (p) => (p.t || "").replace("T", " ").replace("Z", "") },
      { head: "Address", get: (p) => p.ip },
      { head: "Where", get: (p) => [p.city, p.country].filter(Boolean).join(", ") },
      { head: "Path", get: (p) => p.path },
      { head: "Status", right: true, get: (p) => p.status },
      { head: "Pattern", get: (p) => p.pattern },
    ], sec.probeLog, "The most recent attempts, newest first. This is the table an article quotes.")}`;
}

function panelDays(s) {
  return `${scopeLine()}
    <p class="muted small">Pick a day to scope every tab to it, including Overview.</p>
    ${grid("Days", [
      { head: "Date", raw: true, get: (d) => `<button class="linkbtn day${
        d.date === statsScope ? " is-on" : ""}" data-date="${esc(d.date)}">${esc(d.date)}</button>` },
      { head: "Visits", right: true, get: (d) => num(d.sessions) },
      { head: "Page views", right: true, get: (d) => num(d.pageViews) },
      { head: "Requests", right: true, get: (d) => num(d.requests) },
      { head: "Bots", right: true, get: (d) => num(d.bots) },
      { head: "Probes", right: true, get: (d) => num(d.probes) },
      { head: "Errors", right: true, get: (d) => num(d.errors) },
      { head: "Bandwidth", right: true, get: (d) => fmtBytes(d.bandwidth) },
    ], s.daily)}
    ${statsDetail?.hourly ? hourlyChart(statsDetail.hourly) : ""}`;
}

function hourlyChart(hours) {
  const peak = Math.max(...hours.map((h) => h.requests), 1);
  return `<div class="statbox"><h3>By hour (UTC)</h3>
    <ul class="hours">${hours.map((h) => `
      <li title="${h.hour}:00 — ${h.requests} requests, ${h.pageViews} page views, ${h.probes} probes">
        <span class="h-bar" style="height:${Math.max(2, Math.round((h.requests / peak) * 100))}%"></span>
        <span class="h-l">${h.hour}</span>
      </li>`).join("")}</ul></div>`;
}

// ------------------------------------------------------------------- render
async function renderStatsTab() {
  const box = $("statsBody");
  const s = statsSummary;
  if (statsTab === "overview") {
    box.innerHTML = panelOverview(s);
    // Clicking a bar is the fastest way in. The sparkline is already the thing
    // your eye goes to when one day looks unlike the others.
    box.querySelectorAll(".spark li[data-date]").forEach((li) =>
      li.addEventListener("click", () => selectDay(li.dataset.date)));
    wireScope(box);
    return;
  }
  if (statsTab === "days") {
    // The hour-by-hour chart lives in the detail file. Fetch it when a day is
    // scoped -- that is one object, and it is the reason to scope a day at all.
    // Unscoped it would be a read per day in the window, so it stays lazy and
    // the chart appears only if another tab already pulled it.
    if (statsScope && statsDetail === null) {
      box.innerHTML = "<p class='muted'>loading detail...</p>";
      try {
        await ensureDetail();
      } catch (e) {
        box.innerHTML = `<p class="err">${esc(e.message)}</p>`;
        return;
      }
    }
    box.innerHTML = panelDays(s);
    box.querySelectorAll("button.day").forEach((b) =>
      b.addEventListener("click", () => selectDay(b.dataset.date)));
    wireScope(box);
    return;
  }

  box.innerHTML = "<p class='muted'>loading detail...</p>";
  let d;
  try {
    d = await ensureDetail();
  } catch (e) {
    box.innerHTML = `<p class="err">${esc(e.message)}</p>`;
    return;
  }
  if (!d || d.empty) {
    box.innerHTML = "<p class='muted'>No detail for this window yet. Process some logs first.</p>";
    return;
  }
  const panels = {
    audience: () => panelAudience(d, s),
    content: () => panelContent(d),
    geo: () => panelGeo(d, s),
    acquisition: () => panelAcquisition(d),
    bots: () => panelBots(d),
    security: () => panelSecurity(d),
  };
  box.innerHTML = (panels[statsTab] ?? (() => ""))();
  wireScope(box);
}

// Picking a day now refetches the summary as well, because the totals, the
// rolled lists and the audio numbers all change with it. It also leaves you on
// the tab you were reading -- the old version moved you to Overview, which was
// the one panel that ignored the day you had just picked.
function selectDay(date) {
  const next = date || null;
  if (next === statsScope) return;
  statsScope = next;
  statsDetail = null;
  loadStats();
}

function syncStatsTabs() {
  document.querySelectorAll("#statsTabs .subtab").forEach((b) =>
    b.classList.toggle("is-on", b.dataset.stab === statsTab));
}

async function loadStats() {
  const box = $("statsBody");
  box.innerHTML = "<p class='muted'>loading...</p>";
  show($("statsTabs"), false);
  try {
    const q = `days=${statsWindowDays()}${
      statsScope ? `&date=${encodeURIComponent(statsScope)}` : ""}`;
    statsSummary = await auth.api(`/stats?${q}`);
    statsDetail = null;
    // The server decides whether the scope held. Asking for a day the window
    // does not cover is a 404, so reaching here means it did.
    statsScope = statsSummary.scope ?? null;
    fillDayPicker(statsSummary.dates);

    if (!statsSummary.daily.length) {
      box.innerHTML = `<p class="muted">No data yet. CloudFront delivers logs every few
        minutes; press <strong>Process new logs</strong> once some have arrived.</p>
        ${statsSummary.lastRun ? `<p class="muted small">Last processed ${esc(statsSummary.lastRun)}.</p>` : ""}`;
      return;
    }
    show($("statsTabs"), true);
    syncStatsTabs();
    await renderStatsTab();
  } catch (e) {
    box.innerHTML = `<p class="err">${esc(e.message)}</p>`;
  }
}

document.querySelectorAll("#statsTabs .subtab").forEach((b) =>
  b.addEventListener("click", () => {
    statsTab = b.dataset.stab;
    syncStatsTabs();
    renderStatsTab();
  }));

// Narrowing the window can drop the scoped day out of it, so the scope goes.
$("statsWindow").addEventListener("change", () => {
  statsScope = null;
  loadStats();
});

$("statsDay").addEventListener("change", (ev) => selectDay(ev.target.value));

$("rebuildStats").addEventListener("click", async () => {
  if (!confirm("Re-read every log file in the bucket and rebuild the whole report?\n\nSafe, but it can take a few runs if there is a backlog.")) return;
  const btn = $("rebuildStats");
  btn.disabled = true;
  btn.textContent = "Rebuilding...";
  try {
    const r = await auth.api("/stats?force=1", { method: "POST" });
    if (r.truncated) {
      alert(`Rebuilt from ${r.processed} log files. ${r.skipped} remain — press Rebuild again to continue.`);
    }
    // A rebuild re-derives every day from whatever logs still exist, so a day
    // at the far edge of the window can vanish with its expired logs. Drop the
    // scope rather than ask for a date that may no longer be there.
    statsScope = null;
    await loadStats();
  } catch (e) {
    err($("statsBody"), e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Rebuild";
  }
});

$("refreshStats").addEventListener("click", async () => {
  const btn = $("refreshStats");
  btn.disabled = true;
  btn.textContent = "Processing...";
  try {
    const r = await auth.api("/stats", { method: "POST" });
    btn.textContent = `Processed ${r.processed}`;
    if (r.truncated) {
      alert(`Processed ${r.processed} log files. ${r.skipped} remain — run again to continue.`);
    }
    if (r.processed && !r.geo) {
      alert("Logs processed, but no geo database is loaded, so there are no cities.\n\nRun: node infra/fetch-geodb.mjs");
    }
    // Scope kept on purpose. This is incremental -- it only ever adds to a day
    // -- and watching today's numbers arrive is the reason to press it.
    await loadStats();
  } catch (e) {
    err($("statsBody"), e.message);
  } finally {
    btn.disabled = false;
    setTimeout(() => { btn.textContent = "Process new logs"; }, 2500);
  }
});

// ------------------------------------------------------------------- admins
let adminList = [];

async function loadAdmins() {
  err($("adminErr"), null);
  const data = await auth.api("/admins");
  adminList = data.admins;
  renderAdmins(data.roles);
  $("saveAdmins").disabled = me.role !== "owner";
  $("addAdmin").disabled = me.role !== "owner";
}

function renderAdmins(roles = ["owner", "editor"]) {
  const body = $("adminRows");
  body.innerHTML = "";
  adminList.forEach((a, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input value="${esc(a.email)}" data-i="${i}" data-k="email"></td>
      <td><select data-i="${i}" data-k="role">${roles.map((r) =>
        `<option value="${r}"${r === a.role ? " selected" : ""}>${r}</option>`).join("")}</select></td>
      <td><input value="${esc(a.name ?? "")}" data-i="${i}" data-k="name"></td>
      <td><button class="btn danger" data-rm="${i}"${a.email === me.email ? " disabled title='You cannot remove yourself'" : ""}>Remove</button></td>`;
    body.append(tr);
  });
}

$("adminRows").addEventListener("input", (ev) => {
  const { i, k } = ev.target.dataset;
  if (i === undefined) return;
  adminList[Number(i)][k] = ev.target.value.trim();
});
$("adminRows").addEventListener("click", (ev) => {
  const rm = ev.target.dataset.rm;
  if (rm === undefined) return;
  adminList.splice(Number(rm), 1);
  renderAdmins();
});
$("addAdmin").addEventListener("click", () => {
  adminList.push({ email: "", role: "editor", name: "" });
  renderAdmins();
});
$("saveAdmins").addEventListener("click", async () => {
  err($("adminErr"), null);
  try {
    await auth.api("/admins", { method: "PUT", body: JSON.stringify({ admins: adminList.filter((a) => a.email) }) });
    await loadAdmins();
  } catch (e) {
    err($("adminErr"), e.message);
  }
});

// ------------------------------------------------------------------ publish
async function loadChangeset() {
  const box = $("changeset");
  box.textContent = "checking...";
  try {
    const cs = await auth.api("/publish");
    const total = cs.upload.length + cs.delete.length;
    box.innerHTML = total === 0
      ? "<span class='muted'>Live is already up to date with staging.</span>"
      : `<p><strong>${cs.upload.length}</strong> to copy, <strong>${cs.delete.length}</strong> to remove.</p>
         <ul class="small">${[...cs.upload.map((k) => `<li>+ ${esc(k)}</li>`),
           ...cs.delete.map((k) => `<li>- ${esc(k)}</li>`)].join("")}</ul>`;
  } catch (e) {
    box.innerHTML = `<span class="err">${esc(e.message)}</span>`;
  }
}

$("doPublish").addEventListener("click", async () => {
  const btn = $("doPublish");
  btn.disabled = true;
  btn.textContent = "Publishing...";
  try {
    const res = await auth.api("/publish", { method: "POST" });
    const log = $("publishLog");
    show(log, true);
    log.textContent = [...res.logs,
      `copied ${res.copied}, removed ${res.removed}`,
      res.invalidation ? `invalidation ${res.invalidation}` : "no invalidation needed",
    ].join("\n");
    await loadChangeset();
  } catch (e) {
    err($("changeset"), e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Publish to live";
  }
});

// ------------------------------------------------------- local draft backup
// Belt and braces against losing work: the body is mirrored to localStorage
// every few seconds while editing. This is a crash/expiry net, not storage --
// the article itself lives in S3.
const DRAFT_KEY = "stz-admin-draft";

function saveLocalDraft() {
  if (!editor) return;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      slug: editing?.slug ?? null,
      headline: $("f-headline").value,
      dek: $("f-dek").value,
      body: editor.getData(),
      at: Date.now(),
    }));
  } catch { /* quota or private mode: the S3 copy is still the real one */ }
}

function clearLocalDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* nothing stored */ }
}

async function restoreLocalDraft() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null"); } catch { return; }
  if (!d?.body || Date.now() - d.at > 7 * 86400000) return clearLocalDraft();
  const when = new Date(d.at).toLocaleString();
  if (!confirm(`Unsaved work from ${when} was found:

"${(d.headline || "(no headline)").slice(0, 60)}"

Restore it into the editor?`)) {
    return clearLocalDraft();
  }
  const existing = d.slug ? await auth.api(`/articles/${d.slug}`).catch(() => null) : null;
  await openEditor(existing);
  $("f-headline").value = d.headline;
  $("f-dek").value = d.dek;
  (await ensureEditor()).setData(d.body);
  markDirty();
}

setInterval(() => { if (dirty) saveLocalDraft(); }, 5000);

boot().catch((e) => err($("gateErr"), e.message));
