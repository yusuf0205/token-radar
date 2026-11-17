// Token radar dashboard: reads window.RADAR (written by main.ts), no fetch, no network.
(function () {
  'use strict';
  var R = window.RADAR;
  var rows = R.rows;
  var live = R.live;

  function $(id) { return document.getElementById(id); }

  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'bn';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'm';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return '$' + Math.round(n);
  }

  function moneyFull(n) {
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function pct(n) {
    if (n === null || n === undefined) return 'n/a';
    var s = (n > 0 ? '+' : '') + n.toFixed(2) + '%';
    return s;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function ageText(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days < 30) return days + 'd';
    if (days < 365) return Math.round(days / 30) + 'mo';
    return (days / 365).toFixed(1) + 'y';
  }

  // ---- header stats
  $('asof').textContent = R.as_of;
  $('stat-rows').textContent = R.board_size;
  $('stat-watch').textContent = R.watchlist_size + ' / ' + R.watchlist_size;
  var total = rows.reduce(function (a, r) { return a + r.implied_value_usd; }, 0);
  $('stat-total').textContent = money(total);
  var sorted = rows.map(function (r) { return r.implied_value_usd; }).sort(function (a, b) { return a - b; });
  $('stat-median').textContent = money(sorted[Math.floor(sorted.length / 2)]);
  $('model-global').textContent = R.global_ratio.toFixed(3);
  $('model-momentum').textContent = (R.global_momentum_pct > 0 ? '+' : '') + R.global_momentum_pct.toFixed(2) + '%';
  $('source').textContent = R.source;

  // ---- filter dropdowns
  var chains = {};
  var cats = {};
  rows.forEach(function (r) {
    r.chains.forEach(function (c) { chains[c] = true; });
    if (r.category) cats[r.category] = true;
  });
  Object.keys(chains).sort().forEach(function (c) {
    var o = document.createElement('option');
    o.value = c; o.textContent = c; $('chain').appendChild(o);
  });
  Object.keys(cats).sort().forEach(function (c) {
    var o = document.createElement('option');
    o.value = c; o.textContent = c; $('category').appendChild(o);
  });

  // ---- board rendering
  var selectedSlug = null;

  function filtered() {
    var q = $('q').value.trim().toLowerCase();
    var chain = $('chain').value;
    var cat = $('category').value;
    var minTvl = Number($('min-tvl').value);
    var minVal = Number($('min-value').value);
    var watchOnly = $('watchlist-only').checked;
    var out = rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1) return false;
      if (chain && r.chains.indexOf(chain) === -1) return false;
      if (cat && r.category !== cat) return false;
      if (r.tvl_usd < minTvl) return false;
      if (r.implied_value_usd < minVal) return false;
      if (watchOnly && !r.on_watchlist) return false;
      return true;
    });
    var sort = $('sort').value;
    var by = {
      rank: function (a, b) { return a.rank - b.rank; },
      value: function (a, b) { return b.implied_value_usd - a.implied_value_usd; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      change: function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); },
      age: function (a, b) { return (b.age_days || 0) - (a.age_days || 0); },
    };
    out.sort(by[sort] || by.rank);
    return out;
  }

  function changeCell(n) {
    if (n === null || n === undefined) return '<td class="num">n/a</td>';
    var cls = n >= 0 ? 'up' : 'down';
    return '<td class="num ' + cls + '">' + esc(pct(n)) + '</td>';
  }

  function render() {
    var list = filtered();
    $('count').textContent = list.length + ' of ' + rows.length + ' protocols shown.';
    var top = rows.length > 0 ? rows[0].implied_value_usd : 1;
    var html = list.map(function (r) {
      var tags = r.chains.map(function (c) { return '<span class="tag">' + esc(c) + '</span>'; }).join('');
      var badge = r.on_watchlist ? ' <span class="watch" title="On the snapshot watchlist">watchlist</span>' : '';
      var bar = Math.max(2, Math.round(100 * r.implied_value_usd / top));
      return '<tr data-slug="' + esc(r.slug) + '"' + (r.slug === selectedSlug ? ' class="selected"' : '') + '>' +
        '<td>' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span>' + badge + '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || 'n/a') + '</td>' +
        '<td>' + tags + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        changeCell(r.change_7d) +
        '<td class="num value">' + money(r.implied_value_usd) +
        '<span class="bar"><span style="width:' + bar + '%"></span></span></td></tr>';
    }).join('');
    $('rows').innerHTML = html || '<tr><td colspan="7">No protocols match these filters.</td></tr>';
  }

  function showDetail(slug) {
    var r = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].slug === slug) { r = rows[i]; break; }
    var box = $('detail');
    if (!r) { box.hidden = true; return; }
    selectedSlug = slug;
    var base = Math.round(r.tvl_usd * r.category_ratio);
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    box.innerHTML =
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="meta">Rank #' + r.rank + ' &middot; ' + esc(r.category || 'uncategorised') +
      ' &middot; ' + r.chains.map(esc).join(', ') +
      ' &middot; TVL ' + moneyFull(r.tvl_usd) +
      ' &middot; 7-day change ' + pct(r.change_7d) +
      ' &middot; listed ' + (r.listed_at || 'unknown') + ' (' + ageText(r.age_days) + ')' +
      (r.on_watchlist ? ' &middot; on the snapshot watchlist' : '') + '</p>' +
      '<h3>Implied value: ' + moneyFull(r.implied_value_usd) + '</h3>' +
      '<p class="formula-line">' + moneyFull(base) + ' base &times; ' + r.growth_factor.toFixed(4) +
      ' growth &times; ' + r.tenure_factor.toFixed(4) + ' tenure &times; ' + r.breadth_factor.toFixed(4) +
      ' breadth &times; ' + r.leadership_factor.toFixed(4) + ' leadership &times; ' +
      r.momentum_factor.toFixed(4) + ' momentum = ' + moneyFull(r.implied_value_usd) + '</p>' +
      '<dl class="breakdown">' +
      '<div><dt>Base (TVL &times; ratio)</dt><dd>' + moneyFull(base) + '</dd></div>' +
      '<div><dt>Category ratio (' + r.ratio_source + ')</dt><dd>' + r.category_ratio.toFixed(3) + '</dd></div>' +
      '<div><dt>Growth factor</dt><dd>' + r.growth_factor.toFixed(3) + '</dd></div>' +
      '<div><dt>Tenure factor</dt><dd>' + r.tenure_factor.toFixed(3) + '</dd></div>' +
      '<div><dt>Breadth factor (' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ')</dt><dd>' + r.breadth_factor.toFixed(3) + '</dd></div>' +
      '<div><dt>Leadership factor (' + (r.category_share * 100).toFixed(1) + '% of category TVL)</dt><dd>' + r.leadership_factor.toFixed(3) + '</dd></div>' +
      '<div><dt>Momentum factor (' + r.momentum_source + ' ' + pct(r.category_momentum_pct) + ')</dt><dd>' + r.momentum_factor.toFixed(3) + '</dd></div>' +
      '<div><dt>Farm plan</dt><dd>' + r.farm_steps.length + ' steps</dd></div>' +
      '</dl>' +
      '<p class="fine">The ratio comes from the median market-cap-to-TVL of live-token protocols in the ' +
      esc(r.category || 'same') + ' category' +
      (r.ratio_source === 'global' ? ' (too few live-token protocols in this category, so the global median is used)' : '') +
      '. The momentum figure is the median 7-day change of live-token protocols in that category' +
      (r.momentum_source === 'global' ? ' (too few to measure, so the global median is used)' : '') +
      '. This protocol records no token in the snapshot.</p>' +
      '<h3>Farm plan</h3>' +
      '<ol class="steps">' + steps + '</ol>' +
      '<p class="fine">This plan promises no token and no airdrop. It is what to do in the app, what it ' +
      'costs, and how long it takes.</p>';
    box.hidden = false;
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    render();
  }

  $('rows').addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr[data-slug]');
    if (tr) showDetail(tr.getAttribute('data-slug'));
  });

  ['q', 'chain', 'category', 'min-tvl', 'min-value', 'sort', 'watchlist-only'].forEach(function (id) {
    $(id).addEventListener('input', render);
    $(id).addEventListener('change', render);
  });
  $('clear').addEventListener('click', function () {
    $('q').value = '';
    $('chain').value = '';
    $('category').value = '';
    $('min-tvl').value = '0';
    $('min-value').value = '0';
    $('sort').value = 'rank';
    $('watchlist-only').checked = false;
    render();
  });

  // ---- tabs
  function setTab(which) {
    var board = which === 'board';
    $('tab-board').classList.toggle('active', board);
    $('tab-live').classList.toggle('active', !board);
    $('tab-board').setAttribute('aria-pressed', String(board));
    $('tab-live').setAttribute('aria-pressed', String(!board));
    $('board-view').hidden = !board;
    $('live-view').hidden = board;
  }
  $('tab-board').addEventListener('click', function () { setTab('board'); });
  $('tab-live').addEventListener('click', function () { setTab('live'); });

  // ---- live view
  $('live-rows').innerHTML = live.map(function (r) {
    var tags = r.chains.map(function (c) { return '<span class="tag">' + esc(c) + '</span>'; }).join('');
    return '<tr><td><span class="name">' + esc(r.name) + '</span><span class="slug">' + esc(r.slug) + '</span></td>' +
      '<td>' + esc(r.category || 'n/a') + '</td><td>' + tags + '</td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' +
      '<td class="num value">' + (r.mcap_usd ? money(r.mcap_usd) : 'n/a') + '</td>' +
      changeCell(r.change_7d) + '</tr>';
  }).join('');

  render();
})();
