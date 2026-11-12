import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../index.js';

let ctx, server, base;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taif-test-'));

// متصفح مصغّر: يحتفظ بالـ cookies بين الطلبات
function client() {
  const jar = {};
  return async (method, url, body, raw) => {
    const headers = { 'x-app': '1', cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') };
    if (body && !raw) headers['content-type'] = 'application/json';
    if (raw) headers['content-type'] = raw;
    const res = await fetch(base + url, { method, headers, body: body && !raw ? JSON.stringify(body) : body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); }
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text, headers: res.headers };
  };
}

let admin;
async function makeCode(fields) {
  const r = await admin('POST', '/api/admin/codes', { label: 'مستخدم', role: 'viewer', maxDevices: 0, ...fields });
  assert.equal(r.status, 200, r.text);
  return { code: r.json.code, id: r.json.item.id };
}
async function loggedIn(fields) {
  const c = await makeCode(fields), u = client();
  const r = await u('POST', '/api/login', { code: c.code });
  assert.equal(r.status, 200, r.text);
  return Object.assign(u, c);
}

before(async () => {
  ctx = createApp({ dataDir: dir, adminPassword: 'admin-secret' });
  await new Promise(ok => { server = ctx.app.listen(0, ok); });
  base = 'http://127.0.0.1:' + server.address().port;
  admin = client();
  assert.equal((await admin('POST', '/api/admin/login', { password: 'admin-secret' })).status, 200);
});
after(() => { server.closeAllConnections(); server.close(); ctx.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('لوحة المدير مغلقة دون كلمة المرور', async () => {
  const anon = client();
  assert.equal((await anon('GET', '/api/admin/codes')).status, 401);
  assert.equal((await anon('POST', '/api/admin/login', { password: 'wrong' })).status, 401);
  assert.equal((await anon('POST', '/api/admin/codes', { label: 'x', role: 'pmo' })).status, 401);
});

test('الصفحة الرئيسية تحوّل إلى الدخول دون جلسة، والبيانات مغلقة', async () => {
  const anon = client();
  const r = await anon('GET', '/');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/login');
  assert.equal((await anon('GET', '/api/db/reports')).status, 401);
});

test('كود خاطئ يُرفض، وكود صحيح يدخل بأي صيغة كتابة', async () => {
  const anon = client();
  const bad = await anon('POST', '/api/login', { code: 'AAAA-BBBB-CC' });
  assert.equal(bad.status, 401);
  assert.equal(bad.json.error, 'unknown');
  const c = await makeCode({ role: 'entry' });
  const ok = await anon('POST', '/api/login', { code: ' ' + c.code.toLowerCase().replaceAll('-', ' ') });
  assert.equal(ok.status, 200, ok.text);
  const me = await anon('GET', '/api/me');
  assert.equal(me.json.role, 'entry');
  assert.equal(me.json.perms.dataWrite, true);
});

test('كود منتهٍ يُرفض', async () => {
  const c = await makeCode({ expiresAt: new Date(Date.now() - 1000).toISOString() });
  const r = await client()('POST', '/api/login', { code: c.code });
  assert.equal(r.status, 401);
  assert.equal(r.json.error, 'expired');
});

test('الإقفال يُخرج المستخدم فوراً، والفتح يعيده', async () => {
  const u = await loggedIn({ role: 'pmo' });
  assert.equal((await u('GET', '/api/db/reports')).status, 200);
  await admin('PATCH', '/api/admin/codes/' + u.id, { locked: true });
  const r = await u('GET', '/api/db/reports');
  assert.equal(r.status, 401);
  assert.equal(r.json.error, 'locked');
  assert.equal((await client()('POST', '/api/login', { code: u.code })).json.error, 'locked');
  await admin('PATCH', '/api/admin/codes/' + u.id, { locked: false });
  assert.equal((await u('GET', '/api/db/reports')).status, 200);
});

test('تحديد المدة لاحقاً يسري على الجلسة المفتوحة', async () => {
  const u = await loggedIn({});
  await admin('PATCH', '/api/admin/codes/' + u.id, { expiresAt: new Date(Date.now() - 1).toISOString() });
  assert.equal((await u('GET', '/api/me')).json.error, 'expired');
});

test('حد الأجهزة: الجهاز الثاني يُرفض حتى يُخرَج الأول', async () => {
  const c = await makeCode({ maxDevices: 1 });
  const a = client(), b = client();
  assert.equal((await a('POST', '/api/login', { code: c.code })).status, 200);
  assert.equal((await a('POST', '/api/login', { code: c.code })).status, 200, 'الجهاز نفسه يدخل مرة أخرى');
  const r = await b('POST', '/api/login', { code: c.code });
  assert.equal(r.status, 403);
  assert.equal(r.json.error, 'devices');
  const list = (await admin('GET', '/api/admin/codes')).json.codes.find(x => x.id === c.id);
  assert.equal(list.devices.length, 1);
  await admin('DELETE', `/api/admin/codes/${c.id}/devices/${list.devices[0].id}`);
  assert.equal((await a('GET', '/api/me')).status, 401, 'الجهاز المُخرَج فقد جلسته');
  assert.equal((await b('POST', '/api/login', { code: c.code })).status, 200);
});

test('الصلاحيات تُفرض في الخادم لكل دور', async () => {
  const viewer = await loggedIn({ role: 'viewer' }), entry = await loggedIn({ role: 'entry' });
  const ceo = await loggedIn({ role: 'ceo' }), pmo = await loggedIn({ role: 'pmo' });
  const rep = { data: { date: '2026-11-01', rows: [{ id: '1' }] } }, dir = { data: { text: 'توجيه', status: 'open' } };

  const denied = await viewer('PUT', '/api/db/reports/2026-11-01', rep);
  assert.equal(denied.status, 403);
  assert.equal(denied.json.code, 'invalid_argument');
  assert.equal((await viewer('PUT', '/api/db/updates/u1', { data: { pid: '1' } })).status, 403);
  assert.equal((await viewer('PUT', '/api/db/audit/a1', { data: { act: 'x' } })).status, 403);

  assert.equal((await entry('PUT', '/api/db/reports/2026-11-01', rep)).status, 200);
  assert.equal((await entry('PUT', '/api/db/directives/d1', dir)).status, 403, 'مدخل البيانات لا ينشئ توجيهاً');
  assert.equal((await entry('PUT', '/api/db/execReports/2026-11-01', { data: {} })).status, 403);

  assert.equal((await ceo('PUT', '/api/db/directives/d1', dir)).status, 200);
  assert.equal((await ceo('PUT', '/api/db/reports/2026-11-02', rep)).status, 403, 'الرئيس التنفيذي لا يرفع تقارير');
  assert.equal((await entry('PATCH', '/api/db/directives/d1', { data: { status: 'done' } })).status, 403, 'مدخل البيانات لا يغلق توجيهاً');
  assert.equal((await pmo('PATCH', '/api/db/directives/d1', { data: { status: 'done' } })).status, 200);

  assert.equal((await pmo('PUT', '/api/db/execReports/2026-11-01', { data: { n: 1 } })).status, 200);
  const dirs = (await viewer('GET', '/api/db/directives')).json.docs;
  assert.deepEqual(dirs.map(d => [d.id, d.data.status, d.data.by]), [['d1', 'done', ceo.id]]);
});

test('صاحب السجل يحدده الخادم، وسجل العمليات لا يُعدَّل', async () => {
  const u = await loggedIn({ role: 'entry' });
  await u('PUT', '/api/db/audit/a-forge', { data: { act: 'x', by: 'someone-else' } });
  const doc = (await u('GET', '/api/db/audit')).json.docs.find(d => d.id === 'a-forge');
  assert.equal(doc.data.by, u.id);
  assert.equal((await u('PUT', '/api/db/audit/a-forge', { data: { act: 'changed' } })).status, 403);
  assert.equal((await u('PATCH', '/api/db/audit/a-forge', { data: { act: 'changed' } })).status, 403);
});

test('مدخلات غير صالحة تُرفض', async () => {
  const u = await loggedIn({ role: 'pmo' });
  assert.equal((await u('GET', '/api/db/codes')).status, 404, 'جدول الأكواد ليس مجموعة');
  assert.equal((await u('PUT', '/api/db/updates/bad id!', { data: {} })).status, 400);
  assert.equal((await u('PUT', '/api/db/updates/u9', { data: [1] })).status, 400);
  assert.equal((await u('PATCH', '/api/db/updates/missing', { data: { a: 1 } })).status, 404);
  const noHeader = await fetch(base + '/api/logout', { method: 'POST' });
  assert.equal(noHeader.status, 400, 'طلب تعديل بلا ترويسة المنصة');
  assert.equal((await admin('POST', '/api/admin/codes', { label: '', role: 'pmo' })).status, 400);
  assert.equal((await admin('POST', '/api/admin/codes', { label: 'x', role: 'root' })).status, 400);
});

test('رفع ملف وقراءته، والمشاهد لا يرفع', async () => {
  const u = await loggedIn({ role: 'entry' }), v = await loggedIn({ role: 'viewer' });
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  assert.equal((await v('POST', '/api/assets?name=a.png', png, 'image/png')).status, 403);
  const up = await u('POST', '/api/assets?name=' + encodeURIComponent('صورة.png'), png, 'image/png');
  assert.equal(up.status, 200, up.text);
  const got = await v('GET', up.json.url);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('content-type'), 'image/png');
  const html = await u('POST', '/api/assets?name=x.html', Buffer.from('<script>1</script>'), 'text/html');
  const dl = await v('GET', html.json.url);
  assert.match(dl.headers.get('content-disposition'), /^attachment/, 'ملف HTML يُنزَّل ولا يُعرض');
  assert.equal((await client()('GET', up.json.url)).status, 401);
});

test('إعادة توليد الكود تُبطل القديم، والحذف يُنهي الجلسة', async () => {
  const u = await loggedIn({ role: 'pmo' });
  const r = await admin('POST', `/api/admin/codes/${u.id}/regenerate`);
  assert.notEqual(r.json.code, u.code);
  assert.equal((await u('GET', '/api/me')).status, 401);
  assert.equal((await client()('POST', '/api/login', { code: u.code })).status, 401);
  const n = client();
  assert.equal((await n('POST', '/api/login', { code: r.json.code })).status, 200);
  await admin('DELETE', '/api/admin/codes/' + u.id);
  assert.equal((await n('GET', '/api/me')).status, 401);
});

test('التغييرات تُبث حياً، والإقفال يقطع البث', async () => {
  const a = await loggedIn({ role: 'pmo' }), b = await loggedIn({ role: 'viewer' });
  const events = [];
  const ac = new AbortController();
  // نقرأ البث بجلسة المستخدم b
  const cookie = await (async () => { const c = client(); const r = await c('POST', '/api/login', { code: b.code }); return r.headers.getSetCookie().map(s => s.split(';')[0]).join('; '); })();
  const res = await fetch(base + '/api/events', { headers: { cookie }, signal: ac.signal });
  assert.equal(res.status, 200);
  const reader = res.body.getReader(), dec = new TextDecoder();
  let ended = false;
  (async () => { try { for (;;) { const { done, value } = await reader.read(); if (done) { ended = true; break; } events.push(dec.decode(value)); } } catch { ended = true; } })();
  const until = async (fn, ms = 2000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout: ' + events.join('|')); await new Promise(r => setTimeout(r, 20)); } };
  await until(() => events.join('').includes('event: hello'));
  await a('PUT', '/api/db/updates/live1', { data: { pid: '7' } });
  await until(() => events.join('').includes('"collection":"updates"'));
  await admin('PATCH', '/api/admin/codes/' + b.id, { locked: true });
  await until(() => events.join('').includes('event: bye') && ended);
  ac.abort();
});

test('حد محاولات الدخول الفاشلة', async () => {
  const anon = client();
  let last;
  for (let i = 0; i < 12; i++) last = await anon('POST', '/api/login', { code: 'ZZZZ-ZZZZ-Z' + i });
  assert.equal(last.status, 429);
});
