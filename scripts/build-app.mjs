// يبني web/app.html من ملف المنصة المُنزَّل من claude.ai.
// الاستخدام: node scripts/build-app.mjs <ملف-المنصة.html>
// يحقن طبقة الاتصال بالخادم ويقفل قائمة الدور على دور كود الدخول.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = process.argv[2];
if (!src) { console.error('الاستخدام: node scripts/build-app.mjs <ملف-المنصة.html>'); process.exit(1); }
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'app.html');

const TEMPLATE_RE = /(<script type="__bundler\/template">\s*)("[\s\S]*?")(\s*<\/script>)/;
const MANIFEST_RE = /<script type="__bundler\/manifest">\s*([\s\S]*?)\s*<\/script>/;

let html = fs.readFileSync(src, 'utf8');
// صفحة العرض في claude.ai تغلّف المستند؛ نأخذ المستند الداخلي
const start = html.lastIndexOf('<!DOCTYPE html>', html.indexOf('__bundler/manifest'));
if (start < 0) throw new Error('الملف ليس حزمة منصة معروفة');
html = html.slice(start);
// بعض الإصدارات مغلّفة مرتين: حزمة فارغة بداخلها الحزمة الحقيقية
for (;;) {
  const man = MANIFEST_RE.exec(html), tpl = TEMPLATE_RE.exec(html);
  if (!man || !tpl || man[1].trim() !== '{}') break;
  const inner = JSON.parse(tpl[2]);
  if (!inner.includes('__bundler/manifest')) break;
  html = inner;
}

const tpl = TEMPLATE_RE.exec(html);
if (!tpl) throw new Error('لم يُعثر على قالب المنصة');
let app = JSON.parse(tpl[2]);

// كل تعديل يجب أن يطابق مرة واحدة بالضبط، وإلا فالإصدار الجديد غيّر الكود ويلزم تحديث هذا الملف
function patch(name, from, to) {
  const n = app.split(from).length - 1;
  if (n !== 1) throw new Error(`تعديل «${name}»: وُجد ${n} مرة بدل مرة واحدة`);
  app = app.replace(from, () => to);
}
patch('الدور الابتدائي من كود الدخول', "role: 'pmo',", "role: (window.__ME && window.__ME.role) || 'viewer',");
patch('قفل قائمة الدور وإضافة الخروج',
  "roleOpts: ROLES.map(r => ({ k: r.k, label: r.label })), role: st.role, onRole: e => this.setState({ role: e.target.value, dataOpen: false }),",
  "roleOpts: [{ k: st.role, label: ROLES.find(r => r.k === st.role).label + (window.__ME ? ' — ' + window.__ME.name : '') }, { k: '__logout', label: 'تسجيل الخروج' }], role: st.role, onRole: e => { if (e.target.value === '__logout' && window.__logout) window.__logout(); },");
patch('التوجيهات حسب صلاحية الكود',
  "canDir() { return this.state.dbState === 'live' ? !this.dirRO :",
  "canDir() { if (window.__ME && !window.__ME.perms.directives) return false; return this.state.dbState === 'live' ? !this.dirRO :");

const encoded = JSON.stringify(app).replace(/<\//g, '<\\u002F');
html = html.replace(TEMPLATE_RE, (m, a, b, c) => a + encoded + c);

const head = /<meta charset="utf-8">/i.exec(html);
if (!head) throw new Error('لم يُعثر على ترويسة الصفحة');
const at = head.index + head[0].length;
html = html.slice(0, at) + '\n  <script src="/me.js"></script>\n  <script src="/claude-shim.js"></script>' + html.slice(at);
// بقايا غلاف العرض بعد نهاية المستند
html = html.replace(/(<\/html>)[\s\S]*$/, '$1\n');

fs.writeFileSync(out, html);
console.log(`كُتب ${path.relative(process.cwd(), out)} — ${(html.length / 1048576).toFixed(2)} ميغابايت`);
