/**
 * StaySphere AOS — plugin-search.js
 * Phase 1: Property browse & search
 * Handles the collection page: URL-driven filters, API calls,
 * live card rendering, pagination, sort, view toggle, filter sidebar.
 *
 * Registered as: StaySphere.extend('search', SearchPlugin)
 * Runs only on pages with #collection-page
 */
(function () {
  'use strict';

  const PAGE_SIZE = 24;

  // ─── State ─────────────────────────────────────────────────────────────────
  const state = {
    page: 0,
    totalPages: 0,
    totalElements: 0,
    loading: false,
    currentParams: {},
  };

  // ─── DOM refs ──────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);

  // ─── URL helpers ───────────────────────────────────────────────────────────
  function readURL() {
    const p = new URLSearchParams(window.location.search);
    const params = {};
    for (const [k, v] of p.entries()) {
      if (v) params[k] = v;
    }
    return params;
  }

  function buildURL(params, page) {
    const p = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v) p.set(k, v); });
    if (page > 0) p.set('page', page);
    const qs = p.toString();
    return window.location.pathname + (qs ? '?' + qs : '');
  }

  function pushURL(params, page) {
    const url = buildURL(params, page || 0);
    history.pushState({ params, page }, '', url);
  }

  // ─── API → Search params ────────────────────────────────────────────────────
  function paramsToAPI(params, page) {
    const api = { page: page || 0, size: PAGE_SIZE };
    const map = {
      city: 'city', checkIn: 'checkIn', checkOut: 'checkOut',
      guests: 'minGuests', bedrooms: 'minBedrooms',
      minPrice: 'minPrice', maxPrice: 'maxPrice',
      petFriendly: 'petFriendly', hasPool: 'hasPool',
      hasWifi: 'hasWifi', hasParking: 'hasParking',
      hasBraai: 'hasBraai', selfCatering: 'selfCatering',
      propertyType: 'propertyType', minRating: 'minRating',
      sortBy: 'sortBy',
    };
    Object.entries(map).forEach(([url, api_key]) => {
      if (params[url]) api[api_key] = params[url];
    });
    return api;
  }

  // ─── Fetch ─────────────────────────────────────────────────────────────────
  async function fetchProperties(params, page) {
    if (state.loading) return;
    state.loading = true;
    showSkeleton(true);

    const apiParams = paramsToAPI(params, page);

    // AI query mode
    if (params.aiQuery) {
      return fetchAI(params.aiQuery, params, page);
    }

    const qs = new URLSearchParams(apiParams).toString();
    try {
      const res = await window.StaySphere.api('/api/v1/properties/search?' + qs);
      if (res.success) {
        renderResults(res.data);
      } else {
        showEmpty();
      }
    } catch (err) {
      console.warn('[StaySphere search] API error, falling back:', err.message);
      renderShopifyFallback();
    } finally {
      state.loading = false;
      showSkeleton(false);
    }
  }

  async function fetchAI(query, params, page) {
    try {
      const res = await window.StaySphere.api('/api/v1/ai/search-intent', {
        method: 'POST',
        body: JSON.stringify({ query }),
      });
      if (res.success && res.data) {
        const merged = { ...params, ...res.data, aiQuery: query };
        return fetchProperties(merged, page);
      }
    } catch (_) {}
    // fallback: just use query as city
    const merged = { ...params, city: query };
    delete merged.aiQuery;
    return fetchProperties(merged, page);
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  function renderResults(data) {
    const grid = $('collection-cards');
    const empty = $('collection-empty');
    const countEl = $('result-count');
    const pagNav = $('collection-pagination');
    if (!grid) return;

    const items = data.content || [];
    state.totalPages = data.totalPages || 0;
    state.totalElements = data.totalElements || 0;
    state.page = data.pageable?.pageNumber || 0;

    // Count
    if (countEl) {
      countEl.innerHTML = state.totalElements === 0
        ? 'No stays found'
        : `${state.totalElements.toLocaleString()} stay${state.totalElements !== 1 ? 's' : ''}`;
    }

    if (items.length === 0) {
      grid.classList.add('hidden');
      if (empty) empty.classList.remove('hidden');
      if (pagNav) pagNav.classList.add('hidden');
      return;
    }

    if (empty) empty.classList.add('hidden');
    grid.classList.remove('hidden');
    grid.innerHTML = items.map(p => window.StaySphere.renderPropertyCard(p)).join('');

    // Init wishlist buttons in new cards
    initWishlistButtons(grid);

    // Pagination
    updatePagination();
  }

  function renderShopifyFallback() {
    // Show whatever Shopify rendered server-side
    const skeleton = $('collection-skeleton');
    const cards = $('collection-cards');
    const countEl = $('result-count');
    if (skeleton) skeleton.remove();
    if (cards) cards.classList.remove('hidden');
    if (countEl) countEl.textContent = 'Showing cached results';
    // render noscript content as fallback message
    window.StaySphere.toast(
      'Showing sample properties — API not connected yet', 'warning', 7000
    );
    // Use mock data
    renderResults(getMockData());
  }

  function getMockData() {
    // Inline mock if API is offline
    const mock = [
      { id: 'm1', title: 'Oakwood Residences', location: { city: 'London' }, pricing: { currentDynamicRate: 850000 }, bedrooms: 3, maxGuests: 0, averageRating: 4.9, totalReviews: 42, trustScore: 92, imageUrls: [] },
      { id: 'm2', title: 'The Commercial Quarter', location: { city: 'New York' }, pricing: { currentDynamicRate: 1200000 }, bedrooms: 0, maxGuests: 0, averageRating: 4.7, totalReviews: 28, trustScore: 88, imageUrls: [] },
      { id: 'm3', title: 'Riverside Business Park', location: { city: 'Sydney' }, pricing: { currentDynamicRate: 475000 }, bedrooms: 0, maxGuests: 0, averageRating: 4.8, totalReviews: 61, trustScore: 95, imageUrls: [] },
      { id: 'm4', title: 'Harbour View Apartments', location: { city: 'Cape Town' }, pricing: { currentDynamicRate: 620000 }, bedrooms: 2, maxGuests: 0, averageRating: 4.6, totalReviews: 15, trustScore: 75, imageUrls: [] },
      { id: 'm5', title: 'The Merchant Centre', location: { city: 'Dubai' }, pricing: { currentDynamicRate: 980000 }, bedrooms: 0, maxGuests: 0, averageRating: 4.5, totalReviews: 19, trustScore: 80, imageUrls: [] },
      { id: 'm6', title: 'Estate at Millfield', location: { city: 'Singapore' }, pricing: { currentDynamicRate: 320000 }, bedrooms: 4, maxGuests: 0, averageRating: 4.4, totalReviews: 8, trustScore: 70, imageUrls: [] },
    ];
    return { content: mock, totalElements: mock.length, totalPages: 1, pageable: { pageNumber: 0 } };
  }

  function showSkeleton(show) {
    const sk = $('collection-skeleton');
    const cards = $('collection-cards');
    if (sk) sk.classList.toggle('hidden', !show);
    if (cards && show) cards.classList.add('hidden');
  }

  function showEmpty() {
    showSkeleton(false);
    const empty = $('collection-empty');
    const cards = $('collection-cards');
    const countEl = $('result-count');
    if (empty) empty.classList.remove('hidden');
    if (cards) cards.classList.add('hidden');
    if (countEl) countEl.textContent = 'No stays found';
  }

  // ─── Pagination ────────────────────────────────────────────────────────────
  function updatePagination() {
    const nav = $('collection-pagination');
    const prev = $('pag-prev');
    const next = $('pag-next');
    const info = $('pag-info');
    if (!nav) return;

    if (state.totalPages <= 1) {
      nav.classList.add('hidden');
      return;
    }
    nav.classList.remove('hidden');
    if (prev) prev.disabled = state.page === 0;
    if (next) next.disabled = state.page >= state.totalPages - 1;
    if (info) info.textContent = `Page ${state.page + 1} of ${state.totalPages}`;
  }

  // ─── Filter form → URL ─────────────────────────────────────────────────────
  function collectFilterParams() {
    const form = document.getElementById('filter-form');
    if (!form) return {};
    const data = new FormData(form);
    const params = {};
    for (const [k, v] of data.entries()) {
      if (v) params[k] = v;
    }
    return params;
  }

  function applyFilters() {
    const params = collectFilterParams();
    const sortEl = $('sort-select');
    if (sortEl && sortEl.value) params.sortBy = sortEl.value;
    state.currentParams = params;
    pushURL(params, 0);
    fetchProperties(params, 0);
  }

  function removeFilter(key) {
    const params = { ...state.currentParams };
    if (key === 'price') {
      delete params.minPrice;
      delete params.maxPrice;
    } else {
      delete params[key];
    }
    state.currentParams = params;
    pushURL(params, 0);
    syncFormToParams(params);
    fetchProperties(params, 0);
  }

  function clearAllFilters() {
    state.currentParams = {};
    pushURL({}, 0);
    const form = document.getElementById('filter-form');
    if (form) form.reset();
    fetchProperties({}, 0);
  }

  function syncFormToParams(params) {
    const form = document.getElementById('filter-form');
    if (!form) return;
    ['city', 'checkIn', 'checkOut', 'guests', 'minPrice', 'maxPrice', 'bedrooms', 'minRating'].forEach(k => {
      const el = form.querySelector(`[name="${k}"]`);
      if (el) el.value = params[k] || '';
    });
    ['petFriendly', 'hasPool', 'hasWifi', 'hasParking', 'hasBraai', 'selfCatering'].forEach(k => {
      const el = form.querySelector(`[name="${k}"]`);
      if (el) el.checked = params[k] === 'true';
    });
  }

  // ─── Filter sidebar ────────────────────────────────────────────────────────
  function initFilterPanel() {
    const toggle = $('filter-toggle');
    const panel = $('filter-panel');
    const closeBtn = $('filter-panel-close');

    if (!toggle || !panel) return;

    function openPanel() {
      panel.hidden = false;
      panel.classList.add('is-open');
      toggle.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
    }
    function closePanel() {
      panel.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
      // delay hidden so CSS transition plays
      setTimeout(() => { panel.hidden = true; }, 280);
    }

    toggle.addEventListener('click', () =>
      panel.classList.contains('is-open') ? closePanel() : openPanel()
    );
    if (closeBtn) closeBtn.addEventListener('click', closePanel);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && panel.classList.contains('is-open')) closePanel();
    });

    // On desktop, show sidebar immediately
    if (window.innerWidth >= 1024) {
      panel.hidden = false;
    }
  }

  // ─── Filter pill buttons (bedrooms, rating) ─────────────────────────────────
  function initFilterPills() {
    document.querySelectorAll('.filter-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const group = btn.dataset.filter;
        const val = btn.dataset.value;
        const hiddenInput = document.querySelector(`[name="${group}"]`);

        // Toggle off if already active
        const isActive = btn.classList.contains('filter-pill--active');
        document.querySelectorAll(`.filter-pill[data-filter="${group}"]`)
          .forEach(b => b.classList.remove('filter-pill--active'));

        if (!isActive) {
          btn.classList.add('filter-pill--active');
          if (hiddenInput) hiddenInput.value = val;
        } else {
          if (hiddenInput) hiddenInput.value = '';
        }
      });
    });
  }

  // ─── Active filter chips ──────────────────────────────────────────────────
  function initFilterChips() {
    document.querySelectorAll('.filter-chip[data-remove]').forEach(chip => {
      chip.addEventListener('click', () => removeFilter(chip.dataset.remove));
    });
    const clearBtn = $('clear-all-filters');
    const clearBtn2 = $('clear-all-filters-2');
    if (clearBtn) clearBtn.addEventListener('click', clearAllFilters);
    if (clearBtn2) clearBtn2.addEventListener('click', clearAllFilters);
  }

  // ─── Sort ──────────────────────────────────────────────────────────────────
  function initSort() {
    const sortEl = $('sort-select');
    if (!sortEl) return;
    sortEl.addEventListener('change', () => {
      state.currentParams.sortBy = sortEl.value;
      pushURL(state.currentParams, 0);
      fetchProperties(state.currentParams, 0);
    });
  }

  // ─── View toggle ───────────────────────────────────────────────────────────
  function initViewToggle() {
    const gridBtn = $('view-grid');
    const listBtn = $('view-list');
    const grid = $('collection-grid');
    if (!gridBtn || !listBtn || !grid) return;

    gridBtn.addEventListener('click', () => {
      grid.classList.remove('property-grid--list');
      gridBtn.classList.add('active'); gridBtn.setAttribute('aria-pressed', 'true');
      listBtn.classList.remove('active'); listBtn.setAttribute('aria-pressed', 'false');
    });
    listBtn.addEventListener('click', () => {
      grid.classList.add('property-grid--list');
      listBtn.classList.add('active'); listBtn.setAttribute('aria-pressed', 'true');
      gridBtn.classList.remove('active'); gridBtn.setAttribute('aria-pressed', 'false');
    });
  }

  // ─── AI search bar ────────────────────────────────────────────────────────
  function initAIBar() {
    const input = $('collection-ai-input');
    const btn = $('collection-ai-btn');
    const clearBtn = $('collection-ai-clear');
    if (!input || !btn) return;

    btn.addEventListener('click', () => {
      const q = input.value.trim();
      if (!q) return;
      state.currentParams = { ...state.currentParams, aiQuery: q };
      pushURL(state.currentParams, 0);
      fetchProperties(state.currentParams, 0);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') btn.click();
    });
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        input.value = '';
        delete state.currentParams.aiQuery;
        pushURL(state.currentParams, 0);
        fetchProperties(state.currentParams, 0);
      });
    }
  }

  // ─── Pagination buttons ───────────────────────────────────────────────────
  function initPaginationButtons() {
    const prev = $('pag-prev');
    const next = $('pag-next');
    if (prev) {
      prev.addEventListener('click', () => {
        if (state.page > 0) {
          const p = state.page - 1;
          pushURL(state.currentParams, p);
          fetchProperties(state.currentParams, p);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    }
    if (next) {
      next.addEventListener('click', () => {
        if (state.page < state.totalPages - 1) {
          const p = state.page + 1;
          pushURL(state.currentParams, p);
          fetchProperties(state.currentParams, p);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    }
  }

  // ─── Browser back/forward ─────────────────────────────────────────────────
  function initPopstate() {
    window.addEventListener('popstate', e => {
      const params = e.state?.params || readURL();
      const page = e.state?.page || 0;
      state.currentParams = params;
      syncFormToParams(params);
      fetchProperties(params, page);
    });
  }

  // ─── Wishlist buttons in cards ────────────────────────────────────────────
  function initWishlistButtons(root) {
    (root || document).querySelectorAll('.property-card__wishlist').forEach(btn => {
      const id = btn.dataset.propertyId;
      if (!id) return;
      const saved = window.StaySphere.wishlist.has(id);
      btn.setAttribute('aria-pressed', saved);
      if (saved) btn.querySelector('svg')?.setAttribute('fill', 'currentColor');

      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const added = window.StaySphere.wishlist.toggle(id);
        btn.setAttribute('aria-pressed', added);
        btn.querySelector('svg')?.setAttribute('fill', added ? 'currentColor' : 'none');
        window.StaySphere.toast(added ? 'Saved to wishlist' : 'Removed from wishlist');
      });
    });
  }

  // ─── Filter form submit ────────────────────────────────────────────────────
  function initFilterForm() {
    const form = document.getElementById('filter-form');
    if (!form) return;

    form.addEventListener('submit', e => {
      e.preventDefault();
      applyFilters();
      // Close panel on mobile
      if (window.innerWidth < 1024) {
        const panel = $('filter-panel');
        const toggle = $('filter-toggle');
        if (panel) { panel.classList.remove('is-open'); panel.hidden = true; }
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      }
    });

    const resetBtn = $('reset-filters-btn');
    if (resetBtn) resetBtn.addEventListener('click', clearAllFilters);

    // Date validation
    const checkIn = document.getElementById('filter-checkin');
    const checkOut = document.getElementById('filter-checkout');
    if (checkIn && checkOut) {
      checkIn.addEventListener('change', () => {
        if (checkIn.value) {
          checkOut.min = checkIn.value;
          if (checkOut.value && checkOut.value <= checkIn.value) checkOut.value = '';
        }
      });
    }
  }

  // ─── Plugin entry point ───────────────────────────────────────────────────
  const SearchPlugin = {
    init(ss) {
      // Only run on the collection page
      if (!$('collection-page')) return;

      const urlParams = readURL();
      state.currentParams = urlParams;

      initFilterPanel();
      initFilterPills();
      initFilterChips();
      initSort();
      initViewToggle();
      initAIBar();
      initPaginationButtons();
      initPopstate();
      initFilterForm();
      initWishlistButtons();

      // Sync form fields from URL
      syncFormToParams(urlParams);

      // Initial load
      fetchProperties(urlParams, urlParams.page ? parseInt(urlParams.page) : 0);
    },
  };

  // Register once StaySphere SDK is ready
  if (window.StaySphere) {
    window.StaySphere.extend('search', SearchPlugin);
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (window.StaySphere) window.StaySphere.extend('search', SearchPlugin);
    });
  }

})();
