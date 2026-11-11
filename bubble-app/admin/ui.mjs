// Element builders. They keep the app's style names (so the design-system variables still apply)
// and lay the Assignment 1 look on top as inline properties from theme.mjs.
import { text as tx } from './expr.mjs';
import { T, TYPE, BUTTONS, VARIANT_OF_STYLE, INPUT, INPUT_FOCUS, SMOOTH, card as cardLook, fill, border, shadow, pad } from './theme.mjs';

const asText = (t) => (typeof t === 'string' ? tx(t) : t);

/** Children array -> Bubble's id-keyed map, with `order` set from position. */
function kids(children) {
  return Object.fromEntries(
    children.filter(Boolean).map((c, i) => [c.id, { ...c, properties: { ...c.properties, order: i + 1 } }]),
  );
}

function el(type, id, style, properties, extra = {}) {
  const base = { type, id, default_name: `${type} ${id}`, name: extra.name ?? id, properties, ...extra };
  return style ? { ...base, style } : base;
}

/** Conditional formatting, appended after any states the element already has (later states win). */
export function withStates(element, states) {
  const existing = Object.values(element.states ?? {});
  const added = states.map((s) => ({ condition: s.when, properties: s.set, type: 'State' }));
  return { ...element, states: Object.fromEntries([...existing, ...added].map((s, i) => [i, s])) };
}

const thisElement = (message) => ({ type: 'ThisElement', is_slidable: false, next: { type: 'Message', name: message, is_slidable: false } });
export const hover = (element, set) => withStates({ ...element, transitions: SMOOTH }, [{ when: thisElement('is_hovered'), set }]);

/** A flex container. layout: 'column' | 'row'. */
export function group(id, children, { layout = 'column', gap = 12, style = 'Group_default_', props = {}, ...extra } = {}) {
  const p = { container_layout: layout, use_gap: gap > 0, row_gap: gap, column_gap: gap, fit_height: true, ...props };
  return { ...el('Group', id, style, p, extra), elements: kids(children) };
}

export const row = (id, children, opts = {}) => group(id, children, { layout: 'row', ...opts, props: { vert_alignment: 'center', ...opts.props } });

/** White card: 16px radius, hairline border, soft shadow. */
export const card = (id, children, opts = {}) => group(id, children, { ...opts, props: { ...cardLook(), ...opts.props } });

/** Grows to fill a row (flex: 1). */
export const grow = (props = {}) => ({ fit_width: false, min_width_css: '0px', ...props });

/** Inner groups pass the thing down ("Parent group's X" only looks one group up in Bubble). */
function inherit(node, type) {
  if (node.type !== 'Group' || node.properties.group_type) return node;
  const elements = Object.fromEntries(Object.entries(node.elements ?? {}).map(([k, c]) => [k, inherit(c, type)]));
  return { ...node, properties: { ...node.properties, group_type: `custom.${type}`, data_source: { type: 'ElementParent', is_slidable: false } }, elements };
}

/** A group that holds one thing (rows, drawers): data_source + group_type. */
export function thingGroup(id, type, dataSource, children, opts = {}) {
  const g = group(id, children, { ...opts, props: { data_source: dataSource, group_type: `custom.${type}`, ...opts.props } });
  return { ...g, elements: Object.fromEntries(Object.entries(g.elements).map(([k, c]) => [k, inherit(c, type)])) };
}

/** Text. `look` is a TYPE preset name ('h1', 'sub', 'micro', ...) or a property object. */
export function label(id, t, look = 'body', props = {}, extra = {}) {
  const preset = typeof look === 'string' ? (TYPE[look] ?? {}) : look;
  return el('Text', id, 'Text_body_', { text: asText(t), fit_height: true, ...preset, ...props }, extra);
}

/** Fixed-width table cell text. */
export const cell = (id, t, width, { align = 'left', look = 'cell', ...extra } = {}) =>
  label(id, t, look, { width, single_width: true, min_width_css: `${width}px`, font_alignment: align, vert_alignment: 'center' }, extra);

/** Flexible (grows) table cell text. */
export const flexCell = (id, t, { look = 'cell', ...extra } = {}) =>
  label(id, t, look, { fit_width: false, min_width_css: '0px', font_alignment: 'left', vert_alignment: 'center' }, extra);

/** Button. `variant` is primary | secondary | soft | ghost | danger (old style names also work). */
export function button(id, t, variant = 'primary', props = {}, extra = {}) {
  const v = BUTTONS[VARIANT_OF_STYLE[variant] ?? variant] ?? BUTTONS.primary;
  const style = v === BUTTONS.primary ? 'Button_primary_' : 'Button_ghost_';
  const p = { text: asText(t), fit_width: true, fit_height: true, vert_alignment: 'center', ...pad(9, 16), ...v.look, ...props };
  return hover(el('Button', id, style, p, extra), v.hover);
}

/** Phosphor icon, e.g. icon('x', 'house'). */
export const icon = (id, name, color = T.text3, size = 18) =>
  el('Icon', id, null, { icon: `phosphor outline ${name}`, icon_color: color, width: size, height: size, single_width: true, single_height: true, min_width_css: `${size}px`, min_height_css: `${size}px`, fit_width: false, fit_height: false });

export function input(id, placeholder, props = {}) {
  const base = el('Input', id, 'Input_default_', {
    height: 40, content_format: 'text', placeholder: asText(placeholder), fit_height: false,
    min_width_css: '220px', single_height: true, min_height_css: '40px', ...INPUT, ...props,
  });
  return withStates(base, [{ when: thisElement('is_focused'), set: INPUT_FOCUS }]);
}

/** Multi-line text box with optional starting content. */
export function multiline(id, placeholder, content, props = {}) {
  const p = { placeholder: asText(placeholder), fit_height: false, min_width_css: '0px', min_height_css: '320px', height: 320, ...INPUT, ...pad(12), line_height: 1.55, ...props };
  if (content) p.content = content;
  return withStates(el('MultiLineInput', id, null, p), [{ when: thisElement('is_focused'), set: INPUT_FOCUS }]);
}

/** Dropdown of texts from an expression (e.g. the list of cities). */
export const textDropdown = (id, placeholder, dataSource, props = {}) =>
  el('Dropdown', id, 'Dropdown_standard_dropdown_', {
    height: 40, data_source: dataSource, placeholder: asText(placeholder), dynamic_type: 'text',
    choices_style: 'dynamic', fit_height: false, min_width_css: '180px', single_height: true, min_height_css: '40px',
    option_display_expression: tx({ type: 'InjectedValue', is_slidable: false }), ...INPUT, ...props,
  });

export const html = (id, content, props = {}) =>
  el('HTML', id, null, { html: content, fit_height: true, min_width_css: '0px', min_height_css: '0px', ...props });

/** A repeating group: one `rowGroup` (a thingGroup over the parent cell) per item. */
export const list = (id, type, dataSource, rowGroup, props = {}) => ({
  ...el('RepeatingGroup', id, 'RepeatingGroup_default_', {
    data_source: dataSource, group_type: `custom.${type}`, separator_style: 'none', fit_height: true,
    fixed_rows: false, show_all_items: true, container_layout: 'column', cell_min_height_css: '0px', ...props,
  }),
  elements: kids([rowGroup]),
});

/** A drawer-like popup: 24px corners, floating shadow, soft blurred backdrop. */
export function popup(id, type, children, width = 860) {
  return {
    ...el('Popup', id, 'Popup_default_', {
      width, group_type: `custom.${type}`, row_gap: 16, use_gap: true, fit_height: true, ...pad(28),
      max_width_css: `${width}px`, min_width_css: '320px', container_layout: 'column',
      ...fill(T.panel), ...border(T.panel, 24), ...shadow('float'),
      greyout_color: 'rgba(16,20,28,0.45)', greyout_blur: 3,
    }),
    elements: kids(children),
  };
}

/** Hidden until `when` is true (collapses when hidden). */
export const showWhen = (element, when) =>
  withStates({ ...element, properties: { ...element.properties, is_visible: false, collapse_when_hidden: true } }, [
    { when, set: { is_visible: true } },
  ]);

export const hideWhen = (element, when) =>
  withStates({ ...element, properties: { ...element.properties, collapse_when_hidden: true } }, [
    { when, set: { is_visible: false } },
  ]);

/** Gives an element an HTML id (the app exposes ID attributes), so page CSS can target it. */
export const withHtmlId = (element, htmlId) => ({ ...element, properties: { ...element.properties, unique_id: tx(htmlId) } });
