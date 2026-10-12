# منصة وكالة التشغيل — تطبيق سطح المكتب (Windows)

تطبيق Electron يغلّف المنصة ويعمل بدون إنترنت. البيانات تُحفظ محلياً على الجهاز.

## البناء
```bash
npm install
npm start          # تشغيل للتجربة
npm run dist:win   # بناء ملفات ويندوز في مجلد dist/
```
الناتج:
- `Operations-Agency-Setup-<version>.exe` — مثبّت (يضيف اختصاراً على سطح المكتب وقائمة ابدأ)
- `Operations-Agency-Portable-<version>.exe` — نسخة محمولة تعمل بدون تثبيت

لتحديث المنصة: استبدل `app/index.html` بالنسخة الجديدة ثم أعد البناء.
