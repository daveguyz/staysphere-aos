/**
 * StaySphere AOS — plugin-auth.js
 * Phase E: Authentication, KYC, Deposit, Account, Auction Success
 *
 * Handles:
 *  - Login / Register / Forgot-password forms (auth-service JWT)
 *  - KYC page: create Stripe Identity session, poll status, step transitions
 *  - Deposit page: load lot summary, Stripe Elements card form, submit hold
 *  - Account page: load bid history, won lots, deposits, KYC status, bookings
 *  - Auction success page: load lot result, show win/loss state
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const api = (path, opts) => window.StaySphere.api(path, opts);
  const toast = (msg, type) => window.StaySphere.toast(msg, type);
  const sym = () => document.body.dataset.currencySymbol ||
    document.querySelector('[data-currency-symbol]')?.dataset.currencySymbol || '$';
  function fmt(n) {
    const i18n = window.StaySphere?.i18n;
    if (i18n?.fx?.loaded) {
      const base = document.body.dataset.currency || 'USD';
      const to   = i18n.currentCurrency();
      return i18n.fx.format(Number(n || 0), base, to);
    }
    return sym() + Number(n || 0).toLocaleString('en-US');
  }
  function fmtDateLocale(d) {
    if (!d) return '';
    const i18n = window.StaySphere?.i18n;
    const tz   = i18n?.time?.timezone || 'UTC';
    const lang = i18n?.currentLanguage?.() || 'en';
    const langMap = { en:'en-US', fr:'fr-FR', es:'es-ES', de:'de-DE', pt:'pt-BR', ar:'ar-SA', zh:'zh-CN' };
    const bcp47 = langMap[lang] || 'en-US';
    try {
      return new Intl.DateTimeFormat(bcp47, {
        timeZone: tz, day:'numeric', month:'short', year:'numeric'
      }).format(new Date(d));
    } catch (_) { return new Date(d).toLocaleDateString(); }
  }
  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  function setLoading(btnId, loading) {
    const btn = $(btnId);
    if (!btn) return;
    btn.disabled = loading;
    btn.querySelector('.btn-label')?.classList.toggle('hidden', loading);
    btn.querySelector('.btn-spinner')?.classList.toggle('hidden', !loading);
  }

  // ══════════════════════════════════════════════════════════
  // AUTH FORMS (login / register / forgot / reset)
  // ══════════════════════════════════════════════════════════
  // ── JWT role decoder ────────────────────────────────────────────────────
  // Decodes the roles claim from the JWT payload (base64 middle segment).
  // No signature verification — the server already verified it.
  // Returns an array of role strings, e.g. ['GUEST', 'auctioneer'].
  function decodeTokenRoles(token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const roles = payload.roles || payload.authorities || [];
      return Array.isArray(roles) ? roles.map(r => String(r).toLowerCase()) : [];
    } catch (_) {
      return [];
    }
  }

  // ── Post-login redirect ──────────────────────────────────────────────────
  // Priority order (first match wins):
  //   1. return_to param — honours mid-session redirects (e.g. room → login → back)
  //   2. intent=auctioneer + has auctioneer role → /pages/auctioneer-dashboard
  //   3. intent=auctioneer + NO auctioneer role  → stay, show inline error
  //   4. has admin / superadmin                  → /pages/admin
  //   5. has host                                → /pages/host-dashboard
  //   6. default                                 → /account
  function resolvePostLoginRedirect(token) {
    const roles   = decodeTokenRoles(token);
    const params  = new URLSearchParams(window.location.search);
    const returnTo = params.get('return_to');
    const intent  = sessionStorage.getItem('ss_login_intent') || 'bidder';

    // Rule 1 — explicit return_to (safe-origin check)
    if (returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')) {
      return { redirect: returnTo };
    }

    // Rule 2 / 3 — auctioneer intent
    if (intent === 'auctioneer') {
      if (roles.includes('auctioneer')) {
        return { redirect: '/pages/auctioneer-dashboard' };
      } else {
        return {
          redirect: null,
          error: 'This account does not have auctioneer access. '
               + 'Contact your platform administrator to request access.',
        };
      }
    }

    // Rule 4 — admin
    if (roles.includes('admin') || roles.includes('superadmin')) {
      return { redirect: '/pages/admin' };
    }

    // Rule 5 — host / agent
    if (roles.includes('host')) {
      return { redirect: '/pages/host-dashboard' };
    }

    // Rule 6 — default
    return { redirect: '/account' };
  }

  function initLogin() {
    const form = $('login-form');
    if (!form) return;

    // ── Intent selector ────────────────────────────────────────────────────
    const intentGroup = $('login-intent-group');
    if (intentGroup) {
      // Restore last intent from sessionStorage
      const saved = sessionStorage.getItem('ss_login_intent') || 'bidder';
      setIntent(saved);

      intentGroup.querySelectorAll('.login-intent__btn').forEach(btn => {
        btn.addEventListener('click', () => setIntent(btn.dataset.intent));
      });

      // Keyboard: arrow keys cycle between Bidder and Auctioneer
      intentGroup.addEventListener('keydown', e => {
        const btns = [...intentGroup.querySelectorAll('.login-intent__btn')];
        const idx  = btns.indexOf(document.activeElement);
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          btns[(idx + 1) % btns.length].focus();
          setIntent(btns[(idx + 1) % btns.length].dataset.intent);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          btns[(idx - 1 + btns.length) % btns.length].focus();
          setIntent(btns[(idx - 1 + btns.length) % btns.length].dataset.intent);
        }
      });
    }

    function setIntent(intent) {
      sessionStorage.setItem('ss_login_intent', intent);
      if (!intentGroup) return;
      intentGroup.querySelectorAll('.login-intent__btn').forEach(btn => {
        const active = btn.dataset.intent === intent;
        btn.classList.toggle('login-intent__btn--active', active);
        btn.setAttribute('aria-checked', String(active));
      });
    }

    // Pre-fill email from URL param (e.g. after registration)
    const urlEmail = new URLSearchParams(window.location.search).get('email');
    if (urlEmail) {
      const emailEl = $('login-email');
      if (emailEl) emailEl.value = urlEmail;
    }

    // ── Form submit ────────────────────────────────────────────────────────
    form.addEventListener('submit', async e => {
      e.preventDefault();
      setLoading('login-btn', true);
      clearError('auth-error');
      try {
        const res = await api('/api/v1/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            email:    form.querySelector('#login-email').value.trim(),
            password: form.querySelector('#login-password').value,
          }),
        });
        if (res.success) {
          window.StaySphere.auth.setToken(res.data.accessToken);
          window.StaySphere.auth.setRefresh(res.data.refreshToken);

          const result = resolvePostLoginRedirect(res.data.accessToken);

          if (result.error) {
            // Intent mismatch — show error and stay on the page
            showError('auth-error', result.error);
            // Reset intent to bidder so the user isn't stuck
            setIntent('bidder');
            return;
          }

          // Clear intent after a successful redirect so next login starts fresh
          sessionStorage.removeItem('ss_login_intent');
          window.location.href = result.redirect;
        } else {
          showError('auth-error', res.message || 'Invalid email or password');
        }
      } catch (_) {
        showError('auth-error', 'Unable to sign in. Please try again.');
      } finally {
        setLoading('login-btn', false);
      }
    });

    // Toggle password visibility
    form.querySelector('.form-field__toggle-password')?.addEventListener('click', () => {
      const pw = $('login-password');
      if (!pw) return;
      pw.type = pw.type === 'password' ? 'text' : 'password';
    });
  }

  function initRegister() {
    const form = $('register-form');
    if (!form) return;

    // Password strength indicator
    const pwInput = $('reg-password');
    const strengthEl = $('password-strength');
    if (pwInput && strengthEl) {
      pwInput.addEventListener('input', () => {
        const strength = measurePasswordStrength(pwInput.value);
        strengthEl.innerHTML = `
          <div class="password-strength-bar">
            <div class="password-strength-bar__fill password-strength-bar__fill--${strength.level}"
                 style="width:${strength.pct}%"></div>
          </div>
          <span class="password-strength-label password-strength-label--${strength.level}">
            ${strength.label}
          </span>`;
      });
    }

    form.addEventListener('submit', async e => {
      e.preventDefault();
      setLoading('register-btn', true);
      clearError('auth-error');

      const firstName = form.querySelector('#reg-first-name')?.value.trim();
      const lastName  = form.querySelector('#reg-last-name')?.value.trim();
      const email     = form.querySelector('#reg-email')?.value.trim();
      const phone     = form.querySelector('#reg-phone')?.value.trim();
      const password  = form.querySelector('#reg-password')?.value;
      const becomeHost = form.querySelector('#reg-host')?.checked;

      if (!form.querySelector('#reg-terms')?.checked) {
        showError('auth-error', 'Please accept the Terms of Service to continue.');
        setLoading('register-btn', false);
        return;
      }

      try {
        const res = await api('/api/v1/auth/register', {
          method: 'POST',
          body: JSON.stringify({ firstName, lastName, email, phone, password,
                                 role: becomeHost ? 'HOST_PENDING' : 'GUEST' }),
        });
        if (res.success) {
          // Auto-login after registration
          const loginRes = await api('/api/v1/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password }),
          });
          if (loginRes.success) {
            window.StaySphere.auth.setToken(loginRes.data.accessToken);
            window.StaySphere.auth.setRefresh(loginRes.data.refreshToken);
          }
          const returnTo = new URLSearchParams(window.location.search).get('return_to') || '/account';
          window.location.href = returnTo;
        } else {
          showError('auth-error', res.message || 'Registration failed. Please try again.');
        }
      } catch (_) {
        showError('auth-error', 'Unable to create account. Please try again.');
      } finally {
        setLoading('register-btn', false);
      }
    });
  }

  function measurePasswordStrength(pw) {
    let score = 0;
    if (pw.length >= 8)  score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    const levels = ['weak','fair','good','strong','very-strong'];
    const labels = ['Too weak','Fair','Good','Strong','Very strong'];
    const pcts   = [20, 40, 60, 80, 100];
    const i = Math.min(score, 4);
    return { level: levels[i], label: labels[i], pct: pcts[i] };
  }

  // ══════════════════════════════════════════════════════════
  // KYC PAGE
  // ══════════════════════════════════════════════════════════
  function initKycPage() {
    const page = $('kyc-page');
    if (!page) return;

    const lotId = page.dataset.lotId;
    const returnTo = page.dataset.returnTo;

    // Check if user is logged in
    if (!window.StaySphere?.auth?.getToken()) {
      window.location.href = `/account/login?return_to=${encodeURIComponent(window.location.href)}`;
      return;
    }

    // Load current KYC status
    loadKycStatus(page);

    // Start button
    $('kyc-start-btn')?.addEventListener('click', async () => {
      setLoading('kyc-start-btn', true);
      try {
        const res = await api(`/api/v1/kyc/session?lotId=${lotId}`, { method: 'POST' });
        if (res.success && res.data) {
          if (res.data.status === 'VERIFIED') {
            showKycStep('verified');
          } else if (res.data.verificationUrl) {
            const link = $('kyc-continue-link');
            if (link) link.href = res.data.verificationUrl;
            showKycStep('pending');
          }
        } else {
          toast(res.message || 'Could not start KYC session', 'error');
        }
      } catch (_) {
        toast('KYC service unavailable. Please try again.', 'error');
      } finally {
        setLoading('kyc-start-btn', false);
      }
    });

    // Check status button
    $('kyc-check-status-btn')?.addEventListener('click', () => loadKycStatus(page));
    $('kyc-refresh-btn')?.addEventListener('click', () => loadKycStatus(page));
    $('kyc-retry-btn')?.addEventListener('click', () => showKycStep('start'));

    // Auto-poll if in PROCESSING state
    let pollInterval = null;
    function maybePoll(status) {
      if (status === 'PROCESSING' || status === 'SESSION_CREATED') {
        if (!pollInterval) {
          pollInterval = setInterval(() => loadKycStatus(page), 5000);
        }
      } else {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    }

    async function loadKycStatus(page) {
      try {
        const res = await api('/api/v1/kyc/status');
        if (!res.success) return;

        const record = res.data;
        const status = record.status || 'NOT_STARTED';

        // Update badge
        const wrap = $('kyc-status-wrap');
        if (wrap) {
          const badge = buildKycBadge(status);
          wrap.innerHTML = badge;
        }
        // Show skeleton off
        $('kyc-status-skeleton')?.remove();

        // Transition to correct step
        if (status === 'VERIFIED') {
          showKycStep('verified');
        } else if (status === 'FAILED') {
          showKycStep('failed');
        } else if (status === 'REQUIRES_INPUT') {
          const link = $('kyc-fix-link');
          if (link && record.verificationUrl) link.href = record.verificationUrl;
          showKycStep('requires-input');
        } else if (status === 'PROCESSING') {
          showKycStep('processing');
        } else if (status === 'SESSION_CREATED') {
          const link = $('kyc-continue-link');
          if (link && record.verificationUrl) link.href = record.verificationUrl;
          showKycStep('pending');
        } else {
          showKycStep('start');
        }
        maybePoll(status);
      } catch (_) {
        showKycStep('start');
      }
    }
  }

  function showKycStep(name) {
    ['start','pending','processing','verified','failed','requires-input'].forEach(n => {
      const el = document.getElementById(`kyc-step-${n}`);
      if (el) el.classList.toggle('hidden', n !== name);
    });
  }

  function buildKycBadge(status) {
    const map = {
      VERIFIED:        { label: '✓ Identity verified',         cls: 'kyc-badge--verified' },
      PROCESSING:      { label: '⏳ Verification in review',   cls: 'kyc-badge--processing' },
      SESSION_CREATED: { label: '🔗 Verification pending',     cls: 'kyc-badge--pending' },
      REQUIRES_INPUT:  { label: '⚠ More info needed',          cls: 'kyc-badge--requires-input' },
      FAILED:          { label: '✗ Verification failed',       cls: 'kyc-badge--failed' },
      CANCELLED:       { label: '– Cancelled',                 cls: 'kyc-badge--cancelled' },
      NOT_STARTED:     { label: '○ Not started',               cls: 'kyc-badge--not-started' },
    };
    const s = map[status] || map.NOT_STARTED;
    return `<span class="kyc-status-badge ${s.cls}">${s.label}</span>`;
  }

  // ══════════════════════════════════════════════════════════
  // DEPOSIT PAGE (Stripe Elements card form)
  // ══════════════════════════════════════════════════════════
  function initDepositPage() {
    const page = $('deposit-page');
    if (!page) return;

    const lotId    = page.dataset.lotId;
    const stripeKey = page.dataset.stripeKey;
    const returnTo  = page.dataset.returnTo;

    if (!window.StaySphere?.auth?.getToken()) {
      window.location.href = `/account/login?return_to=${encodeURIComponent(window.location.href)}`;
      return;
    }

    if (!lotId) {
      toast('No auction lot specified', 'error');
      return;
    }

    // 1. Check if already deposited
    api(`/api/v1/auctions/${lotId}/deposit/status`)
      .then(res => {
        if (res.data === true) {
          showDepositState('paid');
          return;
        }
        // 2. Load lot info
        loadDepositLotInfo(lotId, stripeKey);
      })
      .catch(() => loadDepositLotInfo(lotId, stripeKey));
  }

  async function loadDepositLotInfo(lotId, stripeKey) {
    try {
      const res = await api(`/api/v1/auctions/${lotId}`);
      if (!res.success) throw new Error('Lot not found');

      const lot = res.data;
      const amount = lot.depositAmount;

      // Render lot summary
      const summaryEl = $('deposit-lot-summary');
      if (summaryEl) {
        summaryEl.innerHTML = `
          <div class="deposit-lot-summary__inner">
            <p class="deposit-lot-summary__title">${esc(lot.title)}</p>
            <p class="deposit-lot-summary__location">📍 ${esc(lot.propertyCity || '')}</p>
          </div>`;
      }

      // Render amount
      const amountEl = $('deposit-amount-value');
      if (amountEl) amountEl.textContent = fmt(amount);
      const btnAmountEl = $('deposit-btn-amount');
      if (btnAmountEl) btnAmountEl.textContent = fmt(amount);
      const summaryAmount = $('deposit-summary-amount');
      if (summaryAmount) summaryAmount.textContent = fmt(amount);

      // Init Stripe Elements
      initStripeElements(stripeKey, lot, amount);

    } catch (e) {
      toast('Could not load lot details: ' + e.message, 'error');
    }
  }

  function initStripeElements(stripeKey, lot, amount) {
    if (!stripeKey) {
      // Mock mode — just show a placeholder form
      const mountEl = $('stripe-card-element');
      const placeholder = $('stripe-element-placeholder');
      if (placeholder) placeholder.innerHTML = '<p style="font-size:.875rem;color:var(--color-text-muted);padding:14px;">Payment processing (Stripe key not configured)</p>';
      initDepositSubmit(null, null, lot, amount);
      return;
    }

    // Load Stripe.js
    const script = document.createElement('script');
    script.src = 'https://js.stripe.com/v3/';
    script.onload = () => {
      const stripe = window.Stripe(stripeKey);
      const elements = stripe.elements();
      const card = elements.create('card', {
        style: {
          base: {
            fontSize: '16px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            color: getComputedStyle(document.body).getPropertyValue('--color-text').trim() || '#1a1a2e',
            '::placeholder': { color: '#9ca3af' },
          },
        },
      });

      const mountEl = $('stripe-card-element');
      const placeholder = $('stripe-element-placeholder');
      if (placeholder) placeholder.remove();
      card.mount(mountEl);

      card.on('change', e => {
        const errEl = $('stripe-card-errors');
        if (errEl) errEl.textContent = e.error ? e.error.message : '';
      });

      initDepositSubmit(stripe, card, lot, amount);
    };
    document.head.appendChild(script);
  }

  function initDepositSubmit(stripe, card, lot, amount) {
    const btn = $('deposit-pay-btn');
    if (!btn) return;

    btn.addEventListener('click', async () => {
      setLoading('deposit-pay-btn', true);
      clearError('deposit-error');

      try {
        let paymentMethodId = 'pm_mock_deposit';

        // Real Stripe flow
        if (stripe && card) {
          const holder = $('deposit-card-holder')?.value.trim();
          const { paymentMethod, error } = await stripe.createPaymentMethod({
            type: 'card',
            card,
            billing_details: { name: holder },
          });
          if (error) {
            showError('deposit-error', error.message);
            setLoading('deposit-pay-btn', false);
            return;
          }
          paymentMethodId = paymentMethod.id;
        }

        // Send to API
        const res = await api(`/api/v1/auctions/${lot.id}/deposit`, {
          method: 'POST',
          body: JSON.stringify({ stripePaymentMethodId: paymentMethodId }),
        });

        if (res.success) {
          const amountEl = $('deposit-success-amount');
          if (amountEl) amountEl.textContent = fmt(amount);
          showDepositState('success');
          toast('Deposit held — you can now bid!', 'success');
        } else {
          showError('deposit-error', res.message || 'Deposit failed. Please try again.');
        }
      } catch (e) {
        showError('deposit-error', e.message || 'Payment failed. Please try again.');
      } finally {
        setLoading('deposit-pay-btn', false);
      }
    });
  }

  function showDepositState(state) {
    // state: 'form' | 'paid' | 'success'
    const formWrap   = $('deposit-form-wrap');
    const paidState  = $('deposit-paid-state');
    const successState = $('deposit-success-state');
    if (formWrap) formWrap.classList.toggle('hidden', state !== 'form');
    if (paidState) paidState.classList.toggle('hidden', state !== 'paid');
    if (successState) successState.classList.toggle('hidden', state !== 'success');
  }

  // ══════════════════════════════════════════════════════════
  // AUCTION SUCCESS PAGE
  // ══════════════════════════════════════════════════════════
  function initAuctionSuccessPage() {
    const page = $('auction-success-page');
    if (!page) return;

    const lotId = page.dataset.lotId;
    if (!lotId) return;

    api(`/api/v1/auctions/${lotId}`)
      .then(res => {
        if (!res.success) return;
        const lot = res.data;

        // Render lot summary
        const summaryEl = $('success-lot-summary');
        if (summaryEl) {
          summaryEl.innerHTML = `
            <p class="auction-success-card__lot-title">${esc(lot.title)}</p>
            <p class="auction-success-card__lot-location">📍 ${esc(lot.propertyCity || '')}</p>`;
        }

        // Render winning amount
        const amtEl = $('success-winning-amount');
        if (amtEl) amtEl.textContent = fmt(lot.winningAmount);

        // Determine if current user is the winner
        const currentUserId = window.StaySphere?.config?.customerId;
        const isWinner = !currentUserId || lot.winnerId === currentUserId
            || !lot.winnerId; // show win card if no winner ID available (anonymous check)

        if (!isWinner) {
          $('auction-success-card')?.classList.add('hidden');
          $('auction-loss-card')?.classList.remove('hidden');
          return;
        }

        // Deposit status
        if (lot.depositRequired) {
          api(`/api/v1/auctions/${lotId}/deposit/status`)
            .then(dRes => {
              const statusEl = $('success-deposit-status');
              const bodyEl   = $('step-deposit-body');
              if (dRes.data === true) {
                if (statusEl) statusEl.innerHTML = buildDepositBadge('CHARGED');
                if (bodyEl) bodyEl.textContent = 'Your deposit has been applied towards the purchase.';
              } else {
                if (statusEl) statusEl.innerHTML = buildDepositBadge('RELEASED');
              }
            })
            .catch(() => {});
        } else {
          const stepEl = $('step-deposit');
          if (stepEl) stepEl.classList.add('hidden');
        }
      })
      .catch(() => {});
  }

  function buildDepositBadge(status) {
    const map = {
      HELD:     { label: '🔒 Deposit held', cls: 'deposit-badge--held' },
      RELEASED: { label: '✓ Deposit released', cls: 'deposit-badge--released' },
      CHARGED:  { label: '💳 Deposit applied', cls: 'deposit-badge--charged' },
    };
    const s = map[status] || { label: status, cls: '' };
    return `<span class="deposit-status-badge ${s.cls}">${s.label}</span>`;
  }

  // ══════════════════════════════════════════════════════════
  // ACCOUNT PAGE
  // ══════════════════════════════════════════════════════════
  function initAccountPage() {
    const page = $('account-page');
    if (!page) return;

    if (!window.StaySphere?.auth?.getToken()) {
      window.location.href = `/account/login?return_to=/account`;
      return;
    }

    initAccountTabs();
    loadAccountProfile();
    loadMyBids();

    // Reload bid/deposit amounts on currency change
    document.addEventListener('ss:currency-changed', () => {
      loadMyBids();
      const depositsPanel = document.getElementById('panel-deposits');
      if (depositsPanel?.dataset.loaded) loadMyDeposits();
    });

    $('account-logout-btn')?.addEventListener('click', () => {
      window.StaySphere.auth.clear();
      window.location.href = '/';
    });
  }

  function initAccountTabs() {
    document.querySelectorAll('.account-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.account-tab').forEach(t => {
          t.classList.remove('account-tab--active');
          t.setAttribute('aria-selected', 'false');
        });
        document.querySelectorAll('.account-panel').forEach(p => p.classList.add('hidden'));

        tab.classList.add('account-tab--active');
        tab.setAttribute('aria-selected', 'true');
        const panel = $(tab.dataset.panel);
        if (panel) panel.classList.remove('hidden');

        // Lazy-load panel content on first visit
        const panelId = tab.dataset.panel;
        if (panelId === 'panel-wins' && !panel?.dataset.loaded) {
          loadMyWins(); panel.dataset.loaded = '1';
        } else if (panelId === 'panel-deposits' && !panel?.dataset.loaded) {
          loadMyDeposits(); panel.dataset.loaded = '1';
        } else if (panelId === 'panel-kyc' && !panel?.dataset.loaded) {
          loadKycStatus(); panel.dataset.loaded = '1';
        } else if (panelId === 'panel-bookings' && !panel?.dataset.loaded) {
          loadMyBookings(); panel.dataset.loaded = '1';
        }
      });
    });
  }

  async function loadAccountProfile() {
    try {
      const res = await api('/api/v1/auth/me');
      if (!res.success) return;
      const user = res.data;
      const initials = ((user.firstName?.[0] || '') + (user.lastName?.[0] || '')).toUpperCase() || '?';

      const avatarEl = $('account-avatar');
      const initialsEl = $('account-avatar-initials');
      if (initialsEl) initialsEl.textContent = initials;
      if (avatarEl) {
        avatarEl.style.background = 'var(--color-primary)';
        avatarEl.style.color = 'var(--color-primary-text)';
      }

      const nameEl = $('account-name');
      if (nameEl) nameEl.textContent = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'My account';
      const emailEl = $('account-email');
      if (emailEl) emailEl.textContent = user.email || '';

      // Badges: trust score, KYC
      const badgesEl = $('account-badges');
      if (badgesEl) {
        const badges = [];
        if (user.kycVerified) badges.push('<span class="kyc-status-badge kyc-status-badge--sm kyc-badge--verified">✓ Verified</span>');
        if (user.trustScore >= 80) badges.push(`<span class="trust-badge trust-badge--sm trust-badge--trusted">✓ Trusted</span>`);
        badgesEl.innerHTML = badges.join('');
      }
    } catch (_) {}
  }

  async function loadMyBids() {
    const listEl = $('bids-list');
    const emptyEl = $('bids-empty');
    if (!listEl) return;

    try {
      const res = await api('/api/v1/auctions/bids/me?size=20');
      const bids = res.data?.content || [];
      listEl.querySelectorAll('.account-bid-row--skeleton').forEach(el => el.remove());

      if (!bids.length) {
        if (emptyEl) emptyEl.classList.remove('hidden');
        return;
      }

      listEl.innerHTML = bids.map(b => `
        <div class="account-bid-row">
          <div class="account-bid-row__status-dot account-bid-row__status-dot--${(b.status||'').toLowerCase()}"></div>
          <div class="account-bid-row__info">
            <p class="account-bid-row__lot-title">
              <a href="/pages/auction-room?lot=${esc(b.auctionLotId)}">${esc(b.auctionLotId)}</a>
            </p>
            <p class="account-bid-row__time">${b.placedAt ? fmtDateLocale(b.placedAt) : ''}</p>
          </div>
          <div class="account-bid-row__amount">${fmt(b.amount)}</div>
          <div class="account-bid-row__status-label bid-status--${(b.status||'').toLowerCase()}">${b.status || ''}</div>
        </div>`).join('');
    } catch (_) {
      if (emptyEl) emptyEl.classList.remove('hidden');
    }
  }

  async function loadMyWins() {
    const gridEl = $('wins-grid');
    const emptyEl = $('wins-empty');
    if (!gridEl) return;
    try {
      const res = await api('/api/v1/auctions?statuses=SETTLED&winnerId=me&size=12');
      const lots = res.data?.content || [];
      gridEl.innerHTML = '';
      if (!lots.length) {
        if (emptyEl) emptyEl.classList.remove('hidden');
        return;
      }
      // Use the auction card renderer if plugin-auction.js is loaded
      if (window.AuctionPlugin?.renderAuctionCard) {
        gridEl.innerHTML = lots.map(l => window.AuctionPlugin.renderAuctionCard(l)).join('');
      } else {
        gridEl.innerHTML = lots.map(l => `
          <div class="account-win-card">
            <p class="account-win-card__title">${esc(l.title)}</p>
            <p class="account-win-card__amount">${fmt(l.winningAmount)}</p>
            <span class="account-win-card__agr-badge" id="agr-badge-${l.id}"
                  data-lot-id="${l.id}">Loading…</span>
            <a href="/pages/auction-success?lot=${l.id}" class="btn btn--ghost btn--sm">View</a>
          </div>`).join('');
      }
    } catch (_) {
      if (emptyEl) emptyEl.classList.remove('hidden');
    }

    // Load agreement status badges for each won lot
    document.querySelectorAll('[data-lot-id]').forEach(async badge => {
      const lotId = badge.dataset.lotId;
      if (!lotId) return;
      try {
        const res = await api(`/api/v1/agreements?lotId=${lotId}`);
        const status = res?.data?.status;
        const labelMap = {
          SENT: '✍️ Awaiting signature',
          BUYER_SIGNED: '⏳ Awaiting seller',
          FULLY_EXECUTED: '✅ Executed',
          DEFAULTED: '❌ Defaulted',
          DRAFT: '📄 Pending',
        };
        badge.textContent = labelMap[status] || (status ? status : '–');
        badge.dataset.status = status || '';
      } catch (_) { badge.textContent = '–'; }
    });
  }

  async function loadMyDeposits() {
    const listEl = $('deposits-list');
    const emptyEl = $('deposits-empty');
    if (!listEl) return;
    try {
      const res = await api('/api/v1/auctions/deposits/me');
      const deposits = res.data || [];
      listEl.querySelectorAll('.account-deposit-row--skeleton').forEach(el => el.remove());
      if (!deposits.length) {
        if (emptyEl) emptyEl.classList.remove('hidden');
        return;
      }
      listEl.innerHTML = deposits.map(d => `
        <div class="account-deposit-row">
          <div class="account-deposit-row__lot">
            <a href="/pages/auction-room?lot=${esc(d.auctionLotId)}">Lot ${esc(d.auctionLotId)}</a>
          </div>
          <div class="account-deposit-row__amount">${fmt(d.depositAmount)}</div>
          ${buildDepositBadge(d.status)}
          <div class="account-deposit-row__date">${d.createdAt ? fmtDateLocale(d.createdAt) : ''}</div>
        </div>`).join('');
    } catch (_) {
      if (emptyEl) emptyEl.classList.remove('hidden');
    }
  }

  async function loadKycStatus() {
    const panelEl = $('account-kyc-panel');
    const actionsEl = $('account-kyc-actions');
    if (!panelEl) return;
    try {
      const res = await api('/api/v1/kyc/status');
      const status = res.data?.status || 'NOT_STARTED';
      panelEl.innerHTML = buildKycBadge(status);
      if (actionsEl) {
        if (status !== 'VERIFIED') {
          actionsEl.innerHTML = `<a href="/pages/kyc" class="btn btn--primary btn--sm">Start / continue verification</a>`;
        } else {
          actionsEl.innerHTML = '';
        }
      }
    } catch (_) {}
  }

  async function loadMyBookings() {
    const listEl = $('bookings-list');
    const emptyEl = $('bookings-empty');
    if (!listEl) return;
    try {
      const res = await api('/api/v1/bookings/my-bookings?size=10');
      const bookings = res.data?.content || [];
      listEl.querySelectorAll('.account-booking-row--skeleton').forEach(el => el.remove());
      if (!bookings.length) {
        if (emptyEl) emptyEl.classList.remove('hidden');
        return;
      }
      listEl.innerHTML = bookings.map(b => `
        <div class="account-booking-row">
          <div class="account-booking-row__info">
            <p class="account-booking-row__property">${esc(b.propertyName || 'Property')}</p>
            <p class="account-booking-row__dates">${b.checkIn || ''} → ${b.checkOut || ''}</p>
          </div>
          <div class="account-booking-row__amount">${fmt(b.totalAmount)}</div>
          <span class="account-booking-row__status booking-status--${(b.status||'').toLowerCase()}">${b.status || ''}</span>
        </div>`).join('');
    } catch (_) {
      if (emptyEl) emptyEl.classList.remove('hidden');
    }
  }

  // ── Shared helpers ────────────────────────────────────────────────────────
  function buildKycBadge(status) {
    const map = {
      VERIFIED:        { label: '✓ Identity verified',       cls: 'kyc-badge--verified' },
      PROCESSING:      { label: '⏳ Verification in review', cls: 'kyc-badge--processing' },
      SESSION_CREATED: { label: '🔗 Verification pending',   cls: 'kyc-badge--pending' },
      REQUIRES_INPUT:  { label: '⚠ More info needed',        cls: 'kyc-badge--requires-input' },
      FAILED:          { label: '✗ Verification failed',     cls: 'kyc-badge--failed' },
      NOT_STARTED:     { label: '○ Not verified',            cls: 'kyc-badge--not-started' },
    };
    const s = map[status] || map.NOT_STARTED;
    return `<span class="kyc-status-badge ${s.cls}">${s.label}</span>`;
  }

  function buildDepositBadge(status) {
    const map = {
      HELD:     { label: '🔒 Deposit held',    cls: 'deposit-badge--held' },
      RELEASED: { label: '✓ Released',         cls: 'deposit-badge--released' },
      CHARGED:  { label: '💳 Applied',         cls: 'deposit-badge--charged' },
      FAILED:   { label: '✗ Failed',           cls: 'deposit-badge--failed' },
      PENDING:  { label: '⏳ Pending',         cls: 'deposit-badge--pending' },
    };
    const s = map[status] || { label: status, cls: '' };
    return `<span class="deposit-status-badge ${s.cls}">${s.label}</span>`;
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

  // ── Entry point ───────────────────────────────────────────────────────────
  function init() {
    initLogin();
    initRegister();
    initKycPage();
    initDepositPage();
    initAuctionSuccessPage();
    initAccountPage();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
