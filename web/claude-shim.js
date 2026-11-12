// طبقة بديلة لخدمات claude.ai: تعرّف window.claude بالواجهة التي يتوقعها كود المنصة
// وتوصلها بخادم المنصة (قاعدة بيانات مشتركة، بث حي، رفع ملفات).
(function () {
  'use strict';
  var ME = window.__ME;
  var leaving = false;
  function leave(reason) {
    if (leaving) return;
    leaving = true;
    location.replace('/login' + (reason && reason !== 'none' ? '?why=' + encodeURIComponent(reason) : ''));
  }
  if (!ME) { leave(); return; }

  function fail(code, message) { var e = new Error(message || code); e.code = code; return e; }
  async function call(method, url, body, rawType) {
    var headers = { 'x-app': '1' };
    if (rawType) headers['content-type'] = rawType;
    else if (body !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(body); }
    var res;
    try { res = await fetch(url, { method: method, headers: headers, body: body, credentials: 'same-origin' }); }
    catch (e) { throw fail('unavailable', 'تعذّر الاتصال بالخادم'); }
    var json = null;
    try { json = await res.json(); } catch (e) {}
    if (res.status === 401) { leave(json && json.error); throw fail('unauthenticated', json && json.message); }
    if (!res.ok) throw fail((json && (json.code || json.error)) || 'internal', json && json.message);
    return json;
  }

  // ── قاعدة البيانات: واجهة collection().onSnapshot() و doc().set()/update() ──
  var subs = {};   // collection -> [{ cb, err }]
  var seq = {};    // لتجاهل الردود المتأخرة عن طلب أحدث
  function snapshot(docs) {
    return { docs: docs.map(function (d) { return { id: d.id, data: function () { return d.data; } }; }) };
  }
  function load(c) {
    var n = (seq[c] = (seq[c] || 0) + 1);
    return call('GET', '/api/db/' + c).then(function (r) {
      if (n !== seq[c]) return;
      var snap = snapshot(r.docs);
      (subs[c] || []).forEach(function (s) { try { s.cb(snap); } catch (e) { console.error(e); } });
    }, function (e) {
      if (n !== seq[c] || e.code === 'unauthenticated') return;
      (subs[c] || []).forEach(function (s) { if (s.err) try { s.err(e); } catch (x) {} });
    });
  }

  var stream = null, firstHello = true;
  function connect() {
    if (stream || leaving) return;
    stream = new EventSource('/api/events');
    stream.addEventListener('hello', function () {
      // عند إعادة الاتصال بعد انقطاع: نحدّث كل ما فاتنا
      if (!firstHello) Object.keys(subs).forEach(load);
      firstHello = false;
    });
    stream.addEventListener('change', function (ev) {
      var c = JSON.parse(ev.data).collection;
      if (subs[c] && subs[c].length) load(c);
    });
    stream.addEventListener('bye', function (ev) { leave(JSON.parse(ev.data).reason); });
    stream.addEventListener('reload', function () { location.reload(); });
    stream.onerror = function () {
      // المتصفح يعيد المحاولة تلقائياً، إلا إذا رفض الخادم الجلسة
      if (stream && stream.readyState === EventSource.CLOSED) {
        stream = null;
        call('GET', '/api/me').then(function () { setTimeout(connect, 3000); }, function (e) { if (e.code !== 'unauthenticated') setTimeout(connect, 5000); });
      }
    };
  }

  var db = {
    collection: function (c) {
      return {
        onSnapshot: function (cb, err) {
          var s = { cb: cb, err: err };
          (subs[c] = subs[c] || []).push(s);
          load(c);
          connect();
          return function () { subs[c] = (subs[c] || []).filter(function (x) { return x !== s; }); };
        },
        doc: function (id) {
          var url = '/api/db/' + c + '/' + encodeURIComponent(id);
          return {
            set: function (data) { return call('PUT', url, { data: data }); },
            update: function (patch) { return call('PATCH', url, { data: patch }); },
          };
        },
      };
    },
  };

  var names = null;
  var user = {
    can: function (perm) { return perm === 'data.write' ? !!ME.perms.dataWrite : false; },
    canEdit: function () { return !!ME.perms.editor; },
    id: function () { return ME.id; },
    profiles: function (ids) {
      names = names || call('GET', '/api/profiles');
      return names.then(function (all) { var out = {}; ids.forEach(function (id) { if (all[id]) out[id] = all[id]; }); names = null; return out; });
    },
  };

  var assets = {
    upload: function (file) {
      return call('POST', '/api/assets?name=' + encodeURIComponent(file.name || 'file'), file, file.type || 'application/octet-stream');
    },
  };

  var services = { db: db, user: user, assets: ME.perms.upload ? assets : null, downloads: null };
  window.claude = { use: function (name) { return Promise.resolve(services[name] || null); } };

  window.__logout = function () {
    call('POST', '/api/logout').then(function () { leave(); }, function () { leave(); });
  };
})();
