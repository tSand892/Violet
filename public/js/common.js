/* Shared browser helpers for every page. Exposes window.Violet. */
(function (global) {
  'use strict';

  var TOKEN_KEY = 'violet_token';

  async function request(method, path, body, token) {
    var headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = 'Bearer ' + token;
    var res = await fetch(path, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) });
    var data = null;
    try { data = await res.json(); } catch (e) { /* no JSON body */ }
    if (!res.ok) {
      var err = new Error((data && data.error) || ('Request failed (' + res.status + ')'));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  var api = {
    get: function (path, token) { return request('GET', path, undefined, token); },
    post: function (path, body, token) { return request('POST', path, body, token); },
  };

  var auth = {
    token: function () { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } },
    save: function (token) {
      try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY); } catch (e) { /* storage blocked */ }
    },
    // Decodes the token payload for UI purposes only; the server always re-verifies the signature.
    user: function () {
      var token = auth.token();
      if (!token) return null;
      try {
        var payload = JSON.parse(atob(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
        if (!payload.exp || payload.exp < Date.now()) { auth.save(null); return null; }
        return payload;
      } catch (e) { return null; }
    },
    logout: function () { auth.save(null); location.href = '/'; },
  };

  function $(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function clampText(value, max) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max); }

  function money(cents, currency) {
    var code = (currency || 'usd').toUpperCase();
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(cents / 100); }
    catch (e) { return (cents / 100).toFixed(2) + ' ' + code; }
  }

  // Creates a PeerJS peer using the signaling/ICE settings the server handed us.
  function makePeer(id, site) {
    var options = {
      debug: 1,
      config: { iceServers: (site && site.iceServers) || [{ urls: 'stun:stun.l.google.com:19302' }] },
    };
    var server = site && site.peer;
    if (server && server.host) {
      options.host = server.host;
      options.port = server.port || 443;
      options.path = server.path || '/';
      options.secure = server.secure !== false;
      options.key = server.key || 'peerjs';
    }
    return id ? new Peer(id, options) : new Peer(options);
  }

  function renderNav(site) {
    if (site && site.name) {
      document.querySelectorAll('[data-site-name]').forEach(function (el) { el.textContent = site.name; });
      if (document.title === 'Violet') document.title = site.name;
    }
    var nav = $('nav');
    if (!nav) return;
    var user = auth.user();
    var next = encodeURIComponent(location.pathname + location.search);
    if (user) {
      nav.innerHTML =
        (user.role === 'streamer' ? '<a class="btn primary small" href="/studio">Studio</a>' : '') +
        '<span class="pill" title="@' + esc(user.sub) + '">' + esc(user.name) + '</span>' +
        '<button class="btn ghost small" type="button" id="nav-logout">Log out</button>';
      $('nav-logout').addEventListener('click', auth.logout);
    } else {
      nav.innerHTML =
        '<a class="btn ghost small" href="/account?next=' + next + '">Log in</a>' +
        '<a class="btn primary small" href="/account?mode=signup&next=' + next + '">Sign up</a>';
    }
  }

  // Appends a chat line { name, text, kind } to a log element, keeping it scrolled to the bottom.
  function addLine(log, line) {
    if (!log) return;
    var el = document.createElement('div');
    el.className = 'line' + (line.kind ? ' ' + line.kind : '');
    if (line.name) {
      var name = document.createElement('span');
      name.className = 'name';
      name.textContent = line.name + ' ';
      el.appendChild(name);
    }
    el.appendChild(document.createTextNode(line.text || ''));
    var stick = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    log.appendChild(el);
    while (log.children.length > 300) log.removeChild(log.firstChild);
    if (stick) log.scrollTop = log.scrollHeight;
  }

  var toastTimer = null;
  function toast(message, isError) {
    var el = $('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
    el.className = 'toast' + (isError ? ' error' : '');
    el.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add('hidden'); }, 4500);
  }

  // /c/<username> (Netlify rewrite) or ?c=<username>
  function channelFromUrl() {
    var m = location.pathname.match(/^\/c\/([A-Za-z0-9_]+)/);
    if (m) return m[1].toLowerCase();
    var q = new URLSearchParams(location.search).get('c');
    return q ? q.toLowerCase() : null;
  }

  global.Violet = {
    api: api, auth: auth, $: $, esc: esc, clampText: clampText, money: money,
    makePeer: makePeer, renderNav: renderNav, addLine: addLine, toast: toast, channelFromUrl: channelFromUrl,
  };
})(window);
