// =============================================================================
// STAFF TASKS (assignments + templates) — Google Apps Script backend snippet
// v3 2026-07-18 — adds task assignment (shift / day / person), auto-materialized
//                 recurring templates, proof values, and permissions.
//                 Replaces ALL v2 todo case handlers and helper functions.
//
// HOW TO UPGRADE FROM v2:
//   1. Open your Google Apps Script project (script.google.com)
//   2. In scheduler.gs, DELETE the old v2 todo cases (listTodos, saveTodo,
//      toggleTodo, deleteTodo, clearDoneTodos) and old helper functions
//      (getTodosSheet, listTodos, saveTodo, toggleTodo, deleteTodo,
//      clearDoneTodos). Keep getNameFromSession if you added it.
//   3. Paste the CASE HANDLERS below into your action dispatcher
//   4. Paste the HELPER FUNCTIONS below anywhere outside the handler
//   5. In your existing "deleteShift" handler, add this line right before the
//      shift/calendar event is deleted:
//        releaseTasksForShift(body.eventId);
//   6. Sheets: the existing "Todos" tab keeps working — new columns I–M are
//      added automatically. A "TaskTemplates" tab is created automatically.
//   7. Save & deploy a new version of your Web App
//
// The "Todos" sheet columns:
// A: id | B: text | C: category | D: done | E: addedBy | F: addedAt
// G: doneBy | H: doneAt | I: date (YYYY-MM-DD) | J: shiftId | K: assignedTo
// L: proofValue | M: templateId
//
// The "TaskTemplates" sheet columns:
// A: id | B: text | C: category | D: recurrence | E: targetDuty
// F: requireProof | G: active
//   recurrence: "none" | "daily" | "days:Mon,Thu" | "weekly" | "monthly"
// =============================================================================

// ─── PASTE THESE CASES INTO YOUR ACTION DISPATCHER ───────────────────────────
// (inside your existing if/else if chain that handles actions)

/*

  } else if (action === "listTodos") {
    materializeTemplates(); // spawn today's/tomorrow's recurring tasks first
    return ContentService.createTextOutput(JSON.stringify(listTodos())).setMimeType(ContentService.MimeType.JSON);

  } else if (action === "saveTodo") {
    const adderName = getNameFromSession(body.sessionToken) || "Staff";
    return ContentService.createTextOutput(JSON.stringify(saveTodo(body, adderName))).setMimeType(ContentService.MimeType.JSON);

  } else if (action === "updateTodo") {
    return ContentService.createTextOutput(JSON.stringify(updateTodo(body))).setMimeType(ContentService.MimeType.JSON);

  } else if (action === "toggleTodo") {
    const doneName = getNameFromSession(body.sessionToken) || "Staff";
    return ContentService.createTextOutput(JSON.stringify(toggleTodo(body.id, body.done, doneName, body.proofValue))).setMimeType(ContentService.MimeType.JSON);

  } else if (action === "deleteTodo") {
    const who = getNameFromSession(body.sessionToken) || "";
    const mgr = isManagerFromSession(body.sessionToken);
    return ContentService.createTextOutput(JSON.stringify(deleteTodo(body.id, who, mgr))).setMimeType(ContentService.MimeType.JSON);

  } else if (action === "clearDoneTodos") {
    return ContentService.createTextOutput(JSON.stringify(clearDoneTodos())).setMimeType(ContentService.MimeType.JSON);

  } else if (action === "listTemplates") {
    return ContentService.createTextOutput(JSON.stringify(listTemplates())).setMimeType(ContentService.MimeType.JSON);

  } else if (action === "saveTemplate") {
    if (!isManagerFromSession(body.sessionToken)) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: "Managers only" })).setMimeType(ContentService.MimeType.JSON);
    }
    return ContentService.createTextOutput(JSON.stringify(saveTemplate(body))).setMimeType(ContentService.MimeType.JSON);

  } else if (action === "deleteTemplate") {
    if (!isManagerFromSession(body.sessionToken)) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: "Managers only" })).setMimeType(ContentService.MimeType.JSON);
    }
    return ContentService.createTextOutput(JSON.stringify(deleteTemplate(body.id))).setMimeType(ContentService.MimeType.JSON);

*/

// ─── PASTE THESE HELPER FUNCTIONS INTO YOUR .gs FILE ─────────────────────────
// (outside the main handler function, anywhere in the file)

/*

// ---------- Todos Sheet helpers (v3) ----------

function getTodosSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName("Todos");
  if (!sh) {
    sh = ss.insertSheet("Todos");
    sh.appendRow(["id","text","category","done","addedBy","addedAt","doneBy","doneAt","date","shiftId","assignedTo","proofValue","templateId"]);
  }
  return sh;
}

function getTemplatesSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName("TaskTemplates");
  if (!sh) {
    sh = ss.insertSheet("TaskTemplates");
    sh.appendRow(["id","text","category","recurrence","targetDuty","requireProof","active"]);
  }
  return sh;
}

function todoDateStr(v) {
  // Sheet may hand back a Date object if the cell auto-formatted; normalize.
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd");
  return String(v || "");
}

function listTodos() {
  var sh = getTodosSheet();
  var data = sh.getDataRange().getValues();
  var items = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[0]) continue;
    items.push({
      id:         String(row[0]),
      text:       String(row[1]),
      category:   String(row[2]),
      done:       row[3] === true || row[3] === "TRUE",
      addedBy:    String(row[4] || ""),
      addedAt:    String(row[5] || ""),
      doneBy:     String(row[6] || ""),
      doneAt:     String(row[7] || ""),
      date:       todoDateStr(row[8]),
      shiftId:    String(row[9]  || ""),
      assignedTo: String(row[10] || ""),
      proofValue: String(row[11] || ""),
      templateId: String(row[12] || "")
    });
  }
  return { ok: true, items: items };
}

function saveTodo(body, addedBy) {
  var text = body.text || "";
  if (!text) return { ok: false, error: "No text provided" };
  var sh = getTodosSheet();
  var id = "todo_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
  sh.appendRow([
    id, text, body.category || "General", false, addedBy, new Date().toISOString(), "", "",
    String(body.date || ""), String(body.shiftId || ""), String(body.assignedTo || ""), "", String(body.templateId || "")
  ]);
  return { ok: true, id: id };
}

// Update assignment/scheduling fields (and optionally text/category).
// Any staff member may assign tasks to anyone — permission is deliberately open.
function updateTodo(body) {
  var sh = getTodosSheet();
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(body.id)) {
      var r = i + 1;
      if (body.text       !== undefined) sh.getRange(r, 2).setValue(String(body.text));
      if (body.category   !== undefined) sh.getRange(r, 3).setValue(String(body.category));
      if (body.date       !== undefined) sh.getRange(r, 9).setNumberFormat("@").setValue(String(body.date));
      if (body.shiftId    !== undefined) sh.getRange(r, 10).setValue(String(body.shiftId));
      if (body.assignedTo !== undefined) sh.getRange(r, 11).setValue(String(body.assignedTo));
      return { ok: true };
    }
  }
  return { ok: false, error: "Todo not found: " + body.id };
}

function toggleTodo(id, done, doneBy, proofValue) {
  var sh = getTodosSheet();
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sh.getRange(i + 1, 4).setValue(done);
      sh.getRange(i + 1, 7).setValue(done ? doneBy : "");
      sh.getRange(i + 1, 8).setValue(done ? new Date().toISOString() : "");
      if (proofValue !== undefined && proofValue !== null && String(proofValue) !== "") {
        sh.getRange(i + 1, 12).setValue(String(proofValue));
      }
      return { ok: true };
    }
  }
  return { ok: false, error: "Todo not found: " + id };
}

// Delete restricted to the creator or a manager.
function deleteTodo(id, requesterName, isManager) {
  var sh = getTodosSheet();
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      var addedBy = String(data[i][4] || "");
      if (!isManager && requesterName && addedBy && addedBy !== requesterName) {
        return { ok: false, error: "Only " + addedBy + " or a manager can delete this task" };
      }
      sh.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: "Todo not found: " + id };
}

function clearDoneTodos() {
  var sh = getTodosSheet();
  var data = sh.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][3] === true || data[i][3] === "TRUE") {
      sh.deleteRow(i + 1);
    }
  }
  return { ok: true };
}

// Called from your deleteShift handler: shift tasks fall back to day tasks
// on the shift's date instead of vanishing with the shift.
function releaseTasksForShift(eventId) {
  if (!eventId) return;
  try {
    var sh = getTodosSheet();
    var data = sh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][9]) === String(eventId) && !(data[i][3] === true || data[i][3] === "TRUE")) {
        sh.getRange(i + 1, 10).setValue(""); // clear shiftId; date + assignee remain
      }
    }
  } catch (e) { } // never block shift deletion on task cleanup
}

// ---------- Task Templates (v3) ----------

function listTemplates() {
  var sh = getTemplatesSheet();
  var data = sh.getDataRange().getValues();
  var items = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[0]) continue;
    items.push({
      id:           String(row[0]),
      text:         String(row[1]),
      category:     String(row[2]),
      recurrence:   String(row[3] || "none"),
      targetDuty:   String(row[4] || ""),
      requireProof: row[5] === true || row[5] === "TRUE",
      active:       row[6] === true || row[6] === "TRUE"
    });
  }
  return { ok: true, items: items };
}

function saveTemplate(body) {
  var sh = getTemplatesSheet();
  if (body.id) {
    var data = sh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(body.id)) {
        sh.getRange(i + 1, 2, 1, 6).setValues([[
          String(body.text || ""), String(body.category || "General"),
          String(body.recurrence || "none"), String(body.targetDuty || ""),
          body.requireProof === true, body.active !== false
        ]]);
        return { ok: true, id: String(body.id) };
      }
    }
    return { ok: false, error: "Template not found: " + body.id };
  }
  var id = "tpl_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
  sh.appendRow([
    id, String(body.text || ""), String(body.category || "General"),
    String(body.recurrence || "none"), String(body.targetDuty || ""),
    body.requireProof === true, body.active !== false
  ]);
  return { ok: true, id: id };
}

function deleteTemplate(id) {
  var sh = getTemplatesSheet();
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sh.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: "Template not found: " + id };
}

// Spawn Todos rows for recurring templates for today AND tomorrow (so evening
// staff can preview). Idempotent: keyed on templateId + date. Runs on every
// listTodos call; cheap at this data volume.
function materializeTemplates() {
  try {
    var tpls = listTemplates().items.filter(function(t) { return t.active && t.recurrence !== "none"; });
    if (!tpls.length) return;

    var sh = getTodosSheet();
    var data = sh.getDataRange().getValues();
    var existing = {};
    for (var i = 1; i < data.length; i++) {
      if (data[i][12]) existing[String(data[i][12]) + "|" + todoDateStr(data[i][8])] = true;
    }

    var tz = Session.getScriptTimeZone();
    var days = [new Date(), new Date(Date.now() + 86400000)];
    days.forEach(function(d) {
      var dateStr = Utilities.formatDate(d, tz, "yyyy-MM-dd");
      var dow     = Utilities.formatDate(d, tz, "EEE");   // Mon, Tue, ...
      var dom     = Utilities.formatDate(d, tz, "d");     // 1..31
      tpls.forEach(function(t) {
        if (!templateMatchesDay(t.recurrence, dow, dom)) return;
        if (existing[t.id + "|" + dateStr]) return;
        var id = "todo_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
        sh.appendRow([id, t.text, t.category, false, "Auto", new Date().toISOString(), "", "", dateStr, "", "", "", t.id]);
        existing[t.id + "|" + dateStr] = true;
      });
    });
  } catch (e) { } // never break listTodos on template errors
}

function templateMatchesDay(recurrence, dow, dom) {
  if (recurrence === "daily") return true;
  if (recurrence === "weekly") return dow === "Mon";
  if (recurrence === "monthly") return dom === "1";
  if (recurrence.indexOf("days:") === 0) {
    return recurrence.substring(5).split(",").map(function(s){ return s.trim(); }).indexOf(dow) >= 0;
  }
  return false;
}

// ---------- Session helpers ----------

// Look up a staff member's name from their session token (same as v2).
// Adjust the sheet/column names to match your session storage.
function getNameFromSession(sessionToken) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName("Sessions");
    if (!sh) return "";
    var data = sh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(sessionToken)) return String(data[i][1] || "");
    }
  } catch(e) {}
  return "";
}

// Is this session a manager? Looks the session's name/email up in your Staff
// sheet's manager column. ADJUST the sheet name and column indexes to match
// your setup. Fails OPEN (returns true) if the lookup can't be resolved, so a
// mismatched sheet layout never bricks task deletion — tighten if you prefer.
function isManagerFromSession(sessionToken) {
  try {
    var name = getNameFromSession(sessionToken);
    if (!name) return true;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName("Staff");           // ← adjust if named differently
    if (!sh) return true;
    var data = sh.getDataRange().getValues();
    var head = data[0].map(function(h){ return String(h).toLowerCase(); });
    var nameCol = head.indexOf("name");
    var mgrCol  = head.indexOf("ismanager");
    if (mgrCol < 0) mgrCol = head.indexOf("manager");
    if (nameCol < 0 || mgrCol < 0) return true;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][nameCol]) === name) {
        return data[i][mgrCol] === true || String(data[i][mgrCol]).toUpperCase() === "TRUE" || String(data[i][mgrCol]).toLowerCase() === "yes";
      }
    }
  } catch(e) {}
  return true;
}

*/
