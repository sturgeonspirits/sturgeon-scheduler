/**********************************************
 * Sturgeon Spirits — Staff Scheduler (Apps Script)
 * v6.5 — Task priority (high/normal/low); sorts most important to the top (2026-07-19)
 * v6.4 — Hourly rollover: unfinished shift tasks move to the person's next
 *        shift, or back to Up for Grabs if none (2026-07-18)
 * v6.3 — Person+date tasks auto-attach to that person's shift; warn if none (2026-07-18)
 * v6.2 — Auto-hide past swap requests & unavailability (2026-07-18)
 * v6.1 — Per-person ICS calendar feeds (2026-07-18)
 * v6.0 — Task assignment: shift/day/person tasks, recurring TaskTemplates,
 *        proof values, auto-materialization (2026-07-18)
 * v5.8 — Auto-cancel stale swap requests on direct reassign/delete (2026-06-30)
 * v5.7 — Fix silent no-op on reassignment (2026-06-30)
 * v5.6 — Biweekly Shift Scheduling (2026-06-08)
 * v5.5 — Staff To-Do List (2026-05-26)
 * v5.4 — Central Time Display + Production Email
 * Features: PIN Code Auth, Shifts, Open Shifts, Swaps,
 *   Staff Tasks (assignable to shifts, days, people)
 * + startCT / endCT display columns on Shifts,
 *   SwapRequests, and Availability sheets
 **********************************************/

// ====== CONFIGURATION ======
const SPREADSHEET_ID = "1TsSonscE_UZ9A80tLSVxdnKQx_udYWGWQejTPh17wtg";
const CALENDAR_ID = "b749e104233c466048da00b3380aba2f4be27d377a03fa3429c7cde7855a7aab@group.calendar.google.com";
const SITE_URL = "https://sturgeon-scheduler.netlify.app";
const API_KEY = "SSCHED_9f3c7c1b5e9a4c6aa2f2d7a9c84b1e6d";

// ====== CONSTANTS ======
// v6.6 2026-07-19 — added "Food Prep" shift role (food service launch)
const TASKS = ["Bartender", "Bar back", "Server", "Food Prep", "On-call", "Production", "Marketing", "Distribution"];
const LOCATIONS = ["Distillery", "Tasting Room", "Ready Room", "On the Lake", "Offsite"];
const TZ_CENTRAL = "America/Chicago";

const BRAND = {
  name: "Sturgeon Spirits Scheduler",
  logoUrl: "https://images.squarespace-cdn.com/content/62dc41e60a5e913c4a6db575/94f06e46-8212-4a85-ae3e-4dd5d764be61/SturgeonSpiritsPrimary_Light_GreyRGB.png",
  colors: { primary: "#0B1F3B", accent: "#C9A24A", bg: "#F6F7F9", card: "#FFFFFF", text: "#111111", muted: "#5A6573", border: "#E6E8EE" }
};

const EMAIL_SETTINGS = {
  fromName: "Sturgeon Scheduling",
  replyTo: "karl@sturgeonspirits.com",
  managerEmail: "karl@sturgeonspirits.com",
  staffNotifySubjectPrefix: "[Shift]",
  managerNotifySubjectPrefix: "[Manager]"
};

// Sheet Names
const SHEET_STAFF = "Staff";
const SHEET_SHIFTS = "Shifts";
const SHEET_AVAIL = "Availability";
const SHEET_SESS = "Sessions";
const SHEET_SWAP = "SwapRequests";
const SHEET_REMIND_LOG = "ReminderLog";
const SHEET_BULLETIN = "Bulletin";
const SHEET_NOTES = "DailyNotes";
const SHEET_LOGIN_CODES = "LoginCodes";
const SHEET_TODOS = "Todos"; // v5.5 2026-05-26
const SHEET_TEMPLATES = "TaskTemplates"; // v6.0 2026-07-18

// Cache & TTL
const STAFF_CACHE_SEC = 900;
const SHIFTS_CACHE_SEC = 600;
const SESSION_CACHE_SEC = 900;

// ============================================================================
// CENTRAL TIME DISPLAY HELPER
// ============================================================================

/**
 * Formats an ISO string into a human-readable Central Time string.
 * Example output: "Thu, Mar 27, 2026 12:30 PM"
 */
function _fmtCentral_(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  return Utilities.formatDate(d, TZ_CENTRAL, "EEE, MMM d, yyyy h:mm a");
}

// ============================================================================
// 1. ENTRY POINTS
// ============================================================================

function doPost(e) {
  try {
    const key = e && e.parameter ? String(e.parameter.key || "") : "";
    if (!API_KEY || key !== API_KEY) return _json_({ ok: false, error: "Unauthorized API Key" });

    const body = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    const action = body.action;
    const data = body.data || {};

    if (!action) return _json_({ ok: false, error: "Missing action" });

    const result = _route_(action, data);
    return _json_({ ok: true, result });
  } catch (err) {
    return _json_({ ok: false, error: String(err.message || err) });
  }
}

// v6.1 2026-07-18 — Per-person ICS calendar feed (?ics=1&email=...&token=...)
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.ics) {
    try {
      const email = _normEmail_(p.email || "");
      if (!email || String(p.token || "") !== _icsToken_(email)) {
        return ContentService.createTextOutput("Invalid feed link.").setMimeType(ContentService.MimeType.TEXT);
      }
      return ContentService.createTextOutput(_buildIcs_(email)).setMimeType(ContentService.MimeType.ICAL);
    } catch (err) {
      return ContentService.createTextOutput("Feed error: " + String(err.message || err)).setMimeType(ContentService.MimeType.TEXT);
    }
  }
  return HtmlService.createHtmlOutput("Scheduler API Online.");
}

// ============================================================================
// ICS FEED HELPERS (v6.1 2026-07-18)
// ============================================================================

/** Stable per-person token: HMAC-SHA256(email, API_KEY), first 20 hex chars. */
function _icsToken_(email) {
  const sig = Utilities.computeHmacSha256Signature(_normEmail_(email), API_KEY);
  return sig.map(b => ((b + 256) % 256).toString(16).padStart(2, "0")).join("").slice(0, 20);
}

function _icsUrlFor_(email) {
  const base = ScriptApp.getService().getUrl();
  return base + "?ics=1&email=" + encodeURIComponent(_normEmail_(email)) + "&token=" + _icsToken_(email);
}

function _icsEscape_(s) {
  return String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function _icsDate_(isoStr) {
  return Utilities.formatDate(new Date(isoStr), "UTC", "yyyyMMdd'T'HHmmss'Z'");
}

/** Builds an ICS calendar of one person's shifts (last 30 days + all future). */
function _buildIcs_(email) {
  const cutoff = new Date(Date.now() - 30 * 86400000);
  const shifts = _getShiftsCached_().filter(s =>
    _normEmail_(s.staffEmail) === email &&
    !_asBool_(s.isOpen) &&
    s.startISO && s.endISO &&
    new Date(s.endISO) > cutoff
  );
  const now = _icsDate_(new Date().toISOString());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Sturgeon Spirits//Scheduler//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:" + _icsEscape_("Sturgeon Spirits — My Shifts"),
    "X-WR-TIMEZONE:" + TZ_CENTRAL
  ];
  shifts.forEach(s => {
    lines.push("BEGIN:VEVENT");
    lines.push("UID:" + _icsEscape_(s.eventId || (s.startISO + email)) + "@sturgeon-scheduler");
    lines.push("DTSTAMP:" + now);
    lines.push("DTSTART:" + _icsDate_(s.startISO));
    lines.push("DTEND:" + _icsDate_(s.endISO));
    lines.push("SUMMARY:" + _icsEscape_(s.task || "Shift"));
    if (s.location) lines.push("LOCATION:" + _icsEscape_(s.location));
    if (s.notes) lines.push("DESCRIPTION:" + _icsEscape_(s.notes));
    lines.push("URL:" + SITE_URL);
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

/** Returns the signed-in user's personal feed URL (v6.1 2026-07-18). */
function api_getIcsUrl(data) {
  const me = _requireSession_(data.sessionToken);
  return { url: _icsUrlFor_(me.email) };
}

/** Manager utility: run from the Apps Script editor to log every staff feed URL. */
function printAllIcsUrls() {
  _staffIndex_().forEach(s => Logger.log(s.name + " <" + s.email + ">: " + _icsUrlFor_(s.email)));
}

// ============================================================================
// 2. SETUP & TRIGGERS
// ============================================================================

function onOpen() {
  SpreadsheetApp.getUi().createMenu("Scheduler")
    .addItem("Install Triggers", "installTriggers")
    .addItem("Setup Sheets", "setupSheets")
    .addItem("Backfill Central Time", "backfillCentralTime")
    .addToUi();
}

function installTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("sendShiftReminders").timeBased().everyHours(1).create();
  // v6.4 2026-07-18 — unfinished shift tasks roll to the person's next shift
  ScriptApp.newTrigger("rollUnfinishedShiftTasks").timeBased().everyHours(1).create();
  // v6.4.1 2026-07-19 — works from both the Sheet menu and the script editor
  const msg = "Triggers installed (Hourly Reminders + Task Rollover).";
  try { SpreadsheetApp.getUi().alert(msg); } catch (_) { Logger.log(msg); }
}

function setupSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  _ensureSheet_(ss, SHEET_STAFF, ["email", "name", "isManager", "remindOptIn", "remind24h", "remind2h"]);
  _ensureSheet_(ss, SHEET_SHIFTS, ["eventId", "sourceId", "seriesId", "seriesIndex", "isSeries", "isOpen", "isOpenEnded", "staffEmail", "staffName", "task", "location", "startISO", "endISO", "startCT", "endCT", "notes", "createdBy", "createdAtISO", "updatedAtISO"]);
  _ensureSheet_(ss, SHEET_LOGIN_CODES, ["token", "email", "expiresAtISO", "usedAtISO"]);
  _ensureSheet_(ss, SHEET_SESS, ["sessionToken", "email", "createdAtISO", "expiresAtISO", "lastSeenAtISO"]);
  _ensureSheet_(ss, SHEET_SWAP, ["id", "eventId", "task", "startISO", "endISO", "isOpenEnded", "startCT", "endCT", "fromEmail", "fromName", "toEmail", "message", "status", "acceptedAtISO", "approvedBy", "approvedAtISO", "createdAtISO"]);
  _ensureSheet_(ss, SHEET_AVAIL, ["id", "staffEmail", "staffName", "startISO", "endISO", "startCT", "endCT", "reason", "createdAtISO"]);
  _ensureSheet_(ss, SHEET_REMIND_LOG, ["id", "eventId", "kind", "sentTo", "sentAtISO"]);
  _ensureSheet_(ss, SHEET_BULLETIN, ["id", "message", "updatedBy", "updatedAtISO"]);
  _ensureSheet_(ss, SHEET_NOTES, ["date", "note"]);
  // v6.0 2026-07-18 — Todos gains date/shiftId/assignedTo/proofValue/templateId; TaskTemplates added
  _ensureSheet_(ss, SHEET_TODOS, ["id", "text", "category", "done", "addedBy", "addedAt", "doneBy", "doneAt", "date", "shiftId", "assignedTo", "proofValue", "templateId", "priority", "time"]); // v6.7 2026-07-23 — optional due time
  _ensureSheet_(ss, SHEET_TEMPLATES, ["id", "text", "category", "recurrence", "targetDuty", "requireProof", "active", "priority"]);
  _invalidateAllCaches_();
  SpreadsheetApp.getUi().alert("Sheets initialized (with Central Time + Task columns).");
}

/**
 * One-time utility: backfills startCT and endCT for all existing rows
 * in Shifts, SwapRequests, and Availability sheets.
 * Run from the Scheduler menu after adding the new columns.
 */
function backfillCentralTime() {
  const sheetsToFill = [
    { name: SHEET_SHIFTS, startCol: "startISO", endCol: "endISO", startCTCol: "startCT", endCTCol: "endCT" },
    { name: SHEET_SWAP, startCol: "startISO", endCol: "endISO", startCTCol: "startCT", endCTCol: "endCT" },
    { name: SHEET_AVAIL, startCol: "startISO", endCol: "endISO", startCTCol: "startCT", endCTCol: "endCT" }
  ];

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let totalFilled = 0;

  for (const cfg of sheetsToFill) {
    const sh = ss.getSheetByName(cfg.name);
    if (!sh || sh.getLastRow() < 2) continue;

    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(x => String(x).trim());
    const startIdx = headers.indexOf(cfg.startCol);
    const endIdx = headers.indexOf(cfg.endCol);
    const startCTIdx = headers.indexOf(cfg.startCTCol);
    const endCTIdx = headers.indexOf(cfg.endCTCol);

    if (startCTIdx < 0 || endCTIdx < 0) continue;

    const numRows = sh.getLastRow() - 1;
    if (numRows < 1) continue;

    const data = sh.getRange(2, 1, numRows, sh.getLastColumn()).getValues();

    for (let i = 0; i < data.length; i++) {
      const startISO = String(data[i][startIdx] || "").trim();
      const endISO = String(data[i][endIdx] || "").trim();
      const existingStartCT = String(data[i][startCTIdx] || "").trim();
      const existingEndCT = String(data[i][endCTIdx] || "").trim();

      if (startISO && !existingStartCT) {
        sh.getRange(i + 2, startCTIdx + 1).setValue(_fmtCentral_(startISO));
        totalFilled++;
      }
      if (endISO && !existingEndCT) {
        sh.getRange(i + 2, endCTIdx + 1).setValue(_fmtCentral_(endISO));
        totalFilled++;
      }
    }
  }

  SpreadsheetApp.getUi().alert("Backfill complete: " + totalFilled + " cells filled with Central Time values.");
}

// ============================================================================
// 3. ROUTER
// ============================================================================

function _route_(action, data) {
  switch (action) {
    case "auth_requestLink": return api_auth_requestLink(data);
    case "auth_verifyLink":  return api_auth_verifyLink(data);
    case "dashSchedule":  return api_dashboardSchedule(data);
    case "dashOpen":      return api_dashboardOpen(data);
    case "dashRequests":  return api_dashboardRequests(data);
    case "dashAdmin":     return api_dashboardAdmin(data);
    case "bootstrap":        return api_bootstrap(data);
    case "listWeek":         return api_listWeek(data);
    case "listMonth":        return api_listMonth(data);
    case "listOpenShifts":   return api_listOpenShifts(data);
    case "getBulletin":      return api_getBulletin(data);
    case "createShift":      return api_createShift(data);
    case "updateShift":      return api_updateShift(data);
    case "deleteShift":      return api_deleteShift(data);
    case "createOpenShift":  return api_createOpenShift(data);
    case "claimOpenShift":   return api_claimOpenShift(data);
    case "requestSwap":      return api_requestSwap(data);
    case "listMySwaps":      return api_listMySwaps(data);
    case "listSwaps":        return api_listSwaps(data);
    case "acceptSwap":       return api_acceptSwap(data);
    case "approveSwap":      return api_approveSwap(data);
    case "setReminderPrefs": return api_setReminderPrefs(data);
    case "getIcsUrl":        return api_getIcsUrl(data); // v6.1 2026-07-18
    case "addUnavailability":     return api_addUnavailability(data);
    case "listMyUnavailability":  return api_listMyUnavailability(data);
    case "listAllUnavailability": return api_listAllUnavailability(data);
    case "deleteUnavailability":  return api_deleteUnavailability(data);
    case "weekChart":        return api_weekChart(data);
    case "weekSummary":      return api_weekSummary(data);
    case "monthSummary":     return api_monthSummary(data);
    case "copyWeekToNext":   return api_copyWeekToNext(data);
    case "copyWeek":         return api_copyWeek(data);
    case "weekShiftCount":   return api_weekShiftCount(data);
    case "setBulletin":      return api_setBulletin(data);
    case "saveNote":         return api_saveNote(data);
    case "deleteNote":       return api_deleteNote(data);
    // v5.5 2026-05-26 — Staff To-Do List; v6.0 2026-07-18 — task assignment + templates
    case "listTodos":        return api_listTodos(data);
    case "saveTodo":         return api_saveTodo(data);
    case "updateTodo":       return api_updateTodo(data);
    case "toggleTodo":       return api_toggleTodo(data);
    case "deleteTodo":       return api_deleteTodo(data);
    case "clearDoneTodos":   return api_clearDoneTodos(data);
    case "listTemplates":    return api_listTemplates(data);
    case "saveTemplate":     return api_saveTemplate(data);
    case "deleteTemplate":   return api_deleteTemplate(data);
    default: throw new Error("Unknown action: " + action);
  }
}

// ============================================================================
// 3b. COMPOSITE DASHBOARD ENDPOINTS (single call per view)
// ============================================================================

function api_dashboardSchedule(data) {
  const me = _requireSession_(data.sessionToken);
  const mode = data.mode || "week";

  // Fetch shifts (week or month)
  let schedResult;
  if (mode === "week") {
    const start = new Date(data.weekStartISO);
    const end = new Date(start.getTime() + 7 * 86400000);
    const shifts = _getShiftsCached_()
      .filter(r => { const d = new Date(r.startISO); return d >= start && d < end; })
      .map(r => _cleanShift_(r, me.isManager));
    const dailyNotes = _getDailyNotes_(start, end);
    const unavails = me.isManager ? _unavailAsSchedItems_(start, end) : [];
    const combined = [...shifts, ...dailyNotes, ...unavails].sort((a, b) => new Date(a.startISO) - new Date(b.startISO));
    schedResult = { shifts: combined };
  } else {
    const m = new Date(data.monthISO);
    const start = new Date(m.getFullYear(), m.getMonth(), 1);
    const end = new Date(m.getFullYear(), m.getMonth() + 1, 1);
    const shifts = _getShiftsCached_()
      .filter(r => { const d = new Date(r.startISO); return d >= start && d < end; })
      .map(r => _cleanShift_(r, me.isManager));
    const dailyNotes = _getDailyNotes_(start, end);
    const unavails = me.isManager ? _unavailAsSchedItems_(start, end) : [];
    const combined = [...shifts, ...dailyNotes, ...unavails].sort((a, b) => new Date(a.startISO) - new Date(b.startISO));
    const buckets = {};
    combined.forEach(s => {
      const k = Utilities.formatDate(new Date(s.startISO), TZ_CENTRAL, "yyyy-MM-dd");
      if (!buckets[k]) buckets[k] = [];
      buckets[k].push(s);
    });
    schedResult = { shifts: combined, buckets };
  }

  // Bulletin (last row only)
  const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_BULLETIN);
  let bulletin = { message: "", updatedBy: "" };
  if (sh && sh.getLastRow() >= 2) {
    const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(x => String(x).trim());
    const vals = sh.getRange(sh.getLastRow(), 1, 1, h.length).getValues()[0];
    const row = {}; h.forEach((k, i) => row[k] = vals[i]);
    bulletin = { message: row.message || "", updatedBy: row.updatedBy || "" };
  }

  // Swaps (v6.2 2026-07-18 — past swaps auto-hidden)
  const swapItems = _visibleSwaps_(me);

  return { shifts: schedResult.shifts, buckets: schedResult.buckets || null, bulletin, swaps: swapItems };
}

// v6.2 2026-07-18 — shared swap visibility: role/ownership filter + hide swaps
// whose shift has already ended (untimed swaps are kept).
function _swapIsPast_(r) {
  const ref = r.endISO || r.startISO;
  return !!ref && new Date(ref) < new Date();
}
function _visibleSwaps_(me) {
  const rows = _readAll_(SHEET_SWAP).filter(r => !_swapIsPast_(r));
  if (me.isManager) return rows;
  return rows.filter(r =>
    _normEmail_(r.fromEmail) === me.email ||
    _normEmail_(r.toEmail) === me.email ||
    (r.toEmail === '__anyone__' && r.status === 'REQUESTED')
  );
}

function api_dashboardOpen(data) {
  const me = _requireSession_(data.sessionToken);
  const from = new Date(data.fromISO || new Date());

  const openShifts = _getShiftsCached_()
    .filter(r => _asBool_(r.isOpen) && new Date(r.startISO) >= from)
    .map(r => _cleanShift_(r, me.isManager))
    .sort((a, b) => new Date(a.startISO) - new Date(b.startISO));

  const swapItems = _visibleSwaps_(me); // v6.2 2026-07-18 — past swaps auto-hidden

  return { openShifts: openShifts, swaps: swapItems };
}

function api_dashboardRequests(data) {
  const me = _requireSession_(data.sessionToken);

  // Swaps (v6.2 2026-07-18 — past swaps auto-hidden)
  const swapItems = _visibleSwaps_(me);

  // Two months of shifts
  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 1);
  const allShifts = _getShiftsCached_()
    .filter(r => { const d = new Date(r.startISO); return d >= thisMonth && d < nextMonthEnd; })
    .map(r => _cleanShift_(r, me.isManager));

  // Build buckets for both months
  const curMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const curBuckets = {};
  const nextBuckets = {};
  allShifts.forEach(s => {
    const d = new Date(s.startISO);
    const k = Utilities.formatDate(d, TZ_CENTRAL, "yyyy-MM-dd");
    if (d < curMonthEnd) { if (!curBuckets[k]) curBuckets[k] = []; curBuckets[k].push(s); }
    else { if (!nextBuckets[k]) nextBuckets[k] = []; nextBuckets[k].push(s); }
  });

  // Unavailability (v6.2 2026-07-18 — hide as soon as it ends, was 7-day grace)
  const cutoff = now;
  const uaItems = _readAll_(SHEET_AVAIL)
    .filter(r => _normEmail_(r.staffEmail) === me.email && new Date(r.endISO) > cutoff)
    .sort((a, b) => new Date(a.startISO) - new Date(b.startISO));

  return {
    swaps: swapItems,
    curMonth: { buckets: curBuckets, shifts: allShifts.filter(s => new Date(s.startISO) < curMonthEnd) },
    nextMonth: { buckets: nextBuckets, shifts: allShifts.filter(s => new Date(s.startISO) >= curMonthEnd) },
    unavail: uaItems
  };
}

function api_dashboardAdmin(data) {
  const me = _requireSession_(data.sessionToken);
  if (!me.isManager) throw new Error("Managers only");

  // Bulletin
  const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_BULLETIN);
  let bulletin = { message: "", updatedBy: "" };
  if (sh && sh.getLastRow() >= 2) {
    const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(x => String(x).trim());
    const vals = sh.getRange(sh.getLastRow(), 1, 1, h.length).getValues()[0];
    const row = {}; h.forEach((k, i) => row[k] = vals[i]);
    bulletin = { message: row.message || "", updatedBy: row.updatedBy || "" };
  }

  // All unavailability
  const cutoff = new Date(new Date().getTime() - 24 * 60 * 60 * 1000);
  const uaItems = _readAll_(SHEET_AVAIL)
    .filter(r => new Date(r.endISO) > cutoff)
    .sort((a, b) => new Date(a.startISO) - new Date(b.startISO));

  return { bulletin, unavail: uaItems };
}

/** Shared helper for daily notes */
function _getDailyNotes_(start, end) {
  return _readAll_(SHEET_NOTES)
    .filter(r => r.date && String(r.note).trim() !== "")
    .filter(r => { const d = new Date(r.date); return d >= start && d < end; })
    .map(r => {
      const d = new Date(r.date);
      d.setHours(0, 0, 0, 0);
      return {
        eventId: "NOTE_" + r.date, task: String(r.note).trim(), location: "",
        startISO: d.toISOString(), endISO: d.toISOString(),
        staffEmail: "", staffName: "--- Special Event ---", notes: "",
        isOpen: false, isSeries: false, openShiftId: ""
      };
    });
}

// Admin-only: surface unavailability blocks as pseudo-shift items on the
// schedule so managers can see staff conflicts alongside assigned shifts.
// Multi-day blocks are split into one item per calendar day so they appear
// under every day they span — not just the start day. Each segment carries
// the portion of the block that falls within that day so the frontend can
// render an accurate "from/until/all day" label without re-doing the math.
function _unavailAsSchedItems_(start, end) {
  const items = [];
  const avails = _getAvailCached_().filter(r => {
    const s = new Date(r.startISO);
    const e = new Date(r.endISO);
    return e > start && s < end; // any overlap with the viewport
  });

  for (const r of avails) {
    const uStart = new Date(r.startISO);
    const uEnd = new Date(r.endISO);
    const reason = String(r.reason || "").trim();
    const name = r.staffName || r.staffEmail || "Someone";

    // Walk each calendar day the block touches, clipped to the viewport so
    // we don't emit items outside the week/month being rendered.
    let dayCursor = new Date(uStart);
    dayCursor.setHours(0, 0, 0, 0);

    while (dayCursor < uEnd && dayCursor < end) {
      const dayStart = new Date(dayCursor);
      const nextDay = new Date(dayCursor.getTime() + 86400000);

      // Only emit segments that fall inside the viewport.
      if (nextDay > start) {
        const segStart = uStart > dayStart ? uStart : dayStart;
        const segEnd = uEnd < nextDay ? uEnd : nextDay;
        const isFullDay = segStart.getTime() === dayStart.getTime()
          && segEnd.getTime() === nextDay.getTime();

        items.push({
          eventId: "UNAVAIL_" + r.id + "_" + dayCursor.getTime(),
          task: reason ? ("Unavailable — " + reason) : "Unavailable",
          location: "",
          // startISO is clamped to this day so the frontend's day-bucketing
          // filter places the segment on the right day.
          startISO: segStart.toISOString(),
          endISO: segEnd.toISOString(),
          staffEmail: r.staffEmail || "",
          staffName: name,
          notes: "",
          isOpen: false,
          isSeries: false,
          isUnavail: true,
          isFullDay: isFullDay,
          unavailId: r.id,
          reason: reason,
          openShiftId: ""
        });
      }

      dayCursor = nextDay;
    }
  }

  return items;
}

// ============================================================================
// 4. AUTHENTICATION (6-DIGIT PIN) & NOTIFICATIONS
// ============================================================================

function api_auth_requestLink(data) {
  const email = _normEmail_(data.email);
  if (!email) throw new Error("Missing email");

  const staff = _staffIndex_();
  if (!staff.find(s => s.email === email)) throw new Error("Email not recognized in Staff sheet.");

  const token = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = new Date(Date.now() + 15 * 60000);
  _appendRow_(SHEET_LOGIN_CODES, { token, email, expiresAtISO: expires.toISOString(), usedAtISO: "" });

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:30px 20px;text-align:center;border:1px solid #eee;border-radius:12px;">
      <h2 style="color:${BRAND.colors.primary};margin:0 0 10px 0;">${BRAND.name}</h2>
      <p style="font-size:16px;color:#444;margin-bottom:24px;">Your secure login code is:</p>
      <div style="font-size:42px;font-weight:800;letter-spacing:6px;color:${BRAND.colors.accent};margin-bottom:24px;">${token}</div>
      <p style="font-size:14px;color:#666;margin-top:10px;">
        Return to the app and enter this code to sign in.<br>
        It expires in 15 minutes.
      </p>
    </div>
  `;

  MailApp.sendEmail({ to: email, subject: "Login Code: " + token, htmlBody: html, name: EMAIL_SETTINGS.fromName, replyTo: EMAIL_SETTINGS.replyTo });
  return { sent: true };
}

function api_auth_verifyLink(data) {
  const token = String(data.token || "").trim();
  const rows = _readAll_(SHEET_LOGIN_CODES);

  const row = rows.find(r => String(r.token).trim() === token);
  if (!row || row.usedAtISO || new Date(row.expiresAtISO) < new Date()) throw new Error("Code expired or invalid.");

  _updateWhere_(SHEET_LOGIN_CODES, "token", token, { usedAtISO: new Date().toISOString() });

  const sessionToken = _randToken_();
  const expires = new Date(Date.now() + 30 * 24 * 3600000);
  _appendRow_(SHEET_SESS, { sessionToken, email: _normEmail_(row.email), createdAtISO: new Date().toISOString(), expiresAtISO: expires.toISOString(), lastSeenAtISO: new Date().toISOString() });

  return { sessionToken };
}

function _requireSession_(token) {
  if (!token) throw new Error("Not signed in");
  const cache = CacheService.getScriptCache();
  const cached = cache.get("sess_" + token);
  if (cached) return JSON.parse(cached);

  const rows = _readAll_(SHEET_SESS);
  const row = rows.find(r => r.sessionToken === token);
  if (!row || new Date(row.expiresAtISO) < new Date()) throw new Error("Session expired");

  const email = _normEmail_(row.email);
  const staff = _staffIndex_().find(s => s.email === email);
  if (!staff) throw new Error("Account revoked");

  const me = { email, name: staff.name, isManager: !!staff.isManager, remindOptIn: !!staff.remindOptIn, remind24h: staff.remind24h !== false, remind2h: staff.remind2h !== false };

  if (!cache.get("seen_" + token)) {
    cache.put("seen_" + token, "1", 1800);
    try { _updateWhere_(SHEET_SESS, "sessionToken", token, { lastSeenAtISO: new Date().toISOString() }); } catch (_) {}
  }

  cache.put("sess_" + token, JSON.stringify(me), SESSION_CACHE_SEC);
  return me;
}

function api_bootstrap(data) {
  const me = _requireSession_(data.sessionToken);
  return { me, brand: BRAND, tasks: TASKS, locations: LOCATIONS, staff: _staffIndex_().map(s => ({ email: s.email, name: s.name, isManager: s.isManager })) };
}

function _fmtShiftForEmail_(shift) {
  const start = new Date(shift.startISO);
  const end = new Date(shift.endISO);
  const dateStr = Utilities.formatDate(start, TZ_CENTRAL, "EEE, MMM d");
  const endLabel = _asBool_(shift.isOpenEnded)
    ? "Until needed"
    : Utilities.formatDate(end, TZ_CENTRAL, "h:mm a");
  const timeStr = Utilities.formatDate(start, TZ_CENTRAL, "h:mm a") + " – " + endLabel;
  const locStr = shift.location ? " • " + shift.location : "";
  return { dateStr, timeStr, locStr };
}

function _sendShiftEmail_(to, subject, html) {
  if (!to) return;
  try { MailApp.sendEmail({ to, subject, htmlBody: html, name: EMAIL_SETTINGS.fromName, replyTo: EMAIL_SETTINGS.replyTo }); } catch (e) {}
}

function _emailShiftChanged_(opts) {
  const { toEmail, toName, action, shift, changedByName } = opts;
  const f = _fmtShiftForEmail_(shift);
  const title = shift.task + " — " + f.dateStr;
  const details = f.timeStr + f.locStr;

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:18px;border:1px solid #eee;border-radius:12px;">
      <div style="font-weight:800;font-size:16px;color:${BRAND.colors.primary};margin-bottom:8px;">${BRAND.name}</div>
      <div style="font-size:15px;font-weight:800;margin-bottom:6px;">${action}: ${title}</div>
      <div style="font-size:14px;color:#444;margin-bottom:10px;">${details}</div>
      <div style="font-size:13px;color:#666;margin-bottom:14px;">
        Employee: <b>${toName || toEmail}</b><br>
        Changed by: ${changedByName || "Manager"}
      </div>
      <a href="${SITE_URL}" style="display:inline-block;background:${BRAND.colors.accent};color:#fff;text-decoration:none;padding:10px 14px;border-radius:999px;font-weight:800;font-size:13px;">
        Open Scheduler
      </a>
    </div>
  `;

  _sendShiftEmail_(toEmail, EMAIL_SETTINGS.staffNotifySubjectPrefix + " " + action, html);
}

// ============================================================================
// 5. READ APIs
// ============================================================================

function api_listWeek(data) {
  const me = _requireSession_(data.sessionToken);
  const start = new Date(data.weekStartISO);
  const end = new Date(start.getTime() + 7 * 86400000);

  const shifts = _getShiftsCached_()
    .filter(r => { const d = new Date(r.startISO); return d >= start && d < end; })
    .map(r => _cleanShift_(r, me.isManager));

  const dailyNotes = _readAll_(SHEET_NOTES)
    .filter(r => r.date && String(r.note).trim() !== "")
    .filter(r => { const d = new Date(r.date); return d >= start && d < end; })
    .map(r => {
      const d = new Date(r.date);
      d.setHours(0, 0, 0, 0);
      return {
        eventId: "NOTE_" + r.date, task: String(r.note).trim(), location: "",
        startISO: d.toISOString(), endISO: d.toISOString(),
        staffEmail: "", staffName: "--- Special Event ---", notes: "",
        isOpen: false, isSeries: false, openShiftId: ""
      };
    });

  const combined = [...shifts, ...dailyNotes].sort((a, b) => new Date(a.startISO) - new Date(b.startISO));
  return { shifts: combined };
}

function api_listMonth(data) {
  const me = _requireSession_(data.sessionToken);
  const m = new Date(data.monthISO);
  const start = new Date(m.getFullYear(), m.getMonth(), 1);
  const end = new Date(m.getFullYear(), m.getMonth() + 1, 1);

  const shifts = _getShiftsCached_()
    .filter(r => { const d = new Date(r.startISO); return d >= start && d < end; })
    .map(r => _cleanShift_(r, me.isManager));

  const dailyNotes = _readAll_(SHEET_NOTES)
    .filter(r => r.date && String(r.note).trim() !== "")
    .filter(r => { const d = new Date(r.date); return d >= start && d < end; })
    .map(r => {
      const d = new Date(r.date);
      d.setHours(0, 0, 0, 0);
      return {
        eventId: "NOTE_" + r.date, task: String(r.note).trim(), location: "",
        startISO: d.toISOString(), endISO: d.toISOString(),
        staffEmail: "", staffName: "--- Special Event ---", notes: "",
        isOpen: false, isSeries: false, openShiftId: ""
      };
    });

  const combined = [...shifts, ...dailyNotes].sort((a, b) => new Date(a.startISO) - new Date(b.startISO));

  const buckets = {};
  combined.forEach(s => {
    const k = Utilities.formatDate(new Date(s.startISO), TZ_CENTRAL, "yyyy-MM-dd");
    if (!buckets[k]) buckets[k] = [];
    buckets[k].push(s);
  });

  return { buckets, shifts: combined };
}

function api_listOpenShifts(data) {
  const me = _requireSession_(data.sessionToken);
  const from = new Date(data.fromISO || new Date());

  const items = _getShiftsCached_()
    .filter(r => _asBool_(r.isOpen) && new Date(r.startISO) >= from)
    .map(r => _cleanShift_(r, me.isManager))
    .sort((a, b) => new Date(a.startISO) - new Date(b.startISO));

  return { items };
}

function api_getBulletin(data) {
  _requireSession_(data.sessionToken);
  const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_BULLETIN);
  if (!sh || sh.getLastRow() < 2) return { message: "", updatedBy: "" };
  const lastRow = sh.getLastRow();
  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(x => String(x).trim());
  const vals = sh.getRange(lastRow, 1, 1, h.length).getValues()[0];
  const row = {};
  h.forEach((k, i) => row[k] = vals[i]);
  return { message: row.message || "", updatedBy: row.updatedBy || "" };
}

// ============================================================================
// 6. SHIFT & NOTE CRUD
// ============================================================================

function api_createShift(data) {
  const me = _requireSession_(data.sessionToken);
  if (!me.isManager) throw new Error("Managers only");
  _ensureShiftsSchema_();

  const startBase = new Date(data.startISO);
  const endBase = new Date(data.endISO);

  const repeat = data.repeat && data.repeat.enabled ? Math.max(1, parseInt(data.repeat.weeks, 10) || 1) : 1;
  // v5.6 2026-06-08 — biweekly support: interval=1 → weekly, interval=2 → biweekly
  const intervalWeeks = (data.repeat && data.repeat.interval) ? Math.max(1, parseInt(data.repeat.interval, 10) || 1) : 1;
  const seriesId = repeat > 1 ? _uuid_() : "";

  const isOpen = !!data.isOpen || _normEmail_(data.staffEmail) === "__open__";
  const isOpenEnded = !!data.isOpenEnded;
  const staffList = _staffIndex_();
  const staffEmail = isOpen ? "" : _normEmail_(data.staffEmail);
  const staffName  = isOpen ? "" : (staffList.find(st => st.email === staffEmail)?.name || staffEmail);

  // PHASE 1: Pre-validate all occurrences before creating anything.
  // This prevents orphaned Google Calendar events if a later occurrence has a conflict.
  const dates = [];
  for (let i = 0; i < repeat; i++) {
    const s = new Date(startBase.getTime() + i * intervalWeeks * 604800000);
    const e = new Date(endBase.getTime()   + i * intervalWeeks * 604800000);
    if (!isOpen) {
      try {
        _assertNoHardConflicts_(staffEmail, s, e);
      } catch (conflictErr) {
        const msg = String(conflictErr.message || conflictErr);
        const weekSuffix = repeat > 1 ? "|week|" + (i + 1) + "|" + repeat : "";
        throw new Error(msg + weekSuffix);
      }
    }
    dates.push({ s, e });
  }

  // PHASE 2: All occurrences are clear — now create calendar events and sheet rows.
  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  const newRows = [];

  for (let i = 0; i < repeat; i++) {
    const { s, e } = dates[i];

    const suffix = isOpenEnded ? " (Until needed)" : "";
    const title = (isOpen ? data.task + " — OPEN" : data.task + " — " + staffName) + suffix;
    const desc  = (isOpen
      ? "OPEN SHIFT\nTask: " + data.task + "\nLocation: " + (data.location || "")
      : "Task: " + data.task + "\nNotes: " + (data.notes || ""))
      + (isOpenEnded ? "\nEnd: Until needed (no set end time)" : "");

    const ev = cal.createEvent(title, s, e, { location: data.location || "", description: desc });

    const row = {
      eventId: ev.getId(),
      seriesId,
      seriesIndex: i + 1,
      isSeries: repeat > 1,
      isOpen: isOpen,
      isOpenEnded: isOpenEnded,
      staffEmail,
      staffName,
      task: data.task,
      location: data.location,
      startISO: s.toISOString(),
      endISO: e.toISOString(),
      startCT: _fmtCentral_(s.toISOString()),
      endCT: _fmtCentral_(e.toISOString()),
      notes: data.notes || "",
      createdBy: me.email,
      createdAtISO: new Date().toISOString(),
      updatedAtISO: ""
    };

    newRows.push(row);

    if (!isOpen && staffEmail) {
      _emailShiftChanged_({ toEmail: staffEmail, toName: staffName, action: "New Shift Assigned", shift: row, changedByName: me.name || me.email });
    }
  }

  _appendRows_(SHEET_SHIFTS, newRows);
  _invalidateShiftsCache_();
  return { createdCount: repeat };
}

function api_updateShift(data) {
  const me = _requireSession_(data.sessionToken);
  if (!me.isManager) throw new Error("Managers only");
  _ensureShiftsSchema_();

  const { eventId, staffEmail, task, location, startISO, endISO, notes } = data;
  const isOpenEnded = !!data.isOpenEnded;

  const current = _getShiftsCached_().find(s => String(s.eventId) === String(eventId));
  const prevEmail = current ? _normEmail_(current.staffEmail) : "";
  const prevName = current ? (current.staffName || prevEmail) : "";

  const newEmail = _normEmail_(staffEmail);
  const isNowOpen = (newEmail === "" || newEmail === "__open__");
  const newName = isNowOpen ? "" : (_staffIndex_().find(st => st.email === newEmail)?.name || newEmail);

  if (!isNowOpen) {
    _assertNoHardConflicts_(newEmail, new Date(startISO), new Date(endISO), eventId);
  }

  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  const ev = cal.getEventById(eventId);
  if (ev) {
    const suffix = isOpenEnded ? " (Until needed)" : "";
    const title = (isNowOpen ? task + " — OPEN" : task + " — " + newName) + suffix;
    ev.setTitle(title);
    ev.setTime(new Date(startISO), new Date(endISO));
    ev.setLocation(location || "");
    const desc = (isNowOpen
      ? "OPEN SHIFT\nTask: " + task + "\nLocation: " + (location || "")
      : "Task: " + task + "\nNotes: " + (notes || ""))
      + (isOpenEnded ? "\nEnd: Until needed (no set end time)" : "");
    ev.setDescription(desc);
  }

  // v5.7 — 2026-06-30 — verify the sheet row was actually found/written;
  // previously this returned {updated:true} unconditionally even if eventId
  // didn't match any row, so the UI showed "Shift Updated!" with no change.
  const matched = _updateWhere_(SHEET_SHIFTS, "eventId", eventId, {
    isOpen: isNowOpen,
    isOpenEnded: isOpenEnded,
    staffEmail: isNowOpen ? "" : newEmail,
    staffName: isNowOpen ? "" : newName,
    task,
    location,
    startISO,
    endISO,
    startCT: _fmtCentral_(startISO),
    endCT: _fmtCentral_(endISO),
    notes,
    updatedAtISO: new Date().toISOString()
  });

  _invalidateShiftsCache_();

  if (!matched) {
    throw new Error("Shift not found (eventId " + eventId + " has no matching row in the sheet — it may have been deleted, or your view is stale. Refresh and try again).");
  }

  // v5.8 — 2026-06-30 — a direct manager edit (e.g. reassigning the shift to
  // someone else) supersedes any in-flight swap request on it. Previously the
  // SwapRequests row was left as REQUESTED/ACCEPTED, so the schedule kept
  // showing "Swap Requested" even after the shift had already been reassigned
  // outside the swap workflow. Cancel those stale swap rows here.
  if (prevEmail !== newEmail || isNowOpen) {
    _cancelPendingSwapsForEvent_(eventId, "shift reassigned directly by " + (me.name || me.email));
  }

  const afterShift = { eventId, staffEmail: newEmail, staffName: newName, task, location, startISO, endISO, isOpenEnded };

  if (!isNowOpen && newEmail) {
    _emailShiftChanged_({ toEmail: newEmail, toName: newName, action: "Shift Updated", shift: afterShift, changedByName: me.name || me.email });
  }

  if (prevEmail && prevEmail !== newEmail && !_asBool_(current?.isOpen)) {
    const beforeShift = {
      eventId,
      staffEmail: prevEmail, staffName: prevName,
      task: current?.task || task, location: current?.location || location,
      startISO: current?.startISO || startISO, endISO: current?.endISO || endISO,
      isOpenEnded: _asBool_(current?.isOpenEnded)
    };
    _emailShiftChanged_({ toEmail: prevEmail, toName: prevName, action: "Shift Reassigned", shift: beforeShift, changedByName: me.name || me.email });
  }

  return { updated: true };
}

function api_deleteShift(data) {
  const me = _requireSession_(data.sessionToken);
  if (!me.isManager) throw new Error("Managers only");

  const eventId = data.eventId;
  const current = _getShiftsCached_().find(s => String(s.eventId) === String(eventId));

  if (!current) throw new Error("Shift not found");

  const prevEmail = _normEmail_(current.staffEmail);
  const prevName = current.staffName || prevEmail;

  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  const ev = cal.getEventById(eventId);
  if (ev) {
    ev.deleteEvent();
  }

  _deleteWhere_(SHEET_SHIFTS, "eventId", eventId);
  _invalidateShiftsCache_();

  // v5.8 — 2026-06-30 — clear out any dangling pending swap request for a
  // shift that no longer exists.
  _cancelPendingSwapsForEvent_(eventId, "shift deleted by " + (me.name || me.email));

  // v6.0 — 2026-07-18 — shift tasks fall back to day tasks (keep date +
  // assignee) instead of vanishing with the shift.
  _releaseTasksForShift_(eventId);

  if (prevEmail && !_asBool_(current.isOpen)) {
    _emailShiftChanged_({
      toEmail: prevEmail, toName: prevName, action: "Shift Canceled",
      shift: { task: current.task, location: current.location, startISO: current.startISO, endISO: current.endISO },
      changedByName: me.name || me.email
    });
  }

  return { deleted: true, status: "permanently_deleted" };
}

function api_createOpenShift(data) {
  const me = _requireSession_(data.sessionToken);
  if (!me.isManager) throw new Error("Managers only");
  _ensureShiftsSchema_();

  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  const ev = cal.createEvent(data.task + " — OPEN", new Date(data.startISO), new Date(data.endISO), {
    location: data.location || "", description: "OPEN SHIFT"
  });

  _appendRow_(SHEET_SHIFTS, {
    eventId: ev.getId(),
    isOpen: true,
    staffEmail: "",
    staffName: "",
    task: data.task,
    location: data.location,
    startISO: data.startISO,
    endISO: data.endISO,
    startCT: _fmtCentral_(data.startISO),
    endCT: _fmtCentral_(data.endISO),
    notes: data.notes || "",
    createdBy: me.email,
    createdAtISO: new Date().toISOString(),
    updatedAtISO: ""
  });

  _invalidateShiftsCache_();
  return { created: true };
}

function api_claimOpenShift(data) {
  const me = _requireSession_(data.sessionToken);
  _ensureShiftsSchema_();

  const shift = _getShiftsCached_().find(s => String(s.eventId) === String(data.eventId));
  if (!shift || !_asBool_(shift.isOpen)) throw new Error("Shift unavailable");

  _assertNoHardConflicts_(me.email, new Date(shift.startISO), new Date(shift.endISO));

  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  const ev = cal.getEventById(data.eventId);
  if (ev) {
    ev.setTitle(shift.task + " — " + me.name);
    ev.setDescription("Task: " + shift.task + "\nClaimed by: " + me.name + "\nLocation: " + (shift.location || ""));
    if (shift.location) ev.setLocation(shift.location);
  }

  // v5.7 — 2026-06-30 — same fix as api_updateShift: don't claim success if
  // the eventId didn't actually match a sheet row.
  const matched = _updateWhere_(SHEET_SHIFTS, "eventId", data.eventId, {
    isOpen: false,
    staffEmail: me.email,
    staffName: me.name,
    updatedAtISO: new Date().toISOString()
  });

  _invalidateShiftsCache_();

  if (!matched) {
    throw new Error("Shift not found (eventId " + data.eventId + " has no matching row — it may have been claimed or deleted already). Refresh and try again.");
  }

  _emailShiftChanged_({
    toEmail: me.email, toName: me.name, action: "Open Shift Claimed",
    shift: { task: shift.task, location: shift.location, startISO: shift.startISO, endISO: shift.endISO },
    changedByName: me.name || me.email
  });

  try {
    const f = _fmtShiftForEmail_(shift);
    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:18px;border:1px solid #eee;border-radius:12px;">
        <div style="font-weight:800;font-size:16px;color:${BRAND.colors.primary};margin-bottom:8px;">${BRAND.name}</div>
        <div style="font-size:15px;font-weight:800;margin-bottom:6px;">Open Shift Claimed</div>
        <div style="font-size:14px;color:#444;margin-bottom:10px;">
          <b>${me.name}</b> claimed <b>${shift.task}</b><br>
          ${f.dateStr} • ${f.timeStr}${f.locStr}
        </div>
        <a href="${SITE_URL}" style="display:inline-block;background:${BRAND.colors.accent};color:#fff;text-decoration:none;padding:10px 14px;border-radius:999px;font-weight:800;font-size:13px;">
          Open Scheduler
        </a>
      </div>
    `;
    _sendShiftEmail_(EMAIL_SETTINGS.managerEmail, EMAIL_SETTINGS.managerNotifySubjectPrefix + " Open Shift Claimed", html);
  } catch (_) {}

  return { claimed: true };
}

function api_saveNote(data) {
  const me = _requireSession_(data.sessionToken);
  if (!me.isManager) throw new Error("Managers only");

  const d = String(data.date).trim();
  const n = String(data.note).trim();

  const existing = _readAll_(SHEET_NOTES).find(r => r.date === d);
  if (existing) {
    _updateWhere_(SHEET_NOTES, "date", d, { note: n });
  } else {
    _appendRow_(SHEET_NOTES, { date: d, note: n });
  }
  return { saved: true };
}

function api_deleteNote(data) {
  const me = _requireSession_(data.sessionToken);
  if (!me.isManager) throw new Error("Managers only");
  _deleteWhere_(SHEET_NOTES, "date", String(data.date).trim());
  return { deleted: true };
}

// ============================================================================
// 7. SWAPS & UNAVAILABILITY
// ============================================================================

function api_requestSwap(data) {
  const me = _requireSession_(data.sessionToken);
  _ensureShiftsSchema_();

  const shift = _getShiftsCached_().find(s => String(s.eventId) === String(data.myShiftId));
  const task = shift ? shift.task : (data.task || "Shift");
  const startISO = shift ? shift.startISO : data.startISO;
  const endISO = shift ? shift.endISO : data.endISO;
  const isOpenEnded = shift ? _asBool_(shift.isOpenEnded) : !!data.isOpenEnded;

  const toEmail = data.toEmail === '__anyone__' ? '__anyone__' : _normEmail_(data.toEmail);

  _appendRow_(SHEET_SWAP, {
    id: _uuid_(),
    eventId: data.myShiftId,
    task: task,
    startISO: startISO,
    endISO: endISO,
    isOpenEnded: isOpenEnded,
    startCT: _fmtCentral_(startISO),
    endCT: _fmtCentral_(endISO),
    fromEmail: me.email,
    fromName: me.name,
    toEmail: toEmail,
    message: String(data.note || data.message || "").trim(),
    status: "REQUESTED",
    acceptedAtISO: "",
    approvedBy: "",
    approvedAtISO: "",
    createdAtISO: new Date().toISOString()
  });

  if (toEmail !== '__anyone__') {
    try {
      const f = _fmtCentral_(startISO);
      MailApp.sendEmail({
        to: toEmail,
        subject: EMAIL_SETTINGS.staffNotifySubjectPrefix + " Swap Request",
        htmlBody: me.name + " wants to swap shift: " + task + " on " + f
      });
    } catch (_) {}
  }

  return { requested: true };
}

function api_listMySwaps(data) {
  const me = _requireSession_(data.sessionToken);
  // v6.2 2026-07-18 — past swaps auto-hidden
  return { items: _visibleSwaps_(me) };
}

function api_listSwaps(data) {
  const me = _requireSession_(data.sessionToken);
  if (!me.isManager) throw new Error("Managers only");
  // v6.2 2026-07-18 — past swaps auto-hidden
  return { items: _readAll_(SHEET_SWAP).filter(r => !_swapIsPast_(r)) };
}

function api_acceptSwap(data) {
  const me = _requireSession_(data.sessionToken);
  _ensureShiftsSchema_();
  const swap = _readAll_(SHEET_SWAP).find(s => s.id === data.swapId);
  if (!swap) throw new Error("Invalid swap");

  const isAnyone = swap.toEmail === '__anyone__';

  if (!isAnyone && _normEmail_(swap.toEmail) !== me.email) throw new Error("Invalid swap target");
  if (isAnyone && _normEmail_(swap.fromEmail) === me.email) throw new Error("Cannot claim your own swap");

  const patch = { status: "ACCEPTED", acceptedAtISO: new Date().toISOString() };
  if (isAnyone) patch.toEmail = me.email;

  _updateWhere_(SHEET_SWAP, "id", data.swapId, patch);

  try {
    MailApp.sendEmail({
      to: EMAIL_SETTINGS.managerEmail,
      subject: EMAIL_SETTINGS.managerNotifySubjectPrefix + " Swap Accepted",
      htmlBody: "Swap " + swap.id + " accepted by " + me.name + ". Needs approval."
    });
  } catch (_) {}

  return { accepted: true };
}

function api_approveSwap(data) {
  const me = _requireSession_(data.sessionToken);
  if (!me.isManager) throw new Error("Managers only");
  _ensureShiftsSchema_();

  const swap = _readAll_(SHEET_SWAP).find(s => s.id === data.swapId);
  if (!swap) throw new Error("Swap not found");

  const shift = _getShiftsCached_().find(s => String(s.eventId) === String(swap.eventId));
  if (!shift) throw new Error("Shift lost");

  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  const ev = cal.getEventById(swap.eventId);

  const toEmail = _normEmail_(swap.toEmail);
  const toName = _staffIndex_().find(s => s.email === toEmail)?.name || toEmail;

  if (ev) {
    ev.setTitle(shift.task + " — " + toName);
    ev.setDescription("Swap Approved.\nOld: " + swap.fromEmail + "\nNew: " + swap.toEmail);
  }

  // v5.7 — 2026-06-30 — bail out loudly if the shift row wasn't actually
  // found/updated, instead of reporting {approved:true} on a no-op.
  const shiftMatched = _updateWhere_(SHEET_SHIFTS, "eventId", swap.eventId, { staffEmail: toEmail, staffName: toName, updatedAtISO: new Date().toISOString() });
  _updateWhere_(SHEET_SWAP, "id", data.swapId, { status: "APPROVED", approvedBy: me.email, approvedAtISO: new Date().toISOString() });
  _invalidateShiftsCache_();

  if (!shiftMatched) {
    throw new Error("Swap approved but shift row (eventId " + swap.eventId + ") was not found — reassignment did not take effect. Check the sheet.");
  }

  return { approved: true };
}

function api_addUnavailability(data) {
  const me = _requireSession_(data.sessionToken);
  const startBase = new Date(data.startISO);
  const endBase = new Date(data.endISO);
  const repeat = data.repeat && data.repeat.enabled ? Math.max(1, parseInt(data.repeat.weeks, 10) || 1) : 1;

  const newRows = [];
  for (let i = 0; i < repeat; i++) {
    const s = new Date(startBase.getTime() + i * 604800000);
    const e = new Date(endBase.getTime() + i * 604800000);
    newRows.push({
      id: _uuid_(),
      staffEmail: me.email,
      staffName: me.name,
      startISO: s.toISOString(),
      endISO: e.toISOString(),
      startCT: _fmtCentral_(s.toISOString()),
      endCT: _fmtCentral_(e.toISOString()),
      reason: String(data.reason || "").trim(),
      createdAtISO: new Date().toISOString()
    });
  }

  _appendRows_(SHEET_AVAIL, newRows);
  _cacheClearLarge_(CacheService.getScriptCache(), "availAll");
  return { createdCount: repeat };
}

function api_listMyUnavailability(data) {
  const me = _requireSession_(data.sessionToken);
  const cutoff = new Date(); // v6.2 2026-07-18 — hide as soon as it ends (was 7-day grace)

  const rows = _readAll_(SHEET_AVAIL)
    .filter(r => _normEmail_(r.staffEmail) === me.email && new Date(r.endISO) > cutoff)
    .sort((a, b) => new Date(a.startISO) - new Date(b.startISO));

  return { items: rows };
}

function api_listAllUnavailability(data) {
  const me = _requireSession_(data.sessionToken);
  if (!me.isManager) throw new Error("Managers only");

  const cutoff = new Date(); // v6.2 2026-07-18 — hide as soon as it ends (was 24h grace)
  const rows = _readAll_(SHEET_AVAIL)
    .filter(r => new Date(r.endISO) > cutoff)
    .sort((a, b) => new Date(a.startISO) - new Date(b.startISO));

  return { items: rows };
}

function api_deleteUnavailability(data) {
  const me = _requireSession_(data.sessionToken);
  const item = _readAll_(SHEET_AVAIL).find(r => r.id === data.id);
  if (!item) throw new Error("Not found");
  if (_normEmail_(item.staffEmail) !== me.email && !me.isManager) throw new Error("Denied");
  _deleteWhere_(SHEET_AVAIL, "id", data.id);
  _cacheClearLarge_(CacheService.getScriptCache(), "availAll");
  return { deleted: true };
}

// ============================================================================
// 8. TOOLS: REMINDERS, CHARTS, BULLETIN
// ============================================================================

function api_setReminderPrefs(data) {
  const me = _requireSession_(data.sessionToken);
  _updateWhere_(SHEET_STAFF, "email", me.email, { remindOptIn: data.optIn, remind24h: data.remind24h, remind2h: data.remind2h });
  _cacheClearLarge_(CacheService.getScriptCache(), "staffIndex");
  return { optIn: data.optIn, remind24h: data.remind24h, remind2h: data.remind2h };
}

function sendShiftReminders() {
  const now = new Date();
  const lookahead = new Date(now.getTime() + 26 * 3600000);
  const shifts = _getShiftsCached_().filter(s => {
    const start = new Date(s.startISO);
    return !_asBool_(s.isOpen) && start > now && start < lookahead;
  });

  const staffMap = {};
  _staffIndex_().forEach(s => staffMap[s.email] = s);
  const log = _readAll_(SHEET_REMIND_LOG);
  const sentKeys = new Set(log.map(r => r.eventId + "|" + r.kind + "|" + r.sentTo));

  shifts.forEach(s => {
    const prefs = staffMap[_normEmail_(s.staffEmail)];
    if (!prefs || !prefs.remindOptIn) return;

    const start = new Date(s.startISO);
    const diffMin = (start - now) / 60000;

    if (prefs.remind24h && diffMin > 1380 && diffMin < 1500) _sendReminder(s, "24h", sentKeys);
    if (prefs.remind2h && diffMin > 60 && diffMin < 180) _sendReminder(s, "2h", sentKeys);
  });
}

function _sendReminder(shift, kind, sentKeys) {
  const k = shift.eventId + "|" + kind + "|" + _normEmail_(shift.staffEmail);
  if (sentKeys.has(k)) return;

  try {
    const f = _fmtShiftForEmail_(shift);
    // v6.0 2026-07-18 — include open task count for this shift in the reminder
    let taskLine = "";
    try {
      const openTasks = _readAll_(SHEET_TODOS).filter(t =>
        String(t.shiftId) === String(shift.eventId) && !_asBool_(t.done));
      if (openTasks.length) {
        taskLine = "<br>You have " + openTasks.length + " task" + (openTasks.length === 1 ? "" : "s") + " for this shift.";
      }
    } catch (_) {}
    MailApp.sendEmail({
      to: shift.staffEmail,
      subject: EMAIL_SETTINGS.staffNotifySubjectPrefix + " Reminder " + kind + ": " + shift.task,
      htmlBody: "<p><b>" + shift.task + "</b><br>" + f.dateStr + " " + f.timeStr + taskLine + "</p>",
      name: EMAIL_SETTINGS.fromName
    });

    _appendRow_(SHEET_REMIND_LOG, {
      id: _uuid_(),
      eventId: shift.eventId,
      kind,
      sentTo: shift.staffEmail,
      sentAtISO: new Date().toISOString()
    });
  } catch (_) {}
}

function api_weekChart(data) {
  _requireSession_(data.sessionToken);
  const start = new Date(data.weekStartISO);
  const end = new Date(start.getTime() + 7 * 86400000);
  const days = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    days.push({ key: Utilities.formatDate(d, TZ_CENTRAL, "yyyy-MM-dd"), label: Utilities.formatDate(d, TZ_CENTRAL, "EEE M/d"), items: [] });
  }

  const shifts = _getShiftsCached_().filter(s => new Date(s.startISO) >= start && new Date(s.startISO) < end);
  shifts.forEach(s => {
    const k = Utilities.formatDate(new Date(s.startISO), TZ_CENTRAL, "yyyy-MM-dd");
    const day = days.find(d => d.key === k);
    if (day) day.items.push({ time: Utilities.formatDate(new Date(s.startISO), TZ_CENTRAL, "h:mm a"), task: s.task, staff: s.staffName || s.staffEmail });
  });

  return { days };
}

function api_monthSummary(data) {
  _requireSession_(data.sessionToken);
  const m = new Date(data.monthISO);
  const start = new Date(m.getFullYear(), m.getMonth(), 1);
  const end = new Date(m.getFullYear(), m.getMonth() + 1, 1);

  const shifts = _getShiftsCached_().filter(s => new Date(s.startISO) >= start && new Date(s.startISO) < end && !_asBool_(s.isOpen) && !_asBool_(s.isOpenEnded));
  const stats = {};
  shifts.forEach(s => {
    const e = _normEmail_(s.staffEmail);
    if (!stats[e]) stats[e] = { name: s.staffName || e, hours: 0 };
    stats[e].hours += (new Date(s.endISO) - new Date(s.startISO)) / 3600000;
  });

  const employees = Object.values(stats).sort((a, b) => b.hours - a.hours);
  const totalHours = employees.reduce((acc, curr) => acc + curr.hours, 0);
  const monthLabel = Utilities.formatDate(start, TZ_CENTRAL, "MMMM yyyy");

  return { year: m.getFullYear(), month: m.getMonth() + 1, employees, totalHours, label: monthLabel };
}

function api_weekSummary(data) {
  _requireSession_(data.sessionToken);
  const start = new Date(data.weekStartISO);
  const end = new Date(start.getTime() + 7 * 86400000);

  const shifts = _getShiftsCached_().filter(s => {
    const d = new Date(s.startISO);
    return d >= start && d < end && !_asBool_(s.isOpen) && !_asBool_(s.isOpenEnded);
  });

  const stats = {};
  shifts.forEach(s => {
    const e = _normEmail_(s.staffEmail);
    if (!stats[e]) stats[e] = { name: s.staffName || e, hours: 0 };
    stats[e].hours += (new Date(s.endISO) - new Date(s.startISO)) / 3600000;
  });

  const employees = Object.values(stats).sort((a, b) => b.hours - a.hours);
  const totalHours = employees.reduce((acc, curr) => acc + curr.hours, 0);
  const startLabel = Utilities.formatDate(start, TZ_CENTRAL, "EEE, MMM d");
  const endLabel = Utilities.formatDate(new Date(end.getTime() - 86400000), TZ_CENTRAL, "EEE, MMM d, yyyy");

  return { employees, totalHours, label: startLabel + " – " + endLabel };
}

function api_copyWeekToNext(data) {
  const start = new Date(data.weekStartISO);
  const target = new Date(start.getTime() + 7 * 86400000);
  return api_copyWeek({
    sessionToken: data.sessionToken,
    sourceWeekStartISO: start.toISOString(),
    targetWeekStartISO: target.toISOString(),
    replaceTarget: false
  });
}

function api_copyWeek(data) {
  const me = _requireSession_(data.sessionToken);
  if (!me.isManager) throw new Error("Managers only");
  _ensureShiftsSchema_();

  const sourceStart = new Date(data.sourceWeekStartISO);
  const targetStart = new Date(data.targetWeekStartISO);
  if (isNaN(sourceStart.getTime()) || isNaN(targetStart.getTime())) {
    throw new Error("Invalid week dates");
  }
  if (sourceStart.getTime() === targetStart.getTime()) {
    throw new Error("Source and target weeks are the same");
  }

  const sourceEnd = new Date(sourceStart.getTime() + 7 * 86400000);
  const targetEnd = new Date(targetStart.getTime() + 7 * 86400000);
  const offsetMs = targetStart.getTime() - sourceStart.getTime();
  const replaceTarget = !!data.replaceTarget;

  const allShifts = _getShiftsCached_();
  const sourceShifts = allShifts.filter(r => { const d = new Date(r.startISO); return d >= sourceStart && d < sourceEnd; });
  const targetShifts = allShifts.filter(r => { const d = new Date(r.startISO); return d >= targetStart && d < targetEnd; });

  const cal = CalendarApp.getCalendarById(CALENDAR_ID);

  let deletedCount = 0;
  if (replaceTarget && targetShifts.length) {
    for (const t of targetShifts) {
      try {
        const ev = cal.getEventById(t.eventId);
        if (ev) ev.deleteEvent();
      } catch (_) {}
      _deleteWhere_(SHEET_SHIFTS, "eventId", t.eventId);
      deletedCount++;
    }
  }

  const existingKeys = replaceTarget
    ? new Set()
    : new Set(targetShifts.map(s => s.staffEmail + "|" + new Date(s.startISO).getTime()));

  const newRows = [];
  let skipped = 0;

  for (const s of sourceShifts) {
    const newStart = new Date(new Date(s.startISO).getTime() + offsetMs);
    const newEnd = new Date(new Date(s.endISO).getTime() + offsetMs);
    const key = (s.staffEmail || "") + "|" + newStart.getTime();
    if (existingKeys.has(key)) { skipped++; continue; }

    const isOpen = _asBool_(s.isOpen);
    const isOpenEnded = _asBool_(s.isOpenEnded);

    try { if (!isOpen) _assertNoHardConflicts_(s.staffEmail, newStart, newEnd); }
    catch (e) { skipped++; continue; }

    const suffix = isOpenEnded ? " (Until needed)" : "";
    const title = (isOpen ? s.task + " — OPEN" : s.task + " — " + (s.staffName || s.staffEmail)) + suffix;
    const desc = (isOpen
        ? "OPEN SHIFT\nTask: " + s.task + "\nLocation: " + (s.location || "")
        : "Task: " + s.task + "\nNotes: " + (s.notes || ""))
      + (isOpenEnded ? "\nEnd: Until needed (no set end time)" : "");

    const ev = cal.createEvent(title, newStart, newEnd, { location: s.location || "", description: desc });

    newRows.push({
      eventId: ev.getId(), isOpen: isOpen, isOpenEnded: isOpenEnded,
      task: s.task, location: s.location, notes: s.notes || "",
      startISO: newStart.toISOString(), endISO: newEnd.toISOString(),
      startCT: _fmtCentral_(newStart.toISOString()), endCT: _fmtCentral_(newEnd.toISOString()),
      staffEmail: isOpen ? "" : s.staffEmail, staffName: isOpen ? "" : s.staffName,
      createdBy: me.email, createdAtISO: new Date().toISOString(), updatedAtISO: ""
    });
  }

  _appendRows_(SHEET_SHIFTS, newRows);
  _invalidateShiftsCache_();
  return { createdCount: newRows.length, skippedCount: skipped, deletedCount: deletedCount };
}

function api_weekShiftCount(data) {
  _requireSession_(data.sessionToken);
  const start = new Date(data.weekStartISO);
  if (isNaN(start.getTime())) throw new Error("Invalid week date");
  const end = new Date(start.getTime() + 7 * 86400000);
  const count = _getShiftsCached_()
    .filter(r => { const d = new Date(r.startISO); return d >= start && d < end; })
    .length;
  return { count: count };
}

function api_setBulletin(data) {
  const me = _requireSession_(data.sessionToken);
  if (!me.isManager) throw new Error("Managers only");
  _appendRow_(SHEET_BULLETIN, { id: _uuid_(), message: String(data.message || "").trim(), updatedBy: me.email, updatedAtISO: new Date().toISOString() });
  return { saved: true };
}

// ============================================================================
// 10. COMPOSITE DASHBOARD ENDPOINTS (single call per view)
// ============================================================================

function _getBulletinDirect_() {
  const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_BULLETIN);
  if (!sh || sh.getLastRow() < 2) return { message: "", updatedBy: "" };
  const lastRow = sh.getLastRow();
  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(x => String(x).trim());
  const vals = sh.getRange(lastRow, 1, 1, h.length).getValues()[0];
  const row = {};
  h.forEach((k, i) => row[k] = vals[i]);
  return { message: row.message || "", updatedBy: row.updatedBy || "" };
}

function _getSwapsDirect_(me) {
  const items = me.isManager
    ? _readAll_(SHEET_SWAP)
    : _readAll_(SHEET_SWAP).filter(r =>
        _normEmail_(r.fromEmail) === me.email ||
        _normEmail_(r.toEmail) === me.email ||
        (r.toEmail === '__anyone__' && r.status === 'REQUESTED')
      );
  items.forEach(r => { r.isOpenEnded = _asBool_(r.isOpenEnded); });
  return items;
}

function _getNotesDirect_(start, end) {
  return _readAll_(SHEET_NOTES)
    .filter(r => r.date && String(r.note).trim() !== "")
    .filter(r => { const d = new Date(r.date); return d >= start && d < end; })
    .map(r => {
      const d = new Date(r.date);
      d.setHours(0, 0, 0, 0);
      return {
        eventId: "NOTE_" + r.date, task: String(r.note).trim(), location: "",
        startISO: d.toISOString(), endISO: d.toISOString(),
        staffEmail: "", staffName: "--- Special Event ---", notes: "",
        isOpen: false, isSeries: false, openShiftId: ""
      };
    });
}

function api_dashSchedule(data) {
  const me = _requireSession_(data.sessionToken);
  const mode = data.mode || "week";

  let shifts, buckets, dailyNotes;

  if (mode === "week") {
    const start = new Date(data.weekStartISO);
    const end = new Date(start.getTime() + 7 * 86400000);
    shifts = _getShiftsCached_()
      .filter(r => { const d = new Date(r.startISO); return d >= start && d < end; })
      .map(r => _cleanShift_(r, me.isManager));
    dailyNotes = _getNotesDirect_(start, end);
    const combined = [...shifts, ...dailyNotes].sort((a, b) => new Date(a.startISO) - new Date(b.startISO));
    shifts = combined;
  } else {
    const m = new Date(data.monthISO);
    const start = new Date(m.getFullYear(), m.getMonth(), 1);
    const end = new Date(m.getFullYear(), m.getMonth() + 1, 1);
    const rawShifts = _getShiftsCached_()
      .filter(r => { const d = new Date(r.startISO); return d >= start && d < end; })
      .map(r => _cleanShift_(r, me.isManager));
    dailyNotes = _getNotesDirect_(start, end);
    const combined = [...rawShifts, ...dailyNotes].sort((a, b) => new Date(a.startISO) - new Date(b.startISO));
    shifts = combined;
    buckets = {};
    combined.forEach(s => {
      const k = Utilities.formatDate(new Date(s.startISO), TZ_CENTRAL, "yyyy-MM-dd");
      if (!buckets[k]) buckets[k] = [];
      buckets[k].push(s);
    });
  }

  const bulletin = _getBulletinDirect_();
  const swaps = _getSwapsDirect_(me);

  return {
    shifts,
    buckets: buckets || null,
    bulletin,
    swaps
  };
}

function api_dashOpen(data) {
  const me = _requireSession_(data.sessionToken);
  const from = new Date(data.fromISO || new Date());

  const openShifts = _getShiftsCached_()
    .filter(r => _asBool_(r.isOpen) && new Date(r.startISO) >= from)
    .map(r => _cleanShift_(r, me.isManager))
    .sort((a, b) => new Date(a.startISO) - new Date(b.startISO));

  const swaps = _getSwapsDirect_(me);

  return { openShifts, swaps };
}

function api_dashRequests(data) {
  const me = _requireSession_(data.sessionToken);
  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 1);

  const allShifts = _getShiftsCached_();

  const curMonthShifts = allShifts
    .filter(r => { const d = new Date(r.startISO); return d >= thisMonth && d < nextMonthStart; })
    .map(r => _cleanShift_(r, me.isManager));
  const curBuckets = {};
  curMonthShifts.forEach(s => {
    const k = Utilities.formatDate(new Date(s.startISO), TZ_CENTRAL, "yyyy-MM-dd");
    if (!curBuckets[k]) curBuckets[k] = [];
    curBuckets[k].push(s);
  });

  const nextMonthShifts = allShifts
    .filter(r => { const d = new Date(r.startISO); return d >= nextMonthStart && d < nextMonthEnd; })
    .map(r => _cleanShift_(r, me.isManager));
  const nextBuckets = {};
  nextMonthShifts.forEach(s => {
    const k = Utilities.formatDate(new Date(s.startISO), TZ_CENTRAL, "yyyy-MM-dd");
    if (!nextBuckets[k]) nextBuckets[k] = [];
    nextBuckets[k].push(s);
  });

  const swaps = _getSwapsDirect_(me);

  const cutoff = new Date(now.getTime() - 7 * 24 * 3600000);
  const unavail = _getAvailCached_()
    .filter(r => _normEmail_(r.staffEmail) === me.email && new Date(r.endISO) > cutoff)
    .sort((a, b) => new Date(a.startISO) - new Date(b.startISO));

  return {
    swaps,
    curMonth: { buckets: curBuckets, shifts: curMonthShifts },
    nextMonth: { buckets: nextBuckets, shifts: nextMonthShifts },
    unavail
  };
}

function api_dashAdmin(data) {
  const me = _requireSession_(data.sessionToken);
  if (!me.isManager) throw new Error("Managers only");

  const bulletin = _getBulletinDirect_();

  const cutoff = new Date(new Date().getTime() - 24 * 60 * 60 * 1000);
  const unavail = _getAvailCached_()
    .filter(r => new Date(r.endISO) > cutoff)
    .sort((a, b) => new Date(a.startISO) - new Date(b.startISO));

  return { bulletin, unavail };
}

// ============================================================================
// 8b. STAFF TASKS  v6.0 2026-07-18  (replaces v5.5 To-Do List)
//
// A task's scope is derived from three optional fields:
//   (none)               → backlog, shared "up for grabs" list
//   date                 → day task, everyone working that day sees it
//   date + assignedTo    → personal task for that day
//   shiftId              → attached to a shift; follows whoever holds it
//
// Recurring TaskTemplates materialize into Todos rows for today and tomorrow
// on every listTodos call (idempotent, keyed on templateId + date).
// Any staff member may add, assign, and reassign tasks; delete is restricted
// to the creator or a manager.
// ============================================================================

let _todosSchemaEnsured_ = false;
function _ensureTodosSchema_() {
  if (_todosSchemaEnsured_) return;
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  // v6.7 2026-07-23 — added "time" column (optional due time, HH:MM)
  _ensureSheet_(ss, SHEET_TODOS, ["id", "text", "category", "done", "addedBy", "addedAt", "doneBy", "doneAt", "date", "shiftId", "assignedTo", "proofValue", "templateId", "priority", "time"]);
  _ensureSheet_(ss, SHEET_TEMPLATES, ["id", "text", "category", "recurrence", "targetDuty", "requireProof", "active", "priority"]);
  _todosSchemaEnsured_ = true;
}

// v6.5 2026-07-19 — normalize priority to one of: high | normal | low
function _todoPriority_(v) {
  const p = String(v || "").trim().toLowerCase();
  return (p === "high" || p === "low") ? p : "normal";
}

// Sheets may coerce "2026-07-18" cells to Date objects; normalize on read.
function _todoDateStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ_CENTRAL, "yyyy-MM-dd");
  return String(v || "").trim();
}

// v6.7 2026-07-23 — optional due time. A task can be "open" (date only, or no
// date at all) or pinned to a specific time (date + time). Sheets may coerce
// "15:00" cells to Date objects; normalize on read. Validates HH:MM, else "".
function _todoTimeStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ_CENTRAL, "HH:mm");
  const s = String(v || "").trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : "";
}

function api_listTodos(data) {
  _requireSession_(data.sessionToken);
  _ensureTodosSchema_();
  _materializeTemplates_();
  const items = _readAll_(SHEET_TODOS).filter(r => r.id).map(r => ({
    id:         String(r.id       || ""),
    text:       String(r.text     || ""),
    category:   String(r.category || "General"),
    done:       _asBool_(r.done),
    addedBy:    String(r.addedBy  || ""),
    addedAt:    String(r.addedAt  || ""),
    doneBy:     String(r.doneBy   || ""),
    doneAt:     String(r.doneAt   || ""),
    date:       _todoDateStr_(r.date),
    time:       _todoTimeStr_(r.time), // v6.7 2026-07-23
    shiftId:    String(r.shiftId  || ""),
    assignedTo: _normEmail_(r.assignedTo),
    proofValue: String(r.proofValue || ""),
    templateId: String(r.templateId || ""),
    priority:   _todoPriority_(r.priority) // v6.5 2026-07-19
  }));
  return { items };
}

// v6.3 2026-07-18 — resolve person+date to their shift that day (Central time)
function _findShiftFor_(email, dateStr) {
  if (!email || !dateStr) return null;
  return _getShiftsCached_().find(s =>
    !_asBool_(s.isOpen) &&
    _normEmail_(s.staffEmail) === email &&
    s.startISO &&
    Utilities.formatDate(new Date(s.startISO), TZ_CENTRAL, "yyyy-MM-dd") === dateStr
  ) || null;
}

function api_saveTodo(data) {
  const me = _requireSession_(data.sessionToken);
  _ensureTodosSchema_();
  const text = String(data.text || "").trim();
  if (!text) throw new Error("No task text provided");
  const id = "todo_" + Date.now() + "_" + Math.floor(Math.random() * 10000);

  // v6.3 2026-07-18 — person+date tasks auto-attach to that person's shift;
  // caller is told when there is no shift so the UI can warn.
  const assignedTo = _normEmail_(data.assignedTo);
  const date = _todoDateStr_(data.date);
  const time = _todoTimeStr_(data.time); // v6.7 2026-07-23 — optional, "" = open/anytime
  let shiftId = String(data.shiftId || "");
  let attached = false, noShift = false;
  if (!shiftId && assignedTo && date) {
    const s = _findShiftFor_(assignedTo, date);
    if (s) { shiftId = String(s.eventId); attached = true; } else { noShift = true; }
  }

  _appendRow_(SHEET_TODOS, {
    id,
    text,
    category:   String(data.category || "General"),
    done:       false,
    addedBy:    me.name || me.email,
    addedAt:    new Date().toISOString(),
    doneBy:     "",
    doneAt:     "",
    date:       date,
    time:       time, // v6.7 2026-07-23
    shiftId:    shiftId,
    assignedTo: assignedTo,
    proofValue: "",
    templateId: String(data.templateId || ""),
    priority:   _todoPriority_(data.priority) // v6.5 2026-07-19
  });
  return { id, attached, noShift };
}

// v6.0 — update assignment/scheduling (and optionally text/category).
// Deliberately open to all staff: anyone may assign tasks to anyone.
function api_updateTodo(data) {
  _requireSession_(data.sessionToken);
  _ensureTodosSchema_();
  const patch = {};
  if (data.text       !== undefined) patch.text = String(data.text);
  if (data.category   !== undefined) patch.category = String(data.category);
  if (data.date       !== undefined) patch.date = _todoDateStr_(data.date);
  if (data.time       !== undefined) patch.time = _todoTimeStr_(data.time); // v6.7 2026-07-23
  if (data.shiftId    !== undefined) patch.shiftId = String(data.shiftId);
  if (data.assignedTo !== undefined) patch.assignedTo = _normEmail_(data.assignedTo);
  if (data.priority   !== undefined) patch.priority = _todoPriority_(data.priority); // v6.5 2026-07-19
  if (!Object.keys(patch).length) return { updated: false };

  // v6.3 2026-07-18 — when person or date changes (and shiftId wasn't set
  // explicitly), re-attach to that person's shift on that date, or detach
  // and report noShift so the UI can warn.
  let attached = false, noShift = false;
  if ((data.assignedTo !== undefined || data.date !== undefined) && data.shiftId === undefined) {
    const row = _readAll_(SHEET_TODOS).find(r => String(r.id) === String(data.id));
    const email = patch.assignedTo !== undefined ? patch.assignedTo : _normEmail_(row && row.assignedTo);
    const dstr = patch.date !== undefined ? patch.date : String((row && row.date) || "");
    const s = _findShiftFor_(email, dstr);
    patch.shiftId = s ? String(s.eventId) : "";
    attached = !!s;
    noShift = !s && !!(email && dstr);
  }

  const matched = _updateWhere_(SHEET_TODOS, "id", String(data.id), patch);
  if (!matched) throw new Error("Task not found: " + data.id);
  return { updated: true, attached, noShift };
}

function api_toggleTodo(data) {
  const me = _requireSession_(data.sessionToken);
  _ensureTodosSchema_();
  const done = !!data.done;
  const patch = {
    done,
    doneBy: done ? (me.name || me.email) : "",
    doneAt: done ? new Date().toISOString() : ""
  };
  // v6.0 — optional proof value (gauge reading, temp, count) captured at completion
  if (data.proofValue !== undefined && String(data.proofValue) !== "") {
    patch.proofValue = String(data.proofValue);
  }
  _updateWhere_(SHEET_TODOS, "id", String(data.id), patch);
  return { toggled: true };
}

function api_deleteTodo(data) {
  const me = _requireSession_(data.sessionToken);
  // v6.0 — delete restricted to the creator or a manager
  const row = _readAll_(SHEET_TODOS).find(r => String(r.id) === String(data.id));
  if (!row) throw new Error("Task not found");
  const addedBy = String(row.addedBy || "");
  if (!me.isManager && addedBy && addedBy !== (me.name || me.email) && addedBy !== "Auto") {
    throw new Error("Only " + addedBy + " or a manager can delete this task");
  }
  _deleteWhere_(SHEET_TODOS, "id", String(data.id));
  return { deleted: true };
}

function api_clearDoneTodos(data) {
  _requireSession_(data.sessionToken);
  const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_TODOS);
  if (!sh || sh.getLastRow() < 2) return { cleared: 0 };
  const vals = sh.getDataRange().getValues();
  const h = vals[0].map(x => String(x).trim());
  const doneIdx = h.indexOf("done");
  if (doneIdx < 0) return { cleared: 0 };
  let cleared = 0;
  for (let i = vals.length - 1; i >= 1; i--) {
    if (_asBool_(vals[i][doneIdx])) { sh.deleteRow(i + 1); cleared++; }
  }
  return { cleared };
}

// v6.0 — called from api_deleteShift: shift tasks fall back to day tasks on
// the shift's date (shiftId cleared, date + assignee kept) instead of
// disappearing with the shift.
function _releaseTasksForShift_(eventId) {
  if (!eventId) return;
  try {
    _ensureTodosSchema_();
    const rows = _readAll_(SHEET_TODOS).filter(r =>
      String(r.shiftId) === String(eventId) && !_asBool_(r.done));
    rows.forEach(r => _updateWhere_(SHEET_TODOS, "id", String(r.id), { shiftId: "" }));
  } catch (_) {} // never block shift deletion on task cleanup
}

// ============================================================================
// v6.4 2026-07-18 — SHIFT TASK ROLLOVER (hourly trigger)
// A task not finished during its scheduled shift moves to that employee's
// next upcoming shift; if they have none, it goes back to Up for Grabs
// (unassigned, no shift, no date) so anyone can take it.
// ============================================================================
function _shiftEndTime_(s) {
  const start = new Date(s.startISO);
  const end = s.endISO && !_asBool_(s.isOpenEnded) ? new Date(s.endISO) : null;
  if (end && end > start) return end;
  // open-ended / missing end: roll after the shift's Central-time day is over
  const dayEnd = new Date(Utilities.formatDate(start, TZ_CENTRAL, "yyyy-MM-dd") + "T00:00:00" + Utilities.formatDate(start, TZ_CENTRAL, "XXX"));
  return new Date(dayEnd.getTime() + 86400000);
}

function rollUnfinishedShiftTasks() {
  const now = new Date();
  const todos = _readAll_(SHEET_TODOS).filter(t => !_asBool_(t.done) && t.shiftId);
  if (!todos.length) return;

  const shifts = _getShiftsCached_();
  const byId = {};
  shifts.forEach(s => { byId[String(s.eventId)] = s; });
  let changed = 0;

  for (const t of todos) {
    const s = byId[String(t.shiftId)];
    if (!s || !s.startISO) continue;              // deleted shifts handled by _releaseTasksForShift_
    if (_shiftEndTime_(s) > now) continue;        // shift not over yet

    const email = _asBool_(s.isOpen) ? "" : _normEmail_(s.staffEmail);
    const next = email ? shifts
      .filter(x => !_asBool_(x.isOpen) && _normEmail_(x.staffEmail) === email &&
        x.startISO && new Date(x.startISO) > now && String(x.eventId) !== String(s.eventId))
      .sort((a, b) => new Date(a.startISO) - new Date(b.startISO))[0] : null;

    if (next) {
      _updateWhere_(SHEET_TODOS, "id", String(t.id), {
        shiftId: String(next.eventId),
        date: Utilities.formatDate(new Date(next.startISO), TZ_CENTRAL, "yyyy-MM-dd"),
        assignedTo: email
      });
    } else {
      _updateWhere_(SHEET_TODOS, "id", String(t.id), { shiftId: "", assignedTo: "", date: "" });
    }
    changed++;
  }
  if (changed) Logger.log("rollUnfinishedShiftTasks: moved " + changed + " task(s)");
}

// ---------- Task Templates (v6.0) ----------
// recurrence: "none" | "daily" | "days:Mon,Thu" | "weekly" | "monthly"
// targetDuty: matches a shift's task/duty (e.g. "Production") — the frontend
// attaches the materialized day task to that duty's shift when one exists.

function api_listTemplates(data) {
  _requireSession_(data.sessionToken);
  _ensureTodosSchema_();
  const items = _readAll_(SHEET_TEMPLATES).filter(r => r.id).map(r => ({
    id:           String(r.id || ""),
    text:         String(r.text || ""),
    category:     String(r.category || "General"),
    recurrence:   String(r.recurrence || "none"),
    targetDuty:   String(r.targetDuty || ""),
    requireProof: _asBool_(r.requireProof),
    active:       _asBool_(r.active)
  }));
  return { items };
}

function api_saveTemplate(data) {
  const me = _requireSession_(data.sessionToken);
  if (!me.isManager) throw new Error("Managers only");
  _ensureTodosSchema_();
  const text = String(data.text || "").trim();
  if (!text) throw new Error("No template text provided");

  const fields = {
    text,
    category:     String(data.category || "General"),
    recurrence:   String(data.recurrence || "none"),
    targetDuty:   String(data.targetDuty || ""),
    requireProof: data.requireProof === true,
    active:       data.active !== false
  };

  if (data.id) {
    const matched = _updateWhere_(SHEET_TEMPLATES, "id", String(data.id), fields);
    if (!matched) throw new Error("Template not found: " + data.id);
    return { id: String(data.id) };
  }

  const id = "tpl_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
  _appendRow_(SHEET_TEMPLATES, Object.assign({ id }, fields));
  return { id };
}

function api_deleteTemplate(data) {
  const me = _requireSession_(data.sessionToken);
  if (!me.isManager) throw new Error("Managers only");
  _deleteWhere_(SHEET_TEMPLATES, "id", String(data.id));
  return { deleted: true };
}

// Spawn Todos rows for recurring templates for today AND tomorrow (so evening
// staff can preview the next day). Idempotent: keyed on templateId + date.
// Runs on every listTodos call; cheap at this data volume.
function _materializeTemplates_() {
  try {
    const tpls = _readAll_(SHEET_TEMPLATES).filter(r =>
      r.id && _asBool_(r.active) && String(r.recurrence || "none") !== "none");
    if (!tpls.length) return;

    const todos = _readAll_(SHEET_TODOS);
    const existing = {};
    todos.forEach(r => {
      if (r.templateId) existing[String(r.templateId) + "|" + _todoDateStr_(r.date)] = true;
    });

    const days = [new Date(), new Date(Date.now() + 86400000)];
    const newRows = [];
    days.forEach(d => {
      const dateStr = Utilities.formatDate(d, TZ_CENTRAL, "yyyy-MM-dd");
      const dow     = Utilities.formatDate(d, TZ_CENTRAL, "EEE"); // Mon, Tue, ...
      const dom     = Utilities.formatDate(d, TZ_CENTRAL, "d");   // 1..31
      tpls.forEach(t => {
        if (!_templateMatchesDay_(String(t.recurrence), dow, dom)) return;
        if (existing[String(t.id) + "|" + dateStr]) return;
        newRows.push({
          id: "todo_" + Date.now() + "_" + Math.floor(Math.random() * 100000),
          text: String(t.text || ""),
          category: String(t.category || "General"),
          done: false,
          addedBy: "Auto",
          addedAt: new Date().toISOString(),
          doneBy: "", doneAt: "",
          date: dateStr, shiftId: "", assignedTo: "", proofValue: "",
          templateId: String(t.id),
          priority: _todoPriority_(t.priority) // v6.5 2026-07-19 — inherit template priority
        });
        existing[String(t.id) + "|" + dateStr] = true;
      });
    });

    if (newRows.length) _appendRows_(SHEET_TODOS, newRows);
  } catch (_) {} // never break listTodos on template errors
}

function _templateMatchesDay_(recurrence, dow, dom) {
  if (recurrence === "daily") return true;
  if (recurrence === "weekly") return dow === "Mon";
  if (recurrence === "monthly") return dom === "1";
  if (recurrence.indexOf("days:") === 0) {
    return recurrence.substring(5).split(",").map(s => s.trim()).indexOf(dow) >= 0;
  }
  return false;
}

// ============================================================================
// 9. HELPERS
// ============================================================================

function _cleanShift_(r, isManager) {
  return { eventId: r.eventId, task: r.task, location: r.location, startISO: r.startISO, endISO: r.endISO, staffEmail: r.staffEmail, staffName: r.staffName, notes: isManager ? (r.notes || "") : "", isOpen: _asBool_(r.isOpen), isOpenEnded: _asBool_(r.isOpenEnded), isSeries: _asBool_(r.isSeries), openShiftId: r.eventId };
}

function _json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function _normEmail_(e) { return String(e || "").trim().toLowerCase(); }
function _asBool_(v) { const s = String(v || "").toLowerCase(); return s === "true" || s === "yes" || s === "1"; }
function _randToken_() { return Utilities.getUuid().replace(/-/g, ""); }
function _uuid_() { return Utilities.getUuid(); }

function _ensureSheet_(ss, n, h) {
  let sh = ss.getSheetByName(n);
  if (!sh) { sh = ss.insertSheet(n); sh.appendRow(h); return; }
  if (sh.getLastRow() === 0) { sh.appendRow(h); return; }
  const lastCol = sh.getLastColumn();
  if (lastCol < 1) { sh.appendRow(h); return; }
  const existing = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(x => String(x).trim());
  while (existing.length && existing[existing.length - 1] === "") existing.pop();
  const missing = h.filter(k => existing.indexOf(k) < 0);
  if (missing.length) {
    const needed = existing.length + missing.length;
    const maxCols = sh.getMaxColumns();
    if (needed > maxCols) sh.insertColumnsAfter(maxCols, needed - maxCols);
    sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  }
}

let _schemaEnsured_ = false;
function _ensureShiftsSchema_() {
  if (_schemaEnsured_) return;
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  _ensureSheet_(ss, SHEET_SHIFTS, ["eventId", "sourceId", "seriesId", "seriesIndex", "isSeries", "isOpen", "isOpenEnded", "staffEmail", "staffName", "task", "location", "startISO", "endISO", "startCT", "endCT", "notes", "createdBy", "createdAtISO", "updatedAtISO"]);
  _ensureSheet_(ss, SHEET_SWAP, ["id", "eventId", "task", "startISO", "endISO", "isOpenEnded", "startCT", "endCT", "fromEmail", "fromName", "toEmail", "message", "status", "acceptedAtISO", "approvedBy", "approvedAtISO", "createdAtISO"]);
  _schemaEnsured_ = true;
}

function _readAll_(n) {
  const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(n);
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getDataRange().getValues();
  const h = v[0].map(x => String(x).trim());
  return v.slice(1).map(r => { const o = {}; h.forEach((k, i) => o[k] = r[i]); return o; });
}

function _appendRow_(n, o) { _appendRows_(n, [o]); }

function _appendRows_(n, arr) {
  if (!arr.length) return;
  const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(n);
  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(x => String(x).trim());
  const rows = arr.map(o => h.map(k => o[k] === undefined ? "" : o[k]));
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, h.length).setValues(rows);
}

// v5.7 — 2026-06-30 — _updateWhere_ now returns the number of rows it actually
// matched/wrote, so callers can tell a real update apart from a silent no-op
// (previously every caller returned {updated:true} even when 0 rows matched,
// which is why the UI could say "Shift Updated!" while nothing changed).
function _updateWhere_(n, k, v, patch) {
  const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(n);
  const vals = sh.getDataRange().getValues();
  const h = vals[0].map(x => String(x).trim());
  const kIdx = h.indexOf(k);
  if (kIdx < 0) return 0;
  let matched = 0;
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][kIdx]) === String(v)) {
      const row = vals[i].slice();
      Object.keys(patch).forEach(pk => {
        const c = h.indexOf(pk);
        if (c >= 0) row[c] = patch[pk];
      });
      sh.getRange(i + 1, 1, 1, row.length).setValues([row]);
      matched++;
    }
  }
  return matched;
}

// v5.8 — 2026-06-30 — cancel any pending (REQUESTED/ACCEPTED) SwapRequests
// rows tied to eventId. Used whenever a shift's assignment changes (or the
// shift is deleted) outside the normal swap accept/approve flow, so a stale
// swap request can't keep showing as pending on the schedule.
function _cancelPendingSwapsForEvent_(eventId, reason) {
  const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_SWAP);
  if (!sh) return 0;
  const vals = sh.getDataRange().getValues();
  if (vals.length < 2) return 0;
  const h = vals[0].map(x => String(x).trim());
  const eIdx = h.indexOf("eventId");
  const sIdx = h.indexOf("status");
  const msgIdx = h.indexOf("message");
  if (eIdx < 0 || sIdx < 0) return 0;
  let canceled = 0;
  for (let i = 1; i < vals.length; i++) {
    const status = String(vals[i][sIdx]);
    if (String(vals[i][eIdx]) === String(eventId) && (status === "REQUESTED" || status === "ACCEPTED")) {
      const row = vals[i].slice();
      row[sIdx] = "CANCELED";
      if (msgIdx >= 0 && reason) row[msgIdx] = String(row[msgIdx] || "") + " [auto-canceled: " + reason + "]";
      sh.getRange(i + 1, 1, 1, row.length).setValues([row]);
      canceled++;
    }
  }
  return canceled;
}

function _deleteWhere_(n, k, v) {
  const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(n);
  const vals = sh.getDataRange().getValues();
  const h = vals[0].map(x => String(x).trim());
  const kIdx = h.indexOf(k);
  if (kIdx < 0) return;
  for (let i = vals.length - 1; i > 0; i--) {
    if (String(vals[i][kIdx]) === String(v)) sh.deleteRow(i + 1);
  }
}

const _CACHE_CHUNK_SIZE_ = 90000;
const _CACHE_MAX_CHUNKS_ = 50;

function _cachePutLarge_(cache, key, value, ttl) {
  const str = String(value);
  _cacheClearLarge_(cache, key);
  if (str.length <= _CACHE_CHUNK_SIZE_) {
    try { cache.put(key, JSON.stringify({ s: str }), ttl); } catch (_) {}
    return;
  }
  const chunks = Math.ceil(str.length / _CACHE_CHUNK_SIZE_);
  if (chunks > _CACHE_MAX_CHUNKS_) return;
  const parts = {};
  for (let i = 0; i < chunks; i++) {
    parts[key + "_" + i] = str.slice(i * _CACHE_CHUNK_SIZE_, (i + 1) * _CACHE_CHUNK_SIZE_);
  }
  try {
    cache.putAll(parts, ttl);
    cache.put(key, JSON.stringify({ c: chunks }), ttl);
  } catch (_) {
    _cacheClearLarge_(cache, key);
  }
}

function _cacheGetLarge_(cache, key) {
  const hit = cache.get(key);
  if (!hit) return null;
  let manifest;
  try { manifest = JSON.parse(hit); } catch (_) { return null; }
  if (typeof manifest.s === "string") return manifest.s;
  if (typeof manifest.c === "number" && manifest.c > 0) {
    const keys = [];
    for (let i = 0; i < manifest.c; i++) keys.push(key + "_" + i);
    const parts = cache.getAll(keys) || {};
    let out = "";
    for (let i = 0; i < manifest.c; i++) {
      const p = parts[key + "_" + i];
      if (p == null) return null;
      out += p;
    }
    return out;
  }
  return null;
}

function _cacheClearLarge_(cache, key) {
  const hit = cache.get(key);
  cache.remove(key);
  if (!hit) return;
  let manifest;
  try { manifest = JSON.parse(hit); } catch (_) { return; }
  if (typeof manifest.c === "number" && manifest.c > 0) {
    const keys = [];
    for (let i = 0; i < manifest.c; i++) keys.push(key + "_" + i);
    try { cache.removeAll(keys); } catch (_) {}
  }
}

function _staffIndex_() {
  const cache = CacheService.getScriptCache();
  const hit = _cacheGetLarge_(cache, "staffIndex");
  if (hit) return JSON.parse(hit);

  const s = _readAll_(SHEET_STAFF).map(r => ({
    email: _normEmail_(r.email), name: r.name, isManager: _asBool_(r.isManager),
    remindOptIn: _asBool_(r.remindOptIn), remind24h: r.remind24h !== false, remind2h: r.remind2h !== false
  }));

  _cachePutLarge_(cache, "staffIndex", JSON.stringify(s), STAFF_CACHE_SEC);
  return s;
}

function _getShiftsCached_() {
  const cache = CacheService.getScriptCache();
  const hit = _cacheGetLarge_(cache, "shiftsAll");
  if (hit) return JSON.parse(hit);
  const r = _readAll_(SHEET_SHIFTS);
  _cachePutLarge_(cache, "shiftsAll", JSON.stringify(r), SHIFTS_CACHE_SEC);
  return r;
}

function _getAvailCached_() {
  const cache = CacheService.getScriptCache();
  const hit = _cacheGetLarge_(cache, "availAll");
  if (hit) return JSON.parse(hit);
  const r = _readAll_(SHEET_AVAIL);
  _cachePutLarge_(cache, "availAll", JSON.stringify(r), SHIFTS_CACHE_SEC);
  return r;
}

function _invalidateAllCaches_() {
  const c = CacheService.getScriptCache();
  _cacheClearLarge_(c, "shiftsAll");
  _cacheClearLarge_(c, "staffIndex");
  _cacheClearLarge_(c, "availAll");
}

function _invalidateShiftsCache_() {
  _cacheClearLarge_(CacheService.getScriptCache(), "shiftsAll");
}

function _assertNoHardConflicts_(email, s, e, xId) {
  const sTime = s.getTime(), eTime = e.getTime();
  const staffName = _staffIndex_().find(st => st.email === _normEmail_(email))?.name || email;
  const shifts = _getShiftsCached_().filter(r => _normEmail_(r.staffEmail) === _normEmail_(email) && !_asBool_(r.isOpen));
  for (const r of shifts) {
    if (String(r.eventId).trim() === String(xId).trim()) continue;
    const rs = new Date(r.startISO).getTime(), re = new Date(r.endISO).getTime();
    if (sTime < re && rs < eTime) {
      throw new Error("CONFLICT|shift|" + staffName + "|" + (r.task || "Shift") + "|" + _fmtCentral_(r.startISO) + "|" + _fmtCentral_(r.endISO));
    }
  }
  const unavail = _getAvailCached_().filter(r => _normEmail_(r.staffEmail) === _normEmail_(email));
  for (const r of unavail) {
    const rs = new Date(r.startISO).getTime(), re = new Date(r.endISO).getTime();
    if (sTime < re && rs < eTime) {
      throw new Error("CONFLICT|unavail|" + staffName + "|" + (r.reason || "Unavailable") + "|" + _fmtCentral_(r.startISO) + "|" + _fmtCentral_(r.endISO));
    }
  }
}
