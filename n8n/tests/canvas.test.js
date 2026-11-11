import { describe, expect, it } from 'vitest';
import { WORKFLOW_SOURCES } from '../build.mjs';
import { GRID, NODE_SIZE, noteHeight, placeOnGrid, sectionNotes, STICKY_COLORS } from '../workflows-src/lib/canvas.mjs';
import { built, nodeOf } from './built.js';

/** How the canvas reads in the n8n editor: nodes on a grid, one sticky note per section around its nodes. */
const STICKY = 'n8n-nodes-base.stickyNote';
const n = (name) => ({ name, type: 'n8n-nodes-base.noOp', parameters: {} });
const boxOf = (s) => ({ x: s.position[0], y: s.position[1], width: s.parameters.width, height: s.parameters.height });
const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const holds = (box, node) => box.x <= node.position[0] && node.position[0] + NODE_SIZE <= box.x + box.width
  && box.y <= node.position[1] && node.position[1] + NODE_SIZE <= box.y + box.height;
const titleOf = (s) => /^## (.+)$/m.exec(s.parameters.content)?.[1];

describe('placeOnGrid', () => {
  it('puts each node on its grid cell', () => {
    const placed = placeOnGrid([n('A'), n('B')], { A: [0, 0], B: [2, 1] });
    expect(placed.map((x) => x.position)).toEqual([[0, 0], [2 * GRID.col, GRID.row]]);
  });
  it('fails the build for a node without a cell, two nodes in one cell, or a cell for an unknown node', () => {
    expect(() => placeOnGrid([n('A'), n('B')], { A: [0, 0] })).toThrow('No grid cell for node "B"');
    expect(() => placeOnGrid([n('A'), n('B')], { A: [0, 0], B: [0, 0] })).toThrow('"A" and "B" share grid cell 0,0');
    expect(() => placeOnGrid([n('A')], { A: [0, 0], Z: [1, 0] })).toThrow('Grid cell for unknown node "Z"');
  });
});

describe('sectionNotes', () => {
  const placed = placeOnGrid([n('A'), n('B'), n('C'), n('D')], { A: [0, 0], B: [1, 1], C: [2, 0], D: [3, 0] });
  it('draws a titled sticky note around each section\'s nodes, sized from their bounding box', () => {
    const [ab, cd] = sectionNotes(placed, [{ title: 'Intake', text: 'Reads it.', nodes: ['A', 'B'] }, { title: 'Ledger', text: 'Saves it.', nodes: ['C', 'D'] }]);
    expect(ab).toMatchObject({ name: 'Intake', type: STICKY, parameters: { content: '## Intake\nReads it.' } });
    for (const name of ['A', 'B']) expect(holds(boxOf(ab), placed.find((x) => x.name === name)), name).toBe(true);
    expect(boxOf(ab).width).toBeLessThan(boxOf(cd).x - boxOf(ab).x);
    expect(overlap(boxOf(ab), boxOf(cd))).toBe(false);
  });
  it('fails the build for overlapping sections, a node in two sections, or an unknown node', () => {
    expect(() => sectionNotes(placed, [{ title: 'S1', text: 'x', nodes: ['A', 'C'] }, { title: 'S2', text: 'x', nodes: ['B'] }]))
      .toThrow('Sections "S1" and "S2" overlap');
    expect(() => sectionNotes(placed, [{ title: 'S1', text: 'x', nodes: ['A'] }, { title: 'S2', text: 'x', nodes: ['A'] }]))
      .toThrow('Node "A" is in two sections');
    expect(() => sectionNotes(placed, [{ title: 'S1', text: 'x', nodes: ['Q'] }])).toThrow('Section "S1" names unknown node "Q"');
  });
  it('colours each note by its tone: neutral by default, purple for AI calls, red for failure handling; an unknown tone fails the build', () => {
    expect(STICKY_COLORS).toEqual({ about: 5, flow: 7, ai: 6, failure: 3 });
    const notes = sectionNotes(placed, [
      { title: 'S1', text: 'x', nodes: ['A'] }, { title: 'S2', text: 'x', nodes: ['B'], tone: 'ai' }, { title: 'S3', text: 'x', nodes: ['C'], tone: 'failure' },
    ]);
    expect(notes.map((s) => s.parameters.color)).toEqual([7, 6, 3]);
    expect(() => sectionNotes(placed, [{ title: 'S1', text: 'x', nodes: ['A'], tone: 'pink' }])).toThrow('Section "S1" has unknown tone "pink"');
  });
  it('a longer text in a narrower note needs a taller note', () => {
    expect(noteHeight('## T\nshort', 400)).toBeLessThan(noteHeight(`## T\n${'word '.repeat(40)}`, 400));
    expect(noteHeight(`## T\n${'word '.repeat(40)}`, 400)).toBeLessThan(noteHeight(`## T\n${'word '.repeat(40)}`, 200));
  });
});

describe('every built workflow', () => {
  for (const wf of WORKFLOW_SOURCES) {
    const nodes = built[wf].nodes;
    const working = nodes.filter((x) => x.type !== STICKY);
    const notes = nodes.filter((x) => x.type === STICKY);
    const sections = notes.filter((s) => s.name !== 'About');
    it(`${wf}: every node sits on its own grid cell`, () => {
      const cells = working.map((x) => `${x.position[0] / GRID.col},${x.position[1] / GRID.row}`);
      for (const c of cells) expect(c, c).toMatch(/^\d+,\d+$/);
      expect(new Set(cells).size).toBe(cells.length);
    });
    it(`${wf}: every node is inside exactly one section note, and no two notes overlap`, () => {
      expect(sections.length).toBeGreaterThan(0);
      for (const node of working) expect(sections.filter((s) => holds(boxOf(s), node)).map(titleOf), node.name).toHaveLength(1);
      notes.forEach((a, i) => notes.slice(i + 1).forEach((b) => expect(overlap(boxOf(a), boxOf(b)), `${a.name} / ${b.name}`).toBe(false)));
    });
    it(`${wf}: every note has a colour; About is blue`, () => {
      for (const note of notes) expect(Object.values(STICKY_COLORS), note.name).toContain(note.parameters.color);
      expect(nodeOf(wf, 'About').parameters.color).toBe(STICKY_COLORS.about);
    });
    it(`${wf}: the About note starts at the left edge, above every section, in lines short enough to read`, () => {
      const about = boxOf(nodeOf(wf, 'About'));
      expect(about.x).toBe(Math.min(...sections.map((s) => s.position[0])));
      expect(about.width).toBeLessThanOrEqual(1200);
      for (const s of sections.map(boxOf)) expect(about.y + about.height).toBeLessThanOrEqual(s.y);
    });
  }
  it('royalty-summary has the agreed sections, left to right', () => {
    const sections = built['royalty-summary'].nodes.filter((x) => x.type === STICKY && x.name !== 'About');
    expect(sections.sort((a, b) => a.position[0] - b.position[0]).map(titleOf))
      .toEqual(['Intake', 'Ledger', 'Data & facts', 'AI writer', 'Fact check', 'Render & deliver', 'Record']);
  });
  it('the AI sections are purple and the error handler is red', () => {
    for (const wf of ['royalty-summary', 'write-draft']) expect(nodeOf(wf, 'AI writer').parameters.color, wf).toBe(STICKY_COLORS.ai);
    for (const title of ['Fail the job', 'Alert']) expect(nodeOf('error-handler', title).parameters.color, title).toBe(STICKY_COLORS.failure);
    expect(nodeOf('royalty-summary', 'Intake').parameters.color).toBe(STICKY_COLORS.flow);
  });
  it.each([
    ['job-status', ['Job Status Webhook', 'Parse Query', 'Query Valid?', 'Select Jobs', 'Respond Jobs']],
    ['error-handler', ['Error Trigger', 'Fail Job', 'Alert Set?', 'Send Alert']],
    ['sweeper', ['Every Minute', 'Sweep Stuck Jobs']],
  ])('%s reads left to right on one row', (wf, happy) => {
    expect(happy.map((name) => nodeOf(wf, name).position[1])).toEqual(happy.map(() => 0));
    const x = happy.map((name) => nodeOf(wf, name).position[0]);
    expect(x).toEqual([...x].sort((a, b) => a - b));
  });
});
