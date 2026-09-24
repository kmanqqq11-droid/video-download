process.env.APP_PIN = '123456';
const test = require('node:test');
const assert = require('node:assert');
const auth = require('../src/auth');

test('pin check', () => {
  assert.ok(auth.enabled);
  assert.ok(auth.pinOk('123456'));
  assert.ok(!auth.pinOk('123457'));
  assert.ok(!auth.pinOk(''));
});

test('tokens: valid, wrong kind, tampered', () => {
  const s = auth.issueSession();
  assert.ok(auth.verify(s, 's'));
  assert.strictEqual(auth.verify(s, 't'), null);
  const t = auth.issueTicket('job1');
  assert.strictEqual(auth.verify(t, 't').j, 'job1');
  assert.strictEqual(auth.verify(t, 's'), null);
  assert.strictEqual(auth.verify(s.slice(0, -2) + 'xx', 's'), null);
  assert.strictEqual(auth.verify('garbage', 's'), null);
});

test('lockout after 5 failures per IP', () => {
  for (let i = 0; i < 5; i++) auth.recordFailure('9.9.9.9');
  assert.ok(auth.lockRemaining('9.9.9.9') > 0);
  assert.strictEqual(auth.lockRemaining('8.8.8.8'), 0);
});
