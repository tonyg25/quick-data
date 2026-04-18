/* Quick Data — social media performance dashboard
   Pure-browser dashboard. Loads CSV or XLSX, detects each sheet's shape
   (post-level vs daily aggregate), and renders the appropriate report:
   topic clustering + viral patterns for post-level, timeline for daily.
   No data leaves the browser. */

const STOPWORDS = new Set(("a,about,above,after,again,against,all,am,an,and,any,are,arent,as,at,be,because,been,before,being,below,between,both,but,by,can,cant,could,couldnt,did,didnt,do,does,doesnt,doing,dont,down,during,each,few,for,from,further,had,hadnt,has,hasnt,have,havent,having,he,hed,hell,hes,her,here,heres,hers,herself,him,himself,his,how,hows,i,id,ill,im,ive,if,in,into,is,isnt,it,its,itself,lets,me,more,most,mustnt,my,myself,no,nor,not,of,off,on,once,only,or,other,ought,our,ours,ourselves,out,over,own,same,shant,she,shed,shell,shes,should,shouldnt,so,some,such,than,that,thats,the,their,theirs,them,themselves,then,there,theres,these,they,theyd,theyll,theyre,theyve,this,those,through,to,too,under,until,up,very,was,wasnt,we,wed,well,were,weve,werent,what,whats,when,whens,where,wheres,which,while,who,whos,whom,why,whys,with,wont,would,wouldnt,you,youd,youll,youre,youve,your,yours,yourself,yourselves,just,like,get,got,one,two,three,really,also,now,know,much,many,thing,things,way,still,even,back,via,new,make,made,take,taken,go,going,gone,need,want,see,say,said,came,come,let,put").split(","));

/* Column aliases. Each entry is matched in order against headers (case-insensitive).
   - `eq` aliases must match the entire header (preferred).
   - `wb` aliases must appear as a whole word in the header (looser fallback).
   This avoids false matches like alias "post" hitting "Reposts (organic)" or "Post URL". */
const COL_ALIASES = {
  text: {
    eq: ["post commentary", "post text", "post title", "post description", "title", "commentary", "description", "text", "content", "message", "body", "video title"],
    wb: ["commentary", "description", "title"],
  },
  date: {
    eq: ["post publish date", "created date", "publish time", "publish time - use col t for filtering by month", "published on", "date created", "posted at", "published at", "post date", "created at", "date", "time", "publish date", "publish time"],
    wb: ["publish date", "publish time", "created date", "post date", "posted at", "published"],
  },
  likes: {
    eq: ["reactions (total)", "reactions (organic)", "likes", "reactions", "total reactions", "like count", "reaction count", "linkedin reactions", "facebook likes"],
    wb: ["likes", "reactions"],
  },
  comments: {
    eq: ["comments (total)", "comments (organic)", "comments", "comment count", "linkedin comments", "facebook comments"],
    wb: ["comments"],
  },
  shares: {
    eq: ["reposts (total)", "reposts (organic)", "reposts", "shares", "linkedin reposts", "facebook shares", "share count", "repost count"],
    wb: ["reposts", "shares"],
  },
  impressions: {
    eq: ["impressions (total)", "impressions (organic)", "impressions", "views", "reach", "impression count"],
    wb: ["impressions", "reach"],
  },
  engagements: {
    eq: ["engagements", "engagement", "all engagements", "reactions, comments and shares"],
    wb: ["engagements"],
  },
  url: {
    eq: ["post link", "post url", "permalink", "url", "link", "post permalink"],
    wb: ["permalink", "post link", "post url"],
  },
  type: {
    eq: ["content type", "post type", "type", "media type", "caption type"],
    wb: ["post type", "content type"],
  },
  author: {
    eq: ["individual", "posted by", "account name", "page name", "outlet name", "account username", "author"],
    wb: ["individual", "posted by"],
  },
};

const VIRAL_QUANTILE = 0.8;
const MAX_CLUSTERS = 6;

let DATASETS = [];          // [{name, kind, rows, fields, posts, dates, fieldMap, totals, ...}]
let ACTIVE = null;          // currently rendered dataset

/* ---------- DOM wiring ---------- */
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const sampleBtn = document.getElementById("loadSampleBtn");

dropzone.addEventListener("click", (e) => {
  if (e.target.closest("button")) return;
  fileInput.click();
});
fileInput.addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (f) loadFile(f);
});
["dragenter", "dragover"].forEach(ev => dropzone.addEventListener(ev, (e) => {
  e.preventDefault(); e.stopPropagation();
  dropzone.classList.add("dragover");
}));
["dragleave", "drop"].forEach(ev => dropzone.addEventListener(ev, (e) => {
  e.preventDefault(); e.stopPropagation();
  dropzone.classList.remove("dragover");
}));
dropzone.addEventListener("drop", (e) => {
  const f = e.dataTransfer.files[0];
  if (f) loadFile(f);
});
sampleBtn.addEventListener("click", (e) => {
  e.preventDefault(); e.stopPropagation();
  fetch("sample-data.csv").then(r => r.text()).then(text => {
    const ds = buildDatasetFromCsv("Sample data", text);
    setDatasets([ds]);
  });
});

/* ---------- File loading ---------- */
function loadFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array", cellDates: true });
        const datasets = wb.SheetNames.map(sn => buildDatasetFromXlsxSheet(sn, wb.Sheets[sn]))
          .filter(Boolean);
        if (!datasets.length) { alert("No usable sheets found in this file."); return; }
        setDatasets(datasets);
      } catch (err) {
        alert("Couldn't read this Excel file: " + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    const reader = new FileReader();
    reader.onload = (e) => {
      const ds = buildDatasetFromCsv(file.name.replace(/\.csv$/i, ""), e.target.result);
      setDatasets([ds]);
    };
    reader.readAsText(file);
  }
}

function buildDatasetFromCsv(name, text) {
  const result = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => String(h).trim(),
  });
  return buildDataset(name, result.data, result.meta.fields || []);
}

function buildDatasetFromXlsxSheet(name, sheet) {
  // sheet_to_json with header:1 → matrix; header:'A' → array of objects keyed by header.
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false });
  if (!rows.length) {
    return { name, kind: "empty", rows: [], fields: [], posts: [], dates: [], fieldMap: {} };
  }
  const fields = Object.keys(rows[0]).map(f => String(f).trim());
  return buildDataset(name, rows, fields);
}

function buildDataset(name, rows, fields) {
  const map = {};
  for (const key of Object.keys(COL_ALIASES)) {
    map[key] = detectColumn(fields, COL_ALIASES[key]);
  }

  // Normalise into row records
  const records = rows.map((r, i) => {
    const text = readField(r, map.text);
    const dateRaw = readField(r, map.date);
    const date = parseDate(dateRaw);
    const likes = toNumber(readField(r, map.likes));
    const comments = toNumber(readField(r, map.comments));
    const shares = toNumber(readField(r, map.shares));
    const impressions = toNumber(readField(r, map.impressions));
    const engagementsCol = toNumber(readField(r, map.engagements));
    // Engagement score: prefer explicit column, otherwise weighted likes+comments+shares.
    const engagement = engagementsCol > 0
      ? engagementsCol
      : (likes + 2 * comments + 3 * shares);
    return {
      i,
      text: text ? String(text).trim() : "",
      date,
      likes, comments, shares, impressions, engagement,
      url: readField(r, map.url) || "",
      type: readField(r, map.type) || "",
      author: readField(r, map.author) || "",
      raw: r,
    };
  });

  // Decide what kind of sheet this is.
  const hasAnyPostText = records.some(r => r.text.length > 0);
  const hasAnyUrl = records.some(r => r.url);
  const hasAnyEngagement = records.some(r => r.engagement > 0 || r.impressions > 0);
  const hasAuthor = records.some(r => r.author);
  const hasDate = records.some(r => r.date);

  let kind;
  if (records.length === 0) kind = "empty";
  else if ((hasAnyPostText || hasAnyUrl) && hasAnyEngagement) kind = "post";
  else if (hasDate && hasAnyEngagement) kind = "daily";
  else if (hasAnyEngagement) kind = "post";
  else kind = "empty";

  return {
    name,
    kind,
    rows,
    fields,
    fieldMap: map,
    posts: records,
    flags: { hasAnyPostText, hasAnyUrl, hasAnyEngagement, hasAuthor, hasDate },
  };
}

function detectColumn(fields, aliasGroup) {
  const lower = fields.map(f => ({ raw: f, low: String(f).toLowerCase().trim() }));
  // 1. Exact match
  for (const a of aliasGroup.eq || []) {
    const hit = lower.find(f => f.low === a);
    if (hit) return hit.raw;
  }
  // 2. Whole-word match (boundary-aware) — avoids "post" matching "reposts"
  for (const a of aliasGroup.wb || []) {
    const re = new RegExp(`(^|[^a-z])${escapeRegex(a)}([^a-z]|$)`, "i");
    const hit = lower.find(f => re.test(f.low));
    if (hit) return hit.raw;
  }
  return null;
}
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function readField(row, col) { return col == null ? null : row[col]; }
function toNumber(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  const cleaned = String(v).replace(/[%,$£€\s]/g, "");
  const n = Number(cleaned);
  return isNaN(n) ? 0 : n;
}
function parseDate(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

/* ---------- Datasets / sheet picker ---------- */
function setDatasets(datasets) {
  DATASETS = datasets;
  document.getElementById("results").hidden = false;
  renderSheetPicker();
  // Auto-pick priority: post sheet with text (richest), else any post sheet,
  // else daily aggregate, else first non-empty, else first.
  const pick = datasets.find(d => d.kind === "post" && d.flags && d.flags.hasAnyPostText)
    || datasets.find(d => d.kind === "post")
    || datasets.find(d => d.kind === "daily")
    || datasets.find(d => d.kind !== "empty")
    || datasets[0];
  setActive(pick);
  document.getElementById("sheetPicker").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderSheetPicker() {
  const picker = document.getElementById("sheetPicker");
  const tabs = document.getElementById("sheetTabs");
  const count = document.getElementById("sheetCount");
  picker.hidden = DATASETS.length <= 1;
  tabs.innerHTML = "";
  count.textContent = `${DATASETS.length} sheet${DATASETS.length === 1 ? "" : "s"} detected · click to switch`;
  DATASETS.forEach(ds => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sheet-tab";
    btn.disabled = ds.kind === "empty";
    btn.innerHTML = `<span class="dot kind-${ds.kind}"></span><span>${escapeHtml(ds.name)}</span><span class="count">${ds.posts.length}</span>`;
    btn.addEventListener("click", () => setActive(ds));
    btn.dataset.name = ds.name;
    tabs.appendChild(btn);
  });
}

function setActive(ds) {
  ACTIVE = ds;
  document.querySelectorAll(".sheet-tab").forEach(t => {
    t.classList.toggle("active", t.dataset.name === ds.name);
  });
  document.getElementById("sheetActive").textContent = `Showing: ${ds.name} (${labelKind(ds.kind)})`;
  destroyCharts();
  document.getElementById("overview").innerHTML = "";
  const body = document.getElementById("reportBody");
  body.innerHTML = "";
  if (ds.kind === "post") renderPostReport(ds, body);
  else if (ds.kind === "daily") renderDailyReport(ds, body);
  else renderEmpty(ds, body);
}

function labelKind(k) {
  return k === "post" ? "post-level" : k === "daily" ? "daily aggregate" : k === "empty" ? "no usable data" : k;
}

/* ---------- Analysis helpers ---------- */
function quantile(arr, q) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] != null
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base];
}
function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function pct(n) { return Math.round(n * 100); }
function fmt(n) {
  if (n == null || isNaN(n)) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k";
  return Math.round(n).toString();
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#@]/g, " ")
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .map(t => t.replace(/^[-']+|[-']+$/g, ""))
    .filter(t => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

function buildTfIdf(posts) {
  const docs = posts.map(p => tokenize(p.text));
  const df = new Map();
  for (const tokens of docs) {
    const seen = new Set(tokens);
    for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
  }
  const N = docs.length;
  const idf = new Map();
  for (const [t, c] of df) idf.set(t, Math.log(1 + N / c));
  const tfidf = docs.map(tokens => {
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    const scores = new Map();
    for (const [t, c] of tf) scores.set(t, (c / Math.max(tokens.length, 1)) * (idf.get(t) || 0));
    return scores;
  });
  return { docs, df, idf, tfidf };
}

function clusterByTopTerms(posts, tfidfData) {
  const { df, idf, tfidf } = tfidfData;
  const N = posts.length;
  const candidates = [];
  for (const [t, c] of df) {
    if (c < 2) continue;
    if (c / N > 0.6) continue;
    candidates.push({ term: t, score: c * (idf.get(t) || 0) });
  }
  candidates.sort((a, b) => b.score - a.score);
  const topicTerms = candidates.slice(0, Math.min(MAX_CLUSTERS * 2, 12)).map(c => c.term);

  const assignment = posts.map((_, i) => {
    const scores = tfidf[i];
    let best = null, bestScore = 0;
    for (const term of topicTerms) {
      const s = scores.get(term) || 0;
      if (s > bestScore) { bestScore = s; best = term; }
    }
    return best;
  });

  const groups = new Map();
  posts.forEach((p, i) => {
    const key = assignment[i] || "other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  });

  let clusters = [...groups.entries()].map(([term, items]) => {
    const totalEng = items.reduce((a, b) => a + b.engagement, 0);
    const avgEng = totalEng / items.length;
    const coTerms = new Map();
    for (const p of items) {
      const ts = tfidf[p.i];
      if (!ts) continue;
      for (const [t, s] of ts) {
        if (t === term) continue;
        coTerms.set(t, (coTerms.get(t) || 0) + s);
      }
    }
    const keywords = [...coTerms.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t);
    return { term, label: term === "other" ? "Other / mixed" : titleCase(term), items, avgEng, totalEng, keywords };
  });
  clusters.sort((a, b) => b.totalEng - a.totalEng);

  if (clusters.length > MAX_CLUSTERS) {
    const top = clusters.slice(0, MAX_CLUSTERS - 1);
    const tail = clusters.slice(MAX_CLUSTERS - 1);
    const merged = { term: "other", label: "Other / mixed", items: tail.flatMap(c => c.items), keywords: [] };
    merged.totalEng = merged.items.reduce((a, b) => a + b.engagement, 0);
    merged.avgEng = merged.totalEng / merged.items.length;
    clusters = [...top, merged];
  }
  return clusters;
}

function titleCase(s) {
  return s.split(/[\s-]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function postFeatures(p) {
  const text = p.text || "";
  const words = text.split(/\s+/).filter(Boolean);
  const firstLine = text.split(/\n/)[0] || "";
  const hashtags = (text.match(/#\w+/g) || []).length;
  const mentions = (text.match(/@\w+/g) || []).length;
  const hasQuestion = /\?/.test(text);
  const hasNumberHook = /\b\d+\b/.test(firstLine);
  const hasEmoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text);
  const isList = /(^|\n)\s*(?:[-*•]|\d+[.)])\s+/m.test(text);
  const hookWords = firstLine.toLowerCase();
  const isHookPattern = /\b(here(?:'s| is)|i learned|why|how|stop|never|the|3|5|7)\b/.test(hookWords) && firstLine.length < 120;
  return {
    words: words.length, chars: text.length,
    hashtags, mentions, hasQuestion, hasNumberHook, hasEmoji, isList, isHookPattern,
    dow: p.date ? p.date.getDay() : null,
    hour: p.date ? p.date.getHours() : null,
  };
}

const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function whyPostsWorked(viral, rest) {
  const v = viral.map(postFeatures);
  const r = rest.map(postFeatures);
  if (!v.length || !r.length) return [];

  const cmp = (key, label, format = (x) => x.toFixed(0)) => {
    const va = mean(v.map(x => x[key]));
    const ra = mean(r.map(x => x[key]));
    const delta = ra === 0 ? (va > 0 ? 1 : 0) : (va - ra) / ra;
    return { label, value: format(va), restValue: format(ra), delta };
  };
  const cmpBool = (key, label) => {
    const va = v.filter(x => x[key]).length / v.length;
    const ra = r.filter(x => x[key]).length / r.length;
    const delta = ra === 0 ? (va > 0 ? 1 : 0) : (va - ra) / ra;
    return { label, value: pct(va) + "%", restValue: pct(ra) + "%", delta };
  };

  const items = [
    cmp("words", "Average length", (x) => Math.round(x) + " words"),
    cmp("hashtags", "Hashtags per post", (x) => x.toFixed(1)),
    cmpBool("isHookPattern", "Strong opening hook"),
    cmpBool("hasQuestion", "Asks a question"),
    cmpBool("hasNumberHook", "Number in the first line"),
    cmpBool("isList", "Formatted as a list"),
    cmpBool("hasEmoji", "Uses emoji"),
  ];

  const dowAvg = Array(7).fill(0).map(() => ({ n: 0, eng: 0 }));
  v.forEach((f, i) => {
    if (f.dow == null) return;
    dowAvg[f.dow].n++;
    dowAvg[f.dow].eng += viral[i].engagement;
  });
  const totalsByDow = dowAvg.map((c, i) => ({ day: DOW_NAMES[i], avg: c.n ? c.eng / c.n : 0, n: c.n }))
    .filter(x => x.n > 0).sort((a, b) => b.avg - a.avg);
  if (totalsByDow.length) {
    items.push({
      label: "Best day to post",
      value: totalsByDow[0].day,
      restValue: `${totalsByDow[0].n} viral post${totalsByDow[0].n === 1 ? "" : "s"}`,
      delta: 0,
      note: true,
    });
  }
  return items;
}

/* ---------- Renderers ---------- */
let charts = {};
function destroyCharts() {
  for (const k of Object.keys(charts)) { try { charts[k].destroy(); } catch (_) {} }
  charts = {};
}

function renderEmpty(ds, body) {
  body.innerHTML = `
    <section class="card">
      <div class="card-head">
        <h2>${escapeHtml(ds.name)}</h2>
        <div class="muted small">No usable rows in this sheet.</div>
      </div>
      <div class="empty-note">This sheet is empty or its columns weren't recognised. Detected ${ds.fields.length} columns and ${ds.rows.length} rows.</div>
    </section>
  `;
}

function renderKpis(items) {
  const overview = document.getElementById("overview");
  overview.innerHTML = items.map(it => `
    <div class="card kpi">
      <div class="kpi-label">${escapeHtml(it.label)}${it.hint ? ` <span class="kpi-hint">${escapeHtml(it.hint)}</span>` : ""}</div>
      <div class="kpi-value">${it.html || escapeHtml(it.value)}</div>
    </div>
  `).join("");
}

function renderPostReport(ds, body) {
  const posts = ds.posts;
  const engagements = posts.map(p => p.engagement);
  const impressions = posts.map(p => p.impressions);
  const totalEng = engagements.reduce((a, b) => a + b, 0);
  const totalImp = impressions.reduce((a, b) => a + b, 0);
  const threshold = quantile(engagements, VIRAL_QUANTILE);
  const viral = posts.filter(p => p.engagement >= threshold && p.engagement > 0);
  const rest = posts.filter(p => !(p.engagement >= threshold && p.engagement > 0));

  // KPI row — drop engagement-related KPIs when there's no engagement signal
  const kpis = [{ label: "Posts", value: fmt(posts.length) }];
  if (totalImp > 0) kpis.push({ label: "Total impressions", value: fmt(totalImp) });
  if (totalEng > 0) {
    kpis.push({ label: "Total engagement", value: fmt(totalEng) });
    kpis.push({ label: "Viral posts", hint: "(top 20%)", value: fmt(viral.length) });
    kpis.push({ label: "Avg engagement / post", value: fmt(mean(engagements)) });
  } else if (totalImp > 0) {
    kpis.push({ label: "Avg impressions / post", value: fmt(mean(impressions)) });
  }

  // Topic clustering only meaningful with text
  const hasText = posts.some(p => p.text && p.text.length > 5);
  let clusters = [];
  if (hasText) {
    const tf = buildTfIdf(posts.filter(p => p.text));
    clusters = clusterByTopTerms(posts.filter(p => p.text), tf);
    if (clusters[0]) kpis.push({ label: "Top topic", value: clusters[0].label });
  }
  renderKpis(kpis);

  // Build the report sections
  const haveDate = posts.some(p => p.date);
  body.innerHTML = `
    <section class="grid-2">
      <div class="card">
        <div class="card-head">
          <h2>${haveDate ? "Engagement over time" : "Posts by impressions"}</h2>
          <div class="muted small">${haveDate ? "Daily total engagement across all posts in this sheet" : "No date column found — showing impressions distribution"}</div>
        </div>
        <canvas id="chartTimeline" height="120"></canvas>
      </div>
      <div class="card">
        <div class="card-head">
          <h2>${hasText ? "Top topics by engagement" : "Top performers"}</h2>
          <div class="muted small">${hasText ? "Discovered from your post text" : (ds.flags.hasAuthor ? "By author / individual" : "Top posts by engagement")}</div>
        </div>
        <canvas id="chartTopics" height="120"></canvas>
      </div>
    </section>
    ${ds.flags.hasAuthor ? `
    <section class="card">
      <div class="card-head">
        <h2>People leaderboard</h2>
        <div class="muted small">Total impressions and engagement per author / individual</div>
      </div>
      <div id="peopleList" class="people-list"></div>
    </section>` : ""}
    ${hasText ? `
    <section id="topics" class="card">
      <div class="card-head">
        <h2>Topic clusters</h2>
        <div class="muted small">Posts grouped by what they're about. Click a cluster to see the posts.</div>
      </div>
      <div id="clusters" class="clusters"></div>
    </section>
    <section id="why" class="card">
      <div class="card-head">
        <h2>Why your viral posts worked</h2>
        <div class="muted small">Patterns across top-performing posts vs the rest.</div>
      </div>
      <div id="whyGrid" class="why-grid"></div>
    </section>` : ""}
    <section class="card">
      <div class="card-head">
        <h2>Top 10 posts</h2>
        <div class="muted small">Sorted by engagement (or impressions if no engagement data)</div>
      </div>
      <div id="topPosts" class="posts-list"></div>
    </section>
  `;

  // Render the dynamic bits
  if (haveDate) renderTimeline(posts);
  else renderImpressionsDistribution(posts);

  if (hasText && clusters.length) renderTopicsChart(clusters);
  else if (ds.flags.hasAuthor) renderAuthorsChart(posts);
  else renderTopPostsChart(posts);

  if (ds.flags.hasAuthor) renderPeople(posts);
  if (hasText && clusters.length) {
    renderClusters(clusters);
    renderWhy(viral, rest);
  }
  renderTopPosts(posts);
}

function renderDailyReport(ds, body) {
  const rows = ds.posts.filter(r => r.date);
  if (!rows.length) return renderEmpty(ds, body);
  const totalImp = rows.reduce((s, r) => s + r.impressions, 0);
  const totalEng = rows.reduce((s, r) => s + r.engagement, 0);
  const avgEngPerDay = totalEng / rows.length;
  const avgImpPerDay = totalImp / rows.length;
  const range = `${rows[0].date.toLocaleDateString()} → ${rows[rows.length - 1].date.toLocaleDateString()}`;

  renderKpis([
    { label: "Days of data", value: rows.length },
    { label: "Total impressions", value: fmt(totalImp) },
    { label: "Total engagement", value: fmt(totalEng) },
    { label: "Avg / day (impressions)", value: fmt(avgImpPerDay) },
    { label: "Avg / day (engagement)", value: fmt(avgEngPerDay) },
    { label: "Date range", value: range },
  ]);

  body.innerHTML = `
    <section class="card">
      <div class="card-head">
        <h2>Daily timeline</h2>
        <div class="muted small">Impressions and engagement per day</div>
      </div>
      <canvas id="chartTimeline" height="100"></canvas>
    </section>
    <section class="card">
      <div class="card-head">
        <h2>Best days</h2>
        <div class="muted small">Top 10 days by total engagement</div>
      </div>
      <div id="topDays" class="people-list"></div>
    </section>
  `;
  renderDailyTimeline(rows);
  renderTopDays(rows);
}

/* ----- Charts ----- */
function renderTimeline(posts) {
  const dated = posts.filter(p => p.date);
  const ctx = document.getElementById("chartTimeline");
  if (!dated.length || !ctx) return;
  const byDay = new Map();
  for (const p of dated) {
    const k = p.date.toISOString().slice(0, 10);
    byDay.set(k, (byDay.get(k) || 0) + p.engagement);
  }
  const labels = [...byDay.keys()].sort();
  const data = labels.map(l => byDay.get(l));
  charts.timeline = new Chart(ctx, {
    type: "line",
    data: { labels, datasets: [{ label: "Engagement", data, borderColor: "#0A66C2", backgroundColor: "rgba(10,102,194,0.12)", fill: true, tension: 0.3, pointRadius: 2, pointHoverRadius: 5, borderWidth: 2 }] },
    options: linearChartOpts(),
  });
}

function renderImpressionsDistribution(posts) {
  const ctx = document.getElementById("chartTimeline");
  if (!ctx) return;
  const sorted = [...posts].sort((a, b) => b.impressions - a.impressions).slice(0, 25);
  charts.timeline = new Chart(ctx, {
    type: "bar",
    data: {
      labels: sorted.map((_, i) => `#${i + 1}`),
      datasets: [{ label: "Impressions", data: sorted.map(p => p.impressions), backgroundColor: "#0A66C2", borderRadius: 4 }],
    },
    options: linearChartOpts(),
  });
}

function renderDailyTimeline(rows) {
  const ctx = document.getElementById("chartTimeline");
  if (!ctx) return;
  const byDay = new Map();
  rows.forEach(r => {
    const k = r.date.toISOString().slice(0, 10);
    if (!byDay.has(k)) byDay.set(k, { imp: 0, eng: 0 });
    const cur = byDay.get(k);
    cur.imp += r.impressions; cur.eng += r.engagement;
  });
  const labels = [...byDay.keys()].sort();
  const imp = labels.map(l => byDay.get(l).imp);
  const eng = labels.map(l => byDay.get(l).eng);
  charts.timeline = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Impressions", data: imp, borderColor: "#0A66C2", backgroundColor: "rgba(10,102,194,0.12)", fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2, yAxisID: "y" },
        { label: "Engagement", data: eng, borderColor: "#057642", backgroundColor: "rgba(5,118,66,0.0)", borderDash: [4, 4], tension: 0.3, pointRadius: 0, borderWidth: 2, yAxisID: "y1" },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { position: "bottom" } },
      scales: {
        x: { ticks: { maxTicksLimit: 10, color: "#666" }, grid: { display: false } },
        y: { beginAtZero: true, position: "left", title: { display: true, text: "Impressions" }, ticks: { color: "#666" }, grid: { color: "#eee" } },
        y1: { beginAtZero: true, position: "right", title: { display: true, text: "Engagement" }, ticks: { color: "#666" }, grid: { display: false } },
      },
    },
  });
}

function renderTopicsChart(clusters) {
  const ctx = document.getElementById("chartTopics");
  if (!ctx) return;
  const top = clusters.slice(0, 6);
  charts.topics = new Chart(ctx, {
    type: "bar",
    data: { labels: top.map(c => c.label), datasets: [{ label: "Avg engagement", data: top.map(c => Math.round(c.avgEng)), backgroundColor: "#0A66C2", borderRadius: 4 }] },
    options: barHorizontalOpts(),
  });
}

function renderAuthorsChart(posts) {
  const ctx = document.getElementById("chartTopics");
  if (!ctx) return;
  const totals = aggregateByAuthor(posts);
  const top = totals.slice(0, 8);
  charts.topics = new Chart(ctx, {
    type: "bar",
    data: { labels: top.map(t => t.author), datasets: [{ label: "Total impressions", data: top.map(t => t.impressions), backgroundColor: "#0A66C2", borderRadius: 4 }] },
    options: barHorizontalOpts(),
  });
}

function renderTopPostsChart(posts) {
  const ctx = document.getElementById("chartTopics");
  if (!ctx) return;
  const top = [...posts].sort((a, b) => b.engagement - a.engagement).slice(0, 8);
  charts.topics = new Chart(ctx, {
    type: "bar",
    data: { labels: top.map((_, i) => `#${i + 1}`), datasets: [{ label: "Engagement", data: top.map(p => p.engagement), backgroundColor: "#0A66C2", borderRadius: 4 }] },
    options: barHorizontalOpts(),
  });
}

function aggregateByAuthor(posts) {
  const byAuthor = new Map();
  for (const p of posts) {
    if (!p.author) continue;
    if (!byAuthor.has(p.author)) byAuthor.set(p.author, { author: p.author, posts: 0, impressions: 0, engagement: 0 });
    const cur = byAuthor.get(p.author);
    cur.posts++; cur.impressions += p.impressions; cur.engagement += p.engagement;
  }
  return [...byAuthor.values()].sort((a, b) => b.impressions - a.impressions);
}

function renderPeople(posts) {
  const wrap = document.getElementById("peopleList");
  if (!wrap) return;
  const totals = aggregateByAuthor(posts);
  if (!totals.length) { wrap.innerHTML = `<div class="empty-note">No author column found.</div>`; return; }
  wrap.innerHTML = totals.slice(0, 12).map((t, i) => `
    <div class="person">
      <div class="pos">${i + 1}</div>
      <div>
        <div class="name">${escapeHtml(t.author)}</div>
        <div class="meta">${t.posts} post${t.posts === 1 ? "" : "s"}</div>
      </div>
      <div class="stat">
        <div class="v">${fmt(t.impressions)} <span class="l">imp</span></div>
        <div class="l">${fmt(t.engagement)} eng</div>
      </div>
    </div>
  `).join("");
}

function renderTopDays(rows) {
  const wrap = document.getElementById("topDays");
  if (!wrap) return;
  const top = [...rows].sort((a, b) => b.engagement - a.engagement).slice(0, 10);
  wrap.innerHTML = top.map((r, i) => `
    <div class="person">
      <div class="pos">${i + 1}</div>
      <div>
        <div class="name">${r.date.toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" })}</div>
        <div class="meta">${r.author ? escapeHtml(r.author) + " · " : ""}${fmt(r.impressions)} impressions</div>
      </div>
      <div class="stat">
        <div class="v">${fmt(r.engagement)} <span class="l">eng</span></div>
      </div>
    </div>
  `).join("");
}

function renderClusters(clusters) {
  const wrap = document.getElementById("clusters");
  if (!wrap) return;
  wrap.innerHTML = "";
  clusters.forEach((c, i) => {
    const el = document.createElement("div");
    el.className = "cluster" + (i === 0 ? " active" : "");
    el.innerHTML = `
      <div class="cluster-title">${escapeHtml(c.label)}<span class="badge">${c.items.length}</span></div>
      <div class="cluster-meta">Avg engagement <strong>${fmt(c.avgEng)}</strong></div>
      <div class="cluster-keywords">
        ${c.keywords.slice(0, 4).map(k => `<span class="chip">${escapeHtml(k)}</span>`).join("")}
      </div>
    `;
    el.addEventListener("click", () => showClusterDetail(c, el));
    wrap.appendChild(el);
  });
  if (clusters[0]) showClusterDetail(clusters[0], wrap.firstChild);
}

function showClusterDetail(cluster, clickedEl) {
  document.querySelectorAll(".cluster").forEach(n => n.classList.remove("active"));
  if (clickedEl) clickedEl.classList.add("active");
  let detail = document.getElementById("clusterDetail");
  if (!detail) {
    detail = document.createElement("div");
    detail.id = "clusterDetail";
    detail.className = "cluster-detail";
    document.getElementById("topics").appendChild(detail);
  }
  const top = [...cluster.items].sort((a, b) => b.engagement - a.engagement).slice(0, 5);
  detail.innerHTML = `
    <h3>${escapeHtml(cluster.label)} — top posts</h3>
    <div class="posts-list">${top.map((p, i) => postCard(p, i + 1)).join("")}</div>
  `;
}

function renderWhy(viral, rest) {
  const wrap = document.getElementById("whyGrid");
  if (!wrap) return;
  const items = whyPostsWorked(viral, rest);
  if (!items.length) { wrap.innerHTML = `<div class="empty-note">Not enough posts to compare.</div>`; return; }
  wrap.innerHTML = items.map(it => {
    const dir = it.note ? "delta-flat" : (it.delta > 0.1 ? "delta-up" : it.delta < -0.1 ? "delta-down" : "delta-flat");
    const arrow = it.note ? "" : (it.delta > 0.1 ? "▲" : it.delta < -0.1 ? "▼" : "▬");
    const deltaText = it.note
      ? it.restValue
      : (it.delta === 0 ? "Same as the rest" : `${arrow} ${pct(Math.abs(it.delta))}% vs the rest (${it.restValue})`);
    return `
      <div class="why-item">
        <div class="why-title">${escapeHtml(it.label)}</div>
        <div class="why-detail"><strong>${escapeHtml(it.value)}</strong>${it.note ? "" : " on viral posts"}</div>
        <div class="why-delta ${dir}">${escapeHtml(deltaText)}</div>
      </div>
    `;
  }).join("");
}

function renderTopPosts(posts) {
  const wrap = document.getElementById("topPosts");
  if (!wrap) return;
  const top = [...posts].sort((a, b) => (b.engagement - a.engagement) || (b.impressions - a.impressions)).slice(0, 10);
  wrap.innerHTML = top.map((p, i) => postCard(p, i + 1)).join("");
}

function postCard(p, rank) {
  const dateStr = p.date ? p.date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
  const text = p.text || (p.url ? "(no text — see linked post)" : "(no text)");
  return `
    <div class="post">
      <div class="post-body">
        <div class="post-text">${escapeHtml(text)}</div>
        <div class="post-meta">
          ${dateStr ? `<span class="stat"><span class="lbl">Date</span> ${escapeHtml(dateStr)}</span>` : ""}
          ${p.author ? `<span class="stat"><span class="lbl">By</span> ${escapeHtml(p.author)}</span>` : ""}
          <span class="stat"><span class="lbl">Impressions</span> ${fmt(p.impressions)}</span>
          <span class="stat"><span class="lbl">Likes</span> ${fmt(p.likes)}</span>
          <span class="stat"><span class="lbl">Comments</span> ${fmt(p.comments)}</span>
          <span class="stat"><span class="lbl">Reposts</span> ${fmt(p.shares)}</span>
          ${p.url ? `<a class="post-link" href="${escapeAttr(p.url)}" target="_blank" rel="noopener">View ↗</a>` : ""}
        </div>
      </div>
      <div class="post-rank">
        <div class="rank">#${rank}</div>
        <div class="score">${fmt(p.engagement || p.impressions)}</div>
        <div class="score-label">${p.engagement ? "engagement" : "impressions"}</div>
      </div>
    </div>
  `;
}

/* Chart option helpers */
function linearChartOpts() {
  return {
    responsive: true,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { maxTicksLimit: 8, color: "#666" }, grid: { display: false } },
      y: { beginAtZero: true, ticks: { color: "#666" }, grid: { color: "#eee" } },
    },
  };
}
function barHorizontalOpts() {
  return {
    indexAxis: "y",
    responsive: true,
    plugins: { legend: { display: false } },
    scales: {
      x: { beginAtZero: true, ticks: { color: "#666" }, grid: { color: "#eee" } },
      y: { ticks: { color: "#222" }, grid: { display: false } },
    },
  };
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function escapeAttr(s) { return escapeHtml(s); }
