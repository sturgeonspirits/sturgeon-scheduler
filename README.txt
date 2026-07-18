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
