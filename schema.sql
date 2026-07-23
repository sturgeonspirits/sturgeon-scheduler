-- =============================================================================
-- Sturgeon Spirits Scheduler — Supabase / Postgres schema
-- v2.0 — 2026-07-23
-- Regenerated against current production code.gs (through the uncommitted
-- v6.7 "optional task due time" change) to replace the v1.0 (2026-04-29)
-- schema, which predated three months of feature work and was missing two
-- entire tables.
-- =============================================================================
-- What changed since v1.0:
--   - ADDED: `task_templates` table (Task Templates feature, v6.0 2026-07-18)
--   - ADDED: `todos` table (Staff Tasks feature, v5.5 2026-05-26 onward,
--     extended through v6.7 2026-07-23)
--   - UNCHANGED: profiles, shifts, availability, swap_requests, reminder_log,
--     bulletin, daily_notes — verified column-for-column against current
--     code.gs; no drift since v1.0.
--   - NO SCHEMA CHANGE NEEDED for these features, confirmed against code.gs:
--       * Biweekly recurrence — reuses shifts.seriesId/seriesIndex/isSeries,
--         just a different step interval at creation time (see
--         BIWEEKLY-GAS-PATCH.js). No new column.
--       * "Food Prep" task category — shifts.task is free text, not a
--         constrained enum. No new column.
--       * Per-person ICS calendar feeds (v6.1 2026-07-18) — token is
--         computed on the fly as HMAC-SHA256(email, secret), never stored
--         (see code.gs `_icsToken_`). No new column; the Postgres/Edge
--         Function equivalent should do the same rather than storing a
--         token (do NOT add the `ical_token` column the old session3a plan
--         called for — it's unnecessary and one more thing to keep in sync).
--       * Staffing grid — reads existing shifts rows only.
--       * Swap-requests-open-to-all default — swap_requests."toEmail" was
--         already nullable.
--
-- How to use:
--   1. Create a new Supabase project (staging first — do not point this at
--      production data until the full feature-parity checklist passes).
--   2. Open SQL Editor → New Query → paste this whole file → Run.
--      Every statement is idempotent (`if not exists`), so it's safe to
--      re-run against a database that already has some of these objects.
--   3. Load CSVs from export_sheets.gs via Table Editor → Import CSV, OR use
--      \copy from psql (see notes at bottom). NOTE: export_sheets.gs does
--      NOT currently export the Todos or TaskTemplates sheets — that script
--      needs a matching update before the data import step (tracked
--      separately, not part of this schema change).
--
-- Design notes (carried over from v1.0):
--   - Column names use camelCase (quoted) to match the existing frontend JS,
--     so the frontend swap is mostly fetch URL / call-shape changes only.
--   - Sessions and LoginCodes tables are intentionally OMITTED — Supabase
--     Auth replaces both with magic-link login.
--   - Staff table is replaced by `profiles`, linked to auth.users by id.
--     During migration we keep an `email` lookup so existing rows still join.
--   - All ISO timestamp columns are timestamptz. CT display columns are text
--     (they're derived display values; can be regenerated any time).
--   - RLS is NOT enabled here — that comes after the frontend swap, same as
--     the original plan.
-- =============================================================================

-- ----- Extensions -----------------------------------------------------------
create extension if not exists "pgcrypto";

-- ----- profiles (replaces Staff sheet) --------------------------------------
-- Linked to Supabase Auth via id. During migration we keep email as the join key.
create table if not exists public.profiles (
  id              uuid primary key default gen_random_uuid(),
  email           text unique not null,
  name            text not null default '',
  "isManager"     boolean not null default false,
  "remindOptIn"   boolean not null default true,
  "remind24h"     boolean not null default true,
  "remind2h"      boolean not null default true,
  created_at      timestamptz not null default now()
);
create index if not exists profiles_email_idx on public.profiles (lower(email));

-- ----- shifts ---------------------------------------------------------------
create table if not exists public.shifts (
  "eventId"       text primary key,
  "sourceId"      text,
  "seriesId"      text,
  "seriesIndex"   integer,
  "isSeries"      boolean not null default false,
  "isOpen"        boolean not null default false,
  "isOpenEnded"   boolean not null default false,
  "staffEmail"    text,
  "staffName"     text,
  task            text,
  location        text,
  "startISO"      timestamptz,
  "endISO"        timestamptz,
  "startCT"       text,
  "endCT"         text,
  notes           text,
  "createdBy"     text,
  "createdAtISO"  timestamptz default now(),
  "updatedAtISO"  timestamptz default now()
);
create index if not exists shifts_staff_idx     on public.shifts (lower("staffEmail"));
create index if not exists shifts_start_idx     on public.shifts ("startISO");
create index if not exists shifts_end_idx       on public.shifts ("endISO");
create index if not exists shifts_open_idx      on public.shifts ("isOpen") where "isOpen" = true;
create index if not exists shifts_series_idx    on public.shifts ("seriesId");

-- ----- availability ---------------------------------------------------------
create table if not exists public.availability (
  id              text primary key,
  "staffEmail"    text not null,
  "staffName"     text,
  "startISO"      timestamptz not null,
  "endISO"        timestamptz not null,
  "startCT"       text,
  "endCT"         text,
  reason          text,
  "createdAtISO"  timestamptz default now()
);
create index if not exists avail_staff_idx on public.availability (lower("staffEmail"));
create index if not exists avail_start_idx on public.availability ("startISO");

-- ----- swap_requests --------------------------------------------------------
create table if not exists public.swap_requests (
  id              text primary key,
  "eventId"       text references public.shifts("eventId") on delete cascade,
  task            text,
  "startISO"      timestamptz,
  "endISO"        timestamptz,
  "isOpenEnded"   boolean default false,
  "startCT"       text,
  "endCT"         text,
  "fromEmail"     text not null,
  "fromName"      text,
  "toEmail"       text,          -- null/blank = open to all staff (current default)
  message         text,
  status          text not null default 'pending',  -- pending, accepted, approved, denied, cancelled
  "acceptedAtISO" timestamptz,
  "approvedBy"    text,
  "approvedAtISO" timestamptz,
  "createdAtISO"  timestamptz default now()
);
create index if not exists swap_from_idx   on public.swap_requests (lower("fromEmail"));
create index if not exists swap_to_idx     on public.swap_requests (lower("toEmail"));
create index if not exists swap_status_idx on public.swap_requests (status);

-- ----- reminder_log ---------------------------------------------------------
-- Used by the hourly reminder Edge Function (session 2) to dedupe sends.
create table if not exists public.reminder_log (
  id              text primary key,
  "eventId"       text,
  kind            text,                -- '24h' or '2h'
  "sentTo"        text,
  "sentAtISO"     timestamptz default now()
);
create index if not exists reminder_event_kind_idx
  on public.reminder_log ("eventId", kind);

-- ----- bulletin -------------------------------------------------------------
create table if not exists public.bulletin (
  id              text primary key,
  message         text,
  "updatedBy"     text,
  "updatedAtISO"  timestamptz default now()
);

-- ----- daily_notes ----------------------------------------------------------
create table if not exists public.daily_notes (
  date            date primary key,
  note            text
);

-- ----- task_templates (NEW — Task Templates feature, v6.0 2026-07-18) ------
-- Recurring/quick-add task templates. Materialized into `todos` rows by
-- backend logic on each `listTodos` call (see TASKS-SPEC.md §4). Created
-- before `todos` since todos."templateId" references this table.
create table if not exists public.task_templates (
  id              text primary key,
  text            text not null,
  category        text,
  recurrence      text not null default 'none',  -- none | daily | days:Mon,Thu | weekly | monthly
  "targetDuty"    text,     -- optional; matches shifts.task to attach to that duty's shift
  "requireProof"  boolean not null default false,
  active          boolean not null default true,
  priority        text not null default 'normal'  -- high | normal | low (v6.5 2026-07-19)
);
create index if not exists templates_active_idx on public.task_templates (active) where active = true;

-- ----- todos (NEW — Staff Tasks feature) ------------------------------------
-- v5.5 2026-05-26 — original columns: id, text, category, done, addedBy,
--   addedAt, doneBy, doneAt (simple shared backlog)
-- v6.0 2026-07-18 — added date, shiftId, assignedTo, proofValue, templateId
--   (see TASKS-SPEC.md §1 for the four task scopes derived from
--   date/shiftId/assignedTo: backlog / day task / personal day task / shift
--   task)
-- v6.5 2026-07-19 — added priority (high | normal | low)
-- v6.7 2026-07-23 — added time (optional due time; a task can be dateless,
--   date-only, or date+time — "time" is nullable in all cases)
create table if not exists public.todos (
  id              text primary key,
  text            text not null,
  category        text,
  done            boolean not null default false,
  "addedBy"       text,
  "addedAt"       timestamptz default now(),
  "doneBy"        text,
  "doneAt"        timestamptz,
  date            date,                 -- optional; null = backlog item
  "shiftId"       text references public.shifts("eventId") on delete set null,
  "assignedTo"    text,                 -- staff email, optional
  "proofValue"    text,                 -- free text/number captured at completion
  "templateId"    text references public.task_templates(id) on delete set null,
  priority        text not null default 'normal',  -- high | normal | low
  "time"          time                  -- optional due time; null = date-only or open
);
create index if not exists todos_shift_idx      on public.todos ("shiftId");
create index if not exists todos_assigned_idx   on public.todos (lower("assignedTo"));
create index if not exists todos_date_idx       on public.todos (date);
create index if not exists todos_done_idx       on public.todos (done) where done = false;
create index if not exists todos_template_idx   on public.todos ("templateId");

-- =============================================================================
-- CSV import notes
-- =============================================================================
-- The export_sheets.gs script writes one CSV per sheet to a Drive folder.
-- Filenames map directly:
--    Staff.csv         → profiles  (email/name/isManager/remindOptIn/remind24h/remind2h)
--    Shifts.csv        → shifts
--    Availability.csv  → availability
--    SwapRequests.csv  → swap_requests
--    ReminderLog.csv   → reminder_log
--    Bulletin.csv      → bulletin
--    DailyNotes.csv    → daily_notes
--    TaskTemplates.csv → task_templates   ** requires export_sheets.gs update — not yet exported **
--    Todos.csv         → todos           ** requires export_sheets.gs update — not yet exported;
--                                             also import AFTER task_templates (FK dependency) **
--
-- Sessions.csv and LoginCodes.csv are NOT imported — Supabase Auth replaces them.
--
-- Easiest path: Supabase Dashboard → Table Editor → (table) → Import data → CSV.
-- The dashboard handles type coercion for booleans and timestamps.
--
-- Power-user path (psql), import order matters for FKs — profiles/shifts/
-- task_templates before swap_requests/todos:
--   \copy public.profiles(email,name,"isManager","remindOptIn","remind24h","remind2h") \
--     from 'Staff.csv' with (format csv, header true);
--   (and similarly per table — note column-list order matches CSV header)
-- =============================================================================
