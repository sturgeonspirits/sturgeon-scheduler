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

v3.12–3.13 / v6.6 2026-07-19 — Food service:
Added "Food Prep" as a to-do task category (with its own badge) AND as a shift
role (backend v6.6 TASKS list) for the new food service. The shift modal's
"Task" dropdown was renamed "Shift Role" to distinguish shift roles from to-do
tasks. Food Prep has a matching color in the staffing grid. Backend redeploy
required so the new role reaches the Shift Role dropdown.

v3.15 / v6.8 2026-08-02 — Faster initial load:
Opening the app used to make four sequential requests (bootstrap →
dashSchedule → listTodos → listTemplates), each paying full Apps Script
invocation overhead. Backend v6.8 adds an "initLoad" action that returns all
four in a single response, so cold load is now one round trip instead of four.
The app also saves that payload to localStorage and paints your schedule from
it instantly on the next open while it revalidates in the background — so
repeat opens feel immediate, and going offline shows your last saved schedule
instead of a "Connection Failed" card.
Also fixed: renderSchedule() and the on-shift screen requested the same week's
data with differently-shaped arguments, so neither the cache nor the in-flight
dedupe matched and dashSchedule fired twice on every load. listTodos and
listTemplates now run in parallel instead of one after the other. The
<link rel="preconnect"> pointed at a path ("/.netlify") rather than an origin,
which made it a no-op; it now warms script.google.com.
Backend redeploy required (new initLoad action).

v3.16 2026-08-02 — Tasks opens with your work AND unclaimed work:
The Tasks tab used to open on "My Tasks", hiding every unclaimed task behind a
separate "Up for Grabs" sub-tab, so staff had to go looking for work available
to them. The first screen now merges your own tasks with everything unassigned,
interleaved through the same Overdue/Today/Upcoming/Anytime sections and sorted
by priority. Unclaimed rows are tagged "up for grabs" and carry a Take button.
Only tasks assigned to someone else are held back — those are still under All.
The "Up for Grabs" sub-tab is gone; the tabs are now "Mine & Open" and "All".
Frontend only.

v3.17 / v6.9 2026-08-02 — Warn when a swap lands on your unavailability:
api_acceptSwap did no conflict checking whatsoever, so picking up an
"open to anyone" swap was silently allowed even while you were marked
unavailable — claiming a true open shift (api_claimOpenShift) has always been
checked, which is why this only affected the swap board. Accepting a swap that
overlaps your own unavailability now shows a warning naming the reason and
dates, with Cancel / Accept Anyway. It's a warning, not a block: choosing
Accept Anyway re-sends with force:true and your unavailability entry is left
untouched. Backend redeploy required.

v3.18 / v7.0 2026-08-02 — Off-site work hours (Toast payroll helper):
Staff who work away from the building can't punch in on Toast, so their hours
had nowhere to live. New TimeLog sheet + an "Off-Site Hours" card on the
Shifts tab, under My Upcoming Shifts — it's a record of work, so it sits with
their other shift items. Visible only to staff whose Staff-sheet
"canLogHours" column is TRUE; everyone else's Shifts tab is unchanged. They log
a date, either start/end times or a plain duration, a category and a short
description. Managers get an Admin > Hours tab: approve a person's week, then
mark it entered in Toast so it can't be keyed in twice.

Weeks run Monday–Sunday, matching Toast's payroll week and the app's existing
snapToMonday(). Entries store EXACT minutes; the week total is rounded once to
the nearest quarter hour, and that bold figure is what you type into Toast.
Rounding per entry instead would turn three 10-minute errands into 45 billable
minutes — there's a unit test covering this.

Deliberately separate from the Shifts sheet, so these never create calendar
events, appear in the staffing grid, fire shift reminders, show on the swap
board, or attract task rollover. Also deliberately NOT folded into the existing
Week/Month Summary hour reports — those are SCHEDULED hours; Toast remains the
source of truth for payroll.

Two reminders, both riding the existing hourly trigger (no new trigger, no need
to re-run Install Triggers):
  • Monday 8am CT — nudges off-site staff to log the week that just closed.
    Skipped for anyone who already submitted. Links to ?timelog=YYYY-MM-DD,
    which opens the Shifts tab on that (already ended) week rather than the
    current one.
  • Tuesday 8am CT — emails karl@ with everything awaiting approval, everything
    approved-but-not-yet-entered, and any late entries that landed on a week
    already marked entered (those need a manual Toast adjustment). Covers all
    weeks, not just last one, so an old straggler resurfaces. Silent when
    there's nothing pending.

SETUP: set canLogHours to TRUE in the Staff sheet for the one person who needs
it. The TimeLog sheet and the canLogHours column are created automatically on
first use. Backend redeploy required (new actions + reminders).

KNOWN GAP: api_approveSwap still reassigns the shift with no conflict check, so
a manager approving a stale swap can place it on someone who became unavailable
after accepting. Not addressed here.


v3.19 2026-08-02 — New app icon (ship's wheel clock, navy + gold):
Whole icon set regenerated from icons/icon-master.png. Notes for next time:

The supplied artwork had a rounded-square baked in with PURE BLACK corners.
Left alone, those corners sit inside iOS's own squircle mask and show as black
slivers. The build strips that baked edge and rebuilds the navy field so the
background bleeds to all four sides — platforms then apply their own shape.
If you ever swap the artwork, do the same: hand the platforms a full-bleed
square, never a pre-rounded one.

  icon-16/32/48 + favicon.ico  cropped in on the wheel — at those sizes the
                               navy margin is wasted and only the gold rim reads
  icon-64 .. 512, apple-touch  full-bleed, no transparency (iOS forbids alpha)
  icon-maskable-192/512        wheel scaled so the gold rim lands at 78% of
                               width; Android's maskable safe zone is the inner
                               80% circle, and the untouched art spans ~83%,
                               so it would have been clipped by round launchers

theme-color and the manifest's background_color are now #18263A, sampled from
the icon's own border so the PWA splash doesn't step against the icon.

AFTER DEPLOYING: browsers cache favicons hard — hard-refresh (Cmd+Shift+R) or
try a private window before concluding it didn't work. Anyone who already added
the app to their home screen keeps the OLD icon until they remove and re-add it;
there's no way to push an icon change to an installed PWA.

================================================================================
MAINTENANCE: CHANGING WHO GETS NOTIFICATION EMAILS
================================================================================

All email addresses live in one place: the EMAIL_SETTINGS block near the top of
code.gs (line 76). Nothing is buried in the middle of the file.

    const EMAIL_SETTINGS = {
      fromName: "Sturgeon Scheduling",
      replyTo: "karl@sturgeonspirits.com",       <- staff replies land here
      managerEmail: "karl@sturgeonspirits.com",  <- ALL manager alerts go here
      staffNotifySubjectPrefix: "[Shift]",
      managerNotifySubjectPrefix: "[Manager]"
    };

--- To move ALL manager notifications to someone else ---
Change managerEmail, save, and REDEPLOY the Apps Script web app (Deploy >
Manage deployments > edit > Deploy). Nothing takes effect until you redeploy.

IMPORTANT: managerEmail is shared by three separate notifications. Changing it
moves all three at once — there is no per-notification setting:
  1. "Open Shift Claimed"           (api_claimOpenShift)
  2. "Swap Accepted"                (api_acceptSwap)
  3. "Off-site hours to enter in Toast"  (sendTimeLogManagerReminder, Tuesdays)

--- To move ONLY the Tuesday payroll reminder ---
If payroll moves to someone else but shift alerts should stay with Karl, don't
touch managerEmail. Instead edit sendTimeLogManagerReminder() in code.gs (search
for "TIMELOG_MGR_") and replace BOTH of these lines:

      _timeLogRemindOnce_("TIMELOG_MGR_" + today, "timelogMgr", EMAIL_SETTINGS.managerEmail, ...
        to: EMAIL_SETTINGS.managerEmail,

with the new address, e.g. "payroll@sturgeonspirits.com". Both lines matter: the
first is the de-dupe key in ReminderLog, the second is the actual recipient. If
you change only the "to:" line, the reminder still de-dupes against the old
address and can silently stop sending. Redeploy afterwards.

To send it to more than one person, use a comma-separated string in the "to:"
line ("a@x.com,b@x.com") and leave the _timeLogRemindOnce_ key as one address.

--- Reminder schedule ---
Both off-site-hour reminders are controlled by three constants near the top of
code.gs (search TIMELOG_REMIND_HOUR):

    TIMELOG_REMIND_HOUR = 8            // 8am Central, both reminders
    TIMELOG_STAFF_REMIND_DAY = "Mon"   // staff: log last week's hours
    TIMELOG_MGR_REMIND_DAY = "Tue"     // manager: enter them in Toast

Use three-letter day names ("Mon", "Tue", ...). Both ride the existing hourly
sendShiftReminders trigger and are no-ops outside their day/hour, so changing
these needs a redeploy but NOT a re-run of Install Triggers.

--- Testing a reminder without waiting for the day ---
In the Apps Script editor, run sendTimeLogManagerReminder(new Date("2026-08-04T13:00:00Z"))
— that's a Tuesday at 8am Central. Pass any date to simulate. Note it will
still refuse to send twice for the same date: clear that row from the
ReminderLog sheet (kind = "timelogMgr") to re-test.

v3.20 2026-08-23 — Week nav no longer fails silently (frontend only):
The ◀/▶ week buttons looked dead whenever the schedule fetch failed. Three
causes, all fixed in index.html (no Apps Script redeploy needed):
1. _render()'s catch only showed an error if the old markup did NOT contain
   the word "shift" — which it always does on the Schedule tab. Every failure
   was swallowed and the previous week stayed on screen. Errors now go to the
   console and to a toast (or an error card with a Try Again button if the
   view is empty).
2. api() retried Apps Script's "busy" HTML page, but the Netlify proxy already
   rewrites that into {ok:false, error:"Non-JSON response from Google..."}, so
   the retry never fired. That shape is now retried twice with backoff.
3. jumpToday() left weekStart on the current weekday instead of snapping to
   Monday, so "Today"/"This Week" could drift off the Mon–Sun payroll week.
Also hardened renderSchedule() against a partial dashSchedule payload.

v3.21 2026-08-23 — "Today" scrolls to today (frontend only):
Pressing Today / This Week on the Schedule tab now scrolls today's day card to
the top of the list, just under the sticky header, instead of only re-rendering
the current week. Today's card carries data-today="1"; jumpToday() arms a
one-shot flag that renderSchedule() consumes after paint (and _render() always
clears, so it can't fire on an unrelated render). Works in both Week View and
the list view; the Staffing Grid has no day list, so it's a no-op there.

v3.22 2026-09-03 — Fast schedule loading, never a blank week (frontend only,
no Apps Script redeploy needed):
Loading the Schedule tab used to cost two Apps Script round trips back to back
(dashSchedule, then the task lists) with nothing on screen in between, and the
30-second cache plus render(true) on every ◀/▶ meant almost nothing was ever
reused. Five changes in index.html:
 1. Stale-while-revalidate. Any week already in memory — or saved to the device
    in SCHED_WEEKS_V1 (last 12 weeks/months, keyed like schedCacheKey) — paints
    immediately while the fresh copy loads behind it. A background refresh only
    repaints if the data actually changed, so it never flickers.
 2. One round trip instead of two. dashSchedule and the task lists are fetched
    together with Promise.all rather than one after the other.
 3. Nothing is ever blank. A week with no cached copy shows schedScaffoldHtml()
    — the real dates, the real day cards, a shimmer where shifts will land and
    "Loading schedule…" — and navigating away from a loaded week keeps that week
    on screen (dimmed to 0.65, was 0.4) until the next one arrives. The bare
    grey-bar skeleton is gone from the Schedule tab.
 4. Caching that holds. CACHE_TTL 30s → 120s; SWR_MAX_AGE 60s. moveDate() and
    jumpToday() call render(false), not render(true) — render(true) ran
    invalidateAll() and threw away every loaded week plus the task lists.
    Returning to the tab after less than a minute now costs nothing at all;
    a longer absence refreshes behind the visible week instead of blocking.
    prefetchNeighbors() warms the weeks either side (debounced 900ms), so ◀/▶
    usually come back from memory. Editing anything still forces a real fetch —
    invalidateAll() sets snapshotFloor so pre-edit saved copies are never shown.
 5. Refresh keeps your place. The week/month and Week/Month/Grid choice are
    saved in SCHED_VIEW_V1 and restored for 12 hours, so reloading mid-way
    through building next month's schedule no longer snaps back to this week.
    "Today" still jumps back to the current week; logging out clears it.
Init cache is now SCHED_INIT_V2 (bootstrap + tasks, no longer tied to one week),
so the nav and brand are up instantly even on a week you've never opened here.

v3.24 2026-09-05 — Shift notes are visible to everyone (frontend + backend v7.1):
The Notes box on a shift used to be stripped out for anyone who wasn't a
manager (_cleanShift_ sent notes:"" to staff), so a note written for the
person working the shift never reached them in the app. Notes now go out with
every shift and appear:
 - on the shift card, as a highlighted 📝 line under the time/name/location,
 - on the Staffing Grid, as a 📝 mark on the block with the full text in the
   hover tooltip,
 - in the personal ICS calendar feed (it was always in the Google Calendar
   event description — the app was the only place it was hidden).
Editing is unchanged: managers are still the only ones who can write a note.
The form label now reads "Notes (visible to everyone)" so that's obvious while
typing. Redeploy the Apps Script web app after pasting the updated code.gs —
the staff-facing change only takes effect once the backend is redeployed.

v3.25 2026-09-05 — Event staffing check (frontend + backend v7.2):
Toast Catering & Events syncs bookings into the staff account's Google
Calendar (sturgeonspiritsstaff@gmail.com), but Toast has no idea who works an
event — the covering shift only exists in this app, created by hand, with
nothing linking it back. New manager-only "Events needing staff" card at the
top of the Schedule tab grades every event in the next 60 days:
 - NEEDS SHIFTS — nothing at that space and time. "Create shift" opens the
   shift modal pre-filled with the event's date, time, space and name.
 - UNCLAIMED — a shift exists but it's still OPEN. This is the one that used
   to slip through: a shift is there, so the schedule looks covered, but
   nobody has taken it. "Go to week" jumps to it.
 - STAFFED — a named person is on it. Card collapses to "all N staffed".
Matching is on EVENT SPACE + time overlap, not time alone. Toast writes
"Event space: Ready Room" into the description, which matches LOCATIONS
exactly. Time-only matching reported every event as covered, because someone
is always bartending somewhere in the building.
Toast's tentative orders are flagged; customer names, emails, phones, invoice
links and totals are manager-only and never sent to staff.
The card loads after the schedule paints and never blocks it (v3.22/v3.23
rules). Requires the events calendar to be shared with the account the Apps
Script runs as. Redeploy the Apps Script web app after pasting code.gs.

v3.26 2026-09-05 — Pending swaps count against event staffing (frontend +
backend v7.3):
A named person who has asked to give a shift away is not staffing the event.
Only APPROVED reassigns the shift row; REQUESTED (nobody has taken it) and
ACCEPTED (taken, awaiting manager approval) both leave the name unsettled, and
until now either one still read as STAFFED on the events card.
Fourth state SWAP PENDING: at least one named person covers the event but all
of them have open swap requests. An event with any settled name on it still
reads STAFFED. The row names who wants out and whether there's a taker yet.

v3.27 2026-09-05 — Event time vs staffing time (frontend + backend v7.4):
The card listed the event window (when guests are there), which is never what
you schedule — staff come early and stay to clean up. Each row now shows both:
"event 4:30 – 6:30 PM" and, beneath it, the staffing window. When shifts
already cover the event that's their real span; when none do it's a suggested
window padded by EVENT_SHIFT_PAD (30 min before, 30 min after), and "Create
shift" prefills the padded times rather than the raw event times.
The 30/30 default was fitted to the four September events staffed by hand:
before was +30 on three of four; after ranged +0 to +60, so 30 is a midpoint,
not a rule. One constant at the top of code.gs to change it.
