// بث التغييرات الحية (SSE): كل متصفح مفتوح يحتفظ باتصال واحد
export function makeHub() {
  const clients = new Set(); // { res, codeId }
  const send = (c, event, data) => { try { c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {} };
  return {
    add(res, codeId, deviceId) {
      const c = { res, codeId, deviceId };
      clients.add(c);
      res.on('close', () => clients.delete(c));
      send(c, 'hello', {});
      return c;
    },
    change(collection) { for (const c of clients) send(c, 'change', { collection }); },
    // إخراج كل اتصالات كود معيّن (إقفال، حذف، انتهاء) أو إبلاغها بتغيّر الدور
    kick(codeId, reason, deviceId) {
      for (const c of clients) {
        if (c.codeId !== codeId || (deviceId && c.deviceId !== deviceId)) continue;
        send(c, 'bye', { reason });
        try { c.res.end(); } catch {}
        clients.delete(c);
      }
    },
    notify(codeId, event) { for (const c of clients) if (c.codeId === codeId) send(c, event, {}); },
    ping() { for (const c of clients) { try { c.res.write(': ping\n\n'); } catch {} } },
    each(fn) { for (const c of [...clients]) fn(c); },
    get size() { return clients.size; },
  };
}
