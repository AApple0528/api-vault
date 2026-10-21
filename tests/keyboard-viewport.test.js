import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the existing Web viewport/focus code with a natively resized WebView.
// This verifies JS behavior, not Android window/insets delivery or actual IME UI.
const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const viewportCode = source.slice(source.indexOf('let viewportUpdateFrame'), source.indexOf('const exportActions'));

function harness(modalId, controlTop = 620) {
  const frames = [];
  const timers = new Map();
  const css = new Map();
  const events = new Map();
  const scrolls = [];
  let nextTimer = 0;
  let top = controlTop;
  let hidden = false;
  const viewport = {
    height: 800, offsetTop: 0,
    addEventListener: (name, fn) => events.set(`visual:${name}`, fn)
  };
  const modal = { id: modalId, classList: { contains: name => name === 'hidden' && hidden } };
  const panel = {
    getBoundingClientRect: () => ({ top: 40, bottom: viewport.height, height: viewport.height - 40 }),
    querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 100 }) }),
    scrollBy(options) {
      scrolls.push(options);
      top -= options.top;
    }
  };
  class Control {
    closest(selector) { return selector === '.keyboard-aware-modal' ? modal : panel; }
    getBoundingClientRect() { return { top, bottom: top + 40 }; }
  }
  const control = new Control();
  const document = {
    activeElement: control,
    documentElement: { style: { setProperty: (key, value) => css.set(key, value) } },
    addEventListener: (name, fn) => events.set(name, fn)
  };
  const window = {
    innerHeight: 800, visualViewport: viewport,
    addEventListener: (name, fn) => events.set(name, fn),
    clearTimeout: id => timers.delete(id),
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; }
  };
  vm.runInNewContext(viewportCode, {
    document, window, HTMLElement: Control,
    requestAnimationFrame: fn => { frames.push(fn); return frames.length; }
  });
  function flush() {
    while (frames.length) frames.shift()();
    const callbacks = [...timers.values()];
    timers.clear();
    callbacks.forEach(fn => fn());
  }
  flush();
  return {
    css, viewport, window, events, control, scrolls, flush,
    hide() { hidden = true; }
  };
}

for (const [scenario, modalId] of [
  ['new group', 'group-modal'], ['edit group', 'group-modal'],
  ['new site', 'site-modal'], ['edit site', 'site-modal']
]) {
  test(`${scenario}: native viewport shrink scrolls focus above keyboard without a second height deduction`, () => {
    const h = harness(modalId);
    h.window.innerHeight = h.viewport.height = 420;
    h.events.get('resize')();
    h.events.get('visual:resize')();
    h.events.get('focusin')({ target: h.control });
    h.flush();
    assert.equal(h.css.get('--app-visual-viewport-height'), '420px');
    assert.equal(h.css.get('--app-visual-viewport-top'), '0px');
    assert.ok(h.scrolls.length > 0);
    assert.ok(h.control.getBoundingClientRect().bottom <= 420 - 16);
    assert.ok(h.control.getBoundingClientRect().top >= 108);

    const count = h.scrolls.length;
    h.window.innerHeight = h.viewport.height = 800;
    h.events.get('visual:resize')();
    h.flush();
    assert.equal(h.css.get('--app-visual-viewport-height'), '800px');
    assert.equal(h.scrolls.length, count);
  });
}

test('focus hidden behind sticky action header scrolls back below it', () => {
  const h = harness('site-modal', 50);
  assert.equal(h.control.getBoundingClientRect().top, 108);
  assert.equal(h.scrolls[0].top, -58);
});

test('a closed modal does not scroll on delayed keyboard/focus events', () => {
  const h = harness('group-modal');
  h.hide();
  h.viewport.height = 420;
  h.events.get('visual:resize')();
  h.events.get('focusin')({ target: h.control });
  h.flush();
  assert.equal(h.scrolls.length, 0);
});

test('ordinary browser VisualViewport offset and fallback remain supported', () => {
  const h = harness('site-modal');
  h.viewport.height = 460;
  h.viewport.offsetTop = 30;
  h.events.get('visual:scroll')();
  h.flush();
  assert.equal(h.css.get('--app-visual-viewport-height'), '460px');
  assert.equal(h.css.get('--app-visual-viewport-top'), '30px');
  h.window.visualViewport = undefined;
  h.window.innerHeight = 640;
  h.events.get('resize')();
  h.flush();
  assert.equal(h.css.get('--app-visual-viewport-height'), '640px');
  assert.equal(h.css.get('--app-visual-viewport-top'), '0px');
});
