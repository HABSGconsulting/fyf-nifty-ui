/**
 * app.js — NIFTY 50 Waterfall Chart
 * Fetches chart-data.json from Cloudflare Worker (KV),
 * renders SVG waterfall, populates all analytics panels.
 *
 * Depends on:
 *   - d3-scale v4  (window.d3 via CDN, or d3Scale)
 *   - d3-array v3  (window.d3 via CDN, or d3Array)
 *
 * No localStorage. No external state. Pure in-memory.
 */

(function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────────
     CONFIG
  ───────────────────────────────────────────────────────────── */

  const CFG = {
    // Cloudflare Worker endpoint — serves chart-data.json from KV
    dataUrl: '/api/chart-data',

    // Fallback for local dev / pre-worker testing
    fallbackUrl: './chart-data.json',

    // How stale (ms) before badge turns yellow
    staleThresholdMs: 26 * 60 * 60 * 1000, // 26 hours

    // Chart layout
    chart: {
      marginTop:    24,
      marginRight:  8,
      marginBottom: 32,
      marginLeft:   52,
      barGap:       3,    // px gap between bars
      bridgeStroke: 1.5,  // connector line width
      cornerRadius: 2,
    },

    // Colour tokens (mirror CSS vars for SVG which can't use vars directly)
    colours: {
      green:      '#22c55e',
      red:        '#ef4444',
      nonTrading: '#1e293b',
      bridge:     '#94a3b8',
      grid:       '#1e293b',
      axisLabel:  '#64748b',
      greenAlpha: 'rgba(34,197,94,0.15)',
      redAlpha:   'rgba(239,68,68,0.15)',
    },
  };

  /* ─────────────────────────────────────────────────────────────
     DOM REFS
  ───────────────────────────────────────────────────────────── */

  const $ = id => document.getElementById(id);

  const DOM = {
    statusBadge:   $('status-badge'),
    statusText:    $('status-text'),
    lastUpdated:   $('last-updated'),

    // Summary stats
    closeVal:      $('stat-close-value'),
    closeChg:      $('stat-close-change'),
    monthVal:      $('stat-month-value'),
    monthChg:      $('stat-month-change'),
    athVal:        $('stat-ath-value'),
    athChg:        $('stat-ath-change'),

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

    // Weekday matrix
    wrMon: $('wr-mon'), wrTue: $('wr-tue'), wrWed: $('wr-wed'),
    wrThu: $('wr-thu'), wrFri: $('wr-fri'),
    wcMon: $('wc-mon'), wcTue: $('wc-tue'), wcWed: $('wc-wed'),
    wcThu: $('wc-thu'), wcFri: $('wc-fri'),

    // Analytics cards
    gapUpDays:     $('gap-up-days'),
    gapDownDays:   $('gap-down-days'),
    gapUpAvg:      $('gap-up-avg'),
    gapDownAvg:    $('gap-down-avg'),

    volRegime:     $('vol-regime'),
    volAvgMove:    $('vol-avg-move'),
    volLargestGain: $('vol-largest-gain'),
    volLargestLoss: $('vol-largest-loss'),

    momSma20:      $('mom-sma20'),
    momSma50:      $('mom-sma50'),
    momRsi14:      $('mom-rsi14'),
    momVsSma20:    $('mom-vs-sma20'),

    streakCurrent: $('streak-current'),
    streakWin:     $('streak-win'),
    streakLoss:    $('streak-loss'),
    streakWinrate: $('streak-winrate'),
  };

  /* ─────────────────────────────────────────────────────────────
     STATE
  ───────────────────────────────────────────────────────────── */

  let chartData = null;   // parsed JSON from KV
  let retryCount = 0;
  const MAX_RETRIES = 3;

  /* ─────────────────────────────────────────────────────────────
     BOOT
  ───────────────────────────────────────────────────────────── */

  function boot() {
    DOM.retryBtn.addEventListener('click', () => {
      retryCount = 0;
      hideError();
      showSkeleton();
      loadData();
    });

    loadData();
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
      // Fall back to static file (local dev / pre-worker)
      return fetch(CFG.fallbackUrl, { cache: 'no-cache' });
    }
  }

  function validatePayload(d) {
    if (!d || !Array.isArray(d.bars) || d.bars.length === 0) {
      throw new Error('Invalid payload: missing bars array');
    }
  }

  /* ─────────────────────────────────────────────────────────────
     RENDER ORCHESTRATOR
  ───────────────────────────────────────────────────────────── */

  function render(d) {
    hideSkeleton();
    updateStatus(d);
    renderSummaryStats(d);
    renderChart(d);
    renderWeekdayMatrix(d);
    renderAnalyticsCards(d);
  }

  /* ─────────────────────────────────────────────────────────────
     STATUS BADGE
  ───────────────────────────────────────────────────────────── */

  function updateStatus(d) {
    const generatedAt = d.meta && d.meta.generated_at
      ? new Date(d.meta.generated_at)
      : null;

    if (!generatedAt || isNaN(generatedAt)) {
      setStatus('neutral', 'Unknown');
      DOM.lastUpdated.textContent = '—';
      return;
    }

    const ageMs = Date.now() - generatedAt.getTime();
    const isStale = ageMs > CFG.staleThresholdMs;

    if (isStale) {
      setStatus('stale', 'Stale');
    } else {
      setStatus('live', 'Live');
    }

    DOM.lastUpdated.textContent = formatDatetime(generatedAt);
  }

  function setStatus(type, label) {
    DOM.statusBadge.className = `status-badge ${type}`;
    DOM.statusText.textContent = label;
  }

  /* ─────────────────────────────────────────────────────────────
     SUMMARY STATS (Component A)
  ───────────────────────────────────────────────────────────── */

  function renderSummaryStats(d) {
    const summary = d.summary || {};

    // Today's close
    const close = summary.latest_close;
    if (close != null) {
      setText(DOM.closeVal, formatPrice(close), false);
      const chgPct = summary.day_change_pct;
      if (chgPct != null) {
        setChange(DOM.closeChg, chgPct, `${sign(chgPct)}${Math.abs(chgPct).toFixed(2)}%`);
      }
    } else {
      setText(DOM.closeVal, 'N/A', false);
    }

    // Month so far
    const monthPct = summary.month_change_pct;
    if (monthPct != null) {
      setText(DOM.monthVal, `${sign(monthPct)}${Math.abs(monthPct).toFixed(2)}%`, false);
      setChange(DOM.monthChg, monthPct, summary.month_label || '');
    } else {
      setText(DOM.monthVal, 'N/A', false);
    }

    // From ATH
    const athPct = summary.from_ath_pct;
    if (athPct != null) {
      setText(DOM.athVal, `${sign(athPct)}${Math.abs(athPct).toFixed(2)}%`, false);
      const athVal = summary.all_time_high;
      if (athVal != null) {
        DOM.athChg.textContent = `ATH ${formatPrice(athVal)}`;
        DOM.athChg.className = 'stat-change neutral';
      }
    } else {
      setText(DOM.athVal, 'N/A', false);
    }
  }

  /* ─────────────────────────────────────────────────────────────
     WATERFALL CHART
  ───────────────────────────────────────────────────────────── */

  function renderChart(d) {
    const bars = d.bars;
    if (!bars || bars.length === 0) return;

    const svg = DOM.chartSvg;
    svg.innerHTML = '';  // clear previous

    // ── Dimensions ──
    const wrapper    = DOM.scrollWrapper;
    const totalW     = Math.max(wrapper.clientWidth || 900, bars.length * 22);
    const totalH     = 320;
    const { marginTop: mT, marginRight: mR, marginBottom: mB, marginLeft: mL } = CFG.chart;
    const innerW     = totalW - mL - mR;
    const innerH     = totalH - mT - mB;

    svg.setAttribute('width', totalW);
    svg.setAttribute('height', totalH);
    svg.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);

    // ── Scales ──
    // x: band scale over bar indices
    const xScale = d3.scaleBand()
      .domain(bars.map((_, i) => i))
      .range([mL, mL + innerW])
      .padding(CFG.chart.barGap / (innerW / bars.length));

    // y: linear over price range (for trading bars) + zero line
    const tradingBars = bars.filter(b => b.type === 'trading');
    const allValues   = tradingBars.flatMap(b => [b.open, b.close]).filter(v => v != null);

    if (allValues.length === 0) return;

    const yMin = d3.min(allValues);
    const yMax = d3.max(allValues);
    const yPad = (yMax - yMin) * 0.08;  // 8% padding

    const yScale = d3.scaleLinear()
      .domain([yMin - yPad, yMax + yPad])
      .range([mT + innerH, mT]);

    // ── Groups ──
    const g = svgEl('g', {});
    svg.appendChild(g);

    // ── Grid lines ──
    const ticks = yScale.ticks(5);
    ticks.forEach(tick => {
      const y = yScale(tick);
      g.appendChild(svgEl('line', {
        x1: mL, x2: mL + innerW, y1: y, y2: y,
        stroke: CFG.colours.grid,
        'stroke-width': 1,
        'stroke-dasharray': '4 3',
      }));
    });

    // ── Y Axis labels ──
    ticks.forEach(tick => {
      const y = yScale(tick);
      const t = svgEl('text', {
        x: mL - 6,
        y: y,
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

    // ── Bars ──
    bars.forEach((bar, i) => {
      const bx = xScale(i);
      const bw = xScale.bandwidth();
      const cx = bx + bw / 2;  // column centre (for x-axis label)

      if (bar.type === 'non-trading') {
        // Non-trading column: full-height dim block
        g.appendChild(svgEl('rect', {
          x: bx, y: mT,
          width: bw, height: innerH,
          fill: CFG.colours.nonTrading,
          rx: CFG.chart.cornerRadius,
          'data-index': i,
          'data-type': 'non-trading',
        }));
        // Weekend/holiday label inside block
        const label = bar.day_type === 'holiday' ? '★' : bar.label || '';
        if (label) {
          const lt = svgEl('text', {
            x: cx, y: mT + innerH / 2,
            'text-anchor': 'middle',
            'dominant-baseline': 'middle',
            fill: CFG.colours.axisLabel,
            'font-size': '10',
            'font-family': 'Satoshi, system-ui, sans-serif',
            'writing-mode': 'vertical-rl',
            'text-orientation': 'mixed',
          });
          lt.textContent = label;
          g.appendChild(lt);
        }
      } else {
        // Trading bar
        const yOpen  = yScale(bar.open);
        const yClose = yScale(bar.close);
        const isGain = bar.close >= bar.open;

        const barY = isGain ? yClose : yOpen;
        const barH = Math.max(Math.abs(yOpen - yClose), 2);  // min 2px

        const fill    = isGain ? CFG.colours.green : CFG.colours.red;
        const fillBg  = isGain ? CFG.colours.greenAlpha : CFG.colours.redAlpha;

        // Background fill (full column, very light)
        g.appendChild(svgEl('rect', {
          x: bx, y: mT,
          width: bw, height: innerH,
          fill: fillBg,
          rx: CFG.chart.cornerRadius,
        }));

        // Main bar
        const rect = svgEl('rect', {
          x: bx, y: barY,
          width: bw, height: barH,
          fill: fill,
          rx: CFG.chart.cornerRadius,
          'data-index': i,
          'data-type': 'trading',
          style: 'cursor:pointer',
          role: 'presentation',
          'aria-hidden': 'true',
        });
        g.appendChild(rect);

        // Bridge line to next trading bar (connector)
        const next = findNextTrading(bars, i);
        if (next) {
          const nBx = xScale(next.index);
          const nBw = xScale.bandwidth();
          const yC  = yScale(bar.close);
          g.appendChild(svgEl('line', {
            x1: bx + bw, x2: nBx,
            y1: yC, y2: yC,
            stroke: CFG.colours.bridge,
            'stroke-width': CFG.chart.bridgeStroke,
            'stroke-dasharray': '3 3',
            'pointer-events': 'none',
          }));
        }

        // Hover interaction
        attachTooltip(rect, bar);
      }

      // X Axis date label
      const dateLbl = formatBarDate(bar.date);
      const textEl  = svgEl('text', {
        x: cx, y: mT + innerH + 16,
        'text-anchor': 'middle',
        fill: CFG.colours.axisLabel,
        'font-size': '10',
        'font-family': 'Satoshi, system-ui, sans-serif',
        'font-variant-numeric': 'tabular-nums',
      });
      textEl.textContent = dateLbl;
      g.appendChild(textEl);
    });
  }

  /* ─────────────────────────────────────────────────────────────
     TOOLTIP
  ───────────────────────────────────────────────────────────── */

  function attachTooltip(el, bar) {
    el.addEventListener('mouseenter', e => showTooltip(e, bar));
    el.addEventListener('mousemove',  e => moveTooltip(e));
    el.addEventListener('mouseleave', hideTooltip);
    // Touch support
    el.addEventListener('touchstart', e => {
      e.preventDefault();
      showTooltip(e.touches[0], bar);
    }, { passive: false });
    el.addEventListener('touchend', hideTooltip);
  }

  function showTooltip(e, bar) {
    const isGain = bar.close >= bar.open;
    const chgPct = bar.change_pct != null ? bar.change_pct : safePct(bar.open, bar.close);
    const chgAbs = bar.change_abs != null ? bar.change_abs : (bar.close - bar.open);

    DOM.tooltipDate.textContent   = formatTooltipDate(bar.date);
    DOM.tooltipClose.textContent  = formatPrice(bar.close);
    DOM.tooltipChange.textContent = `${sign(chgAbs)}${Math.abs(chgAbs).toFixed(1)} pts  (${sign(chgPct)}${Math.abs(chgPct).toFixed(2)}%)`;
    DOM.tooltipChange.className   = `tooltip-change ${isGain ? 'gain' : 'loss'}`;

    DOM.tooltip.removeAttribute('hidden');
    moveTooltip(e);
  }

  function moveTooltip(e) {
    const t  = DOM.tooltip;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
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
    DOM.tooltip.setAttribute('hidden', '');
  }

  /* ─────────────────────────────────────────────────────────────
     WEEKDAY WIN-RATE MATRIX (Component B)
  ───────────────────────────────────────────────────────────── */

  function renderWeekdayMatrix(d) {
    const wr = d.weekday_win_rates;
    if (!wr) return;

    const days = [
      { key: 'mon', wrEl: DOM.wrMon, wcEl: DOM.wcMon },
      { key: 'tue', wrEl: DOM.wrTue, wcEl: DOM.wcTue },
      { key: 'wed', wrEl: DOM.wrWed, wcEl: DOM.wcWed },
      { key: 'thu', wrEl: DOM.wrThu, wcEl: DOM.wcThu },
      { key: 'fri', wrEl: DOM.wrFri, wcEl: DOM.wcFri },
    ];

    days.forEach(({ key, wrEl, wcEl }) => {
      const data = wr[key];
      if (!data) return;

      const rate = data.win_rate;   // 0–100 float
      const wins = data.wins;
      const total = data.total;

      // Remove skeleton
      wrEl.classList.remove('skeleton');

      // Set text
      wrEl.textContent = rate != null ? `${Math.round(rate)}%` : '—';
      wcEl.textContent = (wins != null && total != null) ? `${wins} / ${total}` : '— / —';

      // Colour class: high ≥ 60%, low < 40%, else mid
      if (rate != null) {
        wrEl.classList.remove('high', 'mid', 'low');
        wrEl.classList.add(rate >= 60 ? 'high' : rate < 40 ? 'low' : 'mid');
      }
    });
  }

  /* ─────────────────────────────────────────────────────────────
     ANALYTICS CARDS
  ───────────────────────────────────────────────────────────── */

  function renderAnalyticsCards(d) {
    const analytics = d.analytics || {};

    // ── Gap Analysis ──
    const gap = analytics.gap || {};
    setText(DOM.gapUpDays,   gap.gap_up_days   != null ? `${gap.gap_up_days} days`   : '—');
    setText(DOM.gapDownDays, gap.gap_down_days != null ? `${gap.gap_down_days} days` : '—');
    setText(DOM.gapUpAvg,    gap.avg_gap_up    != null ? `+${gap.avg_gap_up.toFixed(2)}%`  : '—');
    setText(DOM.gapDownAvg,  gap.avg_gap_down  != null ? `${gap.avg_gap_down.toFixed(2)}%` : '—');

    setColour(DOM.gapUpAvg,   'gain');
    setColour(DOM.gapDownAvg, 'loss');

    // ── Volatility Regime ──
    const vol = analytics.volatility || {};
    setText(DOM.volRegime,      vol.regime || '—');
    setText(DOM.volAvgMove,     vol.avg_daily_move != null ? `${vol.avg_daily_move.toFixed(2)}%` : '—');
    setText(DOM.volLargestGain, vol.largest_gain   != null ? `+${vol.largest_gain.toFixed(2)}%` : '—');
    setText(DOM.volLargestLoss, vol.largest_loss   != null ? `${vol.largest_loss.toFixed(2)}%`  : '—');

    // Regime colour
    if (vol.regime) {
      const r = vol.regime.toLowerCase();
      setColour(DOM.volRegime, r.includes('low') ? 'gain' : r.includes('high') ? 'loss' : 'warning');
    }
    setColour(DOM.volLargestGain, 'gain');
    setColour(DOM.volLargestLoss, 'loss');

    // ── Momentum ──
    const mom = analytics.momentum || {};
    const latestClose = d.summary && d.summary.latest_close;

    setText(DOM.momSma20, mom.sma_20 != null ? formatPrice(mom.sma_20) : '—');
    setText(DOM.momSma50, mom.sma_50 != null ? formatPrice(mom.sma_50) : '—');

    // RSI: green < 70, red > 70, warning > 30
    if (mom.rsi_14 != null) {
      setText(DOM.momRsi14, mom.rsi_14.toFixed(1));
      setColour(DOM.momRsi14, mom.rsi_14 >= 70 ? 'loss' : mom.rsi_14 <= 30 ? 'gain' : 'neutral');
    } else {
      setText(DOM.momRsi14, '—');
    }

    // vs SMA 20
    if (mom.sma_20 != null && latestClose != null) {
      const diff = ((latestClose - mom.sma_20) / mom.sma_20) * 100;
      setText(DOM.momVsSma20, `${sign(diff)}${Math.abs(diff).toFixed(2)}%`);
      setColour(DOM.momVsSma20, diff >= 0 ? 'gain' : 'loss');
    } else {
      setText(DOM.momVsSma20, '—');
    }

    // SMA colours
    if (mom.sma_20 != null && latestClose != null) {
      setColour(DOM.momSma20, latestClose >= mom.sma_20 ? 'gain' : 'loss');
    }
    if (mom.sma_50 != null && latestClose != null) {
      setColour(DOM.momSma50, latestClose >= mom.sma_50 ? 'gain' : 'loss');
    }

    // ── Streaks ──
    const st = analytics.streaks || {};

    // Current streak: "3W" or "2L"
    if (st.current_streak != null && st.current_type) {
      const label = `${Math.abs(st.current_streak)}${st.current_type === 'win' ? 'W' : 'L'}`;
      setText(DOM.streakCurrent, label);
      setColour(DOM.streakCurrent, st.current_type === 'win' ? 'gain' : 'loss');
    } else {
      setText(DOM.streakCurrent, '—');
    }

    setText(DOM.streakWin,  st.longest_win_streak  != null ? `${st.longest_win_streak} days`  : '—');
    setText(DOM.streakLoss, st.longest_loss_streak != null ? `${st.longest_loss_streak} days` : '—');

    setColour(DOM.streakWin,  'gain');
    setColour(DOM.streakLoss, 'loss');

    if (st.win_rate_30d != null) {
      setText(DOM.streakWinrate, `${Math.round(st.win_rate_30d)}%`);
      setColour(DOM.streakWinrate, st.win_rate_30d >= 50 ? 'gain' : 'loss');
    } else {
      setText(DOM.streakWinrate, '—');
    }
  }

  /* ─────────────────────────────────────────────────────────────
     SKELETON / ERROR HELPERS
  ───────────────────────────────────────────────────────────── */

  function showSkeleton() {
    DOM.chartSkeleton.removeAttribute('hidden');
    DOM.chartSvg.style.display = 'none';
  }

  function hideSkeleton() {
    DOM.chartSkeleton.setAttribute('hidden', '');
    DOM.chartSkeleton.style.display = 'none';
    DOM.chartSvg.style.display = '';
  }

  function showError(title, body) {
    hideSkeleton();
    DOM.errorTitle.textContent = title || 'Error';
    DOM.errorBody.textContent  = body  || 'An unexpected error occurred.';
    DOM.chartError.removeAttribute('hidden');
    DOM.chartSvg.style.display = 'none';
    setStatus('error', 'Error');
  }

  function hideError() {
    DOM.chartError.setAttribute('hidden', '');
  }

  /* ─────────────────────────────────────────────────────────────
     DOM HELPERS
  ───────────────────────────────────────────────────────────── */

  function setText(el, value, keepSkeleton) {
    if (!el) return;
    el.textContent = value;
    if (!keepSkeleton) el.classList.remove('skeleton');
  }

  function setChange(el, numValue, label) {
    if (!el) return;
    el.textContent = label;
    el.className = `stat-change ${numValue > 0 ? 'gain' : numValue < 0 ? 'loss' : 'neutral'}`;
  }

  function setColour(el, cls) {
    if (!el) return;
    el.classList.remove('gain', 'loss', 'neutral', 'warning');
    el.classList.add(cls);
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
     CHART UTILITIES
  ───────────────────────────────────────────────────────────── */

  function findNextTrading(bars, fromIndex) {
    for (let i = fromIndex + 1; i < bars.length; i++) {
      if (bars[i].type === 'trading') return { ...bars[i], index: i };
    }
    return null;
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
    // e.g. 24500 → "24.5k"
    if (Math.abs(v) >= 1000) {
      return (v / 1000).toFixed(1) + 'k';
    }
    return v.toFixed(0);
  }

  function formatBarDate(dateStr) {
    // "2026-06-30" → "30" (just day number; compact for bar axis)
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    return parts[2] ? parts[2].replace(/^0/, '') : '';
  }

  function formatTooltipDate(dateStr) {
    // "2026-06-30" → "Mon, 30 Jun"
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr + 'T00:00:00');
      return d.toLocaleDateString('en-IN', {
        weekday: 'short', day: 'numeric', month: 'short',
      });
    } catch {
      return dateStr;
    }
  }

  function formatDatetime(dt) {
    try {
      return dt.toLocaleString('en-IN', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
        timeZone: 'Asia/Kolkata',
      }) + ' IST';
    } catch {
      return dt.toISOString();
    }
  }

  function sign(v) {
    return v > 0 ? '+' : '';
  }

  function safePct(open, close) {
    if (!open) return 0;
    return ((close - open) / open) * 100;
  }

  /* ─────────────────────────────────────────────────────────────
     KICK OFF
  ───────────────────────────────────────────────────────────── */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
