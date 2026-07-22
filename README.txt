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

v3.3 2026-07-18 — Person+date tasks attach to shifts:
Assigning a task to a person and date now attaches it to that person's shift
that day immediately (shows in their shift card/grid block). If they have no
shift that day, you get a warning and the task stays on the day instead.
Changing a task's person/date re-attaches it to the right shift automatically
(backend v6.3).

v3.4 2026-07-18 — Shift agendas + rollover of unfinished tasks:
Employees now see their shift agenda expanded by default on their own shift
cards (collapse sticks per session). Backend v6.4 adds an hourly trigger:
tasks not checked off during a shift automatically move to that employee's
next upcoming shift, or back to Up for Grabs (unassigned) if they have no
future shift. IMPORTANT: after deploying, open the Sheet and run
Scheduler > Install Triggers once so the new hourly rollover trigger exists.

v3.5 2026-07-19 — Full employee agenda on shifts:
Clicking a shift now also shows tasks assigned to that employee (same day or
undated) that aren't attached to the shift, with a one-tap Attach button.
Shift cards and staffing-grid blocks include these in their task counts and
checklists, so a shift shows the employee's complete workload. Frontend only.

v3.6 2026-07-19 — Reliable task↔shift matching + staff shift checklist:
Tasks are now matched to shifts directly against the task list with normalized
IDs, so a stale or mis-keyed lookup can't hide them (this fixes tasks added in
the shift modal not appearing on reopen or in the staffing grid). Reopening a
shift also pulls fresh task data from the server. Tasks whose shift no longer
exists are rescued onto the employee's shift for that day. Staff see every
task assigned to them for a shift as a checklist, expanded by default on their
own shift cards, and can tick items off inline. Frontend only.

v3.7 2026-07-19 — On-shift landing screen:
Opening the app during your own scheduled shift now lands on a big, mobile-
friendly checklist of that shift's tasks (tap to check off, live progress bar).
Tap "View Schedule" or swipe left to reach the calendar. If not currently on
shift, the app opens to the schedule as before. Frontend only.

v3.8 / v6.5 2026-07-19 — Task priority:
Tasks now have a priority (High / Normal / Low). Higher-priority tasks sort to
the top everywhere — the on-shift checklist, shift-card checklists, and the
Tasks tab. Set it in Add Task and in the task edit modal; recurring templates
can carry a default priority. Backend v6.5 adds a "priority" column to the
Todos/TaskTemplates sheets (added automatically on next load — no manual
migration needed).

v3.9 2026-07-19 — Editable task text + category:
The task edit modal (⋯ on any task) now lets you change the task's wording and
category, not just assignee/priority/date. Frontend only.

v3.10 2026-07-19 — On-shift screen: my tasks + everything else:
The on-shift landing screen now shows two sections: "Your tasks" (assigned to
the staff member for this shift, priority-sorted) first, then "Also needs
doing" — every other not-yet-done task — so staff can pick up extra work.
Tasks on another person's in-progress shift are excluded. Frontend only.

v3.11 2026-07-19 — Claim button on the on-shift screen:
Each "Also needs doing" task has a Claim button that assigns it to the staff
member and attaches it to their current shift, moving it up to "Your tasks".
Tapping the row still checks a task off; Claim doesn't. Frontend only.
