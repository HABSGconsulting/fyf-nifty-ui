/**
 * app.js — NIFTY 50 Waterfall Chart
 * Fetches chart-data.json from Cloudflare Pages Function (KV),
 * renders SVG waterfall, populates all analytics panels.
 *
 * Schema contract: fyf-nifty-engine/docs/05-json-schema.md (v1.1)
 * UI spec:         fyf-nifty-engine/docs/09-ui-chart-spec.md
 * Analytics spec:  fyf-nifty-engine/docs/08-analytics-cards-spec.md
 *
 * Depends on: D3 v7 (window.d3 via CDN — scale math only)
 * No localStorage. No external state. Pure in-memory.
 */

(function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────────
     CONFIG
  ───────────────────────────────────────────────────────────── */

  const CFG = {
    dataUrl:     '/api/nifty-data',
    fallbackUrl: './chart-data.json',

    staleThresholdMs: 26 * 60 * 60 * 1000, // 26 hours

    chart: {
      marginTop:    24,
      marginRight:  8,
      marginBottom: 32,
      marginLeft:   52,
      barWidthRatio: 0.55,  // bar width = column_width * 0.55 (per doc 09)
      bridgeStroke: 1,
      cornerRadius: 2,
      minBarHeight: 2,      // px — prevents zero-height bars on flat sessions
    },

    colours: {
      green:      '#22c55e',
      red:        '#ef4444',
      flat:       '#94a3b8',
      nonTrading: '#1e293b',
      bridge:     '#94a3b8',
      grid:       '#1e293b',
      axisLabel:  '#64748b',
      nonTradingLabel: '#475569',
      greenAlpha: 'rgba(34,197,94,0.15)',
      redAlpha:   'rgba(239,68,68,0.15)',
    },

    // Weekday badge colours per doc 09
    weekdayBadge: {
      Monday:    { bg: '#dbeafe', text: '#1e40af' },
      Tuesday:   { bg: '#ede9fe', text: '#5b21b6' },
      Wednesday: { bg: '#dcfce7', text: '#166534' },
      Thursday:  { bg: '#fef9c3', text: '#854d0e' },
      Friday:    { bg: '#ffedd5', text: '#9a3412' },
      Saturday:  { bg: '#f1f5f9', text: '#475569' },
      Sunday:    { bg: '#f1f5f9', text: '#475569' },
      nse_holiday: { bg: '#fce7f3', text: '#9d174d' },
    },
  };

  /* ─────────────────────────────────────────────────────────────
     DOM REFS
  ───────────────────────────────────────────────────────────── */

  const $ = id => document.getElementById(id);

  const DOM = {
    // Header
    statusBadge:   $('status-badge'),
    statusText:    $('status-text'),
    lastUpdated:   $('last-updated'),

    // Chart
    chartSkeleton: $('chart-skeleton'),
    chartError:    $('chart-error'),
    errorTitle:    $('error-title'),
    errorBody:     $('error-body'),
    retryBtn:      $('btn-retry'),
    chartSvg:      $('nifty-chart'),
    scrollWrapper: $('chart-scroll-wrapper'),

    // Tooltip
    tooltip:       $('chart-tooltip'),
    tooltipDate:   $('tooltip-date'),
    tooltipClose:  $('tooltip-close'),
    tooltipChange: $('tooltip-change'),

    // Card Row 1 — Window Snapshot (analytics.component_a)
    windowHigh:      $('stat-window-high'),
    windowHighDate:  $('stat-window-high-date'),
    windowLow:       $('stat-window-low'),
    windowLowDate:   $('stat-window-low-date'),
    periodChange:    $('stat-period-change'),

    // Card Row 2 — Multi-Period Returns (analytics.card_row_2)
    ret1w:   $('ret-1w'),   ret2w:   $('ret-2w'),
    ret1m:   $('ret-1m'),   ret3m:   $('ret-3m'),
    ret6m:   $('ret-6m'),   ret1y:   $('ret-1y'),
    retYtd:  $('ret-ytd'),

    // Card Row 3 — Weekday Intelligence (analytics.component_b)
    wdToggle30d: $('wd-toggle-30d'),
    wdToggle1y:  $('wd-toggle-1y'),
    wdTableBody: $('wd-table-body'),
    wdWarning:   $('wd-warning'),

    // Card Row 4 — Gap Analysis (analytics.card_row_4)
    gapPeriod:       $('gap-period'),
    gapPostWeekend:  $('gap-post-weekend'),
    gapPostHoliday:  $('gap-post-holiday'),
    gapGreenStreak:  $('gap-green-streak'),
    gapRedStreak:    $('gap-red-streak'),
    gapAboveMean:    $('gap-above-mean'),

    // Card Row 5 — Volatility Regime (analytics.card_row_5)
    volPeriod:       $('vol-period'),
    volRegimeIcon:   $('vol-regime-icon'),
    volRegimeHeader: $('vol-regime-header'),
    volRegimeCopy:   $('vol-regime-copy'),
    volAvgSwing:     $('vol-avg-swing'),
    vol1yNorm:       $('vol-1y-norm'),
    volHighDays:     $('vol-high-days'),
    volCalmDays:     $('vol-calm-days'),
    volDrawdown:     $('vol-drawdown'),
  };

  /* ─────────────────────────────────────────────────────────────
     STATE
  ───────────────────────────────────────────────────────────── */

  let chartData   = null;
  let wdLookback  = '1y';   // active weekday tab
  let retryCount  = 0;
  const MAX_RETRIES = 3;

  /* ─────────────────────────────────────────────────────────────
     BOOT
  ───────────────────────────────────────────────────────────── */

  function boot() {
    if (DOM.retryBtn) {
      DOM.retryBtn.addEventListener('click', () => {
        retryCount = 0;
        hideError();
        showSkeleton();
        loadData();
      });
    }

    // Weekday toggle listeners
    if (DOM.wdToggle30d) DOM.wdToggle30d.addEventListener('click', () => setWdLookback('30d'));
    if (DOM.wdToggle1y)  DOM.wdToggle1y.addEventListener('click',  () => setWdLookback('1y'));

    loadData();
  }

  function setWdLookback(key) {
    wdLookback = key;
    if (DOM.wdToggle30d) DOM.wdToggle30d.classList.toggle('active', key === '30d');
    if (DOM.wdToggle1y)  DOM.wdToggle1y.classList.toggle('active',  key === '1y');
    if (chartData) renderWeekdayMatrix(chartData);
  }

  /* ─────────────────────────────────────────────────────────────
     DATA FETCH
  ───────────────────────────────────────────────────────────── */

  async function loadData() {
    try {
      const res = await fetchWithFallback();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      chartData = await res.json();
      validatePayload(chartData);
      render(chartData);
    } catch (err) {
      console.error('[fyf-nifty] load failed:', err);
      if (retryCount < MAX_RETRIES) {
        retryCount++;
        setTimeout(loadData, 2000 * retryCount);
      } else {
        showError(
          'Data unavailable',
          'Could not load chart data. The pipeline may be running — try again in a few minutes.'
        );
      }
    }
  }

  async function fetchWithFallback() {
    try {
      const r = await fetch(CFG.dataUrl, { cache: 'no-cache' });
      if (r.ok) return r;
      throw new Error(`primary ${r.status}`);
    } catch {
      return fetch(CFG.fallbackUrl, { cache: 'no-cache' });
    }
  }

  function validatePayload(d) {
    // Schema v1.1: top-level keys are meta, days, bridges, analytics
    if (!d || !Array.isArray(d.days) || d.days.length === 0) {
      throw new Error('Invalid payload: missing days array');
    }
    const version = d.meta && d.meta.schema_version;
    if (version && version !== '1.1') {
      console.warn(`[fyf-nifty] unexpected schema version: ${version}`);
      // Show banner but do not hard-fail
      showSchemaBanner(version);
    }
  }

  function showSchemaBanner(version) {
    const banner = $('schema-banner');
    if (banner) {
      banner.textContent = 'Chart update in progress — please refresh shortly.';
      banner.removeAttribute('hidden');
    }
  }

  /* ─────────────────────────────────────────────────────────────
     RENDER ORCHESTRATOR
  ───────────────────────────────────────────────────────────── */

  function render(d) {
    hideSkeleton();
    hideError(); // FIX: always dismiss any stale error overlay on successful load
    updateStatus(d);
    renderChart(d);
    renderCardRow1(d);
    renderCardRow2(d);
    renderWeekdayMatrix(d);
    renderCardRow4(d);
    renderCardRow5(d);
  }

  /* ─────────────────────────────────────────────────────────────
     STATUS BADGE
  ───────────────────────────────────────────────────────────── */

  function updateStatus(d) {
    // Schema v1.1: d.meta.last_updated
    const raw = d.meta && d.meta.last_updated;
    const generatedAt = raw ? new Date(raw) : null;

    if (!generatedAt || isNaN(generatedAt)) {
      setStatus('neutral', 'Unknown');
      if (DOM.lastUpdated) DOM.lastUpdated.textContent = '—';
      return;
    }

    const ageMs   = Date.now() - generatedAt.getTime();
    const isStale = ageMs > CFG.staleThresholdMs;
    setStatus(isStale ? 'stale' : 'live', isStale ? 'Stale' : 'Live');

    if (DOM.lastUpdated) DOM.lastUpdated.textContent = formatDatetime(generatedAt);
  }

  function setStatus(type, label) {
    if (DOM.statusBadge) DOM.statusBadge.className = `status-badge ${type}`;
    if (DOM.statusText)  DOM.statusText.textContent = label;
  }

  /* ─────────────────────────────────────────────────────────────
     WATERFALL CHART  (doc 09)
  ───────────────────────────────────────────────────────────── */

  function renderChart(d) {
    const days = d.days;
    if (!days || days.length === 0) return;

    const svg = DOM.chartSvg;
    if (!svg) return;
    svg.innerHTML = '';

    // ── Dimensions ──────────────────────────────────────────────
    const wrapper = DOM.scrollWrapper;
    const totalW  = Math.max(wrapper ? wrapper.clientWidth : 900, days.length * 22);
    const totalH  = 320;
    const { marginTop: mT, marginRight: mR, marginBottom: mB, marginLeft: mL } = CFG.chart;
    const innerW  = totalW - mL - mR;
    const innerH  = totalH - mT - mB;

    svg.setAttribute('width',   totalW);
    svg.setAttribute('height',  totalH);
    svg.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);

    // ── Scales ──────────────────────────────────────────────────
    // Column width = chart_width / number_of_days (per doc 09)
    const colW = innerW / days.length;

    // Y scale: domain from analytics.component_a window_low/high
    // with 0.5% padding per doc 09 spec
    const compA    = (d.analytics && d.analytics.component_a) || {};
    const tradingDays = days.filter(b => b.type === 'trading');
    const yDomainMin = compA.window_low  ? compA.window_low.value  * 0.995
                     : d3.min(tradingDays, b => b.bar_base);
    const yDomainMax = compA.window_high ? compA.window_high.value * 1.005
                     : d3.max(tradingDays, b => b.bar_top);

    if (yDomainMin == null || yDomainMax == null) return;

    const yScale = d3.scaleLinear()
      .domain([yDomainMin, yDomainMax])
      .range([mT + innerH, mT]);

    // ── Root group ──────────────────────────────────────────────
    const g = svgEl('g', {});
    svg.appendChild(g);

    // ── Grid lines (5–7 lines per doc 09) ───────────────────────
    const ticks = yScale.ticks(6);
    ticks.forEach(tick => {
      g.appendChild(svgEl('line', {
        x1: mL, x2: mL + innerW, y1: yScale(tick), y2: yScale(tick),
        stroke: CFG.colours.grid,
        'stroke-width': 1,
        opacity: 0.5,
      }));
    });

    // ── Y-axis labels ────────────────────────────────────────────
    ticks.forEach(tick => {
      const t = svgEl('text', {
        x: mL - 6, y: yScale(tick),
        'dominant-baseline': 'middle',
        'text-anchor': 'end',
        fill: CFG.colours.axisLabel,
        'font-size': '11',
        'font-family': 'Satoshi, system-ui, sans-serif',
        'font-variant-numeric': 'tabular-nums',
      });
      t.textContent = formatAxisPrice(tick);
      g.appendChild(t);
    });

    // ── Columns ─────────────────────────────────────────────────
    days.forEach((day, i) => {
      const bx = mL + i * colW;
      const cx = bx + colW / 2;

      if (day.type !== 'trading') {
        // Non-trading column: full-height dark block
        g.appendChild(svgEl('rect', {
          x: bx, y: mT,
          width: colW, height: innerH,
          fill: CFG.colours.nonTrading,
        }));

        // Centred label: SAT / SUN / holiday short name
        const label = day.type === 'nse_holiday'
          ? (day.holiday_name ? day.holiday_name.substring(0, 8) : 'HOL')
          : (day.weekday_short || '');

        if (label) {
          const lt = svgEl('text', {
            x: cx, y: mT + innerH / 2,
            'text-anchor': 'middle',
            'dominant-baseline': 'middle',
            fill: CFG.colours.nonTradingLabel,
            'font-size': '9',
            'font-family': 'Satoshi, system-ui, sans-serif',
            'writing-mode': 'vertical-rl',
            'text-orientation': 'mixed',
          });
          lt.textContent = label;
          g.appendChild(lt);
        }

      } else {
        // Trading column
        // bar_base = min(close, prev_close), bar_top = max(close, prev_close) — from schema
        const yBase = yScale(day.bar_base);
        const yTop  = yScale(day.bar_top);
        const barW  = colW * CFG.chart.barWidthRatio;
        const barX  = bx + (colW - barW) / 2;
        const barH  = Math.max(Math.abs(yBase - yTop), CFG.chart.minBarHeight);
        const barY  = Math.min(yBase, yTop);

        const isGain  = day.direction === 'gain';
        const isFlat  = day.direction === 'flat';
        const fill    = isFlat ? CFG.colours.flat : isGain ? CFG.colours.green : CFG.colours.red;
        const fillBg  = isGain ? CFG.colours.greenAlpha : isFlat ? 'transparent' : CFG.colours.redAlpha;

        // Column background tint
        if (fillBg !== 'transparent') {
          g.appendChild(svgEl('rect', {
            x: bx, y: mT, width: colW, height: innerH,
            fill: fillBg,
          }));
        }

        // Main bar
        const rect = svgEl('rect', {
          x: barX, y: barY,
          width: barW, height: barH,
          fill: fill,
          opacity: 0.85,
          rx: CFG.chart.cornerRadius,
          style: 'cursor:pointer',
        });
        g.appendChild(rect);

        // Invisible full-height hit area for tooltip (per doc 09 spec)
        const hitArea = svgEl('rect', {
          x: bx, y: mT, width: colW, height: innerH,
          fill: 'transparent',
          style: 'cursor:pointer',
        });
        attachTooltip(hitArea, day);
        g.appendChild(hitArea);
      }

      // ── X-axis weekday badge ───────────────────────────────────
      // Use day.type === 'nse_holiday' badge if applicable, else weekday
      const badgeKey = day.type === 'nse_holiday' ? 'nse_holiday' : (day.weekday || '');
      const badge    = CFG.weekdayBadge[badgeKey] || { bg: '#1e293b', text: '#64748b' };
      const labelTxt = formatBarDate(day.date);

      const badgeRect = svgEl('rect', {
        x: bx + 1, y: mT + innerH + 4,
        width: colW - 2, height: 16,
        fill: badge.bg,
        rx: 3,
      });
      g.appendChild(badgeRect);

      const badgeText = svgEl('text', {
        x: cx, y: mT + innerH + 12,
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        fill: badge.text,
        'font-size': '9',
        'font-family': 'Satoshi, system-ui, sans-serif',
        'font-variant-numeric': 'tabular-nums',
      });
      badgeText.textContent = labelTxt;
      g.appendChild(badgeText);
    });

    // ── Bridge connector lines (from bridges[] array) ────────────
    // per doc 09: dashed horizontal at bridge_y across non-trading band
    if (Array.isArray(d.bridges)) {
      d.bridges.forEach(bridge => {
        const startIdx = days.findIndex(day => day.date === bridge.start_date);
        const endIdx   = days.findIndex(day => day.date === bridge.end_date);
        if (startIdx < 0 || endIdx < 0) return;

        // x1 = right edge of column before the band
        // x2 = left edge of column after the band
        const x1 = mL + startIdx * colW;
        const x2 = mL + (endIdx + 1) * colW;
        const y  = yScale(bridge.bridge_y);

        g.appendChild(svgEl('line', {
          x1, x2, y1: y, y2: y,
          stroke: CFG.colours.bridge,
          'stroke-width': CFG.chart.bridgeStroke,
          'stroke-dasharray': '4,4',
          'pointer-events': 'none',
        }));
      });
    }
  }

  /* ─────────────────────────────────────────────────────────────
     TOOLTIP  (doc 09)
  ───────────────────────────────────────────────────────────── */

  function attachTooltip(el, day) {
    el.addEventListener('mouseenter', e => showTooltip(e, day));
    el.addEventListener('mousemove',  e => moveTooltip(e));
    el.addEventListener('mouseleave', hideTooltip);
    el.addEventListener('touchstart', e => {
      e.preventDefault();
      showTooltip(e.touches[0], day);
    }, { passive: false });
    el.addEventListener('touchend', hideTooltip);
  }

  function showTooltip(e, day) {
    if (!DOM.tooltip) return;

    if (DOM.tooltipDate)  DOM.tooltipDate.textContent  = formatTooltipDate(day.date, day.weekday);
    if (DOM.tooltipClose) DOM.tooltipClose.textContent = `Close: ${formatPrice(day.close)}`;

    if (DOM.tooltipChange) {
      const pts = day.close - day.prev_close;
      const pct = day.pct_change;
      const arrow = day.direction === 'gain' ? '▲' : day.direction === 'loss' ? '▼' : '→';
      DOM.tooltipChange.textContent =
        `${arrow} ${sign(pts)}${Math.abs(pts).toFixed(2)} pts (${sign(pct)}${Math.abs(pct).toFixed(2)}%)`;
      DOM.tooltipChange.className =
        `tooltip-change ${day.direction === 'gain' ? 'gain' : day.direction === 'loss' ? 'loss' : 'neutral'}`;
    }

    DOM.tooltip.removeAttribute('hidden');
    moveTooltip(e);
  }

  function moveTooltip(e) {
    const t  = DOM.tooltip;
    if (!t) return;
    const vw = window.innerWidth;
    const tw = t.offsetWidth  || 200;
    const th = t.offsetHeight || 80;
    let x = e.clientX + 14;
    let y = e.clientY - th - 8;
    if (x + tw > vw - 8) x = e.clientX - tw - 14;
    if (y < 8) y = e.clientY + 20;
    t.style.left = `${x}px`;
    t.style.top  = `${y}px`;
  }

  function hideTooltip() {
    if (DOM.tooltip) DOM.tooltip.setAttribute('hidden', '');
  }

  /* ─────────────────────────────────────────────────────────────
     CARD ROW 1 — Window Snapshot  (analytics.component_a)
  ───────────────────────────────────────────────────────────── */

  function renderCardRow1(d) {
    const a = d.analytics && d.analytics.component_a;
    if (!a) return;

    if (DOM.windowHigh && a.window_high) {
      setText(DOM.windowHigh, formatPrice(a.window_high.value));
      if (DOM.windowHighDate) setText(DOM.windowHighDate, fmtDate(a.window_high.date));
    }
    if (DOM.windowLow && a.window_low) {
      setText(DOM.windowLow, formatPrice(a.window_low.value));
      if (DOM.windowLowDate) setText(DOM.windowLowDate, fmtDate(a.window_low.date));
    }
    if (DOM.periodChange && a.net_change) {
      const n = a.net_change;
      const s = sign(n.points);
      setText(DOM.periodChange,
        `${s}${Math.abs(n.points).toFixed(2)} pts (${s}${Math.abs(n.pct).toFixed(2)}%)`);
      setColour(DOM.periodChange, n.direction);
    }
  }

  /* ─────────────────────────────────────────────────────────────
     CARD ROW 2 — Multi-Period Returns  (analytics.card_row_2)
  ───────────────────────────────────────────────────────────── */

  function renderCardRow2(d) {
    const r = d.analytics && d.analytics.card_row_2;
    if (!r) return;

    const map = {
      '1w': DOM.ret1w, '2w': DOM.ret2w, '1m': DOM.ret1m,
      '3m': DOM.ret3m, '6m': DOM.ret6m, '1y': DOM.ret1y,
      'ytd': DOM.retYtd,
    };

    Object.entries(map).forEach(([key, el]) => {
      if (!el) return;
      const data = r[key];
      if (!data) { setText(el, 'N/A'); return; }
      const s = sign(data.pct);

      // FIX: explicitly remove skeleton from inner spans and set text
      const pctEl = el.querySelector('.ret-pct');
      const ptsEl = el.querySelector('.ret-pts');
      if (pctEl) {
        pctEl.textContent = `${s}${Math.abs(data.pct).toFixed(2)}%`;
        pctEl.classList.remove('skeleton');
      }
      if (ptsEl) {
        ptsEl.textContent = `${s}${Math.abs(data.points).toFixed(0)} pts`;
        ptsEl.classList.remove('skeleton');
      }
      setColour(el, data.direction);
    });
  }

  /* ─────────────────────────────────────────────────────────────
     CARD ROW 3 — Weekday Intelligence  (analytics.component_b)
  ───────────────────────────────────────────────────────────── */

  const WEEKDAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday'];

  function renderWeekdayMatrix(d) {
    const compB = d.analytics && d.analytics.component_b;
    if (!compB || !DOM.wdTableBody) return;

    const data = compB[wdLookback] || compB['1y'];
    if (!data) return;

    // Warning badge: only on 30d view
    if (DOM.wdWarning) {
      DOM.wdWarning.hidden = (wdLookback !== '30d');
    }

    DOM.wdTableBody.innerHTML = '';

    WEEKDAYS.forEach(wd => {
      const row = data[wd];
      const tr  = document.createElement('tr');

      if (!row || row.suppressed) {
        tr.innerHTML = `
          <td>${wd.substring(0,3)}</td>
          <td colspan="6" class="suppressed">
            ⛔ Insufficient data (${row ? row.total_sessions : 0} sessions) — stat suppressed
          </td>`;
      } else {
        const dev = row.deviation_from_1y;
        const devTxt = (wdLookback === '30d' && dev != null)
          ? `${sign(dev)}${Math.abs(dev).toFixed(2)}%` : '—';
        const avgClass = row.avg_pct_change > 0 ? 'gain' : row.avg_pct_change < 0 ? 'loss' : 'neutral';

        tr.innerHTML = `
          <td>${wd.substring(0,3)}</td>
          <td>${row.total_sessions}</td>
          <td class="gain">${row.positive_sessions}</td>
          <td class="loss">${row.negative_sessions}</td>
          <td class="${avgClass}">${sign(row.avg_pct_change)}${Math.abs(row.avg_pct_change).toFixed(2)}%</td>
          <td class="gain">${row.best_session  ? `+${row.best_session.value.toFixed(2)}%`  : '—'}</td>
          <td class="loss">${row.worst_session ? `${row.worst_session.value.toFixed(2)}%` : '—'}</td>
          <td class="${dev != null ? (dev >= 0 ? 'gain' : 'loss') : ''}">${devTxt}</td>`;

        // Divergence signal: |deviation| > 0.20 on 30d view
        if (wdLookback === '30d' && dev != null && Math.abs(dev) > 0.20) {
          const signal = document.createElement('tr');
          const ratio  = row.avg_pct_change !== 0 && (data[wd] || {})
            ? (Math.abs(row.avg_pct_change / (row.avg_pct_change - dev))).toFixed(1)
            : '—';
          signal.innerHTML = `
            <td colspan="8" class="divergence-signal">
              📊 ${wd}'s current ${sign(row.avg_pct_change)}${row.avg_pct_change.toFixed(2)}%
              is ${ratio}× vs its 1-year avg of
              ${sign(row.avg_pct_change - dev)}${Math.abs(row.avg_pct_change - dev).toFixed(2)}%.
              Likely driven by a recent macro event — treat with caution.
            </td>`;
          DOM.wdTableBody.appendChild(tr);
          DOM.wdTableBody.appendChild(signal);
          return;
        }
      }
      DOM.wdTableBody.appendChild(tr);
    });
  }

  /* ─────────────────────────────────────────────────────────────
     CARD ROW 4 — Gap Analysis  (analytics.card_row_4)
  ───────────────────────────────────────────────────────────── */

  function renderCardRow4(d) {
    const r = d.analytics && d.analytics.card_row_4;
    if (!r) return;

    // Data period label
    if (DOM.gapPeriod && d.meta) {
      const start = d.meta.window_start ? fmtDate(d.meta.window_start) : null;
      const end   = d.meta.window_end   ? fmtDate(d.meta.window_end)   : null;
      if (start && end) setText(DOM.gapPeriod, `${start} – ${end}`);
    }

    if (DOM.gapPostWeekend) {
      setText(DOM.gapPostWeekend,
        r.post_weekend_avg_pct != null ? `${sign(r.post_weekend_avg_pct)}${Math.abs(r.post_weekend_avg_pct).toFixed(2)}%` : '—');
      setColour(DOM.gapPostWeekend, r.post_weekend_avg_pct >= 0 ? 'gain' : 'loss');
    }
    if (DOM.gapPostHoliday) {
      setText(DOM.gapPostHoliday,
        r.post_holiday_avg_pct != null ? `${sign(r.post_holiday_avg_pct)}${Math.abs(r.post_holiday_avg_pct).toFixed(2)}%` : '—');
      setColour(DOM.gapPostHoliday, r.post_holiday_avg_pct >= 0 ? 'gain' : 'loss');
    }

    // FIX: include green/red day counts and date range on streaks
    if (DOM.gapGreenStreak && r.longest_green_streak) {
      const gs = r.longest_green_streak;
      const totalTradingDays = d.days ? d.days.filter(x => x.type === 'trading').length : null;
      const greenDays = d.days ? d.days.filter(x => x.type === 'trading' && x.direction === 'gain').length : null;
      const greenPct  = (totalTradingDays && greenDays != null) ? Math.round(greenDays / totalTradingDays * 100) : null;
      const streakTxt = `${gs.sessions} sessions (${fmtDate(gs.start_date)}–${fmtDate(gs.end_date)})`;
      const daysTxt   = greenDays != null ? ` · ${greenDays} green days${greenPct != null ? ` (${greenPct}%)` : ''}` : '';
      setText(DOM.gapGreenStreak, streakTxt + daysTxt);
      setColour(DOM.gapGreenStreak, 'gain');
    }
    if (DOM.gapRedStreak && r.longest_red_streak) {
      const rs = r.longest_red_streak;
      const totalTradingDays = d.days ? d.days.filter(x => x.type === 'trading').length : null;
      const redDays  = d.days ? d.days.filter(x => x.type === 'trading' && x.direction === 'loss').length : null;
      const redPct   = (totalTradingDays && redDays != null) ? Math.round(redDays / totalTradingDays * 100) : null;
      const streakTxt = `${rs.sessions} sessions (${fmtDate(rs.start_date)}–${fmtDate(rs.end_date)})`;
      const daysTxt   = redDays != null ? ` · ${redDays} red days${redPct != null ? ` (${redPct}%)` : ''}` : '';
      setText(DOM.gapRedStreak, streakTxt + daysTxt);
      setColour(DOM.gapRedStreak, 'loss');
    }
    if (DOM.gapAboveMean) {
      setText(DOM.gapAboveMean,
        r.pct_days_above_30d_avg != null ? `${r.pct_days_above_30d_avg}% of trading days` : '—');
    }
  }

  /* ─────────────────────────────────────────────────────────────
     CARD ROW 5 — Volatility Regime  (analytics.card_row_5)
  ───────────────────────────────────────────────────────────── */

  const REGIME_ICONS  = { calm: '🟢', elevated: '🟡', high_volatility: '🔴' };
  const REGIME_CLASS  = { calm: 'gain', elevated: 'warning', high_volatility: 'loss' };

  // Hover tooltip definitions for volatility metric labels
  const VOL_TOOLTIPS = {
    'vol-avg-swing-label':  'Average intraday range (high minus low close-to-close) across all trading sessions in the window.',
    'vol-1y-norm-label':    'The 1-year historical average daily swing — used as a baseline to judge whether the current period is calm or volatile.',
    'vol-high-days-label':  'Sessions where the day\'s swing exceeded 1.5× the 1-year norm. These are outlier moves that can distort intraday strategies.',
    'vol-calm-days-label':  'Sessions where the day\'s swing was below 0.5× the 1-year norm. Low-activity days where range-based entries are less reliable.',
    'vol-drawdown-label':   'The largest peak-to-trough decline within the 30-day window, measured on closing prices. Indicates worst-case short-term loss exposure.',
  };

  function renderCardRow5(d) {
    const r = d.analytics && d.analytics.card_row_5;
    if (!r) return;

    // Data period label
    if (DOM.volPeriod && d.meta) {
      const start = d.meta.window_start ? fmtDate(d.meta.window_start) : null;
      const end   = d.meta.window_end   ? fmtDate(d.meta.window_end)   : null;
      if (start && end) setText(DOM.volPeriod, `${start} – ${end}`);
    }

    if (DOM.volRegimeIcon)   DOM.volRegimeIcon.textContent   = REGIME_ICONS[r.regime] || '⚪';
    if (DOM.volRegimeHeader) {
      setText(DOM.volRegimeHeader, r.regime_label || r.regime || '—');
      setColour(DOM.volRegimeHeader, REGIME_CLASS[r.regime] || 'neutral');
    }
    if (DOM.volRegimeCopy) setText(DOM.volRegimeCopy, r.regime_copy || '');

    if (DOM.volAvgSwing) {
      setText(DOM.volAvgSwing,
        r.avg_daily_swing_pts != null
          ? `${formatPrice(r.avg_daily_swing_pts)} pts (${r.avg_daily_swing_pct}%)` : '—');
    }
    if (DOM.vol1yNorm) {
      setText(DOM.vol1yNorm,
        r.norm_1y_swing_pts != null ? `${formatPrice(r.norm_1y_swing_pts)} pts` : '—');
    }
    if (DOM.volHighDays)  setText(DOM.volHighDays,  r.high_vol_days != null ? `${r.high_vol_days}` : '—');
    if (DOM.volCalmDays)  setText(DOM.volCalmDays,  r.calm_days     != null ? `${r.calm_days}`     : '—');
    if (DOM.volDrawdown && r.intra_period_drawdown) {
      const dd = r.intra_period_drawdown;
      setText(DOM.volDrawdown,
        `${sign(dd.pct)}${Math.abs(dd.pct).toFixed(2)}% (${sign(dd.points)}${Math.abs(dd.points).toFixed(0)} pts)`);
      setColour(DOM.volDrawdown, 'loss');
    }

    // Attach hover title definitions to vol metric label elements
    Object.entries(VOL_TOOLTIPS).forEach(([id, tip]) => {
      const el = $(id);
      if (el) el.title = tip;
    });
  }

  /* ─────────────────────────────────────────────────────────────
     SKELETON / ERROR HELPERS
  ───────────────────────────────────────────────────────────── */

  function showSkeleton() {
    if (DOM.chartSkeleton) DOM.chartSkeleton.removeAttribute('hidden');
    if (DOM.chartSvg)      DOM.chartSvg.style.display = 'none';
  }

  function hideSkeleton() {
    if (DOM.chartSkeleton) {
      DOM.chartSkeleton.setAttribute('hidden', '');
      DOM.chartSkeleton.style.display = 'none';
    }
    if (DOM.chartSvg) DOM.chartSvg.style.display = '';
  }

  function showError(title, body) {
    hideSkeleton();
    if (DOM.errorTitle) DOM.errorTitle.textContent = title || 'Error';
    if (DOM.errorBody)  DOM.errorBody.textContent  = body  || 'An unexpected error occurred.';
    if (DOM.chartError) DOM.chartError.removeAttribute('hidden');
    if (DOM.chartSvg)   DOM.chartSvg.style.display = 'none';
    setStatus('error', 'Error');
  }

  function hideError() {
    if (DOM.chartError) DOM.chartError.setAttribute('hidden', '');
  }

  /* ─────────────────────────────────────────────────────────────
     DOM HELPERS
  ───────────────────────────────────────────────────────────── */

  function setText(el, value) {
    if (!el) return;
    el.textContent = value;
    el.classList.remove('skeleton');
  }

  function setColour(el, cls) {
    if (!el) return;
    el.classList.remove('gain', 'loss', 'neutral', 'warning');
    if (cls) el.classList.add(cls);
  }

  /* ─────────────────────────────────────────────────────────────
     SVG HELPERS
  ───────────────────────────────────────────────────────────── */

  function svgEl(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  }

  /* ─────────────────────────────────────────────────────────────
     FORMAT HELPERS
  ───────────────────────────────────────────────────────────── */

  function formatPrice(v) {
    if (v == null || isNaN(v)) return '—';
    return new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(v);
  }

  function formatAxisPrice(v) {
    if (v == null) return '';
    return Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(0);
  }

  function formatBarDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    return parts[2] ? parts[2].replace(/^0/, '') : '';
  }

  function fmtDate(dateStr) {
    if (!dateStr) return '';
    try {
      const dt = new Date(dateStr + 'T00:00:00');
      return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    } catch { return dateStr; }
  }

  function formatTooltipDate(dateStr, weekday) {
    if (!dateStr) return '';
    try {
      const dt = new Date(dateStr + 'T00:00:00');
      const base = dt.toLocaleDateString('en-IN', {
        weekday: 'long', day: 'numeric', month: 'long',
      });
      return base;
    } catch { return dateStr; }
  }

  function formatDatetime(dt) {
    try {
      return dt.toLocaleString('en-IN', {
        day: 'numeric', month: 'short',
        hour: '2-digit', minute: '2-digit',
        timeZone: 'Asia/Kolkata',
      }) + ' IST';
    } catch { return dt.toISOString(); }
  }

  function sign(v) { return v > 0 ? '+' : ''; }

  /* ─────────────────────────────────────────────────────────────
     KICK OFF
  ───────────────────────────────────────────────────────────── */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
