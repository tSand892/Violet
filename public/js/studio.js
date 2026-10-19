/* Streamer studio: broadcast from the browser, manage the tip menu, see tips and chat. */
(function () {
  'use strict';
  var V = window.Violet;
  var $ = V.$;

  var QUALITY = {
    '480': { width: 854, height: 480, bitrate: 800000 },
    '720': { width: 1280, height: 720, bitrate: 1500000 },
    '1080': { width: 1920, height: 1080, bitrate: 3000000 },
  };
  var AUDIO = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

  var state = {
    token: V.auth.token(), me: null, site: null, channel: null,
    stream: null, source: 'camera', micOn: true, camOn: true,
    peer: null, peerId: null, live: false, startedAt: null,
    conns: new Map(), calls: new Map(), names: new Map(),
    seenTips: new Set(), tipTotal: 0, timers: {},
  };

  if (!V.auth.user()) { location.replace('/account?next=/studio'); return; }

  var preview = $('preview');
  var chatLog = $('chat-log');

  /* ---------- boot ---------- */

  async function init() {
    var data;
    try {
      data = await V.api.get('/api/me', state.token);
    } catch (err) {
      if (err.status === 401) { V.auth.save(null); location.replace('/account?next=/studio'); return; }
      V.renderNav(null);
      V.toast(err.message, true);
      return;
    }
    if (data.token) { V.auth.save(data.token); state.token = data.token; }
    state.me = data.user;
    state.site = data.site;
    state.channel = data.channel;
    V.renderNav(data.site);
    document.title = 'Studio · ' + data.site.name;

    if (data.user.role !== 'streamer') { $('not-streamer').classList.remove('hidden'); return; }
    $('dashboard').classList.remove('hidden');

    var url = location.origin + '/c/' + data.user.username;
    $('channel-url').textContent = url;
    $('channel-url').href = url;
    $('title').value = data.channel.title || '';
    renderMenuEditor();
    updateStats();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      $('source').querySelector('option[value="screen"]').disabled = true;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      V.toast('This browser cannot access the camera. Use a recent Chrome, Edge, Firefox or Safari over HTTPS.', true);
    }

    try {
      var liveNow = await V.api.get('/api/live', state.token);
      if (liveNow.state.live) V.toast('A previous broadcast is still marked live. Going live again replaces it.');
    } catch (e) { /* ignore */ }
  }

  /* ---------- media ---------- */

  function videoConstraints() {
    var q = QUALITY[$('quality').value] || QUALITY['720'];
    return { width: { ideal: q.width }, height: { ideal: q.height }, frameRate: { ideal: 30, max: 30 } };
  }

  async function startSource(kind) {
    var stream;
    if (kind === 'screen') {
      var display = await navigator.mediaDevices.getDisplayMedia({ video: videoConstraints(), audio: false });
      var mic = null;
      try { mic = await navigator.mediaDevices.getUserMedia({ audio: AUDIO }); }
      catch (e) { V.toast('No microphone available, sharing the screen without sound.'); }
      stream = new MediaStream(display.getVideoTracks().concat(mic ? mic.getAudioTracks() : []));
      // When the user hits the browser's own "Stop sharing" button, fall back to the camera.
      display.getVideoTracks()[0].addEventListener('ended', function () {
        if (state.source === 'screen') {
          $('source').value = 'camera';
          startSource('camera').catch(showError);
        }
      });
    } else {
      stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(), audio: AUDIO });
    }

    var old = state.stream;
    state.stream = stream;
    state.source = kind;
    preview.srcObject = stream;
    preview.muted = true;
    preview.play().catch(function () { /* autoplay is fine for muted video */ });
    applyToggles();
    state.calls.forEach(function (call) { replaceTracks(call, stream); });
    if (old) old.getTracks().forEach(function (t) { t.stop(); });
    $('go-live').disabled = false;
    $('preview-hint').classList.add('hidden');
  }

  // Swap the tracks being sent to every connected viewer (source or quality change).
  function replaceTracks(call, stream) {
    var pc = call.peerConnection;
    if (!pc) return;
    pc.getSenders().forEach(function (sender) {
      if (!sender.track) return;
      var next = stream.getTracks().find(function (t) { return t.kind === sender.track.kind; });
      if (next && next !== sender.track) sender.replaceTrack(next).catch(function (e) { console.warn(e); });
    });
  }

  function applyToggles() {
    if (state.stream) {
      state.stream.getAudioTracks().forEach(function (t) { t.enabled = state.micOn; });
      state.stream.getVideoTracks().forEach(function (t) { t.enabled = state.camOn; });
    }
    $('mic').textContent = state.micOn ? '🎙️ Mic on' : '🔇 Mic off';
    $('cam').textContent = state.camOn ? '📷 Video on' : '🚫 Video off';
    $('mic').classList.toggle('danger', !state.micOn);
    $('cam').classList.toggle('danger', !state.camOn);
  }

  // Cap the per-viewer video bitrate so one broadcast does not eat the whole upload link.
  function applyBitrate(pc) {
    var q = QUALITY[$('quality').value] || QUALITY['720'];
    pc.getSenders().forEach(function (sender) {
      if (!sender.track || sender.track.kind !== 'video') return;
      var params = sender.getParameters();
      if (!params.encodings || !params.encodings.length) params.encodings = [{}];
      params.encodings[0].maxBitrate = q.bitrate;
      sender.setParameters(params).catch(function () { /* unsupported in this browser */ });
    });
  }

  function watchBitrate(call) {
    var pc = call.peerConnection;
    if (!pc) return;
    pc.addEventListener('connectionstatechange', function () {
      if (pc.connectionState === 'connected') applyBitrate(pc);
    });
  }

  /* ---------- broadcasting ---------- */

  async function goLive() {
    try {
      if (!state.stream) await startSource($('source').value);
    } catch (err) { showError(err); return; }

    $('go-live').disabled = true;
    var id = 'v' + crypto.randomUUID().replace(/-/g, '');
    var peer = V.makePeer(id, state.site);
    state.peer = peer;
    state.peerId = id;

    peer.on('open', async function () {
      try {
        var res = await V.api.post('/api/live', { action: 'start', peerId: id, title: titleValue() }, state.token);
        state.live = true;
        state.startedAt = res.state.startedAt;
        state.seenTips.clear();
        state.tipTotal = 0;
        $('tip-feed').innerHTML = '';
        setLiveUI(true);
        updateStats();
        state.timers.heartbeat = setInterval(heartbeat, 25000);
        state.timers.tips = setInterval(pollTips, 8000);
        pollTips();
        V.addLine(chatLog, { kind: 'system', text: 'You are live. Share your channel link!' });
      } catch (err) {
        showError(err);
        endLive();
      }
    });
    peer.on('connection', onViewer);
    peer.on('error', function (err) {
      console.warn('peer error', err);
      if (err.type === 'unavailable-id') { showError('Could not claim a broadcast id, please try again.'); endLive(); }
      else if (['network', 'server-error', 'socket-error', 'socket-closed'].indexOf(err.type) !== -1) V.toast('Signaling connection lost, reconnecting…', true);
      else if (err.type !== 'peer-unavailable') V.toast('Peer error: ' + err.type, true);
    });
    peer.on('disconnected', function () {
      if (state.peer === peer && !peer.destroyed) peer.reconnect();
    });
  }

  function onViewer(conn) {
    conn.on('open', function () {
      if (!state.live || !state.stream) { conn.close(); return; }
      state.conns.set(conn.peer, conn);
      conn.send({ type: 'hello', title: titleValue(), viewers: state.conns.size });
      var call = state.peer.call(conn.peer, state.stream);
      if (call) {
        state.calls.set(conn.peer, call);
        watchBitrate(call);
        call.on('close', function () { dropViewer(conn.peer); });
      }
      broadcast({ type: 'viewers', count: state.conns.size });
      updateStats();
    });
    conn.on('data', function (msg) { onViewerMessage(conn, msg); });
    conn.on('close', function () { dropViewer(conn.peer); });
    conn.on('error', function () { dropViewer(conn.peer); });
  }

  function dropViewer(id) {
    if (!state.conns.has(id) && !state.calls.has(id)) return;
    var conn = state.conns.get(id);
    var call = state.calls.get(id);
    state.conns.delete(id);
    state.calls.delete(id);
    state.names.delete(id);
    if (conn) { try { conn.close(); } catch (e) { /* ignore */ } }
    if (call) { try { call.close(); } catch (e) { /* ignore */ } }
    broadcast({ type: 'viewers', count: state.conns.size });
    updateStats();
  }

  async function onViewerMessage(conn, msg) {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'join') {
      if (!msg.token) return;
      try {
        // Verify the viewer's login with the server so chat names cannot be faked.
        var who = await V.api.post('/api/whois', { token: msg.token }, state.token);
        if (who.ok) {
          state.names.set(conn.peer, who.name);
          V.addLine(chatLog, { kind: 'system', text: who.name + ' joined' });
        }
      } catch (e) { console.warn('whois failed', e); }
      return;
    }

    if (msg.type === 'chat') {
      var name = state.names.get(conn.peer);
      if (!name) { conn.send({ type: 'system', text: 'Log in to chat.' }); return; }
      var text = V.clampText(msg.text, 280);
      if (!text) return;
      V.addLine(chatLog, { name: name, text: text });
      broadcast({ type: 'chat', name: name, text: text });
    }
  }

  function broadcast(msg) {
    state.conns.forEach(function (conn) {
      if (conn.open) { try { conn.send(msg); } catch (e) { /* ignore */ } }
    });
  }

  async function heartbeat() {
    try {
      await V.api.post('/api/live', { action: 'heartbeat', peerId: state.peerId, viewers: state.conns.size, title: titleValue() }, state.token);
    } catch (err) {
      if (err.status === 409) { V.toast('Another studio session took over this channel.', true); endLive(false); }
    }
  }

  async function pollTips() {
    if (!state.live) return;
    try {
      var since = Math.floor(state.startedAt / 1000) - 120;
      var result = await V.api.get('/api/tips?since=' + since, state.token);
      result.tips.forEach(function (tip) {
        if (state.seenTips.has(tip.id)) return;
        state.seenTips.add(tip.id);
        state.tipTotal += tip.amount;
        renderTip(tip);
        broadcast({ type: 'tip', name: tip.name, amount: tip.amount, currency: tip.currency, message: tip.message, item: tip.item });
      });
      updateStats();
    } catch (err) {
      console.warn('tips', err.message);
    }
  }

  function renderTip(tip) {
    var el = document.createElement('div');
    el.className = 'line tip';
    el.innerHTML = '<span class="name">' + V.esc(tip.name) + '</span> ' + V.esc(V.money(tip.amount, tip.currency)) +
      (tip.item ? ' · ' + V.esc(tip.item) : '') +
      (tip.message ? '<br><span class="muted">' + V.esc(tip.message) + '</span>' : '');
    var feed = $('tip-feed');
    var empty = $('tip-feed-empty');
    if (empty) empty.remove();
    feed.insertBefore(el, feed.firstChild);
    V.addLine(chatLog, { kind: 'tip', name: tip.name, text: 'tipped ' + V.money(tip.amount, tip.currency) + (tip.message ? ' — ' + tip.message : '') });
  }

  async function endLive(notifyServer) {
    if (notifyServer === undefined) notifyServer = true;
    var wasLive = state.live;
    state.live = false;
    clearInterval(state.timers.heartbeat);
    clearInterval(state.timers.tips);
    broadcast({ type: 'ended' });
    Array.from(state.conns.keys()).forEach(dropViewer);
    if (state.peer) {
      var p = state.peer;
      state.peer = null;
      setTimeout(function () { try { p.destroy(); } catch (e) { /* ignore */ } }, 300);
    }
    if (notifyServer && wasLive) {
      try { await V.api.post('/api/live', { action: 'stop', peerId: state.peerId }, state.token); } catch (e) { /* ignore */ }
    }
    setLiveUI(false);
    updateStats();
    $('go-live').disabled = !state.stream;
    if (wasLive) V.addLine(chatLog, { kind: 'system', text: 'Stream ended.' });
  }

  function setLiveUI(isLive) {
    $('go-live').classList.toggle('hidden', isLive);
    $('end-live').classList.toggle('hidden', !isLive);
    var pill = $('live-pill');
    pill.textContent = isLive ? 'LIVE' : 'Offline';
    pill.className = 'pill' + (isLive ? ' live' : '');
  }

  function updateStats() {
    $('stat-viewers').textContent = state.conns.size;
    $('stat-tips').textContent = V.money(state.tipTotal, state.site.currency);
    $('stat-count').textContent = state.seenTips.size;
  }

  function titleValue() { return V.clampText($('title').value, 80); }

  /* ---------- settings: title, tip menu, links ---------- */

  function menuRow(item) {
    var row = document.createElement('div');
    row.className = 'editor-row';
    row.innerHTML =
      '<input class="m-label" maxlength="40" placeholder="☕ Coffee" value="' + V.esc(item ? item.label : '') + '">' +
      '<input class="m-amount" type="number" min="1" max="500" step="0.01" inputmode="decimal" placeholder="3.00" value="' + (item ? (item.amount / 100) : '') + '">' +
      '<button class="btn ghost small" type="button" title="Remove">✕</button>';
    row.querySelector('button').addEventListener('click', function () { row.remove(); });
    return row;
  }

  function linkRow(link) {
    var row = document.createElement('div');
    row.className = 'editor-row link';
    row.innerHTML =
      '<input class="l-label" maxlength="30" placeholder="Venmo" value="' + V.esc(link ? link.label : '') + '">' +
      '<input class="l-url" type="url" placeholder="https://venmo.com/u/you" value="' + V.esc(link ? link.url : '') + '">' +
      '<button class="btn ghost small" type="button" title="Remove">✕</button>';
    row.querySelector('button').addEventListener('click', function () { row.remove(); });
    return row;
  }

  function renderMenuEditor() {
    var menu = $('menu-editor');
    menu.innerHTML = '';
    state.channel.tipMenu.forEach(function (item) { menu.appendChild(menuRow(item)); });
    $('allow-custom').checked = Boolean(state.channel.allowCustom);
    var links = $('links-editor');
    links.innerHTML = '';
    state.channel.links.forEach(function (l) { links.appendChild(linkRow(l)); });
    $('currency-label').textContent = state.site.currency.toUpperCase();
  }

  function collectSettings() {
    var tipMenu = Array.from($('menu-editor').querySelectorAll('.editor-row')).map(function (row) {
      return { label: row.querySelector('.m-label').value, amount: Math.round(Number(row.querySelector('.m-amount').value) * 100) };
    }).filter(function (i) { return i.label.trim() && i.amount > 0; });
    var links = Array.from($('links-editor').querySelectorAll('.editor-row')).map(function (row) {
      return { label: row.querySelector('.l-label').value, url: row.querySelector('.l-url').value };
    }).filter(function (l) { return l.label.trim() && l.url.trim(); });
    return { title: titleValue(), tipMenu: tipMenu, allowCustom: $('allow-custom').checked, links: links };
  }

  async function saveSettings(statusEl) {
    statusEl.textContent = 'Saving…';
    try {
      var result = await V.api.post('/api/channel', collectSettings(), state.token);
      state.channel = result.channel;
      renderMenuEditor();
      statusEl.textContent = 'Saved ✓';
      setTimeout(function () { statusEl.textContent = ''; }, 2500);
    } catch (err) {
      statusEl.textContent = '';
      showError(err);
    }
  }

  function showError(err) {
    console.error(err);
    var msg = err && err.message ? err.message : String(err);
    if (err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) msg = 'Camera/microphone permission was denied.';
    if (err && err.name === 'NotFoundError') msg = 'No camera or microphone was found.';
    V.toast(msg, true);
  }

  /* ---------- wire up ---------- */

  $('start-preview').addEventListener('click', function () { startSource($('source').value).catch(showError); });
  $('source').addEventListener('change', function () { if (state.stream) startSource($('source').value).catch(showError); });
  $('quality').addEventListener('change', function () {
    if (state.stream && state.source === 'camera') startSource('camera').catch(showError);
    state.calls.forEach(function (call) { if (call.peerConnection) applyBitrate(call.peerConnection); });
  });
  $('mic').addEventListener('click', function () { state.micOn = !state.micOn; applyToggles(); });
  $('cam').addEventListener('click', function () { state.camOn = !state.camOn; applyToggles(); });
  $('go-live').addEventListener('click', goLive);
  $('end-live').addEventListener('click', function () { endLive(); });
  $('save-title').addEventListener('click', function () { saveSettings($('title-status')); });
  $('menu-add').addEventListener('click', function () { $('menu-editor').appendChild(menuRow()); });
  $('links-add').addEventListener('click', function () { $('links-editor').appendChild(linkRow()); });
  $('menu-save').addEventListener('click', function () { saveSettings($('menu-status')); });
  $('copy-url').addEventListener('click', async function () {
    try { await navigator.clipboard.writeText($('channel-url').href); V.toast('Channel link copied'); }
    catch (e) { V.toast('Could not copy, select the link instead.', true); }
  });
  $('host-chat').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = $('host-text');
    var text = V.clampText(input.value, 280);
    if (!text) return;
    if (!state.live) { V.toast('Go live to chat with viewers.', true); return; }
    broadcast({ type: 'chat', name: state.me.displayName, text: text, host: true });
    V.addLine(chatLog, { name: state.me.displayName, text: text, kind: 'host' });
    input.value = '';
  });
  window.addEventListener('beforeunload', function () {
    if (state.live) navigator.sendBeacon('/api/live', JSON.stringify({ action: 'stop', peerId: state.peerId, token: state.token }));
  });

  init();
})();
