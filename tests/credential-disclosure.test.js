import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCredentialDisclosureState } from '../src/credential-disclosure.js';

test('credentials are collapsed by default and each stable site id toggles independently', () => {
  const disclosure = createCredentialDisclosureState();

  assert.equal(disclosure.isExpanded(101), false);
  assert.equal(disclosure.toggle(101), true);
  assert.equal(disclosure.isExpanded(101), true);
  assert.equal(disclosure.isExpanded(202), false);
  assert.equal(disclosure.toggle(202), true);
  assert.equal(disclosure.toggle(101), false);
  assert.equal(disclosure.isExpanded(202), true);
});

test('list reordering does not move disclosure state to another site', () => {
  const disclosure = createCredentialDisclosureState();
  const sites = [{ id: 1 }, { id: 2 }, { id: 3 }];
  disclosure.toggle(2);

  sites.reverse();

  assert.deepEqual(sites.filter(site => disclosure.isExpanded(site.id)).map(site => site.id), [2]);
});

test('removed and replaced data cannot retain stale expanded state', () => {
  const disclosure = createCredentialDisclosureState();
  disclosure.toggle(1);
  disclosure.toggle(2);

  disclosure.remove(1);
  assert.equal(disclosure.isExpanded(1), false);
  assert.equal(disclosure.isExpanded(2), true);

  disclosure.clear();
  assert.equal(disclosure.isExpanded(2), false);
});

test('disclosure state stays outside site data and export serialization', () => {
  const disclosure = createCredentialDisclosureState();
  const site = { id: 7, name: 'Example', notes: [{ label: 'Key', value: 'secret', masked: true }] };
  const before = JSON.stringify(site);

  disclosure.toggle(site.id);

  assert.equal(JSON.stringify(site), before);
  assert.equal(Object.hasOwn(site, 'expanded'), false);
  assert.equal(Object.hasOwn(site, 'credentialsExpanded'), false);
});

test('site card rendering exposes an accessible per-site disclosure control', () => {
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

  assert.match(source, /credentialDisclosure\.isExpanded\(site\.id\)/);
  assert.match(source, /aria-expanded="\$\{credentialsExpanded\}"/);
  assert.match(source, /toggleSiteCredentials\(\$\{site\.id\}\)/);
  assert.match(source, /id="site-credentials-\$\{site\.id\}"/);
});
