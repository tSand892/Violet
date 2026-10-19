/* Home page: lists channels, live ones first. */
(function () {
  'use strict';
  var V = window.Violet;

  function card(c) {
    var initial = (c.displayName || c.username || '?').trim().charAt(0).toUpperCase();
    var sub = c.live
      ? V.esc(c.title || 'Live now') + ' · ' + c.viewers + ' watching'
      : 'Offline';
    return '<a class="card channel-card" href="/c/' + V.esc(c.username) + '">' +
      '<span class="avatar">' + V.esc(initial) + '</span>' +
      '<span class="info"><b>' + V.esc(c.displayName) + '</b><span>' + sub + '</span></span>' +
      (c.live ? '<span class="pill live">LIVE</span>' : '') +
      '</a>';
  }

  async function load() {
    try {
      var data = await V.api.get('/api/channels');
      V.renderNav(data.site);
      var live = data.channels.filter(function (c) { return c.live; });
      V.$('live-grid').innerHTML = live.map(card).join('');
      V.$('live-empty').classList.toggle('hidden', live.length > 0);
      V.$('all-grid').innerHTML = data.channels.map(card).join('');
      V.$('all-empty').classList.toggle('hidden', data.channels.length > 0);
    } catch (err) {
      V.renderNav(null);
      V.toast(err.message, true);
    }
  }

  load();
  setInterval(load, 15000);
})();
