/**
 * StaySphere AOS — plugin-auction.js
 * Phase D: Auction listing page (tabs, filters, card rendering, countdown bootstrap)
 * Registered as: StaySphere.extend('auction', AuctionPlugin)
 * Runs only on pages with #auction-listing-page
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  function sym() {
    const i18n = window.StaySphere?.i18n;
    if (i18n?.currentCurrency) {
      const code = i18n.currentCurrency();
      return i18n.CURRENCIES[code]?.symbol || document.body.dataset.currencySymbol || '$';
    }
    return document.body.dataset.currencySymbol || '$';
  }
  function fmtI18n(amount) {
    const i18n = window.StaySphere?.i18n;
    if (i18n?.fx?.loaded) {
      const base = document.body.dataset.currency || 'USD';
      const to   = i18n.currentCurrency();
      return i18n.fx.format(Number(amount || 0), base, to);
    }
    return sym() + Number(amount || 0).toLocaleString('en-US');
  }
  const apiBase = () => document.body.dataset.api || '';

  // ─── State ──────────────────────────────────────────────────────────────────
  let currentStatuses = ['OPEN', 'EXTENDED'];
  let currentType = null;
  let currentPage = 0;
  let totalPages = 0;
  let activeTimers = [];  // interval IDs to clear on re-render

  // ─── Countdown engine ────────────────────────────────────────────────────────
  function startCountdown(el) {
    const endsAt = el.dataset.endsAt;
    if (!endsAt) return;
    const end = new Date(endsAt).getTime();

    function tick() {
      const now = Date.now();
      const diff = end - now;
      if (diff <= 0) {
        ['d','h','m','s'].forEach(p => {
          const seg = el.querySelector(`[data-part="${p}"]`);
          if (seg) seg.textContent = '00';
        });
        el.classList.add('countdown-timer--expired');
        return;
      }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      const pad = n => String(n).padStart(2, '0');
      const set = (part, val) => {
        const seg = el.querySelector(`[data-part="${part}"]`);
        if (seg) seg.textContent = pad(val);
      };
      set('d', d); set('h', h); set('m', m); set('s', s);
      // Urgent styling — last 5 minutes
      el.classList.toggle('countdown-timer--urgent', diff < 300000);
    }
    tick();
    const id = setInterval(tick, 1000);
    activeTimers.push(id);
    return id;
  }

  function bootstrapCountdowns(root) {
    (root || document).querySelectorAll('.countdown-timer[data-ends-at]').forEach(el => {
      if (el.dataset.endsAt) startCountdown(el);
    });
  }

  function clearTimers() {
    activeTimers.forEach(id => clearInterval(id));
    activeTimers = [];
  }

  // ─── Render auction card (JS-built, mirrors auction-card.liquid structure) ───
  function renderAuctionCard(lot) {
    const s = sym();
    const isLive = lot.status === 'OPEN' || lot.status === 'EXTENDED';
    const isClosed = ['CLOSED', 'SETTLED', 'NO_RESERVE', 'CANCELLED'].includes(lot.status);
    const price = isLive && lot.currentBidAmount ? lot.currentBidAmount : lot.startingPrice;
    const priceLabel = isLive ? 'Current bid' : (isClosed ? 'Winning bid' : 'Starting');
    const winningAmount = lot.winningAmount;
    const displayPrice = isClosed && winningAmount ? winningAmount : price;

    const typeIcons = { ENGLISH: '📈', DUTCH: '📉', REVERSE: '🔄', SEALED_BID: '🔒' };
    const typeLabels = { ENGLISH: 'English', DUTCH: 'Dutch', REVERSE: 'Reverse', SEALED_BID: 'Sealed' };

    const img = lot.firstImageUrl
      ? `<img src="${esc(lot.firstImageUrl)}" alt="${esc(lot.title)}" class="auction-card__image" loading="lazy" width="600" height="400">`
      : `<div class="auction-card__image-placeholder" aria-hidden="true">🏠</div>`;

    const liveBadge = isLive
      ? `<span class="auction-card__live-badge"><span class="live-dot" aria-hidden="true"></span> Live</span>` : '';
    const streamBadge = lot.livestreamActive
      ? `<span class="auction-card__stream-badge">📡</span>` : '';
    const depositBadge = lot.depositRequired
      ? `<p class="auction-card__deposit-notice"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Deposit required</p>` : '';

    const countdownHtml = isLive && lot.scheduledEndsAt ? `
      <div class="countdown-timer${lot.status === 'EXTENDED' ? ' countdown-timer--extended' : ''}"
           data-ends-at="${lot.scheduledEndsAt}" data-lot-id="${lot.id}" data-status="${lot.status}"
           role="timer" aria-label="Time remaining">
        <div class="countdown-timer__segments">
          ${['d','h','m','s'].map((p, i) => `
            <div class="countdown-timer__seg"><span class="countdown-timer__num" data-part="${p}">--</span><span class="countdown-timer__lbl">${['days','hrs','min','sec'][i]}</span></div>
            ${i < 3 ? '<span class="countdown-timer__colon" aria-hidden="true">:</span>' : ''}
          `).join('')}
        </div>
      </div>` : (lot.startsAt ? `<p class="auction-card__timing">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        Starts ${formatDate(lot.startsAt)}</p>` : '');

    const ctaText = isLive ? 'Bid now' : (isClosed ? 'View results' : 'View lot');
    const ctaClass = isLive ? 'btn--primary' : 'btn--ghost';

    return `
      <article class="auction-card${isClosed ? ' auction-card--closed' : ''}" data-lot-id="${lot.id}">
        <a href="/pages/auction-room?lot=${lot.id}" class="auction-card__image-link" tabindex="-1" aria-hidden="true">
          <div class="auction-card__image-wrap">
            ${img}
            <div class="auction-card__badges">
              <span class="auction-type-badge auction-type-badge--sm auction-type--${lot.auctionType.toLowerCase().replace('_','-')}" title="${typeLabels[lot.auctionType] || lot.auctionType} auction">
                <span aria-hidden="true">${typeIcons[lot.auctionType] || '🏷'}</span> ${typeLabels[lot.auctionType] || lot.auctionType}
              </span>
              ${liveBadge}${streamBadge}
            </div>
          </div>
        </a>
        <div class="auction-card__body">
          <p class="auction-card__location">📍 ${esc(lot.propertyCity || lot.city || '')}</p>
          <h3 class="auction-card__title"><a href="/pages/auction-room?lot=${lot.id}">${esc(lot.title)}</a></h3>
          <div class="auction-card__price-row">
            <div>
              <span class="auction-card__price-label">${priceLabel}</span>
              <p class="auction-card__price"
           data-price="${Number(displayPrice || 0)}"
           data-price-currency="${document.body.dataset.currency || 'USD'}">${fmtI18n(displayPrice || 0)}</p>
            </div>
            <div class="auction-card__bids">
              <span class="auction-card__bid-count">${lot.totalBids || 0}</span>
              <span class="auction-card__bid-label">bids</span>
            </div>
          </div>
          ${countdownHtml}
          ${depositBadge}
          <a href="/pages/auction-room?lot=${lot.id}" class="btn ${ctaClass} btn--full auction-card__cta">${ctaText}</a>
        </div>
      </article>`;
  }

  function formatDate(iso) {
    if (!iso) return '';
    const i18n = window.StaySphere?.i18n;
    const tz   = i18n?.time?.timezone || 'UTC';
    const lang = i18n?.currentLanguage?.() || 'en';
    const langMap = { en:'en-US', fr:'fr-FR', es:'es-ES', de:'de-DE', pt:'pt-BR', ar:'ar-SA', zh:'zh-CN' };
    const bcp47 = langMap[lang] || 'en-US';
    try {
      return new Intl.DateTimeFormat(bcp47, {
        timeZone: tz, day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'
      }).format(new Date(iso));
    } catch (_) { return new Date(iso).toLocaleDateString(); }
  }

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ─── Fetch lots ──────────────────────────────────────────────────────────────
  async function fetchLots(page) {
    const grid = $('auction-grid');
    if (!grid) return;
    showSkeletons(grid);

    const useES = document.getElementById('auction-listing-page')?.dataset.useEs === 'true';
    const searchPath = useES ? '/api/v1/search/auctions' : '/api/v1/auctions';

    const params = new URLSearchParams({
      statuses: currentStatuses.join(','),
      page: page || 0,
      size: 24,
    });
    if (currentType) params.set('auctionType', currentType);

    // Collect filter form values
    const form = document.getElementById('auction-filter-form');
    if (form) {
      const fd = new FormData(form);
      for (const [k, v] of fd.entries()) if (v) params.set(k, v);
    }

    // Sort
    const sortEl = $('auction-sort');
    if (sortEl?.value) params.set('sortBy', sortEl.value);

    try {
      const res = await window.StaySphere.api(`${searchPath}?${params}`);
      const items = res.data?.content || res.data || [];
      const total = res.data?.totalElements || items.length;
      totalPages = res.data?.totalPages || 1;
      currentPage = page || 0;

      renderLots(grid, items, total);
    } catch (_) {
      renderEmpty();
    }
  }

  function showSkeletons(grid) {
    grid.innerHTML = Array(6).fill(0).map(() => `
      <div class="auction-card auction-card--skeleton" aria-hidden="true">
        <div class="auction-card__image-wrap skeleton-block"></div>
        <div class="auction-card__body">
          <div class="skeleton-line skeleton-line--short"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line skeleton-line--short"></div>
        </div>
      </div>`).join('');
  }

  function renderLots(grid, items, total) {
    clearTimers();
    const countEl = $('auction-result-count');
    if (countEl) countEl.textContent = `${total.toLocaleString()} lot${total !== 1 ? 's' : ''}`;
    const emptyEl = $('auction-empty');
    const pagNav = $('auction-pagination');

    if (!items.length) {
      grid.innerHTML = '';
      if (emptyEl) emptyEl.classList.remove('hidden');
      if (pagNav) pagNav.classList.add('hidden');
      return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');
    grid.innerHTML = items.map(renderAuctionCard).join('');
    bootstrapCountdowns(grid);
    updatePagination(pagNav);
  }

  function renderEmpty() {
    const grid = $('auction-grid');
    const emptyEl = $('auction-empty');
    if (grid) grid.innerHTML = '';
    if (emptyEl) emptyEl.classList.remove('hidden');
    const countEl = $('auction-result-count');
    if (countEl) countEl.textContent = '0 lots';
  }

  function updatePagination(nav) {
    if (!nav) return;
    if (totalPages <= 1) { nav.classList.add('hidden'); return; }
    nav.classList.remove('hidden');
    const prev = $('auction-pag-prev');
    const next = $('auction-pag-next');
    const info = $('auction-pag-info');
    if (prev) prev.disabled = currentPage === 0;
    if (next) next.disabled = currentPage >= totalPages - 1;
    if (info) info.textContent = `Page ${currentPage + 1} of ${totalPages}`;
  }

  // ─── Tabs ────────────────────────────────────────────────────────────────────
  function initTabs() {
    document.querySelectorAll('.auction-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.auction-tab').forEach(t => {
          t.classList.remove('auction-tab--active');
          t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('auction-tab--active');
        tab.setAttribute('aria-selected', 'true');
        currentStatuses = (tab.dataset.statuses || 'OPEN,EXTENDED').split(',');
        currentType = tab.dataset.type || null;
        currentPage = 0;
        fetchLots(0);
      });
    });
  }

  // ─── Filter form ─────────────────────────────────────────────────────────────
  function initFilters() {
    const form = document.getElementById('auction-filter-form');
    if (!form) return;
    form.addEventListener('submit', e => { e.preventDefault(); fetchLots(0); });
    const resetBtn = $('auction-filter-reset');
    if (resetBtn) resetBtn.addEventListener('click', () => { form.reset(); fetchLots(0); });
  }

  // ─── Sort ────────────────────────────────────────────────────────────────────
  function initSort() {
    const sortEl = $('auction-sort');
    if (sortEl) sortEl.addEventListener('change', () => fetchLots(0));
  }

  // ─── Pagination ──────────────────────────────────────────────────────────────
  function initPagination() {
    const prev = $('auction-pag-prev');
    const next = $('auction-pag-next');
    if (prev) prev.addEventListener('click', () => { fetchLots(currentPage - 1); scrollTo({ top: 0, behavior: 'smooth' }); });
    if (next) next.addEventListener('click', () => { fetchLots(currentPage + 1); scrollTo({ top: 0, behavior: 'smooth' }); });
  }

  // ─── Plugin ──────────────────────────────────────────────────────────────────
  const AuctionPlugin = {
    init(ss) {
      if (!$('auction-listing-page')) return;
      initTabs();
      initFilters();
      initSort();
      initPagination();
      fetchLots(0);
    },
    // Expose for auction-room to re-use countdown engine
    startCountdown,
    bootstrapCountdowns,
    renderAuctionCard,
  };

  if (window.StaySphere) window.StaySphere.extend('auction', AuctionPlugin);
  else document.addEventListener('DOMContentLoaded', () => {
    if (window.StaySphere) window.StaySphere.extend('auction', AuctionPlugin);
  });

  // Also expose globally for auction-room to use countdown
  window.AuctionCountdown = { startCountdown, bootstrapCountdowns };

})();
