import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { makeHub } from './events.js';
import { codeProblem, makeThrottle } from './auth.js';
import { apiRoutes } from './routes/api.js';
import { adminRoutes } from './routes/admin.js';
import { ROLES, uiPerms } from './perms.js';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');

export function createApp({ dataDir, adminPassword, trustProxy = 1 }) {
  const db = openDb(dataDir);
  const hub = makeHub();
  const throttle = makeThrottle();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
    next();
  });

  const api = apiRoutes({ db, hub, dataDir, throttle });
  app.use('/api/admin', adminRoutes({ db, hub, adminPassword, throttle }));
  app.use('/api', api.router);

  // ملف المنصة كبير (نحو 1.8 ميغابايت)، فيُضغط مرة واحدة عند التشغيل
  const page = name => {
    const raw = fs.readFileSync(path.join(WEB, name));
    const gz = zlib.gzipSync(raw);
    return (req, res) => {
      res.set({ 'Content-Type': name.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding' });
      if (/\bgzip\b/.test(req.get('accept-encoding') || '')) res.set('Content-Encoding', 'gzip').send(gz);
      else res.send(raw);
    };
  };
  const appPage = page('app.html'), loginPage = page('login.html');

  app.get('/', (req, res) => (api.readSession(req).code ? appPage(req, res) : res.redirect('/login')));
  app.get('/login', (req, res) => (api.readSession(req).code ? res.redirect('/') : loginPage(req, res)));
  app.get('/admin', page('admin.html'));
  app.get('/claude-shim.js', page('claude-shim.js'));
  app.get('/ui.css', (req, res) => res.sendFile(path.join(WEB, 'ui.css')));
  // بيانات المستخدم الحالي، تُحمَّل قبل كود المنصة
  app.get('/me.js', (req, res) => {
    const c = api.readSession(req).code;
    const me = c ? { id: c.id, name: c.label, role: c.role, roleLabel: ROLES[c.role], perms: uiPerms(c.role), expiresAt: c.expires_at } : null;
    res.set({ 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    res.send('window.__ME = ' + JSON.stringify(me).replace(/</g, '\\u003c') + ';');
  });
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  // نبضة دورية تُبقي الاتصال الحي مفتوحاً وتُخرج الأكواد التي انتهت مدتها
  const codeById = db.prepare('SELECT * FROM codes WHERE id = ?');
  const timer = setInterval(() => {
    hub.ping();
    hub.each(c => { const p = codeProblem(codeById.get(c.codeId)); if (p) hub.kick(c.codeId, p); });
  }, 20_000);
  timer.unref();

  return { app, db, hub, close() { clearInterval(timer); hub.each(c => { try { c.res.end(); } catch {} }); db.close(); } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
  let adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword && process.env.NODE_ENV === 'production') {
    // في النشر لا نولّد كلمة مؤقتة: لوحة المدير تتحكم في كل الأكواد
    console.error('لم يُضبط المتغير ADMIN_PASSWORD. أضفه في إعدادات الاستضافة (Variables) بكلمة مرور قوية ثم أعد النشر.');
    process.exit(1);
  }
  if (!adminPassword) {
    adminPassword = crypto.randomBytes(9).toString('base64url');
    console.log(`\n[تنبيه] لم يُضبط ADMIN_PASSWORD. كلمة مرور المدير لهذه الجلسة فقط: ${adminPassword}\n`);
  }
  const port = Number(process.env.PORT) || 3000;
  const { app } = createApp({ dataDir, adminPassword });
  app.listen(port, () => console.log(`المنصة تعمل على المنفذ ${port} — لوحة المدير: /admin`));
}
