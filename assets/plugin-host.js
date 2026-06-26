/**
 * StaySphere AOS — plugin-host.js
 * Phase F: Host dashboard + property creation
 *
 * initHostDashboard: loads stats, listings, bookings, simple SVG revenue chart, calendar
 * initPropertyCreate: drives 6-step form, photo upload, API submission
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const api = (path, opts) => window.StaySphere.api(path, opts);
  const toast = msg => window.StaySphere?.toast(msg);
  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  function fmt(n, sym) {
    const i18n = window.StaySphere?.i18n;
    if (i18n?.fx?.loaded) {
      const base = document.body.dataset.currency || 'USD';
      const to   = i18n.currentCurrency();
      return i18n.fx.format(Number(n || 0), base, to);
    }
    return (sym || '$') + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0 });
  }

  function setLoading(id, on) {
    const b = $(id);
    if (!b) return;
    b.disabled = on;
    b.querySelector('.btn-label')?.classList.toggle('hidden', on);
    b.querySelector('.btn-spinner')?.classList.toggle('hidden', !on);
  }
  function showError(id, msg) {
    const el = $(id);
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ══════════════════════════════════════════════════════════
  // HOST DASHBOARD
  // ══════════════════════════════════════════════════════════
  function initHostDashboard() {
    const dash = $('host-dashboard');
    if (!dash) return;

    if (!window.StaySphere?.auth?.getToken()) {
      window.location.href = '/account/login?return_to=/pages/host-dashboard';
      return;
    }

    const sym = dash.dataset.currencySymbol || '$';

    initDashboardTabs();
    loadDashboardData(sym);

    // Reload dashboard stats + listings on currency change
    document.addEventListener('ss:currency-changed', e => {
      const newSym = e.detail?.symbol || sym;
      loadDashboardData(newSym);
    });
  }

  function initDashboardTabs() {
    document.querySelectorAll('.host-tabs .account-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.host-tabs .account-tab').forEach(t => {
          t.classList.remove('account-tab--active');
          t.setAttribute('aria-selected', 'false');
        });
        document.querySelectorAll('#host-dashboard .account-panel').forEach(p =>
          p.classList.add('hidden')
        );
        tab.classList.add('account-tab--active');
        tab.setAttribute('aria-selected', 'true');
        const panel = $(tab.dataset.panel);
        if (panel) panel.classList.remove('hidden');

        // Lazy load on first visit
        if (tab.dataset.panel === 'hpanel-bookings' && !panel.dataset.loaded) {
          loadHostBookings(); panel.dataset.loaded = '1';
        } else if (tab.dataset.panel === 'hpanel-revenue' && !panel.dataset.loaded) {
          loadRevenueData(); panel.dataset.loaded = '1';
        } else if (tab.dataset.panel === 'hpanel-calendar' && !panel.dataset.loaded) {
          loadCalendarProperties(); panel.dataset.loaded = '1';
        }
      });
    });
  }

  async function loadDashboardData(sym) {
    try {
      // Stats + listings in parallel
      const [statsRes, listingsRes] = await Promise.all([
        api('/api/v1/analytics/host-summary').catch(() => ({ success: false })),
        api('/api/v1/properties/host/me?page=0&size=20'),
      ]);

      // Stats
      const stats = statsRes.data || {};
      setStatCard('stat-revenue',  fmt(stats.revenueThisMonth || 0, sym));
      setStatCard('stat-bookings', stats.bookingsThisMonth ?? 0);
      setStatCard('stat-listings', stats.activeListings ?? 0);
      setStatCard('stat-rating',   stats.averageRating ? stats.averageRating.toFixed(1) + ' ⭐' : '–');

      const welcomeEl = $('host-welcome');
      if (welcomeEl) {
        const name = window.StaySphere?.config?.customerId ? 'there' : 'there';
        welcomeEl.textContent = `Welcome back! Here's your property overview.`;
      }

      // Listings
      const listings = listingsRes.data?.content || [];
      renderListings(listings, sym);

    } catch (e) {
      console.error('[HostDash] Load error:', e);
    }
  }

  function setStatCard(id, value) {
    const card = $(id);
    if (!card) return;
    card.classList.remove('host-stat-card--skeleton');
    const valEl = card.querySelector('.host-stat-card__value');
    if (valEl) {
      valEl.innerHTML = '';
      valEl.textContent = value;
    }
  }

  function renderListings(listings, sym) {
    const grid  = $('host-listings-grid');
    const empty = $('host-listings-empty');
    if (!grid) return;
    grid.innerHTML = '';

    if (!listings.length) {
      if (empty) empty.classList.remove('hidden');
      return;
    }

    grid.innerHTML = listings.map(p => {
      const img = p.imageUrls?.[0] || '';
      const rate = p.pricing?.baseRate || 0;
      const status = p.status || 'ACTIVE';
      const statusClass = status === 'ACTIVE' ? 'listing-status--active' : 'listing-status--inactive';
      return `
        <div class="host-listing-card" data-property-id="${p.id}">
          <div class="host-listing-card__image">
            ${img ? `<img src="${esc(img)}" alt="${esc(p.title)}" loading="lazy" width="160" height="107">` : '<div class="host-listing-card__image-placeholder" aria-hidden="true">🏠</div>'}
          </div>
          <div class="host-listing-card__body">
            <p class="host-listing-card__title">${esc(p.title)}</p>
            <p class="host-listing-card__location">📍 ${esc(p.location?.city || '')}</p>
            <p class="host-listing-card__rate">${fmt(rate, sym)}/night</p>
            <span class="host-listing-card__status ${statusClass}">${status}</span>
            <div class="host-listing-card__actions">
              <a href="/products/${esc(p.shopifyHandle || p.id)}" class="btn btn--ghost btn--sm">View</a>
              <a href="/pages/property-create?mode=edit&propertyId=${esc(p.id)}"
                 class="btn btn--ghost btn--sm">Edit</a>
              <button class="btn btn--ghost btn--sm host-listing-toggle"
                      data-property-id="${esc(p.id)}"
                      data-status="${esc(status)}">
                ${status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </div>
        </div>`;
    }).join('');

    // Toggle active/inactive
    grid.querySelectorAll('.host-listing-toggle').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id     = btn.dataset.propertyId;
        const active = btn.dataset.status === 'ACTIVE';
        try {
          await api(`/api/v1/properties/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ status: active ? 'INACTIVE' : 'ACTIVE' }),
          });
          toast(active ? 'Property deactivated' : 'Property activated');
          loadDashboardData(btn.closest('[data-currency-symbol]')?.dataset.currencySymbol || '$');
        } catch (_) {
          toast('Could not update listing status');
        }
      });
    });
  }

  async function loadHostBookings() {
    const rowsEl = $('host-bookings-rows');
    const emptyEl = $('host-bookings-empty');
    if (!rowsEl) return;
    try {
      const res = await api('/api/v1/bookings/host?page=0&size=20');
      const bookings = res.data?.content || [];
      rowsEl.innerHTML = '';
      if (!bookings.length) {
        if (emptyEl) emptyEl.classList.remove('hidden');
        return;
      }
      rowsEl.innerHTML = bookings.map(b => {
        const statusClass = {
          CONFIRMED:'booking-status--confirmed', PENDING:'booking-status--pending',
          CANCELLED:'booking-status--cancelled'
        }[b.status] || '';
        return `
          <div class="host-bookings-table__row">
            <span class="host-bookings-table__cell">${esc(b.property?.title || b.propertyId)}</span>
            <span class="host-bookings-table__cell">${esc(b.guest?.firstName || 'Guest')}</span>
            <span class="host-bookings-table__cell">${b.checkIn} → ${b.checkOut}</span>
            <span class="host-bookings-table__cell host-bookings-table__cell--amount">
              ${fmt(b.hostPayout || b.totalAmount)}
            </span>
            <span class="host-bookings-table__cell">
              <span class="account-booking-row__status ${statusClass}">${b.status}</span>
            </span>
            <span class="host-bookings-table__cell">
              <a href="/account?booking=${b.id}" class="btn btn--ghost btn--sm">View</a>
            </span>
          </div>`;
      }).join('');
    } catch (_) {
      if (emptyEl) emptyEl.classList.remove('hidden');
    }
  }

  async function loadRevenueData() {
    const chartEl = $('host-revenue-chart');
    const rowsEl  = $('host-revenue-rows');
    if (!chartEl) return;

    try {
      const res = await api('/api/v1/analytics/host-revenue?months=6');
      const months = res.data || [];

      if (!months.length) {
        chartEl.innerHTML = '<p style="color:var(--color-text-muted);text-align:center;padding:40px">No revenue data yet</p>';
        return;
      }

      renderRevenueChart(chartEl, months);

      if (rowsEl) {
        rowsEl.innerHTML = months.map(m => `
          <div class="host-revenue-table__row">
            <span>${m.month}</span>
            <span>${m.bookings}</span>
            <span>${fmt(m.revenue)}</span>
            <span>${fmt(m.payout)}</span>
          </div>`).join('');
      }
    } catch (_) {
      chartEl.innerHTML = '<p style="color:var(--color-text-muted);text-align:center;padding:40px">Revenue data unavailable</p>';
    }
  }

  function renderRevenueChart(container, months) {
    // Simple SVG bar chart — no external library needed
    const W = 600, H = 200, BAR_W = Math.floor(W / months.length) - 8;
    const maxVal = Math.max(...months.map(m => m.revenue), 1);
    const bars = months.map((m, i) => {
      const barH = Math.round((m.revenue / maxVal) * (H - 30));
      const x = i * (W / months.length) + 4;
      const y = H - barH - 20;
      return `
        <rect x="${x}" y="${y}" width="${BAR_W}" height="${barH}"
              fill="var(--color-primary)" rx="4" opacity="0.85">
          <title>${m.month}: ${fmt(m.revenue)}</title>
        </rect>
        <text x="${x + BAR_W / 2}" y="${H - 4}" text-anchor="middle"
              font-size="11" fill="var(--color-text-muted)">${m.month.slice(0, 3)}</text>`;
    }).join('');

    container.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" width="100%" aria-label="Monthly revenue chart" role="img">
        <title>Monthly revenue over last 6 months</title>
        ${bars}
      </svg>`;
  }

  async function loadCalendarProperties() {
    const sel = $('host-cal-property');
    if (!sel) return;
    try {
      const res = await api('/api/v1/properties/host/me?page=0&size=50');
      const props = res.data?.content || [];
      props.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.title;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', () => {
        if (sel.value) loadAvailabilityCalendar(sel.value);
      });
    } catch (_) {}
  }

  async function loadAvailabilityCalendar(propertyId) {
    const calEl = $('host-calendar-grid');
    if (!calEl) return;
    calEl.innerHTML = '<p style="color:var(--color-text-muted)">Loading calendar…</p>';
    try {
      const today = new Date();
      const from  = today.toISOString().split('T')[0];
      const until = new Date(today.getFullYear(), today.getMonth() + 2, 0).toISOString().split('T')[0];
      const res = await api(`/api/v1/properties/${propertyId}/availability?startDate=${from}&endDate=${until}`);
      const days = res.data?.unavailableDates || [];
      renderCalendarGrid(calEl, today, days);
    } catch (_) {
      calEl.innerHTML = '<p style="color:var(--color-text-muted)">Could not load availability.</p>';
    }
  }

  function renderCalendarGrid(container, startDate, blockedDates) {
    // Simple 2-month text grid
    const blocked = new Set(blockedDates);
    const months = [];
    for (let m = 0; m < 2; m++) {
      const d = new Date(startDate.getFullYear(), startDate.getMonth() + m, 1);
      const i18n = window.StaySphere?.i18n;
        const lang = i18n?.currentLanguage?.() || 'en';
        const langMap = { en:'en-US', fr:'fr-FR', es:'es-ES', de:'de-DE', pt:'pt-BR', ar:'ar-SA', zh:'zh-CN' };
        const bcp47 = langMap[lang] || 'en-US';
        const label = d.toLocaleString(bcp47, { month: 'long', year: 'numeric' });
      const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      const firstDow = d.getDay();
      let grid = `<div class="host-cal-month"><h3 class="host-cal-month__title">${label}</h3><div class="host-cal-days-header">`;
      'Sun Mon Tue Wed Thu Fri Sat'.split(' ').forEach(h => {
        grid += `<span class="host-cal-day host-cal-day--header">${h}</span>`;
      });
      grid += '</div><div class="host-cal-days">';
      for (let i = 0; i < firstDow; i++) grid += '<span class="host-cal-day host-cal-day--empty"></span>';
      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        const isBlocked = blocked.has(dateStr);
        grid += `<span class="host-cal-day${isBlocked ? ' host-cal-day--blocked' : ' host-cal-day--free'}"
                       title="${dateStr}">${day}</span>`;
      }
      grid += '</div></div>';
      months.push(grid);
    }
    container.innerHTML = months.join('');
  }

  // ══════════════════════════════════════════════════════════
  // PROPERTY CREATE / EDIT (6-step form)
  // ══════════════════════════════════════════════════════════
  function initPropertyCreate() {
    const page = $('property-create-page');
    if (!page) return;

    if (!window.StaySphere?.auth?.getToken()) {
      window.location.href = '/account/login?return_to=/pages/property-create';
      return;
    }

    const TOTAL_STEPS = 6;
    let currentStep = 1;
    const formData = {};
    const photos = [];

    // If editing, load existing data
    const mode = page.dataset.mode;
    const propId = page.dataset.propertyId;
    if (mode === 'edit' && propId) loadExistingProperty(propId);

    function showStep(n) {
      for (let i = 1; i <= TOTAL_STEPS; i++) {
        const panel = $(`pstep-${i}`);
        const indicator = $(`step-indicator-${i}`);
        if (panel) panel.classList.toggle('hidden', i !== n);
        if (indicator) {
          indicator.classList.toggle('property-create-step--active', i === n);
          indicator.classList.toggle('property-create-step--done', i < n);
          indicator.setAttribute('aria-current', i === n ? 'step' : 'false');
        }
      }
      $('pc-prev-btn')?.classList.toggle('hidden', n === 1);
      $('pc-next-btn')?.classList.toggle('hidden', n === TOTAL_STEPS);
      $('pc-submit-btn')?.classList.toggle('hidden', n !== TOTAL_STEPS);
      currentStep = n;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      if (n === TOTAL_STEPS) buildReviewPanel();
    }

    function collectStep(n) {
      const panel = $(`pstep-${n}`);
      if (!panel) return true;
      const inputs = panel.querySelectorAll('input,select,textarea');
      inputs.forEach(inp => {
        if (inp.name && inp.type !== 'file') {
          if (inp.type === 'checkbox') {
            if (!formData[inp.name]) formData[inp.name] = [];
            if (inp.checked) formData[inp.name].push(inp.value);
          } else if (inp.value) {
            formData[inp.name] = inp.value;
          }
        }
      });
      return panel.querySelector(':invalid') === null;
    }

    $('pc-next-btn')?.addEventListener('click', () => {
      if (!collectStep(currentStep)) {
        const invalid = $(`pstep-${currentStep}`)?.querySelector(':invalid');
        invalid?.reportValidity();
        return;
      }
      if (currentStep < TOTAL_STEPS) showStep(currentStep + 1);
    });

    $('pc-prev-btn')?.addEventListener('click', () => {
      if (currentStep > 1) showStep(currentStep - 1);
    });

    // Photo upload
    const photoInput = $('pc-photos');
    const browseBtn  = $('pc-browse-btn');
    const zone       = $('photo-upload-zone');
    const previewGrid = $('photo-preview-grid');
    const photoCount = $('pc-photo-count');

    browseBtn?.addEventListener('click', () => photoInput?.click());
    zone?.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('photo-upload-zone--drag'); });
    zone?.addEventListener('dragleave', () => zone.classList.remove('photo-upload-zone--drag'));
    zone?.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('photo-upload-zone--drag');
      handleFiles([...e.dataTransfer.files]);
    });
    photoInput?.addEventListener('change', e => handleFiles([...e.target.files]));

    function handleFiles(files) {
      files.filter(f => f.type.startsWith('image/')).slice(0, 10 - photos.length).forEach(file => {
        if (file.size > 10 * 1024 * 1024) { toast('Photo too large (max 10MB)'); return; }
        photos.push(file);
        const reader = new FileReader();
        reader.onload = e => {
          if (!previewGrid) return;
          const div = document.createElement('div');
          div.className = 'photo-preview-item';
          div.innerHTML = `
            <img src="${e.target.result}" alt="Preview" class="photo-preview-item__img" loading="lazy">
            <button class="photo-preview-item__remove" aria-label="Remove photo">✕</button>`;
          div.querySelector('.photo-preview-item__remove')?.addEventListener('click', () => {
            const idx = [...previewGrid.children].indexOf(div);
            photos.splice(idx, 1);
            div.remove();
            updatePhotoCount();
          });
          previewGrid.appendChild(div);
        };
        reader.readAsDataURL(file);
      });
      updatePhotoCount();
    }

    function updatePhotoCount() {
      if (photoCount) photoCount.textContent = `${photos.length} photo${photos.length !== 1 ? 's' : ''} selected`;
    }

    // Price preview
    $('pc-base-rate')?.addEventListener('input', () => {
      const rate = parseFloat($('pc-base-rate')?.value) || 0;
      const cleaningFee = parseFloat($('pc-cleaning-fee')?.value) || 0;
      const earningsPreview = $('pc-earnings-preview');
      const previewPanel = $('pc-price-preview');
      if (rate > 0) {
        const earnings = Math.round((rate * 7 + cleaningFee) * 0.90);
        if (earningsPreview) earningsPreview.textContent = fmt(earnings);
        if (previewPanel) previewPanel.hidden = false;
      }
    });

    function buildReviewPanel() {
      const review = $('property-create-review');
      if (!review) return;
      review.innerHTML = `
        <div class="property-create-review__card">
          <h3 class="property-create-review__title">${esc(formData.title || 'Untitled')}</h3>
          <p class="property-create-review__type">${esc(formData.propertyType || '')}</p>
          <p class="property-create-review__location">📍 ${esc(formData.city || '')}, ${esc(formData.region || '')}</p>
          <div class="property-create-review__meta">
            <span>🛏 ${formData.bedrooms || '?'} beds</span>
            <span>🚿 ${formData.bathrooms || '?'} baths</span>
            <span>👥 ${formData.maxGuests || '?'} guests</span>
          </div>
          <p class="property-create-review__rate">${fmt(formData.baseRate)} / night</p>
          <p class="property-create-review__photos">${photos.length} photo${photos.length !== 1 ? 's' : ''}</p>
        </div>`;
    }

    // Submit
    $('pc-submit-btn')?.addEventListener('click', async () => {
      if (!$('pc-agree-terms')?.checked) {
        showError('pc-submit-error', 'Please agree to the Host Terms to publish.');
        return;
      }

      collectStep(TOTAL_STEPS - 1);
      setLoading('pc-submit-btn', true);

      try {
        // Upload photos first if any
        const imageUrls = await uploadPhotos(photos);

        const payload = {
          ...formData,
          amenities: Array.isArray(formData.amenities)
            ? formData.amenities : formData.amenities ? [formData.amenities] : [],
          imageUrls,
          baseRate:     parseFloat(formData.baseRate)     || 0,
          cleaningFee:  parseFloat(formData.cleaningFee)  || 0,
          bedrooms:     parseInt(formData.bedrooms)        || 1,
          bathrooms:    parseFloat(formData.bathrooms)     || 1,
          maxGuests:    parseInt(formData.maxGuests)       || 1,
          minimumNights: parseInt(formData.minimumNights)  || 1,
          maximumNights: parseInt(formData.maximumNights)  || 30,
          latitude:     parseFloat(formData.latitude)      || null,
          longitude:    parseFloat(formData.longitude)     || null,
          instantBook:  formData.instantBook === 'true',
          currency:     'USD',
          country:      '',
        };

        const method = mode === 'edit' ? 'PUT' : 'POST';
        const path   = mode === 'edit'
          ? `/api/v1/properties/${propId}`
          : '/api/v1/properties';

        const res = await api(path, { method, body: JSON.stringify(payload) });

        if (res.success) {
          toast('Property published successfully! 🎉');
          window.location.href = '/pages/host-dashboard';
        } else {
          showError('pc-submit-error', res.message || 'Could not publish. Please try again.');
        }
      } catch (e) {
        showError('pc-submit-error', e.message || 'Submission failed. Please try again.');
      } finally {
        setLoading('pc-submit-btn', false);
      }
    });

    async function uploadPhotos(files) {
      if (!files.length) return [];
      // Phase I: implement real upload to cloud storage (S3 / Cloudinary)
      // For now return empty — images managed separately
      return [];
    }

    async function loadExistingProperty(id) {
      try {
        const res = await api(`/api/v1/properties/${id}`);
        if (!res.success) return;
        const p = res.data;
        // Pre-fill step 1
        const set = (inputId, val) => { const el = $(inputId); if (el && val) el.value = val; };
        set('pc-title', p.title);
        set('pc-type', p.propertyType);
        set('pc-description', p.description);
        set('pc-bedrooms', p.bedrooms);
        set('pc-bathrooms', p.bathrooms);
        set('pc-max-guests', p.maxGuests);
        // Step 2
        set('pc-address', p.address);
        set('pc-city', p.location?.city);
        set('pc-region', p.location?.region);
        set('pc-lat', p.location?.latitude);
        set('pc-lng', p.location?.longitude);
        // Step 4
        set('pc-base-rate', p.pricing?.baseRate);
        set('pc-cleaning-fee', p.pricing?.cleaningFee);
        set('pc-min-nights', p.minimumNights);
        set('pc-max-nights', p.maximumNights);
        // Amenities
        (p.amenities || []).forEach(a => {
          const cb = document.querySelector(`input[name="amenities"][value="${a}"]`);
          if (cb) cb.checked = true;
        });
      } catch (_) {}
    }
  }

  // ── Entry point ───────────────────────────────────────────────────────────────
  function init() {
    initHostDashboard();
    initPropertyCreate();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
