// الصلاحيات تُفرض هنا في الخادم. الواجهة تعكسها فقط.
export const ROLES = {
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
  return !!r && (r[op] || []).includes(role);
}

// ما تحتاجه الواجهة لتُظهر أو تُخفي الأزرار
export function uiPerms(role) {
  return {
    dataWrite: canWrite(role, 'reports', 'set'),
    editor: role === 'pmo',
    directives: canWrite(role, 'directives', 'set'),
    upload: canWrite(role, 'media', 'set'),
  };
}
