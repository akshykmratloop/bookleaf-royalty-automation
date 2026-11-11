// Live progress for one send: a stepper (Queued → Reading data → Writing with AI → Fact-checking →
// Sending/Draft ready) with a running seconds timer. Bubble writes the log's stage and times into
// data attributes; the page script in assets.mjs draws the steps and ticks the timer every 0.5 s.
import { chain, f, op, text, dateFmt, optionValue } from '../expr.mjs';
import { html } from '../ui.mjs';

const STAMP = 'yyyy-mm-dd HH:MM:ss';
const created = { type: 'Message', name: 'Created Date', is_slidable: false };

/** `log(...ops)` reads from the log the stepper is about (e.g. a row's parent, a drawer's data). */
export function progress(id, log) {
  return html(id, text(
    '<div class="bl-stp" data-kind="', log(f.text('delivery'), op('defaulting_to', { args: 'send' })),
    '" data-stage="', log(f.text('stage'), op('defaulting_to', { args: 'queued' })),
    '" data-status="', log(f.option('status', 'sendstatus'), op('display')),
    // requested_at is reset when a draft is approved, so the timer then measures the send itself
    '" data-start="', log(f.date('requested_at'), op('defaulting_to', { args: log(created) }), dateFmt(STAMP)),
    '" data-end="', log(f.date('completed_at'), dateFmt(STAMP)),
    '"></div>',
  ), { min_height_css: '22px' });
}

/** True while a log is still on its way (Queued or Processing). */
export const isLive = (log) =>
  chain(
    log(f.option('status', 'sendstatus'), op('equals', { args: optionValue('sendstatus', 'Processing') })),
    op('or_', { args: log(f.option('status', 'sendstatus'), op('equals', { args: optionValue('sendstatus', 'Queued') })) }),
  );
