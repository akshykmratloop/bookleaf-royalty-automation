// The regenerate animation as wired into the admin page: the editor stays on screen while a draft is
// rewritten, the page carries the mask's CSS/JS, and the regenerate workflow only gained one first step.
import { describe, expect, it } from 'vitest';
import { buildAdminPage, CUSTOM_STATES } from '../page.mjs';
import { REGEN_HTML, REGEN_TARGETS, REGEN_BUTTON_ID, REGEN_LOCK_IDS } from './regen.js.mjs';
import { REGEN_PREV } from './regenAnchor.mjs';
import { REGEN_ANCHOR_ID } from './regen.css.mjs';

const page = buildAdminPage();
const all = [];
const collect = (el) => { all.push(el); Object.values(el.elements ?? {}).forEach(collect); };
collect(page.side);
page.popups.forEach(collect);
const byId = (id) => all.find((e) => e.id === id);
const htmlIdOf = (e) => e?.properties?.unique_id?.entries?.[0];
const conditions = (e) => JSON.stringify(Object.values(e.states ?? {}).map((s) => s.condition));
const wf = (id) => page.workflows.find((w) => w.id === id);

describe('regenerate in place', () => {
  it('defines rv_prev as a notification log state', () => {
    expect(CUSTOM_STATES[REGEN_PREV].value).toBe('custom.notificationlog');
  });

  it('keeps the tone bar, editor, preview and footer on screen while rv_prev is set', () => {
    for (const id of ['ad_rv_style', 'ad_rv_body_row', 'ad_rv_foot']) expect(conditions(byId(id)), id).toContain(`custom.${REGEN_PREV}`);
    expect(conditions(byId('ad_rv_live'))).toContain('is_empty'); // the old progress card: first drafts only
  });

  it('gives the script every element it needs, by HTML id', () => {
    for (const id of [...Object.keys(REGEN_TARGETS), REGEN_BUTTON_ID, ...REGEN_LOCK_IDS]) {
      expect(all.some((e) => htmlIdOf(e) === id), id).toBe(true);
    }
    const anchor = byId(REGEN_ANCHOR_ID);
    expect(JSON.stringify(anchor.properties.html)).toContain('bl-regen-src');
    expect(JSON.stringify(anchor.properties.html)).toContain(`custom.${REGEN_PREV}`);
  });

  it('shows the replaced draft text in the editor and preview, and disables the buttons, while rewriting', () => {
    for (const id of ['ad_rv_subj', 'ad_rv_body', 'ad_rv_prev', 'ad_rv_model']) expect(conditions(byId(id)), id).toContain(`custom.${REGEN_PREV}`);
    for (const id of ['ad_rv_regen', 'ad_rv_check', 'ad_rv_approve', 'ad_rv_discard']) {
      expect(JSON.stringify(byId(id).states), id).toContain('"button_disabled":true');
    }
  });

  it('carries the mask CSS/JS in the style element', () => {
    expect(byId('ad_css').properties.html).toContain(REGEN_HTML);
  });

  it('only adds one first step to Regenerate: n8n calls unchanged and in order', () => {
    const steps = Object.values(wf('wf_ad_rv_regen').actions);
    expect(steps[0].id).toBe('rv_regen_p');
    expect(steps[0].properties.custom_state).toBe(`custom.${REGEN_PREV}`);
    expect(steps[0].properties.condition).toBeTruthy();
    const ids = steps.map((a) => a.id);
    expect(ids.indexOf('rv_regen_call')).toBeLessThan(ids.indexOf('rv_regen_mark'));
    expect(ids.indexOf('rv_regen_mark')).toBeLessThan(ids.indexOf('rv_regen_send'));
    expect(ids).not.toContain('rv_regen_r6'); // the regenerate keeps rv_prev
  });

  it('forgets rv_prev whenever a draft is opened from a list', () => {
    for (const id of ['wf_ad_l_rev', 'wf_ad_d_review', 'wf_ad_r_rev']) {
      const clear = Object.values(wf(id).actions).find((a) => a.properties?.custom_state === `custom.${REGEN_PREV}`);
      expect(clear, id).toBeTruthy();
      expect(clear.properties.value).toBeUndefined();
    }
  });
});
