// =============================================================================
// BIWEEKLY SCHEDULING SUPPORT — Google Apps Script patch
// v1 2026-06-08
//
// The frontend now sends repeat.interval = 1 (weekly) or 2 (biweekly) when
// creating a recurring shift. Your createShift handler needs to use that value
// when stepping through recurrence dates.
//
// HOW TO APPLY:
//   1. Open your Google Apps Script project (script.google.com)
//   2. Find the `createShift` action handler in your .gs file
//   3. Locate the repeat/recurrence loop — it currently looks roughly like:
//
//      var weeks  = parseInt(repeat.weeks || 8, 10);
//      for (var w = 0; w < weeks; w++) {
//        var shiftStart = new Date(startISO.getTime() + w * 7 * 24 * 3600 * 1000);
//        ...
//      }
//
//   4. Change it to use `interval` (defaulting to 1 if absent):
//
//      var weeks    = parseInt(repeat.weeks || 8, 10);
//      var interval = parseInt(repeat.interval || 1, 10);  // <-- ADD THIS
//      for (var w = 0; w < weeks; w++) {
//        var shiftStart = new Date(startISO.getTime() + w * interval * 7 * 24 * 3600 * 1000);
//        ...
//      }
//
//   5. Save & deploy a new version of your Web App.
//
// That's the only change needed. The frontend already sends interval=1 for
// weekly and interval=2 for biweekly, so existing weekly shifts are unaffected.
// =============================================================================
