// Tests for the API client's retry and error rules (update.md J.4), with fetch stubbed.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { api, READ_FAILED_MESSAGE, WRITE_UNCONFIRMED_MESSAGE } from '../src/services/api.ts';

type Reply = { status?: number; body: string; type?: string } | 'drop';
let replies: Reply[] = [];
let calls: { url: string; init: RequestInit }[] = [];
let logged: unknown[][] = [];
const realFetch = globalThis.fetch;
const realError = console.error;

const json = (data: unknown, status = 200): Reply => ({ status, body: JSON.stringify(data), type: 'application/json' });
const html = (status = 200): Reply => ({ status, body: '<!doctype html><html><body>Service temporarily unavailable</body></html>', type: 'text/html' });

beforeEach(() => {
  replies = [];
  calls = [];
  logged = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = replies.shift();
    if (!next || next === 'drop') throw new TypeError('Failed to fetch');
    return new Response(next.body, { status: next.status ?? 200, headers: { 'content-type': next.type ?? 'text/plain' } });
  }) as typeof fetch;
  console.error = (...args: unknown[]) => { logged.push(args); };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
});

test('a read is retried twice on a non-JSON reply or a dropped connection, then succeeds', async () => {
  replies = [html(502), 'drop', json({ success: true, data: { totalShipments: 3 } })];
  assert.deepEqual(await api.getStats(), { totalShipments: 3 });
  assert.equal(calls.length, 3);
  assert.equal(logged.length, 0);
});

test('a read that never gets JSON fails with the plain message and logs status, type and body start', async () => {
  replies = [html(200), html(200), html(200)];
  await assert.rejects(api.trackShipment('WVL7K2M9'), (err: any) =>
    err.message === READ_FAILED_MESSAGE && err.code === 'NON_JSON' && err.status === 200);
  assert.equal(calls.length, 3);
  const [, detail] = logged[0] as [string, any];
  assert.equal(detail.status, 200);
  assert.equal(detail.contentType, 'text/html');
  assert.ok(detail.bodyStart.startsWith('<!doctype html>'));
});

test('a write is sent once and reports that it could not be confirmed', async () => {
  replies = [html(200), json({ success: true, data: {} })];
  await assert.rejects(api.updateShipment('WVL7K2M9', { cargoDescription: 'Box' }), (err: any) =>
    err.message === WRITE_UNCONFIRMED_MESSAGE && err.code === 'NON_JSON');
  assert.equal(calls.length, 1);

  calls = [];
  replies = ['drop', json({ success: true, data: {} })];
  await assert.rejects(api.submitContactMessage({} as any), (err: any) =>
    err.message === WRITE_UNCONFIRMED_MESSAGE && err.code === 'NETWORK' && err.status === 0);
  assert.equal(calls.length, 1);
});

test('JSON errors keep the server message, status, code and field errors, without retrying', async () => {
  replies = [json({ success: false, error: 'Proof not accepted', code: 'NOT_ACCEPTING', errors: { amountSent: 'Too high' } }, 409)];
  await assert.rejects(api.submitPaymentProof('WVL7K2M9', {} as any), (err: any) =>
    err.message === 'Proof not accepted' && err.status === 409 && err.code === 'NOT_ACCEPTING' && err.errors.amountSent === 'Too high');
  replies = [json({ success: false, error: 'Authentication required' }, 401)];
  await assert.rejects(api.getShipments(), (err: any) => err.status === 401 && err.message === 'Authentication required');
  assert.equal(calls.length, 2);
});

test('writes send JSON; reads send no body', async () => {
  replies = [json({ success: true, data: { id: 'q1' } }), json({ success: true, data: [] })];
  await api.updateQuoteStatus('q1', 'ACCEPTED' as any);
  await api.getQuotes();
  assert.equal(calls[0].url, '/api/quotes/q1/status');
  assert.equal(calls[0].init.method, 'PATCH');
  assert.equal(calls[0].init.body, JSON.stringify({ status: 'ACCEPTED' }));
  assert.deepEqual(calls[0].init.headers, { 'Content-Type': 'application/json' });
  assert.equal(calls[1].init.method, 'GET');
  assert.equal(calls[1].init.body, undefined);
});

test('special cases keep their behaviour: 404 quote is null, convert returns the new ID, login messages', async () => {
  replies = [{ status: 404, body: 'Not found' }];
  assert.equal(await api.getPublicQuote('q404'), null);

  replies = [json({ success: true, trackingNumber: 'WVL7K2M9', data: { tracking_number: 'WVL7K2M9' } })];
  assert.deepEqual(await api.convertQuoteToShipment('q1'), { trackingNumber: 'WVL7K2M9', data: { tracking_number: 'WVL7K2M9' } });

  replies = ['drop'];
  await assert.rejects(api.login('x'), /Can't reach the server/);
  replies = [{ status: 401, body: '' }];
  await assert.rejects(api.login('x'), /^Error: Incorrect password\.$/);
  // A 200 without a readable body: login took if the session says so (checkSession is a read).
  replies = [{ status: 200, body: '' }, json({ isAdmin: true })];
  assert.deepEqual(await api.login('x'), { success: true });
});
