// The admin page, as data. `scripts/editor/write-admin.mjs` writes it into the Bubble editor;
// `page.test.js` checks every reference in it (elements, states, steps, fields) before it ships.
// Layout: page (row) = sidebar + main column; main = top bar + centred content; one view at a time.
import { group, showWhen, withHtmlId } from './ui.mjs';
import { T, fill } from './theme.mjs';
import { sidebar, topBar, viewIs, VIEWS } from './shell.mjs';
import { overviewSection } from './sections/overview.mjs';
import { authorsSection } from './sections/authors.mjs';
import { draftsSection } from './sections/drafts.mjs';
import { logSection } from './sections/log.mjs';
import { emailSettingsSection } from './sections/emailSettings.mjs';
import { settingsSection } from './sections/settings.mjs';
import { authorPopup } from './sections/authorDrawer.mjs';
import { reviewPopup } from './sections/reviewDrawer.mjs';
import { emailPopup, liveStrip } from './sections/popups.mjs';
import { sendOne, bulkStep } from './workflows/send.mjs';
import { poller } from './workflows/poll.mjs';
import { clickWorkflows } from './workflows/clicks.mjs';
import { reviewWorkflows } from './workflows/review.mjs';
import { draftWorkflows } from './workflows/draftsFlow.mjs';

/** The existing page's main group (kept: its id, logout and the role-guard workflows). */
export { VIEWS };
export const MAIN_GROUP_KEY = 'bTGMi';
/** Old top-level elements replaced by the sidebar shell. */
export const REMOVED_KEYS = ['bTGMg', 'bTGMj'];

export const PAGE_PROPS = { container_layout: 'row', use_gap: false, row_gap: 0, column_gap: 0, ...fill(T.bg) };

export const MAIN_PROPS = {
  container_layout: 'column', use_gap: false, row_gap: 0, fit_width: false, fit_height: false, min_width_css: '0px',
  min_height_css: '100vh', max_width_css: 'none', padding_top: 0, padding_left: 0, padding_right: 0, padding_bottom: 0,
  horiz_alignment: 'center', ...fill(T.bg),
};

const TEXT_STATES = ['status_filter', 'cur_mode', 'cur_batch', 'view', 'ad_tab', 'cur_delivery', 'cur_tone', 'cur_len', 'cur_note',
  'rv_tone', 'rv_len', 'rv_checked', 'rv_issues', 'rv_preview', 'approving_all'];

export const CUSTOM_STATES = {
  ref_date: { display: 'ref_date', value: 'date', rank: 0, make_static: true },
  cur_author: { display: 'cur_author', value: 'custom.author', rank: 1 },
  ...Object.fromEntries(TEXT_STATES.map((name, i) => [name, { display: name, value: 'text', rank: i + 2 }])),
};

const ordered = (els) => Object.fromEntries(els.map((e, i) => [e.id, { ...e, properties: { ...e.properties, order: i + 1 } }]));

function content() {
  return group('ad_content', [
    liveStrip(),
    showWhen(overviewSection(), viewIs('overview')),
    showWhen(authorsSection(), viewIs('authors')),
    showWhen(draftsSection(), viewIs('drafts')),
    showWhen(logSection(), viewIs('log')),
    showWhen(emailSettingsSection(), viewIs('email')),
    showWhen(settingsSection(), viewIs('system')),
  ], { gap: 20, props: { fit_width: false, min_width_css: '0px', max_width_css: '1320px', padding_top: 24, padding_left: 28, padding_right: 28, padding_bottom: 64 } });
}

export function buildAdminPage() {
  return {
    side: sidebar(),
    mainProps: withHtmlId({ properties: MAIN_PROPS }, 'ad_main').properties,
    mainChildren: ordered([topBar(), content()]),
    popups: [authorPopup(), reviewPopup(), emailPopup()],
    workflows: [sendOne(), bulkStep(), poller(), ...clickWorkflows(), ...reviewWorkflows(), ...draftWorkflows()],
    customStates: CUSTOM_STATES,
  };
}
