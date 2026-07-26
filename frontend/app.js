const API = "/api";

// ---------------------------------------------------------------- Clerk authentication
let clerk = null; // the Clerk instance, once loaded
const CACHED_USER_KEY = "ledger.cachedUser"; // "login info save" — last-known profile, for instant display on reload

function getCachedUser() {
  try { return JSON.parse(localStorage.getItem(CACHED_USER_KEY) || "null"); }
  catch { return null; }
}
function setCachedUser(user) {
  if (user) localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(CACHED_USER_KEY);
}

/** Wraps fetch() so every request to our API carries the signed-in user's
 * Clerk session token, once auth is configured. Falls back to a plain fetch
 * if Clerk isn't loaded/configured (dev mode with no keys set yet). */
async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (clerk && clerk.session) {
    try {
      const token = await clerk.session.getToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
    } catch { /* no active session yet */ }
  }
  return fetch(url, { ...options, headers });
}

function showCachedUserBadge() {
  document.getElementById("user-badge").style.display = "flex";
  const cached = getCachedUser();
  if (cached) {
    document.getElementById("user-name").textContent = cached.name || cached.email || "Signed in";
    if (cached.image_url) document.getElementById("user-avatar").src = cached.image_url;
  } else if (clerk && clerk.user) {
    const name = clerk.user.fullName || clerk.user.primaryEmailAddress?.emailAddress || "Signed in";
    document.getElementById("user-name").textContent = name;
    if (clerk.user.imageUrl) document.getElementById("user-avatar").src = clerk.user.imageUrl;
  } else {
    document.getElementById("user-name").textContent = "Account";
    document.getElementById("user-avatar").src = "https://ui-avatars.com/api/?name=User&background=cba135&color=fff";
  }
}

function showApp() {
  document.getElementById("auth-gate").style.display = "none";
  document.getElementById("app-shell").style.display = "";
  showCachedUserBadge();
}

function showAuthGate() {
  document.getElementById("auth-gate").style.display = "flex";
  document.getElementById("app-shell").style.display = "none";
}

async function initAuth() {
  showCachedUserBadge(); // instant paint from last session, avoids a flash of "signed out"

  let config;
  try {
    config = await fetch(`${API}/auth/config`).then(r => r.json());
  } catch {
    // Server unreachable — nothing we can do yet; let the user see the sign-in gate.
    showAuthGate();
    return;
  }

  if (!config.authRequired || !config.publishableKey) {
    // Clerk not configured on the server yet — skip the gate so the app stays usable.
    document.getElementById("auth-setup-hint").style.display = "block";
    showApp();
    initApp();
    return;
  }

  const loadClerkScript = () => {
    return new Promise((resolve, reject) => {
      if (window.Clerk) return resolve(window.Clerk);
      let script = document.getElementById("clerk-script");
      if (!script) {
        script = document.createElement("script");
        script.id = "clerk-script";
        script.crossOrigin = "anonymous";
        document.head.appendChild(script);
      }
      script.setAttribute("data-clerk-publishable-key", config.publishableKey);

      const checkClerk = (attempts = 150) => {
        if (window.Clerk) return resolve(window.Clerk);
        if (attempts <= 0) return reject(new Error("Clerk script load timeout"));
        setTimeout(() => checkClerk(attempts - 1), 100);
      };

      if (!script.src) {
        script.onload = () => checkClerk();
        script.onerror = (e) => reject(e);
        script.src = "https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/dist/clerk.browser.js";
      } else {
        checkClerk();
      }
    });
  };

  document.getElementById("clerk-sign-in").innerHTML =
    `<div class="auth-loading">Loading sign-in…</div>`;

  try {
    clerk = await loadClerkScript();
    if (!clerk.loaded) {
      await clerk.load({ publishableKey: config.publishableKey });
    }
  } catch (e) {
    console.error("Clerk load error:", e);
    document.getElementById("clerk-sign-in").innerHTML =
      `<div class="auth-loading" style="color:var(--accent);">Failed to load Clerk authentication widget. Retrying...</div>`;
    setTimeout(() => window.location.reload(), 3000);
    return;
  }

  const onAuthChange = async () => {
    if (clerk.user) {
      // Save/refresh the local login record on the server ("login info save").
      try {
        const res = await apiFetch(`${API}/auth/sync`, { method: "POST" });
        if (res.ok) {
          const saved = await res.json();
          setCachedUser(saved);
          showCachedUserBadge();
        }
      } catch { /* non-fatal — user can still use the app */ }
      showApp();
      initApp();
    } else {
      setCachedUser(null);
      showAuthGate();
      mountSignIn();
    }
  };

  clerk.addListener(onAuthChange);
  await onAuthChange();
}

function mountSignIn() {
  if (!clerk) return;
  const el = document.getElementById("clerk-sign-in");
  el.innerHTML = "";
  clerk.mountSignIn(el);
}

document.getElementById("sign-out-btn").addEventListener("click", async () => {
  if (clerk) await clerk.signOut();
  setCachedUser(null);
});

// ---------------------------------------------------------------- Tabs
document.querySelectorAll("nav.tabs button").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("nav.tabs button").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "dashboard") loadDashboard();
    if (btn.dataset.tab === "timeline") loadTimeline();
    if (btn.dataset.tab === "graph") loadGraph();
    if (btn.dataset.tab === "career") loadCareerProfile();
  });
});

async function refreshTotal() {
  const docs = await apiFetch(`${API}/documents`).then(r => r.json());
  document.getElementById("doc-total").textContent = docs.length;
}

// ---------------------------------------------------------------- Module 1: Ingestion
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
dropzone.addEventListener("click", () => fileInput.click());
["dragover", "dragleave", "drop"].forEach(evt => {
  dropzone.addEventListener(evt, e => {
    e.preventDefault();
    dropzone.classList.toggle("drag", evt === "dragover");
  });
});
dropzone.addEventListener("drop", e => handleFiles(e.dataTransfer.files));
fileInput.addEventListener("change", e => handleFiles(e.target.files));

async function handleFiles(fileList) {
  const log = document.getElementById("upload-log");
  const dateVal = document.getElementById("upload-date").value;
  for (const file of fileList) {
    const line = document.createElement("div");
    line.textContent = `Ingesting ${file.name}…`;
    log.prepend(line);
    const form = new FormData();
    form.append("file", file);
    form.append("doc_date", dateVal);
    try {
      const res = await apiFetch(`${API}/upload`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        line.innerHTML = `<span style="color:var(--accent);">&#10007;</span> Failed: ${escapeHtml(file.name)} (${escapeHtml(data.detail || res.statusText)})`;
        continue;
      }
      line.innerHTML = `<span class="ok">&#10003;</span> ${escapeHtml(file.name)} &rarr; classified as <b>${escapeHtml(data.category)}</b>${data.skills.length ? " · " + escapeHtml(data.skills.join(", ")) : ""}`;
    } catch (err) {
      line.innerHTML = `<span style="color:var(--accent);">&#10007;</span> Failed: ${escapeHtml(file.name)} (${escapeHtml(err.message)})`;
    }
  }
  refreshTotal();
  if (typeof loadDashboard === "function") loadDashboard();
}

document.getElementById("link-submit").addEventListener("click", async () => {
  const url = document.getElementById("link-url").value.trim();
  if (!url) return;
  const form = new FormData();
  form.append("url", url);
  form.append("label", document.getElementById("link-label").value);
  form.append("doc_date", document.getElementById("link-date").value);
  const res = await apiFetch(`${API}/upload-link`, { method: "POST", body: form });
  const data = await res.json();
  const log = document.getElementById("upload-log");
  const line = document.createElement("div");
  line.innerHTML = `<span class="ok">&#10003;</span> Linked ${data.title} &rarr; classified as <b>${data.category}</b>`;
  log.prepend(line);
  document.getElementById("link-url").value = "";
  document.getElementById("link-label").value = "";
  refreshTotal();
});

// ---------------------------------------------------------------- Module 2: Dashboard
let activeCategory = null;
async function loadDashboard() {
  const counts = await apiFetch(`${API}/categories`).then(r => r.json());
  const strip = document.getElementById("category-strip");
  strip.innerHTML = "";
  const allChip = makeChip("All", null, Object.values(counts).reduce((a, b) => a + b, 0));
  strip.appendChild(allChip);
  for (const [cat, n] of Object.entries(counts)) {
    strip.appendChild(makeChip(cat, cat, n));
  }
  renderDocs(activeCategory);
}

function makeChip(label, value, count) {
  const chip = document.createElement("button");
  chip.className = "category-chip" + (activeCategory === value ? " active" : "");
  chip.textContent = `${label} (${count})`;
  chip.addEventListener("click", () => { activeCategory = value; loadDashboard(); });
  return chip;
}

async function renderDocs(category) {
  const url = category ? `${API}/documents?category=${encodeURIComponent(category)}` : `${API}/documents`;
  const docs = await apiFetch(url).then(r => r.json());
  const grid = document.getElementById("doc-grid");
  grid.innerHTML = "";
  if (!docs.length) {
    grid.innerHTML = `<div class="empty-state">Nothing here yet — upload something in Ingest.</div>`;
    return;
  }
  for (const d of docs) {
    const card = document.createElement("div");
    card.className = "doc-card";
    card.innerHTML = `
      <div class="doc-card-top">
        <div class="doc-cat">${d.category}${d.doc_date ? " · " + d.doc_date : ""}</div>
        <button class="remove-btn" title="Remove this document" data-id="${d.id}">Remove</button>
      </div>
      <h4>${escapeHtml(d.title || d.original_filename)}</h4>
      <p>${escapeHtml((d.summary || "").replace(/^\[[^\]]*\]\s*/, ""))}</p>
      <div class="skills">${d.skills.map(s => `<span class="skill-tag">${escapeHtml(s)}</span>`).join("")}</div>
      ${d.has_file ? `<a class="file-link" href="${API}/documents/${d.id}/file" target="_blank">View original file &rarr;</a>` : (d.source_url ? `<a class="file-link" href="${d.source_url}" target="_blank">Open link &rarr;</a>` : "")}
    `;
    card.querySelector(".remove-btn").addEventListener("click", () => removeDocument(d.id, card));
    grid.appendChild(card);
  }
}

async function removeDocument(id, cardEl) {
  if (!confirm("Remove this document? This deletes the stored file too and can't be undone.")) return;
  try {
    const res = await apiFetch(`${API}/documents/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.detail || "Couldn't remove the document.");
      return;
    }
    cardEl.remove();
    refreshTotal();
    loadDashboard();
  } catch (e) {
    alert("Couldn't reach the server to remove the document.");
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

// ---------------------------------------------------------------- Module 4: Timeline
async function loadTimeline() {
  const data = await apiFetch(`${API}/timeline`).then(r => r.json());
  const el = document.getElementById("timeline");
  el.innerHTML = "";
  if (!data.length) {
    el.innerHTML = `<div class="empty-state">No dated documents yet. Add a date on upload to place items on the timeline.</div>`;
    return;
  }
  for (const yearBlock of data) {
    const block = document.createElement("div");
    block.className = "timeline-year";
    block.innerHTML = `<div class="year-label">${yearBlock.year}</div>
      <div class="timeline-events">${yearBlock.events.map(e =>
        `<div class="timeline-event"><span class="tcat">${e.category}</span>${escapeHtml(e.label)}</div>`
      ).join("")}</div>`;
    el.appendChild(block);
  }
}

// ---------------------------------------------------------------- Module 3: Graph (simple force layout on canvas)
async function loadGraph() {
  const data = await apiFetch(`${API}/graph`).then(r => r.json());
  const canvas = document.getElementById("graph-canvas");
  const parent = canvas.parentElement;
  canvas.width = parent.clientWidth;
  canvas.height = 560;
  const ctx = canvas.getContext("2d");

  if (!data.nodes.length) {
    ctx.fillStyle = "#7d8792";
    ctx.font = "13px monospace";
    ctx.fillText("Upload a few documents to see how they connect.", 20, 30);
    return;
  }

  const nodes = data.nodes.map(n => ({
    ...n,
    x: canvas.width / 2 + (Math.random() - 0.5) * 300,
    y: canvas.height / 2 + (Math.random() - 0.5) * 300,
    vx: 0, vy: 0,
  }));
  const idx = Object.fromEntries(nodes.map((n, i) => [n.id, i]));
  const edges = data.edges.filter(e => idx[e.from] !== undefined && idx[e.to] !== undefined);

  function simulate() {
    // repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let dist2 = dx * dx + dy * dy || 0.01;
        const force = 2200 / dist2;
        const d = Math.sqrt(dist2);
        dx /= d; dy /= d;
        a.vx += dx * force; a.vy += dy * force;
        b.vx -= dx * force; b.vy -= dy * force;
      }
    }
    // attraction along edges
    for (const e of edges) {
      const a = nodes[idx[e.from]], b = nodes[idx[e.to]];
      const dx = b.x - a.x, dy = b.y - a.y;
      a.vx += dx * 0.02; a.vy += dy * 0.02;
      b.vx -= dx * 0.02; b.vy -= dy * 0.02;
    }
    // center pull + integrate
    for (const n of nodes) {
      n.vx += (canvas.width / 2 - n.x) * 0.002;
      n.vy += (canvas.height / 2 - n.y) * 0.002;
      n.vx *= 0.8; n.vy *= 0.8;
      n.x += n.vx; n.y += n.vy;
      n.x = Math.max(24, Math.min(canvas.width - 24, n.x));
      n.y = Math.max(24, Math.min(canvas.height - 24, n.y));
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "rgba(216,208,189,0.25)";
    ctx.lineWidth = 1;
    for (const e of edges) {
      const a = nodes[idx[e.from]], b = nodes[idx[e.to]];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    for (const n of nodes) {
      ctx.beginPath();
      ctx.fillStyle = n.type === "skill" ? "#5b8cff" : "#d9a441";
      const r = n.type === "skill" ? 6 : 8;
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "11px 'IBM Plex Mono', monospace";
      ctx.fillStyle = "#e9e5d8";
      ctx.fillText(n.label.length > 22 ? n.label.slice(0, 20) + "…" : n.label, n.x + r + 4, n.y + 3);
    }
  }

  let ticks = 0;
  const iv = setInterval(() => {
    simulate();
    draw();
    ticks++;
    if (ticks > 220) clearInterval(iv);
  }, 20);
}

// ---------------------------------------------------------------- Module 5: Search
async function runSearch() {
  const q = document.getElementById("search-input").value.trim();
  const box = document.getElementById("search-results");
  if (!q) { box.innerHTML = ""; return; }
  const results = await apiFetch(`${API}/search?q=${encodeURIComponent(q)}`).then(r => r.json());
  if (!results.length) {
    box.innerHTML = `<div class="empty-state">No matches. Try a broader term ("certificate", "python", "internship")…</div>`;
    return;
  }
  box.innerHTML = results.map(r => `
    <div class="result-item">
      <span class="rel">match ${(r.relevance * 100).toFixed(0)}%</span>
      <div class="doc-cat" style="font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:#b8863f;text-transform:uppercase;">${r.category}${r.doc_date ? " · " + r.doc_date : ""}</div>
      <h4 style="font-family:'Source Serif 4',serif;margin:6px 0 6px;">${escapeHtml(r.title)}</h4>
      <p style="font-size:12.5px;color:#b7bec6;margin:0 0 8px;">${escapeHtml((r.summary || "").replace(/^\[[^\]]*\]\s*/, ""))}</p>
      ${r.has_file ? `<a class="file-link" href="${API}/documents/${r.id}/file" target="_blank">View original file &rarr;</a>` : (r.source_url ? `<a class="file-link" href="${r.source_url}" target="_blank">Open link &rarr;</a>` : "")}
    </div>
  `).join("");
}
document.getElementById("search-btn").addEventListener("click", runSearch);
document.getElementById("search-input").addEventListener("keydown", e => { if (e.key === "Enter") runSearch(); });

// ---------------------------------------------------------------- Career Intelligence Engine
async function loadCareerProfile() {
  try {
    const res = await apiFetch(`${API}/career/profile`);
    if (res.status === 404) { showCareerEmpty(); return; }
    const report = await res.json();
    renderCareerReport(report);
  } catch (e) {
    showCareerEmpty();
  }
}

function showCareerEmpty() {
  document.getElementById("career-empty").style.display = "block";
  document.getElementById("career-content").style.display = "none";
}

document.getElementById("career-run-btn").addEventListener("click", async () => {
  const btn = document.getElementById("career-run-btn");
  const empty = document.getElementById("career-empty");
  btn.textContent = "Analyzing…";
  btn.disabled = true;
  empty.style.display = "block";
  empty.textContent = "Reading your archive and generating a fresh career report…";
  try {
    const res = await apiFetch(`${API}/career/analyze`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      empty.textContent = `Couldn't run the analysis: ${data.detail || "unknown error"}`;
    } else {
      renderCareerReport(data);
    }
  } catch (e) {
    empty.textContent = "Couldn't reach the server to run the analysis.";
  }
  btn.textContent = "Run career analysis";
  btn.disabled = false;
});

function renderCareerReport(report) {
  document.getElementById("career-empty").style.display = "none";
  document.getElementById("career-content").style.display = "block";

  if (report._meta) {
    const meta = report._meta;
    const stale = meta.current_document_count !== meta.document_count_at_analysis;
    document.getElementById("career-meta").textContent =
      `Generated ${new Date(meta.generated_at).toLocaleString()} · based on ${meta.document_count_at_analysis} documents` +
      (stale ? " · new documents added since — re-run for a fresh read" : "");
  }

  document.getElementById("score-readiness").textContent = report.career_readiness_score ?? "--";
  document.getElementById("score-resume").textContent = report.resume_analysis?.ats_score ?? "--";
  document.getElementById("score-portfolio").textContent = report.portfolio_analysis?.score ?? "--";

  // Career matches
  const matchesEl = document.getElementById("career-matches");
  matchesEl.innerHTML = (report.career_matches || []).map(m => `
    <div class="match-card">
      <div class="match-head">
        <h4>${escapeHtml(m.role)}<span class="match-confidence">${escapeHtml(m.confidence || "")} confidence</span></h4>
        <div class="match-score">${m.match_score}%</div>
      </div>
      <div class="match-why">${escapeHtml(m.why_it_fits || "")}</div>
      <div class="match-row"><b>Strengths</b>${(m.strengths || []).map(escapeHtml).join(", ")}</div>
      <div class="match-row"><b>Missing</b>${(m.missing_skills || []).map(escapeHtml).join(", ") || "—"}</div>
      ${(m.roadmap || []).length ? `<div class="match-row"><b>Roadmap</b></div><ul class="roadmap-list">${
        m.roadmap.map(r => `<li>${escapeHtml(r.step)} <i>(${escapeHtml(r.estimated_time || "")}, ${escapeHtml(r.difficulty || "")})</i></li>`).join("")
      }</ul>` : ""}
      <div class="match-meta-strip">
        <span>Salary: ${escapeHtml(m.salary_range_estimate || "n/a")}</span>
        <span>Demand: ${escapeHtml(m.market_demand || "n/a")}</span>
        <span>Outlook: ${escapeHtml(m.growth_outlook || "n/a")}</span>
      </div>
    </div>
  `).join("") || `<div class="empty-state">No matches generated.</div>`;

  // Skill gap
  const gap = report.skill_gap || {};
  document.getElementById("skill-gap").innerHTML = `
    <div class="gap-cols">
      <div class="gap-col">
        <h5>Current skills</h5>
        ${(gap.current_skills || []).map(s => `<span class="skill-tag">${escapeHtml(s)}</span>`).join(" ") || "—"}
      </div>
      <div class="gap-col missing">
        <h5>Missing skills</h5>
        ${(gap.missing_skills || []).map(s => `<span class="skill-tag">${escapeHtml(s)}</span>`).join(" ") || "—"}
      </div>
    </div>
    ${(gap.prioritized_learning_path || []).length ? `<h5 style="margin-top:16px;font-family:'IBM Plex Mono',monospace;font-size:11px;text-transform:uppercase;color:#9aa3ad;">Prioritized path</h5><ol class="roadmap-list">${
      gap.prioritized_learning_path.map(s => `<li>${escapeHtml(s)}</li>`).join("")
    }</ol>` : ""}
  `;

  // Resume review
  const ra = report.resume_analysis || {};
  document.getElementById("resume-review").innerHTML = `
    <div class="match-meta-strip" style="margin-bottom:10px;">
      <span>Completeness: ${ra.completeness ?? "n/a"}%</span>
      <span>Skill coverage: ${ra.skill_coverage ?? "n/a"}%</span>
      <span>Keyword optimization: ${ra.keyword_optimization ?? "n/a"}%</span>
    </div>
    ${(ra.missing_sections || []).length ? `<div class="match-row"><b>Missing sections</b>${ra.missing_sections.map(escapeHtml).join(", ")}</div>` : ""}
    ${(ra.suggestions || []).length ? `<ul class="roadmap-list">${ra.suggestions.map(s => `<li>${escapeHtml(s)}</li>`).join("")}</ul>` : ""}
  `;

  // Future timeline
  const tlEl = document.getElementById("career-timeline");
  tlEl.innerHTML = (report.future_timeline || []).map(e => `
    <div class="timeline-year">
      <div class="year-label">${escapeHtml(e.year)}</div>
      <div class="timeline-events"><div class="timeline-event">${escapeHtml(e.milestone)}</div></div>
    </div>
  `).join("") || `<div class="empty-state">No future milestones generated.</div>`;

  // Insights
  document.getElementById("career-insights").innerHTML = `
    <ul class="roadmap-list">${(report.insights || []).map(i => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
  ` || `<div class="empty-state">No insights generated.</div>`;
}

// Job match
document.getElementById("job-match-btn").addEventListener("click", async () => {
  const jd = document.getElementById("job-desc-input").value.trim();
  const resultEl = document.getElementById("job-match-result");
  if (!jd) return;
  resultEl.innerHTML = `<div class="empty-state">Comparing against the job description…</div>`;
  const form = new FormData();
  form.append("job_description", jd);
  const res = await apiFetch(`${API}/career/job-match`, { method: "POST", body: form });
  const data = await res.json();
  if (!res.ok) {
    resultEl.innerHTML = `<div class="empty-state">${escapeHtml(data.detail || "Couldn't complete the match.")}</div>`;
    return;
  }
  resultEl.innerHTML = `
    <div class="match-row"><b>Match</b>${data.match_percentage}%</div>
    <div class="match-row"><b>Matching skills</b>${(data.matching_skills || []).map(escapeHtml).join(", ") || "—"}</div>
    <div class="match-row"><b>Missing skills</b>${(data.missing_skills || []).map(escapeHtml).join(", ") || "—"}</div>
    ${(data.strengths_for_this_role || []).length ? `<div class="match-row"><b>Strengths</b>${data.strengths_for_this_role.map(escapeHtml).join(", ")}</div>` : ""}
    ${(data.resume_suggestions || []).length ? `<ul class="roadmap-list">${data.resume_suggestions.map(s => `<li>${escapeHtml(s)}</li>`).join("")}</ul>` : ""}
  `;
});

// Copilot
async function sendCopilotMessage() {
  const input = document.getElementById("copilot-input");
  const q = input.value.trim();
  if (!q) return;
  const log = document.getElementById("copilot-log");
  log.innerHTML += `<div class="copilot-msg user">${escapeHtml(q)}</div>`;
  input.value = "";
  const thinkingId = "thinking-" + Date.now();
  log.innerHTML += `<div class="copilot-msg bot" id="${thinkingId}">…</div>`;
  log.scrollTop = log.scrollHeight;
  const form = new FormData();
  form.append("question", q);
  try {
    const res = await apiFetch(`${API}/career/copilot`, { method: "POST", body: form });
    const data = await res.json();
    document.getElementById(thinkingId).textContent = res.ok ? data.answer : (data.detail || "Something went wrong.");
  } catch (e) {
    document.getElementById(thinkingId).textContent = "Couldn't reach the server.";
  }
  log.scrollTop = log.scrollHeight;
}
document.getElementById("copilot-send").addEventListener("click", sendCopilotMessage);
document.getElementById("copilot-input").addEventListener("keydown", e => { if (e.key === "Enter") sendCopilotMessage(); });

// ---------------------------------------------------------------- init
let appInitialized = false;
function initApp() {
  if (appInitialized) return; // avoid double-loading if auth state flips more than once
  appInitialized = true;
  refreshTotal();
}

initAuth();
