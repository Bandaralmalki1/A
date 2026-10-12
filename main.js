const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

// Single instance so localStorage data isn't contended by two windows.
if (!app.requestSingleInstanceLock()) app.quit();

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 650,
    title: 'منصة وكالة التشغيل',
    backgroundColor: '#090D12',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.maximize();
  win.loadFile(path.join(__dirname, 'app', 'index.html'));

  // Open external links in the default browser instead of inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('page-title-updated', (e) => e.preventDefault());
}

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'عرض', submenu: [
      { role: 'reload', label: 'إعادة تحميل' },
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
