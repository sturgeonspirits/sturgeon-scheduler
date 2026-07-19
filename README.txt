Netlify Distillery Scheduler (Static UI + Netlify Function Proxy)

Upload this folder to Netlify (drag-and-drop or Git).

Required Netlify environment variables:
- APPS_SCRIPT_URL: your Apps Script Web App URL (https://script.google.com/macros/s/.../exec)
- APPS_SCRIPT_KEY: matches API_KEY in your Apps Script backend

This site calls /.netlify/functions/scheduler which proxies requests to Apps Script.

v3 2026-07-18 — Task assignment update:
The Tasks features (shift/day/person assignment, templates, auto-roll) require
the v3 backend update. See TASKS-GAS-SNIPPET.js for what to paste into your
scheduler.gs (replaces the v2 todo handlers) and remember to add
releaseTasksForShift(body.eventId) inside your deleteShift handler.
Design details: TASKS-SPEC.md.

v3.1 2026-07-18 — Personal calendar feeds (ICS):
Each staff member can subscribe to their own shifts in Google, Zoho, or Apple
Calendar. Feed link appears under Profile > Calendar Feed (backend v6.1 doGet
serves ?ics=1&email=...&token=...). Links are signed with a token derived from
API_KEY — rotating API_KEY invalidates all feed links. Managers can log every
staff feed URL by running printAllIcsUrls() in the Apps Script editor.
Redeploy the Apps Script web app after pasting the updated code.gs.

v3.2 2026-07-18 — Staffing Grid + auto-hide past requests:
Schedule tab gains a "Staffing Grid" mode (desktop-optimized): days across the
top, hours down the left, color-coded shift blocks per duty, overlaps shown
side-by-side, notes/unavailability/day-tasks in an all-day row, per-day
shift + hour totals. Managers click a block to edit. Backend v6.2 auto-hides
swap requests and unavailability entries once their shift/window has ended.
