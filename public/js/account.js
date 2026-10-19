/* Log in / sign up page. */
(function () {
  'use strict';
  var V = window.Violet;
  var $ = V.$;

  var params = new URLSearchParams(location.search);
  var rawNext = params.get('next') || '';
  var next = rawNext.indexOf('/') === 0 && rawNext.indexOf('//') !== 0 ? rawNext : null;
  var site = null;

  V.api.get('/api/channels').then(function (d) {
    site = d.site;
    V.renderNav(d.site);
    updateInvite();
  }).catch(function () { V.renderNav(null); });

  function updateInvite() {
    var show = $('streamer').checked && site && site.inviteRequired;
    $('invite-field').classList.toggle('hidden', !show);
    $('invite').required = Boolean(show);
  }

  function showTab(mode) {
    $('login-form').classList.toggle('hidden', mode !== 'login');
    $('signup-form').classList.toggle('hidden', mode !== 'signup');
    $('tab-login').className = 'btn ' + (mode === 'login' ? 'primary' : 'ghost');
    $('tab-signup').className = 'btn ' + (mode === 'signup' ? 'primary' : 'ghost');
    var q = '?mode=' + mode + (next ? '&next=' + encodeURIComponent(next) : '');
    history.replaceState(null, '', location.pathname + q);
  }

  function finish(data) {
    V.auth.save(data.token);
    location.href = next || (data.user.role === 'streamer' ? '/studio' : '/');
  }

  async function submit(form, build) {
    var btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      finish(await build());
    } catch (err) {
      V.toast(err.message, true);
      btn.disabled = false;
    }
  }

  $('tab-login').addEventListener('click', function () { showTab('login'); });
  $('tab-signup').addEventListener('click', function () { showTab('signup'); });
  $('streamer').addEventListener('change', updateInvite);

  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    submit(e.target, function () {
      return V.api.post('/api/login', { username: $('login-username').value, password: $('login-password').value });
    });
  });

  $('signup-form').addEventListener('submit', function (e) {
    e.preventDefault();
    submit(e.target, function () {
      return V.api.post('/api/signup', {
        username: $('su-username').value,
        displayName: $('su-display').value,
        password: $('su-password').value,
        streamer: $('streamer').checked,
        inviteCode: $('invite').value,
      });
    });
  });

  showTab(params.get('mode') === 'signup' ? 'signup' : 'login');
  if (params.get('streamer') === '1') { $('streamer').checked = true; updateInvite(); }
})();
