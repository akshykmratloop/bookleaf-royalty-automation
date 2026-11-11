// Element builders that reuse the app's design-system styles (the same ones the author portal uses).
import { text as tx } from './expr.mjs';

const asText = (t) => (typeof t === 'string' ? tx(t) : t);

/** Children array -> Bubble's id-keyed map, with `order` set from position. */
function kids(children) {
  return Object.fromEntries(
    children.filter(Boolean).map((c, i) => [c.id, { ...c, properties: { ...c.properties, order: i + 1 } }]),
  );
}

function el(type, id, style, properties, extra = {}) {
  return { type, id, default_name: `${type} ${id}`, name: extra.name ?? id, style, properties, ...extra };
}

/** A flex container. layout: 'column' | 'row'. */
export function group(id, children, { layout = 'column', gap = 12, style = 'Group_default_', props = {}, ...extra } = {}) {
  const p = { container_layout: layout, use_gap: gap > 0, row_gap: gap, column_gap: gap, fit_height: true, ...props };
  return { ...el('Group', id, style, p, extra), elements: kids(children) };
}

export const row = (id, children, opts = {}) => group(id, children, { layout: 'row', ...opts, props: { vert_alignment: 'center', ...opts.props } });

/** Inner groups pass the thing down ("Parent group's X" only looks one group up in Bubble). */
function inherit(el, type) {
  if (el.type !== 'Group' || el.properties.group_type) return el;
  const elements = Object.fromEntries(Object.entries(el.elements ?? {}).map(([k, c]) => [k, inherit(c, type)]));
  return { ...el, properties: { ...el.properties, group_type: `custom.${type}`, data_source: { type: 'ElementParent', is_slidable: false } }, elements };
}

/** A group that holds one thing (for rows and popups): data_source + group_type. */
export function thingGroup(id, type, dataSource, children, opts = {}) {
  const g = group(id, children, { ...opts, props: { data_source: dataSource, group_type: `custom.${type}`, ...opts.props } });
  return { ...g, elements: Object.fromEntries(Object.entries(g.elements).map(([k, c]) => [k, inherit(c, type)])) };
}

export function label(id, t, style = 'Text_body_', props = {}, extra = {}) {
  return el('Text', id, style, { text: asText(t), fit_height: true, ...props }, extra);
}

/** Fixed-width table cell text. */
export const cell = (id, t, width, { align = 'left', style = 'Text_body_14_', ...extra } = {}) =>
  label(id, t, style, { width, single_width: true, min_width_css: `${width}px`, font_alignment: align, vert_alignment: 'center' }, extra);

/** Flexible (grows) table cell text. */
export const flexCell = (id, t, { style = 'Text_body_14_', ...extra } = {}) =>
  label(id, t, style, { fit_width: false, min_width_css: '0px', font_alignment: 'left', vert_alignment: 'center' }, extra);

export const button = (id, t, style = 'Button_primary_', props = {}, extra = {}) =>
  el('Button', id, style, { text: asText(t), fit_width: true, fit_height: true, vert_alignment: 'center', ...props }, extra);

export const input = (id, placeholder, props = {}) =>
  el('Input', id, 'Input_default_', {
    height: 44, content_format: 'text', placeholder: asText(placeholder), fit_height: false,
    min_width_css: '220px', single_height: true, min_height_css: '44px', ...props,
  });

/** Dropdown of texts from an expression (e.g. the list of cities). */
export const textDropdown = (id, placeholder, dataSource, props = {}) =>
  el('Dropdown', id, 'Dropdown_standard_dropdown_', {
    height: 44, data_source: dataSource, placeholder: asText(placeholder), dynamic_type: 'text',
    choices_style: 'dynamic', fit_height: false, min_width_css: '200px', single_height: true, min_height_css: '44px',
    option_display_expression: tx({ type: 'InjectedValue', is_slidable: false }), ...props,
  });

export const html = (id, content, props = {}) =>
  el('HTML', id, 'HTML_default_', { html: content, fit_height: true, min_width_css: '0px', min_height_css: '0px', ...props });

/** A repeating group: one `rowGroup` (a thingGroup over the parent cell) per item. */
export const list = (id, type, dataSource, rowGroup, props = {}) => ({
  ...el('RepeatingGroup', id, 'RepeatingGroup_default_', {
    data_source: dataSource, group_type: `custom.${type}`, separator_style: 'none', fit_height: true,
    fixed_rows: false, show_all_items: true, container_layout: 'column', cell_min_height_css: '0px', ...props,
  }),
  elements: kids([rowGroup]),
});

export function popup(id, type, children, width = 820) {
  return {
    ...el('Popup', id, 'Popup_default_', {
      width, group_type: `custom.${type}`, row_gap: 14, use_gap: true, fit_height: true,
      padding_top: 30, padding_left: 30, padding_right: 30, padding_bottom: 30,
      max_width_css: `${width}px`, min_width_css: '320px', container_layout: 'column',
    }),
    elements: kids(children),
  };
}

/** Conditional formatting: [{ when: expr, set: {property: value} }]. */
export function withStates(element, states) {
  return {
    ...element,
    states: Object.fromEntries(states.map((s, i) => [i, { condition: s.when, properties: s.set, type: 'State' }])),
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
