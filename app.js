/* Quick Data — LinkedIn viral post analyser
   Pure-browser dashboard. Loads a CSV with PapaParse, scores engagement,
   discovers topic clusters via TF-IDF, surfaces the patterns behind viral posts,
   and renders charts with Chart.js. */

const STOPWORDS = new Set(("a,about,above,after,again,against,all,am,an,and,any,are,arent,as,at,be,because,been,before,being,below,between,both,but,by,can,cant,could,couldnt,did,didnt,do,does,doesnt,doing,dont,down,during,each,few,for,from,further,had,hadnt,has,hasnt,have,havent,having,he,hed,hell,hes,her,here,heres,hers,herself,him,himself,his,how,hows,i,id,ill,im,ive,if,in,into,is,isnt,it,its,itself,lets,me,more,most,mustnt,my,myself,no,nor,not,of,off,on,once,only,or,other,ought,our,ours,ourselves,out,over,own,same,shant,she,shed,shell,shes,should,shouldnt,so,some,such,than,that,thats,the,their,theirs,them,themselves,then,there,theres,these,they,theyd,theyll,theyre,theyve,this,those,through,to,too,under,until,up,very,was,wasnt,we,wed,well,were,weve,werent,what,whats,when,whens,where,wheres,which,while,who,whos,whom,why,whys,with,wont,would,wouldnt,you,youd,youll,youre,youve,your,yours,yourself,yourselves,just,like,get,got,one,two,three,really,also,now,know,much,many,thing,things,way,still,even,back,via,new,make,made,take,taken,go,going,gone,need,want,see,say,said,came,come,let,put").split(","));

const COL_ALIASES = {
  text: ["post text", "commentary", "post commentary", "text", "content", "message", "post", "description", "body"],
  date: ["date", "post date", "created", "created at", "posted at", "published", "published at", "time"],
  likes: ["likes", "reactions", "total reactions", "like count", "reaction count"],
  comments: ["comments", "comment count", "comment"],
  shares: ["shares", "reposts", "repost count", "share count"],
  impressions: ["impressions", "views", "impression count", "reach"],
  url: ["url", "post url", "link", "permalink"],
  type: ["type", "post type", "media type"],
};

const VIRAL_QUANTILE = 0.8; // top 20%
const MAX_CLUSTERS = 6;

let DATA = null;

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
  if (f) parseFile(f);
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
  if (f) parseFile(f);
});
sampleBtn.addEventListener("click", (e) => {
  e.preventDefault(); e.stopPropagation();
  fetch("sample-data.csv").then(r => r.text()).then(text => parseCsvText(text));
});

/* ---------- CSV parsing & normalisation ---------- */
function parseFile(file) {
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
    complete: (results) => onParsed(results.data, results.meta.fields || []),
  });
}
function parseCsvText(text) {
  const results = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  onParsed(results.data, results.meta.fields || []);
}

function detectColumn(fields, aliases) {
  const lower = fields.map(f => ({ raw: f, low: f.toLowerCase().trim() }));
  for (const a of aliases) {
    const hit = lower.find(f => f.low === a);
    if (hit) return hit.raw;
  }
  for (const a of aliases) {
    const hit = lower.find(f => f.low.includes(a));
    if (hit) return hit.raw;
  }
  return null;
}

function toNumber(v) {
  if (v == null || v === "") return 0;
  const n = Number(String(v).replace(/[, ]/g, ""));
  return isNaN(n) ? 0 : n;
}

function onParsed(rows, fields) {
  const map = {
    text: detectColumn(fields, COL_ALIASES.text),
    date: detectColumn(fields, COL_ALIASES.date),
    likes: detectColumn(fields, COL_ALIASES.likes),
    comments: detectColumn(fields, COL_ALIASES.comments),
    shares: detectColumn(fields, COL_ALIASES.shares),
    impressions: detectColumn(fields, COL_ALIASES.impressions),
    url: detectColumn(fields, COL_ALIASES.url),
    type: detectColumn(fields, COL_ALIASES.type),
  };

  const posts = rows.map((r, i) => {
    const likes = toNumber(map.likes && r[map.likes]);
    const comments = toNumber(map.comments && r[map.comments]);
    const shares = toNumber(map.shares && r[map.shares]);
    const impressions = toNumber(map.impressions && r[map.impressions]);
    const text = (map.text && r[map.text]) ? String(r[map.text]) : "";
    const dateRaw = map.date && r[map.date];
    const date = dateRaw ? new Date(dateRaw) : null;
    return {
      i,
      text: text.trim(),
      date: date && !isNaN(date) ? date : null,
      likes, comments, shares, impressions,
      url: map.url ? r[map.url] : "",
      type: map.type ? r[map.type] : "",
      // engagement score: weighted, fallback when impressions missing
      engagement: likes + 2 * comments + 3 * shares,
    };
  }).filter(p => p.text.length > 0);

  if (!posts.length) {
    alert("No posts found in this CSV. Make sure there's a column with the post text (e.g. 'Post commentary' or 'text').");
    return;
  }

  DATA = { posts, fieldMap: map };
  renderAll();
  document.getElementById("results").hidden = false;
  document.getElementById("results").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- Analysis ---------- */
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
function fmt(n) { return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : Math.round(n).toString(); }

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
    for (const [t, c] of tf) scores.set(t, (c / tokens.length) * (idf.get(t) || 0));
    return scores;
  });
  return { docs, df, idf, tfidf };
}

function clusterByTopTerms(posts, tfidfData) {
  // Heuristic clustering: pick top global terms (high idf-weighted document frequency),
  // then assign each post to the term with the highest TF-IDF score it contains.
  const { df, idf, tfidf } = tfidfData;
  const N = posts.length;

  // Candidate topic terms: appear in ≥2 posts and ≤60% of posts; rank by df * idf.
  const candidates = [];
  for (const [t, c] of df) {
    if (c < 2) continue;
    if (c / N > 0.6) continue;
    candidates.push({ term: t, score: c * (idf.get(t) || 0) });
  }
  candidates.sort((a, b) => b.score - a.score);
  const topicTerms = candidates.slice(0, Math.min(MAX_CLUSTERS * 2, 12)).map(c => c.term);

  // Assign posts
  const assignment = posts.map((p, i) => {
    const scores = tfidf[i];
    let best = null, bestScore = 0;
    for (const term of topicTerms) {
      const s = scores.get(term) || 0;
      if (s > bestScore) { bestScore = s; best = term; }
    }
    return best;
  });

  // Group
  const groups = new Map();
  posts.forEach((p, i) => {
    const key = assignment[i] || "other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  });

  // Build cluster objects, sort by total engagement, cap to MAX_CLUSTERS
  let clusters = [...groups.entries()].map(([term, items]) => {
    const totalEng = items.reduce((a, b) => a + b.engagement, 0);
    const avgEng = totalEng / items.length;
    // Co-occurring keywords for this cluster
    const coTerms = new Map();
    for (const p of items) {
      const ts = tfidf[p.i];
      if (!ts) continue;
      for (const [t, s] of ts) {
        if (t === term) continue;
        coTerms.set(t, (coTerms.get(t) || 0) + s);
      }
    }
    const keywords = [...coTerms.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([t]) => t);
    return {
      term,
      label: term === "other" ? "Other / mixed" : titleCase(term),
      items,
      avgEng,
      totalEng,
      keywords,
    };
  });

  clusters.sort((a, b) => b.totalEng - a.totalEng);

  // Merge any beyond MAX_CLUSTERS into Other
  if (clusters.length > MAX_CLUSTERS) {
    const top = clusters.slice(0, MAX_CLUSTERS - 1);
    const tail = clusters.slice(MAX_CLUSTERS - 1);
    const merged = {
      term: "other",
      label: "Other / mixed",
      items: tail.flatMap(c => c.items),
      keywords: [],
    };
    merged.totalEng = merged.items.reduce((a, b) => a + b.engagement, 0);
    merged.avgEng = merged.totalEng / merged.items.length;
    clusters = [...top, merged];
  }
  return clusters;
}

function titleCase(s) {
  return s.split(/[\s-]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/* "Why posts worked" feature extraction */
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
    words: words.length,
    chars: text.length,
    hashtags,
    mentions,
    hasQuestion,
    hasNumberHook,
    hasEmoji,
    isList,
    isHookPattern,
    dow: p.date ? p.date.getDay() : null,
    hour: p.date ? p.date.getHours() : null,
  };
}

const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function whyPostsWorked(viral, rest) {
  const v = viral.map(postFeatures);
  const r = rest.map(postFeatures);
  if (!v.length || !r.length) return [];

  const compare = (vals, key, label, format = (x) => x.toFixed(0)) => {
    const va = mean(vals.viral.map(x => x[key]));
    const ra = mean(vals.rest.map(x => x[key]));
    const delta = ra === 0 ? (va > 0 ? 1 : 0) : (va - ra) / ra;
    return { label, value: format(va), restValue: format(ra), delta };
  };
  const compareBool = (vals, key, label) => {
    const va = vals.viral.filter(x => x[key]).length / vals.viral.length;
    const ra = vals.rest.filter(x => x[key]).length / vals.rest.length;
    const delta = ra === 0 ? (va > 0 ? 1 : 0) : (va - ra) / ra;
    return { label, value: pct(va) + "%", restValue: pct(ra) + "%", delta };
  };
  const vals = { viral: v, rest: r };

  const items = [
    compare(vals, "words", "Average length", (x) => Math.round(x) + " words"),
    compare(vals, "hashtags", "Hashtags per post", (x) => x.toFixed(1)),
    compareBool(vals, "isHookPattern", "Strong opening hook"),
    compareBool(vals, "hasQuestion", "Asks a question"),
    compareBool(vals, "hasNumberHook", "Number in the first line"),
    compareBool(vals, "isList", "Formatted as a list"),
    compareBool(vals, "hasEmoji", "Uses emoji"),
  ];

  // Best day of week
  const byDow = (set) => {
    const counts = Array(7).fill(0).map(() => ({ n: 0, eng: 0 }));
    set.forEach((f, i) => {
      if (f.dow == null) return;
      counts[f.dow].n++;
      counts[f.dow].eng += (set === v ? viral[i] : rest[i]).engagement;
    });
    return counts;
  };
  const dowViral = byDow(v);
  const totalsByDow = dowViral.map((c, i) => ({ day: DOW_NAMES[i], avg: c.n ? c.eng / c.n : 0, n: c.n }))
    .filter(x => x.n > 0)
    .sort((a, b) => b.avg - a.avg);
  if (totalsByDow.length) {
    items.push({
      label: "Best day to post",
      value: totalsByDow[0].day,
      restValue: `${totalsByDow[0].n} viral posts`,
      delta: 0.0,
      note: true,
    });
  }
  return items;
}

/* ---------- Rendering ---------- */
let charts = {};

function renderAll() {
  const posts = DATA.posts;
  const engs = posts.map(p => p.engagement);
  const threshold = quantile(engs, VIRAL_QUANTILE);
  const viral = posts.filter(p => p.engagement >= threshold && p.engagement > 0);
  const rest = posts.filter(p => !(p.engagement >= threshold && p.engagement > 0));

  // KPIs
  document.getElementById("kpiTotal").textContent = posts.length;
  document.getElementById("kpiViral").textContent = viral.length;
  document.getElementById("kpiAvg").textContent = fmt(mean(engs));

  const tfidfData = buildTfIdf(posts);
  const clusters = clusterByTopTerms(posts, tfidfData);
  document.getElementById("kpiTopTopic").textContent = clusters[0] ? clusters[0].label : "—";

  renderTimeline(posts);
  renderTopicsChart(clusters);
  renderClusters(clusters);
  renderWhy(viral, rest);
  renderTopPosts(posts);
}

function renderTimeline(posts) {
  const dated = posts.filter(p => p.date);
  if (!dated.length) {
    if (charts.timeline) { charts.timeline.destroy(); charts.timeline = null; }
    return;
  }
  // Bucket by day
  const byDay = new Map();
  for (const p of dated) {
    const k = p.date.toISOString().slice(0, 10);
    byDay.set(k, (byDay.get(k) || 0) + p.engagement);
  }
  const labels = [...byDay.keys()].sort();
  const data = labels.map(l => byDay.get(l));

  const ctx = document.getElementById("chartTimeline");
  if (charts.timeline) charts.timeline.destroy();
  charts.timeline = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Engagement",
        data,
        borderColor: "#0A66C2",
        backgroundColor: "rgba(10,102,194,0.12)",
        fill: true,
        tension: 0.3,
        pointRadius: 2,
        pointHoverRadius: 5,
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { maxTicksLimit: 8, color: "#666" }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: "#666" }, grid: { color: "#eee" } },
      },
    },
  });
}

function renderTopicsChart(clusters) {
  const top = clusters.slice(0, 6);
  const ctx = document.getElementById("chartTopics");
  if (charts.topics) charts.topics.destroy();
  charts.topics = new Chart(ctx, {
    type: "bar",
    data: {
      labels: top.map(c => c.label),
      datasets: [{
        label: "Avg engagement",
        data: top.map(c => Math.round(c.avgEng)),
        backgroundColor: "#0A66C2",
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, ticks: { color: "#666" }, grid: { color: "#eee" } },
        y: { ticks: { color: "#222" }, grid: { display: false } },
      },
    },
  });
}

function renderClusters(clusters) {
  const wrap = document.getElementById("clusters");
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
  const items = whyPostsWorked(viral, rest);
  const wrap = document.getElementById("whyGrid");
  if (!items.length) { wrap.innerHTML = `<div class="muted">Not enough posts to compare.</div>`; return; }
  wrap.innerHTML = items.map(it => {
    const dir = it.note ? "delta-flat" : (it.delta > 0.1 ? "delta-up" : it.delta < -0.1 ? "delta-down" : "delta-flat");
    const arrow = it.note ? "" : (it.delta > 0.1 ? "▲" : it.delta < -0.1 ? "▼" : "▬");
    const deltaText = it.note
      ? it.restValue
      : (it.delta === 0 ? "Same as the rest" : `${arrow} ${pct(Math.abs(it.delta))}% vs the rest (${it.restValue})`);
    const detailText = it.note ? it.value : `<strong>${escapeHtml(it.value)}</strong> on viral posts`;
    return `
      <div class="why-item">
        <div class="why-title">${escapeHtml(it.label)}</div>
        <div class="why-detail">${it.note ? `<strong>${escapeHtml(it.value)}</strong>` : detailText}</div>
        <div class="why-delta ${dir}">${escapeHtml(deltaText)}</div>
      </div>
    `;
  }).join("");
}

function renderTopPosts(posts) {
  const top = [...posts].sort((a, b) => b.engagement - a.engagement).slice(0, 10);
  document.getElementById("topPosts").innerHTML = top.map((p, i) => postCard(p, i + 1)).join("");
}

function postCard(p, rank) {
  const dateStr = p.date ? p.date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
  return `
    <div class="post">
      <div class="post-body">
        <div class="post-text">${escapeHtml(p.text)}</div>
        <div class="post-meta">
          ${dateStr ? `<span class="stat"><span class="lbl">Date</span> ${escapeHtml(dateStr)}</span>` : ""}
          <span class="stat"><span class="lbl">Likes</span> ${fmt(p.likes)}</span>
          <span class="stat"><span class="lbl">Comments</span> ${fmt(p.comments)}</span>
          <span class="stat"><span class="lbl">Reposts</span> ${fmt(p.shares)}</span>
          ${p.impressions ? `<span class="stat"><span class="lbl">Impressions</span> ${fmt(p.impressions)}</span>` : ""}
          ${p.url ? `<a class="post-link" href="${escapeAttr(p.url)}" target="_blank" rel="noopener">View on LinkedIn ↗</a>` : ""}
        </div>
      </div>
      <div class="post-rank">
        <div class="rank">#${rank}</div>
        <div class="score">${fmt(p.engagement)}</div>
        <div class="score-label">engagement</div>
      </div>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function escapeAttr(s) { return escapeHtml(s); }
