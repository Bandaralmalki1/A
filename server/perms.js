// الصلاحيات تُفرض هنا في الخادم. الواجهة تعكسها فقط.
export const ROLES = {
  owner: 'مالك المنصة',
  ceo: 'الرئيس التنفيذي',
  pmo: 'مدير مكتب المشاريع PMO',
  entry: 'مدخل البيانات',
  viewer: 'مشاهد',
};

export const COLLECTIONS = ['reports', 'directives', 'execReports', 'updates', 'prisks', 'media', 'scopes', 'audit'];

// op: set = إنشاء أو استبدال مستند، update = تعديل حقول مستند موجود
const RULES = {
  reports: { set: ['pmo', 'entry'], update: ['pmo', 'entry'] },
  execReports: { set: ['pmo'], update: ['pmo'] },
  directives: { set: ['ceo', 'pmo'], update: ['ceo', 'pmo'] },
  updates: { set: ['pmo', 'entry'], update: ['pmo', 'entry'] },
  prisks: { set: ['pmo', 'entry'], update: ['pmo', 'entry'] },
  media: { set: ['pmo', 'entry'], update: ['pmo', 'entry'] },
  scopes: { set: ['pmo', 'entry'], update: ['pmo', 'entry'] },
  audit: { set: ['ceo', 'pmo', 'entry'], update: [] },
};

export function canWrite(role, collection, op) {
  const r = RULES[collection];
  if (!r) return false;
  // المالك يملك كل ما يملكه أي دور آخر (سجل العمليات يبقى بلا تعديل)
  if (role === 'owner') return op === 'set' || r.update.length > 0;
  return (r[op] || []).includes(role);
}

// ما تحتاجه الواجهة لتُظهر أو تُخفي الأزرار
export function uiPerms(role) {
  return {
    dataWrite: canWrite(role, 'reports', 'set'),
    editor: role === 'pmo' || role === 'owner',
    directives: canWrite(role, 'directives', 'set'),
    upload: canWrite(role, 'media', 'set'),
  };
}

// لوحات المنصة، بترتيب ظهورها. يمكن قصر كود المشاهد على بعضها.
export const TABS = {
  ceo: 'لوحة الرئيس التنفيذي', live: 'البث المباشر', dept: 'لوحات الإدارات', pmo: 'لوحة PMO', ops: 'غرفة العمليات',
  table: 'سجل المشاريع', ai: 'التحليل والتوصيات', story: 'العرض القصصي', plan: 'المخطط التنفيذي',
};

// كود المنصة يعرف أربعة أدوار فقط؛ المالك يظهر فيها بواجهة مدير المشاريع
export const appRole = role => (role === 'owner' ? 'pmo' : role);

// اللوحات المسموحة لكود: null = الكل. القيد للمشاهد فقط.
export function allowedTabs(code) {
  if (code.role !== 'viewer' || !code.tabs) return null;
  let list; try { list = JSON.parse(code.tabs); } catch { return null; }
  const ok = Object.keys(TABS).filter(k => Array.isArray(list) && list.includes(k));
  return ok.length && ok.length < Object.keys(TABS).length ? ok : null;
}

export const meOf = c => ({
  id: c.id, name: c.label, role: appRole(c.role), roleLabel: ROLES[c.role], owner: c.role === 'owner',
  perms: uiPerms(c.role), tabs: allowedTabs(c), expiresAt: c.expires_at,
});
