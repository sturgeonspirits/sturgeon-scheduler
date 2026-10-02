# Sturgeon Scheduler — Project Status
<!-- v1 2026-10-02 — read this first in a new session instead of re-exploring the repo. Update it with every release. -->

## Current versions
- **Frontend:** v3.34 (2026-10-02) — `index.html` (single file, ~4,950 lines; all CSS/JS inline)
- **Backend:** v7.11 (2026-09-11) — `code.gs` (Apps Script, ~3,970 lines, ~63 API actions)
- Release history with reasons: bottom of `README.txt` (newest last)

## Architecture (one paragraph)
Static PWA on Netlify (`publish = "."`) → `/.netlify/functions/scheduler` proxy
(env: `APPS_SCRIPT_URL`, `APPS_SCRIPT_KEY`) → Apps Script web app `code.gs` →
Google Sheet `1TsSonscE_UZ9A80tLSVxdnKQx_udYWGWQejTPh17wtg`.
Sheets: Staff, Shifts, Availability, Sessions, SwapRequests, Bulletin,
DailyNotes, Todos, TaskTemplates, TimeLog, EventStaffing.
Repo: github.com/sturgeonspirits/sturgeon-scheduler (main). Push = Netlify deploy.

## Where things live in index.html
| Area | Find it by searching |
|---|---|
| API call / cache / in-flight dedupe | `async function api(` , `invalidateCache`, `invalidateAll` |
| Render loop | `function render(` / `_render(` (renderVersion guards stale paints) |
| Toasts | `function showToast`, `function showUndoToast` (v3.34) |
| On-shift overlay | `renderNowShift`, `toggleNowShiftTask` |
| Tasks tab | `renderTaskRow`, `subTabs.tasks`, `addTodo`, `toggleTodo` |
| Task check-off engine | `saveTodoDone`, `todoSaveQueue`, `todoPendingDone` (v3.34) |
| Schedule click delegation | `document.querySelector('.wrap').addEventListener('click'` |
| Shift↔task sync | `syncShiftTaskAssignees`, `buildTaskMaps` |
| Events/staffing card | `v3.32` / `v3.33` comments; backend `v7.11` horizon + EventStaffing |
| Load/caching perf | v3.22–v3.23 comments (`snapshotFloor`, `schedScaffoldHtml`) |

## Rules for changes (Karl's standing preferences)
- Every change carries a `vX.YY YYYY-MM-DD` comment; bump the version and add a README entry.
- Write whole files to disk — no patches/snippets for Karl to paste.
- Apps Script: one global scope across files (no duplicate top-level `const`); never `getUi().alert()` in editor-run functions.
- End with the git commit/push commands.
- Backend changes need Apps Script redeploy (Deploy → Manage deployments → edit → New version). Frontend-only changes don't.

## Known open items / ideas
- Task check-off and most writes still wait on Apps Script (1–4 s). v3.34 hides
  that for tasks only; other writes (claim, swap, shift save) still show spinners.
- `ROLLBACK_code_v7.1.gs`, `export_sheets.gs`, `_to_delete/` are untracked in git.
- `~/Documents/Claude/Projects/Sturgeon Scheduler/` holds an older Supabase
  migration draft (schema.sql, session2/3a SQL, edge functions). Not live.
