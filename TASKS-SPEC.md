# Staff Tasks — Final Spec
<!-- v1 2026-07-18 -->

Production and general tasks attachable to shifts, days, and people. Extends the existing Tasks tab and `Todos` sheet — one system, no duplicates. Mobile-first throughout.

---

## 1. Data model

### `Todos` sheet (extend existing)

Existing columns stay unchanged; add E–H equivalents at the end:

| Col | Field | Notes |
|-----|-------|-------|
| A | id | unchanged |
| B | text | unchanged |
| C | category | unchanged |
| D | done | unchanged |
| E | addedBy | unchanged |
| F | addedAt | unchanged |
| G | doneBy | unchanged |
| H | doneAt | unchanged |
| I | **date** | `YYYY-MM-DD`, optional |
| J | **shiftId** | optional, links to a shift row |
| K | **assignedTo** | staff email, optional |
| L | **proofValue** | optional free text/number entered at completion |
| M | **templateId** | set when a task was spawned by a template (dedupe key) |

### Task scopes (derived from I–K)

| date | shiftId | assignedTo | Meaning |
|------|---------|-----------|---------|
| – | – | – | **Backlog** — shared, up for grabs (current behavior) |
| ✓ | – | – | **Day task** — everyone working that day sees it |
| ✓ | – | ✓ | **Personal day task** |
| – | ✓ | – | **Shift task** — owned by whoever holds the shift (survives swaps/reassignment) |

### `TaskTemplates` sheet (new)

| Col | Field | Notes |
|-----|-------|-------|
| A | id | |
| B | text | task text, e.g. "Mash prep" |
| C | category | reuses `TODO_CATEGORIES` |
| D | recurrence | `none` \| `daily` \| `days:Mon,Thu` \| `weekly` \| `monthly` |
| E | targetDuty | optional; matches a shift's `task` field (e.g. "Distilling") — attaches to that duty's shift on matching days |
| F | requireProof | TRUE → completion asks for a value (proof gauge, temp, count) |
| G | active | TRUE/FALSE |

`none` templates are just quick-add buttons. Recurring templates are materialized into `Todos` rows by the backend (see §4).

---

## 2. Behavior rules

- **Permissions:** all staff can add tasks, assign to anyone (including others), claim from backlog, and check off any visible task. Only managers and the task's creator can delete. Managers manage templates.
- **Auto-roll:** dated, incomplete, non-shift tasks roll forward — when listing, any task with `date < today` and `done = FALSE` is treated as due **today** (display "since Tue 7/14"; don't rewrite the row). Shift tasks don't roll: if the shift is past and the task is undone, it converts to a personal day task for that shift's holder, due today.
- **Shift deleted →** its tasks fall back to day tasks on the shift's date (clear `shiftId`, set `date`).
- **Shift swapped/reassigned →** nothing to do; shift tasks follow `shiftId`.
- **Template materialization** runs on `listTodos`: for each active recurring template matching today (and tomorrow, so evening staff can preview), create a `Todos` row if none exists with that `templateId` + date (+ shiftId for duty-targeted ones). Duty-targeted templates attach to each matching shift; if no matching shift exists that day, create a day task instead.
- **Done tracking:** unchanged (doneBy/doneAt). If the task's template has `requireProof`, completion prompts for a value stored in `proofValue`.

---

## 3. UI

General mobile rules: all tap targets ≥ 44px; checkboxes rendered as large tap rows (whole row toggles); modals used as bottom sheets on small screens (existing modal pattern, anchored bottom, `max-height: 85vh`, internal scroll); no hover-dependent interactions; badge counts readable at 12px+.

### Schedule tab
- **Shift cards** get a task badge: `☐ 3 · ✓ 1`. Tapping the badge (not the card) expands an inline checklist under the card — check off, no navigation. Card tap keeps its current behavior (shift modal for managers).
- **Day headers** get a slim strip when day tasks exist: `▸ 2 tasks for Thursday` — tap to expand the checklist inline. A small `+` at the row end adds a task with the date pre-filled.

### Tasks tab (rework)
Segmented control, same pattern as Admin:
- **My Tasks** (default) — everything assigned to me or my shifts, grouped: *Overdue (rolled)* → *Today* → *Upcoming* → *Anytime*. Each row: big checkbox, text, context line ("Thu · Distilling shift" / "since 7/14"), category chip.
- **Up for Grabs** — backlog + unassigned day tasks. Each row has a **Take** button (assigns to me) and, via long-press/⋯ menu, **Assign…** (staff picker) and **Schedule…** (date picker).
- **All** — full list with filters (person, day, status). Visible to everyone (small team, shared visibility), delete restricted per §2.

Add form (top card, existing pattern): text, category, plus two optional rows — **Who** (Anyone / staff picker) and **When** (Anytime / date / a listed upcoming shift). Below it, a horizontal scroll strip of template chips for one-tap add.

### Shift modal (managers)
New **Tasks** section under Location: current checklist for this shift, an inline text input to add, and an **＋ From list** button opening a picker of backlog tasks + templates. Selecting a backlog item moves it onto the shift.

### Admin tab — progress card
On Tools: **Today's Tasks** card — `7 of 12 done`, thin progress bar, expandable list of outstanding items with owner names. Tap-through to All view filtered to today.

### Notifications (reuse existing reminder plumbing)
Include assigned-task counts in existing shift reminder emails ("You have 3 tasks for this shift"). No new notification channels in v1.

---

## 4. Backend (Apps Script)

Extend the existing action dispatcher:

| Action | Change |
|--------|--------|
| `listTodos` | returns new fields; runs template materialization + auto-roll conversion first; accepts optional `filter` (mine/date) but client-side filtering is fine at this volume |
| `saveTodo` | accepts `date`, `shiftId`, `assignedTo` |
| `updateTodo` | **new** — edit text/category/date/shiftId/assignedTo (used by Take/Assign/Schedule/move-to-shift) |
| `toggleTodo` | accepts optional `proofValue` |
| `deleteTodo` | enforce creator-or-manager |
| `listTemplates` / `saveTemplate` / `deleteTemplate` | **new**, manager-only writes |
| `deleteShift` (existing) | add fallback: shift tasks → day tasks |

`bootstrap` unchanged. All new columns optional → fully backward compatible with existing `Todos` rows.

---

## 5. Out of scope (v1)

Photo proof, push notifications, temperature/sensor integrations, label printing, per-role visibility restrictions, Copy Week integration (feature unused — tasks never copy).

---

## 6. Build order

1. Sheet columns + backend actions (GAS snippet, versioned per convention)
2. Tasks tab rework (My / Up for Grabs / All)
3. Schedule tab badges + day strips
4. Shift modal Tasks section
5. Templates (sheet, manager editor in Admin, chips, materialization)
6. Auto-roll + shift-deletion fallback + proof prompt
7. Admin progress card
