// KizamuBeam website – progressive enhancement only. The page works without it.
(function () {
  'use strict';

  // 1. Remember an explicit language choice (the German root page only
  //    auto-redirects visitors who have never made one).
  document.querySelectorAll('[data-set-lang]').forEach(function (a) {
    a.addEventListener('click', function () {
      try { localStorage.setItem('kb-lang', a.getAttribute('data-set-lang')); } catch (e) { /* storage blocked */ }
    });
  });

  // 2. Highlight the download card for the visitor's OS.
  var ua = navigator.userAgent || '';
  var platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
  var os = null;
  if (/iPhone|iPad|iPod|Android/i.test(ua)) os = null;
  else if (/Mac/i.test(platform) || /Mac OS X/i.test(ua)) os = 'mac';
  else if (/Win/i.test(platform) || /Windows/i.test(ua)) os = 'win';
  else if (/Linux|X11|CrOS/i.test(platform + ' ' + ua)) os = 'linux';
  if (os) {
    var card = document.querySelector('.dl-card[data-os="' + os + '"]');
    if (card) {
      card.classList.add('is-recommended');
      var btn = card.querySelector('.dl-btn');
      if (btn) { btn.classList.remove('btn-secondary'); btn.classList.add('btn-primary'); }
    }
  }

  // 3. Point the buttons straight at the installer files of the newest
  //    published release (prereleases included; /releases/latest would skip
  //    them). On any failure the generic Releases links stay in place.
  if (!window.fetch || !document.querySelector('[data-dl]')) return;
  var API = 'https://api.github.com/repos/negurvulkan/kizamubeam/releases?per_page=5';
  var ctrl = window.AbortController ? new AbortController() : null;
  var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 6000);

  fetch(API, { headers: { Accept: 'application/vnd.github+json' }, signal: ctrl ? ctrl.signal : undefined })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (list) {
      clearTimeout(timer);
      if (!Array.isArray(list)) return;
      var rel = list.find(function (x) { return x && !x.draft && Array.isArray(x.assets) && x.assets.length; });
      if (!rel) return;
      var assets = rel.assets;
      var pick = function (re, not) {
        return assets.find(function (a) { return re.test(a.name) && !(not && not.test(a.name)); });
      };
      var found = {
        mac: pick(/\.dmg$/i),
        win: pick(/-setup\.exe$/i) || pick(/\.exe$/i) || pick(/\.msi$/i),
        linux: pick(/\.AppImage$/i, /\.(sig|zsync)$/i),
      };
      var extra = [pick(/\.deb$/i), pick(/\.rpm$/i)].filter(Boolean);

      Object.keys(found).forEach(function (k) {
        var a = found[k];
        var link = document.querySelector('[data-dl="' + k + '"]');
        if (a && link && /^https:\/\/github\.com\//.test(a.browser_download_url)) {
          link.href = a.browser_download_url;
          link.setAttribute('title', a.name);
        }
      });

      var more = document.querySelector('[data-dl-more]');
      if (more && extra.length) {
        extra.forEach(function (a) {
          if (!/^https:\/\/github\.com\//.test(a.browser_download_url)) return;
          var el = document.createElement('a');
          el.href = a.browser_download_url;
          el.textContent = a.name.replace(/^.*(\.[a-z]+)$/i, '$1');
          el.setAttribute('title', a.name);
          more.appendChild(el);
        });
        more.hidden = false;
      }

      var version = String(rel.tag_name || rel.name || '').replace(/^v/i, '');
      var lead = document.querySelector('[data-dl-lead]');
      if (lead && version && /^[\w.\-+]{1,40}$/.test(version)) {
        lead.textContent = lead.getAttribute('data-template').replace('{version}', version);
      }
    })
    .catch(function () { clearTimeout(timer); });
})();
