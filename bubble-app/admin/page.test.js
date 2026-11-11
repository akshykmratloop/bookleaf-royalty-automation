// Checks every reference in the generated admin page before it is written into Bubble:
// a wrong id or field name there would only show up as a silent blank on screen.
import { describe, expect, it } from 'vitest';
import { buildAdminPage, CUSTOM_STATES, VIEWS } from './page.mjs';
import { inFlightOf } from './queries.mjs';
import { STALE_MINUTES } from './workflows/poll.mjs';
import { OPTION_SETS, OPTION_IDS, TYPES } from '../schema.mjs';

const page = buildAdminPage();
const KEPT_IDS = ['admin', 'bTGYf'];
const SEND_PARAMS = ['author_id', 'log_id', 'batch_id', 'requested_by', 'mode', 'reference_date', 'demo_inbox', 'attempt', 'ai_down', 'email_down', 'data_down', 'primary_down', 'delivery', 'tone', 'length', 'note', 'sign_off', 'author_code', 'author_name', 'author_email', 'author_city', 'books'];
const APPROVE_PARAMS = ['job_id', 'action', 'subject', 'body'];

function walk(node, visit, path = []) {
  if (Array.isArray(node)) return node.forEach((n, i) => walk(n, visit, [...path, i]));
  if (node && typeof node === 'object') {
    visit(node, path);
    for (const [k, v] of Object.entries(node)) walk(v, visit, [...path, k]);
  }
}

const elements = [];
const collect = (el) => { elements.push(el); Object.values(el.elements ?? {}).forEach(collect); };
collect(page.side);
Object.values(page.mainChildren).forEach(collect);
page.popups.forEach(collect);
const ids = new Set([...elements.map((e) => e.id), ...KEPT_IDS]);

// Field accessor names the schema allows, e.g. name_text, author_custom_author, status_option_sendstatus.
const kind = (t) => {
  if (['text', 'date', 'number', 'user'].includes(t)) return t;
  if (t === 'yes / no') return 'boolean';
  if (t.startsWith('list of ')) return `list_option_${t.slice(8, -1).toLowerCase()}`;
  if (OPTION_SETS[t]) return `option_${t.toLowerCase()}`;
  return t === 'User' ? 'user' : `custom_${t.toLowerCase()}`;
};
const FIELDS = new Set(Object.values(TYPES).flatMap((fields) => Object.entries(fields).map(([n, t]) => `${n}_${kind(t)}`)));
const looksLikeField = (n) => /_(text|number|date|boolean|user|custom_[a-z]+|option_[a-z]+|list_option_[a-z]+)$/.test(n) && !/^(_api_c2_|format_|custom\.)/.test(n);

describe('admin page', () => {
  it('has unique element ids', () => {
    const all = elements.map((e) => e.id);
    expect(all.length).toBe(new Set(all).size);
  });

  it('only refers to elements that exist', () => {
    const missing = [];
    walk([page.side, page.mainChildren, page.popups, page.workflows], (n) => {
      const id = n.properties?.element_id;
      if (id && !ids.has(id)) missing.push(id);
    });
    expect(missing).toEqual([]);
  });

  it('only uses custom states the page defines', () => {
    const used = new Set();
    walk([page.side, page.mainChildren, page.popups, page.workflows], (n) => {
      if (n.type === 'Message' && n.name?.startsWith('custom.')) used.add(n.name.slice(7));
      if (n.type === 'SetCustomState') used.add(n.properties.custom_state.slice(7));
    });
    expect([...used].filter((s) => !CUSTOM_STATES[s])).toEqual([]);
  });

  it('uses only fields and option values from the schema', () => {
    const bad = [];
    walk([page.side, page.mainChildren, page.popups, page.workflows], (n) => {
      if (n.type === 'Message' && looksLikeField(n.name) && !FIELDS.has(n.name)) bad.push(n.name);
      if (n.type === 'OptionValue') {
        const set = Object.keys(OPTION_SETS).find((k) => `option.${k.toLowerCase()}` === n.properties.option_set);
        const byId = Object.fromEntries(Object.entries(OPTION_IDS[set?.toLowerCase()] ?? {}).map(([name, id]) => [id, name]));
        const name = byId[n.properties.option_value] ?? n.properties.option_value;
        if (!set || !OPTION_SETS[set].includes(name)) bad.push(JSON.stringify(n.properties));
      }
      for (const c of Object.values(n.type === 'Search' ? n.properties.constraints ?? {} : {})) if (!FIELDS.has(c.key)) bad.push(c.key);
      for (const c of Object.values(n.type === 'NewThing' || n.type === 'ChangeThing' ? n.properties.initial_values ?? n.properties.changes : {})) if (!FIELDS.has(c.key)) bad.push(c.key);
    });
    expect(bad).toEqual([]);
  });

  it('reads step results only from earlier steps of the same workflow', () => {
    for (const wf of page.workflows) {
      const order = Object.values(wf.actions).map((a) => a.id);
      Object.values(wf.actions).forEach((action, i) => walk(action, (n) => {
        if (n.type === 'PreviousStep') expect(order.indexOf(n.properties.action_id), `${wf.id}: ${n.properties.action_id}`).toBeGreaterThanOrEqual(0);
        if (n.type === 'PreviousStep') expect(order.indexOf(n.properties.action_id)).toBeLessThan(i);
      }));
    }
  });

  it('triggers only custom events that exist, and every click has its button', () => {
    const events = new Set(page.workflows.filter((w) => w.type === 'CustomEvent').map((w) => w.id));
    walk(page.workflows, (n) => {
      if (['TriggerCustomEvent', 'ScheduleCustom'].includes(n.type)) expect(events.has(n.properties.custom_event)).toBe(true);
    });
    expect(new Set(page.workflows.map((w) => w.id)).size).toBe(page.workflows.length);
  });

  it('sends every parameter of the n8n call', () => {
    const call = page.workflows.find((w) => w.id === 'send_one');
    const sent = Object.keys(Object.values(call.actions)[1].properties).map((k) => k.replace('body_params_', ''));
    expect(sent.sort()).toEqual([...SEND_PARAMS].sort());
  });

  it('sends every parameter of the approve call', () => {
    const calls = [];
    walk(page.workflows, (n) => { if (typeof n.type === 'string' && n.type.endsWith('APPROVE_CALL_ID') || (n.type ?? '').includes('.') && n.properties?.body_params_action) calls.push(n); });
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(Object.keys(c.properties).map((k) => k.replace('body_params_', '')).sort()).toEqual([...APPROVE_PARAMS].sort());
  });

  it('has a nav item, a section and a click workflow for every view', () => {
    for (const [key] of VIEWS) {
      expect(ids.has(`ad_nav_${key}`), key).toBe(true);
      expect(ids.has(`ad_v_${key}`), key).toBe(true);
      expect(page.workflows.some((w) => w.properties?.element_id === `ad_nav_${key}`), key).toBe(true);
    }
  });

  it('gives every workflow action a unique id', () => {
    const actionIds = page.workflows.flatMap((w) => Object.values(w.actions).map((a) => a.id));
    expect(actionIds.length).toBe(new Set(actionIds).size);
  });

  it('only clicks elements that exist', () => {
    const missing = page.workflows.filter((w) => w.type === 'ButtonClicked' && !ids.has(w.properties.element_id)).map((w) => w.properties.element_id);
    expect(missing).toEqual([]);
  });

  it('never chains an operator after and/or or a comparison (Bubble reads that condition as empty)', () => {
    const COMPARISONS = ['greater_than', 'less_than', 'equals', 'not_equals'];
    const names = (e) => { const out = []; for (let n = e; n; n = n.next) if (n.name) out.push(n.name); return out; };
    const bad = [];
    walk(page.workflows, (n) => {
      const c = n.properties?.condition;
      if (!c) return;
      const ops = names(c);
      const i = ops.findIndex((o) => o === 'and_' || o === 'or_');
      if (i >= 0 && ops.slice(i + 1).some((o) => o !== 'and_' && o !== 'or_')) bad.push(n.id);
      const cmp = ops.findIndex((o) => COMPARISONS.includes(o));
      if (cmp >= 0 && ops.slice(cmp + 1).some((o) => o !== 'and_' && o !== 'or_')) bad.push(n.id);
    });
    expect(bad).toEqual([]);
  });

  it('counts only Queued/Processing as in progress, so drafts and discarded sends free the row', () => {
    const excluded = JSON.stringify(inFlightOf({ type: 'CurrentUser' }));
    for (const v of ['Sent', 'Failed', 'Duplicate', 'draft_ready', 'discarded']) expect(excluded).toContain(`"option_value":"${v}"`);
    const rowIds = new Set(elements.map((e) => e.id));
    expect(rowIds.has('ad_r_rev')).toBe(true);
    expect(page.workflows.some((w) => w.properties?.element_id === 'ad_r_rev')).toBe(true);
  });

  it('fails a request n8n never answers instead of spinning forever', () => {
    const poll = page.workflows.find((w) => w.id === 'poll_jobs');
    const stale = Object.values(poll.actions).find((a) => a.id === 'poll_stale');
    expect(stale.properties.condition).toBeTruthy();
    expect(JSON.stringify(stale.properties.condition)).toContain(`"args":-${STALE_MINUTES}`);
    expect(JSON.stringify(stale)).toContain('NO_ANSWER');
    // The stale check is the last step, so earlier steps never switch to a different log mid-run.
    expect(Object.values(poll.actions).at(-1).id).toBe('poll_stale');
  });
});
