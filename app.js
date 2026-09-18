(function () {
  "use strict";

  var REPO_OWNER = "Bryan-GP";
  var REPO_NAME = "Apply-Buddy";
  var DATA_PATH = "data/jobs.json";
  var TOKEN_KEY = "applyBuddyGhToken";
  var LOCAL_STATUS_KEY = "applyBuddyLocalStatus";
  var THEME_KEY = "applyBuddyTheme";

  var SECTORS = [
    { key: "consulting", label: "Consulting" },
    { key: "strategy", label: "Strategy" },
    { key: "advisory", label: "Advisory" },
    { key: "government-political", label: "Government / Political Advisor" },
    { key: "think-tank", label: "Think Tanks" },
    { key: "civil-service", label: "Civil Service" }
  ];

  var LEVELS = [
    { key: "grad", label: "Graduate" },
    { key: "junior", label: "Junior" },
    { key: "trainee", label: "Trainee" }
  ];

  // label + left-border/pill colour class for each application stage
  var STAGES = [
    { key: "not_applied", label: "Not applied", cls: "muted" },
    { key: "applied", label: "Applied", cls: "info" },
    { key: "interview", label: "Interview", cls: "accent" },
    { key: "offer", label: "Offer", cls: "ok" },
    { key: "rejected", label: "Rejected", cls: "danger" }
  ];

  var state = {
    jobs: [],
    search: "",
    sectors: new Set(),
    levels: new Set(),
    stages: new Set(),
    sort: "closing-asc",
    hideClosed: false
  };

  // ---------- small DOM helper ----------
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === "text") node.textContent = attrs[k];
      else if (k === "html") node.innerHTML = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function esc(s) {
    return (s == null ? "" : String(s)).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function daysUntil(dateStr) {
    if (!dateStr) return null;
    var target = new Date(dateStr + "T23:59:59");
    var now = new Date();
    return Math.ceil((target - now) / 86400000);
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function fmtDateShort(dateStr) {
    var d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }

  function labelFor(list, key) {
    var m = list.filter(function (x) { return x.key === key; })[0];
    return m ? m.label : key;
  }
  function metaFor(key) {
    var m = STAGES.filter(function (s) { return s.key === key; })[0];
    return m || { key: key, label: key || "Unknown", cls: "muted" };
  }

  // ---------- theme toggle (light / dark / auto), remembered per-browser only ----------
  function applyTheme(choice) {
    var root = document.documentElement;
    if (choice === "light") root.setAttribute("data-theme", "light");
    else if (choice === "dark") root.setAttribute("data-theme", "dark");
    else root.removeAttribute("data-theme");
    document.querySelectorAll("#themeToggle button").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-theme-choice") === choice);
    });
  }
  function initTheme() {
    var saved = "auto";
    try { saved = localStorage.getItem(THEME_KEY) || "auto"; } catch (e) { /* ignore */ }
    applyTheme(saved);
    document.querySelectorAll("#themeToggle button").forEach(function (b) {
      b.addEventListener("click", function () {
        var choice = b.getAttribute("data-theme-choice");
        applyTheme(choice);
        try { localStorage.setItem(THEME_KEY, choice); } catch (e) { /* ignore */ }
      });
    });
  }

  // ---------- filter chips with live counts ----------
  function buildChips(container, items, selectedSet, counts) {
    container.innerHTML = "";
    items.forEach(function (item) {
      var n = counts ? (counts[item.key] || 0) : null;
      var chip = el("button", { type: "button", class: "chip", "data-key": item.key });
      chip.appendChild(document.createTextNode(item.label));
      if (n !== null) {
        chip.appendChild(el("span", { class: "count mono", text: " " + n }));
      }
      chip.addEventListener("click", function () {
        if (selectedSet.has(item.key)) selectedSet.delete(item.key);
        else selectedSet.add(item.key);
        chip.classList.toggle("active");
        render();
      });
      container.appendChild(chip);
    });
  }

  // ---------- base64 <-> UTF-8 helpers (for GitHub Contents API) ----------
  function b64EncodeUnicode(str) {
    return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function (_, p1) {
      return String.fromCharCode(parseInt(p1, 16));
    }));
  }
  function b64DecodeUnicode(str) {
    return decodeURIComponent(atob(str).split("").map(function (c) {
      return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(""));
  }

  // ---------- GitHub token storage ----------
  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }
  function setToken(v) {
    try { localStorage.setItem(TOKEN_KEY, v); } catch (e) { /* ignore */ }
  }
  function clearToken() {
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
  }

  // ---------- per-viewer local tracking (no token needed, private to this browser) ----------
  // Anyone opening this site — including someone with no GitHub token at all — gets their own
  // private application-status overlay stored only in their own browser. It never touches the
  // shared data file unless a sync token is also set, so a friend using this link can track her
  // own progress without ever writing to, or interfering with, the owner's synced board.
  function getLocalOverlay() {
    try { return JSON.parse(localStorage.getItem(LOCAL_STATUS_KEY) || "{}"); } catch (e) { return {}; }
  }
  function setLocalOverlayEntry(jobId, stage) {
    var overlay = getLocalOverlay();
    overlay[jobId] = { stage: stage, updatedAt: new Date().toISOString() };
    try { localStorage.setItem(LOCAL_STATUS_KEY, JSON.stringify(overlay)); } catch (e) { /* ignore */ }
  }
  function clearLocalOverlayEntry(jobId) {
    var overlay = getLocalOverlay();
    delete overlay[jobId];
    try { localStorage.setItem(LOCAL_STATUS_KEY, JSON.stringify(overlay)); } catch (e) { /* ignore */ }
  }
  function clearAllLocalOverlay() {
    try { localStorage.removeItem(LOCAL_STATUS_KEY); } catch (e) { /* ignore */ }
  }
  function pruneLocalOverlay(validIds) {
    var overlay = getLocalOverlay();
    var validSet = new Set(validIds);
    var changed = false;
    Object.keys(overlay).forEach(function (id) {
      if (!validSet.has(id)) { delete overlay[id]; changed = true; }
    });
    if (changed) {
      try { localStorage.setItem(LOCAL_STATUS_KEY, JSON.stringify(overlay)); } catch (e) { /* ignore */ }
    }
  }

  // ---------- search ----------
  function fuzzyMatch(job, qLower) {
    var hay = [job.refId, job.id, job.title, job.company, job.location, job.sector, job.level, job.source, job.notes]
      .filter(Boolean).join(" ").toLowerCase();
    return hay.indexOf(qLower) !== -1;
  }

  // ---------- filtering / sorting ----------
  function matchesFilters(job) {
    if (state.sectors.size && !state.sectors.has(job.sector)) return false;
    if (state.levels.size && !state.levels.has(job.level)) return false;
    if (state.stages.size && !state.stages.has(job.stage || "not_applied")) return false;
    if (state.search) {
      if (!fuzzyMatch(job, state.search.toLowerCase())) return false;
    }
    if (state.hideClosed) {
      var d = daysUntil(job.closing_date);
      var effectiveStage = job.stage || "not_applied";
      // never let the "hide closed" checkbox hide a job you're actively tracking — a
      // closed listing you already applied to is still worth seeing through to an outcome
      if (d !== null && d < 1 && effectiveStage === "not_applied") return false;
    }
    return true;
  }

  function sortJobs(jobs) {
    var copy = jobs.slice();
    if (state.sort === "closing-asc") {
      copy.sort(function (a, b) {
        var da = a.closing_date ? new Date(a.closing_date) : new Date("2999-12-31");
        var db = b.closing_date ? new Date(b.closing_date) : new Date("2999-12-31");
        return da - db;
      });
    } else if (state.sort === "found-desc") {
      copy.sort(function (a, b) { return new Date(b.date_found || 0) - new Date(a.date_found || 0); });
    } else if (state.sort === "company-asc") {
      copy.sort(function (a, b) { return (a.company || "").localeCompare(b.company || ""); });
    }
    return copy;
  }

  // ---------- persisting a stage change back to GitHub (owner-only, requires a sync token) ----------
  function saveStageToGitHub(job, newStage, statusEl, onSynced) {
    var token = getToken();
    if (!token) return; // caller already checked; local-only save has already happened

    statusEl.textContent = "Saving to shared board…";
    statusEl.className = "tracker-status";

    var apiUrl = "https://api.github.com/repos/" + REPO_OWNER + "/" + REPO_NAME + "/contents/" + DATA_PATH;
    var headers = {
      "Authorization": "Bearer " + token,
      "Accept": "application/vnd.github+json"
    };

    fetch(apiUrl, { headers: headers })
      .then(function (r) {
        if (!r.ok) throw { step: "read", status: r.status };
        return r.json();
      })
      .then(function (fileData) {
        var text = b64DecodeUnicode(fileData.content);
        var json = JSON.parse(text);
        var target = (json.jobs || []).filter(function (j) { return j.id === job.id; })[0];
        if (!target) throw { step: "find" };
        target.stage = newStage;
        target.applied = newStage !== "not_applied";

        var updatedText = JSON.stringify(json, null, 2) + "\n";
        var body = {
          message: "Update application status: " + job.company + " – " + job.title + " -> " + newStage,
          content: b64EncodeUnicode(updatedText),
          sha: fileData.sha,
          branch: "main"
        };

        return fetch(apiUrl, {
          method: "PUT",
          headers: Object.assign({ "Content-Type": "application/json" }, headers),
          body: JSON.stringify(body)
        }).then(function (r) {
          if (!r.ok) throw { step: "write", status: r.status };
          return r.json();
        });
      })
      .then(function () {
        statusEl.textContent = "Saved to shared board ✓";
        statusEl.className = "tracker-status ok";
        if (onSynced) onSynced();
        setTimeout(function () { statusEl.textContent = ""; }, 2500);
      })
      .catch(function (err) {
        var msg = "Saved on this device only — couldn't sync to the shared board.";
        if (err && err.status === 401) msg = "Saved on this device only — sync token rejected, check Sync settings.";
        else if (err && err.status === 403) msg = "Saved on this device only — sync token lacks write access.";
        else if (err && err.status === 409) msg = "Saved on this device only — someone else updated the file, reopen and retry.";
        else if (err && err.status === 404) msg = "Saved on this device only — couldn't find the data file on GitHub.";
        statusEl.textContent = msg;
        statusEl.className = "tracker-status error";
      });
  }

  // ---------- deadline pill (soonest-closing gets the loudest treatment) ----------
  function deadlineBadge(job) {
    var closing = job.closing_date;
    if (!closing) {
      return '<span class="pill pill-deadline warn-txt">deadline unknown — check posting</span>';
    }
    var days = daysUntil(closing);
    var pretty = fmtDateShort(closing);
    var cls = "";
    var label = "closes " + pretty;
    if (days === null) { cls = ""; }
    else if (days < 0) { cls = "danger-txt"; label = "closed " + pretty; }
    else if (days === 0) { cls = "danger-txt"; label = "closes today"; }
    else if (days <= 3) { cls = "danger-txt"; label = "closes " + pretty + " — " + days + "d left"; }
    else if (days <= 14) { cls = "warn-txt"; label = "closes " + pretty + " — " + days + "d left"; }
    return '<span class="pill pill-deadline ' + cls + '">' + esc(label) + "</span>";
  }

  // ---------- rendering ----------
  function renderJobCard(job) {
    var meta = metaFor(job.stage || "not_applied");
    var sectorKey = job.sector || "consulting";

    var refBadge = job.refId ? '<span class="refid">' + esc(job.refId) + "</span>" : "";
    var titleHtml =
      '<span class="job-title"><a href="' + esc(job.url) + '" target="_blank" rel="noopener">' + esc(job.title) + "</a></span>" +
      ' <span class="job-company">— ' + esc(job.company) + "</span>";

    var metaHtml =
      '<span class="cat ' + esc(sectorKey) + '"><span class="dot"></span>' + esc(labelFor(SECTORS, job.sector)) + "</span>" +
      '<span class="pill pill-loc">' + esc(labelFor(LEVELS, job.level)) + "</span>" +
      "<span>📍 " + esc(job.location || "UK") + "</span>" +
      "<span>·</span>" +
      "<span>via " + esc(job.source || "—") + "</span>" +
      "<span>·</span>" +
      '<span class="mono">found ' + (job.date_found ? fmtDateShort(job.date_found) : "—") + "</span>" +
      deadlineBadge(job);

    var headHtml =
      '<div class="job-top">' +
      '<div class="job-title-line">' +
      refBadge + titleHtml +
      '<div class="job-meta">' + metaHtml + "</div>" +
      "</div>" +
      '<span class="status-pill status-' + meta.cls + '">' + esc(meta.label) + "</span>" +
      "</div>";

    var notesHtml = job.notes ? '<div class="job-notes">' + esc(job.notes) + "</div>" : "";

    var card = el("article", { class: "job-card s-" + meta.cls, html: headHtml + notesHtml });

    // application tracker row (job-foot)
    var currentStage = job.stage || "not_applied";
    var select = el("select", { class: "stage-select stage-" + currentStage, "aria-label": "Application status for " + job.title });
    STAGES.forEach(function (s) {
      var opt = el("option", { value: s.key, text: s.label });
      if (s.key === currentStage) opt.setAttribute("selected", "selected");
      select.appendChild(opt);
    });

    var statusEl = el("span", { class: "tracker-status" });

    select.addEventListener("change", function () {
      var newStage = select.value;
      STAGES.forEach(function (s) { select.classList.remove("stage-" + s.key); });
      select.classList.add("stage-" + newStage);
      job.stage = newStage;
      job.applied = newStage !== "not_applied";

      // if this job no longer matches the active stage filter, a full re-render will
      // drop it from view — do that instead of the lighter in-place update below
      if (state.stages.size && !matchesFilters(job)) {
        setLocalOverlayEntry(job.id, newStage);
        if (getToken()) {
          saveStageToGitHub(job, newStage, statusEl, function onSynced() { clearLocalOverlayEntry(job.id); });
        }
        render();
        return;
      }

      // in-place visual update: status pill + card border colour, without rebuilding
      // the whole list (so the transient save-status message below isn't wiped out)
      var newMeta = metaFor(newStage);
      var pillEl = card.querySelector(".status-pill");
      if (pillEl) { pillEl.textContent = newMeta.label; pillEl.className = "status-pill status-" + newMeta.cls; }
      STAGES.forEach(function (s) { card.classList.remove("s-" + s.cls); });
      card.classList.add("s-" + newMeta.cls);
      renderStats();

      // Always save privately to this browser first — works with no token, no account, nothing.
      setLocalOverlayEntry(job.id, newStage);

      if (getToken()) {
        saveStageToGitHub(job, newStage, statusEl, function onSynced() {
          // Canonical copy now matches on GitHub; drop the local override so future visits
          // reflect the shared file directly rather than a possibly-stale local copy.
          clearLocalOverlayEntry(job.id);
        });
      } else {
        statusEl.textContent = "Saved on this device (private to you).";
        statusEl.className = "tracker-status ok";
        setTimeout(function () { statusEl.textContent = ""; }, 3000);
      }
    });

    var foot = el("div", { class: "job-foot" }, [
      el("a", { class: "btn-link", href: job.url, target: "_blank", rel: "noopener", text: "View posting ↗" }),
      el("div", { class: "job-actions" }, [select, statusEl])
    ]);
    card.appendChild(foot);

    return card;
  }

  function renderStats() {
    var statsEl = document.getElementById("stats");
    if (!statsEl) return;
    var today = todayStr();
    var jobs = state.jobs;
    var foundToday = jobs.filter(function (j) { return j.date_found === today; }).length;
    var notApplied = jobs.filter(function (j) { return (j.stage || "not_applied") === "not_applied"; }).length;
    var inProgress = jobs.filter(function (j) { return j.stage === "applied" || j.stage === "interview"; }).length;
    var offers = jobs.filter(function (j) { return j.stage === "offer"; }).length;
    var closingSoon = jobs.filter(function (j) {
      var d = daysUntil(j.closing_date);
      return d !== null && d >= 0 && d <= 7 && (j.stage || "not_applied") !== "rejected";
    }).length;
    var total = jobs.length;

    var tiles = [
      { n: foundToday, l: "Found today", cls: "" },
      { n: notApplied, l: "Not applied yet", cls: "" },
      { n: inProgress, l: "In progress", cls: "accent" },
      { n: offers, l: "Offers", cls: "ok" },
      { n: closingSoon, l: "Closing ≤ 7 days", cls: "warn" },
      { n: total, l: "Total tracked", cls: "" }
    ];
    statsEl.innerHTML = tiles.map(function (t) {
      return '<div class="stat ' + t.cls + '"><div class="n mono">' + t.n + '</div><div class="l">' + esc(t.l) + "</div></div>";
    }).join("");
  }

  function render() {
    var results = document.getElementById("results");
    var emptyState = document.getElementById("empty-state");
    var countEl = document.getElementById("job-count");

    var filtered = sortJobs(state.jobs.filter(matchesFilters));

    results.innerHTML = "";
    filtered.forEach(function (job) { results.appendChild(renderJobCard(job)); });

    emptyState.hidden = filtered.length !== 0;
    if (countEl) countEl.textContent = filtered.length + (filtered.length === 1 ? " job shown" : " jobs shown");
    renderStats();
  }

  // ---------- settings panel ----------
  function initSettings() {
    var panel = document.getElementById("settings-panel");
    var toggleBtn = document.getElementById("toggle-settings");
    var input = document.getElementById("gh-token-input");
    var saveBtn = document.getElementById("gh-token-save");
    var clearBtn = document.getElementById("gh-token-clear");
    var status = document.getElementById("gh-token-status");
    var clearTrackingBtn = document.getElementById("clear-my-tracking");

    var existing = getToken();
    if (existing) {
      status.textContent = "Sync token saved in this browser — your status changes update the shared board.";
      status.className = "settings-status ok";
    }

    toggleBtn.addEventListener("click", function () {
      panel.hidden = !panel.hidden;
    });

    saveBtn.addEventListener("click", function () {
      var v = input.value.trim();
      if (!v) return;
      setToken(v);
      input.value = "";
      status.textContent = "Sync token saved in this browser — your status changes update the shared board.";
      status.className = "settings-status ok";
    });

    clearBtn.addEventListener("click", function () {
      clearToken();
      status.textContent = "Sync token cleared. Your status changes now stay private to this device.";
      status.className = "settings-status";
    });

    if (clearTrackingBtn) {
      clearTrackingBtn.addEventListener("click", function () {
        if (!confirm("Clear your personal application tracking on this device? This can't be undone.")) return;
        clearAllLocalOverlay();
        status.textContent = "Your local tracking was cleared.";
        status.className = "settings-status";
        location.reload();
      });
    }
  }

  // ---------- boot ----------
  function init(data) {
    state.jobs = data.jobs || [];

    // stable, short display reference for each job (purely cosmetic — data schema is untouched)
    state.jobs.forEach(function (job, i) {
      job.refId = "A" + String(i + 1).padStart(3, "0");
    });

    // layer this viewer's private, local-only status overrides on top of the shared data
    var overlay = getLocalOverlay();
    state.jobs.forEach(function (job) {
      var override = overlay[job.id];
      if (override) {
        job.stage = override.stage;
        job.applied = override.stage !== "not_applied";
      }
    });
    pruneLocalOverlay(state.jobs.map(function (j) { return j.id; }));

    var lastUpdated = document.getElementById("last-updated");
    if (data.last_updated) {
      var d = new Date(data.last_updated);
      lastUpdated.textContent = "Updated " + d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " " +
        d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      lastUpdated.title = data.run_notes || "";
    } else {
      lastUpdated.textContent = "Not yet updated";
    }

    // per-category counts for the filter chips
    var levelCounts = {}, sectorCounts = {}, stageCounts = {};
    state.jobs.forEach(function (j) {
      levelCounts[j.level] = (levelCounts[j.level] || 0) + 1;
      sectorCounts[j.sector] = (sectorCounts[j.sector] || 0) + 1;
      var st = j.stage || "not_applied";
      stageCounts[st] = (stageCounts[st] || 0) + 1;
    });

    buildChips(document.getElementById("level-filters"), LEVELS, state.levels, levelCounts);
    buildChips(document.getElementById("sector-filters"), SECTORS, state.sectors, sectorCounts);
    buildChips(document.getElementById("stage-filters"), STAGES, state.stages, stageCounts);

    document.getElementById("search").addEventListener("input", function (e) {
      state.search = e.target.value;
      render();
    });
    document.getElementById("sort").addEventListener("change", function (e) {
      state.sort = e.target.value;
      render();
    });
    document.getElementById("hide-closed").addEventListener("change", function (e) {
      state.hideClosed = e.target.checked;
      render();
    });
    document.getElementById("clear-filters").addEventListener("click", function () {
      state.search = "";
      state.sectors.clear();
      state.levels.clear();
      state.stages.clear();
      state.hideClosed = false;
      document.getElementById("search").value = "";
      document.getElementById("hide-closed").checked = false;
      document.querySelectorAll(".chip.active").forEach(function (c) { c.classList.remove("active"); });
      render();
    });

    initSettings();
    render();
  }

  initTheme();

  fetch("data/jobs.json?_=" + Date.now())
    .then(function (r) { return r.json(); })
    .then(init)
    .catch(function (err) {
      document.getElementById("results").innerHTML =
        "<p style='color:#c23a34'>Couldn't load job data (" + err.message + "). Try refreshing.</p>";
      document.getElementById("last-updated").textContent = "Error loading data";
    });
})();
