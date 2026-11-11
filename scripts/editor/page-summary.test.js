// The page summary is what later stages read before they move or rewire anything on a live page,
// so it must show every element, state and workflow exactly as the editor stores them.
import { describe, expect, it } from 'vitest';
import { renderExpr, parentRefs, elementRows, workflowRows, customStateRows, summarizePage } from './page-summary.mjs';

const msg = (name, extra = {}) => ({ type: 'Message', name, is_slidable: false, ...extra });
const role = (value) => ({ type: 'OptionValue', is_slidable: false, properties: { option_set: 'option.role', option_value: value } });
const adminCheck = {
  type: 'CurrentUser',
  next: msg('logged_in', { next: msg('and_', { args: { type: 'CurrentUser', next: msg('role_option_role', { next: msg('equals', { args: role('Admin') }) }) } }) }),
};
const text = (...parts) => ({ type: 'TextExpression', entries: Object.fromEntries(parts.map((p, i) => [i, p])) });
const parentName = { type: 'ElementParent', next: msg('name_text') };

const page = {
  id: 'bTGYf',
  name: 'index',
  custom_states: { busy: { display: 'busy', value: 'boolean' } },
  elements: {
    kB: { type: 'Text', id: 'second', name: 'Second', properties: { order: 2, text: text('Hi ', parentName) } },
    kA: {
      type: 'Group',
      id: 'main',
      name: 'Main Group',
      properties: { order: 1, unique_id: text('bl_right'), data_source: { type: 'ElementParent' }, group_type: 'custom.book' },
      custom_states: { chapter: { display: 'chapter', value: 'text' } },
      states: { 0: { type: 'State', condition: adminCheck, properties: { is_visible: true } } },
      elements: { kC: { type: 'Button', id: 'go', name: 'go', properties: { order: 1, is_visible: false } } },
    },
  },
  workflows: {
    w1: {
      type: 'ButtonClicked',
      id: 'wf_go',
      name: 'Go',
      properties: { element_id: 'go', condition: adminCheck },
      actions: {
        10: { type: 'ChangePage', properties: { element_id: 'admin' } },
        2: { type: 'SetCustomState', properties: { element_id: 'bTGYf', custom_state: 'custom.busy', value: true } },
        0: { type: 'LogOut' },
      },
    },
  },
};

describe('renderExpr', () => {
  it('reads an operator chain with an argument as one line', () => {
    expect(renderExpr(adminCheck)).toBe('CurrentUser > logged_in > and_(CurrentUser > role_option_role > equals(option.role.Admin))');
  });
  it('joins dynamic text parts and names element and search sources', () => {
    expect(renderExpr(text('Hi ', parentName))).toBe('"Hi " + [Parent group\'s thing > name_text]');
    expect(renderExpr({ type: 'GetElement', properties: { element_id: 'bTGYf' }, next: msg('custom.busy') })).toBe('element(bTGYf) > custom.busy');
    const search = { type: 'Search', properties: { type_to_find: 'custom.book', constraints: { 0: { key: 'author_custom_author', constraint_type: 'equals', value: { type: 'CurrentUser' } } } } };
    expect(renderExpr(search)).toBe('Search(custom.book; author_custom_author equals CurrentUser)');
  });
  it('shows plain values as they are', () => {
    expect(renderExpr(undefined)).toBe('');
    expect(renderExpr(true)).toBe('true');
    expect(renderExpr('x')).toBe('"x"');
  });
});

describe('parentRefs', () => {
  it('lists every own property or condition that reads the parent group, not the children', () => {
    expect(parentRefs(page.elements.kA)).toEqual(['properties.data_source']);
    expect(parentRefs(page.elements.kB)).toEqual(['properties.text.entries.1']);
    expect(parentRefs({ type: 'Group', properties: {}, elements: { x: { properties: { data_source: { type: 'ElementParent' } } } } })).toEqual([]);
  });
});

describe('elementRows', () => {
  const rows = elementRows(page.elements);
  it('walks the tree depth first in Bubble order', () => {
    expect(rows.map((r) => [r.depth, r.key, r.id])).toEqual([[0, 'kA', 'main'], [1, 'kC', 'go'], [0, 'kB', 'second']]);
  });
  it('reads the HTML id, visibility on load, conditions, source and type', () => {
    expect(rows[0]).toMatchObject({ type: 'Group', name: 'Main Group', htmlId: '"bl_right"', visible: true, groupType: 'custom.book', source: "Parent group's thing" });
    expect(rows[0].showWhen).toEqual(['CurrentUser > logged_in > and_(CurrentUser > role_option_role > equals(option.role.Admin))']);
    expect(rows[1]).toMatchObject({ visible: false, htmlId: '', showWhen: [], hideWhen: [] });
  });
});

describe('workflowRows', () => {
  it('lists the event, its element and condition, and actions in numeric order', () => {
    const [wf] = workflowRows(page.workflows);
    expect(wf).toMatchObject({ key: 'w1', id: 'wf_go', name: 'Go', event: 'ButtonClicked', element: 'go' });
    expect(wf.condition).toContain('logged_in');
    expect(wf.actions.map((a) => a.type)).toEqual(['LogOut', 'SetCustomState', 'ChangePage']);
    expect(wf.actions[1].props).toBe('element_id=bTGYf, custom_state=custom.busy, value=true');
  });
});

describe('stray map entries', () => {
  // The live index page stores `length: 2` in its elements map and `length: 0` in its workflows map.
  it('skips entries that are not objects', () => {
    const odd = { ...page, elements: { ...page.elements, length: 2 }, workflows: { ...page.workflows, length: 0 } };
    expect(elementRows(odd.elements).map((r) => r.key)).toEqual(['kA', 'kC', 'kB']);
    expect(workflowRows(odd.workflows).map((w) => w.key)).toEqual(['w1']);
    expect(summarizePage('index', odd, '/x')).not.toMatch(/length/);
  });
});

describe('customStateRows and summarizePage', () => {
  it('finds page and element custom states', () => {
    expect(customStateRows(page)).toEqual([
      { owner: 'page', name: 'busy', type: 'boolean' },
      { owner: 'main', name: 'chapter', type: 'text' },
    ]);
  });
  it('prints one block per page with every element, state and workflow', () => {
    const out = summarizePage('index', page, '/x/index.json');
    for (const s of ['index (bTGYf)', '/x/index.json', 'kA Group main "Main Group" #"bl_right"', 'parent@properties.data_source', 'busy:boolean', 'w1 ButtonClicked on go', 'LogOut', 'ChangePage element_id=admin']) {
      expect(out).toContain(s);
    }
  });
});
