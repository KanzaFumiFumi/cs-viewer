(function () {
  'use strict';

  const NODES = ['A', 'B', 'C', 'D'];
  const LINKS = [];
  NODES.forEach(function (a, i) {
    NODES.forEach(function (b, j) {
      if (i !== j) {
        LINKS.push({ key: a + '->' + b, from: i, to: j });
      }
    });
  });
  const HEADER = ['time_s', 'gw'].concat(LINKS.map(function (l) { return l.key; }));

  const SERIES = ['#3987e5', '#d95926', '#199e70'];
  const HUE = {
    'A->B': 0, 'A->C': 1, 'A->D': 2,
    'B->A': 1, 'B->C': 0, 'B->D': 2,
    'C->A': 2, 'C->B': 1, 'C->D': 0,
    'D->A': 0, 'D->B': 1, 'D->C': 2
  };
  const DASH = ['solid', 'dot', 'dash', 'dashdot'];
  const DASH_LABEL = ['実線', '点線', '破線', '一点鎖線'];
  const GAP_S = 0.5;

  const THEME = {
    page: '#0d0d0d',
    surface: '#1a1a19',
    ink: '#ffffff',
    ink2: '#c3c2b7',
    muted: '#898781',
    grid: '#2c2c2a',
    axis: '#383835',
    border: 'rgba(255,255,255,0.10)',
    font: 'system-ui, -apple-system, "Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif'
  };

  const PLOT_CONFIG = {
    responsive: true,
    displaylogo: false,
    scrollZoom: false,
    modeBarButtonsToRemove: ['toImage', 'select2d', 'lasso2d', 'autoScale2d']
  };

  const els = {
    drop: document.getElementById('drop'),
    input: document.getElementById('file'),
    error: document.getElementById('error'),
    viewer: document.getElementById('viewer'),
    files: document.getElementById('files'),
    info: document.getElementById('info'),
    charts: document.getElementById('charts'),
    stats: document.getElementById('stats'),
    viewButtons: Array.prototype.slice.call(document.querySelectorAll('[data-view]'))
  };

  const state = {
    files: [],
    current: -1,
    view: 'pair',
    plots: [],
    syncing: false
  };

  function showMessage(text) {
    els.error.textContent = text;
    els.error.hidden = !text;
  }

  function parseCsv(text) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/);
    const head = (lines[0] || '').split(',').map(function (s) { return s.trim(); });
    const headerOk = head.length === HEADER.length && head.every(function (h, i) { return h === HEADER[i]; });
    if (!headerOk) {
      throw new Error('1行目の列名が地上局のCSV（time_s,gw,A->B,…,D->C）と一致しません。');
    }
    const t = [];
    const gw = [];
    const cols = LINKS.map(function () { return []; });
    let skipped = 0;
    for (let n = 1; n < lines.length; n++) {
      const line = lines[n].trim();
      if (!line) {
        continue;
      }
      const f = line.split(',').map(function (s) { return s.trim(); });
      if (f.length !== HEADER.length || f.some(function (s) { return s === ''; })) {
        skipped++;
        continue;
      }
      const time = Number(f[0]);
      const vals = f.slice(2).map(Number);
      const valid = Number.isFinite(time) && NODES.indexOf(f[1]) >= 0 && vals.every(Number.isFinite);
      if (!valid) {
        skipped++;
        continue;
      }
      t.push(time);
      gw.push(f[1]);
      vals.forEach(function (v, k) { cols[k].push(v); });
    }
    if (t.length === 0) {
      throw new Error('データの行がありません。');
    }
    return { t: t, gw: gw, cols: cols, skipped: skipped };
  }

  function findSwitches(data) {
    const out = [];
    for (let i = 1; i < data.t.length; i++) {
      if (data.gw[i] !== data.gw[i - 1]) {
        out.push({ t: data.t[i], from: data.gw[i - 1], to: data.gw[i] });
      }
    }
    return out;
  }

  function withGaps(data) {
    const x = [];
    const cols = data.cols.map(function () { return []; });
    for (let i = 0; i < data.t.length; i++) {
      if (i > 0 && data.t[i] - data.t[i - 1] > GAP_S) {
        x.push((data.t[i] + data.t[i - 1]) / 2);
        cols.forEach(function (c) { c.push(null); });
      }
      x.push(data.t[i]);
      cols.forEach(function (c, k) { c.push(data.cols[k][i]); });
    }
    return { x: x, cols: cols };
  }

  function summarize(data) {
    let min = Infinity;
    let max = -Infinity;
    const links = data.cols.map(function (col) {
      let sum = 0;
      let count = 0;
      let lo = Infinity;
      let hi = -Infinity;
      let zeros = 0;
      for (let i = 0; i < col.length; i++) {
        const v = col[i];
        if (v < min) { min = v; }
        if (v > max) { max = v; }
        if (v === 0) {
          zeros++;
          continue;
        }
        sum += v;
        count++;
        if (v < lo) { lo = v; }
        if (v > hi) { hi = v; }
      }
      return {
        mean: count ? sum / count : null,
        min: count ? lo : null,
        max: count ? hi : null,
        zeros: zeros
      };
    });
    return { min: min, max: max, links: links };
  }

  function uniqueName(name) {
    const taken = state.files.map(function (f) { return f.name; });
    if (taken.indexOf(name) < 0) {
      return name;
    }
    let k = 2;
    while (taken.indexOf(name + ' (' + k + ')') >= 0) {
      k++;
    }
    return name + ' (' + k + ')';
  }

  async function addFiles(fileList) {
    const messages = [];
    const list = Array.prototype.slice.call(fileList || []);
    for (const file of list) {
      try {
        const text = await file.text();
        const data = parseCsv(text);
        state.files.push({
          name: uniqueName(file.name),
          data: data,
          plot: withGaps(data),
          switches: findSwitches(data),
          summary: summarize(data)
        });
        state.current = state.files.length - 1;
        if (data.skipped) {
          messages.push(file.name + '：形式が合わない行を ' + data.skipped + ' 行とばしました。');
        }
      } catch (err) {
        messages.push(file.name + '：読み込めませんでした。' + err.message);
      }
    }
    showMessage(messages.join('\n'));
    render();
  }

  function chartGroups() {
    const byKey = {};
    LINKS.forEach(function (l, k) { byKey[l.key] = k; });
    if (state.view === 'all') {
      return [{ title: '全12リンク', links: LINKS.map(function (l, k) { return k; }) }];
    }
    if (state.view === 'node') {
      return NODES.map(function (a, i) {
        return {
          title: a + ' が測定した値',
          links: NODES.filter(function (b, j) { return j !== i; }).map(function (b) { return byKey[a + '->' + b]; })
        };
      });
    }
    const groups = [];
    for (let i = 0; i < NODES.length; i++) {
      for (let j = i + 1; j < NODES.length; j++) {
        groups.push({
          title: NODES[i] + ' ↔ ' + NODES[j],
          links: [byKey[NODES[i] + '->' + NODES[j]], byKey[NODES[j] + '->' + NODES[i]]]
        });
      }
    }
    return groups;
  }

  function traceFor(file, k) {
    const link = LINKS[k];
    const all = state.view === 'all';
    return {
      type: 'scattergl',
      mode: 'lines',
      name: all ? link.key + '（' + DASH_LABEL[link.from] + '）' : link.key,
      x: file.plot.x,
      y: file.plot.cols[k],
      line: {
        color: SERIES[HUE[link.key]],
        width: 2,
        dash: all ? DASH[link.from] : 'solid'
      },
      hovertemplate: '<b>%{y} dBm</b>  ' + link.key + '<extra></extra>'
    };
  }

  function layoutFor(file) {
    const all = state.view === 'all';
    const s = file.summary;
    const pad = 3;
    const yRange = [s.min - pad, s.max + pad];
    const shapes = file.switches.map(function (sw) {
      return {
        type: 'line',
        xref: 'x',
        yref: 'paper',
        x0: sw.t,
        x1: sw.t,
        y0: 0,
        y1: 1,
        line: { color: THEME.ink2, width: 1 }
      };
    });
    const annotations = file.switches.map(function (sw) {
      return {
        x: sw.t,
        xref: 'x',
        y: 1,
        yref: 'paper',
        yanchor: 'top',
        xanchor: 'left',
        xshift: 4,
        showarrow: false,
        text: 'GW: ' + sw.from + '→' + sw.to,
        font: { color: THEME.ink, size: 11, family: THEME.font },
        bgcolor: THEME.surface
      };
    });
    const axisBase = {
      gridcolor: THEME.grid,
      gridwidth: 1,
      linecolor: THEME.axis,
      linewidth: 1,
      showline: true,
      zeroline: false,
      tickfont: { color: THEME.muted, size: 11 },
      title: { font: { color: THEME.muted, size: 12 } }
    };
    return {
      paper_bgcolor: THEME.surface,
      plot_bgcolor: THEME.surface,
      font: { family: THEME.font, color: THEME.ink2, size: 12 },
      margin: all ? { l: 60, r: 10, t: 16, b: 48 } : { l: 60, r: 14, t: 36, b: 48 },
      hovermode: 'x unified',
      hoverlabel: {
        bgcolor: THEME.page,
        bordercolor: THEME.border,
        font: { color: THEME.ink, family: THEME.font, size: 12 }
      },
      dragmode: 'zoom',
      showlegend: true,
      legend: all
        ? { orientation: 'v', x: 1.01, xanchor: 'left', y: 1, yanchor: 'top', font: { color: THEME.ink2, size: 12 }, bgcolor: 'rgba(0,0,0,0)' }
        : { orientation: 'h', x: 0, xanchor: 'left', y: 1.02, yanchor: 'bottom', font: { color: THEME.ink2, size: 12 }, bgcolor: 'rgba(0,0,0,0)' },
      xaxis: Object.assign({}, axisBase, {
        title: Object.assign({}, axisBase.title, { text: '時刻 [s]' }),
        hoverformat: '.1f',
        showspikes: true,
        spikemode: 'across',
        spikesnap: 'cursor',
        spikecolor: THEME.muted,
        spikethickness: 1,
        spikedash: 'solid'
      }),
      yaxis: Object.assign({}, axisBase, {
        title: Object.assign({}, axisBase.title, { text: 'RSSI [dBm]' }),
        range: yRange
      }),
      shapes: shapes,
      annotations: annotations
    };
  }

  function clearPlots() {
    state.plots.forEach(function (el) {
      if (window.Plotly) {
        Plotly.purge(el);
      }
    });
    state.plots = [];
    els.charts.textContent = '';
  }

  function syncX(source, ev) {
    if (state.syncing || state.plots.length < 2) {
      return;
    }
    let update = null;
    if (ev['xaxis.autorange']) {
      update = { 'xaxis.autorange': true };
    } else if (ev['xaxis.range[0]'] !== undefined && ev['xaxis.range[1]'] !== undefined) {
      update = { 'xaxis.range': [ev['xaxis.range[0]'], ev['xaxis.range[1]']] };
    } else if (Array.isArray(ev['xaxis.range'])) {
      update = { 'xaxis.range': ev['xaxis.range'].slice() };
    }
    if (!update) {
      return;
    }
    state.syncing = true;
    const jobs = state.plots
      .filter(function (el) { return el !== source; })
      .map(function (el) { return Plotly.relayout(el, update); });
    Promise.all(jobs).then(function () { state.syncing = false; }, function () { state.syncing = false; });
  }

  function renderCharts(file) {
    clearPlots();
    const groups = chartGroups();
    els.charts.classList.toggle('one', groups.length === 1);
    groups.forEach(function (g) {
      const card = document.createElement('div');
      card.className = 'card';
      const h = document.createElement('h2');
      h.textContent = g.title;
      const plot = document.createElement('div');
      plot.className = 'plot';
      card.appendChild(h);
      card.appendChild(plot);
      els.charts.appendChild(card);
      const traces = g.links.map(function (k) { return traceFor(file, k); });
      Plotly.newPlot(plot, traces, layoutFor(file), PLOT_CONFIG);
      plot.on('plotly_relayout', function (ev) { syncX(plot, ev); });
      state.plots.push(plot);
    });
  }

  function renderInfo(file) {
    const d = file.data;
    const first = d.gw[0];
    let gwText = 'GW: ' + first;
    if (file.switches.length) {
      gwText += ' → ' + file.switches.map(function (s) { return s.to; }).join(' → ') + '（切替 ' + file.switches.length + ' 回）';
    }
    els.info.textContent = [
      file.name,
      d.t.length.toLocaleString('ja-JP') + ' 行',
      d.t[0].toFixed(1) + '〜' + d.t[d.t.length - 1].toFixed(1) + ' 秒',
      gwText
    ].join('　｜　');
  }

  function cell(tag, text) {
    const c = document.createElement(tag);
    c.textContent = text;
    return c;
  }

  function renderStats(file) {
    els.stats.textContent = '';
    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    ['リンク', '平均 [dBm]（0を除く）', '最小 [dBm]', '最大 [dBm]', '0 の行数'].forEach(function (t) {
      hr.appendChild(cell('th', t));
    });
    thead.appendChild(hr);
    const tbody = document.createElement('tbody');
    LINKS.forEach(function (link, k) {
      const s = file.summary.links[k];
      const tr = document.createElement('tr');
      const name = document.createElement('td');
      const key = document.createElement('span');
      key.className = 'key';
      key.style.borderTopColor = SERIES[HUE[link.key]];
      name.appendChild(key);
      name.appendChild(document.createTextNode(link.key));
      tr.appendChild(name);
      tr.appendChild(cell('td', s.mean === null ? '—' : s.mean.toFixed(1)));
      tr.appendChild(cell('td', s.min === null ? '—' : String(s.min)));
      tr.appendChild(cell('td', s.max === null ? '—' : String(s.max)));
      tr.appendChild(cell('td', s.zeros.toLocaleString('ja-JP')));
      tbody.appendChild(tr);
    });
    els.stats.appendChild(thead);
    els.stats.appendChild(tbody);
  }

  function renderFileChips() {
    els.files.textContent = '';
    state.files.forEach(function (f, i) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(i === state.current));
      b.textContent = f.name;
      b.addEventListener('click', function () {
        if (state.current !== i) {
          state.current = i;
          render();
        }
      });
      els.files.appendChild(b);
    });
  }

  function renderViewButtons() {
    els.viewButtons.forEach(function (b) {
      b.setAttribute('aria-selected', String(b.dataset.view === state.view));
    });
  }

  function render() {
    if (state.current < 0) {
      els.viewer.hidden = true;
      return;
    }
    els.viewer.hidden = false;
    const file = state.files[state.current];
    renderFileChips();
    renderViewButtons();
    renderInfo(file);
    renderStats(file);
    renderCharts(file);
  }

  function setupDrop() {
    ['dragenter', 'dragover'].forEach(function (type) {
      els.drop.addEventListener(type, function (e) {
        e.preventDefault();
        els.drop.classList.add('over');
      });
    });
    ['dragleave', 'drop'].forEach(function (type) {
      els.drop.addEventListener(type, function (e) {
        e.preventDefault();
        els.drop.classList.remove('over');
      });
    });
    els.drop.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files.length) {
        addFiles(e.dataTransfer.files);
      }
    });
    ['dragover', 'drop'].forEach(function (type) {
      window.addEventListener(type, function (e) { e.preventDefault(); });
    });
    els.input.addEventListener('change', function () {
      const picked = els.input.files;
      addFiles(picked).then(function () { els.input.value = ''; });
    });
  }

  function setupViews() {
    els.viewButtons.forEach(function (b) {
      b.addEventListener('click', function () {
        if (state.view !== b.dataset.view) {
          state.view = b.dataset.view;
          render();
        }
      });
    });
  }

  if (typeof window.Plotly === 'undefined') {
    showMessage('グラフ用ライブラリ（Plotly）を読み込めませんでした。インターネットにつながっているか確認してから、ページを再読み込みしてください。');
    els.input.disabled = true;
    return;
  }

  setupDrop();
  setupViews();
})();
