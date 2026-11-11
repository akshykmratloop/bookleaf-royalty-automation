// The admin page, as data. `scripts/editor/write-admin.mjs` writes it into the Bubble editor;
// `page.test.js` checks every reference in it (elements, states, steps, fields) before it ships.
import { header, kpis } from './sections/overview.mjs';
import { bulkCard } from './sections/bulk.mjs';
import { authorsTable } from './sections/authors.mjs';
import { logSection } from './sections/log.mjs';
import { settingsCard } from './sections/settings.mjs';
import { authorPopup, emailPopup } from './sections/popups.mjs';
import { sendOne, bulkStep } from './workflows/send.mjs';
import { poller } from './workflows/poll.mjs';
import { clickWorkflows } from './workflows/clicks.mjs';

/** The existing page's main group (kept: its id, the top bar, logout and the role guards). */
export const MAIN_GROUP_KEY = 'bTGMi';

export const MAIN_PROPS = {
  row_gap: 32, use_gap: true, fit_height: true, padding_top: 32, padding_left: 24, padding_right: 24,
  padding_bottom: 48, max_width_css: '1200px', horiz_alignment: 'center', container_layout: 'column',
};

export const CUSTOM_STATES = {
  ref_date: { display: 'ref_date', value: 'date', rank: 0, make_static: true },
  status_filter: { display: 'status_filter', value: 'text', rank: 1 },
  cur_author: { display: 'cur_author', value: 'custom.author', rank: 2 },
  cur_mode: { display: 'cur_mode', value: 'text', rank: 3 },
  cur_batch: { display: 'cur_batch', value: 'text', rank: 4 },
};

const ordered = (els) => Object.fromEntries(els.map((e, i) => [e.id, { ...e, properties: { ...e.properties, order: i + 1 } }]));

export function buildAdminPage() {
  return {
    mainChildren: ordered([header(), kpis(), bulkCard(), authorsTable(), logSection(), settingsCard()]),
    popups: [authorPopup(), emailPopup()],
    workflows: [sendOne(), bulkStep(), poller(), ...clickWorkflows()],
    customStates: CUSTOM_STATES,
  };
}
