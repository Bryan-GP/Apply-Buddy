(function () {
  "use strict";

  var REPO_OWNER = "Bryan-GP";
  var REPO_NAME = "Apply-Buddy";
  var DATA_PATH = "data/jobs.json";
  var TOKEN_KEY = "applyBuddyGhToken";
  var LOCAL_STATUS_KEY = "applyBuddyLocalStatus";

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

  var STAGES = [
    { key: "not_applied", label: "Not applied" },
    { key: "applied", label: "Applied" },
    { key: "interview", label: "Interview" },
    { key: "offer", label: "Offer" },
    { key: "rejected", label: "Rejected" }
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

  function daysUntil(dateStr) {
    if (!dateStr) return null;
    var target = new Date(dateStr + "T23:59:59");
    var now = new Date();
    return Math.ceil((target - now) / 86400000);
  }

  function fmtDate(dateStr) {
    if (!dateStr) return "Rolling / no deadline listed";
    var d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }

  function labelFor(list, key) {
    var m = list.filter(function (x) { return x.key === key; })[0];
    return m ? m.label : key;
  }

  function buildChips(container, items, selectedSet) {
    container.innerHTML = "";
    items.forEach(function (item) {
      var chip = el("button", { type: "button", class: "chip", "data-key": item.key, text: item.label });
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

  // ---------- filtering / sorting ----------
  function matchesFilters(job) {
    if (state.sectors.size && !state.sectors.has(job.sector)) return false;
    if (state.levels.size && !state.levels.has(job.level)) return false;
    if (state.stages.size && !state.stages.has(job.stage || "not_applied")) return false;
    if (state.search) {
      var haystack = (job.title + " " + job.company + " " + job.location).toLowerCase();
      if (haystack.indexOf(state.search.toLowerCase()) === -1) return false;
    }
    if (state.hideClosed) {
      var d = daysUntil(job.closing_date);
      if (d !== null && d < 1) return false;
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

  // ---------- rendering ----------
  function renderJobCard(job) {
    var days = daysUntil(job.closing_date);
    var badges = [
      el("span", { class: "badge badge-level", text: labelFor(LEVELS, job.level) }),
      el("span", { class: "badge badge-sector", text: labelFor(SECTORS, job.sector) })
    ];
    if (days !== null && days < 0) {
      badges.push(el("span", { class: "badge badge-closed", text: "Likely closed" }));
    } else if (days !== null && days <= 3) {
      badges.push(el("span", { class: "badge badge-closing-soon", text: days <= 0 ? "Closes today" : "Closes in " + days + "d" }));
    }

    var link = el("a", { href: job.url, target: "_blank", rel: "noopener", text: job.title });
    var titleLine = el("div", { class: "job-title-line" }, [
      el("h3", { class: "job-title" }, [link]),
      el("div", { class: "job-company", text: job.company })
    ]);

    var top = el("div", { class: "job-top" }, [titleLine, el("div", { class: "job-badges" }, badges)]);

    var meta = el("div", { class: "job-meta" }, [
      el("span", { text: "📍 " + job.location }),
      el("span", { text: "🗓 " + fmtDate(job.closing_date) }),
      el("span", { text: "via " + job.source })
    ]);

    var card = el("article", { class: "job-card" }, [top, meta]);
    if (job.notes) {
      card.appendChild(el("div", { class: "job-notes", text: job.notes }));
    }

    // application tracker row
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

      // if this job no longer matches the active stage filter, re-render the list
      if (state.stages.size && !matchesFilters(job)) render();
    });

    var tracker = el("div", { class: "job-tracker" }, [select, statusEl]);
    card.appendChild(tracker);

    return card;
  }

  function render() {
    var results = document.getElementById("results");
    var emptyState = document.getElementById("empty-state");
    var countPill = document.getElementById("job-count");

    var filtered = sortJobs(state.jobs.filter(matchesFilters));

    results.innerHTML = "";
    filtered.forEach(function (job) { results.appendChild(renderJobCard(job)); });

    emptyState.hidden = filtered.length !== 0;
    countPill.textContent = filtered.length + (filtered.length === 1 ? " job" : " jobs");
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

    buildChips(document.getElementById("level-filters"), LEVELS, state.levels);
    buildChips(document.getElementById("sector-filters"), SECTORS, state.sectors);
    buildChips(document.getElementById("stage-filters"), STAGES, state.stages);

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

  fetch("data/jobs.json?_=" + Date.now())
    .then(function (r) { return r.json(); })
    .then(init)
    .catch(function (err) {
      document.getElementById("results").innerHTML =
        "<p style='color:#c0293c'>Couldn't load job data (" + err.message + "). Try refreshing.</p>";
      document.getElementById("last-updated").textContent = "Error loading data";
    });
})();
