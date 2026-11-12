import express from 'express';
import { ROLES } from '../perms.js';
import { codeProblem, hashCode, newCode, nowIso, parseCookies, safeEqual, setCookie, sha, shortId, token } from '../auth.js';

const ADMIN_HOURS = 12;

export function adminRoutes({ db, hub, adminPassword, throttle }) {
  const r = express.Router();
  const q = {
    adminSession: db.prepare('SELECT created_at FROM admin_sessions WHERE token_hash = ?'),
    newAdmin: db.prepare('INSERT INTO admin_sessions (token_hash, created_at) VALUES (?, ?)'),
    dropAdmin: db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?'),
    codes: db.prepare('SELECT * FROM codes ORDER BY created_at DESC'),
    code: db.prepare('SELECT * FROM codes WHERE id = ?'),
    devices: db.prepare('SELECT * FROM devices ORDER BY last_seen DESC'),
    insert: db.prepare('INSERT INTO codes (id, label, code_hash, role, expires_at, locked, max_devices, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)'),
    update: db.prepare('UPDATE codes SET label = ?, role = ?, expires_at = ?, locked = ?, max_devices = ? WHERE id = ?'),
    rehash: db.prepare('UPDATE codes SET code_hash = ? WHERE id = ?'),
    del: db.prepare('DELETE FROM codes WHERE id = ?'),
    dropSessions: db.prepare('DELETE FROM sessions WHERE code_id = ?'),
    dropDevices: db.prepare('DELETE FROM devices WHERE code_id = ?'),
    dropDevice: db.prepare('DELETE FROM devices WHERE code_id = ? AND device_id = ?'),
    dropDeviceSessions: db.prepare('DELETE FROM sessions WHERE code_id = ? AND device_id = ?'),
    log: db.prepare('SELECT l.at, l.ip, l.ok, l.reason, c.label FROM login_log l LEFT JOIN codes c ON c.id = l.code_id ORDER BY l.at DESC LIMIT 100'),
    docs: db.prepare('SELECT collection, id, data, updated_at, updated_by FROM docs'),
  };

  function requireAdmin(req, res, next) {
    const t = parseCookies(req).adm, row = t && q.adminSession.get(sha(t));
    if (!row || Date.now() - Date.parse(row.created_at) > ADMIN_HOURS * 3600_000) return res.status(401).json({ error: 'admin', message: 'سجّل دخول المدير أولاً.' });
    next();
  }

  r.post('/login', express.json({ limit: '10kb' }), (req, res) => {
    const key = 'adm:' + (req.ip || '');
    if (throttle.blocked(key)) return res.status(429).json({ error: 'throttled', message: 'محاولات كثيرة. انتظر ربع ساعة ثم حاول مرة أخرى.' });
    if (!safeEqual(String((req.body && req.body.password) || ''), adminPassword)) {
      throttle.fail(key);
      return res.status(401).json({ error: 'password', message: 'كلمة المرور غير صحيحة.' });
    }
    throttle.clear(key);
    const t = token();
    q.newAdmin.run(sha(t), nowIso());
    setCookie(res, 'adm', t, { maxAge: ADMIN_HOURS * 3600, secure: req.secure });
    res.json({ ok: true });
  });
  r.post('/logout', (req, res) => {
    const t = parseCookies(req).adm;
    if (t) q.dropAdmin.run(sha(t));
    setCookie(res, 'adm', '', { maxAge: 0, secure: req.secure });
    res.json({ ok: true });
  });

  r.use(requireAdmin, express.json({ limit: '10kb' }));

  const view = (c, devices, online) => ({
    id: c.id, label: c.label, role: c.role, roleLabel: ROLES[c.role], expiresAt: c.expires_at, locked: !!c.locked,
    maxDevices: c.max_devices, createdAt: c.created_at, lastUsedAt: c.last_used_at,
    status: codeProblem(c) || 'active',
    devices: devices.filter(d => d.code_id === c.id).map(d => ({ id: d.device_id, info: d.info, ip: d.ip, firstSeen: d.first_seen, lastSeen: d.last_seen, online: online.has(c.id + '|' + d.device_id) })),
  });
  r.get('/codes', (req, res) => {
    const devices = q.devices.all(), online = new Set();
    hub.each(c => online.add(c.codeId + '|' + c.deviceId));
    res.json({ roles: ROLES, codes: q.codes.all().map(c => view(c, devices, online)) });
  });

  // يتحقق من الحقول المرسلة فقط ويعيد خطأً عربياً واضحاً
  function clean(body, base) {
    const out = { ...base };
    if ('label' in body) { out.label = String(body.label || '').trim().slice(0, 80); if (!out.label) return { error: 'اكتب اسم صاحب الكود.' }; }
    if ('role' in body) { if (!ROLES[body.role]) return { error: 'اختر صلاحية صحيحة.' }; out.role = body.role; }
    if ('expiresAt' in body) {
      if (body.expiresAt == null || body.expiresAt === '') out.expires_at = null;
      else { const t = Date.parse(body.expiresAt); if (Number.isNaN(t)) return { error: 'تاريخ الانتهاء غير صالح.' }; out.expires_at = new Date(t).toISOString(); }
    }
    if ('maxDevices' in body) { const n = Number(body.maxDevices); if (!Number.isInteger(n) || n < 0 || n > 50) return { error: 'عدد الأجهزة يجب أن يكون بين 0 و50 (0 = بلا قيد).' }; out.max_devices = n; }
    if ('locked' in body) out.locked = body.locked ? 1 : 0;
    return { value: out };
  }

  r.post('/codes', (req, res) => {
    const c = clean({ label: '', role: '', expiresAt: null, maxDevices: 1, ...req.body }, {});
    if (c.error) return res.status(400).json({ message: c.error });
    const id = shortId(), plain = newCode(), v = c.value;
    q.insert.run(id, v.label, hashCode(plain), v.role, v.expires_at, v.max_devices, nowIso());
    res.json({ code: plain, item: view(q.code.get(id), [], new Set()) });
  });

  r.patch('/codes/:id', (req, res) => {
    const old = q.code.get(req.params.id);
    if (!old) return res.status(404).json({ message: 'الكود غير موجود.' });
    const c = clean(req.body || {}, old);
    if (c.error) return res.status(400).json({ message: c.error });
    const v = c.value;
    q.update.run(v.label, v.role, v.expires_at, v.locked, v.max_devices, old.id);
    const problem = codeProblem(v);
    if (problem) hub.kick(old.id, problem);
    else if (v.role !== old.role) hub.notify(old.id, 'reload');
    res.json({ ok: true });
  });

  r.post('/codes/:id/regenerate', (req, res) => {
    const old = q.code.get(req.params.id);
    if (!old) return res.status(404).json({ message: 'الكود غير موجود.' });
    const plain = newCode();
    q.rehash.run(hashCode(plain), old.id);
    q.dropSessions.run(old.id); q.dropDevices.run(old.id);
    hub.kick(old.id, 'none');
    res.json({ code: plain });
  });

  r.delete('/codes/:id', (req, res) => {
    q.del.run(req.params.id);
    hub.kick(req.params.id, 'none');
    res.json({ ok: true });
  });

  r.delete('/codes/:id/devices/:did', (req, res) => {
    q.dropDeviceSessions.run(req.params.id, req.params.did);
    q.dropDevice.run(req.params.id, req.params.did);
    hub.kick(req.params.id, 'none', req.params.did);
    res.json({ ok: true });
  });

  r.get('/log', (req, res) => res.json({ log: q.log.all() }));

  // نسخة احتياطية من بيانات المنصة (بلا أكواد الدخول)
  r.get('/backup', (req, res) => {
    res.set('Content-Disposition', `attachment; filename="taif-platform-backup-${nowIso().slice(0, 10)}.json"`);
    res.json({ at: nowIso(), docs: q.docs.all().map(d => ({ ...d, data: JSON.parse(d.data) })) });
  });

  return r;
}
