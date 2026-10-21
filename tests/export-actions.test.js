import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createExportActions, downloadInBrowser, shareInBrowser } from '../src/export-actions.js';

const json = { content: '{"name":"中文😀"}', filename: 'backup.json', mime: 'application/json;charset=utf-8' };
const md = { content: '# 中文😀\n便签', filename: 'list.md', mime: 'text/markdown;charset=utf-8' };

function harness(overrides = {}) {
  const calls = [];
  const actions = createExportActions({
    preview: file => calls.push(['preview', file]),
    close: () => calls.push(['close']),
    notify: text => calls.push(['notify', text]),
    share: async file => { calls.push(['share', file]); return { activityType: 'example.app' }; },
    save: async file => { calls.push(['save', file]); return { cancelled: false }; },
    ...overrides
  });
  return { calls, actions };
}

test('opening either preview causes no share, save or clipboard action', () => {
  const { calls, actions } = harness();
  actions.open(json);
  actions.open(md);
  assert.deepEqual(calls.map(call => call[0]), ['preview', 'preview']);
});

for (const file of [json, md]) {
  for (const kind of ['save', 'share']) {
    test(`${file.filename}: explicit ${kind} closes preview and only invokes that operation`, async () => {
      const { calls, actions } = harness();
      actions.open(file);
      await actions[kind]();
      assert.deepEqual(calls.map(call => call[0]), ['preview', 'close', kind, 'notify']);
      assert.deepEqual(calls[2][1], file);
    });
  }
}

for (const [kind, result, error] of [
  ['share', null, new Error('Share canceled')],
  ['share', null, Object.assign(new Error('cancel'), { name: 'AbortError' })],
  ['save', { cancelled: true }, null]
]) {
  test(`${kind}: cancellation closes preview without fallback or failure message`, async () => {
    const { actions, calls } = harness({ [kind]: async () => { if (error) throw error; return result; } });
    actions.open(json);
    await actions[kind]();
    assert.deepEqual(calls.map(call => call[0]), ['preview', 'close', 'notify']);
    assert.match(calls.at(-1)[1], /已取消/);
    assert.doesNotMatch(calls.at(-1)[1], /失败|无法|已复制/);
  });
}

for (const kind of ['share', 'save']) {
  test(`${kind}: a real failure is reported without invoking another operation`, async () => {
    const { actions, calls } = harness({ [kind]: async () => { throw new Error('provider failure'); } });
    actions.open(json);
    await actions[kind]();
    assert.deepEqual(calls.map(call => call[0]), ['preview', 'close', 'notify']);
    assert.match(calls.at(-1)[1], /无法|未完成/);
    assert.doesNotMatch(calls.at(-1)[1], /已保存|已复制|已发送/);
  });
}

test('rapid taps cannot overlap share/save or replace the pending payload; guard resets', async () => {
  let finish;
  let count = 0;
  const { calls, actions } = harness({ share: () => { count++; return new Promise(resolve => { finish = resolve; }); } });
  actions.open(json);
  const pending = actions.share();
  await actions.share();
  await actions.save();
  actions.open(md);
  assert.equal(count, 1);
  assert.deepEqual(calls.map(call => call[0]), ['preview', 'close']);
  finish({});
  await pending;
  actions.open(md);
  await actions.save();
  assert.deepEqual(calls.find(call => call[0] === 'save')[1], md);
});

test('native chooser result with no chosen target is ambiguous, never reported as delivery', async () => {
  const { actions, calls } = harness({ share: async () => ({ activityType: '' }) });
  actions.open(json);
  await actions.share();
  assert.match(calls.at(-1)[1], /系统未报告/);
});

for (const file of [json, md]) {
  test(`${file.filename}: browser file share retains UTF-8 text, extension and correct MIME`, async () => {
    let request;
    await shareInBrowser(file, {
      File,
      navigator: { canShare: () => true, share: async data => { request = data; } }
    });
    assert.equal(request.files[0].name, file.filename);
    assert.equal(request.files[0].type, file.mime.split(';')[0]);
    assert.equal(await request.files[0].text(), file.content);
  });

  test(`${file.filename}: browser download uses a Blob and anchor, never share`, async () => {
    const events = [];
    let blob;
    const anchor = { click: () => events.push('click'), remove: () => events.push('remove') };
    const result = downloadInBrowser(file, {
      Blob,
      URL: { createObjectURL(value) { blob = value; return 'blob:test'; }, revokeObjectURL: () => events.push('revoke') },
      document: { createElement: () => anchor, body: { appendChild: () => events.push('append') } },
      setTimeout: fn => fn()
    });
    assert.equal(anchor.download, file.filename);
    assert.equal(await blob.text(), file.content);
    assert.equal(blob.type, file.mime);
    assert.deepEqual(events, ['append', 'click', 'remove', 'revoke']);
    assert.equal(result.downloadRequested, true);
  });
}

test('unsupported browser file sharing rejects without copying or downloading', async () => {
  await assert.rejects(shareInBrowser(json, { File, navigator: {} }), /not supported/);
});

// Exercise the actual retained data formatter and copy handler, without
// initializing app storage or accessing any existing user records.
const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
test('actual JSON/Markdown formatters open preview only and leave stored records unchanged', () => {
  const sites = [{ name: '测试😀', url: 'https://example.test', group: '测试', tags: ['示例'],
    needCheckIn: true, checkedInToday: false, desc: '备注', notes: [{ label: '测试便签', value: '纯测试内容' }] }];
  const groups = ['测试'];
  const before = JSON.stringify({ sites, groups });
  const files = [];
  const format = vm.runInNewContext(source.slice(source.indexOf('function exportData('), source.indexOf('function closeExportModal(')) + '\nexportData;', {
    sites, customGroups: groups, exportActions: { open: file => files.push(file) }
  });
  format('json');
  format('md');
  assert.equal(JSON.stringify({ sites, groups }), before);
  const backup = JSON.parse(files[0].content);
  const project = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(backup), ['version', 'exportedAt', 'groups', 'sites']);
  assert.equal(backup.version, project.version);
  assert.ok(Number.isFinite(Date.parse(backup.exportedAt)));
  assert.deepEqual(backup.sites, sites);
  assert.deepEqual(backup.groups, groups);
  assert.match(files[0].filename, /\.json$/);
  assert.equal(files[0].mime, 'application/json;charset=utf-8');
  assert.match(files[1].content, /测试😀/);
  assert.match(files[1].content, /纯测试内容/);
  assert.match(files[1].filename, /\.md$/);
  assert.equal(files[1].mime, 'text/markdown;charset=utf-8');
});

test('actual copy handler only forwards preview text to clipboard helper', () => {
  const copied = [];
  const copy = vm.runInNewContext(source.slice(source.indexOf('function copyExportContent('), source.indexOf('function showDialog(')) + '\ncopyExportContent;', {
    document: { getElementById: id => { assert.equal(id, 'export-textarea'); return { value: json.content }; } },
    copyText: text => copied.push(text)
  });
  copy();
  assert.deepEqual(copied, [json.content]);
});
