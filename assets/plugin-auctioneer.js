/**
 * StaySphere AOS — plugin-auctioneer.js
 * Phase 3: Auctioneer dashboard — data loading, tabs, WebSocket feed,
 *          bid request management, question queue, auction controls.
 *
 * Loaded only on /pages/auctioneer-dashboard (see theme.liquid).
 * Requires plugin-auction-room.js WS infrastructure (loaded separately).
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const api  = (path, opts) => window.StaySphere.api(path, opts);
  const toast = msg => window.StaySphere?.toast?.(msg);
  const esc  = s => String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  function fmt(n) {
    const i18n = window.StaySphere?.i18n;
    if (i18n?.fx?.loaded) {
      const base = document.body.dataset.currency || 'USD';
      return i18n.fx.format(Number(n || 0), base, i18n.currentCurrency());
    }
    const sym = document.body.dataset.currencySymbol || '$';
    return sym + Number(n || 0).toLocaleString('en-US');
  }
  function fmtDate(iso) {
    if (!iso) return '–';
    const i18n = window.StaySphere?.i18n;
    const tz   = i18n?.time?.timezone || 'UTC';
    const lang = i18n?.currentLanguage?.() || 'en';
    const map  = {en:'en-US',fr:'fr-FR',es:'es-ES',de:'de-DE',pt:'pt-BR',ar:'ar-SA',zh:'zh-CN'};
    try {
      return new Intl.DateTimeFormat(map[lang]||'en-US',{
        timeZone:tz, day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'
      }).format(new Date(iso));
    } catch(_) { return new Date(iso).toLocaleString(); }
  }
  function setLoading(id, on) {
    const b = $(id); if (!b) return;
    b.disabled = on;
    b.querySelector('.btn-label')?.classList.toggle('hidden', on);
    b.querySelector('.btn-spinner')?.classList.toggle('hidden', !on);
  }
  function statusBadge(status) {
    const map = {
      SCHEDULED:'ad-badge--scheduled', OPEN:'ad-badge--open',
      EXTENDED:'ad-badge--extended', CLOSED:'ad-badge--closed',
      SETTLED:'ad-badge--closed', NO_RESERVE:'ad-badge--closed',
    };
    return `<span class="ad-badge ${map[status]||''}">${esc(status)}</span>`;
  }
  function credBadge(status) {
    const c = {ACTIVE:'ad-badge--open', REVOKED:'ad-badge--danger', EXPIRED:'ad-badge--closed'};
    return `<span class="ad-badge ${c[status]||''}">${esc(status)}</span>`;
  }

  // ══════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════
  function init() {
    const dash = $('auctioneer-dashboard');
    if (!dash) return;

    if (!window.StaySphere?.auth?.getToken()) {
      window.location.href = '/account/login?return_to=/pages/auctioneer-dashboard';
      return;
    }

    const lotId = dash.dataset.lotId;

    if (lotId) {
      initStateB(dash, lotId);
    } else {
      initStateA(dash);
    }

    document.addEventListener('ss:currency-changed', () => {
      if (lotId) refreshStatsBar(dash, lotId);
    });
  }

  // ══════════════════════════════════════════════════════════
  // STATE A — lot selector
  // ══════════════════════════════════════════════════════════
  function initStateA(dash) {
    loadMyLots(dash);
    // Poll every 30 s so status badges stay current
    setInterval(() => loadMyLots(dash), 30_000);
  }

  async function loadMyLots(dash) {
    try {
      const res = await api('/api/v1/auctions/auctioneer/my-lots/active');
      if (!res.success) { renderLotGrid([], dash); return; }
      renderLotGrid(res.data || [], dash);
    } catch(_) { renderLotGrid([], dash); }
  }

  function renderLotGrid(lots, dash) {
    const grid  = $('ad-lot-grid');
    const empty = $('ad-lot-grid-empty');
    if (!grid) return;

    // Auto-redirect if exactly one active lot
    if (lots.length === 1) {
      window.location.href = `/pages/auctioneer-dashboard?lot=${lots[0].id}`;
      return;
    }

    if (lots.length === 0) {
      grid.innerHTML = '';
      empty?.classList.remove('hidden');
      return;
    }
    empty?.classList.add('hidden');

    grid.innerHTML = lots.map(lot => `
      <div class="ad-lot-card" data-lot-id="${esc(lot.id)}">
        <div class="ad-lot-card__status-bar">
          ${statusBadge(lot.status)}
          <span class="ad-lot-card__start">${fmtDate(lot.startsAt)}</span>
        </div>
        <div class="ad-lot-card__body">
          <h2 class="ad-lot-card__title">${esc(lot.title)}</h2>
          <p class="ad-lot-card__address">${esc(lot.propertyId)}</p>
          <div class="ad-lot-card__stats">
            <div class="ad-lot-card__stat">
              <span class="ad-lot-card__stat-label">High bid</span>
              <span class="ad-lot-card__stat-value">${lot.currentBidAmount ? fmt(lot.currentBidAmount) : '–'}</span>
            </div>
            <div class="ad-lot-card__stat">
              <span class="ad-lot-card__stat-label">Bidders</span>
              <span class="ad-lot-card__stat-value">${lot.uniqueBidders ?? '–'}</span>
            </div>
            <div class="ad-lot-card__stat">
              <span class="ad-lot-card__stat-label">Bids</span>
              <span class="ad-lot-card__stat-value">${lot.totalBids ?? '–'}</span>
            </div>
          </div>
        </div>
        <div class="ad-lot-card__footer">
          <a href="/pages/auctioneer-dashboard?lot=${esc(lot.id)}"
             class="btn btn--primary btn--sm">Manage →</a>
          ${lot.status === 'OPEN' || lot.status === 'EXTENDED'
            ? `<a href="/pages/auction-room?lot=${esc(lot.id)}"
                  class="btn btn--ghost btn--sm">Enter live room →</a>`
            : ''}
        </div>
      </div>`).join('');
  }

  // ══════════════════════════════════════════════════════════
  // STATE B — single lot management
  // ══════════════════════════════════════════════════════════
  function initStateB(dash, lotId) {
    initTabs(dash);
    loadLotDetail(dash, lotId);
    subscribeToQueue(dash, lotId);
    wireControls(dash, lotId);
    wireQuestionPanel(dash, lotId);
    $('ad-refresh-btn')?.addEventListener('click', () => loadLotDetail(dash, lotId));
  }

  // ── Tabs ──────────────────────────────────────────────────
  function initTabs(dash) {
    dash.querySelectorAll('.account-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        dash.querySelectorAll('.account-tab').forEach(t => {
          t.classList.remove('account-tab--active');
          t.setAttribute('aria-selected', 'false');
        });
        dash.querySelectorAll('.account-panel').forEach(p => p.classList.add('hidden'));
        tab.classList.add('account-tab--active');
        tab.setAttribute('aria-selected', 'true');
        const panel = $(tab.dataset.panel);
        panel?.classList.remove('hidden');
        // Lazy-load panel content on first activation
        panel?.dispatchEvent(new CustomEvent('ad:panel-activated'));
      });
    });

    // Panel lazy-load listeners
    $('adp-requests')?.addEventListener('ad:panel-activated',
      () => loadBidRequests(dash, dash.dataset.lotId), { once: false });
    $('adp-bidders')?.addEventListener('ad:panel-activated',
      () => loadBidders(dash, dash.dataset.lotId), { once: false });
    $('adp-questions')?.addEventListener('ad:panel-activated',
      () => loadQuestions(dash, dash.dataset.lotId, 'PENDING'), { once: false });
    $('adp-agreement')?.addEventListener('ad:panel-activated',
      () => loadAgreement(dash, dash.dataset.lotId), { once: false });
  }

  // ── Load lot detail (Overview + stats bar) ────────────────
  async function loadLotDetail(dash, lotId) {
    try {
      const res = await api(`/api/v1/auctions/${lotId}`);
      if (!res.success) return;
      const lot = res.data;
      renderStatsBar(lot);
      renderOverview(lot);
      // Populate revoke bidder dropdown
      populateRevokeDropdown(lot);
    } catch(_) {}
  }

  function renderStatsBar(lot) {
    const el = id => $(id);
    if (el('ad-current-bid'))  el('ad-current-bid').textContent  = lot.currentBidAmount ? fmt(lot.currentBidAmount) : '–';
    if (el('ad-bidder-count')) el('ad-bidder-count').textContent = lot.uniqueBidders ?? '–';
    if (el('ad-bid-count'))    el('ad-bid-count').textContent    = lot.totalBids ?? '–';
    if (el('ad-lot-title'))    el('ad-lot-title').textContent    = lot.title || 'Lot';

    const badge = $('ad-status-badge');
    if (badge) badge.innerHTML = statusBadge(lot.status);

    // Live countdown
    const countdownEl = $('ad-countdown');
    if (countdownEl && lot.scheduledEndsAt) {
      const diff = new Date(lot.scheduledEndsAt) - Date.now();
      const abs  = Math.abs(diff);
      const h    = Math.floor(abs / 3600000);
      const m    = Math.floor((abs % 3600000) / 60000);
      const s    = Math.floor((abs % 60000) / 1000);
      countdownEl.textContent = diff < 0 ? 'Ended'
        : `${h}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;
    }
  }

  function refreshStatsBar(dash, lotId) {
    api(`/api/v1/auctions/${lotId}`).then(r => { if(r.success) renderStatsBar(r.data); }).catch(()=>{});
  }

  function renderOverview(lot) {
    const detail = $('ad-lot-detail');
    if (!detail) return;
    detail.innerHTML = `
      <table class="ad-table ad-table--compact">
        <tbody>
          <tr><th>Title</th><td>${esc(lot.title)}</td></tr>
          <tr><th>Type</th><td>${esc(lot.auctionType)}</td></tr>
          <tr><th>Status</th><td>${statusBadge(lot.status)}</td></tr>
          <tr><th>Starting price</th><td>${fmt(lot.startingPrice)}</td></tr>
          <tr><th>Reserve</th><td>${lot.reservePrice ? fmt(lot.reservePrice) : 'None'}</td></tr>
          <tr><th>Opens</th><td>${fmtDate(lot.startsAt)}</td></tr>
          <tr><th>Closes</th><td>${fmtDate(lot.scheduledEndsAt)}</td></tr>
        </tbody>
      </table>`;

    // Livestream status
    const streamDot   = $('ad-stream-dot');
    const streamLabel = $('ad-stream-label');
    const streamLink  = $('ad-stream-link');
    if (lot.livestreamActive && streamDot) {
      streamDot.className = 'ad-livestream-status__dot ad-livestream-status__dot--live';
      if (streamLabel) streamLabel.textContent = 'Live';
      if (lot.livestreamUrl && streamLink) {
        streamLink.href = lot.livestreamUrl;
        streamLink.classList.remove('hidden');
      }
    }
  }

  // ── Bid Requests tab ──────────────────────────────────────
  async function loadBidRequests(dash, lotId) {
    const list  = $('ad-requests-list');
    const empty = $('ad-requests-empty');
    if (!list) return;

    const activeChip = dash.querySelector('#adp-requests .ad-chip--active');
    const status = activeChip?.dataset.filter || 'PENDING';

    try {
      const url = status === 'ALL'
        ? `/api/v1/auctions/${lotId}/access-requests`
        : `/api/v1/auctions/${lotId}/access-requests?status=${status}`;
      const res = await api(url);
      const requests = res?.data?.content || res?.data || [];

      if (!requests.length) {
        list.innerHTML = '';
        empty?.classList.remove('hidden');
        return;
      }
      empty?.classList.add('hidden');

      list.innerHTML = requests.map(r => `
        <div class="ad-request-card" data-request-id="${esc(r.id)}" id="req-${esc(r.id)}">
          <div class="ad-request-card__header">
            <span class="ad-request-card__name">${esc(r.bidderEmail)}</span>
            <span class="ad-badge ${r.status==='APPROVED'?'ad-badge--open':r.status==='DECLINED'?'ad-badge--danger':'ad-badge--scheduled'}">${esc(r.status)}</span>
            <span class="ad-request-card__time">${fmtDate(r.requestedAt)}</span>
          </div>
          <div class="ad-request-card__docs">
            ${r.proofOfFundsUrl  ? `<a href="${esc(r.proofOfFundsUrl)}"  target="_blank" rel="noopener" class="ad-doc-link">📄 Proof of funds</a>` : ''}
            ${r.mortgagePreApprovalUrl ? `<a href="${esc(r.mortgagePreApprovalUrl)}" target="_blank" rel="noopener" class="ad-doc-link">🏦 Mortgage pre-approval</a>` : ''}
            ${r.bankReferenceUrl ? `<a href="${esc(r.bankReferenceUrl)}" target="_blank" rel="noopener" class="ad-doc-link">🏛 Bank reference</a>` : ''}
          </div>
          ${r.status === 'PENDING' ? `
          <div class="ad-request-card__actions">
            <button class="btn btn--primary btn--sm" data-action="approve" data-id="${esc(r.id)}">Approve</button>
            <button class="btn btn--ghost btn--sm"   data-action="decline" data-id="${esc(r.id)}">Decline</button>
            <button class="btn btn--ghost btn--sm"   data-action="request-docs" data-id="${esc(r.id)}">Request more docs</button>
          </div>` : ''}
          ${r.declineReason ? `<p class="ad-request-card__reason">Reason: ${esc(r.declineReason)}</p>` : ''}
        </div>`).join('');

      // Wire filter chips
      dash.querySelectorAll('#adp-requests .ad-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          dash.querySelectorAll('#adp-requests .ad-chip')
              .forEach(c => c.classList.remove('ad-chip--active'));
          chip.classList.add('ad-chip--active');
          loadBidRequests(dash, lotId);
        });
      });

      // Wire action buttons
      list.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', () =>
          handleRequestAction(btn.dataset.action, btn.dataset.id, lotId, dash));
      });

    } catch(_) {
      list.innerHTML = '<p class="ad-error">Failed to load bid requests.</p>';
    }
  }

  async function handleRequestAction(action, requestId, lotId, dash) {
    if (action === 'approve') {
      try {
        const res = await api(
          `/api/v1/auctions/${lotId}/access-requests/${requestId}/approve`,
          { method: 'POST' });
        if (res.success) { toast('Bidder approved'); loadBidRequests(dash, lotId); }
        else showInlineError(`req-${requestId}`, res.message);
      } catch(_) { showInlineError(`req-${requestId}`, 'Approval failed'); }
    } else if (action === 'decline') {
      const reason = prompt('Reason for declining (optional — bidder will not be told):');
      // null = cancelled prompt
      if (reason === null) return;
      try {
        const res = await api(
          `/api/v1/auctions/${lotId}/access-requests/${requestId}/decline`,
          { method: 'POST', body: JSON.stringify({ reason }) });
        if (res.success) { toast('Request declined'); loadBidRequests(dash, lotId); }
        else showInlineError(`req-${requestId}`, res.message);
      } catch(_) { showInlineError(`req-${requestId}`, 'Decline failed'); }
    } else if (action === 'request-docs') {
      const note = prompt('What additional documents do you need?');
      if (!note) return;
      try {
        const res = await api(
          `/api/v1/auctions/${lotId}/access-requests/${requestId}/request-docs`,
          { method: 'POST', body: JSON.stringify({ note }) });
        if (res.success) { toast('Document request sent to bidder'); }
        else showInlineError(`req-${requestId}`, res.message);
      } catch(_) {}
    }
  }

  // ── Bidders tab ───────────────────────────────────────────
  async function loadBidders(dash, lotId) {
    const tbody = $('ad-bidders-rows');
    const empty = $('ad-bidders-empty');
    if (!tbody) return;

    try {
      const res = await api(`/api/v1/auctions/${lotId}/credentials`);
      const creds = res?.data || [];

      if (!creds.length) {
        tbody.innerHTML = '';
        empty?.classList.remove('hidden');
        $('ad-bidders-table-wrap')?.classList.add('hidden');
        return;
      }
      empty?.classList.add('hidden');
      $('ad-bidders-table-wrap')?.classList.remove('hidden');

      tbody.innerHTML = creds.map(c => `
        <tr id="cred-row-${esc(c.id)}">
          <td>${esc(c.bidderId)}</td>
          <td>${credBadge(c.status)}</td>
          <td>${c.bidCountUsed ?? 0}</td>
          <td>${c.fraudFlagged
            ? '<span class="ad-badge ad-badge--danger">⚠ Flagged</span>'
            : '<span class="ad-badge ad-badge--open">Clean</span>'}</td>
          <td>
            ${c.status === 'ACTIVE' ? `
            <button class="btn btn--ghost btn--sm ad-danger-btn"
                    data-cred-id="${esc(c.id)}" data-bidder-id="${esc(c.bidderId)}"
                    data-action="revoke">Revoke</button>` : '–'}
          </td>
        </tr>`).join('');

      tbody.querySelectorAll('[data-action="revoke"]').forEach(btn => {
        btn.addEventListener('click', () =>
          revokeCredentialFromBidders(btn.dataset.credId, btn.dataset.bidderId, lotId, dash));
      });

      // Populate revoke dropdown in Controls tab
      populateRevokeDropdown({ credentials: creds });

    } catch(_) {
      tbody.innerHTML = '<tr><td colspan="5" class="ad-error">Failed to load bidders.</td></tr>';
    }
  }

  function populateRevokeDropdown(data) {
    const sel = $('ad-revoke-bidder-select');
    if (!sel) return;
    const creds = data?.credentials || [];
    const active = creds.filter(c => c.status === 'ACTIVE');
    sel.innerHTML = '<option value="">Select bidder…</option>' +
      active.map(c => `<option value="${esc(c.id)}" data-bidder="${esc(c.bidderId)}">${esc(c.bidderId)}</option>`).join('');
  }

  async function revokeCredentialFromBidders(credId, bidderId, lotId, dash) {
    const reason = prompt(`Reason for revoking credential for ${bidderId}:`);
    if (!reason) return;
    await doRevokeCredential(credId, reason, lotId, dash);
  }

  // ── Questions tab ─────────────────────────────────────────
  async function loadQuestions(dash, lotId, statusFilter) {
    const list  = $('ad-questions-list');
    const empty = $('ad-questions-empty');
    if (!list) return;

    const filter = statusFilter || $('adp-questions .ad-chip--active')?.dataset.filter || 'PENDING';
    const sort   = $('ad-q-priority-sort')?.value || 'newest';
    const url    = filter === 'ALL'
      ? `/api/v1/auctions/${lotId}/questions/queue?sort=${sort}`
      : `/api/v1/auctions/${lotId}/questions/queue?status=${filter}&sort=${sort}`;

    try {
      const res = await api(url);
      const questions = res?.data?.content || res?.data || [];

      if (!questions.length) {
        list.innerHTML = '';
        empty?.classList.remove('hidden');
        return;
      }
      empty?.classList.add('hidden');

      list.innerHTML = questions.map(q => `
        <div class="ad-question-card${q.status==='PENDING'?' ad-question-card--pending':''}"
             data-question-id="${esc(q.id)}" id="q-${esc(q.id)}">
          <div class="ad-question-card__header">
            <span class="ad-question-card__who">${esc(q.bidderDisplayName)}</span>
            <span class="ad-category-badge ad-category-badge--${esc(q.category?.toLowerCase())}">${esc(q.category)}</span>
            ${q.priority === 'URGENT' ? '<span class="ad-badge ad-badge--danger ad-urgent-dot">⚡ URGENT</span>' : ''}
            <span class="ad-question-card__time">${fmtDate(q.submittedAt)}</span>
          </div>
          <p class="ad-question-card__content">${esc(q.content)}</p>
          ${q.response ? `
          <div class="ad-question-card__answer">
            <strong>Answer</strong>${q.answeredPublicly ? ' <span class="ad-badge ad-badge--open">PUBLIC</span>':''}: ${esc(q.response)}
          </div>` : ''}
          ${q.status === 'PENDING' ? `
          <div class="ad-question-card__actions">
            <button class="btn btn--primary btn--sm" data-q-action="answer" data-id="${esc(q.id)}"
                    data-content="${esc(q.content)}">Answer</button>
            <button class="btn btn--ghost btn--sm"   data-q-action="dismiss"  data-id="${esc(q.id)}">Dismiss</button>
            <button class="btn btn--ghost btn--sm"   data-q-action="escalate" data-id="${esc(q.id)}">Escalate</button>
          </div>` : ''}
        </div>`).join('');

      // Wire filter chips
      dash.querySelectorAll('#adp-questions .ad-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          dash.querySelectorAll('#adp-questions .ad-chip')
              .forEach(c => c.classList.remove('ad-chip--active'));
          chip.classList.add('ad-chip--active');
          loadQuestions(dash, lotId, chip.dataset.filter);
        });
      });
      $('ad-q-priority-sort')?.addEventListener('change',
        () => loadQuestions(dash, lotId));

      list.querySelectorAll('[data-q-action]').forEach(btn => {
        btn.addEventListener('click', () =>
          handleQuestionAction(btn.dataset.qAction, btn.dataset.id,
                               btn.dataset.content, lotId, dash));
      });

    } catch(_) {
      list.innerHTML = '<p class="ad-error">Failed to load questions.</p>';
    }
  }

  function handleQuestionAction(action, questionId, content, lotId, dash) {
    if (action === 'answer') {
      openAnswerPanel(questionId, content);
    } else if (action === 'dismiss') {
      dismissQuestion(questionId, lotId, dash);
    } else if (action === 'escalate') {
      escalateQuestion(questionId, lotId, dash);
    }
  }

  function wireQuestionPanel(dash, lotId) {
    $('ad-answer-close')?.addEventListener('click', closeAnswerPanel);
    $('ad-dismiss-btn')?.addEventListener('click', () => {
      const qId = $('ad-answer-question-id')?.value;
      if (qId) { closeAnswerPanel(); dismissQuestion(qId, lotId, dash); }
    });
    $('ad-escalate-btn')?.addEventListener('click', () => {
      const qId = $('ad-answer-question-id')?.value;
      if (qId) { closeAnswerPanel(); escalateQuestion(qId, lotId, dash); }
    });
    $('ad-answer-submit-btn')?.addEventListener('click', () =>
      submitAnswer(lotId, dash));
  }

  function openAnswerPanel(questionId, content) {
    const panel = $('ad-answer-panel');
    const qText = $('ad-answer-question-text');
    const qId   = $('ad-answer-question-id');
    const input = $('ad-answer-input');
    if (!panel) return;
    if (qText) qText.textContent = content || '';
    if (qId)   qId.value = questionId;
    if (input) { input.value = ''; input.focus(); }
    panel.classList.remove('hidden');
  }

  function closeAnswerPanel() {
    $('ad-answer-panel')?.classList.add('hidden');
    $('ad-answer-input') && ($('ad-answer-input').value = '');
    $('ad-answer-public') && ($('ad-answer-public').checked = false);
  }

  async function submitAnswer(lotId, dash) {
    const questionId  = $('ad-answer-question-id')?.value;
    const response    = $('ad-answer-input')?.value?.trim();
    const answerPublicly = $('ad-answer-public')?.checked ?? false;
    if (!questionId || !response) {
      toast('Please type an answer before submitting');
      return;
    }
    setLoading('ad-answer-submit-btn', true);
    try {
      const res = await api(
        `/api/v1/auctions/${lotId}/questions/${questionId}/answer`,
        { method: 'POST', body: JSON.stringify({ response, answerPublicly }) });
      if (res.success) {
        toast(answerPublicly ? '✅ Answer broadcast to room' : '✅ Answer sent privately');
        closeAnswerPanel();
        loadQuestions(dash, lotId);
        updateBadge('adtab-questions-badge', -1);
      } else {
        toast(res.message || 'Failed to send answer');
      }
    } catch(_) { toast('Failed to send answer'); }
    finally { setLoading('ad-answer-submit-btn', false); }
  }

  async function dismissQuestion(questionId, lotId, dash) {
    try {
      const res = await api(
        `/api/v1/auctions/${lotId}/questions/${questionId}/dismiss`,
        { method: 'POST' });
      if (res.success) { toast('Question dismissed'); loadQuestions(dash, lotId); }
    } catch(_) {}
  }

  async function escalateQuestion(questionId, lotId, dash) {
    const reason = prompt('Reason for escalation (sent to platform support):');
    if (!reason) return;
    try {
      const res = await api(
        `/api/v1/auctions/${lotId}/questions/${questionId}/escalate`,
        { method: 'POST', body: JSON.stringify({ reason }) });
      if (res.success) {
        toast('Question escalated to platform support');
        loadQuestions(dash, lotId);
      }
    } catch(_) { toast('Escalation failed'); }
  }

  // ── Agreement tab ─────────────────────────────────────────
  async function loadAgreement(dash, lotId) {
    const pending = $('ad-agreement-pending');
    const detail  = $('ad-agreement-detail');
    const rows    = $('ad-agreement-rows');
    if (!rows) return;

    try {
      const res = await api(`/api/v1/agreements?lotId=${lotId}`);
      const agreement = res?.data;
      if (!agreement) {
        pending?.classList.remove('hidden');
        detail?.classList.add('hidden');
        return;
      }
      pending?.classList.add('hidden');
      detail?.classList.remove('hidden');
      rows.innerHTML = [
        ['Buyer', agreement.bidderId],
        ['Winning amount', fmt(agreement.winningAmount)],
        ['Deposit', fmt(agreement.depositAmount)],
        ['Balance due', fmt(agreement.balanceDue)],
        ['Status', `<span class="ad-badge">${esc(agreement.status)}</span>`],
        ['Buyer signed', agreement.buyerSignedAt ? fmtDate(agreement.buyerSignedAt) : 'Pending'],
        ['Seller signed', agreement.sellerSignedAt ? fmtDate(agreement.sellerSignedAt) : 'Pending'],
        ['Payment deadline', fmtDate(agreement.paymentDeadline)],
      ].map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join('');

      // Show "offer to next bidder" only on default
      const offerBtn = $('ad-offer-next-btn');
      if (offerBtn && agreement.status === 'DEFAULTED') {
        offerBtn.classList.remove('hidden');
        offerBtn.addEventListener('click', () => offerToNextBidder(agreement.id));
      }
    } catch(_) {
      rows.innerHTML = '<tr><td colspan="2" class="ad-error">Failed to load agreement.</td></tr>';
    }
  }

  async function offerToNextBidder(agreementId) {
    if (!confirm('Offer this lot to the next highest bidder? This cannot be undone.')) return;
    try {
      const res = await api(`/api/v1/agreements/${agreementId}/offer-next`, { method: 'POST' });
      if (res.success) toast('✅ Lot offered to next bidder');
      else toast(res.message || 'Failed');
    } catch(_) { toast('Failed'); }
  }

  // ── Controls tab ──────────────────────────────────────────
  function wireControls(dash, lotId) {
    // Extend
    $('ad-extend-btn')?.addEventListener('click', async () => {
      const mins = parseInt($('ad-extend-minutes')?.value || '5');
      setLoading('ad-extend-btn', true);
      try {
        const res = await api(`/api/v1/auctions/${lotId}/extend`,
          { method: 'POST', body: JSON.stringify({ extraMinutes: mins }) });
        if (res.success) {
          toast(`✅ Auction extended by ${mins} minutes`);
          refreshStatsBar(dash, lotId);
        } else toast(res.message || 'Extension failed');
      } catch(_) { toast('Extension failed'); }
      finally { setLoading('ad-extend-btn', false); }
    });

    // Close now
    $('ad-close-now-btn')?.addEventListener('click', async () => {
      if (!confirm('Close the auction now? This cannot be undone.')) return;
      try {
        const res = await api(`/api/v1/auctions/${lotId}/close`, { method: 'POST' });
        if (res.success) { toast('Auction closed'); refreshStatsBar(dash, lotId); }
        else toast(res.message || 'Failed');
      } catch(_) { toast('Failed'); }
    });

    // Pause / resume
    $('ad-pause-btn')?.addEventListener('click', () => setPauseState(true, lotId, dash));
    $('ad-resume-btn')?.addEventListener('click', () => setPauseState(false, lotId, dash));

    // Revoke from controls panel
    $('ad-revoke-btn')?.addEventListener('click', async () => {
      const sel    = $('ad-revoke-bidder-select');
      const credId = sel?.value;
      const reason = $('ad-revoke-reason')?.value?.trim();
      if (!credId) { toast('Select a bidder to revoke'); return; }
      if (!reason) { toast('Please provide a reason for revocation'); return; }
      await doRevokeCredential(credId, reason, lotId, dash);
      if (sel) sel.value = '';
      const reasonEl = $('ad-revoke-reason');
      if (reasonEl) reasonEl.value = '';
    });
  }

  async function setPauseState(pause, lotId, dash) {
    const endpoint = pause ? 'pause' : 'resume';
    const btnId    = pause ? 'ad-pause-btn' : 'ad-resume-btn';
    setLoading(btnId, true);
    try {
      const res = await api(`/api/v1/auctions/${lotId}/${endpoint}`, { method: 'POST' });
      if (res.success) {
        $('ad-pause-btn')?.classList.toggle('hidden', pause);
        $('ad-resume-btn')?.classList.toggle('hidden', !pause);
        $('ad-paused-banner')?.classList.toggle('hidden', !pause);
        toast(pause ? '⏸ Auction paused' : '▶ Auction resumed');
      } else toast(res.message || 'Failed');
    } catch(_) { toast('Failed'); }
    finally { setLoading(btnId, false); }
  }

  async function doRevokeCredential(credId, reason, lotId, dash) {
    try {
      const res = await api(
        `/api/v1/auctions/${lotId}/credentials/${credId}/revoke`,
        { method: 'POST', body: JSON.stringify({ reason }) });
      if (res.success) {
        toast('✅ Credential revoked — bidder notified');
        loadBidders(dash, lotId);
      } else toast(res.message || 'Revocation failed');
    } catch(_) { toast('Revocation failed'); }
  }

  // ── WebSocket queue subscription ──────────────────────────
  function subscribeToQueue(dash, lotId) {
    // Wait for WebSocket to be available (plugin-auction-room.js may not be loaded here)
    // Instead poll the REST queue every 20s as a lightweight fallback,
    // and patch into the WS client if plugin-auction-room.js IS loaded on the same page.
    setInterval(() => {
      countPendingRequests(lotId);
      countPendingQuestions(lotId);
    }, 20_000);

    // Initial badge load
    countPendingRequests(lotId);
    countPendingQuestions(lotId);

    // If STOMP client is available (auctioneer also has auction-room.js loaded), subscribe
    const tryWs = () => {
      const stomp = window._ssStompClient;
      if (stomp?.connected) {
        stomp.subscribe(`/user/queue/auctioneer-${lotId}-queue`, msg => {
          try {
            const data = JSON.parse(msg.body);
            handleQueuePush(data, lotId, dash);
          } catch(_) {}
        });
      } else {
        setTimeout(tryWs, 2000);
      }
    };
    tryWs();
  }

  async function countPendingRequests(lotId) {
    try {
      const res = await api(`/api/v1/auctions/${lotId}/access-requests?status=PENDING&size=1`);
      const count = res?.data?.totalElements ?? (res?.data?.length ?? 0);
      updateBadge('adtab-requests-badge', count);
    } catch(_) {}
  }

  async function countPendingQuestions(lotId) {
    try {
      const res = await api(`/api/v1/auctions/${lotId}/questions/count/pending`);
      updateBadge('adtab-questions-badge', res?.data ?? 0);
    } catch(_) {}
  }

  function updateBadge(badgeId, countOrDelta) {
    const badge = $(badgeId);
    if (!badge) return;
    let count = typeof countOrDelta === 'number' && countOrDelta < 0
      ? Math.max(0, (parseInt(badge.textContent) || 0) + countOrDelta)
      : countOrDelta;
    badge.textContent = count > 0 ? count : '';
    badge.classList.toggle('hidden', count <= 0);
    badge.setAttribute('aria-label', `${count} pending`);
  }

  function handleQueuePush(data, lotId, dash) {
    if (data.type === 'BID_ACCESS_REQUESTED') {
      updateBadge('adtab-requests-badge', '+1');
      appendFeedEvent({ type: 'REQUEST', message: `New bid access request from ${data.bidderEmail}`, time: data.requestedAt });
    } else if (data.type === 'QA_RECEIVED') {
      updateBadge('adtab-questions-badge', '+1');
      appendFeedEvent({ type: 'QUESTION', message: `New question from ${data.bidderDisplayName}: "${data.contentPreview}"`, time: data.submittedAt });
    } else if (data.type === 'BID_UPDATE') {
      appendFeedEvent({ type: 'BID', message: `${data.bidderDisplayName || 'Bidder'} bid ${fmt(data.amount)}`, time: data.placedAt });
      renderStatsBar({ currentBidAmount: data.amount, uniqueBidders: data.uniqueBidders, totalBids: data.totalBids });
    }
  }

  // ── Live feed tab ─────────────────────────────────────────
  function appendFeedEvent(event) {
    const feed = $('ad-live-feed');
    if (!feed) return;
    const empty = feed.querySelector('.ad-feed__empty');
    if (empty) empty.remove();
    const typeClass = { BID:'ad-feed-event--bid', REQUEST:'ad-feed-event--request', QUESTION:'ad-feed-event--question' };
    const item = document.createElement('div');
    item.className = `ad-feed-event ${typeClass[event.type] || ''}`;
    item.innerHTML = `
      <span class="ad-feed-event__time">${fmtDate(event.time || new Date().toISOString())}</span>
      <span class="ad-feed-event__msg">${esc(event.message)}</span>`;
    feed.prepend(item);
    // Keep feed to last 100 events
    const items = feed.querySelectorAll('.ad-feed-event');
    if (items.length > 100) items[items.length - 1].remove();
  }

  // ── Inline error helper ───────────────────────────────────
  function showInlineError(containerId, msg) {
    const el = $(containerId);
    if (!el) return;
    let errDiv = el.querySelector('.ad-inline-error');
    if (!errDiv) {
      errDiv = document.createElement('p');
      errDiv.className = 'ad-inline-error';
      el.appendChild(errDiv);
    }
    errDiv.textContent = msg;
  }

  // ── Boot ──────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
