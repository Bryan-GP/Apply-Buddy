(function () {
  "use strict";

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

  var state = {
    jobs: [],
    search: "",
    sectors: new Set(),
    levels: new Set(),
    sort: "closing-asc",
    hideClosed: false
  };

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

  function sectorLabel(key) {
    var s = SECTORS.filter(function (s) { return s.key === key; })[0];
    return s ? s.label : key;
  }

  function levelLabel(key) {
    var l = LEVELS.filter(function (l) { return l.key === key; })[0];
    return l ? l.label : key;
  }

  function buildChips(container, items, selectedSet, onChange) {
    container.innerHTML = "";
    items.forEach(function (item) {
      var chip = el("button", { type: "button", class: "chip", "data-key": item.key, text: item.label });
      chip.addEventListener("click", function () {
        if (selectedSet.has(item.key)) selectedSet.delete(item.key);
        else selectedSet.add(item.key);
        chip.classList.toggle("active");
        onChange();
      });
      container.appendChild(chip);
    });
  }

  function matchesFilters(job) {
    if (state.sectors.size && !state.sectors.has(job.sector)) return false;
    if (state.levels.size && !state.levels.has(job.level)) return false;
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
      copy.sort(function (a, b) {
        return new Date(b.date_found || 0) - new Date(a.date_found || 0);
      });
    } else if (state.sort === "company-asc") {
      copy.sort(function (a, b) { return (a.company || "").localeCompare(b.company || ""); });
    }
    return copy;
  }

  function renderJobCard(job) {
    var days = daysUntil(job.closing_date);
    var badges = [
      el("span", { class: "badge badge-level", text: levelLabel(job.level) }),
      el("span", { class: "badge badge-sector", text: sectorLabel(job.sector) })
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

    var top = el("div", { class: "job-top" }, [
      titleLine,
      el("div", { class: "job-badges" }, badges)
    ]);

    var meta = el("div", { class: "job-meta" }, [
      el("span", { text: "📍 " + job.location }),
      el("span", { text: "🗓 " + fmtDate(job.closing_date) }),
      el("span", { text: "via " + job.source })
    ]);

    var card = el("article", { class: "job-card" }, [top, meta]);
    if (job.notes) {
      card.appendChild(el("div", { class: "job-notes", text: job.notes }));
    }
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

  function init(data) {
    state.jobs = data.jobs || [];

    var lastUpdated = document.getElementById("last-updated");
    if (data.last_updated) {
      var d = new Date(data.last_updated);
      lastUpdated.textContent = "Updated " + d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " " +
        d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      lastUpdated.title = data.run_notes || "";
    } else {
      lastUpdated.textContent = "Not yet updated";
    }

    buildChips(document.getElementById("level-filters"), LEVELS, state.levels, render);
    buildChips(document.getElementById("sector-filters"), SECTORS, state.sectors, render);

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
      state.hideClosed = false;
      document.getElementById("search").value = "";
      document.getElementById("hide-closed").checked = false;
      document.querySelectorAll(".chip.active").forEach(function (c) { c.classList.remove("active"); });
      render();
    });

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
