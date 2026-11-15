const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

// البرنامج نافذة على المنصة المشتركة: البيانات والدخول بالكود من الخادم نفسه
const PLATFORM_URL = 'https://platform-production-1dc5a52d.up.railway.app';
const ORIGIN = new URL(PLATFORM_URL).origin;
const sameOrigin = url => { try { return new URL(url).origin === ORIGIN; } catch { return false; } };

if (!app.requestSingleInstanceLock()) app.quit();

let win;
const offlinePage = path.join(__dirname, 'app', 'offline.html');

function loadPlatform() {
  win.loadURL(PLATFORM_URL).catch(() => {});
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 650,
    title: 'المنصة الجغرافية المرجعية',
    backgroundColor: '#090D12',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.maximize();
  loadPlatform();

  const wc = win.webContents;
  // تعذّر الوصول للخادم (لا إنترنت مثلاً): صفحة محلية فيها زر إعادة المحاولة
  wc.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3 && !url.startsWith('file:')) win.loadFile(offlinePage);
  });
  // زر «إعادة المحاولة» في الصفحة المحلية ينتقل إلى عنوان المنصة
  wc.on('will-navigate', (e, url) => {
    if (sameOrigin(url) || url.startsWith('file:')) return;
    e.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });
  // روابط المنصة نفسها (صور وملفات المشاريع) تُفتح في نافذة داخل البرنامج، وغيرها في المتصفح
  wc.setWindowOpenHandler(({ url }) => {
    if (sameOrigin(url)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: '#090D12' } };
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('page-title-updated', e => e.preventDefault());
}

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'عرض', submenu: [
      { label: 'إعادة تحميل المنصة', accelerator: 'F5', click: loadPlatform },
      { role: 'togglefullscreen', label: 'ملء الشاشة' },
      { role: 'zoomIn', label: 'تكبير' },
      { role: 'zoomOut', label: 'تصغير' },
      { role: 'resetZoom', label: 'الحجم الافتراضي' },
      { type: 'separator' },
      { role: 'toggleDevTools', label: 'أدوات المطور' },
    ]},
    { label: 'خروج', role: 'quit' },
  ]));
  createWindow();
});

app.on('window-all-closed', () => app.quit());
