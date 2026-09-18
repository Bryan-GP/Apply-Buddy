# Apply-Buddy

A daily-updated job board for UK graduate, junior and trainee roles in:

- Consulting
- Strategy
- Advisory
- Government / political advisor
- Think tanks
- Civil service

**Live site:** https://bryan-gp.github.io/Apply-Buddy/

## How it works

- `data/jobs.json` holds the current list of roles. Each entry has a title, company, location, level (`grad` / `junior` / `trainee`), sector, closing date, source, and a link to apply directly on the employer's site.
- `index.html` / `style.css` / `app.js` render that data as a searchable, filterable board — no build step, no backend, just static files served by GitHub Pages.
- A scheduled job runs once a day, searches for new roles matching the criteria above (UK-based or UK-remote, no visa sponsorship required, grad/junior/trainee level only), merges any new listings into `jobs.json`, removes roles that have closed, and commits the update.

## Data notes

Only roles found via a real, direct source (employer career page, Bright Network, Civil Service Jobs, PubAffairs Networking, official think tank job pages, etc.) are added — nothing is invented. Sectors with zero current listings just mean nothing matching was found in the last run, not that the search skipped them. Always double-check details and apply on the employer's own site — this board is a discovery tool, not the source of truth.

## Local preview

Any static file server works, e.g.:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000`.
