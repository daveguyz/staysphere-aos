/**
 * StaySphere AOS — plugin-booking.js
 * Phase F: Booking checkout + success
 *
 * initCheckout:
 *   - Loads property + pricing from API
 *   - Validates availability
 *   - Lazy-loads Stripe.js + mounts card Elements
 *   - Submits to POST /api/v1/bookings
 *   - Redirects to /pages/booking-success?booking={id}
 *
 * initBookingSuccess:
 *   - Loads booking details from API
 *   - Shows access code when status = CONFIRMED
 *   - Copy code to clipboard
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const api = (path, opts) => window.StaySphere.api(path, opts);
  const toast = (msg, type) => window.StaySphere?.toast(msg, type);
  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  function fmt(n, sym) {
    return (sym || 'N$') + Number(n || 0).toLocaleString('en-NA', { minimumFractionDigits: 0 });
  }
  function setLoading(id, on) {
    const btn = $(id);
    if (!btn) return;
    btn.disabled = on;
    btn.querySelector('.btn-label')?.classList.toggle('hidden', on);
    btn.querySelector('.btn-spinner')?.classList.toggle('hidden', !on);
  }
  function showError(id, msg) {
    const el = $(id);
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function clearError(id) {
    const el = $(id);
    if (el) { el.textContent = ''; el.classList.add('hidden'); }
  }
  function fmtDate(d) {
    if (!d) return '–';
    return new Date(d + 'T00:00:00').toLocaleDateString('en-NA', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // ══════════════════════════════════════════════════════════
  // CHECKOUT PAGE
  // ══════════════════════════════════════════════════════════
  function initCheckout() {
    const page = $('checkout-page');
    if (!page) return;

    if (!window.StaySphere?.auth?.getToken()) {
      window.location.href = `/account/login?return_to=${encodeURIComponent(window.location.href)}`;
      return;
    }

    const propId   = page.dataset.propertyId;
    const checkIn  = page.dataset.checkIn;
    const checkOut = page.dataset.checkOut;
    const guests   = parseInt(page.dataset.guests) || 1;
    const stripeKey = page.dataset.stripeKey;
    const sym      = page.dataset.currencySymbol || '$';

    if (!propId || !checkIn || !checkOut) {
      showError('checkout-error', 'Missing booking details. Please go back and try again.');
      return;
    }

    let stripeInstance = null;
    let cardElement    = null;
    let propertyData   = null;
    let priceData      = null;

    // ── Load property + price ─────────────────────────────────────────────────
    async function loadCheckoutData() {
      try {
        const [propRes, priceRes] = await Promise.all([
          api(`/api/v1/properties/${propId}`),
          api(`/api/v1/bookings/price-estimate?propertyId=${propId}&checkIn=${checkIn}&checkOut=${checkOut}`),
        ]);

        if (!propRes.success) throw new Error('Property not found');
        propertyData = propRes.data;
        priceData    = priceRes.data;

        renderPropertyCard(propertyData, checkIn, checkOut, guests, sym);
        renderPriceBreakdown(propertyData, checkIn, checkOut, guests, sym, priceData);
        renderCancellationPolicy(propertyData.cancellationPolicy);
        renderHostCard(propertyData);

        if (stripeKey) initStripeCard(stripeKey);

        // Pre-fill guest info if logged in
        prefillGuestInfo();

      } catch (e) {
        showError('checkout-error', 'Could not load property details: ' + e.message);
      }
    }

    function renderPropertyCard(prop, ci, co, g, sym) {
      const el = $('checkout-property-card');
      if (!el) return;
      const img = prop.imageUrls?.[0] || '';
      const nights = Math.round((new Date(co) - new Date(ci)) / 86400000);
      el.innerHTML = `
        <div class="checkout-property-card__image-wrap">
          ${img ? `<img src="${esc(img)}" alt="${esc(prop.title)}" class="checkout-property-card__image" loading="lazy" width="120" height="80">` : '<div class="checkout-property-card__image-placeholder" aria-hidden="true">🏠</div>'}
        </div>
        <div class="checkout-property-card__info">
          <p class="checkout-property-card__title">${esc(prop.title)}</p>
          <p class="checkout-property-card__location">📍 ${esc(prop.location?.city || '')}</p>
          <div class="checkout-property-card__dates">
            <span>${fmtDate(ci)}</span>
            <span class="checkout-property-card__dates-sep" aria-hidden="true">→</span>
            <span>${fmtDate(co)}</span>
            <span class="checkout-property-card__nights">${nights} night${nights !== 1 ? 's' : ''}</span>
          </div>
          <p class="checkout-property-card__guests">👥 ${g} guest${g !== 1 ? 's' : ''}</p>
        </div>`;
    }

    function renderPriceBreakdown(prop, ci, co, g, sym, totalPrice) {
      const nights = Math.round((new Date(co) - new Date(ci)) / 86400000);
      const baseRate = prop.pricing?.currentDynamicRate || prop.pricing?.baseRate || 0;
      const nightsTotal = baseRate * nights;
      const cleaningFee = prop.pricing?.cleaningFee || 0;
      const serviceFee  = Math.round(nightsTotal * 0.10);
      const taxes       = Math.round((nightsTotal + serviceFee) * 0.15);
      const total       = totalPrice || (nightsTotal + cleaningFee + serviceFee + taxes);

      const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
      set('checkout-rate',         `${fmt(baseRate, sym)} / night`);
      set('checkout-dates',        `${fmtDate(ci)} – ${fmtDate(co)}`);
      set('checkout-nights-label', `${fmt(baseRate, sym)} × ${nights} night${nights !== 1 ? 's' : ''}`);
      set('checkout-nights-amt',   fmt(nightsTotal, sym));
      set('checkout-cleaning',     cleaningFee > 0 ? fmt(cleaningFee, sym) : 'Included');
      set('checkout-service',      fmt(serviceFee, sym));
      set('checkout-taxes',        fmt(taxes, sym));
      set('checkout-total',        fmt(total, sym));

      const payLabel = $('checkout-pay-label');
      if (payLabel) payLabel.textContent = `Confirm and pay ${fmt(total, sym)}`;

      priceData = { nightsTotal, cleaningFee, serviceFee, taxes, total, nights, baseRate };
    }

    function renderCancellationPolicy(policy) {
      const el = $('checkout-policy-text');
      if (!el) return;
      const policies = {
        FLEXIBLE:  'Free cancellation for 24 hours after booking. After that, a 50% refund up to the day before check-in.',
        MODERATE:  'Free cancellation for 5 days before check-in. After that, the first night is non-refundable.',
        STRICT:    'Non-refundable after 48 hours of booking or within 14 days of check-in.',
        NON_REFUNDABLE: 'This booking is non-refundable.',
      };
      el.textContent = policies[policy] || policies.MODERATE;
    }

    function renderHostCard(prop) {
      const card = $('checkout-host-card');
      const nameEl = $('checkout-host-name');
      const sinceEl = $('checkout-host-since');
      const avatarEl = $('checkout-host-avatar');
      if (!card || !prop.host) return;
      const h = prop.host;
      const initials = ((h.firstName?.[0] || '') + (h.lastName?.[0] || '')).toUpperCase() || 'H';
      card.classList.remove('hidden');
      if (avatarEl) {
        avatarEl.textContent = initials;
        avatarEl.style.cssText = 'background:var(--color-primary);color:var(--color-primary-text);display:flex;align-items:center;justify-content:center;font-weight:800;';
      }
      if (nameEl) nameEl.textContent = `${h.firstName || ''} ${h.lastName || ''}`.trim() || 'Host';
      if (sinceEl) sinceEl.textContent = h.memberSince ? `Host since ${h.memberSince}` : '';
    }

    async function prefillGuestInfo() {
      try {
        const res = await api('/api/v1/auth/me');
        if (!res.success) return;
        const u = res.data;
        if ($('checkout-first-name') && u.firstName) $('checkout-first-name').value = u.firstName;
        if ($('checkout-last-name')  && u.lastName)  $('checkout-last-name').value  = u.lastName;
        if ($('checkout-email')      && u.email)     $('checkout-email').value       = u.email;
        if ($('checkout-phone')      && u.phone)     $('checkout-phone').value       = u.phone;
      } catch (_) {}
    }

    // ── Stripe Elements ──────────────────────────────────────────────────────
    function initStripeCard(key) {
      if (!key) return;
      const script = document.createElement('script');
      script.src = 'https://js.stripe.com/v3/';
      script.onload = () => {
        stripeInstance = window.Stripe(key);
        const elements = stripeInstance.elements();
        cardElement = elements.create('card', {
          style: {
            base: {
              fontSize: '16px',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              color: getComputedStyle(document.body).getPropertyValue('--color-text').trim() || '#1a1a2e',
              '::placeholder': { color: '#9ca3af' },
            },
          },
        });
        const mountEl = $('stripe-checkout-card');
        const placeholder = $('checkout-card-placeholder');
        if (placeholder) placeholder.remove();
        if (mountEl) {
          cardElement.mount(mountEl);
          cardElement.on('change', e => {
            const err = $('checkout-card-errors');
            if (err) err.textContent = e.error ? e.error.message : '';
          });
        }
      };
      document.head.appendChild(script);
    }

    // ── Submit booking ────────────────────────────────────────────────────────
    $('checkout-pay-btn')?.addEventListener('click', async () => {
      clearError('checkout-error');

      const confirmCheck = $('checkout-confirm');
      if (!confirmCheck?.checked) {
        showError('checkout-error', 'Please agree to the house rules to continue.');
        return;
      }

      setLoading('checkout-pay-btn', true);

      try {
        let paymentIntentId = null;

        // Stripe payment method creation
        if (stripeInstance && cardElement) {
          const holder = $('checkout-card-holder')?.value?.trim() || '';
          const { paymentMethod, error } = await stripeInstance.createPaymentMethod({
            type: 'card',
            card: cardElement,
            billing_details: { name: holder },
          });
          if (error) {
            showError('checkout-error', error.message);
            setLoading('checkout-pay-btn', false);
            return;
          }
          paymentIntentId = paymentMethod.id;
        }

        const payload = {
          propertyId: propId,
          checkIn,
          checkOut,
          guestCount: guests,
          specialRequests: $('checkout-requests')?.value || '',
          paymentMethodId: paymentIntentId,
        };

        const res = await api('/api/v1/bookings', {
          method: 'POST',
          body: JSON.stringify(payload),
        });

        if (res.success) {
          toast('Booking confirmed! 🎉', 'success');
          window.location.href = `/pages/booking-success?booking=${res.data.id}`;
        } else {
          showError('checkout-error', res.message || 'Booking failed. Please try again.');
        }
      } catch (e) {
        const msg = e.message || 'Booking failed. Please try again.';
        showError('checkout-error', msg);
      } finally {
        setLoading('checkout-pay-btn', false);
      }
    });

    loadCheckoutData();
  }

  // ══════════════════════════════════════════════════════════
  // BOOKING SUCCESS PAGE
  // ══════════════════════════════════════════════════════════
  function initBookingSuccess() {
    const page = $('booking-success-page');
    if (!page) return;

    const bookingId = page.dataset.bookingId;
    const sym = page.dataset.currencySymbol || '$';
    if (!bookingId) return;

    async function loadBooking() {
      try {
        const res = await api(`/api/v1/bookings/${bookingId}`);
        if (!res.success) return;
        const b = res.data;

        // Render summary
        const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
        set('bs-property', b.property?.title || b.propertyId);
        set('bs-checkin',  fmtDate(b.checkIn));
        const bsCheckinEl  = $('bs-checkin');
        const bsCheckoutEl = $('bs-checkout');
        if (bsCheckinEl  && b.checkIn)  bsCheckinEl.dataset.datetime  = b.checkIn  + 'T00:00:00';
        if (bsCheckoutEl && b.checkOut) bsCheckoutEl.dataset.datetime = b.checkOut + 'T00:00:00';
        // Let TimeFormatter reformat in user's timezone
        window.StaySphere?.i18n?.time?._repaintDates?.();
        set('bs-checkout', fmtDate(b.checkOut));
        set('bs-guests',   `${b.guestCount} guest${b.guestCount !== 1 ? 's' : ''}`);
        set('bs-total',    fmt(b.totalAmount, sym));

        // Access code (CONFIRMED status)
        if (b.status === 'CONFIRMED' && b.accessCode) {
          const section = $('bs-access-section');
          const codeEl  = $('bs-access-code');
          if (section) section.classList.remove('hidden');
          if (codeEl)  codeEl.textContent = b.accessCode;
        }

        // Copy button
        $('bs-copy-code-btn')?.addEventListener('click', async () => {
          const code = $('bs-access-code')?.textContent;
          if (!code) return;
          try {
            await navigator.clipboard.writeText(code);
            toast('Access code copied!', 'success');
          } catch (_) {}
        });

      } catch (_) {}
    }

    loadBooking();
  }

  // ── Entry point ──────────────────────────────────────────────────────────────
  function init() {
    initCheckout();
    initBookingSuccess();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
