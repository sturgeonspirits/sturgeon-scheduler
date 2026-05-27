// =============================================================================
// STAFF TO-DO LIST — Google Apps Script backend snippet
// v2 2026-05-26
//
// HOW TO ADD THIS TO YOUR SCHEDULER:
//   1. Open your Google Apps Script project (script.google.com)
//   2. Open your main scheduler.gs file
//   3. Find the big if/else block that checks `action` (e.g. "listShifts", "bootstrap", etc.)
//   4. Paste the CASE HANDLERS below into that block
//   5. Paste the HELPER FUNCTIONS below anywhere in the file (outside the handler)
//   6. Create a new Sheet tab named "Todos" in your Google Sheet
//   7. Save & deploy a new version of your Web App
// =============================================================================

// ─── PASTE THESE CASES INTO YOUR ACTION DISPATCHER ───────────────────────────
// (inside your existing if/else if chain that handles actions)

/*

  } else if (action === "listTodos") {
    return ContentService.createTextOutput(JSON.stringify(listTodos())).setMimeType(ContentService.MimeType.JSON);

  } else if (action === "saveTodo") {
    const text     = body.text     || "";
    const category = body.category || "General";
    // Resolve who's adding the task from the session token
    const adderName = getNameFromSession(body.sessionToken) || "Staff";
    return ContentService.createTextOutput(JSON.stringify(saveTodo(text, category, adderName))).setMimeType(ContentService.MimeType.JSON);

  } else if (action === "toggleTodo") {
    const doneName = getNameFromSession(body.sessionToken) || "Staff";
    return ContentService.createTextOutput(JSON.stringify(toggleTodo(body.id, body.done, doneName))).setMimeType(ContentService.MimeType.JSON);

  } else if (action === "deleteTodo") {
    return ContentService.createTextOutput(JSON.stringify(deleteTodo(body.id))).setMimeType(ContentService.MimeType.JSON);

  } else if (action === "clearDoneTodos") {
    return ContentService.createTextOutput(JSON.stringify(clearDoneTodos())).setMimeType(ContentService.MimeType.JSON);

*/

// ─── PASTE THESE HELPER FUNCTIONS INTO YOUR .gs FILE ─────────────────────────
// (outside the main handler function, anywhere in the file)

/*

// ---------- Todos Sheet helpers ----------
// The "Todos" sheet columns:
// A: id | B: text | C: category | D: done (TRUE/FALSE) | E: addedBy | F: addedAt | G: doneBy | H: doneAt

function getTodosSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName("Todos");
  if (!sh) {
    sh = ss.insertSheet("Todos");
    sh.appendRow(["id", "text", "category", "done", "addedBy", "addedAt", "doneBy", "doneAt"]);
  }
  return sh;
}

function listTodos() {
  var sh = getTodosSheet();
  var data = sh.getDataRange().getValues();
  var items = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    items.push({
      id:       String(row[0]),
      text:     String(row[1]),
      category: String(row[2]),
      done:     row[3] === true || row[3] === "TRUE",
      addedBy:  String(row[4] || ""),
      addedAt:  String(row[5] || ""),
      doneBy:   String(row[6] || ""),
      doneAt:   String(row[7] || "")
    });
  }
  return { ok: true, items: items };
}

function saveTodo(text, category, addedBy) {
  if (!text) return { ok: false, error: "No text provided" };
  var sh = getTodosSheet();
  var id = "todo_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
  sh.appendRow([id, text, category, false, addedBy, new Date().toISOString(), "", ""]);
  return { ok: true, id: id };
}

function toggleTodo(id, done, doneBy) {
  var sh = getTodosSheet();
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sh.getRange(i + 1, 4).setValue(done);           // column D: done
      sh.getRange(i + 1, 7).setValue(done ? doneBy : "");  // column G: doneBy
      sh.getRange(i + 1, 8).setValue(done ? new Date().toISOString() : ""); // column H: doneAt
      return { ok: true };
    }
  }
  return { ok: false, error: "Todo not found: " + id };
}

function deleteTodo(id) {
  var sh = getTodosSheet();
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sh.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: "Todo not found: " + id };
}

function clearDoneTodos() {
  var sh = getTodosSheet();
  var data = sh.getDataRange().getValues();
  // Iterate backwards so row deletion doesn't shift indices
  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][3] === true || data[i][3] === "TRUE") {
      sh.deleteRow(i + 1);
    }
  }
  return { ok: true };
}

// Helper: look up a staff member's name from their session token.
// This assumes you already have a session/auth system in place.
// Adjust to match however your script resolves sessions → names.
function getNameFromSession(sessionToken) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName("Sessions"); // adjust sheet name if different
    if (!sh) return "";
    var data = sh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(sessionToken)) return String(data[i][1] || "");
    }
  } catch(e) {}
  return "";
}

*/
