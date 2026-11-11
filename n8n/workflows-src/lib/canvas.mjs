/**
 * Canvas layout: every node on an explicit grid cell (the workflow source says where), one sticky note
 * per section drawn around its nodes (sized from their bounding box), and an About note above them all.
 * A node's position is its top-left corner; n8n draws a node as a 100 px square with its name and note
 * below it.
 */
export const GRID = Object.freeze({ col: 260, row: 200 });
export const NODE_SIZE = 100;
/** Room for a node's name (up to two lines) and its one-line note under the square. */
const BELOW_NODE = 80;
/** Room beside a node for a name wider than the square ("Rewrite (OpenAI fallback)"). */
const SIDE = 60;
const BOTTOM = 20;
/** Sticky-note text: about 7.5 px per character at the default size, 22 px per line, 16 px padding. */
const CHAR_PX = 7.5;
const LINE_PX = 22;
const NOTE_PAD = 16;
const HEADING_PX = 18;
const GAP = 40;
/** Wider than this, a line of the About note is too long to read. */
const ABOUT_MAX_WIDTH = 1200;

/**
 * n8n's sticky-note colours (1 yellow, 2 gold, 3 red, 4 green, 5 blue, 6 purple, 7 neutral). About is blue;
 * a section is neutral unless its `tone` says it calls the AI (purple) or only handles failures (red).
 */
export const STICKY_COLORS = Object.freeze({ about: 5, flow: 7, ai: 6, failure: 3 });

const sticky = (name, content, box, color) => ({
  name, type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
  parameters: { content, height: box.height, width: box.width, color }, position: [box.x, box.y],
});

/** @param {{title:string, tone?:string}} section @returns {number} @throws {Error} for an unknown tone */
function colorOf(section) {
  const tone = section.tone ?? 'flow';
  if (tone === 'about' || !Object.hasOwn(STICKY_COLORS, tone)) throw new Error(`Section "${section.title}" has unknown tone "${tone}"`);
  return STICKY_COLORS[tone];
}

/**
 * @param {string} content markdown (a `## ` title line, then text) @param {number} width px
 * @returns {number} the height that shows all of it at `width`
 */
export function noteHeight(content, width) {
  const perLine = Math.max(1, Math.floor((width - 2 * NOTE_PAD) / CHAR_PX));
  const lines = content.split('\n').reduce((sum, p) => sum + Math.max(1, Math.ceil(p.replace(/[*`#]/g, '').length / perLine)), 0);
  return Math.ceil(2 * NOTE_PAD + HEADING_PX + lines * LINE_PX);
}

/**
 * @param {Object[]} nodes working nodes @param {Record<string, [number, number]>} grid name → [column, row]
 * @returns {Object[]} the nodes with `position`
 * @throws {Error} for a node without a cell, two nodes in one cell, or a cell naming no node
 */
export function placeOnGrid(nodes, grid) {
  const names = new Set(nodes.map((n) => n.name));
  const unknown = Object.keys(grid).find((name) => !names.has(name));
  if (unknown) throw new Error(`Grid cell for unknown node "${unknown}"`);
  const taken = new Map();
  return nodes.map((n) => {
    const cell = grid[n.name];
    if (!cell) throw new Error(`No grid cell for node "${n.name}"`);
    const key = cell.join(',');
    if (taken.has(key)) throw new Error(`"${taken.get(key)}" and "${n.name}" share grid cell ${key}`);
    taken.set(key, n.name);
    return { ...n, position: [cell[0] * GRID.col, cell[1] * GRID.row] };
  });
}

/** The box around `members`, with room for their names and the note's own title and text above. */
function boxAround(members, content) {
  const xs = members.map((n) => n.position[0]);
  const ys = members.map((n) => n.position[1]);
  const x = Math.min(...xs) - SIDE;
  const width = Math.max(...xs) + NODE_SIZE + SIDE - x;
  const header = noteHeight(content, width);
  const y = Math.min(...ys) - header;
  return { x, y, width, height: Math.max(...ys) + NODE_SIZE + BELOW_NODE + BOTTOM - y };
}

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function membersOf(byName, owner, section) {
  return section.nodes.map((name) => {
    if (!byName.has(name)) throw new Error(`Section "${section.title}" names unknown node "${name}"`);
    if (owner.has(name)) throw new Error(`Node "${name}" is in two sections`);
    owner.set(name, section.title);
    return byName.get(name);
  });
}

/**
 * @param {Object[]} placed nodes with positions @param {{title:string, text:string, nodes:string[], tone?:string}[]} sections
 * @returns {Object[]} one sticky note per section, named by its title
 * @throws {Error} for an unknown node, a node in two sections, two sections that overlap, or an unknown tone
 */
export function sectionNotes(placed, sections) {
  const byName = new Map(placed.map((n) => [n.name, n]));
  const owner = new Map();
  const notes = sections.map((s) => {
    const content = `## ${s.title}\n${s.text}`;
    return { title: s.title, content, box: boxAround(membersOf(byName, owner, s), content), color: colorOf(s) };
  });
  notes.forEach((a, i) => notes.slice(i + 1).forEach((b) => {
    if (overlaps(a.box, b.box)) throw new Error(`Sections "${a.title}" and "${b.title}" overlap`);
  }));
  return notes.map((n) => sticky(n.title, n.content, n.box, n.color));
}

/** The About note: from the left edge of the section notes, at most ABOUT_MAX_WIDTH wide, just above the highest one. */
export function aboutNote(content, notes) {
  const left = Math.min(...notes.map((n) => n.position[0]));
  const width = Math.min(ABOUT_MAX_WIDTH, Math.max(...notes.map((n) => n.position[0] + n.parameters.width)) - left);
  const height = noteHeight(content, width);
  const top = Math.min(...notes.map((n) => n.position[1]));
  return sticky('About', content, { x: left, y: top - GAP - height, width, height }, STICKY_COLORS.about);
}

/**
 * The finished canvas of a workflow source: About and section notes first (drawn behind), then the
 * nodes on their grid cells.
 * @param {{nodes:Object[], grid:Record<string, [number, number]>, sections:Object[], about:string}} src
 */
export function canvas(src) {
  const placed = placeOnGrid(src.nodes, src.grid);
  const sections = sectionNotes(placed, src.sections);
  const clash = sections.find((s) => placed.some((n) => n.name === s.name) || s.name === 'About');
  if (clash) throw new Error(`Section title "${clash.name}" is also a node name`);
  return [aboutNote(src.about, sections), ...sections, ...placed];
}
