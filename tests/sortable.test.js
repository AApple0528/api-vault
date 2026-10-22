import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bindLongPressSortable, persistJsonArrays, reorderByIndex, serializeFormNotes } from '../src/sortable.js';
import { siteMatchesFilters } from '../src/site-filters.js';

test('group order uses one array and preserves every group exactly once', () => {
  const groups = ['主力站', '备用站', '公益站'];
  assert.deepEqual(reorderByIndex(groups, [2, 0, 1]), ['公益站', '主力站', '备用站']);
  assert.deepEqual(groups, ['主力站', '备用站', '公益站']);
});

test('invalid drag order cannot drop or duplicate user data', () => {
  const values = ['A', 'B', 'C'];
  assert.deepEqual(reorderByIndex(values, [0, 0, 2]), values);
  assert.deepEqual(reorderByIndex(values, [0, 1]), values);
  assert.deepEqual(reorderByIndex(values, [0, 1, 9]), values);
});

test('note order remains manual and carries label, value and mask together', () => {
  const notes = [
    { label: '账号', value: 'one', masked: false },
    { label: '密钥', value: 'two', masked: true },
    { label: '备注', value: 'three', masked: false }
  ];
  assert.deepEqual(reorderByIndex(notes, [1, 2, 0]), [notes[1], notes[2], notes[0]]);
});

test('existing persisted arrays remain the source of order without a schema field', () => {
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const storage = new Map();
  persistJsonArrays({ setItem: (key, value) => storage.set(key, value) }, [['api_vault_groups_v3', ['C', 'A', 'B']]]);
  assert.deepEqual(JSON.parse(storage.get('api_vault_groups_v3')), ['C', 'A', 'B']);
  assert.match(source, /notes: validNotes/);
  assert.equal((source.match(/notes: validNotes/g) || []).length, 2, 'edit and create both store serialized form order');
  assert.doesNotMatch(source, /groupOrder|noteOrder|sortIndex\s*:/);
});

test('serialized edited notes keep current order, content and masking for site storage', () => {
  const formNotes = [
    { label: 'Token', value: 'secret-b', masked: true },
    { label: 'Account', value: 'user-a', masked: false },
    { label: '', value: '', masked: true }
  ];
  assert.deepEqual(serializeFormNotes(formNotes), [
    { label: 'Token', value: 'secret-b', masked: true },
    { label: 'Account', value: 'user-a', masked: false }
  ]);
  const reloadedSite = JSON.parse(JSON.stringify({ notes: serializeFormNotes(formNotes) }));
  assert.deepEqual(reloadedSite.notes.map(note => note.label), ['Token', 'Account']);
  assert.equal(reloadedSite.notes[0].value, 'secret-b');
  assert.equal(reloadedSite.notes[0].masked, true);
});

class FakeClassList {
  values = new Set();
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
}

class FakeStyle {
  values = new Map();
  constructor() {
    return new Proxy(this, {
      get: (target, property, receiver) => property in target ? Reflect.get(target, property, receiver) : target.values.get(property),
      set: (target, property, value, receiver) => {
        if (property in target) return Reflect.set(target, property, value, receiver);
        target.values.set(property, String(value));
        return true;
      }
    });
  }
  setProperty(key, value) { this.values.set(key, String(value)); }
  removeProperty(key) { this.values.delete(key); }
}

class FakeElement {
  constructor(name, index = null) {
    this.name = name;
    this.dataset = index === null ? {} : { sortIndex: String(index) };
    this.classList = new FakeClassList();
    this.style = new FakeStyle();
    this.listeners = new Map();
    this.children = [];
    this.parentNode = null;
    this.parentElement = null;
    this.attributes = new Map();
  }
  get firstElementChild() { return this.children[0] || null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    return this.parentNode.children[this.parentNode.children.indexOf(this) + 1] || null;
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener));
  }
  dispatch(type, event) { (this.listeners.get(type) || []).forEach(listener => listener(event)); }
  matches(selector) {
    if (selector === '[data-sort-index]') return this.dataset.sortIndex !== undefined;
    if (selector === '[data-sort-handle]') return this.hasAttribute('data-sort-handle');
    return false;
  }
  closest(selector) {
    for (let node = this; node; node = node.parentNode) if (node.matches(selector)) return node;
    return null;
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [ ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector) ]);
  }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  appendChild(node) { return this.insertBefore(node, null); }
  insertBefore(node, reference) {
    if (node.parentNode) node.parentNode.children.splice(node.parentNode.children.indexOf(node), 1);
    const index = reference ? this.children.indexOf(reference) : -1;
    this.children.splice(index < 0 ? this.children.length : index, 0, node);
    node.parentNode = this;
    node.parentElement = this;
    return node;
  }
  remove() {
    if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
    this.parentNode = null;
    this.parentElement = null;
  }
  cloneNode() { return new FakeElement(`${this.name}-placeholder`); }
  removeAttribute(name) { this.attributes.delete(name); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  hasAttribute(name) { return this.attributes.has(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setPointerCapture() {}
  hasPointerCapture() { return false; }
  getBoundingClientRect() {
    const siblings = this.parentNode?.children || [];
    const index = siblings.indexOf(this);
    const top = this.parentNode?.name === 'sort-container' ? Math.max(index, 0) * 50 : Number.parseFloat(this.style.values.get('top') || '0');
    return { left: 0, top, width: 100, height: 40, right: 100, bottom: top + 40 };
  }
}

function installSortableDom(t) {
  const container = new FakeElement('sort-container');
  const body = new FakeElement('body');
  const windowListeners = new Map();
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  const oldRaf = globalThis.requestAnimationFrame;
  const items = ['A', 'B', 'C'].map((name, index) => new FakeElement(name, index));
  const handles = items.map(item => {
    const handle = new FakeElement(`${item.name}-handle`);
    handle.setAttribute('data-sort-handle', '');
    item.appendChild(handle);
    container.appendChild(item);
    return handle;
  });
  globalThis.window = {
    setTimeout, clearTimeout,
    addEventListener: (type, listener) => windowListeners.set(type, listener),
    removeEventListener: type => windowListeners.delete(type)
  };
  globalThis.document = {
    body,
    elementFromPoint(x, y) {
      return container.children.find(item => item.matches('[data-sort-index]') && y >= item.getBoundingClientRect().top && y < item.getBoundingClientRect().bottom) || null;
    }
  };
  globalThis.requestAnimationFrame = callback => callback();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { vibrate() {} } });
  t.after(() => {
    globalThis.window = oldWindow;
    globalThis.document = oldDocument;
    globalThis.requestAnimationFrame = oldRaf;
  });
  const event = (pointerId, clientX, clientY) => ({
    pointerId, clientX, clientY, button: 0, target: handles[0],
    preventDefault() {}, stopPropagation() {}
  });
  return { container, body, items, handles, event };
}

test('pointer sequence waits for long press, follows finger, moves placeholder and commits order', async t => {
  const { container, body, items, handles, event } = installSortableDom(t);
  let committed;
  bindLongPressSortable(container, { delay: 10, onReorder: order => { committed = order; } });
  container.dispatch('pointerdown', event(1, 20, 20));
  await new Promise(resolve => setTimeout(resolve, 3));
  assert.equal(items[0].parentNode, container, 'short press does not start dragging');
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(items[0].parentNode, body, 'long-pressed element floats outside the list');
  assert.equal(items[0].style.values.get('position'), 'fixed');
  container.dispatch('pointermove', event(1, 20, 125));
  assert.equal(items[0].style.values.get('--sort-y'), '105px', 'dragged item follows pointer movement');
  assert.deepEqual(container.children.map(item => item.name), ['B', 'C', 'A-placeholder'], 'placeholder advances through the list');
  container.dispatch('pointerup', event(1, 20, 125));
  assert.deepEqual(committed, [1, 2, 0]);
  assert.deepEqual(container.children, [items[1], items[2], items[0]]);
});

test('pointercancel restores original order and never commits', async t => {
  const { container, items, event } = installSortableDom(t);
  let commits = 0;
  bindLongPressSortable(container, { delay: 1, onReorder: () => commits++ });
  container.dispatch('pointerdown', event(2, 20, 20));
  await new Promise(resolve => setTimeout(resolve, 5));
  container.dispatch('pointermove', event(2, 20, 125));
  container.dispatch('pointercancel', event(2, 20, 125));
  assert.deepEqual(container.children, items);
  assert.equal(commits, 0);
  assert.equal(items[0].classList.contains('is-sorting'), false);
});

test('group, check-in status and search filters remain independent and composable', () => {
  const site = { name: 'Alpha API', url: 'https://alpha.test', group: '主力站', tags: ['模型'], needCheckIn: true, checkedInToday: false };
  assert.equal(siteMatchesFilters(site, { status: '待签到', group: '主力站', query: '模型' }), true);
  assert.equal(siteMatchesFilters(site, { status: '已签到', group: '主力站' }), false);
  assert.equal(siteMatchesFilters(site, { status: '待签到', group: '公益站' }), false);
  assert.equal(siteMatchesFilters(site, { status: '全部', group: null, query: 'alpha.test' }), true);
});
