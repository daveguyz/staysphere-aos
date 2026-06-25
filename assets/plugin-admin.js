/**
 * StaySphere AOS — plugin-admin.js
 * Phase G: Admin dashboard
 * Requires ADMIN or SUPERADMIN role.
 * Tabs: Auctions / Users / Properties / Bookings / Fraud queue / Support / Analytics
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const api = (path, opts) => window.StaySphere.api(path, opts);
  const toast = msg => window.StaySphere?.toast(msg);
  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const fmt = n => 'N$' + Number(n || 0).toLocaleString('en-NA', { minimumFractionDigits: 0 });
  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-NA', { day:'numeric', month:'short', year:'numeric' }) : '–';

  function init() {
    const dash = $('admin-dashboard');
    if (!dash) return;

    if (!window.StaySphere?.auth?.getToken()) {
      window.location.href = '/account/login?return_to=/pages/admin';
      return;
    }

    initTabs();
    loadStats();
    loadAuctions();
  }

  // ─── Tabs ─────────────────────────────────────────────────────────────────
  function initTabs() {
    document.querySelectorAll('.admin-tabs .account-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.admin-tabs .account-tab').forEach(t => {
          t.classList.remove('account-tab--active');
          t.setAttribute('aria-selected', 'false');
        });
        document.querySelectorAll('#admin-dashboard .account-panel').forEach(p =>
          p.classList.add('hidden')
        );
        tab.classList.add('account-tab--active');
        tab.setAttribute('aria-selected', 'true');
        const panel = $(tab.dataset.panel);
        if (panel) panel.classList.remove('hidden');

        // Lazy load
        const panelId = tab.dataset.panel;
        if (!panel?.dataset.loaded) {
          panel.dataset.loaded = '1';
          if (panelId === 'ap-users')      loadUsers();
          else if (panelId === 'ap-properties') loadProperties();
          else if (panelId === 'ap-bookings')   loadBookings();
          else if (panelId === 'ap-fraud')      loadFraudQueue();
          else if (panelId === 'ap-support')    loadSupportTickets();
          else if (panelId === 'ap-analytics')  loadAnalytics();
        }
      });
    });

    // Auction filters
    $('auction-status-filter')?.addEventListener('change', loadAuctions);
    $('auction-search-input')?.addEventListener('input', debounce(loadAuctions, 400));
    $('user-role-filter')?.addEventListener('change', loadUsers);
    $('user-search-input')?.addEventListener('input', debounce(loadUsers, 400));
    $('ticket-status-filter')?.addEventListener('change', loadSupportTickets);
  }

  function debounce(fn, ms) {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // ─── Stats ────────────────────────────────────────────────────────────────
  async function loadStats() {
    try {
      const [auctionStats, analyticsStats] = await Promise.all([
        api('/api/v1/admin/auctions/stats').catch(() => ({ success: false })),
        api('/api/v1/analytics/platform-summary').catch(() => ({ success: false })),
      ]);

      const as = auctionStats.data || {};
      const pl = analyticsStats.data || {};

      setStat('as-users',       pl.totalUsers ?? '–');
      setStat('as-bookings',    pl.activeBookings ?? '–');
      setStat('as-live-auctions', (as.liveLots ?? 0));
      setStat('as-revenue',     pl.revenueToday != null ? fmt(pl.revenueToday) : '–');
      setStat('as-tickets',     pl.openTickets ?? '–');
      setStat('as-properties',  pl.totalProperties ?? '–');
    } catch (_) {}
  }

  function setStat(id, val) {
    const card = $(id);
    if (!card) return;
    const el = card.querySelector('.host-stat-card__value');
    if (el) { el.innerHTML = ''; el.textContent = val; }
  }

  // ─── Auctions ─────────────────────────────────────────────────────────────
  let auctionPage = 0, auctionTotal = 0;

  async function loadAuctions() {
    const rowsEl  = $('admin-auctions-rows');
    const emptyEl = $('admin-auctions-empty');
    const pagNav  = $('admin-auctions-pag');
    if (!rowsEl) return;

    const status = $('auction-status-filter')?.value || '';
    const search = $('auction-search-input')?.value?.trim() || '';
    const qs = new URLSearchParams({ page: auctionPage, size: 20 });
    if (status) qs.set('statuses', status);
    if (search) qs.set('search', search);

    try {
      const res = await api(`/api/v1/admin/auctions?${qs}`);
      const lots = res.data?.content || [];
      auctionTotal = res.data?.totalPages || 1;
      rowsEl.querySelectorAll('.admin-table__row--skeleton').forEach(el => el.remove());

      if (!lots.length) {
        if (emptyEl) emptyEl.classList.remove('hidden');
        rowsEl.innerHTML = '';
        if (pagNav) pagNav.classList.add('hidden');
        return;
      }
      if (emptyEl) emptyEl.classList.add('hidden');

      rowsEl.innerHTML = lots.map(l => `
        <div class="admin-table__row admin-table__row--auctions">
          <span class="admin-table__cell admin-table__cell--wrap">${esc(l.title)}</span>
          <span class="admin-table__cell">${l.auctionType}</span>
          <span class="admin-table__cell">
            <span class="badge badge--${(l.status||'').toLowerCase()}">${l.status}</span>
          </span>
          <span class="admin-table__cell">${l.currentBidAmount ? fmt(l.currentBidAmount) : '–'}</span>
          <span class="admin-table__cell">${fmtDate(l.startsAt)}</span>
          <span class="admin-table__cell admin-table__cell--actions">
            ${l.status === 'SCHEDULED' ? `<button class="btn btn--ghost btn--sm admin-lot-open" data-id="${esc(l.id)}">Open</button>` : ''}
            ${(l.status === 'OPEN' || l.status === 'EXTENDED') ? `<button class="btn btn--ghost btn--sm admin-lot-close" data-id="${esc(l.id)}">Close</button>` : ''}
            ${l.status === 'CLOSED' ? `<button class="btn btn--ghost btn--sm admin-lot-settle" data-id="${esc(l.id)}">Settle</button>` : ''}
          </span>
        </div>`).join('');

      // Pagination
      if (pagNav) {
        pagNav.classList.toggle('hidden', auctionTotal <= 1);
        const prev = $('aap-prev'); const next = $('aap-next'); const info = $('aap-info');
        if (prev) prev.disabled = auctionPage === 0;
        if (next) next.disabled = auctionPage >= auctionTotal - 1;
        if (info) info.textContent = `Page ${auctionPage + 1} of ${auctionTotal}`;
      }

      // Action buttons
      rowsEl.querySelectorAll('.admin-lot-open').forEach(btn => btn.addEventListener('click', async () => {
        await api(`/api/v1/admin/auctions/${btn.dataset.id}/open`, { method: 'POST' });
        toast('Lot opened'); loadAuctions();
      }));
      rowsEl.querySelectorAll('.admin-lot-close').forEach(btn => btn.addEventListener('click', async () => {
        await api(`/api/v1/admin/auctions/${btn.dataset.id}/close`, { method: 'POST' });
        toast('Lot closed'); loadAuctions();
      }));
      rowsEl.querySelectorAll('.admin-lot-settle').forEach(btn => btn.addEventListener('click', async () => {
        await api(`/api/v1/admin/auctions/${btn.dataset.id}/settle`, { method: 'POST' });
        toast('Lot settled'); loadAuctions();
      }));
    } catch (_) {}
  }

  $('aap-prev')?.addEventListener('click', () => { if (auctionPage > 0) { auctionPage--; loadAuctions(); } });
  $('aap-next')?.addEventListener('click', () => { if (auctionPage < auctionTotal - 1) { auctionPage++; loadAuctions(); } });

  // ─── Users ────────────────────────────────────────────────────────────────
  async function loadUsers() {
    const rowsEl  = $('admin-users-rows');
    const emptyEl = $('admin-users-empty');
    if (!rowsEl) return;

    const role   = $('user-role-filter')?.value || '';
    const search = $('user-search-input')?.value?.trim() || '';
    const qs = new URLSearchParams({ page: 0, size: 30 });
    if (role)   qs.set('role', role);
    if (search) qs.set('search', search);

    try {
      const res = await api(`/api/v1/auth/admin/users?${qs}`);
      const users = res.data?.content || [];
      rowsEl.querySelectorAll('.admin-table__row--skeleton').forEach(el => el.remove());

      if (!users.length) {
        if (emptyEl) emptyEl.classList.remove('hidden'); rowsEl.innerHTML = ''; return;
      }
      if (emptyEl) emptyEl.classList.add('hidden');

      rowsEl.innerHTML = users.map(u => `
        <div class="admin-table__row admin-table__row--users">
          <span class="admin-table__cell">${esc(u.firstName || '')} ${esc(u.lastName || '')}</span>
          <span class="admin-table__cell">${esc(u.email)}</span>
          <span class="admin-table__cell">${u.role}</span>
          <span class="admin-table__cell">${u.kycVerified ? '✓ Verified' : '–'}</span>
          <span class="admin-table__cell">${fmtDate(u.createdAt)}</span>
          <span class="admin-table__cell admin-table__cell--actions">
            <button class="btn btn--ghost btn--sm admin-user-view" data-id="${esc(u.id)}">View</button>
          </span>
        </div>`).join('');
    } catch (_) {}
  }

  // ─── Properties ───────────────────────────────────────────────────────────
  async function loadProperties() {
    const rowsEl  = $('admin-properties-rows');
    const emptyEl = $('admin-properties-empty');
    if (!rowsEl) return;
    try {
      const res = await api('/api/v1/properties/search?page=0&size=30');
      const props = res.data?.content || [];
      rowsEl.querySelectorAll('.admin-table__row--skeleton').forEach(el => el.remove());
      if (!props.length) { if (emptyEl) emptyEl.classList.remove('hidden'); return; }
      if (emptyEl) emptyEl.classList.add('hidden');
      rowsEl.innerHTML = props.map(p => `
        <div class="admin-table__row admin-table__row--properties">
          <span class="admin-table__cell admin-table__cell--wrap">${esc(p.title)}</span>
          <span class="admin-table__cell">${esc(p.hostId || '–')}</span>
          <span class="admin-table__cell">${esc(p.location?.city || '–')}</span>
          <span class="admin-table__cell">${p.pricing?.baseRate ? fmt(p.pricing.baseRate) : '–'}</span>
          <span class="admin-table__cell">${p.status || 'ACTIVE'}</span>
          <span class="admin-table__cell admin-table__cell--actions">
            <a href="/products/${esc(p.shopifyHandle || p.id)}" class="btn btn--ghost btn--sm">View</a>
          </span>
        </div>`).join('');
    } catch (_) {}
  }

  // ─── Bookings ─────────────────────────────────────────────────────────────
  async function loadBookings() {
    const rowsEl = $('admin-bookings-rows');
    if (!rowsEl) return;
    try {
      const res = await api('/api/v1/bookings/admin?page=0&size=30').catch(() =>
        api('/api/v1/bookings/host?page=0&size=30')
      );
      const bookings = res.data?.content || [];
      rowsEl.querySelectorAll('.admin-table__row--skeleton').forEach(el => el.remove());
      rowsEl.innerHTML = bookings.map(b => `
        <div class="admin-table__row admin-table__row--bookings">
          <span class="admin-table__cell admin-table__cell--mono">${esc((b.id||'').slice(0,8))}…</span>
          <span class="admin-table__cell admin-table__cell--wrap">${esc(b.property?.title || b.propertyId || '–')}</span>
          <span class="admin-table__cell">${esc(b.guest?.email || '–')}</span>
          <span class="admin-table__cell">${b.checkIn || '–'} → ${b.checkOut || '–'}</span>
          <span class="admin-table__cell">${b.totalAmount ? fmt(b.totalAmount) : '–'}</span>
          <span class="admin-table__cell">
            <span class="account-booking-row__status booking-status--${(b.status||'').toLowerCase()}">${b.status || '–'}</span>
          </span>
        </div>`).join('');
    } catch (_) {}
  }

  // ─── Fraud queue ──────────────────────────────────────────────────────────
  async function loadFraudQueue() {
    const rowsEl  = $('admin-fraud-rows');
    const emptyEl = $('admin-fraud-empty');
    if (!rowsEl) return;
    try {
      const res = await api('/api/v1/admin/auctions/fraud/flagged');
      const bids = res.data || [];
      rowsEl.querySelectorAll('.admin-table__row--skeleton').forEach(el => el.remove());
      if (!bids.length) {
        if (emptyEl) emptyEl.classList.remove('hidden'); rowsEl.innerHTML = ''; return;
      }
      if (emptyEl) emptyEl.classList.add('hidden');
      rowsEl.innerHTML = bids.map(b => {
        const score = b.fraudScore ? (Number(b.fraudScore) * 100).toFixed(0) + '%' : '–';
        const scoreClass = Number(b.fraudScore) > 0.7 ? 'fraud-score--high' : Number(b.fraudScore) > 0.4 ? 'fraud-score--medium' : 'fraud-score--low';
        return `
          <div class="admin-table__row admin-table__row--fraud">
            <span class="admin-table__cell admin-table__cell--mono">${esc((b.id||'').slice(0,8))}…</span>
            <span class="admin-table__cell admin-table__cell--mono">${esc((b.auctionLotId||'').slice(0,8))}…</span>
            <span class="admin-table__cell">${esc((b.bidderId||'').slice(0,8))}…</span>
            <span class="admin-table__cell">${b.amount ? fmt(b.amount) : '–'}</span>
            <span class="admin-table__cell"><span class="fraud-score-badge ${scoreClass}">${score}</span></span>
            <span class="admin-table__cell admin-table__cell--actions">
              <button class="btn btn--ghost btn--sm admin-fraud-clear" data-id="${esc(b.id)}">Clear flag</button>
            </span>
          </div>`;
      }).join('');

      rowsEl.querySelectorAll('.admin-fraud-clear').forEach(btn => {
        btn.addEventListener('click', async () => {
          await api(`/api/v1/admin/auctions/fraud/bids/${btn.dataset.id}/clear`, { method: 'POST' });
          toast('Fraud flag cleared');
          loadFraudQueue();
        });
      });
    } catch (_) {}
  }

  // ─── Support tickets ──────────────────────────────────────────────────────
  async function loadSupportTickets() {
    const rowsEl  = $('admin-support-rows');
    const emptyEl = $('admin-support-empty');
    if (!rowsEl) return;
    const status = $('ticket-status-filter')?.value || 'OPEN';
    try {
      const res = await api(`/api/v1/messages/support/tickets/admin?page=0&size=20&status=${status}`);
      const tickets = res.data?.content || [];
      rowsEl.querySelectorAll('.admin-table__row--skeleton').forEach(el => el.remove());
      if (!tickets.length) {
        if (emptyEl) emptyEl.classList.remove('hidden'); rowsEl.innerHTML = ''; return;
      }
      if (emptyEl) emptyEl.classList.add('hidden');
      rowsEl.innerHTML = tickets.map(t => {
        const priorityClass = { HIGH:'ticket-priority--high', MEDIUM:'ticket-priority--medium', LOW:'ticket-priority--low' }[t.priority] || '';
        const statusClass = { OPEN:'ticket-status--open', IN_PROGRESS:'ticket-status--progress', RESOLVED:'ticket-status--resolved' }[t.status] || '';
        return `
          <div class="admin-table__row admin-table__row--support">
            <span class="admin-table__cell admin-table__cell--wrap">${esc(t.subject)}</span>
            <span class="admin-table__cell">${esc(t.userId?.slice(0,8))}…</span>
            <span class="admin-table__cell">${t.category || '–'}</span>
            <span class="admin-table__cell"><span class="support-ticket-badge ${priorityClass}">${t.priority}</span></span>
            <span class="admin-table__cell">${fmtDate(t.createdAt)}</span>
            <span class="admin-table__cell admin-table__cell--actions">
              <button class="btn btn--ghost btn--sm admin-ticket-resolve" data-id="${esc(t.id)}">Resolve</button>
            </span>
          </div>`;
      }).join('');

      rowsEl.querySelectorAll('.admin-ticket-resolve').forEach(btn => {
        btn.addEventListener('click', async () => {
          await api(`/api/v1/messages/support/tickets/${btn.dataset.id}/status`, {
            method: 'PUT', body: JSON.stringify({ status: 'RESOLVED', resolutionNotes: 'Resolved by admin' })
          });
          toast('Ticket resolved'); loadSupportTickets();
        });
      });
    } catch (_) {}
  }

  // ─── Analytics ────────────────────────────────────────────────────────────
  async function loadAnalytics() {
    try {
      const res = await api('/api/v1/analytics/platform-summary');
      if (!res.success) return;
      const data = res.data || {};

      renderAnalyticsChart('admin-revenue-chart', data.monthlyRevenue || [], 'revenue');
      renderAnalyticsChart('admin-bookings-chart', data.monthlyBookings || [], 'count');

      const metricsEl = $('admin-analytics-metrics');
      if (metricsEl && data) {
        metricsEl.innerHTML = `
          <div class="admin-stats-grid" style="margin-top:20px;">
            ${[
              ['Total revenue', data.totalRevenue ? fmt(data.totalRevenue) : '–'],
              ['Total bookings', data.totalBookings ?? '–'],
              ['Total auctions', data.totalAuctions ?? '–'],
              ['Avg booking value', data.avgBookingValue ? fmt(data.avgBookingValue) : '–'],
              ['Cancellation rate', data.cancellationRate != null ? data.cancellationRate.toFixed(1) + '%' : '–'],
              ['KYC verified users', data.kycVerifiedUsers ?? '–'],
            ].map(([label, val]) => `
              <div class="host-stat-card">
                <p class="host-stat-card__label">${label}</p>
                <p class="host-stat-card__value">${val}</p>
              </div>`).join('')}
          </div>`;
      }
    } catch (_) {}
  }

  function renderAnalyticsChart(containerId, months, valueKey) {
    const container = $(containerId);
    if (!container) return;
    const placeholder = container.querySelector('[id$="-placeholder"]');

    if (!months.length) {
      if (placeholder) placeholder.innerHTML = '<p style="color:var(--color-text-muted);text-align:center;padding:40px">No data yet</p>';
      return;
    }

    const W = 560, H = 180;
    const maxVal = Math.max(...months.map(m => m[valueKey] || 0), 1);
    const barW   = Math.floor(W / months.length) - 8;

    const bars = months.map((m, i) => {
      const barH = Math.round(((m[valueKey] || 0) / maxVal) * (H - 28));
      const x    = i * (W / months.length) + 4;
      const y    = H - barH - 18;
      const label = valueKey === 'revenue' ? fmt(m.revenue || 0) : (m.count || 0);
      return `
        <rect x="${x}" y="${y}" width="${barW}" height="${barH}"
              fill="var(--color-primary)" rx="3" opacity=".8">
          <title>${m.month}: ${label}</title>
        </rect>
        <text x="${x + barW / 2}" y="${H - 2}" text-anchor="middle"
              font-size="10" fill="var(--color-text-muted)">${(m.month||'').slice(0,3)}</text>`;
    }).join('');

    const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" aria-label="Analytics chart" role="img">
      <title>Platform analytics</title>${bars}</svg>`;

    if (placeholder) {
      placeholder.outerHTML = svg;
    } else {
      const existing = container.querySelector('svg');
      if (existing) existing.outerHTML = svg;
      else container.innerHTML = svg;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
