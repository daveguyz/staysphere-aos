/**
 * StaySphere AOS — plugin-product.js
 * Phase 1: Property detail page
 * Gallery, booking widget price calc, availability check,
 * reviews from trust-service, area intelligence, share, host card.
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  // ─── Gallery ───────────────────────────────────────────────────────────────
  function initGallery() {
    const heroImg  = $('gallery-hero-img');
    const thumbs   = $('gallery-thumbs');
    const prevBtn  = $('gallery-prev');
    const nextBtn  = $('gallery-next');
    const expandBtn = $('gallery-expand');
    if (!heroImg) return;

    const thumbBtns = thumbs ? [...thumbs.querySelectorAll('.product-gallery__thumb')] : [];
    let current = 0;

    function setImage(idx) {
      if (idx < 0 || idx >= thumbBtns.length) return;
      current = idx;
      const btn = thumbBtns[idx];
      heroImg.src = btn.dataset.src;
      if (btn.dataset.srcset) heroImg.srcset = btn.dataset.srcset;
      thumbBtns.forEach((b, i) => b.classList.toggle('active', i === idx));
    }

    thumbBtns.forEach((btn, i) => btn.addEventListener('click', () => setImage(i)));
    if (prevBtn) prevBtn.addEventListener('click', () => setImage(current - 1));
    if (nextBtn) nextBtn.addEventListener('click', () => setImage(current + 1));

    // Swipe on mobile
    let touchStartX = 0;
    heroImg.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].clientX; }, { passive: true });
    heroImg.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(dx) > 50) setImage(dx > 0 ? current - 1 : current + 1);
    }, { passive: true });

    // Lightbox expand
    if (expandBtn) {
      expandBtn.addEventListener('click', () => {
        window.StaySphere?.modal.open(
          `<div class="gallery-lightbox">
            <img src="${heroImg.src}" alt="${heroImg.alt}" class="gallery-lightbox__img" loading="lazy">
           </div>`,
          'Photos'
        );
      });
    }

    // Keyboard nav on gallery
    heroImg.setAttribute('tabindex', '0');
    heroImg.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft') setImage(current - 1);
      if (e.key === 'ArrowRight') setImage(current + 1);
    });
  }

  // ─── Description expand/collapse ───────────────────────────────────────────
  function initDescriptionToggle() {
    const toggle = $('desc-toggle');
    const text   = $('product-desc-text');
    if (!toggle || !text) return;

    const COLLAPSED_HEIGHT = 160;
    text.style.maxHeight = COLLAPSED_HEIGHT + 'px';
    text.style.overflow = 'hidden';
    text.style.transition = 'max-height 0.3s ease';

    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      if (!expanded) {
        text.style.maxHeight = text.scrollHeight + 'px';
        toggle.textContent = 'Show less ↑';
        toggle.setAttribute('aria-expanded', 'true');
      } else {
        text.style.maxHeight = COLLAPSED_HEIGHT + 'px';
        toggle.textContent = 'Show more ↓';
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // ─── Booking widget ────────────────────────────────────────────────────────
  function initBookingWidget() {
    const widget = $('booking-widget');
    if (!widget) return;

    const propertyId = widget.dataset.propertyId;
    const baseRate   = parseFloat(widget.dataset.baseRate) || 0;
    const sym        = widget.dataset.currencySymbol || '$';

    const checkInEl  = $('bw-checkin');
    const checkOutEl = $('bw-checkout');
    const guestsEl   = $('bw-guests');
    const rateEl     = $('bw-rate');
    const breakdown  = $('bw-breakdown');
    const avail      = $('bw-availability');
    const reserveBtn = $('bw-reserve-btn');
    const ctaLabel   = $('bw-cta-label');
    const dynamicBadge = $('bw-dynamic-badge');

    let availCheckTimeout = null;
    let currentRate = baseRate;

    // Fetch dynamic rate if feature enabled
    async function fetchDynamicRate() {
      if (!window.StaySphere?.config.features.dynamicPricing) return;
      try {
        const res = await window.StaySphere.api(
          `/api/v1/pricing/${propertyId}/current-rate`
        );
        if (res.success && res.data?.dynamicRate) {
          currentRate = res.data.dynamicRate;
          if (rateEl) rateEl.textContent = `${sym}${currentRate.toFixed(0)}`;
          if (dynamicBadge) dynamicBadge.hidden = false;
        }
      } catch (_) {}
    }

    // Calculate price breakdown
    function calcBreakdown(checkIn, checkOut) {
      if (!checkIn || !checkOut) {
        if (breakdown) breakdown.classList.add('hidden');
        return;
      }
      const nights = Math.round(
        (new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60 * 24)
      );
      if (nights <= 0) {
        if (breakdown) breakdown.classList.add('hidden');
        return;
      }
      const nightCost   = currentRate * nights;
      const cleaningFee = Math.round(baseRate * 0.10);
      const serviceFee  = Math.round(nightCost * 0.10);
      const total       = nightCost + cleaningFee + serviceFee;

      const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
      set('bw-nights-label', `${sym}${currentRate.toFixed(0)} × ${nights} night${nights !== 1 ? 's' : ''}`);
      set('bw-nights-amt',   `${sym}${nightCost.toFixed(0)}`);
      set('bw-cleaning',     `${sym}${cleaningFee.toFixed(0)}`);
      set('bw-service',      `${sym}${serviceFee.toFixed(0)}`);
      set('bw-total',        `${sym}${total.toFixed(0)}`);
      if (breakdown) breakdown.classList.remove('hidden');
    }

    // Check availability
    async function checkAvailability(checkIn, checkOut) {
      if (!checkIn || !checkOut || !avail) return;
      avail.classList.remove('hidden');
      avail.textContent = 'Checking availability…';
      avail.className = 'booking-widget__availability';
      try {
        const res = await window.StaySphere.api(
          `/api/v1/properties/${propertyId}/availability?checkIn=${checkIn}&checkOut=${checkOut}`
        );
        if (res.success) {
          if (res.data.available) {
            avail.textContent = '✓ Available for your dates';
            avail.classList.add('avail--yes');
            if (ctaLabel) ctaLabel.textContent = 'Reserve';
            if (reserveBtn) reserveBtn.disabled = false;
          } else {
            avail.textContent = '✗ Not available for these dates';
            avail.classList.add('avail--no');
            if (ctaLabel) ctaLabel.textContent = 'Not available';
            if (reserveBtn) reserveBtn.disabled = true;
          }
        }
      } catch (_) {
        avail.textContent = '';
        avail.classList.add('hidden');
      }
    }

    function onDatesChange() {
      const ci = checkInEl?.value;
      const co = checkOutEl?.value;
      calcBreakdown(ci, co);
      clearTimeout(availCheckTimeout);
      if (ci && co) {
        availCheckTimeout = setTimeout(() => checkAvailability(ci, co), 600);
      }
    }

    // Date dependency
    if (checkInEl && checkOutEl) {
      checkInEl.addEventListener('change', () => {
        if (checkInEl.value) {
          checkOutEl.min = checkInEl.value;
          if (checkOutEl.value && checkOutEl.value <= checkInEl.value) {
            checkOutEl.value = '';
          }
        }
        onDatesChange();
      });
      checkOutEl.addEventListener('change', onDatesChange);
    }

    // Reserve button
    if (reserveBtn) {
      reserveBtn.addEventListener('click', async () => {
        const ci = checkInEl?.value;
        const co = checkOutEl?.value;
        const g  = guestsEl?.value || 1;

        if (!ci || !co) {
          window.StaySphere.toast('Please select check-in and check-out dates', 'warning');
          checkInEl?.focus();
          return;
        }

        if (!window.StaySphere.auth.getToken()) {
          window.location.href = `/account/login?return_to=${encodeURIComponent(window.location.pathname)}`;
          return;
        }

        if (!window.StaySphere.config.features.payments) {
          window.StaySphere.toast('Payments coming soon — use the enquiry form for now', 'warning', 6000);
          return;
        }

        // Phase 3 will implement the full booking flow
        window.StaySphere.toast('Booking engine coming in Phase 3', 'default', 4000);
      });
    }

    // Negotiate button
    const negotiateBtn = $('bw-negotiate-btn');
    if (negotiateBtn) {
      negotiateBtn.addEventListener('click', () => {
        window.StaySphere.toast('Price negotiation coming soon', 'default', 4000);
      });
    }

    fetchDynamicRate();
  }

  // ─── Reviews ───────────────────────────────────────────────────────────────
  function initReviews() {
    const reviewsSection = $('product-reviews');
    if (!reviewsSection) return;

    const propertyId = document.querySelector('[data-property-id]')?.dataset.propertyId;
    if (!propertyId) return;

    let page = 0;
    const loadMore = $('reviews-load-more');

    async function loadReviews() {
      try {
        const res = await window.StaySphere.api(
          `/api/v1/properties/${propertyId}/reviews?page=${page}&size=6`
        );
        if (!res.success) return;

        const reviewsList = $('reviews-list');
        if (!reviewsList) return;

        // Clear skeletons on first load
        if (page === 0) reviewsList.innerHTML = '';

        if (!res.data?.content?.length) {
          if (page === 0) reviewsList.innerHTML = '<p class="reviews-empty">No reviews yet — be the first to stay!</p>';
          if (loadMore) loadMore.classList.add('hidden');
          return;
        }

        res.data.content.forEach(r => {
          const card = buildReviewCard(r);
          reviewsList.appendChild(card);
        });

        // Rating breakdown
        if (page === 0 && res.data.ratingBreakdown) {
          updateRatingBreakdown(res.data.ratingBreakdown);
        }

        const hasMore = !res.data.last;
        if (loadMore) loadMore.classList.toggle('hidden', !hasMore);
        if (hasMore) page++;

      } catch (_) {
        // Silently skip — reviews are non-critical
      }
    }

    function buildReviewCard(r) {
      const div = document.createElement('div');
      div.className = 'review-card';
      const initials = (r.guestName || 'G').slice(0, 1);
      const stars = [1,2,3,4,5].map(i =>
        `<svg class="review-star${i <= Math.round(r.overallRating) ? ' review-star--filled' : ''}"
              width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>`
      ).join('');
      const date = r.createdAt ? window.StaySphere.formatRelTime(r.createdAt) : '';
      div.innerHTML = `
        <div class="review-card__header">
          <div class="review-card__avatar">
            ${r.guestAvatarUrl
              ? `<img src="${r.guestAvatarUrl}" alt="${r.guestName}" width="40" height="40" loading="lazy">`
              : `<span class="review-card__avatar-initials">${initials}</span>`}
          </div>
          <div class="review-card__meta">
            <p class="review-card__name">${r.guestName || 'Guest'}</p>
            <p class="review-card__date">${date}</p>
          </div>
        </div>
        <div class="review-card__stars" aria-label="${r.overallRating} out of 5">${stars}</div>
        <p class="review-card__comment">${r.comment || ''}</p>
        ${r.hostResponse ? `
          <div class="review-card__host-response">
            <p class="review-card__host-response-label">Response from host</p>
            <p class="review-card__host-response-text">${r.hostResponse}</p>
          </div>` : ''}`;
      return div;
    }

    function updateRatingBreakdown(breakdown) {
      const container = $('rating-breakdown');
      if (!container) return;
      const dims = { Cleanliness: breakdown.cleanliness, Accuracy: breakdown.accuracy,
                     Communication: breakdown.communication, Location: breakdown.location,
                     Value: breakdown.value };
      container.innerHTML = Object.entries(dims).map(([label, val]) => {
        const pct = val ? (val / 5 * 100).toFixed(0) : 0;
        return `<div class="rating-bar">
          <span class="rating-bar__label">${label}</span>
          <div class="rating-bar__track" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
            <div class="rating-bar__fill" style="width:${pct}%"></div>
          </div>
          <span class="rating-bar__value">${val ? val.toFixed(1) : '–'}</span>
        </div>`;
      }).join('');
    }

    if (loadMore) loadMore.addEventListener('click', loadReviews);
    loadReviews();
  }

  // ─── Area intelligence ─────────────────────────────────────────────────────
  async function initAreaIntelligence() {
    const section = $('area-intelligence');
    if (!section) return;

    const propertyId = section.dataset.propertyId;
    const city       = section.dataset.city;
    const grid       = $('area-grid');
    if (!grid) return;

    try {
      const res = await window.StaySphere.api(
        `/api/v1/ai/area-intelligence/${propertyId}?city=${encodeURIComponent(city)}`
      );
      if (!res.success || !res.data?.nearbyAttractions?.length) return;

      grid.innerHTML = res.data.nearbyAttractions.slice(0, 6).map(a => `
        <div class="area-card">
          <span class="area-card__icon" aria-hidden="true">${getAttractionIcon(a.type)}</span>
          <div class="area-card__info">
            <p class="area-card__name">${a.name}</p>
            <p class="area-card__dist">${a.distanceKm ? a.distanceKm + ' km away' : ''}</p>
          </div>
        </div>`).join('');

      if (res.data.weatherData) {
        const w = res.data.weatherData;
        grid.insertAdjacentHTML('beforeend', `
          <div class="area-card area-card--weather">
            <span class="area-card__icon" aria-hidden="true">${getWeatherIcon(w.condition)}</span>
            <div class="area-card__info">
              <p class="area-card__name">${w.condition}</p>
              <p class="area-card__dist">${w.temperatureMax}°C high · ${w.temperatureMin}°C low</p>
            </div>
          </div>`);
      }
    } catch (_) {}
  }

  function getAttractionIcon(type) {
    const map = { NATIONAL_PARK: '🦁', RESTAURANT: '🍽', SUPERMARKET: '🛒',
                  HOSPITAL: '🏥', AIRPORT: '✈', BEACH: '🌊', MOUNTAIN: '⛰',
                  MUSEUM: '🏛', ACTIVITY: '🎯' };
    return map[type] || '📍';
  }
  function getWeatherIcon(condition) {
    if (!condition) return '☀';
    const c = condition.toLowerCase();
    if (c.includes('rain')) return '🌧';
    if (c.includes('cloud')) return '⛅';
    if (c.includes('storm')) return '⛈';
    if (c.includes('hot')) return '🌡';
    return '☀';
  }

  // ─── Host card ─────────────────────────────────────────────────────────────
  async function initHostCard() {
    const card = $('host-card');
    if (!card) return;
    const propertyId = document.querySelector('[data-property-id]')?.dataset.propertyId;
    if (!propertyId) return;
    try {
      const res = await window.StaySphere.api(`/api/v1/properties/${propertyId}/host`);
      if (!res.success || !res.data) return;
      const h = res.data;
      const initials = (h.firstName || 'H').slice(0, 1) + (h.lastName || '').slice(0, 1);
      card.innerHTML = `
        <div class="host-card__avatar" aria-hidden="true">
          ${h.profileImageUrl
            ? `<img src="${h.profileImageUrl}" alt="${h.firstName}" width="56" height="56" class="host-card__img" loading="lazy">`
            : `<span class="host-card__initials">${initials}</span>`}
        </div>
        <div class="host-card__info">
          <p class="host-card__name">${h.firstName || 'Your host'} ${h.lastName || ''}</p>
          <p class="host-card__since">Host since ${h.memberSince || 'recently'}</p>
          ${h.bio ? `<p class="host-card__bio">${h.bio}</p>` : ''}
          <div class="host-card__stats">
            ${h.responseRate ? `<span>💬 ${h.responseRate}% response rate</span>` : ''}
            ${h.trustScore >= 80 ? '<span>✓ Verified host</span>' : ''}
          </div>
        </div>`;
    } catch (_) {}
  }

  // ─── Share ─────────────────────────────────────────────────────────────────
  function initShare() {
    const shareBtn   = $('product-share-btn');
    const wishlistBtn = $('sidebar-wishlist-btn');
    const propertyId = document.querySelector('[data-property-id]')?.dataset.propertyId;

    if (shareBtn) {
      shareBtn.addEventListener('click', async () => {
        const data = { title: document.title, url: window.location.href };
        if (navigator.share) {
          try { await navigator.share(data); } catch (_) {}
        } else {
          await navigator.clipboard.writeText(window.location.href).catch(() => {});
          window.StaySphere.toast('Link copied to clipboard');
        }
      });
    }

    if (wishlistBtn && propertyId) {
      const saved = window.StaySphere?.wishlist.has(propertyId);
      wishlistBtn.setAttribute('aria-pressed', saved);
      if (saved) wishlistBtn.querySelector('svg')?.setAttribute('fill', 'currentColor');

      wishlistBtn.addEventListener('click', () => {
        const added = window.StaySphere.wishlist.toggle(propertyId);
        wishlistBtn.setAttribute('aria-pressed', added);
        wishlistBtn.querySelector('svg')?.setAttribute('fill', added ? 'currentColor' : 'none');
        window.StaySphere.toast(added ? 'Saved to wishlist' : 'Removed from wishlist');
      });
    }
  }

  // ─── Google Maps ───────────────────────────────────────────────────────────
  function initMap() {
    const mapEl = $('property-map');
    if (!mapEl) return;
    const apiKey = document.body.dataset.mapsKey ||
                   document.querySelector('[data-maps-key]')?.dataset.mapsKey;
    if (!apiKey) return;

    const lat = parseFloat(mapEl.dataset.lat);
    const lng = parseFloat(mapEl.dataset.lng);
    const title = mapEl.dataset.title;

    const script = document.createElement('script');
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=initGoogleMap`;
    window.initGoogleMap = () => {
      const map = new google.maps.Map(mapEl, {
        center: { lat, lng }, zoom: 13,
        disableDefaultUI: true,
        zoomControl: true, mapTypeControl: false,
        styles: [{ featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] }],
      });
      new google.maps.Marker({ position: { lat, lng }, map, title });
    };
    document.head.appendChild(script);
  }

  // ─── Plugin entry point ───────────────────────────────────────────────────
  const ProductPlugin = {
    init() {
      if (!document.querySelector('.main-product')) return;
      initGallery();
      initDescriptionToggle();
      initBookingWidget();
      initReviews();
      initAreaIntelligence();
      initHostCard();
      initShare();
      initMap();
    },
  };

  document.addEventListener('DOMContentLoaded', () => {
    ProductPlugin.init();
  });

})();
