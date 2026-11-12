// The in-place regenerate animation: phase rules, step words, failure note, the generated ink
// keyframes and the page script (it must parse, and carry every rule it calls).
import { describe, expect, it } from 'vitest';
import { regenPhase, regenMove, regenStep, regenStepLabel, regenStamp, regenElapsed, regenFailNote } from './regenLogic.mjs';
import { REGEN_LINES, lineWindows, cycleSeconds, writeCss, maskMarkup } from './regenDraw.mjs';
import { REGEN_HTML, REGEN_SCRIPT, REGEN_TARGETS } from './regen.js.mjs';

const T0 = 1_700_000_000_000;
const src = (o) => ({ prev: 'old', log: 'new', status: 'Processing', stage: 'writing', start: '', error: '', ...o });

describe('regenPhase', () => {
  it('shows the mask at once after a click, before Bubble data moves', () => {
    expect(regenPhase(null, T0, T0 + 100)).toBe('live');
    expect(regenPhase(src({ prev: '', log: 'old', status: 'Draft ready' }), T0, T0 + 5_999)).toBe('live');
  });
  it('is idle when no regenerate happened in this pop-up', () => {
    expect(regenPhase(null, 0, T0)).toBe('idle');
    expect(regenPhase(src({ prev: '', status: 'Draft ready' }), 0, T0)).toBe('idle');
  });
  it('is live while the old draft is still shown, and while the new one is queued or processing', () => {
    expect(regenPhase(src({ log: 'old', status: 'Discarded' }), T0, T0 + 10_000)).toBe('live');
    expect(regenPhase(src({ status: 'Queued' }), T0, T0 + 10_000)).toBe('live');
    expect(regenPhase(src({ status: 'Processing' }), 0, T0)).toBe('live');
  });
  it('is ready when the new draft is in, and failed when n8n failed', () => {
    expect(regenPhase(src({ status: 'Draft ready' }), T0, T0 + 20_000)).toBe('ready');
    expect(regenPhase(src({ status: 'Failed' }), T0, T0 + 20_000)).toBe('failed');
  });
  it('fails a regenerate whose new draft never started', () => {
    expect(regenPhase(src({ log: 'old', status: 'Discarded' }), T0, T0 + 46_000)).toBe('failed');
  });
  it('goes idle on a later discard once the click is long past', () => {
    expect(regenPhase(src({ status: 'Discarded' }), T0, T0 + 10_000)).toBe('live');
    expect(regenPhase(src({ status: 'Discarded' }), T0, T0 + 50_000)).toBe('idle');
  });
});

describe('regenMove', () => {
  it('maps phase changes to what the mask does', () => {
    expect(regenMove('idle', 'live')).toBe('enter');
    expect(regenMove('ready', 'live')).toBe('enter');
    expect(regenMove('failed', 'live')).toBe('enter');
    expect(regenMove('live', 'ready')).toBe('done');
    expect(regenMove('idle', 'ready')).toBe('clear');
    expect(regenMove('live', 'failed')).toBe('fail');
    expect(regenMove('live', 'idle')).toBe('clear');
    expect(regenMove('live', 'live')).toBe('stay');
  });
});

describe('step words and counter', () => {
  it('maps n8n stages to the three steps', () => {
    expect(['queued', 'reading_data', 'writing', 'checking', 'rewriting', 'drafted', ''].map(regenStep)).toEqual([-1, 0, 1, 2, 2, 3, -1]);
    expect([-1, 0, 1, 2, 3, 9].map(regenStepLabel)).toEqual(['Getting ready', 'Reading data', 'Writing with AI', 'Fact-checking', 'Done', 'Done']);
  });
  it('reads Bubble stamps and counts seconds', () => {
    expect(regenStamp('')).toBe(0);
    expect(regenStamp('not a date')).toBe(0);
    expect(regenStamp('2026-11-12 10:00:05') - regenStamp('2026-11-12 10:00:00')).toBe(5000);
    expect(regenElapsed(0, T0)).toBe('');
    expect(regenElapsed(T0, T0 + 7_400)).toBe('7s');
    expect(regenElapsed(T0, T0 + 64_000)).toBe('1m 04s');
    expect(regenElapsed(T0 + 1000, T0)).toBe('0s');
  });
});

describe('regenFailNote', () => {
  it('gives a calm note with the reason, without the error code', () => {
    const n = regenFailNote('AI_DOWN: the model did not answer', false);
    expect(n.title).toMatch(/previous text is back/);
    expect(n.detail).toBe('Reason: the model did not answer. You can try Regenerate again.');
  });
  it('handles an empty, a long, and a never-started failure', () => {
    expect(regenFailNote('', false).detail).toBe('You can try Regenerate again.');
    expect(regenFailNote(`X: ${'a'.repeat(400)}`, false).detail.length).toBeLessThan(200);
    expect(regenFailNote('', true).detail).toMatch(/did not start/);
  });
});

describe('ink drawing', () => {
  it('writes the lines one after another, all inside the cycle', () => {
    for (const widths of Object.values(REGEN_LINES)) {
      const w = lineWindows(widths.length);
      w.forEach(([s, e], i) => {
        expect(e).toBeGreaterThan(s);
        expect(e).toBeLessThan(88);
        if (i > 0) expect(s).toBeGreaterThanOrEqual(w[i - 1][1]);
      });
    }
    expect(cycleSeconds(6)).toBeCloseTo(6.8, 5);
  });
  it('has keyframes for every line and a nib for every kind', () => {
    const css = writeCss();
    for (const [kind, widths] of Object.entries(REGEN_LINES)) {
      widths.forEach((_, i) => expect(css).toContain(`@keyframes bl-rg-${kind}-w${i}{`));
      expect(css).toContain(`@keyframes bl-rg-${kind}-nib{`);
    }
  });
  it('builds one ink line per width, and the failure note only on the text box', () => {
    expect(maskMarkup('text').match(/bl-rg-ln"/g)).toHaveLength(REGEN_LINES.text.length);
    expect(maskMarkup('text')).toContain('bl-rg-note');
    expect(maskMarkup('mail')).not.toContain('bl-rg-note');
    expect(maskMarkup('line')).not.toContain('bl-rg-tag');
    expect(() => maskMarkup('nope')).toThrow();
  });
});

describe('page script', () => {
  it('parses, and carries every rule it calls', () => {
    const body = REGEN_SCRIPT.split('<script>')[1].split('</script>')[0];
    expect(() => new Function(body)).not.toThrow();
    for (const fn of [regenPhase, regenMove, regenStep, regenStepLabel, regenStamp, regenElapsed, regenFailNote]) {
      expect(body).toContain(`function ${fn.name}(`);
    }
  });
  it('masks the subject, the text box and the preview, and respects reduced motion', () => {
    expect(Object.keys(REGEN_TARGETS)).toEqual(['ad_rv_subj', 'ad_rv_body', 'ad_rv_prev']);
    expect(REGEN_HTML).toContain('prefers-reduced-motion:reduce');
    expect(REGEN_HTML).not.toMatch(/:#[0-9a-f]{3,6}[;}]/i); // colours only as --bl-* variables (hex only as fallbacks)
  });
});
