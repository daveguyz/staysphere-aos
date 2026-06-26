/**
 * StaySphere AOS — theme.js
 * Self-contained theme SDK.
 * All API calls go through StaySphere.api().
 * Feature flags guard every integration so the theme works
 * with zero backend services deployed (mock mode).
 *
 * Namespace: window.StaySphere
 */
(function () {
  'use strict';

  // ──────────────────────────────────────────────
  // 1. READ THEME CONFIGURATION FROM <body>
  // ──────────────────────────────────────────────
  const body = document.body;

  const CONFIG = {
    apiBase: body.dataset.api || '',
    currency: body.dataset.currency || 'USD',
    currencySymbol: body.dataset.currencySymbol || '$',
    mockMode: body.dataset.mock === 'true',
    customerId: body.dataset.customerId || null,
    customerEmail: body.dataset.customerEmail || null,
    features: {
      bookings:      body.dataset.featureBookings === 'true',
      payments:      body.dataset.featurePayments === 'true',
      ai:            body.dataset.featureAi === 'true',
      messaging:     body.dataset.featureMessaging === 'true',
      reviews:       body.dataset.featureReviews === 'true',
      hostDashboard: body.dataset.featureHostDashboard === 'true',
      dynamicPricing:body.dataset.featurePricing === 'true',
      tripBuilder:   body.dataset.featureTripBuilder === 'true',
    },
  };

  // ──────────────────────────────────────────────
  // 2. TOKEN STORAGE (JWT)
  // ──────────────────────────────────────────────
  const Auth = {
    getToken() { return localStorage.getItem('ss_token'); },
    setToken(t) { localStorage.setItem('ss_token', t); },
    setRefresh(t) { localStorage.setItem('ss_refresh', t); },
    getRefresh() { return localStorage.getItem('ss_refresh'); },
    clear() { localStorage.removeItem('ss_token'); localStorage.removeItem('ss_refresh'); },
    headers() {
      const t = Auth.getToken();
      return t ? { Authorization: `Bearer ${t}` } : {};
    },
  };

  // ──────────────────────────────────────────────
  // 3. API HELPER — respects mock mode + feature flags
  // ──────────────────────────────────────────────
  async function api(path, options = {}) {
    if (CONFIG.mockMode && !CONFIG.apiBase) {
      return Mock.handle(path, options);
    }
    const url = CONFIG.apiBase + path;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...Auth.headers(),
        ...(options.headers || {}),
      },
    });
    if (res.status === 401) {
      const refreshed = await attemptTokenRefresh();
      if (refreshed) {
        return api(path, options); // retry once
      }
      Auth.clear();
      window.location.href = '/account/login?return_to=' + encodeURIComponent(window.location.pathname);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `API error ${res.status}`);
    return data;
  }

  async function attemptTokenRefresh() {
    const refresh = Auth.getRefresh();
    if (!refresh) return false;
    try {
      const res = await fetch(CONFIG.apiBase + '/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refresh }),
      });
      const data = await res.json();
      if (data.success && data.data?.accessToken) {
        Auth.setToken(data.data.accessToken);
        Auth.setRefresh(data.data.refreshToken);
        return true;
      }
    } catch (_) {}
    return false;
  }

  // ──────────────────────────────────────────────
  // 4. MOCK DATA — used when API is offline
  // ──────────────────────────────────────────────
  const Mock = {
    handle(path, opts) {
      if (path.includes('/properties/search') || path.includes('/properties?')) return this.properties();
      if (path.includes('/ai/concierge')) return this.aiReply(opts);
      return Promise.resolve({ success: true, data: null });
    },
    properties() {
      return Promise.resolve({
        success: true,
        data: {
          content: [1,2,3,4,5,6].map(i => ({
            id: `mock-${i}`,
            title: ['Oakwood Residences','The Commercial Quarter','Riverside Business Park',
                    'Harbour View Apartments','The Merchant Centre','Estate at Millfield'][i-1],
            location: { city: ['London','New York','Sydney','Cape Town','Dubai','Singapore'][i-1] },
            pricing: { currentDynamicRate: [850000,1200000,475000,620000,980000,320000][i-1], currency: 'USD' },
            bedrooms: [2,3,4,1,3,2][i-1],
            maxGuests: [4,6,8,2,6,4][i-1],
            averageRating: [4.9,4.7,4.8,4.6,4.5,4.4][i-1],
            totalReviews: [42,28,61,15,19,8][i-1],
            trustScore: [92,88,95,75,80,70][i-1],
            hasPool: i % 3 === 0,
            petFriendly: i % 2 === 0,
            imageUrls: [],
            status: 'ACTIVE',
          })),
          totalElements: 6, page: 0, size: 6,
        },
      });
    },
    aiReply({ body } = {}) {
      const msg = body ? JSON.parse(body).query : '';
      return Promise.resolve({
        success: true,
        data: {
          message: `[Mock mode] I heard: "${msg}". Once your AI service is running, I'll search live listings for you! 🦒`,
          properties: [],
        },
      });
    },
  };

  // ──────────────────────────────────────────────
  // 5. TOAST NOTIFICATIONS
  // ──────────────────────────────────────────────
  function toast(message, type = 'default', duration = 4000) {
    const container = document.getElementById('global-toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast${type !== 'default' ? ` toast--${type}` : ''}`;
    el.textContent = message;
    el.setAttribute('role', 'status');
    container.appendChild(el);
    setTimeout(() => el.remove(), duration);
  }

  // ──────────────────────────────────────────────
  // 6. MODAL
  // ──────────────────────────────────────────────
  const Modal = {
    open(html, title = '') {
      const backdrop = document.getElementById('modal-backdrop');
      const container = document.getElementById('modal-container');
      const content = document.getElementById('modal-content');
      if (!container) return;
      if (title) {
        let h = container.querySelector('#modal-title');
        if (!h) { h = document.createElement('h2'); h.id = 'modal-title'; container.prepend(h); }
        h.textContent = title;
      }
      content.innerHTML = html;
      backdrop.classList.remove('hidden');
      container.classList.remove('hidden');
      container.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      container.querySelector('[autofocus]')?.focus();
    },
    close() {
      const backdrop = document.getElementById('modal-backdrop');
      const container = document.getElementById('modal-container');
      if (!container) return;
      backdrop.classList.add('hidden');
      container.classList.add('hidden');
      container.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    },
  };

  // ──────────────────────────────────────────────
  // 7. PROPERTY CARD RENDERER (JS-built version)
  // ──────────────────────────────────────────────
  function renderPropertyCard(p) {
    const ratio = getComputedStyle(document.documentElement).getPropertyValue('--card-ratio').trim() || '3/2';
    const currSym = CONFIG.currencySymbol;
    const rate = p.pricing?.currentDynamicRate ?? p.pricing?.baseRatePerNight ?? '—';
    const trusted = (p.trustScore ?? 0) >= 80
      ? `<span class="property-badge property-badge--trusted">✓ Trusted</span>` : '';
    const rating = p.averageRating > 0
      ? `<span class="property-card__stars">⭐ ${p.averageRating.toFixed(1)}</span><span class="property-card__review-count">(${p.totalReviews ?? 0})</span>`
      : `<span class="property-card__new">New listing</span>`;
    const img = p.imageUrls?.[0]
      ? `<img src="${p.imageUrls[0]}" alt="${esc(p.title)}" class="property-card__image" loading="lazy" width="600" height="400">`
      : `<div class="property-card__image-placeholder" aria-hidden="true"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></div>`;

    return `
      <article class="property-card" data-property-id="${p.id}">
        <a href="/products/${p.id}" class="property-card__image-link" tabindex="-1" aria-hidden="true">
          <div class="property-card__image-wrap" style="aspect-ratio:${ratio}">
            ${img}
            <div class="property-card__badges">${trusted}</div>
            <button class="property-card__wishlist" data-property-id="${p.id}"
                    aria-label="Save ${esc(p.title)} to wishlist" aria-pressed="false">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            </button>
          </div>
        </a>
        <div class="property-card__body">
          <p class="property-card__location">📍 ${p.location?.city ?? ''}</p>
          <h3 class="property-card__title"><a href="/products/${p.id}">${esc(p.title)}</a></h3>
          <div class="property-card__meta">
            ${p.bedrooms ? `<span class="property-card__meta-item">🛏 ${p.bedrooms} bed${p.bedrooms !== 1 ? 's' : ''}</span>` : ''}
            ${p.maxGuests ? `<span class="property-card__meta-item">👥 Up to ${p.maxGuests}</span>` : ''}
          </div>
          <div class="property-card__rating">${rating}</div>
          <div class="property-card__price">
            <strong class="property-card__price-amount">${currSym}${rate}</strong>
            <span class="property-card__price-unit">/ night</span>
          </div>
        </div>
      </article>`;
  }

  function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  // ──────────────────────────────────────────────
  // 8. FEATURED PROPERTIES LOADER
  // ──────────────────────────────────────────────
  async function loadFeaturedProperties() {
    const grid = document.getElementById('featured-properties-grid');
    if (!grid) return;
    const params = JSON.parse(grid.dataset.params || '{}');
    const qs = new URLSearchParams(params).toString();
    try {
      const res = await api(`/api/v1/properties/search?${qs}`);
      if (res.success && res.data?.content?.length > 0) {
        grid.innerHTML = res.data.content.map(renderPropertyCard).join('');
        initWishlistButtons(grid);
        const fallback = document.getElementById('featured-shopify-fallback');
        if (fallback) fallback.hidden = true;
      } else {
        showShopifyFallback(grid);
      }
    } catch (_) {
      showShopifyFallback(grid);
      if (CONFIG.mockMode) {
        toast('Showing sample properties — API not yet connected', 'warning', 6000);
      }
    }
  }

  function showShopifyFallback(grid) {
    grid.innerHTML = '';
    const fallback = document.getElementById('featured-shopify-fallback');
    if (fallback) fallback.hidden = false;
  }

  // ──────────────────────────────────────────────
  // 9. HERO SEARCH
  // ──────────────────────────────────────────────
  function initHeroSearch() {
    const btn = document.getElementById('hero-search-btn');
    if (btn) {
      btn.addEventListener('click', () => {
        const city = document.getElementById('hero-destination')?.value.trim();
        const checkIn = document.getElementById('hero-checkin')?.value;
        const checkOut = document.getElementById('hero-checkout')?.value;
        const guests = document.getElementById('hero-guests')?.value;
        if (!city && !checkIn) { toast('Enter a destination or dates to search', 'warning'); return; }
        const p = new URLSearchParams();
        if (city) p.set('city', city);
        if (checkIn) p.set('checkIn', checkIn);
        if (checkOut) p.set('checkOut', checkOut);
        if (guests) p.set('guests', guests);
        window.location.href = '/collections/all?' + p.toString();
      });
    }

    // Checkout date must be after checkin
    const checkIn = document.getElementById('hero-checkin');
    const checkOut = document.getElementById('hero-checkout');
    if (checkIn && checkOut) {
      checkIn.addEventListener('change', () => {
        if (checkIn.value) {
          checkOut.min = checkIn.value;
          if (checkOut.value && checkOut.value <= checkIn.value) checkOut.value = '';
        }
      });
    }

    // AI bar
    const aiBtn = document.getElementById('hero-ai-btn');
    if (aiBtn && CONFIG.features.ai) {
      aiBtn.addEventListener('click', () => {
        const q = document.getElementById('hero-ai-input')?.value.trim();
        if (q) window.location.href = '/collections/all?aiQuery=' + encodeURIComponent(q);
      });
    } else if (aiBtn) {
      document.querySelector('.hero-search__ai-bar')?.remove();
    }

    // Quick filter pills
    document.querySelectorAll('.hero__pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const type = pill.dataset.filterType;
        const val = pill.dataset.filterValue;
        const p = new URLSearchParams();
        p.set(type, val);
        window.location.href = '/collections/all?' + p.toString();
      });
    });
  }

  // ──────────────────────────────────────────────
  // 10. HEADER — search, nav, mobile menu
  // ──────────────────────────────────────────────
  function initHeader() {
    // Search toggle
    const searchToggle = document.getElementById('search-toggle-btn');
    const searchClose = document.getElementById('search-close-btn');
    const searchBar = document.getElementById('header-search');
    const searchInput = document.getElementById('header-search-input');

    if (searchToggle && searchBar) {
      searchToggle.addEventListener('click', () => {
        const open = !searchBar.classList.contains('is-open');
        searchBar.classList.toggle('is-open', open);
        searchToggle.setAttribute('aria-expanded', open);
        searchBar.setAttribute('aria-hidden', !open);
        if (open) { searchInput?.focus(); }
      });
      searchClose?.addEventListener('click', () => {
        searchBar.classList.remove('is-open');
        searchToggle.setAttribute('aria-expanded', 'false');
        searchBar.setAttribute('aria-hidden', 'true');
      });
      searchInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter' && searchInput.value.trim()) {
          window.location.href = '/collections/all?city=' + encodeURIComponent(searchInput.value.trim());
        }
      });
    }

    // Mobile menu
    const mobileToggle = document.getElementById('mobile-menu-toggle');
    const mobileMenu = document.getElementById('mobile-menu');
    if (mobileToggle && mobileMenu) {
      mobileToggle.addEventListener('click', () => {
        const open = !mobileMenu.classList.contains('is-open');
        mobileMenu.classList.toggle('is-open', open);
        mobileToggle.setAttribute('aria-expanded', open);
        mobileMenu.setAttribute('aria-hidden', !open);
        mobileToggle.querySelector('.icon-menu')?.classList.toggle('hidden', open);
        mobileToggle.querySelector('.icon-close')?.classList.toggle('hidden', !open);
      });
    }

    // Nav dropdowns — keyboard accessible
    document.querySelectorAll('.nav-item--has-dropdown .nav-link--parent').forEach(btn => {
      btn.addEventListener('click', () => {
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', !expanded);
      });
      btn.addEventListener('keydown', e => {
        if (e.key === 'Escape') { btn.setAttribute('aria-expanded', 'false'); btn.focus(); }
      });
    });
  }

  // ──────────────────────────────────────────────
  // 11. AUTH FORMS
  // ──────────────────────────────────────────────
  function initAuthForms() {
    // Login
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', async e => {
        e.preventDefault();
        const btn = document.getElementById('login-btn');
        const errEl = document.getElementById('auth-error');
        setLoading(btn, true);
        errEl.classList.add('hidden');
        try {
          const res = await api('/api/v1/auth/login', {
            method: 'POST',
            body: JSON.stringify({
              email: loginForm.querySelector('#login-email').value,
              password: loginForm.querySelector('#login-password').value,
            }),
          });
          if (res.success) {
            Auth.setToken(res.data.accessToken);
            Auth.setRefresh(res.data.refreshToken);
            const redirect = new URLSearchParams(window.location.search).get('return_to') || '/account';
            window.location.href = redirect;
          }
        } catch (err) {
          errEl.textContent = err.message || 'Sign in failed. Check your email and password.';
          errEl.classList.remove('hidden');
        } finally { setLoading(btn, false); }
      });
    }

    // Register
    const regForm = document.getElementById('register-form');
    if (regForm) {
      // Password strength
      const pwInput = document.getElementById('reg-password');
      const strengthEl = document.getElementById('password-strength');
      if (pwInput && strengthEl) {
        pwInput.addEventListener('input', () => {
          const v = pwInput.value;
          const s = v.length >= 12 && /[A-Z]/.test(v) && /[0-9]/.test(v) && /[^A-Za-z0-9]/.test(v) ? 'Strong'
                  : v.length >= 8 ? 'Good' : v.length >= 5 ? 'Weak' : '';
          strengthEl.textContent = s ? `Password strength: ${s}` : '';
          strengthEl.style.color = s === 'Strong' ? '#10b981' : s === 'Good' ? '#f59e0b' : '#ef4444';
        });
      }

      regForm.addEventListener('submit', async e => {
        e.preventDefault();
        const btn = document.getElementById('register-btn');
        const errEl = document.getElementById('auth-error');
        setLoading(btn, true);
        errEl?.classList.add('hidden');
        const isHost = document.getElementById('reg-host')?.checked;
        try {
          const res = await api('/api/v1/auth/register', {
            method: 'POST',
            body: JSON.stringify({
              email: document.getElementById('reg-email').value,
              password: document.getElementById('reg-password').value,
              firstName: document.getElementById('reg-first-name').value,
              lastName: document.getElementById('reg-last-name').value,
              phone: document.getElementById('reg-phone')?.value || null,
              roles: isHost ? ['GUEST', 'HOST'] : ['GUEST'],
            }),
          });
          if (res.success) {
            toast('Account created! Check your email to verify.', 'success', 8000);
            setTimeout(() => { window.location.href = '/account/login'; }, 3000);
          }
        } catch (err) {
          if (errEl) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
        } finally { setLoading(btn, false); }
      });
    }

    // Toggle password visibility
    document.querySelectorAll('.form-field__toggle-password').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = btn.previousElementSibling;
        if (input) input.type = input.type === 'password' ? 'text' : 'password';
      });
    });
  }

  function setLoading(btn, loading) {
    if (!btn) return;
    btn.disabled = loading;
    btn.querySelector('.btn-label')?.classList.toggle('hidden', loading);
    btn.querySelector('.btn-spinner')?.classList.toggle('hidden', !loading);
  }

  // ──────────────────────────────────────────────
  // 12. AI CONCIERGE
  // ──────────────────────────────────────────────
  function initConcierge() {
    const fab = document.getElementById('concierge-fab');
    const widget = document.getElementById('concierge-widget');
    const closeBtn = widget?.querySelector('.concierge-widget__close');
    const form = document.getElementById('concierge-form');
    const input = document.getElementById('concierge-input');
    const messages = document.getElementById('concierge-messages');
    if (!fab || !widget) return;

    const greeting = widget.dataset.greeting;
    let open = false;
    const sessionId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);

    function addMessage(text, role) {
      const el = document.createElement('div');
      el.className = `msg-bubble msg-bubble--${role}`;
      el.textContent = text;
      messages.appendChild(el);
      messages.scrollTop = messages.scrollHeight;
      return el;
    }

    function addPropertyCards(properties) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
      properties.slice(0, 3).forEach(p => {
        const a = document.createElement('a');
        a.href = `/products/${p.id}`;
        a.style.cssText = 'display:block;background:var(--color-surface);border-radius:var(--radius);padding:10px 12px;text-decoration:none;color:var(--color-text);font-size:0.875rem;border:1px solid var(--color-border);';
        const rate = p.pricing?.currentDynamicRate ?? '—';
        a.innerHTML = `<strong>${esc(p.title)}</strong><span style="display:block;color:var(--color-text-muted);margin-top:2px">📍 ${p.location?.city ?? ''} · 🛏 ${p.bedrooms ?? '?'} beds · <strong style="color:var(--color-primary)">${CONFIG.currencySymbol}${rate}/night</strong>${p.averageRating ? ` · ⭐ ${p.averageRating.toFixed(1)}` : ''}</span>`;
        wrap.appendChild(a);
      });
      messages.appendChild(wrap);
      messages.scrollTop = messages.scrollHeight;
    }

    function showTyping() {
      const el = document.createElement('div');
      el.className = 'msg-typing';
      el.innerHTML = '<span class="msg-typing__dot"></span><span class="msg-typing__dot"></span><span class="msg-typing__dot"></span>';
      messages.appendChild(el);
      messages.scrollTop = messages.scrollHeight;
      return el;
    }

    // Greet on first open
    let greeted = false;
    function openWidget() {
      open = true;
      widget.classList.remove('hidden');
      fab.setAttribute('aria-expanded', 'true');
      if (!greeted) {
        addMessage(greeting, 'ai');
        greeted = true;
      }
      input?.focus();
    }

    fab.addEventListener('click', openWidget);
    closeBtn?.addEventListener('click', () => {
      open = false;
      widget.classList.add('hidden');
      fab.setAttribute('aria-expanded', 'false');
    });

    form?.addEventListener('submit', async e => {
      e.preventDefault();
      const query = input.value.trim();
      if (!query) return;
      addMessage(query, 'user');
      input.value = '';
      input.disabled = true;
      const typing = showTyping();
      try {
        const endpoint = CONFIG.customerId
          ? '/api/v1/ai/concierge'
          : '/api/v1/ai/concierge/public';
        const res = await api(endpoint, {
          method: 'POST',
          body: JSON.stringify({ query, sessionId }),
        });
        typing.remove();
        if (res.success) {
          addMessage(res.data.message, 'ai');
          if (res.data.properties?.length) addPropertyCards(res.data.properties);
        }
      } catch (_) {
        typing.remove();
        addMessage('Sorry, I had trouble with that. Please try again.', 'ai');
      } finally { input.disabled = false; input.focus(); }
    });

    // Open from hero AI btn
    document.getElementById('hero-ai-btn')?.addEventListener('click', () => {
      const q = document.getElementById('hero-ai-input')?.value.trim();
      openWidget();
      if (q && input) { input.value = q; form?.dispatchEvent(new Event('submit')); }
    });
  }

  // ──────────────────────────────────────────────
  // 13. NOTIFICATIONS
  // ──────────────────────────────────────────────
  async function initNotifications() {
    if (!CONFIG.customerId || !CONFIG.features.messaging) return;
    const bellBtn = document.getElementById('notification-bell-btn');
    const dropdown = document.getElementById('notification-dropdown');
    const badge = document.getElementById('notification-badge');
    if (!bellBtn) return;

    // Fetch unread count
    try {
      const res = await api('/api/v1/messages/unread-count');
      if (res.success && res.data > 0) {
        badge.textContent = res.data > 99 ? '99+' : res.data;
        badge.classList.remove('hidden');
      }
    } catch (_) {}

    // Fetch notifications (recent messages)
    async function loadNotifications() {
      const list = document.getElementById('notification-list');
      if (!list) return;
      try {
        const res = await api('/api/v1/messages/conversations?size=5');
        if (res.success && res.data?.content?.length) {
          list.innerHTML = res.data.content.map(conv => `
            <a href="/pages/messages?conv=${conv.id}" class="notif-item${conv.unreadCountOne > 0 || conv.unreadCountTwo > 0 ? ' notif-item--unread' : ''}">
              <span class="notif-item__dot" ${!conv.unreadCountOne && !conv.unreadCountTwo ? 'style="background:transparent"' : ''}></span>
              <div class="notif-item__body">
                <p class="notif-item__text">${esc(conv.lastMessagePreview ?? 'New message')}</p>
                <p class="notif-item__time">${formatRelTime(conv.lastMessageAt)}</p>
              </div>
            </a>`).join('');
        }
      } catch (_) {}
    }

    bellBtn.addEventListener('click', () => {
      const open = dropdown.classList.contains('hidden');
      dropdown.classList.toggle('hidden', !open);
      bellBtn.setAttribute('aria-expanded', open);
      if (open) loadNotifications();
    });

    document.addEventListener('click', e => {
      if (!bellBtn.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.add('hidden');
        bellBtn.setAttribute('aria-expanded', 'false');
      }
    });

    document.getElementById('mark-all-read')?.addEventListener('click', async () => {
      try { await api('/api/v1/messages/mark-all-read', { method: 'POST' }); }
      catch (_) {}
      badge.classList.add('hidden');
    });
  }

  // ──────────────────────────────────────────────
  // 14. WISHLIST
  // ──────────────────────────────────────────────
  const Wishlist = {
    key: 'ss_wishlist',
    get() { try { return JSON.parse(localStorage.getItem(this.key) || '[]'); } catch (_) { return []; } },
    toggle(id) {
      const list = this.get();
      const idx = list.indexOf(id);
      if (idx === -1) list.push(id); else list.splice(idx, 1);
      localStorage.setItem(this.key, JSON.stringify(list));
      return idx === -1;
    },
    has(id) { return this.get().includes(id); },
  };

  function initWishlistButtons(root = document) {
    root.querySelectorAll('.property-card__wishlist').forEach(btn => {
      const id = btn.dataset.propertyId;
      btn.setAttribute('aria-pressed', Wishlist.has(id));
      btn.addEventListener('click', e => {
        e.preventDefault();
        const added = Wishlist.toggle(id);
        btn.setAttribute('aria-pressed', added);
        toast(added ? 'Saved to wishlist' : 'Removed from wishlist');
      });
    });
  }

  // ──────────────────────────────────────────────
  // 15. ANALYTICS PAGE VIEW BEACON
  // ──────────────────────────────────────────────
  function beaconPageView() {
    if (!CONFIG.apiBase) return;
    const sessionId = sessionStorage.getItem('ss_session') || (() => {
      const id = Math.random().toString(36).slice(2);
      sessionStorage.setItem('ss_session', id);
      return id;
    })();
    const payload = {
      sessionId,
      userId: CONFIG.customerId || null,
      pageType: document.body.className.replace('template-', '').split(' ')[0],
      pageId: null,
      pageTitle: document.title,
      referrer: document.referrer,
      userAgent: navigator.userAgent,
      deviceType: window.innerWidth < 640 ? 'mobile' : window.innerWidth < 1024 ? 'tablet' : 'desktop',
    };
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        CONFIG.apiBase + '/api/v1/analytics/pageview',
        JSON.stringify(payload)
      );
    } else {
      fetch(CONFIG.apiBase + '/api/v1/analytics/pageview', {
        method: 'POST', body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
      }).catch(() => {});
    }
  }

  // ──────────────────────────────────────────────
  // 16. COOKIE CONSENT
  // ──────────────────────────────────────────────
  function initCookieConsent() {
    if (localStorage.getItem('ss_consent')) return;
    const banner = document.getElementById('cookie-banner');
    if (!banner) return;
    banner.classList.remove('hidden');
    document.getElementById('cookie-accept')?.addEventListener('click', () => {
      localStorage.setItem('ss_consent', 'all');
      banner.classList.add('hidden');
    });
    document.getElementById('cookie-essential')?.addEventListener('click', () => {
      localStorage.setItem('ss_consent', 'essential');
      banner.classList.add('hidden');
    });
  }

  // ──────────────────────────────────────────────
  // 17. UTILITIES
  // ──────────────────────────────────────────────
  function formatRelTime(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    const s = Math.floor((Date.now() - d) / 1000);
    if (s < 60) return 'Just now';
    if (s < 3600) return `${Math.floor(s/60)}m ago`;
    if (s < 86400) return `${Math.floor(s/3600)}h ago`;
    return d.toLocaleDateString();
  }

  // ──────────────────────────────────────────────
  // 18. MODAL CLOSE ON BACKDROP CLICK
  // ──────────────────────────────────────────────
  document.getElementById('modal-backdrop')?.addEventListener('click', Modal.close);
  document.getElementById('modal-close')?.addEventListener('click', Modal.close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') Modal.close(); });

  // ──────────────────────────────────────────────
  // 19. BOOT
  // ──────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    initHeader();
    initHeroSearch();
    loadFeaturedProperties();
    initWishlistButtons();
    if (CONFIG.features.ai) initConcierge();
    initNotifications();
    initAuthForms();
    initCookieConsent();
    beaconPageView();
  });

  // ──────────────────────────────────────────────
  // 20. EXPORT PUBLIC API
  // ──────────────────────────────────────────────
  window.StaySphere = {
    config: CONFIG,
    api,
    auth: Auth,
    toast,
    modal: Modal,
    wishlist: Wishlist,
    renderPropertyCard,
    formatRelTime,
    // Extension point: call StaySphere.extend(plugin) to add new services
    _plugins: {},
    extend(name, plugin) {
      this._plugins[name] = plugin;
      if (typeof plugin.init === 'function') plugin.init(this);
    },
  };

})();
