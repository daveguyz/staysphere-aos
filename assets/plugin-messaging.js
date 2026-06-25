/**
 * StaySphere AOS — plugin-messaging.js
 * Phase G: Messages inbox + support tickets
 *
 * - Lists conversations (polling every 15s as fallback)
 * - Opens a thread and loads message history
 * - Sends messages via REST + WS broadcast
 * - Auto-resize textarea, Enter to send
 * - Unread badge update via StaySphere.config
 * - Support ticket creation + listing
 * - New conversation modal from URL params (property/booking)
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const api = (path, opts) => window.StaySphere.api(path, opts);
  const toast = (msg, type) => window.StaySphere?.toast(msg, type);
  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  let activeConvId = null;
  let pollInterval = null;
  let feedScrolled = false;

  // ─── Entry ────────────────────────────────────────────────────────────────
  function init() {
    const page = $('messages-page');
    if (!page) return;

    if (!window.StaySphere?.auth?.getToken()) {
      window.location.href = `/account/login?return_to=${encodeURIComponent(window.location.href)}`;
      return;
    }

    initConversationList();
    initMessageThread();
    initNewMessageButton();
    initSupportTickets();

    // If URL contains a conv= param, open it immediately
    const initialConv = page.dataset.initialConv;
    if (initialConv) openConversation(initialConv);

    // If URL contains property= + booking=, auto-start a conversation
    const propId    = page.dataset.initialProperty;
    const bookingId = page.dataset.initialBooking;
    if (propId || bookingId) autoStartConversation(propId, bookingId);
  }

  // ─── Conversation list ────────────────────────────────────────────────────
  async function initConversationList() {
    await loadConversations();
    // Poll every 15 s for new messages when WebSocket isn't available
    pollInterval = setInterval(loadConversations, 15000);
  }

  async function loadConversations() {
    try {
      const res = await api('/api/v1/messages/conversations?size=30');
      const convs = res.data?.content || [];
      renderConversationList(convs);
    } catch (_) {
      const listEl = $('conv-list');
      if (listEl) listEl.querySelectorAll('.conv-item--skeleton').forEach(el => el.remove());
    }
  }

  function renderConversationList(convs) {
    const listEl = $('conv-list');
    const emptyEl = $('conv-empty');
    if (!listEl) return;

    listEl.querySelectorAll('.conv-item--skeleton').forEach(el => el.remove());

    if (!convs.length) {
      if (emptyEl) emptyEl.classList.remove('hidden');
      return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');

    // Re-render (preserve active selection)
    const existing = new Set([...listEl.querySelectorAll('.conv-item')].map(el => el.dataset.convId));
    convs.forEach(conv => {
      const existing_el = listEl.querySelector(`[data-conv-id="${conv.id}"]`);
      if (existing_el) {
        // Update unread badge only
        const badge = existing_el.querySelector('.conv-item__unread');
        if (badge) badge.textContent = conv.unreadCount > 0 ? conv.unreadCount : '';
        badge?.classList.toggle('hidden', !conv.unreadCount);
        return;
      }
      const el = buildConvItem(conv);
      listEl.appendChild(el);
    });

    // Highlight active
    if (activeConvId) {
      listEl.querySelectorAll('.conv-item').forEach(el =>
        el.classList.toggle('conv-item--active', el.dataset.convId === activeConvId)
      );
    }
  }

  function buildConvItem(conv) {
    const div = document.createElement('div');
    div.className = 'conv-item' + (conv.id === activeConvId ? ' conv-item--active' : '');
    div.dataset.convId = conv.id;
    div.setAttribute('role', 'option');
    div.setAttribute('aria-selected', conv.id === activeConvId ? 'true' : 'false');

    const otherParty = conv.otherPartyName || 'Guest/Host';
    const initials   = (otherParty.split(' ').map(w => w[0]).join('').slice(0, 2)).toUpperCase();
    const preview    = esc(conv.lastMessagePreview || 'No messages yet');
    const time       = conv.lastMessageAt
      ? new Date(conv.lastMessageAt).toLocaleTimeString('en-NA', { hour: '2-digit', minute: '2-digit' })
      : '';
    const hasUnread  = (conv.unreadCount || 0) > 0;

    div.innerHTML = `
      <div class="conv-item__avatar" aria-hidden="true">${initials}</div>
      <div class="conv-item__info">
        <div class="conv-item__name-row">
          <span class="conv-item__name">${esc(otherParty)}</span>
          <span class="conv-item__time">${time}</span>
        </div>
        <p class="conv-item__preview${hasUnread ? ' conv-item__preview--unread' : ''}">${preview}</p>
      </div>
      <span class="conv-item__unread${hasUnread ? '' : ' hidden'}"
            aria-label="${conv.unreadCount} unread">
        ${conv.unreadCount || ''}
      </span>`;

    div.addEventListener('click', () => openConversation(conv.id, conv));
    return div;
  }

  // ─── Open conversation ────────────────────────────────────────────────────
  async function openConversation(convId, convMeta) {
    activeConvId = convId;

    // Highlight in sidebar
    document.querySelectorAll('.conv-item').forEach(el => {
      el.classList.toggle('conv-item--active', el.dataset.convId === convId);
      el.setAttribute('aria-selected', el.dataset.convId === convId ? 'true' : 'false');
    });

    // Show thread panel
    $('thread-idle')?.classList.add('hidden');
    $('thread-active')?.classList.remove('hidden');

    // Render header
    if (convMeta) renderThreadHeader(convMeta);

    // Load messages
    const feedEl = $('messages-feed');
    if (feedEl) feedEl.innerHTML = `<div class="messages-feed__loading" id="feed-loading" aria-hidden="true">
      ${[1,2,3].map(i => `<div class="message-bubble message-bubble--skeleton${i%2===0 ? '' : ' message-bubble--incoming'}"><div class="skeleton-block message-skeleton"></div></div>`).join('')}
    </div>`;

    try {
      const res = await api(`/api/v1/messages/conversations/${convId}/messages?size=50`);
      const messages = res.data?.content || [];
      renderMessages(messages, feedEl);
    } catch (_) {}

    // Focus compose input
    $('message-input')?.focus();
  }

  function renderThreadHeader(conv) {
    const nameEl  = $('thread-name');
    const subEl   = $('thread-sub');
    const avatarEl = $('thread-avatar');
    const bookingBtn = $('thread-view-booking');

    const otherParty = conv.otherPartyName || 'Guest/Host';
    if (nameEl)  nameEl.textContent = otherParty;
    if (subEl)   subEl.textContent  = conv.propertyTitle || conv.conversationType || '';
    if (avatarEl) {
      avatarEl.textContent = (otherParty.split(' ').map(w => w[0]).join('').slice(0, 2)).toUpperCase();
    }
    if (bookingBtn && conv.bookingId) {
      bookingBtn.href = `/pages/booking-success?booking=${conv.bookingId}`;
      bookingBtn.hidden = false;
    }
  }

  function renderMessages(messages, feedEl) {
    if (!feedEl) return;
    feedEl.innerHTML = '';
    feedScrolled = false;

    const currentUserId = window.StaySphere?.config?.customerId;

    if (!messages.length) {
      feedEl.innerHTML = '<p class="messages-feed__empty">Start the conversation!</p>';
      return;
    }

    messages.forEach(msg => {
      feedEl.appendChild(buildMessageBubble(msg, currentUserId));
    });
    scrollFeedToBottom(feedEl);
  }

  function buildMessageBubble(msg, currentUserId) {
    const isOwn = msg.senderId === currentUserId;
    const div   = document.createElement('div');
    div.className = `message-bubble${isOwn ? ' message-bubble--outgoing' : ' message-bubble--incoming'}`;
    div.dataset.msgId = msg.id;

    const time = msg.sentAt
      ? new Date(msg.sentAt).toLocaleTimeString('en-NA', { hour: '2-digit', minute: '2-digit' })
      : '';

    div.innerHTML = `
      <div class="message-bubble__content">
        <p class="message-bubble__text">${esc(msg.content)}</p>
        <div class="message-bubble__meta">
          <span class="message-bubble__time">${time}</span>
          ${isOwn ? `<span class="message-bubble__status" aria-label="Delivered">${msg.readAt ? '✓✓' : '✓'}</span>` : ''}
        </div>
      </div>`;

    return div;
  }

  function scrollFeedToBottom(feedEl) {
    feedEl.scrollTop = feedEl.scrollHeight;
  }

  function prependIncomingMessage(msg) {
    const feedEl = $('messages-feed');
    if (!feedEl || msg.conversationId !== activeConvId) return;
    const currentUserId = window.StaySphere?.config?.customerId;
    const bubble = buildMessageBubble(msg, currentUserId);
    feedEl.appendChild(bubble);
    scrollFeedToBottom(feedEl);
  }

  // ─── Message thread UI ────────────────────────────────────────────────────
  function initMessageThread() {
    const input  = $('message-input');
    const sendBtn = $('send-message-btn');
    const backBtn = $('thread-back-btn');

    if (input) {
      // Auto-resize
      input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      });
      // Ctrl+Enter or just Enter on desktop sends
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendBtn?.click();
        }
      });
    }

    sendBtn?.addEventListener('click', sendMessage);

    backBtn?.addEventListener('click', () => {
      $('thread-idle')?.classList.remove('hidden');
      $('thread-active')?.classList.add('hidden');
      activeConvId = null;
      document.querySelectorAll('.conv-item').forEach(el => {
        el.classList.remove('conv-item--active');
        el.setAttribute('aria-selected', 'false');
      });
    });
  }

  async function sendMessage() {
    const input = $('message-input');
    if (!input || !activeConvId) return;

    const content = input.value.trim();
    if (!content) return;

    input.value = '';
    input.style.height = 'auto';

    // Optimistic render
    const feedEl  = $('messages-feed');
    const optimistic = buildMessageBubble({
      id: 'opt-' + Date.now(),
      senderId: window.StaySphere?.config?.customerId,
      content,
      sentAt: new Date().toISOString(),
    }, window.StaySphere?.config?.customerId);
    optimistic.classList.add('message-bubble--pending');
    feedEl?.appendChild(optimistic);
    if (feedEl) scrollFeedToBottom(feedEl);

    try {
      const res = await api(`/api/v1/messages/conversations/${activeConvId}/send`, {
        method: 'POST',
        body: JSON.stringify({ content, type: 'TEXT' }),
      });

      if (res.success) {
        optimistic.classList.remove('message-bubble--pending');
        // Update conversation list preview
        loadConversations();
      } else {
        optimistic.classList.add('message-bubble--failed');
        optimistic.title = 'Failed to send — click to retry';
        toast('Message failed to send', 'error');
      }
    } catch (_) {
      optimistic.classList.add('message-bubble--failed');
      toast('Message failed to send', 'error');
    }
  }

  // ─── New conversation ─────────────────────────────────────────────────────
  function initNewMessageButton() {
    $('new-message-btn')?.addEventListener('click', () => {
      const recipientId = prompt('Enter the recipient user ID or leave blank to browse:');
      if (recipientId?.trim()) startConversationWith(recipientId.trim(), null, null);
    });
  }

  async function autoStartConversation(propertyId, bookingId) {
    if (!propertyId && !bookingId) return;
    try {
      // Find the host for this property
      let recipientId = null;
      if (propertyId) {
        const propRes = await api(`/api/v1/properties/${propertyId}`);
        recipientId = propRes.data?.hostId;
      }
      if (recipientId) startConversationWith(recipientId, bookingId, propertyId);
    } catch (_) {}
  }

  async function startConversationWith(recipientId, bookingId, propertyId) {
    try {
      const res = await api('/api/v1/messages/conversations', {
        method: 'POST',
        body: JSON.stringify({ recipientId, bookingId, propertyId }),
      });
      if (res.success) {
        await loadConversations();
        openConversation(res.data.id, res.data);
      }
    } catch (_) {
      toast('Could not start conversation', 'error');
    }
  }

  // ─── Conversation search ──────────────────────────────────────────────────
  $('conv-search')?.addEventListener('input', function () {
    const q = this.value.toLowerCase();
    document.querySelectorAll('.conv-item:not(.conv-item--skeleton)').forEach(el => {
      el.classList.toggle('hidden', !el.textContent.toLowerCase().includes(q));
    });
  });

  // ─── Support tickets ──────────────────────────────────────────────────────
  function initSupportTickets() {
    loadSupportTickets();

    $('new-ticket-btn')?.addEventListener('click', () => {
      $('new-ticket-form')?.classList.remove('hidden');
      $('ticket-subject')?.focus();
    });

    $('cancel-ticket-btn')?.addEventListener('click', () => {
      $('new-ticket-form')?.classList.add('hidden');
    });

    $('submit-ticket-btn')?.addEventListener('click', submitTicket);
  }

  async function loadSupportTickets() {
    const listEl = $('support-tickets-list');
    if (!listEl) return;
    try {
      const res = await api('/api/v1/messages/support/tickets?size=10');
      const tickets = res.data?.content || [];
      listEl.querySelectorAll('.support-ticket-row--skeleton').forEach(el => el.remove());

      if (!tickets.length) {
        listEl.innerHTML = '<p style="color:var(--color-text-muted);font-size:.9rem;">No support tickets yet.</p>';
        return;
      }

      listEl.innerHTML = tickets.map(t => {
        const priorityClass = { HIGH: 'ticket-priority--high', MEDIUM: 'ticket-priority--medium', LOW: 'ticket-priority--low' }[t.priority] || '';
        const statusClass = { OPEN: 'ticket-status--open', IN_PROGRESS: 'ticket-status--progress', RESOLVED: 'ticket-status--resolved' }[t.status] || '';
        const created = t.createdAt ? new Date(t.createdAt).toLocaleDateString('en-NA') : '';
        return `
          <div class="support-ticket-row">
            <div class="support-ticket-row__info">
              <p class="support-ticket-row__subject">${esc(t.subject)}</p>
              <p class="support-ticket-row__meta">${esc(t.category || '')} · ${created}</p>
            </div>
            <div class="support-ticket-row__badges">
              <span class="support-ticket-badge ${priorityClass}">${t.priority}</span>
              <span class="support-ticket-badge ${statusClass}">${t.status}</span>
            </div>
          </div>`;
      }).join('');
    } catch (_) {}
  }

  async function submitTicket() {
    const subject  = $('ticket-subject')?.value.trim();
    const category = $('ticket-category')?.value;
    const desc     = $('ticket-description')?.value.trim();
    const priority = $('ticket-priority')?.value;
    const errEl    = $('ticket-error');

    if (!subject || !desc) {
      if (errEl) { errEl.textContent = 'Please fill in subject and description.'; errEl.classList.remove('hidden'); }
      return;
    }
    if (errEl) errEl.classList.add('hidden');

    const btn = $('submit-ticket-btn');
    if (btn) { btn.disabled = true; btn.querySelector('.btn-label')?.classList.add('hidden'); btn.querySelector('.btn-spinner')?.classList.remove('hidden'); }

    try {
      const res = await api('/api/v1/messages/support/tickets', {
        method: 'POST',
        body: JSON.stringify({ subject, category, description: desc, priority }),
      });
      if (res.success) {
        toast('Support ticket submitted — we\'ll be in touch soon', 'success');
        $('new-ticket-form')?.classList.add('hidden');
        $('ticket-subject && ticket-description'.split('&&')[0].trim()).value = '';
        loadSupportTickets();
      } else {
        if (errEl) { errEl.textContent = res.message || 'Submission failed'; errEl.classList.remove('hidden'); }
      }
    } catch (_) {
      if (errEl) { errEl.textContent = 'Submission failed. Please try again.'; errEl.classList.remove('hidden'); }
    } finally {
      if (btn) { btn.disabled = false; btn.querySelector('.btn-label')?.classList.remove('hidden'); btn.querySelector('.btn-spinner')?.classList.add('hidden'); }
    }
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────
  window.addEventListener('beforeunload', () => {
    clearInterval(pollInterval);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
