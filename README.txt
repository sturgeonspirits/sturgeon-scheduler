Netlify Distillery Scheduler (Static UI + Netlify Function Proxy)

Upload this folder to Netlify (drag-and-drop or Git).

Required Netlify environment variables:
- APPS_SCRIPT_URL: your Apps Script Web App URL (https://script.google.com/macros/s/.../exec)
- APPS_SCRIPT_KEY: matches API_KEY in your Apps Script backend

This site calls /.netlify/functions/scheduler which proxies requests to Apps Script.
