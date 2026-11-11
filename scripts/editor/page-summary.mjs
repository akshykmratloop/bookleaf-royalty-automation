// Read-only summaries of a Bubble page's JSON (what the editor's appquery `.raw()` returns):
// the element tree, custom states and workflows, one line each. Pure functions; dump-page.mjs prints them.

const MAX_EXPR = 300; // long conditions are clipped in the printout only; the saved dump keeps them whole

const clip = (s) => (s.length > MAX_EXPR ? `${s.slice(0, MAX_EXPR)}…` : s);
const byNumber = (a, b) => Number(a) - Number(b);
const isObject = (v) => v !== null && typeof v === 'object';

/** `key=value, …` for an options object; nested expressions are rendered, plain strings left bare. */
function renderProps(props) {
  return Object.entries(props ?? {})
    .map(([k, v]) => `${k}=${renderValue(v)}`)
    .join(', ');
}

function renderValue(v) {
  if (Array.isArray(v)) return `[${v.map(renderValue).join(', ')}]`;
  if (isObject(v)) return v.type ? renderExpr(v) : `{${renderProps(v)}}`;
  return String(v);
}

function renderText(e) {
  return Object.keys(e.entries ?? {})
    .sort(byNumber)
    .map((k) => (typeof e.entries[k] === 'string' ? JSON.stringify(e.entries[k]) : `[${renderExpr(e.entries[k])}]`))
    .join(' + ');
}

function renderSearch(p) {
  const constraints = Object.keys(p.constraints ?? {})
    .sort(byNumber)
    .map((k) => {
      const c = p.constraints[k];
      return [c.key, c.constraint_type, c.value === undefined ? '' : renderValue(c.value)].filter(Boolean).join(' ');
    });
  return `Search(${[p.type_to_find, constraints.join(', ')].filter(Boolean).join('; ')})`;
}

/** One link of an expression chain: a source (CurrentUser, Search, …) or an operator ("Message"). */
function renderNode(n) {
  const p = n.properties ?? {};
  const hasProps = Object.keys(p).length > 0;
  switch (n.type) {
    case 'Message':
      return `${n.name}${hasProps ? `{${renderProps(p)}}` : ''}${n.args === undefined ? '' : `(${renderExpr(n.args)})`}`;
    case 'GetElement':
      return `element(${p.element_id})`;
    case 'Search':
      return renderSearch(p);
    case 'OptionValue':
      return `${p.option_set}.${p.option_value}`;
    case 'PageData':
      return `PageData(${p.name})`;
    case 'ElementParent':
      return "Parent group's thing";
    default:
      return `${n.type}${hasProps ? `{${renderProps(p)}}` : ''}`;
  }
}

/** A Bubble expression as one readable line: `CurrentUser > role_option_role > equals(option.role.Admin)`. */
export function renderExpr(e) {
  if (e === undefined || e === null) return '';
  if (!isObject(e)) return typeof e === 'string' ? JSON.stringify(e) : String(e);
  if (e.type === 'TextExpression') return renderText(e);
  if (!e.type) return `{${renderProps(e)}}`;
  const links = [];
  for (let n = e; n; n = n.next) links.push(renderNode(n));
  return links.join(' > ');
}

/** Paths in an element's own properties and conditions that read "Parent group's …" (children excluded). */
export function parentRefs(element) {
  const hits = [];
  const walk = (v, path) => {
    if (!isObject(v)) return;
    if (v.type === 'ElementParent') hits.push(path);
    for (const [k, child] of Object.entries(v)) walk(child, `${path}.${k}`);
  };
  walk(element.properties, 'properties');
  walk(element.states, 'states');
  return hits;
}

/** A map's real entries: the live index page also stores a numeric `length` in its elements and workflows maps. */
const entries = (map) => Object.entries(map ?? {}).filter(([, v]) => isObject(v));

const ordered = (elements) =>
  entries(elements).sort(([ka, a], [kb, b]) => (a.properties?.order ?? Infinity) - (b.properties?.order ?? Infinity) || ka.localeCompare(kb));

/** Calls visit(key, element, depth) depth first, siblings in Bubble's `order`. */
function walkElements(elements, visit, depth = 0) {
  for (const [key, el] of ordered(elements)) {
    visit(key, el, depth);
    walkElements(el.elements, visit, depth + 1);
  }
}

function visibilityConditions(el) {
  const states = Object.values(el.states ?? {}).filter((s) => s.properties && 'is_visible' in s.properties);
  const of = (flag) => states.filter((s) => s.properties.is_visible === flag).map((s) => renderExpr(s.condition));
  return { showWhen: of(true), hideWhen: of(false) };
}

/** Every element, flattened depth first, with what later stages need before moving it. */
export function elementRows(elements) {
  const rows = [];
  walkElements(elements, (key, el, depth) => {
    const p = el.properties ?? {};
    rows.push({
      depth, key, type: el.type, id: el.id ?? '', name: el.name ?? '',
      htmlId: p.unique_id ? renderExpr(p.unique_id) : '',
      order: p.order ?? null,
      visible: p.is_visible !== false,
      ...visibilityConditions(el),
      source: p.data_source ? renderExpr(p.data_source) : '',
      groupType: p.group_type ?? '',
      parentRefs: parentRefs(el),
    });
  });
  return rows;
}

function actionRows(actions) {
  return Object.keys(actions ?? {})
    .sort(byNumber)
    .map((k) => {
      const { condition, ...rest } = actions[k].properties ?? {};
      return { index: Number(k), type: actions[k].type, id: actions[k].id ?? '', props: renderProps(rest), condition: condition ? renderExpr(condition) : '' };
    });
}

/** Every workflow: event type, its element, its condition and its actions in run order. */
export function workflowRows(workflows) {
  return entries(workflows).map(([key, wf]) => {
    const { element_id: element = '', condition, ...rest } = wf.properties ?? {};
    return {
      key, id: wf.id ?? '', name: wf.name ?? '', event: wf.type, element,
      condition: condition ? renderExpr(condition) : '',
      extra: renderProps(rest),
      actions: actionRows(wf.actions),
    };
  });
}

/** Custom states on the page and on any element. */
export function customStateRows(page) {
  const rows = entries(page.custom_states).map(([name, s]) => ({ owner: 'page', name, type: s.value }));
  walkElements(page.elements, (key, el) => {
    for (const [name, s] of entries(el.custom_states)) rows.push({ owner: el.id ?? key, name, type: s.value });
  });
  return rows;
}

function elementLine(r) {
  const bits = [r.key, r.type, r.id, r.name && r.name !== r.id ? `"${r.name}"` : '', r.htmlId ? `#${r.htmlId}` : '', r.order === null ? '' : `o${r.order}`, r.visible ? 'vis' : 'HIDDEN'];
  if (r.groupType) bits.push(`type=${r.groupType}`);
  if (r.source) bits.push(`src=${clip(r.source)}`);
  if (r.parentRefs.length) bits.push(`parent@${r.parentRefs.join(',')}`);
  for (const c of r.showWhen) bits.push(`show-if[${clip(c)}]`);
  for (const c of r.hideWhen) bits.push(`hide-if[${clip(c)}]`);
  return `${'  '.repeat(r.depth + 1)}${bits.filter(Boolean).join(' ')}`;
}

function workflowLines(w) {
  const head = [w.key, w.event, w.element ? `on ${w.element}` : '', w.id ? `id=${w.id}` : '', w.name ? `"${w.name}"` : '', w.extra ? `{${clip(w.extra)}}` : '', w.condition ? `if ${clip(w.condition)}` : ''];
  const actions = w.actions.map((a) => `    ${a.index} ${[a.type, clip(a.props), a.condition ? `if ${clip(a.condition)}` : ''].filter(Boolean).join(' ')}`);
  return [`  ${head.filter(Boolean).join(' ')}`, ...actions];
}

/** The printable block for one page. */
export function summarizePage(name, page, file) {
  const states = customStateRows(page).map((s) => `${s.owner}.${s.name}:${s.type}`);
  return [
    `=== ${name} (${page.id}) saved to ${file}`,
    'elements:',
    ...elementRows(page.elements).map(elementLine),
    `custom states: ${states.join(', ') || '(none)'}`,
    'workflows:',
    ...workflowRows(page.workflows).flatMap(workflowLines),
  ].join('\n');
}
