import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { COLLECTIONS, ROLES, canWrite, uiPerms } from '../perms.js';
import { PROBLEM_AR, codeProblem, hashCode, nowIso, parseCookies, setCookie, sha, shortId, token } from '../auth.js';

const ID_RE = /^[\w.\-:]{1,120}$/;
const INLINE_MIME = /^(image\/(png|jpeg|gif|webp)|video\/(mp4|webm|quicktime)|application\/pdf)$/;
const MAX_ASSET = 12 * 1024 * 1024;
const SESSION_DAYS = 30;

export function apiRoutes({ db, hub, dataDir, throttle }) {
  const r = express.Router();
  const q = {
    session: db.prepare('SELECT s.token_hash, s.device_id, s.last_seen AS s_seen, c.* FROM sessions s JOIN codes c ON c.id = s.code_id WHERE s.token_hash = ?'),
    codeByHash: db.prepare('SELECT * FROM codes WHERE code_hash = ?'),
    device: db.prepare('SELECT 1 FROM devices WHERE code_id = ? AND device_id = ?'),
    deviceCount: db.prepare('SELECT COUNT(*) AS n FROM devices WHERE code_id = ?'),
    upsertDevice: db.prepare(`INSERT INTO devices (code_id, device_id, info, ip, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(code_id, device_id) DO UPDATE SET info = excluded.info, ip = excluded.ip, last_seen = excluded.last_seen`),
    touch: db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?'),
    touchDevice: db.prepare('UPDATE devices SET last_seen = ?, ip = ? WHERE code_id = ? AND device_id = ?'),
    touchCode: db.prepare('UPDATE codes SET last_used_at = ? WHERE id = ?'),
    newSession: db.prepare('INSERT INTO sessions (token_hash, code_id, device_id, created_at, last_seen) VALUES (?, ?, ?, ?, ?)'),
    dropSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    log: db.prepare('INSERT INTO login_log (at, ip, ok, code_id, reason) VALUES (?, ?, ?, ?, ?)'),
    list: db.prepare('SELECT id, data FROM docs WHERE collection = ?'),
    get: db.prepare('SELECT data FROM docs WHERE collection = ? AND id = ?'),
    put: db.prepare(`INSERT INTO docs (collection, id, data, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by`),
    labels: db.prepare('SELECT id, label FROM codes'),
    newAsset: db.prepare('INSERT INTO assets (id, filename, mime, size, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)'),
    asset: db.prepare('SELECT * FROM assets WHERE id = ?'),
  };

  // الجلسة تُفحص مع كل طلب، فإقفال الكود أو انتهاؤه يسري فوراً
  function readSession(req) {
    const sid = parseCookies(req).sid;
    if (!sid) return { problem: 'none' };
    const row = q.session.get(sha(sid));
    if (!row) return { problem: 'none' };
    const problem = codeProblem(row);
    if (problem) return { problem };
    const now = nowIso();
    if (Date.parse(now) - Date.parse(row.s_seen) > 60_000) {
      q.touch.run(now, row.token_hash);
      q.touchDevice.run(now, req.ip || '', row.id, row.device_id);
      q.touchCode.run(now, row.id);
    }
    return { code: row };
  }
  function requireSession(req, res, next) {
    const s = readSession(req);
    if (!s.code) return res.status(401).json({ error: s.problem, message: PROBLEM_AR[s.problem] || 'سجّل الدخول أولاً.' });
    req.code = s.code;
    next();
  }
  // طلبات التعديل يجب أن تأتي من صفحات المنصة نفسها
  function requireAppHeader(req, res, next) {
    if (req.method !== 'GET' && req.get('x-app') !== '1') return res.status(400).json({ error: 'bad_request', message: 'طلب غير صالح.' });
    next();
  }
  r.use(requireAppHeader);

  r.post('/login', express.json({ limit: '10kb' }), (req, res) => {
    const ip = req.ip || '';
    const fail = (status, reason, codeId) => {
      q.log.run(nowIso(), ip, 0, codeId || null, reason);
      res.status(status).json({ error: reason, message: PROBLEM_AR[reason] });
    };
    if (throttle.blocked(ip)) return fail(429, 'throttled');
    const code = q.codeByHash.get(hashCode(req.body && req.body.code));
    const problem = codeProblem(code);
    if (problem) { if (problem === 'unknown') throttle.fail(ip); return fail(401, problem, code && code.id); }

    const cookies = parseCookies(req);
    const deviceId = /^[\w-]{20,64}$/.test(cookies.did || '') ? cookies.did : token();
    if (code.max_devices > 0 && !q.device.get(code.id, deviceId) && q.deviceCount.get(code.id).n >= code.max_devices) return fail(403, 'devices', code.id);

    const now = nowIso(), sid = token();
    q.upsertDevice.run(code.id, deviceId, String(req.get('user-agent') || '').slice(0, 200), ip, now, now);
    q.newSession.run(sha(sid), code.id, deviceId, now, now);
    q.touchCode.run(now, code.id);
    q.log.run(now, ip, 1, code.id, null);
    throttle.clear(ip);
    setCookie(res, 'sid', sid, { maxAge: SESSION_DAYS * 86400, secure: req.secure });
    setCookie(res, 'did', deviceId, { maxAge: 365 * 86400, secure: req.secure });
    res.json({ ok: true, role: code.role });
  });

  r.post('/logout', (req, res) => {
    const sid = parseCookies(req).sid;
    if (sid) q.dropSession.run(sha(sid));
    setCookie(res, 'sid', '', { maxAge: 0, secure: req.secure });
    res.json({ ok: true });
  });

  const me = c => ({ id: c.id, name: c.label, role: c.role, roleLabel: ROLES[c.role], perms: uiPerms(c.role), expiresAt: c.expires_at });
  r.get('/me', requireSession, (req, res) => res.json(me(req.code)));

  r.get('/profiles', requireSession, (req, res) => {
    const out = {};
    for (const c of q.labels.all()) out[c.id] = { name: c.label };
    res.json(out);
  });

  r.get('/events', requireSession, (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    hub.add(res, req.code.id, req.code.device_id);
  });

  function checkCollection(req, res, next) {
    if (!COLLECTIONS.includes(req.params.c)) return res.status(404).json({ error: 'not_found', message: 'مجموعة غير معروفة.' });
    next();
  }
  r.get('/db/:c', requireSession, checkCollection, (req, res) => {
    res.json({ docs: q.list.all(req.params.c).map(d => ({ id: d.id, data: JSON.parse(d.data) })) });
  });

  function write(op) {
    return (req, res) => {
      const { c, id } = req.params, code = req.code;
      // الرمز invalid_argument هو ما تتوقعه واجهة المنصة عند رفض الكتابة
      if (!canWrite(code.role, c, op)) return res.status(403).json({ code: 'invalid_argument', message: 'لا تملك صلاحية هذا الإجراء.' });
      if (!ID_RE.test(id)) return res.status(400).json({ code: 'invalid_argument', message: 'معرّف غير صالح.' });
      const body = req.body && req.body.data;
      if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ code: 'invalid_argument', message: 'بيانات غير صالحة.' });
      const old = q.get.get(c, id), oldData = old ? JSON.parse(old.data) : null;
      if (op === 'update' && !oldData) return res.status(404).json({ code: 'not_found', message: 'المستند غير موجود.' });
      if (c === 'audit' && oldData) return res.status(403).json({ code: 'invalid_argument', message: 'سجل العمليات لا يُعدَّل.' });
      const data = op === 'update' ? { ...oldData, ...body } : { ...body };
      // صاحب السجل يحدده الخادم من الجلسة، فلا يمكن انتحاله
      if (oldData && 'by' in oldData) data.by = oldData.by;
      else if (!oldData && (c !== 'reports' && c !== 'execReports')) data.by = code.id;
      q.put.run(c, id, JSON.stringify(data), nowIso(), code.id);
      hub.change(c);
      res.json({ ok: true });
    };
  }
  const json = express.json({ limit: '8mb' });
  r.put('/db/:c/:id', requireSession, checkCollection, json, write('set'));
  r.patch('/db/:c/:id', requireSession, checkCollection, json, write('update'));

  r.post('/assets', requireSession, express.raw({ type: () => true, limit: MAX_ASSET }), (req, res) => {
    if (!canWrite(req.code.role, 'media', 'set')) return res.status(403).json({ code: 'invalid_argument', message: 'لا تملك صلاحية رفع الملفات.' });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ code: 'invalid_argument', message: 'الملف فارغ.' });
    const id = shortId() + shortId();
    const name = String(req.query.name || 'file').replace(/[\\/\0]/g, '_').slice(0, 120);
    const mime = String(req.get('content-type') || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    fs.writeFileSync(path.join(dataDir, 'assets', id), req.body);
    q.newAsset.run(id, name, mime, req.body.length, nowIso(), req.code.id);
    res.json({ id, url: `/api/assets/${id}` });
  });

  r.get('/assets/:id', requireSession, (req, res) => {
    const a = /^[\w-]{8,40}$/.test(req.params.id) && q.asset.get(req.params.id);
    if (!a) return res.status(404).send('الملف غير موجود');
    // الأنواع الآمنة فقط تُعرض داخل المتصفح، وما عداها يُنزَّل كملف
    const inline = INLINE_MIME.test(a.mime);
    res.set({
      'Content-Type': inline ? a.mime : 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, max-age=86400',
    });
    fs.createReadStream(path.join(dataDir, 'assets', a.id)).pipe(res);
  });

  // أخطاء الجسم (حجم زائد، JSON تالف) برسالة مفهومة
  r.use((err, req, res, next) => {
    if (err && err.type === 'entity.too.large') return res.status(413).json({ code: 'quota_exceeded', message: 'حجم البيانات أكبر من المسموح.' });
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ code: 'invalid_argument', message: 'بيانات غير صالحة.' });
    next(err);
  });

  return { router: r, readSession };
}
