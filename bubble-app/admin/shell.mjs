// The app shell: a 248px sidebar (brand, navigation, signed-in admin, log out) and a top bar.
// A page state `view` picks the section shown in the content area; empty means Overview.
import { chain, op, text, state, currentUser, dateFmt } from './expr.mjs';
import { group, row, label, button, icon, html, hover, withStates, withHtmlId, showWhen, grow } from './ui.mjs';
import { T, fill, border, sideBorder, pad, font } from './theme.mjs';
import { PAGE, refDate, logsWithStatus } from './queries.mjs';
import { SHELL_HTML } from './assets.mjs';

/** [key, nav caption, phosphor icon] in sidebar order. */
export const VIEWS = [
  ['overview', 'Overview', 'squares-four'],
  ['authors', 'Authors', 'users-three'],
  ['drafts', 'Drafts to review', 'note-pencil'],
  ['log', 'Notification log', 'clock-counter-clockwise'],
  ['email', 'Email settings', 'envelope-simple'],
  ['system', 'System & drills', 'sliders-horizontal'],
];

const view = () => state(PAGE, 'view');
export const viewIs = (key) =>
  key === 'overview'
    ? chain(view(), op('is_empty'), op('or_', { args: chain(view(), op('equals', { args: 'overview' })) }))
    : chain(view(), op('equals', { args: key }));

const count = (e) => chain(e, op('count'));
export const draftCount = () => count(logsWithStatus('Draft ready'));

function navItem([key, caption, iconName]) {
  const active = viewIs(key);
  const counter = key === 'drafts'
    ? showWhen(label(`ad_nav_${key}_n`, text(draftCount()), font(11, 800, '#ffffff'), { ...fill(T.brand), ...border(T.brand, 999), ...pad(1, 7), fit_width: true }), chain(draftCount(), op('greater_than', { args: 0 })))
    : null;
  const item = row(`ad_nav_${key}`, [
    withStates(icon(`ad_nav_${key}_i`, iconName, T.text3, 17), [{ when: active, set: { icon_color: T.brand } }]),
    withStates(label(`ad_nav_${key}_t`, caption, font(13, 600, T.text2), grow()), [{ when: active, set: { font_color: T.brandInk } }]),
    counter,
  ], { gap: 10, props: { ...pad(9, 12), ...border('rgba(0,0,0,0)', 12), min_height_css: '38px' } });
  return withStates(hover(item, fill(T.panel2)), [{ when: active, set: fill(T.brandSoft) }]);
}

function brandRow() {
  const mark = group('ad_logo', [label('ad_logo_t', '/', font(16, 800, '#ffffff'), { font_alignment: 'center' })], {
    props: { ...fill('#f16977'), ...border('#f16977', 8), width: 30, height: 30, single_width: true, single_height: true, min_width_css: '30px', min_height_css: '30px', fit_height: false, vert_alignment: 'center', horiz_alignment: 'center' },
  });
  return row('ad_brand_row', [
    mark,
    group('ad_brand_txt', [label('ad_brand', 'BookLeaf', font(16, 800, T.text1)), label('ad_brand_sub', 'Royalty operations', 'hint')], { gap: 0 }),
  ], { gap: 10 });
}

function footer() {
  return group('ad_side_foot', [
    label('ad_me', text(chain(currentUser(), op('email'))), font(12.5, 700, T.text1), { min_width_css: '0px' }),
    label('ad_role', 'Admin · full access', 'hint'),
    button('ad_logout', 'Log out', 'ghost', { ...pad(6, 10) }),
  ], { gap: 4, props: { ...sideBorder('top'), padding_top: 16 } });
}

export function sidebar() {
  const side = group('ad_side', [
    html('ad_css', SHELL_HTML, { min_height_css: '0px', height: 0 }),
    brandRow(),
    group('ad_nav', VIEWS.map(navItem), { gap: 4 }),
    group('ad_side_fill', [], { props: { fit_height: false, min_height_css: '16px' } }),
    footer(),
  ], { gap: 24, props: { ...fill(T.panel), ...sideBorder('right'), ...pad(18, 16), width: 248, single_width: true, min_width_css: '248px', max_width_css: '248px', fit_height: false, min_height_css: '100vh' } });
  return withHtmlId(side, 'ad_side');
}

export function topBar() {
  const anyLive = chain(logsWithStatus('Processing'), op('count'), op('greater_than', { args: 0 }));
  const dot = withStates(group('ad_live_dot', [], { props: { ...fill(TONE_OK), ...border(TONE_OK, 999), width: 8, height: 8, single_width: true, single_height: true, min_width_css: '8px', min_height_css: '8px', fit_height: false } }), [
    { when: anyLive, set: { bgcolor: T.brand, border_color: T.brand } },
  ]);
  const status = withStates(label('ad_live_t', 'Connected to n8n · checks for results every 3 s', 'hint'), [
    { when: anyLive, set: { text: text('Working: ', count(logsWithStatus('Processing')), ' email(s) in progress'), font_color: T.brandInk } },
  ]);
  return row('ad_top', [
    dot, status,
    group('ad_top_fill', [], { props: grow({ min_height_css: '1px' }) }),
    label('ad_top_asof', text('Statuses as of ', chain(refDate(), dateFmt('d mmm yyyy'))), font(12, 700, T.text2), { ...fill(T.panel), ...border(T.border, 999), ...pad(4, 10), fit_width: true }),
    label('ad_top_mode', 'Pull mode · Bubble free plan', font(12, 700, T.navy), { ...fill(T.navySoft), ...border(T.navySoft, 999), ...pad(4, 10), fit_width: true }),
  ], { gap: 10, props: { ...fill('rgba(246,245,247,0.92)'), ...sideBorder('bottom'), ...pad(14, 28), min_height_css: '56px' } });
}

const TONE_OK = '#0f8a4f';
