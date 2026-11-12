// Checks the shared theme layer before it is written into Bubble: it builds, loads nothing but
// Google Fonts, shares the login page's storage key, and defines every token the pages use.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import {
  themeLayer, themeHtml, themeCss, themeJs, themeLayerElement, themeToggleElement, toggleMarkup,
  THEME_KEY, CHART_VARS,
} from './layer.mjs';
import { T, TONES } from '../admin/theme.mjs';
import { THEME_KEY as LOGIN_THEME_KEY } from '../login/scene.mjs';

const html = themeLayer();
const css = themeCss();
const blockOf = (selector) => {
  const start = css.indexOf(`${selector} {`);
  return css.slice(start, css.indexOf('\n}', start));
};
const lightBlock = blockOf(':root');
const darkBlock = blockOf('html[data-theme="dark"]');
const varsIn = (s) => new Set([...s.matchAll(/(--bl-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
const usedByTokens = () => [...JSON.stringify({ T, TONES }).matchAll(/var\((--bl-[a-z0-9-]+)/g)].map((m) => m[1]);

describe('theme layer', () => {
  it('builds one HTML string with styles, the init script and the theme script', () => {
    expect(typeof html).toBe('string');
    expect(html).toContain('<style>');
    expect(html).toContain("setAttribute('data-theme'");
    expect(html).toContain('window.__blThemeLayer');
    expect(themeHtml()).toBe(html);
  });

  it('loads no external script, and no stylesheet but Google Fonts', () => {
    const urls = [...html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]);
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(urls.filter((u) => !/^https:\/\/fonts\.(googleapis|gstatic)\.com(\/|$)/.test(u))).toEqual([]);
    expect(html).toMatch(/family=Fraunces/);
    expect(html).toMatch(/family=Manrope/);
  });

  it("stores the theme under the login page's key", () => {
    expect(THEME_KEY).toBe('bl-login-theme');
    expect(LOGIN_THEME_KEY).toBe(THEME_KEY);
    expect(themeJs()).toContain(`'${THEME_KEY}'`);
    expect(html).not.toContain('__BL_THEME_KEY__');
  });

  it('is valid JavaScript', () => {
    expect(() => new Function(themeJs())).not.toThrow();
  });

  it('tells the charts when the theme changes', () => {
    expect(themeJs()).toContain("'bl-theme-change'");
  });

  it('defines every token the generated elements use, in light and in dark', () => {
    const light = varsIn(lightBlock);
    const dark = varsIn(darkBlock);
    const used = [...new Set(usedByTokens())];
    expect(used.length).toBeGreaterThan(20);
    expect(used.filter((v) => !light.has(v))).toEqual([]);
    expect(used.filter((v) => !dark.has(v))).toEqual([]);
  });

  it('defines every chart variable in both themes (fonts are theme-independent)', () => {
    const themed = CHART_VARS.filter((v) => v !== '--bl-font-ui');
    expect(themed.filter((v) => !varsIn(lightBlock).has(v))).toEqual([]);
    expect(themed.filter((v) => !varsIn(darkBlock).has(v))).toEqual([]);
  });

  it("points Bubble's own colour and font tokens at the theme", () => {
    expect(css).toMatch(/--color_blprimary_default: var\(--bl-brand\) !important/);
    expect(css).toMatch(/--font_heading_default: var\(--bl-font-display\) !important/);
  });

  it('builds a zero-size layer element and a 40px toggle element', () => {
    const layer = themeLayerElement('bl_theme');
    expect(layer).toMatchObject({ type: 'HTML', id: 'bl_theme', properties: { height: 0 } });
    expect(layer.properties.html).toBe(html);
    const toggle = themeToggleElement('x_toggle');
    expect(toggle).toMatchObject({ type: 'HTML', id: 'x_toggle', properties: { width: 40, height: 40 } });
    expect(toggle.properties.html).toContain('data-bl-theme-toggle');
    expect(themeLayer({ floatingToggle: true })).toContain('is-floating');
    expect(toggleMarkup()).toContain('aria-label=');
  });

  it('keeps every theme source file within 200 lines', () => {
    const files = ['css', 'js'].flatMap((d) => readdirSync(new URL(`./${d}/`, import.meta.url)).map((n) => new URL(`./${d}/${n}`, import.meta.url)));
    const long = [...files, new URL('./layer.mjs', import.meta.url)]
      .filter((u) => readFileSync(u, 'utf8').split('\n').length > 200).map((u) => u.pathname);
    expect(long).toEqual([]);
  });
});
