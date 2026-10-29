import test from 'node:test';
import assert from 'node:assert/strict';
import { destination } from '../bridge/destination.mjs';
import { Store } from '../bridge/store.mjs';
test('destination defaults and existing chats never create new chat links', () => {
  assert.deepEqual(destination(null), { mode: 'new', projectPath: '' });
  const thread = '01a17121-1a78-7dc1-a252-d32a57721a67';
  const target = destination({ mode: 'existing', thread: 'codex://threads/' + thread });
  const store = new Store('/tmp/task-runtime');
  assert.equal(store.desktopLink({ destination: target }), 'codex://threads/' + thread);
  for (const input of ['codex://threads/new', 'https://example.com', 'codex://threads/' + thread + '?prompt=bad']) assert.throws(() => destination({ mode: 'existing', thread: input }));
});
test('new chat uses the requested directory and includes the task prompt', () => {
  const store = new Store('/tmp/task-runtime');
  const job = { id: '01a17121-1a78-7dc1-a252-d32a57721a67', prompt: '改图', destination: destination({ mode: 'new', projectPath: '/tmp/项目 目录' }) };
  const link = new URL(store.desktopLink(job));
  assert.equal(link.searchParams.get('path'), '/tmp/项目 目录');
  assert.ok(link.searchParams.get('prompt').includes('request.md'));
  assert.throws(() => destination({ mode: 'new', projectPath: 'relative/path' }));
});
