// Builders for Bubble's expression JSON (the format the editor stores and copies).
// An expression is a source node followed by a chain of operators linked through `next`:
//   Current User's author's name  ->  {type:'CurrentUser', next:{name:'author_custom_author', next:{name:'name_text'}}}
// Every builder returns a fresh object, so expressions can be reused safely.

const node = (type, extra = {}) => ({ type, is_slidable: false, ...extra });

/** An operator ("Message") in a chain. `args` is the operand, `properties` its options. */
export function op(name, { args, properties, slidable = false } = {}) {
  const m = { type: 'Message', name, is_slidable: slidable };
  if (args !== undefined) m.args = args;
  if (properties !== undefined) m.properties = properties;
  return m;
}

/** Links a source and operators: chain(src, op('a'), op('b')) -> src.next = a, a.next = b. */
export function chain(source, ...ops) {
  const head = structuredClone(source);
  let tail = head;
  while (tail.next) tail = tail.next;
  for (const o of ops) {
    tail.next = structuredClone(o);
    tail = tail.next;
  }
  return head;
}

/** Field accessor operators, named the way Bubble names them: `<field>_<type>`. */
export const f = {
  text: (n) => op(`${n}_text`),
  num: (n) => op(`${n}_number`),
  date: (n) => op(`${n}_date`),
  bool: (n) => op(`${n}_boolean`),
  user: (n) => op(`${n}_user`),
  thing: (n, type) => op(`${n}_custom_${type}`),
  option: (n, set) => op(`${n}_option_${set}`),
  optionList: (n, set) => op(`${n}_list_option_${set}`),
};

export const currentUser = () => node('CurrentUser');
export const parent = () => node('ElementParent');
export const injected = () => node('InjectedValue');
export const now = () => node('PageData', { properties: { name: 'Current Date/Time' } });
export const element = (id) => node('GetElement', { properties: { element_id: id } });
export const prevStep = (actionId) => node('PreviousStep', { properties: { action_id: actionId } });
export const optionValue = (set, value) =>
  node('OptionValue', { properties: { option_set: `option.${set}`, option_value: value } });

/** A page custom state: `page's state`. */
export const state = (pageId, name) => chain(element(pageId), op(`custom.${name}`));
/** An element's data: input value / dropdown value, or a group's thing. */
export const value = (id) => chain(element(id), op('get_data'));
export const groupData = (id) => chain(element(id), op('get_group_data'));

/** Do a search for <type>. constraints: [[key, constraint_type, valueExpr], ...]. */
export function search(type, constraints = [], { ignoreEmpty = false } = {}) {
  const props = { type_to_find: type === 'user' ? 'user' : `custom.${type}` };
  if (constraints.length) {
    props.constraints = Object.fromEntries(
      constraints.map(([key, constraint_type, v], i) => [i, v === undefined ? { key, constraint_type } : { key, value: v, constraint_type }]),
    );
  }
  if (ignoreEmpty) props.ignore_empty_constraints = true;
  return node('Search', { properties: props });
}

/** :filtered with an advanced condition evaluated on "This item" (InjectedValue chain). */
export const filtered = (conditionOnItem) =>
  op('filtered', { properties: { constraints: { 0: { key: '_advanced_search_constraint', value: conditionOnItem } } } });

export const sorted = (field, descending = false) => op('sorted', { properties: { sort_field: field, descending } });

/** Dynamic text: parts are literal strings or expressions. */
export function text(...parts) {
  return { entries: Object.fromEntries(parts.map((p, i) => [i, p])), type: 'TextExpression' };
}

/** :formatted as <true text> / <false text> on a yes/no. */
export const yesNo = (whenTrue, whenFalse) =>
  op('format_boolean', { properties: { formatting_for_true: text(...[].concat(whenTrue)), formatting_for_false: text(...[].concat(whenFalse)) } });

/** :format as text — content per item (using injected()) and a delimiter. */
export const formatList = (content, delimiter = ',') =>
  op('format_as_text', { properties: { content, delimiter: text(delimiter) } });

export const jsonSafe = () => op('format_json_encode');
export const dateFmt = (fmt) => op('format_date', { properties: { formatting_type: 'custom', custom_format: fmt }, slidable: true });

/** Whole rupees with Indian grouping (1,23,456), exactly as the author portal shows them. */
export const inr = () => [
  op('format_number', { properties: { formatting_type: 'number', decimal_place: 0 }, slidable: true }),
  op('find_replace', {
    properties: { find: text('(\\d)(?=(\\d{2})*\\d{3}$)'), replace: text('$1,'), use_regex: true },
    slidable: true,
  }),
];

/** "₹" + amount (empty sums read as ₹0). */
export const rupees = (numberExpr) => text('₹', chain(numberExpr, ...inr()));

export const and = (a) => op('and_', { args: a });
export const or = (a) => op('or_', { args: a });
