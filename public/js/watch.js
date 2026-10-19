/* Viewer page: watch a channel, chat, and tip. */
(function () {
  'use strict';
  var V = window.Violet;
  var $ = V.$;

  var channelName = V.channelFromUrl();
  if (!channelName) { location.replace('/'); return; }

  var video = $('video');
  var overlay = $('overlay');
  var chatLog = $('chat-log');

  var state = {
    site: null, channel: null,
    peer: null, conn: null, connected: false, pollTimer: null,
    selected: 0, custom: false, tipsReady: false,
  };

  /* ---------- status + joining ---------- */

  async function refresh() {
    clearTimeout(state.pollTimer);
    try {
      var data = await V.api.get('/api/channel?c=' + encodeURIComponent(channelName));
      var first = !state.site;
      state.site = data.site;
      state.channel = data.channel;
      if (first) firstRender(data);
      if (!state.connected) {
        setLive(data.live.live, data.live.viewers);
        $('stream-title').textContent = data.live.live
          ? (data.live.title || 'Live now')
          : (data.channel.title || data.channel.displayName + "'s channel");
        if (data.live.live) join(data.live.peerId);
        else schedulePoll(8000);
      }
    } catch (err) {
      if (err.status === 404) {
        V.renderNav(null);
        $('stream-title').textContent = 'Channel not found';
        setOverlay('Channel not found', 'Check the link and try again.');
        return;
      }
      schedulePoll(10000);
    }
  }

  function schedulePoll(ms) {
    clearTimeout(state.pollTimer);
    state.pollTimer = setTimeout(refresh, ms);
  }

  function firstRender(data) {
    V.renderNav(data.site);
    document.title = data.channel.displayName + ' · ' + data.site.name;
    $('streamer-name').textContent = data.channel.displayName;
    renderTipCard(data);
    setupChat();
  }

  function setLive(isLive, viewers) {
    var pill = $('status-pill');
    pill.textContent = isLive ? 'LIVE' : 'Offline';
    pill.className = 'pill' + (isLive ? ' live' : '');
    setViewers(viewers || 0);
    if (!isLive) {
      video.srcObject = null;
      var who = state.channel ? state.channel.displayName : 'the streamer';
      setOverlay('Stream is offline', 'This page updates on its own when ' + who + ' goes live.');
    }
  }

  function setViewers(n) { $('viewer-count').textContent = n + ' watching'; }

  function setOverlay(title, text, button) {
    overlay.classList.remove('hidden', 'soft');
    $('overlay-title').textContent = title || '';
    $('overlay-title').classList.toggle('hidden', !title);
    $('overlay-text').textContent = text || '';
    $('overlay-text').classList.toggle('hidden', !text);
    $('overlay-btn').classList.toggle('hidden', !button);
    if (button) $('overlay-btn').textContent = button;
  }

  function join(peerId) {
    teardown();
    setOverlay('Connecting…', 'Joining the stream.');
    var peer = V.makePeer(null, state.site);
    state.peer = peer;

    peer.on('open', function () {
      var conn = peer.connect(peerId, { reliable: true, serialization: 'json' });
      state.conn = conn;
      conn.on('open', function () {
        state.connected = true;
        conn.send({ type: 'join', token: V.auth.token() || null });
      });
      conn.on('data', onMessage);
      conn.on('close', function () { left('The stream ended.'); });
      conn.on('error', function (err) { console.warn('data channel error', err); });
    });

    // The host calls us with their media; viewers send nothing back.
    peer.on('call', function (call) {
      call.answer();
      call.on('stream', attach);
    });

    peer.on('error', function (err) {
      console.warn('peer error', err.type, err.message);
      if (err.type === 'peer-unavailable') left('The host is not connected right now.');
      else if (['network', 'server-error', 'socket-error', 'socket-closed', 'webrtc'].indexOf(err.type) !== -1) left('Connection problem.');
    });

    peer.on('disconnected', function () {
      if (state.peer === peer && !peer.destroyed) peer.reconnect();
    });
  }

  function attach(stream) {
    video.srcObject = stream;
    video.muted = false;
    video.play().then(function () {
      overlay.classList.add('hidden');
    }).catch(function () {
      // Browser blocked autoplay with sound: play muted and offer an unmute button.
      video.muted = true;
      video.play().then(function () {
        setOverlay('', '', '🔇 Tap to unmute');
        overlay.classList.add('soft');
      }).catch(function () {
        setOverlay('Ready to watch', '', '▶ Tap to watch');
      });
    });
  }

  $('overlay-btn').addEventListener('click', function () {
    video.muted = false;
    video.play().then(function () { overlay.classList.add('hidden'); }).catch(function (err) { console.warn(err); });
  });

  function left(reason) {
    var wasJoined = Boolean(state.peer);
    teardown();
    setLive(false, 0);
    if (wasJoined) setOverlay('Stream ended', reason + ' Waiting for it to come back…');
    schedulePoll(5000);
  }

  function teardown() {
    clearTimeout(state.pollTimer);
    state.connected = false;
    if (state.conn) { try { state.conn.close(); } catch (e) { /* ignore */ } state.conn = null; }
    if (state.peer) { var p = state.peer; state.peer = null; try { p.destroy(); } catch (e) { /* ignore */ } }
  }

  function onMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'hello':
        setLive(true, msg.viewers);
        if (msg.title) $('stream-title').textContent = msg.title;
        V.addLine(chatLog, { kind: 'system', text: 'Connected to the stream.' });
        break;
      case 'viewers':
        setViewers(msg.count);
        break;
      case 'chat':
        V.addLine(chatLog, { name: msg.name, text: msg.text, kind: msg.host ? 'host' : '' });
        break;
      case 'system':
        V.addLine(chatLog, { kind: 'system', text: msg.text });
        break;
      case 'tip':
        V.addLine(chatLog, {
          kind: 'tip', name: msg.name,
          text: 'tipped ' + V.money(msg.amount, msg.currency) + (msg.item ? ' · ' + msg.item : '') + (msg.message ? ' — ' + msg.message : ''),
        });
        showAlert(msg);
        break;
      case 'ended':
        left('The host ended the stream.');
        break;
    }
  }

  function showAlert(tip) {
    var el = document.createElement('div');
    el.className = 'alert';
    el.innerHTML = '💜 ' + V.esc(tip.name) + ' tipped ' + V.esc(V.money(tip.amount, tip.currency)) +
      (tip.item ? ' · ' + V.esc(tip.item) : '') +
      (tip.message ? '<small>' + V.esc(tip.message) + '</small>' : '');
    $('alerts').appendChild(el);
    setTimeout(function () { el.remove(); }, 8000);
  }

  /* ---------- chat ---------- */

  function setupChat() {
    var form = $('chat-form');
    if (!V.auth.user()) {
      form.classList.add('hidden');
      $('chat-login').classList.remove('hidden');
      $('chat-login-link').href = '/account?next=' + encodeURIComponent(location.pathname);
      return;
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = $('chat-text');
      var text = V.clampText(input.value, 280);
      if (!text) return;
      if (!state.conn || !state.conn.open) { V.toast('Chat opens when the stream is live.', true); return; }
      state.conn.send({ type: 'chat', text: text });
      input.value = '';
    });
  }

  /* ---------- tips ---------- */

  function renderTipCard(data) {
    var site = data.site;
    var channel = data.channel;
    var menu = $('tip-menu');
    var form = $('tip-form');
    var canPay = site.stripeEnabled && (channel.tipMenu.length > 0 || channel.allowCustom);

    form.classList.toggle('hidden', !canPay);
    $('tip-disabled').classList.toggle('hidden', canPay || channel.links.length > 0);

    menu.innerHTML = channel.tipMenu.map(function (item, i) {
      return '<button type="button" class="menu-item" data-index="' + i + '">' +
        '<span class="label">' + V.esc(item.label) + '</span>' +
        '<span class="price">' + V.esc(V.money(item.amount, site.currency)) + '</span></button>';
    }).join('');
    $('custom-row').classList.toggle('hidden', !channel.allowCustom);
    if (!channel.tipMenu.length) state.custom = true;

    var user = V.auth.user();
    if (user) $('tip-name').value = user.name;

    menu.addEventListener('click', function (e) {
      var btn = e.target.closest('.menu-item');
      if (!btn) return;
      state.selected = Number(btn.getAttribute('data-index'));
      state.custom = false;
      $('tip-custom').value = '';
      updateSelection();
    });
    $('tip-custom').addEventListener('input', function () {
      state.custom = $('tip-custom').value !== '' || !channel.tipMenu.length;
      updateSelection();
    });
    form.addEventListener('submit', onTip);

    if (channel.links.length) {
      var links = $('tip-links');
      links.classList.remove('hidden');
      links.innerHTML = '<span class="muted small">Other ways to tip:</span>' + channel.links.map(function (l) {
        return '<a class="btn ghost small" target="_blank" rel="noopener" href="' + V.esc(l.url) + '">' + V.esc(l.label) + '</a>';
      }).join('');
    }

    state.tipsReady = true;
    updateSelection();
  }

  function currentAmount() {
    if (state.custom) {
      var v = Number($('tip-custom').value);
      return v > 0 ? Math.round(v * 100) : 0;
    }
    var item = state.channel.tipMenu[state.selected];
    return item ? item.amount : 0;
  }

  function updateSelection() {
    if (!state.tipsReady) return;
    $('tip-menu').querySelectorAll('.menu-item').forEach(function (b) {
      b.classList.toggle('selected', !state.custom && Number(b.getAttribute('data-index')) === state.selected);
    });
    var amount = currentAmount();
    $('tip-submit').textContent = amount ? 'Tip ' + V.money(amount, state.site.currency) : 'Tip';
    $('tip-submit').disabled = !amount;
  }

  async function onTip(e) {
    e.preventDefault();
    var amount = currentAmount();
    if (!amount) return;
    var btn = $('tip-submit');
    // Open the tab synchronously inside the click so popup blockers allow it; Stripe loads into it.
    var popup = window.open('', '_blank');
    try { if (popup) popup.document.write('<p style="font-family:sans-serif;padding:2rem">Opening secure checkout…</p>'); } catch (err) { /* ignore */ }
    btn.disabled = true;
    try {
      var body = { channel: channelName, name: V.clampText($('tip-name').value, 40), message: V.clampText($('tip-message').value, 140) };
      if (state.custom) body.amount = amount; else body.item = state.selected;
      var result = await V.api.post('/api/tip', body);
      if (popup) popup.location.href = result.url; else location.href = result.url;
      $('tip-message').value = '';
    } catch (err) {
      if (popup) popup.close();
      V.toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- boot ---------- */

  refresh();
  window.addEventListener('beforeunload', teardown);
})();
