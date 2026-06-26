/**
 * StaySphere AOS — plugin-locale-selector.js
 * Phase E: The floating locale selector widget.
 *
 * Renders a pill (flag + currency + timezone offset) in the header.
 * Clicking opens a dropdown with three tabs:
 *   Language | Currency | Timezone
 * Each tab has a search field and a scrollable list.
 * Persists choice immediately and re-renders prices/strings.
 */
(function () {
  'use strict';

  const PANEL_ID  = 'ss-locale-panel';
  const TOGGLE_ID = 'ss-locale-toggle';

  // ── Timezone list (IANA zones with display labels) ────────────
  const TIMEZONES = [
    { tz: 'Pacific/Honolulu',     label: 'Hawaii (UTC−10)',            offset: -10 },
    { tz: 'America/Anchorage',    label: 'Alaska (UTC−9)',             offset: -9  },
    { tz: 'America/Los_Angeles',  label: 'Pacific Time (UTC−8)',       offset: -8  },
    { tz: 'America/Denver',       label: 'Mountain Time (UTC−7)',      offset: -7  },
    { tz: 'America/Chicago',      label: 'Central Time (UTC−6)',       offset: -6  },
    { tz: 'America/New_York',     label: 'Eastern Time (UTC−5)',       offset: -5  },
    { tz: 'America/Sao_Paulo',    label: 'Brazil (UTC−3)',             offset: -3  },
    { tz: 'Atlantic/Azores',      label: 'Azores (UTC−1)',             offset: -1  },
    { tz: 'UTC',                  label: 'UTC (UTC+0)',                 offset: 0   },
    { tz: 'Europe/London',        label: 'London (UTC+0/+1)',          offset: 0   },
    { tz: 'Europe/Paris',         label: 'Paris / Berlin (UTC+1/+2)',  offset: 1   },
    { tz: 'Europe/Helsinki',      label: 'Helsinki (UTC+2/+3)',        offset: 2   },
    { tz: 'Africa/Johannesburg',  label: 'Johannesburg (UTC+2)',       offset: 2   },
    { tz: 'Africa/Windhoek',      label: 'Windhoek (UTC+2)',           offset: 2   },
    { tz: 'Africa/Cairo',         label: 'Cairo (UTC+2)',              offset: 2   },
    { tz: 'Africa/Nairobi',       label: 'Nairobi (UTC+3)',            offset: 3   },
    { tz: 'Asia/Riyadh',          label: 'Riyadh (UTC+3)',             offset: 3   },
    { tz: 'Asia/Dubai',           label: 'Dubai (UTC+4)',              offset: 4   },
    { tz: 'Asia/Kolkata',         label: 'India (UTC+5:30)',           offset: 5.5 },
    { tz: 'Asia/Dhaka',           label: 'Dhaka (UTC+6)',              offset: 6   },
    { tz: 'Asia/Bangkok',         label: 'Bangkok (UTC+7)',            offset: 7   },
    { tz: 'Asia/Shanghai',        label: 'China (UTC+8)',              offset: 8   },
    { tz: 'Asia/Hong_Kong',       label: 'Hong Kong (UTC+8)',          offset: 8   },
    { tz: 'Asia/Singapore',       label: 'Singapore (UTC+8)',          offset: 8   },
    { tz: 'Asia/Tokyo',           label: 'Tokyo (UTC+9)',              offset: 9   },
    { tz: 'Australia/Sydney',     label: 'Sydney (UTC+10/+11)',        offset: 10  },
    { tz: 'Pacific/Auckland',     label: 'Auckland (UTC+12/+13)',      offset: 12  },
  ];

  function getI18n() { return window.StaySphere?.i18n; }

  function currentTzOffset(tz) {
    try {
      const now  = new Date();
      const utc  = now.getTime() + now.getTimezoneOffset() * 60000;
      const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
      const diff  = Math.round((local - now) / 3600000);
      return diff >= 0 ? `UTC+${diff}` : `UTC${diff}`;
    } catch (_) { return ''; }
  }

  // ── Build and inject the pill toggle + panel ──────────────────
  function buildWidget() {
    const i18n = getI18n();
    if (!i18n) return;

    const locale   = i18n.currentLocale();
    const langInfo = i18n.LANGUAGES[locale.language] || { flag: '🌐', label: 'English' };
    const curInfo  = i18n.CURRENCIES[locale.currency] || { symbol: '$' };
    const tzOffset = currentTzOffset(locale.timezone || 'UTC');

    // ── Toggle pill ──
    const existingToggle = document.getElementById(TOGGLE_ID);
    if (existingToggle) existingToggle.remove();

    const toggle = document.createElement('button');
    toggle.id = TOGGLE_ID;
    toggle.className = 'locale-toggle';
    toggle.setAttribute('aria-label', 'Select language, currency and timezone');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', PANEL_ID);
    toggle.innerHTML = `
      <span class="locale-toggle__flag" aria-hidden="true">${langInfo.flag}</span>
      <span class="locale-toggle__currency">${curInfo.symbol}</span>
      <span class="locale-toggle__tz">${tzOffset}</span>
      <svg class="locale-toggle__chevron" width="12" height="12" viewBox="0 0 24 24"
           fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
        <polyline points="6 9 12 15 18 9"/>
      </svg>`;

    toggle.addEventListener('click', () => togglePanel());

    // Inject into header actions or body
    const headerActions = document.querySelector('.header__actions, .nav__actions, [data-locale-anchor]');
    if (headerActions) {
      headerActions.prepend(toggle);
    } else {
      document.body.appendChild(toggle);
    }

    // ── Panel ──
    buildPanel(locale, toggle);
  }

  function buildPanel(locale, toggleEl) {
    const i18n = getI18n();
    const existingPanel = document.getElementById(PANEL_ID);
    if (existingPanel) existingPanel.remove();

    const panel = document.createElement('div');
    panel.id    = PANEL_ID;
    panel.className = 'locale-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Preferences');
    panel.hidden = true;

    panel.innerHTML = `
      <div class="locale-panel__header">
        <h2 class="locale-panel__title">Preferences</h2>
        <button class="locale-panel__close" id="ss-locale-close" aria-label="Close preferences">✕</button>
      </div>

      <div class="locale-panel__tabs" role="tablist">
        <button class="locale-tab locale-tab--active" role="tab"
                data-tab="language" aria-selected="true" aria-controls="ltab-language">
          🌐 Language
        </button>
        <button class="locale-tab" role="tab"
                data-tab="currency" aria-selected="false" aria-controls="ltab-currency">
          💱 Currency
        </button>
        <button class="locale-tab" role="tab"
                data-tab="timezone" aria-selected="false" aria-controls="ltab-timezone">
          🕐 Timezone
        </button>
      </div>

      ${buildLanguageTab(locale)}
      ${buildCurrencyTab(locale)}
      ${buildTimezoneTab(locale)}
    `;

    document.body.appendChild(panel);

    // ── Tab switching ──
    panel.querySelectorAll('.locale-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        panel.querySelectorAll('.locale-tab').forEach(t => {
          t.classList.remove('locale-tab--active');
          t.setAttribute('aria-selected', 'false');
        });
        panel.querySelectorAll('.locale-tab-panel').forEach(p => p.classList.add('hidden'));
        tab.classList.add('locale-tab--active');
        tab.setAttribute('aria-selected', 'true');
        const target = panel.querySelector(`#ltab-${tab.dataset.tab}`);
        if (target) target.classList.remove('hidden');
      });
    });

    // ── Search filters ──
    panel.querySelectorAll('.locale-search').forEach(input => {
      input.addEventListener('input', function () {
        const q = this.value.toLowerCase();
        this.closest('.locale-tab-panel').querySelectorAll('.locale-option').forEach(opt => {
          opt.classList.toggle('hidden', !opt.textContent.toLowerCase().includes(q));
        });
      });
    });

    // ── Language selection ──
    panel.querySelectorAll('[data-lang]').forEach(btn => {
      btn.addEventListener('click', () => {
        const lang = btn.dataset.lang;
        getI18n()?.setLanguage(lang);
        panel.querySelectorAll('[data-lang]').forEach(b => b.classList.remove('locale-option--active'));
        btn.classList.add('locale-option--active');
        refreshToggle();
      });
    });

    // ── Currency selection ──
    panel.querySelectorAll('[data-currency]').forEach(btn => {
      btn.addEventListener('click', () => {
        const cur = btn.dataset.currency;
        getI18n()?.setCurrency(cur);
        panel.querySelectorAll('[data-currency]').forEach(b => b.classList.remove('locale-option--active'));
        btn.classList.add('locale-option--active');
        refreshToggle();
      });
    });

    // ── Timezone selection ──
    panel.querySelectorAll('[data-timezone]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tz = btn.dataset.timezone;
        getI18n()?.setTimezone(tz);
        panel.querySelectorAll('[data-timezone]').forEach(b => b.classList.remove('locale-option--active'));
        btn.classList.add('locale-option--active');
        refreshToggle();
      });
    });

    // ── Close ──
    panel.querySelector('#ss-locale-close')?.addEventListener('click', closePanel);

    // ── Close on outside click ──
    document.addEventListener('click', outsideClickHandler);
  }

  function buildLanguageTab(locale) {
    const i18n = getI18n();
    const current = locale.language || 'en';
    const items = Object.entries(i18n.LANGUAGES).map(([code, info]) => `
      <button class="locale-option${code === current ? ' locale-option--active' : ''}"
              data-lang="${code}" aria-label="${info.label}" aria-pressed="${code === current}">
        <span class="locale-option__icon" aria-hidden="true">${info.flag}</span>
        <span class="locale-option__label">${info.label}</span>
        ${code === current ? '<span class="locale-option__check" aria-hidden="true">✓</span>' : ''}
      </button>`).join('');

    return `
      <div class="locale-tab-panel" id="ltab-language" role="tabpanel">
        <div class="locale-search-wrap">
          <input type="search" class="locale-search" placeholder="Search language…"
                 aria-label="Search languages">
        </div>
        <div class="locale-options-grid">${items}</div>
      </div>`;
  }

  function buildCurrencyTab(locale) {
    const i18n = getI18n();
    const current = locale.currency || 'USD';
    const items = Object.entries(i18n.CURRENCIES).map(([code, info]) => `
      <button class="locale-option${code === current ? ' locale-option--active' : ''}"
              data-currency="${code}" aria-label="${info.name}" aria-pressed="${code === current}">
        <span class="locale-option__symbol" aria-hidden="true">${info.symbol}</span>
        <div class="locale-option__text">
          <span class="locale-option__label">${code}</span>
          <span class="locale-option__sub">${info.name}</span>
        </div>
        ${code === current ? '<span class="locale-option__check" aria-hidden="true">✓</span>' : ''}
      </button>`).join('');

    return `
      <div class="locale-tab-panel hidden" id="ltab-currency" role="tabpanel">
        <div class="locale-search-wrap">
          <input type="search" class="locale-search" placeholder="Search currency…"
                 aria-label="Search currencies">
        </div>
        <div class="locale-options-grid">${items}</div>
      </div>`;
  }

  function buildTimezoneTab(locale) {
    const current = locale.timezone || 'UTC';
    const items = TIMEZONES.map(tz => `
      <button class="locale-option locale-option--tz${tz.tz === current ? ' locale-option--active' : ''}"
              data-timezone="${tz.tz}" aria-label="${tz.label}" aria-pressed="${tz.tz === current}">
        <span class="locale-option__icon" aria-hidden="true">🕐</span>
        <div class="locale-option__text">
          <span class="locale-option__label">${tz.label}</span>
          <span class="locale-option__sub locale-option__sub--live"
                data-live-time="${tz.tz}">–</span>
        </div>
        ${tz.tz === current ? '<span class="locale-option__check" aria-hidden="true">✓</span>' : ''}
      </button>`).join('');

    return `
      <div class="locale-tab-panel hidden" id="ltab-timezone" role="tabpanel">
        <div class="locale-search-wrap">
          <input type="search" class="locale-search" placeholder="Search timezone…"
                 aria-label="Search timezones">
        </div>
        <div class="locale-options-grid">${items}</div>
      </div>`;
  }

  // ── Live clock in timezone tab ────────────────────────────────
  function startLiveClock() {
    setInterval(() => {
      document.querySelectorAll('[data-live-time]').forEach(el => {
        const tz = el.dataset.liveTime;
        try {
          el.textContent = new Intl.DateTimeFormat(navigator.language, {
            timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit',
          }).format(new Date());
        } catch (_) {}
      });
    }, 1000);
  }

  // ── Panel open / close ────────────────────────────────────────
  function togglePanel() {
    const panel  = document.getElementById(PANEL_ID);
    const toggle = document.getElementById(TOGGLE_ID);
    if (!panel) return;
    const isOpen = !panel.hidden;
    panel.hidden = isOpen;
    toggle?.setAttribute('aria-expanded', String(!isOpen));
    if (!isOpen) {
      startLiveClock();
      // Focus close button
      setTimeout(() => panel.querySelector('#ss-locale-close')?.focus(), 50);
    }
  }

  function closePanel() {
    const panel  = document.getElementById(PANEL_ID);
    const toggle = document.getElementById(TOGGLE_ID);
    if (panel) panel.hidden = true;
    toggle?.setAttribute('aria-expanded', 'false');
    toggle?.focus();
  }

  function outsideClickHandler(e) {
    const panel  = document.getElementById(PANEL_ID);
    const toggle = document.getElementById(TOGGLE_ID);
    if (!panel || panel.hidden) return;
    if (!panel.contains(e.target) && e.target !== toggle && !toggle?.contains(e.target)) {
      closePanel();
    }
  }

  // ── Escape key closes panel ───────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closePanel();
  });

  // ── Refresh toggle pill after selection ──────────────────────
  function refreshToggle() {
    const i18n   = getI18n();
    const locale = i18n?.currentLocale();
    const toggle = document.getElementById(TOGGLE_ID);
    if (!toggle || !locale || !i18n) return;

    const langInfo = i18n.LANGUAGES[locale.language] || { flag: '🌐' };
    const curInfo  = i18n.CURRENCIES[locale.currency] || { symbol: '$' };
    const tzOffset = currentTzOffset(locale.timezone || 'UTC');

    toggle.querySelector('.locale-toggle__flag').textContent     = langInfo.flag;
    toggle.querySelector('.locale-toggle__currency').textContent = curInfo.symbol;
    toggle.querySelector('.locale-toggle__tz').textContent       = tzOffset;
  }

  // ── Init ──────────────────────────────────────────────────────
  function init() {
    // Wait for i18n to be ready
    if (window.StaySphere?.i18n?.currentLocale) {
      buildWidget();
    } else {
      document.addEventListener('ss:i18n-ready', buildWidget, { once: true });
    }

    // Rebuild toggle after any locale change
    document.addEventListener('ss:currency-changed', refreshToggle);
    document.addEventListener('ss:language-changed', refreshToggle);
    document.addEventListener('ss:timezone-changed', refreshToggle);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
