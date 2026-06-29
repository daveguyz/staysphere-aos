/**
 * StaySphere AOS — plugin-auction-room.js
 * Phase D: Live auction room
 *
 * Responsibilities:
 * - WebSocket (STOMP via SockJS) connection to auction-service
 * - Loads lot data from REST API on page load
 * - Bid panel state machine (loading → scheduled/deposit/kyc/auth/english/dutch/sealed/reverse/closed)
 * - Bid placement for all 4 auction types
 * - Proxy ceiling management
 * - Real-time bid history feed (WebSocket + initial REST load)
 * - Countdown timer — synced from server on every BID_UPDATE
 * - Anti-snipe extension visual (banner + timer class change)
 * - Mux HLS player init via hls.js CDN
 * - Presence tracking (join room on connect, leave on disconnect)
 * - Share button
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  // ── Credential token helpers ──────────────────────────────────────────
  const CRED_KEY = lotId => `ss_bid_cred_${lotId}`;

  function getCredentialToken(lotId) {
    return sessionStorage.getItem(CRED_KEY(lotId));
  }
  function setCredentialToken(lotId, token) {
    if (token) sessionStorage.setItem(CRED_KEY(lotId), token);
  }
  function clearCredentialToken(lotId) {
    sessionStorage.removeItem(CRED_KEY(lotId));
  }
  const room = () => $('auction-room');
  const d = (attr) => room()?.dataset[attr] || '';

  // ─── Config from data-* attributes ───────────────────────────────────────────
  function cfg() {
    const r = room();
    if (!r) return {};
    return {
      lotId:          r.dataset.lotId,
      wsUrl:          r.dataset.wsUrl,
      apiBase:        r.dataset.api,
      sym:            r.dataset.currencySymbol || '$',
      currency:       r.dataset.currency || 'USD',
      antiSnipeMin:   parseInt(r.dataset.antiSnipeMinutes) || 5,
      featDeposits:   r.dataset.featureDeposits === 'true',
      featKyc:        r.dataset.featureKyc === 'true',
      featProxy:      r.dataset.featureProxy === 'true',
      featLive:       r.dataset.featureLive === 'true',
      showViewers:    r.dataset.showViewers !== 'false',
      showBidHistory: r.dataset.showBidHistory !== 'false',
    };
  }

  // ─── State ────────────────────────────────────────────────────────────────────
  let lot = null;
  let stompClient = null;
  let countdownInterval = null;
  let isConnected = false;
  let currentUserId = null;

  // ─── DOM helpers ──────────────────────────────────────────────────────────────
  function showPanel(id) {
    document.querySelectorAll('.bid-panel-state').forEach(el =>
      el.classList.toggle('hidden', el.id !== id)
    );
  }

  function setText(id, text) {
    const el = $(id);
    if (el) el.textContent = text;
  }

  function setHtml(id, html) {
    const el = $(id);
    if (el) el.innerHTML = html;
  }

  function showEl(id) { const el = $(id); if (el) el.hidden = false; }
  function hideEl(id) { const el = $(id); if (el) el.hidden = true; }

  function setLoading(btnId, loading) {
    const btn = $(btnId);
    if (!btn) return;
    btn.disabled = loading;
    btn.querySelector('.btn-label')?.classList.toggle('hidden', loading);
    btn.querySelector('.btn-spinner')?.classList.toggle('hidden', !loading);
  }

  function fmt(amount) {
    const i18n = window.StaySphere?.i18n;
    if (i18n?.fx?.loaded) {
      const base = cfg().currency || document.body.dataset.currency || 'USD';
      const to   = i18n.currentCurrency();
      return i18n.fx.format(Number(amount || 0), base, to);
    }
    return cfg().sym + Number(amount || 0).toLocaleString('en-US');
  }

  // ─── 1. Load lot from REST API ─────────────────────────────────────────────
  async function loadLot() {
    const { lotId, apiBase } = cfg();
    if (!lotId) return;
    try {
      const res = await window.StaySphere.api(`/api/v1/auctions/${lotId}`);
      if (res.success) {
        lot = res.data;
        renderLotInfo();
        renderBidPanel();
        renderMedia();
        if (lot.status === 'OPEN' || lot.status === 'EXTENDED') loadBidHistory();
      }
    } catch (e) {
      console.error('[AuctionRoom] Failed to load lot:', e);
      showPanel('bid-state-loading');
    }
  }

  // ─── 2. Render lot metadata ─────────────────────────────────────────────────
  function renderLotInfo() {
    if (!lot) return;
    const { sym } = cfg();

    // Breadcrumb + header
    setText('room-lot-title', lot.title || 'Auction lot');
    setText('room-lot-title-h1', lot.title || '');
    setText('room-lot-location', lot.propertyCity ? `📍 ${lot.propertyCity}` : '');

    // Type badge
    const typeEl = $('room-lot-type');
    if (typeEl) {
      const icons = { ENGLISH:'📈', DUTCH:'📉', REVERSE:'🔄', SEALED_BID:'🔒' };
      const labels = { ENGLISH:'English', DUTCH:'Dutch', REVERSE:'Reverse', SEALED_BID:'Sealed' };
      typeEl.innerHTML = `
        <span class="auction-type-badge auction-type-badge--md auction-type--${(lot.auctionType||'').toLowerCase().replace('_','-')}">
          <span aria-hidden="true">${icons[lot.auctionType]||'🏷'}</span>
          ${labels[lot.auctionType]||lot.auctionType}
        </span>`;
    }

    // Description
    const descEl = $('room-lot-description');
    if (descEl && lot.description) {
      descEl.innerHTML = lot.description;
      descEl.classList.remove('hidden');
    }

    // View property link
    if (lot.propertyId) {
      const btn = $('room-view-property-btn');
      if (btn) {
        btn.hidden = false;
        btn.onclick = () => { window.location.href = `/products/${lot.propertyId}`; };
      }
    }

    // Status badge
    const statusEl = $('room-status-badge');
    if (statusEl) {
      const statusMap = {
        OPEN:      { label: '🟢 Live', cls: 'badge--live' },
        EXTENDED:  { label: '⚡ Extended', cls: 'badge--extended' },
        SCHEDULED: { label: '⏳ Starting soon', cls: 'badge--scheduled' },
        CLOSED:    { label: '🔒 Closed', cls: 'badge--closed' },
        SETTLED:   { label: '✅ Settled', cls: 'badge--settled' },
        CANCELLED: { label: '❌ Cancelled', cls: 'badge--cancelled' },
        NO_RESERVE:{ label: '⚠ Reserve not met', cls: 'badge--no-reserve' },
      };
      const s = statusMap[lot.status] || { label: lot.status, cls: '' };
      statusEl.textContent = s.label;
      statusEl.className = `auction-room__status-badge ${s.cls}`;
    }

    // Current bid panel
    updateBidDisplay(lot.currentBidAmount || lot.startingPrice, lot.totalBids, lot.uniqueBidders);

    // Start countdown
    startCountdownFromLot();
  }

  function updateBidDisplay(amount, totalBids, uniqueBidders) {
    const { sym } = cfg();
    const isClosed = lot && ['CLOSED','SETTLED','NO_RESERVE','CANCELLED'].includes(lot.status);
    const isDutch = lot?.auctionType === 'DUTCH';
    const isReverse = lot?.auctionType === 'REVERSE';
    const isSealed = lot?.auctionType === 'SEALED_BID';

    let label = 'Current bid';
    if (isDutch) label = 'Current price';
    else if (isReverse) label = 'Bids received';
    else if (isSealed) label = 'Sealed bids';
    else if (isClosed) label = 'Winning bid';
    setText('room-bid-label', label);

    if (isReverse || isSealed) {
      setText('room-bid-amount', `${totalBids || 0} bid${totalBids !== 1 ? 's' : ''}`);
    } else {
      setText('room-bid-amount', amount ? fmt(amount) : '–');
    }

    const meta = [];
    if (totalBids > 0) meta.push(`${totalBids} bid${totalBids !== 1 ? 's' : ''}`);
    if (uniqueBidders > 1) meta.push(`${uniqueBidders} bidders`);
    setText('room-bid-meta', meta.join(' · '));
  }

  // ─── 3. Render bid panel state machine ─────────────────────────────────────
  function renderBidPanel() {
    if (!lot) return showPanel('bid-state-loading');

    const status = lot.status;
    const type = lot.auctionType;

    // Closed states
    if (['CLOSED','SETTLED','NO_RESERVE','CANCELLED'].includes(status)) {
      const hasWinner = lot.winnerId != null;
      setText('bid-closed-title',
        status === 'NO_RESERVE' ? 'Reserve not met' :
        status === 'CANCELLED'  ? 'Auction cancelled' :
        hasWinner               ? '🔨 Sold!' : 'Auction closed');
      setText('bid-closed-sub',
        hasWinner ? `Winning bid: ${fmt(lot.winningAmount)}` :
        status === 'NO_RESERVE' ? 'The reserve price was not reached.' : '');
      return showPanel('bid-state-closed');
    }

    // Not open yet
    if (status === 'DRAFT' || status === 'SCHEDULED') {
      setText('bid-state-scheduled-msg',
        (() => {
          if (!lot.startsAt) return 'Check back when the auction starts.';
          const i18n = window.StaySphere?.i18n;
          const tz   = i18n?.time?.timezone || 'UTC';
          const lang = i18n?.currentLanguage?.() || 'en';
          const langMap = { en:'en-US', fr:'fr-FR', es:'es-ES', de:'de-DE', pt:'pt-BR', ar:'ar-SA', zh:'zh-CN' };
          const bcp47 = langMap[lang] || 'en-US';
          const dt = new Intl.DateTimeFormat(bcp47, {
            timeZone: tz, day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'
          }).format(new Date(lot.startsAt));
          return `Opens ${dt}`;
        })());
      return showPanel('bid-state-scheduled');
    }

    // Auth gate
    if (!window.StaySphere?.auth?.getToken()) {
      return showPanel('bid-state-auth');
    }

    // Deposit gate
    if (lot.depositRequired && cfg().featDeposits) {
      setText('deposit-amount-display', fmt(lot.depositAmount));
      const depositBtn = $('bid-deposit-btn');
      if (depositBtn) depositBtn.href = `/pages/deposit?lot=${lot.id}`;
      // Check if user already has deposit (async, non-blocking)
      window.StaySphere.api(`/api/v1/auctions/${lot.id}/deposit/status`)
        .then(r => { if (r.data === true) renderActiveBidPanel(); })
        .catch(() => {});
      return showPanel('bid-state-deposit');
    }

    // KYC gate (if threshold met)
    if (lot.kycRequired && cfg().featKyc) {
      window.StaySphere.api('/api/v1/kyc/verified')
        .then(r => { if (r.data === true) renderActiveBidPanel(); })
        .catch(() => {});
      return showPanel('bid-state-kyc');
    }

    renderActiveBidPanel();
  }

  function renderActiveBidPanel() {
    if (!lot) return;
    const type = lot.auctionType;
    if (type === 'DUTCH')      return renderDutchPanel();
    if (type === 'SEALED_BID') return renderSealedPanel();
    if (type === 'REVERSE')    return showPanel('bid-state-reverse');
    return renderEnglishPanel();
  }

  function renderEnglishPanel() {
    const min = getMinBid();
    const input = $('bid-amount-input');
    if (input) {
      input.min = min;
      input.step = lot.minimumBidIncrement || 100;
      input.placeholder = min;
    }
    setText('bid-minimum-hint', `Minimum bid: ${fmt(min)}`);
    showPanel('bid-state-english');
  }

  function renderDutchPanel() {
    const price = lot.currentBidAmount || lot.dutchStartPrice || lot.startingPrice;
    setText('dutch-current-price', fmt(price));
    setText('dutch-interval', lot.dutchDecrementIntervalSeconds || '?');
    showPanel('bid-state-dutch');
  }

  function renderSealedPanel() {
    // Check if user already bid
    window.StaySphere.api(`/api/v1/auctions/${lot.id}/bids`)
      .then(res => {
        const myBid = (res.data?.content || []).find(
          b => b.bidderId === currentUserId && b.isSealed
        );
        const alreadyBid = !!myBid;
        const sealedEl = $('bid-state-sealed');
        if (sealedEl) {
          const submitBtn = sealedEl.querySelector('.sealed-bid-submit');
          const submittedDiv = sealedEl.querySelector('.sealed-bid-form__submitted');
          const inputGroup = sealedEl.querySelector('.sealed-bid-form__input-group');
          const confirmDiv = sealedEl.querySelector('.sealed-bid-form__confirm');
          const instrDiv = sealedEl.querySelector('.sealed-bid-form__instructions');
          if (alreadyBid) {
            [submitBtn, inputGroup, confirmDiv].forEach(el => el?.classList.add('hidden'));
            submittedDiv?.classList.remove('hidden');
          } else {
            submittedDiv?.classList.add('hidden');
            [submitBtn, inputGroup, confirmDiv, instrDiv].forEach(el => el?.classList.remove('hidden'));
            const amtInput = sealedEl.querySelector('.sealed-bid-form__input');
            if (amtInput) {
              amtInput.min = lot.startingPrice;
              amtInput.placeholder = Math.round(lot.startingPrice * 1.1);
            }
          }
        }
      })
      .catch(() => {});
    showPanel('bid-state-sealed');
  }

  function getMinBid() {
    const current = lot.currentBidAmount || lot.startingPrice || 0;
    const incr = lot.minimumBidIncrement || 100;
    return lot.currentBidAmount ? current + incr : current;
  }

  // ─── 4. Render media (gallery or livestream) ────────────────────────────────
  function renderMedia() {
    const mediaEl = $('room-media');
    if (!mediaEl) return;
    const provider = lot.livestreamProvider;
    const isLive = lot.livestreamActive;

    if (provider === 'MUX' && lot.livestreamPlaybackId) {
      mediaEl.innerHTML = buildMuxPlayer(lot.livestreamPlaybackId);
      if (isLive) initMuxPlayer(lot.livestreamPlaybackId);
    } else if (provider === 'YOUTUBE' && lot.livestreamUrl) {
      mediaEl.innerHTML = `
        <div class="livestream-player${isLive ? '' : ' livestream-player--offline'}">
          ${isLive
            ? `<div class="livestream-player__live-badge"><span class="live-dot" aria-hidden="true"></span> LIVE</div>
               <div class="livestream-player__youtube">
                 <iframe src="${lot.livestreamUrl}" class="livestream-player__iframe"
                   allow="autoplay; encrypted-media" allowfullscreen loading="lazy" title="Livestream"></iframe>
               </div>`
            : `<div class="livestream-player__offline">
                 <span aria-hidden="true">📡</span>
                 <p>Livestream will start when the auction opens</p>
               </div>`}
        </div>`;
    } else if (lot.imageUrls) {
      // Render image gallery fallback
      const urls = JSON.parse(lot.imageUrls || '[]');
      if (urls.length) {
        mediaEl.innerHTML = `
          <div class="product-gallery">
            <div class="product-gallery__hero">
              <img src="${urls[0]}" alt="${esc(lot.title)}" class="product-gallery__hero-img"
                   loading="eager" width="1200" height="800">
            </div>
          </div>`;
      } else {
        mediaEl.innerHTML = `<div class="auction-room__media-placeholder" aria-hidden="true">🏠</div>`;
      }
    } else {
      mediaEl.innerHTML = `<div class="auction-room__media-placeholder" aria-hidden="true">🏠</div>`;
    }
  }

  function buildMuxPlayer(playbackId) {
    return `
      <div class="livestream-player" id="mux-player-wrap">
        <div class="livestream-player__live-badge" id="mux-live-badge" style="display:none">
          <span class="live-dot" aria-hidden="true"></span> LIVE
        </div>
        <video id="mux-video" class="livestream-player__video" controls playsinline muted
               aria-label="Auction livestream"></video>
      </div>`;
  }

  function initMuxPlayer(playbackId) {
    const streamUrl = `https://stream.mux.com/${playbackId}.m3u8`;
    const video = $('mux-video');
    if (!video) return;

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari — native HLS
      video.src = streamUrl;
      showMuxLiveBadge();
    } else {
      // Load hls.js from CDN
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.7/hls.min.js';
      s.onload = () => {
        if (window.Hls?.isSupported()) {
          const hls = new window.Hls({ lowLatencyMode: true });
          hls.loadSource(streamUrl);
          hls.attachMedia(video);
          hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
            video.play().catch(() => {});
            showMuxLiveBadge();
          });
        }
      };
      document.head.appendChild(s);
    }
  }

  function showMuxLiveBadge() {
    const badge = $('mux-live-badge');
    if (badge) badge.style.display = 'flex';
  }

  // ─── 5. WebSocket (STOMP over SockJS) ───────────────────────────────────────
  function connectWebSocket() {
    const { lotId, wsUrl, featLive } = cfg();
    if (!lotId || !featLive) return;

    const url = wsUrl || (window.location.origin.replace('https://','wss://').replace('http://','ws://') + '/ws/auction');

    // Load SockJS + STOMP from CDN if not already present
    function tryConnect() {
      if (typeof window.SockJS === 'undefined' || typeof window.Stomp === 'undefined') {
        loadSockJS(() => loadStomp(doConnect));
      } else {
        doConnect();
      }
    }

    function loadSockJS(cb) {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/sockjs-client/1.6.1/sockjs.min.js';
      s.onload = cb;
      document.head.appendChild(s);
    }

    function loadStomp(cb) {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/stomp.js/2.3.3/stomp.min.js';
      s.onload = cb;
      document.head.appendChild(s);
    }

    function doConnect() {
      try {
        const sock = new window.SockJS(url);
        stompClient = window.Stomp.over(sock);
        stompClient.debug = null; // silence STOMP debug noise

        const headers = {};
        const token = window.StaySphere?.auth?.getToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;

        stompClient.connect(headers, () => {
          isConnected = true;
          console.info('[AuctionRoom] WebSocket connected');

          // Subscribe to room broadcast
          stompClient.subscribe(`/topic/auction/${lotId}`, frame => {
            handleServerMessage(JSON.parse(frame.body));
          });

          // Subscribe to personal queue (for private messages like KYC/deposit prompts)
          stompClient.subscribe(`/user/queue/auction-errors`, frame => {
            const msg = JSON.parse(frame.body);
            window.StaySphere?.toast(msg.message || 'Bid error', 'error');
          });

          // Phase 4: private Q&A answers
          const userId = window.StaySphere?.auth?.getUserId?.() || '';
          if (userId) {
            stompClient.subscribe(`/user/queue/qa-answer-${userId}`,
              frame => handleServerMessage(JSON.parse(frame.body)));
            stompClient.subscribe(`/user/queue/auction-${lotId}-qa`,
              frame => handleServerMessage(JSON.parse(frame.body)));
          }

          // Phase 6: credential revocation + expiry push
          if (userId) {
            stompClient.subscribe(`/user/queue/credential-${userId}`,
              frame => handleServerMessage(JSON.parse(frame.body)));
          }

          // Expose STOMP client for auctioneer dashboard (Phase 7)
          window._ssStompClient = stompClient;

          // Send join — get room state snapshot back
          stompClient.send(`/ws/auction/${lotId}/join`, headers, '{}');

        }, err => {
          console.warn('[AuctionRoom] WS connect error:', err);
          isConnected = false;
          // Retry after 3s
          setTimeout(tryConnect, 3000);
        });
      } catch (e) {
        console.warn('[AuctionRoom] WS error:', e);
      }
    }

    tryConnect();
  }

  // ─── 6. Handle incoming WebSocket messages ──────────────────────────────────
  // ── Phase 6: Credential status check + expiry warning ─────────────────

  /**
   * Poll GET /api/v1/auctions/{lotId}/credential/status
   * Determines which bid panel state to show and starts the expiry countdown.
   * Polled every 3s when status is null/pending; once on first load otherwise.
   */
  async function checkCredentialStatus(lotId) {
    try {
      const res = await window.StaySphere.api(
          `/api/v1/auctions/${lotId}/credential/status`);
      const status = res?.data?.status;
      const expiresAt = res?.data?.expiresAt;

      if (status === 'ACTIVE') {
        // Credential active — show normal bid form (renderBidPanel handles this)
        // Store token is already in sessionStorage from deposit response
        startExpiryCountdown(expiresAt, lotId);
        return;
      }

      if (status === 'REVOKED') {
        showPanel('bid-state-credential-revoked');
        clearCredentialToken(lotId);
        return;
      }

      if (status === 'EXPIRED') {
        clearCredentialToken(lotId);
        // Fall through to renderBidPanel — will show deposit state if needed
        return;
      }

      // status null — credential not yet issued (deposit processing)
      if (status == null && !getCredentialToken(lotId)) {
        // If deposit was paid, show pending state and poll
        const hasCred = res?.data?.credentialId != null;
        if (!hasCred) {
          // Could be pending — show spinner and retry in 3s
          showPanel('bid-state-credential-pending');
          setTimeout(() => checkCredentialStatus(lotId), 3000);
        }
      }
    } catch(_) {
      // API unavailable — don't block the UI
    }
  }

  /**
   * Show an expiry warning banner above the bid form when < 15 min remain.
   * Updates every second. Clears credential and reverts to deposit state on expiry.
   */
  let _expiryInterval = null;
  function startExpiryCountdown(expiresAtIso, lotId) {
    if (_expiryInterval) clearInterval(_expiryInterval);
    if (!expiresAtIso) return;

    const WARNING_MS = 15 * 60 * 1000; // 15 minutes
    _expiryInterval = setInterval(() => {
      const msLeft = new Date(expiresAtIso) - Date.now();
      const warning = $('credential-expiry-warning');
      const countEl = $('credential-expiry-countdown');

      if (msLeft <= 0) {
        clearInterval(_expiryInterval);
        clearCredentialToken(lotId);
        if (warning) warning.classList.add('hidden');
        window.StaySphere?.toast?.(
          'Your bidding credential has expired. Please contact the auctioneer.', 'error');
        return;
      }

      if (msLeft < WARNING_MS) {
        if (warning) warning.classList.remove('hidden');
        if (countEl) {
          const m = Math.floor(msLeft / 60000);
          const s = Math.floor((msLeft % 60000) / 1000);
          countEl.textContent = `${m}m ${String(s).padStart(2,'0')}s`;
        }
      }
    }, 1000);
  }

  function handleServerMessage(msg) {
    const type = msg.type;

    if (type === 'ROOM_STATE') {
      // Initial snapshot on join
      if (lot) {
        lot.status        = msg.status;
        lot.auctionType   = msg.auctionType;
        lot.currentBidAmount = msg.currentBid;
        lot.totalBids     = msg.totalBids;
        lot.uniqueBidders = msg.uniqueBidders;
        lot.scheduledEndsAt = msg.endsAt;
      }
      updateBidDisplay(msg.currentBid, msg.totalBids, msg.uniqueBidders);
      if (msg.viewers !== undefined) updateViewerCount(msg.viewers);
      updateCountdownEndTime(msg.endsAt);
      renderBidPanel();
      return;
    }

    if (type === 'BID_UPDATE') {
      // New bid placed (possibly by someone else)
      if (lot) {
        lot.currentBidAmount = msg.amount;
        lot.totalBids = msg.totalBids;
        lot.uniqueBidders = msg.uniqueBidders;
        if (msg.antiSnipeExtended) {
          lot.status = 'EXTENDED';
          lot.scheduledEndsAt = msg.newEndTime;
          showAntiSnipeBanner(msg.newEndTime);
        }
      }
      updateBidDisplay(msg.amount, msg.totalBids, msg.uniqueBidders);
      updateCountdownEndTime(msg.antiSnipeExtended ? msg.newEndTime : null);
      if (msg.activeViewers !== undefined) updateViewerCount(msg.activeViewers);
      prependBidFeedItem(msg.amount, msg.currency, msg.timestamp);
      if (msg.bidId) highlightNewBid(msg.bidId);

      // Update English panel minimum
      if (lot?.auctionType === 'ENGLISH') {
        const newMin = Number(msg.amount) + (lot.minimumBidIncrement || 100);
        const input = $('bid-amount-input');
        if (input) { input.min = newMin; input.placeholder = newMin; }
        setText('bid-minimum-hint', `Minimum bid: ${fmt(newMin)}`);
      }
      return;
    }

    if (type === 'DUTCH_PRICE_UPDATE') {
      if (lot) lot.currentBidAmount = msg.newPrice;
      setText('dutch-current-price', fmt(msg.newPrice));
      updateBidDisplay(msg.newPrice, lot?.totalBids, lot?.uniqueBidders);
      return;
    }

    if (type === 'DUTCH_ACCEPTED') {
      if (lot) { lot.status = 'CLOSED'; lot.winningAmount = msg.amount; }
      showPanel('bid-state-closed');
      setText('bid-closed-title', '🔨 Sold!');
      setText('bid-closed-sub', `Winning bid: ${fmt(msg.amount)}`);
      updateStatusBadge('CLOSED');
      return;
    }

    if (type === 'CREDENTIAL_REVOKED') {
      // Server pushed credential revocation to this bidder's private queue
      const reason = msg.revokeReason || '';
      const reasonEl = $('credential-revoked-reason');
      if (reasonEl && reason) {
        reasonEl.textContent = `Your bidding credential has been revoked: ${reason}`;
      }
      const { lotId } = cfg();
      clearCredentialToken(lotId);
      showPanel('bid-state-credential-revoked');
      window.StaySphere?.toast?.('Your bidding access has been removed.', 'error');
      return;
    }

    if (type === 'CREDENTIAL_EXPIRING_SOON') {
      // Server push 15 min before expiry (optional — frontend also tracks locally)
      startExpiryCountdown(msg.expiresAt, cfg().lotId);
      return;
    }

    if (type === 'SEALED_BID_RECEIVED') {
      setText('room-bid-amount', `${msg.totalBids} bid${msg.totalBids !== 1 ? 's' : ''}`);
      return;
    }

    if (type === 'SEALED_BID_REVEAL') {
      renderSealedReveal(msg.bids, msg.winnerAmount, msg.reserveMet);
      return;
    }

    if (type === 'LOT_OPENED') {
      if (lot) { lot.status = 'OPEN'; lot.auctionType = msg.auctionType; }
      renderBidPanel();
      updateStatusBadge('OPEN');
      startCountdownFromLot();
      return;
    }

    if (type === 'LOT_CLOSED') {
      if (lot) {
        lot.status = msg.status;
        lot.winnerId = msg.winnerId;
        lot.winningAmount = msg.winningAmount;
      }
      stopCountdown();
      const hasWinner = msg.winnerId && msg.winnerId !== '';
      setText('bid-closed-title', hasWinner ? '🔨 Sold!' : 'Auction closed');
      setText('bid-closed-sub', hasWinner ? `Winning bid: ${fmt(msg.winningAmount)}` : '');
      showPanel('bid-state-closed');
      updateStatusBadge(msg.status);
      return;
    }

    if (type === 'PRESENCE_UPDATE') {
      updateViewerCount(msg.viewers);
      return;
    }
  }

  // ─── 7. Bid submission ───────────────────────────────────────────────────────
  function initBidActions() {
    const { lotId } = cfg();

    // English bid
    const submitBtn = $('bid-submit-btn');
    if (submitBtn) {
      submitBtn.addEventListener('click', async () => {
        const input = $('bid-amount-input');
        const amount = parseFloat(input?.value);
        if (!amount || amount < getMinBid()) {
          window.StaySphere?.toast(`Minimum bid is ${fmt(getMinBid())}`, 'error');
          input?.focus();
          return;
        }
        const proxyCeilingEl = $(`proxy-ceiling-${lotId}`);
        const proxyCeiling = proxyCeilingEl ? parseFloat(proxyCeilingEl.value) || null : null;

        await placeBid(amount, proxyCeiling, submitBtn);
      });
    }

    // English: Enter key on input
    $('bid-amount-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') submitBtn?.click();
    });

    // Dutch accept
    const dutchBtn = $('dutch-accept-btn');
    if (dutchBtn) {
      dutchBtn.addEventListener('click', async () => {
        setLoading('dutch-accept-btn', true);
        try {
          if (isConnected && stompClient) {
            const token = window.StaySphere?.auth?.getToken();
            stompClient.send(`/ws/auction/${lotId}/dutch-accept`,
              token ? { 'Authorization': `Bearer ${token}` } : {}, '{}');
          } else {
            await window.StaySphere.api(`/api/v1/auctions/${lotId}/dutch-accept`, { method: 'POST' });
          }
          window.StaySphere?.toast('You accepted the current price!', 'success');
        } catch (e) {
          window.StaySphere?.toast(e.message || 'Failed', 'error');
        } finally {
          setLoading('dutch-accept-btn', false);
        }
      });
    }

    // Sealed bid
    const sealedSubmit = document.querySelector('.sealed-bid-submit');
    if (sealedSubmit) {
      sealedSubmit.addEventListener('click', async () => {
        const input = document.querySelector('.sealed-bid-form__input');
        const confirm = document.getElementById(`sealed-confirm-${lotId}`);
        const amount = parseFloat(input?.value);

        if (!amount || amount < (lot?.startingPrice || 0)) {
          window.StaySphere?.toast(`Bid must be at least ${fmt(lot?.startingPrice)}`, 'error');
          return;
        }
        if (!confirm?.checked) {
          window.StaySphere?.toast('Please confirm your bid is final', 'warning');
          return;
        }
        await placeSealedBid(amount, sealedSubmit);
      });
    }

    // Reverse bid
    const reverseBtn = $('reverse-submit-btn');
    if (reverseBtn) {
      reverseBtn.addEventListener('click', async () => {
        const input = $('reverse-amount-input');
        const amount = parseFloat(input?.value);
        if (!amount || amount < 1) {
          window.StaySphere?.toast('Enter a bid amount', 'error');
          return;
        }
        await placeBid(amount, null, reverseBtn);
      });
    }

    // Proxy ceiling set
    document.querySelector('.proxy-bid-set')?.addEventListener('click', () => {
      const ceilingInput = $(`proxy-ceiling-${lotId}`);
      const val = parseFloat(ceilingInput?.value);
      if (!val || val <= (lot?.currentBidAmount || lot?.startingPrice || 0)) {
        window.StaySphere?.toast('Proxy ceiling must exceed the current bid', 'warning');
        return;
      }
      window.StaySphere?.toast(`Proxy ceiling set to ${fmt(val)}. We'll autobid up to this for you.`, 'success', 5000);
    });
  }

  async function placeBid(amount, proxyCeiling, btn) {
    const { lotId } = cfg();
    setLoading(btn?.id, true);
    try {
      const { lotId: _pLotId } = cfg();
      const payload = {
        amount,
        proxyCeiling: proxyCeiling || null,
        deviceFingerprint: navigator.userAgent.slice(0, 100),
        userAgent: navigator.userAgent,
        credentialToken: getCredentialToken(_pLotId) || null,  // Phase 5/6
      };

      // Prefer WebSocket for English/Reverse (lower latency); use REST for sealed
      if (isConnected && stompClient && lot?.auctionType !== 'SEALED_BID') {
        const token = window.StaySphere?.auth?.getToken();
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        // Enrich payload with bidder email from SDK
        payload.bidderEmail = '';
        stompClient.send(`/ws/auction/${lotId}/bid`, headers, JSON.stringify(payload));
        // Optimistic feedback — confirmed by BID_UPDATE message
        window.StaySphere?.toast('Bid placed!', 'success');
        if ($('bid-amount-input')) $('bid-amount-input').value = '';
      } else {
        const res = await window.StaySphere.api(`/api/v1/auctions/${lotId}/bids`, {
          method: 'POST', body: JSON.stringify(payload),
        });
        if (res.success) {
          window.StaySphere?.toast('Bid placed!', 'success');
          if ($('bid-amount-input')) $('bid-amount-input').value = '';
        } else {
          throw new Error(res.message || 'Bid failed');
        }
      }
    } catch (e) {
      const msg = e.message || 'Failed to place bid';
      if (msg.includes('KYC_REQUIRED')) {
        showPanel('bid-state-kyc');
      } else if (msg.includes('Deposit required')) {
        showPanel('bid-state-deposit');
      } else if (msg.includes('CREDENTIAL_INVALID')) {
        // Parse code from 'CREDENTIAL_INVALID:{code}:{message}'
        const parts = msg.split(':');
        const code = parts[1] || 'CREDENTIAL_INVALID';
        const detail = parts.slice(2).join(':') || msg;
        if (code === 'CREDENTIAL_REVOKED') {
          const reasonEl = $('credential-revoked-reason');
          if (reasonEl) reasonEl.textContent = detail;
          showPanel('bid-state-credential-revoked');
        } else if (code === 'CREDENTIAL_EXPIRED') {
          clearCredentialToken(cfg().lotId);
          window.StaySphere?.toast?.('Credential expired — contact auctioneer', 'error');
        } else {
          window.StaySphere?.toast?.(detail, 'error');
        }
      } else if (msg.includes('MAX_BIDDERS_REACHED')) {
        window.StaySphere?.toast?.('This auction has reached its bidder limit.', 'error');
      } else {
        window.StaySphere?.toast(msg, 'error');
      }
    } finally {
      setLoading(btn?.id, false);
    }
  }

  async function placeSealedBid(amount, btn) {
    const { lotId } = cfg();
    btn?.classList.add('loading');
    try {
      const res = await window.StaySphere.api(`/api/v1/auctions/${lotId}/bids`, {
        method: 'POST',
        body: JSON.stringify({
          amount,
          sealedBid: true,
          deviceFingerprint: navigator.userAgent.slice(0, 100),
          userAgent: navigator.userAgent,
        }),
      });
      if (res.success) {
        window.StaySphere?.toast('Sealed bid submitted', 'success');
        renderSealedPanel(); // refresh to show submitted state
      } else {
        throw new Error(res.message || 'Sealed bid failed');
      }
    } catch (e) {
      window.StaySphere?.toast(e.message || 'Failed', 'error');
    } finally {
      btn?.classList.remove('loading');
    }
  }

  // ─── 8. Bid history feed ─────────────────────────────────────────────────────
  async function loadBidHistory() {
    const { lotId } = cfg();
    try {
      const res = await window.StaySphere.api(`/api/v1/auctions/${lotId}/bids?size=20`);
      const bids = res.data?.content || [];
      const list = $(`bid-list-${lotId}`);
      if (!list) return;

      // Remove skeletons
      list.querySelectorAll('.bid-history__item--skeleton').forEach(el => el.remove());

      if (!bids.length) {
        list.innerHTML = '<p class="bid-history__empty">No bids yet — be the first!</p>';
        return;
      }

      list.innerHTML = bids.map(b => buildBidItem(b.amount, b.currency, b.placedAt)).join('');
      updateBidCount(bids.length);
    } catch (_) {}
  }

  function prependBidFeedItem(amount, currency, timestamp) {
    const { lotId } = cfg();
    const list = $(`bid-list-${lotId}`);
    if (!list) return;
    list.querySelectorAll('.bid-history__item--skeleton').forEach(el => el.remove());
    const emptyMsg = list.querySelector('.bid-history__empty');
    if (emptyMsg) emptyMsg.remove();

    const item = document.createElement('div');
    item.className = 'bid-history__item bid-history__item--new';
    item.innerHTML = buildBidItem(amount, currency, timestamp);
    list.prepend(item);
    // Remove "new" flash after animation
    setTimeout(() => item.classList.remove('bid-history__item--new'), 800);

    // Keep max 20 items
    const items = list.querySelectorAll('.bid-history__item:not(.bid-history__item--skeleton)');
    if (items.length > 20) items[items.length - 1].remove();

    updateBidCount(items.length);
  }

  function buildBidItem(amount, currency, timestamp) {
    const { sym } = cfg();
    const time = timestamp ? new Date(timestamp).toLocaleTimeString('en-NA', { hour:'2-digit', minute:'2-digit', second:'2-digit' }) : '';
    return `<div class="bid-history__item">
      <span class="bid-history__amount">${sym}${Number(amount).toLocaleString()}</span>
      <span class="bid-history__time">${time}</span>
    </div>`;
  }

  function updateBidCount(n) {
    const { lotId } = cfg();
    const el = $(`bid-count-${lotId}`);
    if (el) el.textContent = `${n} bid${n !== 1 ? 's' : ''}`;
  }

  function highlightNewBid(bidId) {
    // Flash the current bid amount display
    const el = $('room-bid-amount');
    if (!el) return;
    el.classList.add('bid-amount--flash');
    setTimeout(() => el.classList.remove('bid-amount--flash'), 700);
  }

  // ─── 9. Countdown ────────────────────────────────────────────────────────────
  function startCountdownFromLot() {
    const el = $(`countdown-${lot?.id}`);
    if (!el || !lot) return;
    el.dataset.endsAt = lot.scheduledEndsAt || '';
    el.dataset.status = lot.status;
    if (window.AuctionCountdown) window.AuctionCountdown.startCountdown(el);
  }

  function updateCountdownEndTime(newEndTime) {
    if (!newEndTime || !lot) return;
    lot.scheduledEndsAt = newEndTime;
    const el = $(`countdown-${lot.id}`);
    if (el) el.dataset.endsAt = newEndTime;
    // Restart the countdown with new end time
    if (window.AuctionCountdown) {
      window.AuctionCountdown.startCountdown(el);
    }
  }

  function stopCountdown() {
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
  }

  function showAntiSnipeBanner(newEndTime) {
    const wrapEl = $('room-countdown-wrap');
    if (wrapEl) {
      const existing = wrapEl.querySelector('.anti-snipe-banner');
      if (!existing) {
        const banner = document.createElement('div');
        banner.className = 'anti-snipe-banner';
        banner.innerHTML = `<span aria-hidden="true">⚡</span> Anti-snipe extension activated! Bidding extended by ${cfg().antiSnipeMin} minutes.`;
        wrapEl.prepend(banner);
        setTimeout(() => banner.remove(), 8000);
      }
    }
    const countdownEl = $(`countdown-${lot?.id}`);
    if (countdownEl) countdownEl.classList.add('countdown-timer--extended');
  }

  // ─── 10. Sealed bid reveal ────────────────────────────────────────────────────
  function renderSealedReveal(bids, winnerAmount, reserveMet) {
    const bidHistoryEl = $(`bid-history-${lot?.id}`);
    if (!bidHistoryEl) return;

    bidHistoryEl.innerHTML = `
      <div class="bid-history__header">
        <h3 class="bid-history__title">Sealed bid results</h3>
        <span class="bid-history__count">${bids.length} bids</span>
      </div>
      <div class="bid-history__sealed-reveal">
        ${bids.map(b => `
          <div class="bid-history__item${b.isWinner ? ' bid-history__item--winner' : ''}">
            <span class="bid-history__rank">#${b.rank}</span>
            <span class="bid-history__amount">${fmt(b.amount)}</span>
            ${b.isWinner ? '<span class="bid-history__winner-badge">🏆 Winner</span>' : ''}
          </div>`).join('')}
      </div>`;
  }

  // ─── 11. Misc UI ─────────────────────────────────────────────────────────────
  function updateViewerCount(n) {
    setText('viewer-count', n);
  }

  function updateStatusBadge(status) {
    const el = $('room-status-badge');
    if (!el) return;
    const statusMap = {
      OPEN:     { label: '🟢 Live',     cls: 'badge--live' },
      EXTENDED: { label: '⚡ Extended', cls: 'badge--extended' },
      CLOSED:   { label: '🔒 Closed',   cls: 'badge--closed' },
      SETTLED:  { label: '✅ Settled',  cls: 'badge--settled' },
    };
    const s = statusMap[status] || { label: status, cls: '' };
    el.textContent = s.label;
    el.className = `auction-room__status-badge ${s.cls}`;
  }

  function initShareButton() {
    const btn = document.createElement('button');
    btn.className = 'product-share-btn';
    btn.setAttribute('aria-label', 'Share this auction');
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> Share`;
    btn.addEventListener('click', async () => {
      const data = { title: document.title, url: window.location.href };
      if (navigator.share) { try { await navigator.share(data); } catch (_) {} }
      else { await navigator.clipboard.writeText(window.location.href).catch(() => {}); window.StaySphere?.toast('Link copied!'); }
    });
    $('room-status-bar')?.appendChild(btn);
  }

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ─── 12. WebSocket disconnect on page leave ──────────────────────────────────
  function initCleanup() {
    window.addEventListener('beforeunload', () => {
      if (stompClient && isConnected) {
        try { stompClient.disconnect(); } catch (_) {}
      }
    });

    // Re-render bid amounts when user changes currency
    document.addEventListener('ss:currency-changed', () => {
      const currentBid = lot?.currentBidAmount || lot?.startingPrice;
      if (currentBid) updateBidDisplay(currentBid, lot?.totalBids, lot?.uniqueBidders);
      const depEl = document.getElementById('deposit-amount-display');
      if (depEl && lot?.depositAmount) depEl.textContent = fmt(lot.depositAmount);
    });
  }

  // ─── Entry point ─────────────────────────────────────────────────────────────
  function init() {
    if (!$('auction-room')) return;

    // Get current user from SDK
    currentUserId = window.StaySphere?.config?.customerId || null;

    loadLot().then(() => {
      connectWebSocket();
    });

    initBidActions();
    initShareButton();
    initCleanup();
    checkAuctioneerRole();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ── Phase 8: Auctioneer overlay in live auction room ────────────────────

  /**
   * Fetches GET /api/v1/auctions/{lotId}/auctioneer/my-role.
   * If role is 'auctioneer' or 'both', shows the control bar and
   * enriches the bid feed with admin-level data (full pseudonyms, flag buttons).
   * Bidders and spectators: the bar stays hidden, zero overhead.
   */
  async function checkAuctioneerRole() {
    const { lotId } = cfg();
    if (!lotId || !window.StaySphere?.auth?.getToken()) return;

    try {
      const res = await window.StaySphere.api(
          `/api/v1/auctions/${lotId}/auctioneer/my-role`);
      const role = res?.data?.role;
      if (role === 'auctioneer' || role === 'both' || role === 'seller') {
        initAuctioneerBar(lotId, role);
      }
    } catch (_) { /* not an auctioneer — silently skip */ }
  }

  function initAuctioneerBar(lotId, role) {
    const bar = $('room-auctioneer-bar');
    if (!bar) return;

    // Mark the room element so CSS can target it
    const room = $('auction-room');
    if (room) room.dataset.role = role;

    // Show the bar
    bar.classList.remove('hidden');

    // Set dashboard deep-link
    const dashLink = $('ab-dashboard-link');
    if (dashLink) {
      dashLink.href = `/pages/auctioneer-dashboard?lot=${lotId}`;
    }

    // Initial status sync
    syncBarStatus();

    // Subscribe to auctioneer queue on the shared STOMP client
    const tryWs = () => {
      const stomp = window._ssStompClient;
      if (stomp?.connected) {
        stomp.subscribe(`/user/queue/auctioneer-${lotId}-queue`, frame => {
          try {
            const data = JSON.parse(frame.body);
            if (data.type === 'QA_RECEIVED') updateQaBadge(data);
          } catch (_) {}
        });
      } else {
        setTimeout(tryWs, 1500);
      }
    };
    tryWs();

    // Poll Q&A pending count every 20s
    loadQaPendingCount(lotId);
    setInterval(() => loadQaPendingCount(lotId), 20_000);

    // Wire control buttons
    $('ab-extend-btn')?.addEventListener('click', async () => {
      const mins = parseInt($('ab-extend-mins')?.value || '5');
      try {
        const res = await window.StaySphere.api(
            `/api/v1/auctions/${lotId}/extend`,
            { method: 'POST', body: JSON.stringify({ extraMinutes: mins }) });
        if (res.success) {
          window.StaySphere?.toast?.(`✅ Extended by ${mins} minutes`, 'success');
          syncBarStatus();
        } else {
          window.StaySphere?.toast?.(res.message || 'Extension failed', 'error');
        }
      } catch (_) { window.StaySphere?.toast?.('Extension failed', 'error'); }
    });

    $('ab-pause-btn')?.addEventListener('click',  () => setPauseState(true,  lotId));
    $('ab-resume-btn')?.addEventListener('click', () => setPauseState(false, lotId));
  }

  async function setPauseState(pause, lotId) {
    const endpoint = pause ? 'pause' : 'resume';
    try {
      const res = await window.StaySphere.api(
          `/api/v1/auctions/${lotId}/${endpoint}`,
          { method: 'POST' });
      if (res.success) {
        $('ab-pause-btn')?.classList.toggle('hidden',  pause);
        $('ab-resume-btn')?.classList.toggle('hidden', !pause);
        window.StaySphere?.toast?.(pause ? '⏸ Auction paused' : '▶ Resumed', 'success');
        syncBarStatus();
      }
    } catch (_) {}
  }

  function syncBarStatus() {
    // Reads current status from the lot object or the status badge
    const badge = $('room-status-badge');
    const abStatus = $('ab-status');
    if (abStatus && badge) {
      abStatus.textContent = badge.textContent.trim();
    }
  }

  async function loadQaPendingCount(lotId) {
    try {
      const res = await window.StaySphere.api(
          `/api/v1/auctions/${lotId}/questions/count/pending`);
      const count = res?.data ?? 0;
      const badge = $('ab-q-badge');
      if (!badge) return;
      if (count > 0) {
        badge.textContent = `🔔 ${count} question${count !== 1 ? 's' : ''}`;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    } catch (_) {}
  }

  function updateQaBadge(data) {
    const badge = $('ab-q-badge');
    if (!badge) return;
    const prev = parseInt(badge.textContent?.match(/\d+/)?.[0] || '0');
    const next = prev + 1;
    badge.textContent = `🔔 ${next} question${next !== 1 ? 's' : ''}`;
    badge.classList.remove('hidden');
    // Flash the badge
    badge.classList.add('ab-q-badge--flash');
    setTimeout(() => badge.classList.remove('ab-q-badge--flash'), 800);
  }

  // ── Phase 7: auction-success agreement state machine ──────────────────
  (function initSuccessPage() {
    const page = document.getElementById('auction-success-page');
    if (!page) return;
    const lotId = page.dataset.lotId;
    if (!lotId || !window.StaySphere?.auth?.getToken()) return;

    async function loadAgreementState() {
      try {
        const res = await window.StaySphere.api(`/api/v1/agreements?lotId=${lotId}`);
        const agr  = res?.data;
        const i18n = window.StaySphere?.i18n;
        const tz   = i18n?.time?.timezone || 'UTC';

        // Hide all states then show current one
        ['agr-state-pending','agr-state-sent','agr-state-buyer-signed',
         'agr-state-executed','agr-state-defaulted']
          .forEach(id => document.getElementById(id)?.classList.add('hidden'));

        if (!agr) {
          document.getElementById('agr-state-pending')?.classList.remove('hidden');
          return;
        }

        const status = agr.status;
        const fmtDt = iso => iso ? new Intl.DateTimeFormat('en-US', {
          timeZone: tz, day:'numeric', month:'long', year:'numeric'
        }).format(new Date(iso)) : '–';

        if (status === 'SENT') {
          document.getElementById('agr-state-sent')?.classList.remove('hidden');
          const deadlineEl = document.getElementById('agr-deadline');
          if (deadlineEl) deadlineEl.textContent = fmtDt(agr.paymentDeadline);
          const signBtn = document.getElementById('agr-sign-btn');
          if (signBtn) signBtn.href = `/pages/purchase-agreement?role=buyer&lot=${lotId}`;

        } else if (status === 'BUYER_SIGNED') {
          document.getElementById('agr-state-buyer-signed')?.classList.remove('hidden');

        } else if (status === 'FULLY_EXECUTED') {
          document.getElementById('agr-state-executed')?.classList.remove('hidden');
          const refEl = document.getElementById('agr-conv-ref');
          if (refEl) refEl.textContent = agr.conveyancerRef || '–';
          // Hide the steps list — conveyancing already initiated
          document.getElementById('success-next-steps')?.classList.add('hidden');

        } else if (status === 'DEFAULTED') {
          document.getElementById('agr-state-defaulted')?.classList.remove('hidden');
        } else {
          document.getElementById('agr-state-pending')?.classList.remove('hidden');
        }
      } catch (_) {
        document.getElementById('agr-state-pending')?.classList.remove('hidden');
      }
    }

    loadAgreementState();
  })();

})();
