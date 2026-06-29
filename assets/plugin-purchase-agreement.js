/**
 * StaySphere AOS — plugin-purchase-agreement.js
 * Phase 7: E-signature page for purchase agreements.
 * Loaded only on /pages/purchase-agreement.
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const api = (path, opts) => window.StaySphere.api(path, opts);
  const esc = s => String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  function fmt(n) {
    const i18n = window.StaySphere?.i18n;
    if (i18n?.fx?.loaded) {
      const base = document.body.dataset.currency || 'USD';
      return i18n.fx.format(Number(n || 0), base, i18n.currentCurrency());
    }
    return (document.body.dataset.currencySymbol || '$') +
           Number(n || 0).toLocaleString('en-US');
  }

  function show(id)  { $(id)?.classList.remove('hidden'); }
  function hide(id)  { $(id)?.classList.add('hidden'); }
  function setText(id, t) { const el = $(id); if (el) el.textContent = t; }
  function setLoading(on) {
    const btn = $('pa-submit-btn');
    if (!btn) return;
    btn.disabled = on;
    btn.querySelector('.btn-label')?.classList.toggle('hidden', on);
    btn.querySelector('.btn-spinner')?.classList.toggle('hidden', !on);
  }

  // ── Canvas signature ──────────────────────────────────────────
  let canvas, ctx, drawing = false, hasDrawing = false;

  function initCanvas() {
    canvas = $('pa-sig-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#111';
    ctx.lineWidth   = 2.5;
    ctx.lineCap     = 'round';

    const getPos = e => {
      const r = canvas.getBoundingClientRect();
      const src = e.touches ? e.touches[0] : e;
      return { x: src.clientX - r.left, y: src.clientY - r.top };
    };

    const start = e => { drawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault(); };
    const move  = e => { if (!drawing) return; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); hasDrawing = true; e.preventDefault(); };
    const end   = () => { drawing = false; };

    canvas.addEventListener('mousedown',  start);
    canvas.addEventListener('mousemove',  move);
    canvas.addEventListener('mouseup',    end);
    canvas.addEventListener('mouseleave', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove',  move,  { passive: false });
    canvas.addEventListener('touchend',   end);

    $('pa-sig-clear')?.addEventListener('click', () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      hasDrawing = false;
    });
  }

  function getSignatureData(mode) {
    if (mode === 'draw') {
      if (!hasDrawing) return null;
      return canvas.toDataURL('image/png'); // base64 PNG
    } else {
      return $('pa-sig-text')?.value?.trim() || null;
    }
  }

  // ── Tab switching ─────────────────────────────────────────────
  let currentMode = 'draw';
  function initTabs() {
    [$('pa-tab-draw'), $('pa-tab-type')].forEach(tab => {
      tab?.addEventListener('click', () => {
        currentMode = tab.dataset.mode;
        $('pa-tab-draw')?.classList.toggle('pa-sig-tab--active', currentMode === 'draw');
        $('pa-tab-type')?.classList.toggle('pa-sig-tab--active', currentMode === 'type');
        document.getElementById('pa-draw-mode')?.classList.toggle('hidden', currentMode !== 'draw');
        document.getElementById('pa-type-mode')?.classList.toggle('hidden', currentMode !== 'type');
      });
    });

    // Live preview for typed signature
    $('pa-sig-text')?.addEventListener('input', function () {
      setText('pa-sig-text-preview', this.value);
    });
  }

  // ── Load agreement details ────────────────────────────────────
  async function loadAgreement(token, role) {
    // Derive lot from URL or fetch by token (server validates token)
    // We call the signing endpoint's GET equivalent to show the agreement summary
    try {
      // Try to look up agreement — server will validate the token on sign POST
      // For display, we can try the lot-scoped endpoint if lot is in URL
      const params = new URLSearchParams(window.location.search);
      const lotId  = params.get('lot');
      if (lotId) {
        const res = await api(`/api/v1/agreements?lotId=${lotId}`);
        if (res.success && res.data) {
          renderSummary(res.data, role);
          const deadline = res.data.paymentDeadline;
          if (deadline) {
            const i18n = window.StaySphere?.i18n;
            const tz   = i18n?.time?.timezone || 'UTC';
            const dt   = new Intl.DateTimeFormat('en-US', {
              timeZone: tz, day: 'numeric', month: 'long', year: 'numeric'
            }).format(new Date(deadline));
            setText('pa-deadline-value', dt);
          }
          // Check if already signed
          if (role === 'buyer' && res.data.buyerSignedAt) {
            hide('pa-form-card'); show('pa-already-signed'); return;
          }
          if (role === 'seller' && res.data.sellerSignedAt) {
            hide('pa-form-card'); show('pa-already-signed'); return;
          }
        }
      }
    } catch (_) { /* agreement details optional — token validates on submit */ }

    hide('pa-loading');
    show('pa-form-card');
  }

  function renderSummary(agreement, role) {
    const summary = $('pa-summary');
    if (!summary) return;
    const rows = [
      ['Property', agreement.lotTitle || 'Lot ' + agreement.lotId],
      ['Winning amount',  fmt(agreement.winningAmount)],
      ['Deposit applied', fmt(agreement.depositAmount)],
      ['Balance due',     fmt(agreement.balanceDue)],
      ['Your role',       role === 'buyer' ? 'Buyer' : 'Seller'],
    ];
    summary.innerHTML = `<table class="pa-summary-table">
      ${rows.map(([k,v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}
    </table>`;
  }

  // ── Submit signature ──────────────────────────────────────────
  async function submitSignature(token, role) {
    const sigData = getSignatureData(currentMode);
    if (!sigData) {
      const errEl = $('pa-submit-error');
      if (errEl) { errEl.textContent = 'Please draw or type your signature first.'; errEl.classList.remove('hidden'); }
      return;
    }

    setLoading(true);
    const errEl = $('pa-submit-error');
    if (errEl) errEl.classList.add('hidden');

    try {
      const endpoint = role === 'buyer'
        ? `/api/v1/agreements/sign/buyer?token=${encodeURIComponent(token)}`
        : `/api/v1/agreements/sign/seller?token=${encodeURIComponent(token)}`;

      const res = await api(endpoint, {
        method: 'POST',
        body: JSON.stringify({ signatureData: sigData }),
      });

      if (res.success) {
        hide('pa-form-card');
        show('pa-success');
        const status = res.data?.status;
        if (status === 'FULLY_EXECUTED') {
          setText('pa-success-title', '✅ Agreement fully signed!');
          setText('pa-success-msg',
            'Both parties have signed. Conveyancing has been initiated. ' +
            'Check your email for next steps.');
        } else if (role === 'buyer') {
          setText('pa-success-title', '✅ Your signature has been recorded');
          setText('pa-success-msg',
            "We've notified the seller. You'll receive an email once they sign.");
        } else {
          setText('pa-success-title', '✅ Signature recorded');
          setText('pa-success-msg', res.message || 'Your signature has been recorded.');
        }
      } else {
        if (errEl) { errEl.textContent = res.message || 'Signing failed. Please try again.'; errEl.classList.remove('hidden'); }
        if (res.message?.includes('expired')) {
          hide('pa-form-card'); show('pa-error');
        }
      }
    } catch (_) {
      if (errEl) { errEl.textContent = 'Unable to submit. Please check your connection and try again.'; errEl.classList.remove('hidden'); }
    } finally {
      setLoading(false);
    }
  }

  // ── Init ──────────────────────────────────────────────────────
  async function init() {
    const page  = $('purchase-agreement-page');
    if (!page) return;

    const role  = page.dataset.role  || 'buyer';
    const token = page.dataset.token || '';

    if (!token) {
      hide('pa-loading');
      show('pa-error');
      return;
    }

    initCanvas();
    initTabs();

    await loadAgreement(token, role);

    $('pa-submit-btn')?.addEventListener('click', () =>
      submitSignature(token, role));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
