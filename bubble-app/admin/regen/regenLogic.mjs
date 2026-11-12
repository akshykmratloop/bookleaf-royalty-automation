// Pure rules for the in-place "Regenerate draft" animation in the review pop-up. They are tested
// here and copied, as source text, into the page script (regen.js.mjs), so each function must stay
// self-contained: no imports, no outer variables, plain ES5 inside.
//
// The pop-up's anchor element (regenAnchor.mjs) reports, as data attributes:
//   prev   – id of the draft being replaced (empty when no regenerate has happened in this pop-up)
//   log    – id of the log the pop-up shows now (the old draft until the new one is created)
//   status – that log's status (Queued, Processing, Draft ready, Failed, Discarded, ...)
//   stage  – n8n's live stage (queued, reading_data, writing, checking, rewriting, drafted, ...)
//   start  – when that log was requested ('yyyy-mm-dd HH:MM:ss', the page's local time)
//   error  – n8n's error ('CODE: reason') when it failed

/**
 * Which picture the mask shows: 'idle' (no mask), 'live' (being rewritten), 'ready' (new draft in),
 * or 'failed'. `clickedAt` is when Regenerate was clicked (0 if never), `now` the current time (ms).
 * A click shows 'live' straight away, before Bubble's data catches up.
 */
export function regenPhase(src, clickedAt, now) {
  var OPTIMISTIC_MS = 6000, NO_START_MS = 45000;
  var since = clickedAt > 0 ? now - clickedAt : Infinity;
  if (since < OPTIMISTIC_MS) return 'live';
  if (!src || !src.prev) return 'idle';
  var status = src.status || '';
  if (status === 'Failed') return 'failed';
  if (src.prev === src.log) return since > NO_START_MS ? 'failed' : 'live';
  if (status === 'Queued' || status === 'Processing') return 'live';
  if (status === 'Draft ready') return 'ready';
  return since < NO_START_MS ? 'live' : 'idle';
}

/** What to do when the phase changes: 'enter' | 'done' | 'fail' | 'clear' | 'stay'. */
export function regenMove(from, to) {
  if (from === to) return 'stay';
  if (to === 'live') return 'enter';
  if (to === 'ready') return from === 'live' ? 'done' : 'clear';
  if (to === 'failed') return 'fail';
  return 'clear';
}

/** n8n stage -> step index on the mask: 0 Reading data, 1 Writing with AI, 2 Fact-checking, 3 done, -1 not started. */
export function regenStep(stage) {
  var AT = { reading_data: 0, writing: 1, checking: 2, rewriting: 2, drafted: 3 };
  return AT[stage] === undefined ? -1 : AT[stage];
}

/** The words for a step index (see regenStep). */
export function regenStepLabel(step) {
  var LABELS = ['Reading data', 'Writing with AI', 'Fact-checking', 'Done'];
  return step < 0 ? 'Getting ready' : LABELS[Math.min(step, 3)];
}

/** 'yyyy-mm-dd HH:MM:ss' (local) -> ms, or 0 when empty or unreadable. */
export function regenStamp(value) {
  var t = Date.parse(String(value || '').replace(' ', 'T'));
  return isNaN(t) ? 0 : t;
}

/** Seconds counter text: '7s', '1m 04s'. */
export function regenElapsed(startMs, now) {
  if (!startMs) return '';
  var s = Math.max(0, Math.round((now - startMs) / 1000));
  if (s < 60) return s + 's';
  var r = s % 60;
  return Math.floor(s / 60) + 'm ' + (r < 10 ? '0' : '') + r + 's';
}

/** The calm failure note: { title, detail }. `error` is n8n's 'CODE: reason' (may be empty). */
export function regenFailNote(error, stuck) {
  var title = 'No new draft this time. Your previous text is back, unchanged.';
  if (stuck) return { title: title, detail: 'The new draft did not start. Close this pop-up and open the draft again.' };
  var raw = String(error || '').trim();
  var reason = raw.indexOf(':') > 0 ? raw.slice(raw.indexOf(':') + 1).trim() : raw;
  if (reason.length > 160) reason = reason.slice(0, 157) + '...';
  if (reason && !/[.!?]$/.test(reason)) reason += '.';
  return { title: title, detail: (reason ? 'Reason: ' + reason + ' ' : '') + 'You can try Regenerate again.' };
}
