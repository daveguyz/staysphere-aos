/**
 * StaySphere AOS — plugin-locale-selector.js
 * Phase E: Floating locale selector widget.
 *
 * Pill in site-header__actions → click → modal panel with three tabs:
 *   Language | Currency | Timezone
 *
 * Fixes in this version:
 *   - Guard: only bails when show_currency_selector is explicitly false
 *   - startLiveClock() called only once (guarded by _clockStarted flag)
 *   - Panel rebuilt on every open so active states always match current locale
 *   - outsideClickHandler registered only once (not per buildPanel call)
 *   - Backdrop overlay on mobile for reliable tap-outside
 *   - aria-pressed synced on selection
 *   - Focus trap: Tab cycles within panel
 *   - Panel position adjusts to stay inside viewport on small screens
 */
(function () {
  'use strict';

  const PANEL_ID    = 'ss-locale-panel';
  const TOGGLE_ID   = 'ss-locale-toggle';
  const BACKDROP_ID = 'ss-locale-backdrop';

  let _clockStarted     = false;
  let _clockInterval    = null;
  let _outsideRegistered = false;

  // ── Timezone list ─────────────────────────────────────────────
  const TIMEZONES = [
    { tz: 'Pacific/Honolulu',    label: 'Hawaii',              region: 'Americas' },
    { tz: 'America/Anchorage',   label: 'Alaska',              region: 'Americas' },
    { tz: 'America/Los_Angeles', label: 'Pacific Time',        region: 'Americas' },
    { tz: 'America/Denver',      label: 'Mountain Time',       region: 'Americas' },
    { tz: 'America/Chicago',     label: 'Central Time',        region: 'Americas' },
    { tz: 'America/New_York',    label: 'Eastern Time',        region: 'Americas' },
    { tz: 'America/Sao_Paulo',   label: 'Brazil',              region: 'Americas' },
    { tz: 'Atlantic/Azores',     label: 'Azores',              region: 'Atlantic' },
    { tz: 'UTC',                 label: 'UTC',                  region: 'Global'   },
    { tz: 'Europe/London',       label: 'London',              region: 'Europe'   },
    { tz: 'Europe/Paris',        label: 'Paris / Berlin',      region: 'Europe'   },
    { tz: 'Europe/Helsinki',     label: 'Helsinki',            region: 'Europe'   },
    { tz: 'Europe/Moscow',       label: 'Moscow',              region: 'Europe'   },
    { tz: 'Africa/Johannesburg', label: 'Johannesburg',        region: 'Africa'   },
    { tz: 'Africa/Windhoek',     label: 'Windhoek',            region: 'Africa'   },
    { tz: 'Africa/Cairo',        label: 'Cairo',               region: 'Africa'   },
    { tz: 'Africa/Lagos',        label: 'Lagos',               region: 'Africa'   },
    { tz: 'Africa/Nairobi',      label: 'Nairobi',             region: 'Africa'   },
    { tz: 'Asia/Riyadh',         label: 'Riyadh',              region: 'Asia'     },
    { tz: 'Asia/Dubai',          label: 'Dubai',               region: 'Asia'     },
    { tz: 'Asia/Karachi',        label: 'Karachi',             region: 'Asia'     },
    { tz: 'Asia/Kolkata',        label: 'India',               region: 'Asia'     },
    { tz: 'Asia/Dhaka',          label: 'Dhaka',               region: 'Asia'     },
    { tz: 'Asia/Bangkok',        label: 'Bangkok',             region: 'Asia'     },
    { tz: 'Asia/Shanghai',       label: 'China',               region: 'Asia'     },
    { tz: 'Asia/Hong_Kong',      label: 'Hong Kong',           region: 'Asia'     },
    { tz: 'Asia/Singapore',      label: 'Singapore',           region: 'Asia'     },
    { tz: 'Asia/Tokyo',          label: 'Tokyo',               region: 'Asia'     },
    { tz: 'Australia/Sydney',    label: 'Sydney',              region: 'Pacific'  },
    { tz: 'Pacific/Auckland',    label: 'Auckland',            region: 'Pacific'  },
  ];

  function i18n() { return window.StaySphere?.i18n; }

  // ── UTC offset string for a timezone ─────────────────────────
  function tzOffset(tz) {
    try {
      const now    = new Date();
      const local  = new Date(now.toLocaleString('en-US', { timeZone: tz }));
      const diff   = Math.round((local - now) / 3600000);
      return diff >= 0 ? `UTC+${diff}` : `UTC${diff}`;
    } catch (_) { return 'UTC'; }
  }

  // ── Live clock string for a timezone ─────────────────────────
  function liveTime(tz) {
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
      }).format(new Date());
    } catch (_) { return '--:--:--'; }
  }

  // ══════════════════════════════════════════════════════════════
  // BUILD WIDGET
  // ══════════════════════════════════════════════════════════════
  function buildWidget() {
    // Only show if operator hasn't explicitly disabled
    if (document.body.dataset.showCurrencySelector === 'false') return;

    buildToggle();

    // Register outside-click and Escape exactly once
    if (!_outsideRegistered) {
      _outsideRegistered = true;
      document.addEventListener('click', handleOutsideClick);
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closePanel();
      });
    }
  }

  // ── Toggle pill ───────────────────────────────────────────────
  function buildToggle() {
    const lib = i18n();
    if (!lib) return;

    const locale  = lib.currentLocale();
    const lang    = lib.LANGUAGES[locale.language] || { flag: '🌐', label: 'English' };
    const cur     = lib.CURRENCIES[locale.currency] || { symbol: '$' };
    const offset  = tzOffset(locale.timezone || 'UTC');

    let toggle = document.getElementById(TOGGLE_ID);
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.id = TOGGLE_ID;
      toggle.className = 'locale-toggle';
      toggle.setAttribute('aria-label', 'Language, currency and timezone');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-controls', PANEL_ID);
      toggle.addEventListener('click', handleToggleClick);

      // Mount inside the data-locale-anchor div (injected by locale-selector.liquid)
      const anchor = document.querySelector('[data-locale-anchor]');
      if (anchor) {
        anchor.removeAttribute('aria-hidden');
        anchor.appendChild(toggle);
      } else {
        // Fallback: prepend to site-header__actions
        const actions = document.querySelector('.site-header__actions, .header__actions');
        if (actions) actions.prepend(toggle);
        else document.body.appendChild(toggle);
      }
    }

    toggle.innerHTML = `
      <span class="locale-toggle__flag"  aria-hidden="true">${lang.flag}</span>
      <span class="locale-toggle__currency">${cur.symbol}</span>
      <span class="locale-toggle__tz">${offset}</span>
      <svg class="locale-toggle__chevron" width="12" height="12" viewBox="0 0 24 24"
           fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
        <polyline points="6 9 12 15 18 9"/>
      </svg>`;
  }

  function handleToggleClick(e) {
    e.stopPropagation();
    const panel = document.getElementById(PANEL_ID);
    if (!panel || panel.hidden) openPanel();
    else closePanel();
  }

  // ══════════════════════════════════════════════════════════════
  // PANEL
  // ══════════════════════════════════════════════════════════════
  function openPanel() {
    // Always rebuild panel on open so active states reflect current locale
    buildPanel();

    const panel   = document.getElementById(PANEL_ID);
    const toggle  = document.getElementById(TOGGLE_ID);
    const backdrop = document.getElementById(BACKDROP_ID);

    if (panel) {
      panel.hidden = false;
      toggle?.setAttribute('aria-expanded', 'true');
      // Focus close button after animation
      setTimeout(() => panel.querySelector('.locale-panel__close')?.focus(), 60);
    }
    if (backdrop) backdrop.hidden = false;

    if (!_clockStarted) {
      _clockStarted = true;
      _clockInterval = setInterval(tickLiveClocks, 1000);
    }
  }

  function closePanel() {
    const panel   = document.getElementById(PANEL_ID);
    const toggle  = document.getElementById(TOGGLE_ID);
    const backdrop = document.getElementById(BACKDROP_ID);

    if (panel)   { panel.hidden = true; }
    if (backdrop){ backdrop.hidden = true; }
    toggle?.setAttribute('aria-expanded', 'false');
    toggle?.focus();
  }

  function handleOutsideClick(e) {
    const panel   = document.getElementById(PANEL_ID);
    const toggle  = document.getElementById(TOGGLE_ID);
    const backdrop = document.getElementById(BACKDROP_ID);
    if (!panel || panel.hidden) return;
    if (panel.contains(e.target) || toggle?.contains(e.target)) return;
    closePanel();
  }

  // ── Build/rebuild the panel DOM ───────────────────────────────
  function buildPanel() {
    const lib = i18n();
    if (!lib) return;

    const locale = lib.currentLocale();

    // Remove existing panel (rebuild from scratch for clean active states)
    document.getElementById(PANEL_ID)?.remove();

    // Ensure backdrop exists
    if (!document.getElementById(BACKDROP_ID)) {
      const bd = document.createElement('div');
      bd.id = BACKDROP_ID;
      bd.className = 'locale-backdrop';
      bd.hidden = true;
      bd.addEventListener('click', closePanel);
      document.body.appendChild(bd);
    }

    const panel = document.createElement('div');
    panel.id        = PANEL_ID;
    panel.className = 'locale-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Preferences — language, currency, timezone');
    panel.hidden = true;

    panel.innerHTML = `
      <div class="locale-panel__header">
        <div class="locale-panel__header-left">
          <div class="locale-panel__detected" id="ss-locale-detected">
            ${buildDetectedBadge(locale)}
          </div>
        </div>
        <h2 class="locale-panel__title">Preferences</h2>
        <button class="locale-panel__close" aria-label="Close preferences">✕</button>
      </div>

      <nav class="locale-panel__tabs" role="tablist" aria-label="Preference tabs">
        <button class="locale-tab locale-tab--active" role="tab" id="ltab-btn-language"
                data-tab="language" aria-selected="true" aria-controls="ltab-language">
          🌐 Language
        </button>
        <button class="locale-tab" role="tab" id="ltab-btn-currency"
                data-tab="currency" aria-selected="false" aria-controls="ltab-currency">
          💱 Currency
        </button>
        <button class="locale-tab" role="tab" id="ltab-btn-timezone"
                data-tab="timezone" aria-selected="false" aria-controls="ltab-timezone">
          🕐 Timezone
        </button>
      </nav>

      <div class="locale-panel__body">
        ${buildLanguageTab(locale, lib)}
        ${buildCurrencyTab(locale, lib)}
        ${buildTimezoneTab(locale)}
      </div>

      <div class="locale-panel__footer">
        <button class="locale-panel__reset btn btn--ghost btn--sm"
                aria-label="Reset to auto-detected preferences">
          Reset to auto-detect
        </button>
      </div>`;

    document.body.appendChild(panel);
    wirePanel(panel);
  }

  function buildDetectedBadge(locale) {
    const country = locale.countryName || locale.country || '';
    const src     = locale._source;
    if (!country && !src) return '';
    const icon = src === 'ip' ? '📍' : '🌐';
    const label = country ? `${icon} Detected: ${country}` : `${icon} Browser detected`;
    return `<span class="locale-detected-badge">${label}</span>`;
  }

  function buildLanguageTab(locale, lib) {
    const current = locale.language || 'en';
    const items = Object.entries(lib.LANGUAGES).map(([code, info]) => `
      <button class="locale-option${code === current ? ' locale-option--active' : ''}"
              data-lang="${code}"
              aria-pressed="${code === current}"
              aria-label="${info.label}">
        <span class="locale-option__flag" aria-hidden="true">${info.flag}</span>
        <span class="locale-option__label">${info.label}</span>
        ${code === current ? '<span class="locale-option__check" aria-hidden="true">✓</span>' : ''}
      </button>`).join('');

    return `
      <div class="locale-tab-panel" id="ltab-language"
           role="tabpanel" aria-labelledby="ltab-btn-language">
        <div class="locale-search-wrap">
          <input type="search" class="locale-search" placeholder="Search language…"
                 aria-label="Search languages" autocomplete="off">
        </div>
        <div class="locale-options-grid locale-options-grid--languages">${items}</div>
      </div>`;
  }

  function buildCurrencyTab(locale, lib) {
    const current = locale.currency || 'USD';
    const items = Object.entries(lib.CURRENCIES).map(([code, info]) => `
      <button class="locale-option${code === current ? ' locale-option--active' : ''}"
              data-currency="${code}"
              aria-pressed="${code === current}"
              aria-label="${info.name} — ${code}">
        <span class="locale-option__symbol" aria-hidden="true">${info.symbol}</span>
        <span class="locale-option__text">
          <span class="locale-option__label">${code}</span>
          <span class="locale-option__sub">${info.name}</span>
        </span>
        ${code === current ? '<span class="locale-option__check" aria-hidden="true">✓</span>' : ''}
      </button>`).join('');

    return `
      <div class="locale-tab-panel hidden" id="ltab-currency"
           role="tabpanel" aria-labelledby="ltab-btn-currency">
        <div class="locale-search-wrap">
          <input type="search" class="locale-search" placeholder="Search currency…"
                 aria-label="Search currencies" autocomplete="off">
        </div>
        <div class="locale-options-grid">${items}</div>
      </div>`;
  }

  function buildTimezoneTab(locale) {
    const current = locale.timezone || 'UTC';
    // Group by region
    const regions = [...new Set(TIMEZONES.map(t => t.region))];
    const grouped = regions.map(region => {
      const zones = TIMEZONES.filter(t => t.region === region);
      const items = zones.map(tz => `
        <button class="locale-option locale-option--tz${tz.tz === current ? ' locale-option--active' : ''}"
                data-timezone="${tz.tz}"
                aria-pressed="${tz.tz === current}"
                aria-label="${tz.label} — ${tzOffset(tz.tz)}">
          <span class="locale-option__tz-offset">${tzOffset(tz.tz)}</span>
          <span class="locale-option__text">
            <span class="locale-option__label">${tz.label}</span>
            <span class="locale-option__sub locale-option__sub--live"
                  data-live-time="${tz.tz}">──:──:──</span>
          </span>
          ${tz.tz === current ? '<span class="locale-option__check" aria-hidden="true">✓</span>' : ''}
        </button>`).join('');
      return `
        <div class="locale-tz-group">
          <p class="locale-tz-group__label">${region}</p>
          ${items}
        </div>`;
    }).join('');

    return `
      <div class="locale-tab-panel hidden" id="ltab-timezone"
           role="tabpanel" aria-labelledby="ltab-btn-timezone">
        <div class="locale-search-wrap">
          <input type="search" class="locale-search" placeholder="Search timezone…"
                 aria-label="Search timezones" autocomplete="off">
        </div>
        <div class="locale-options-list">${grouped}</div>
      </div>`;
  }

  // ── Wire all panel interactions ───────────────────────────────
  function wirePanel(panel) {
    // Close button
    panel.querySelector('.locale-panel__close')
      ?.addEventListener('click', closePanel);

    // Reset button
    panel.querySelector('.locale-panel__reset')
      ?.addEventListener('click', () => {
        window.StaySphere?.i18n?.store?.clear?.();
        window.StaySphere?.i18n?.store?.clearDetected?.();
        // Trigger re-detection
        window.StaySphere?.i18n?.init?.().then?.(() => {
          closePanel();
          buildToggle();
        });
      });

    // Tab switching
    panel.querySelectorAll('.locale-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        panel.querySelectorAll('.locale-tab').forEach(t => {
          t.classList.remove('locale-tab--active');
          t.setAttribute('aria-selected', 'false');
        });
        panel.querySelectorAll('.locale-tab-panel').forEach(p =>
          p.classList.add('hidden')
        );
        tab.classList.add('locale-tab--active');
        tab.setAttribute('aria-selected', 'true');
        const target = panel.querySelector(`#ltab-${tab.dataset.tab}`);
        if (target) {
          target.classList.remove('hidden');
          // Focus search on tab switch
          target.querySelector('.locale-search')?.focus();
        }
      });
    });

    // Search filter (works for all three tabs)
    panel.querySelectorAll('.locale-search').forEach(input => {
      input.addEventListener('input', function () {
        const q = this.value.toLowerCase().trim();
        const tabPanel = this.closest('.locale-tab-panel');
        tabPanel.querySelectorAll('.locale-option').forEach(opt => {
          const text = opt.textContent.toLowerCase();
          opt.classList.toggle('hidden', q.length > 0 && !text.includes(q));
        });
        // Show/hide group labels based on visible children
        tabPanel.querySelectorAll('.locale-tz-group').forEach(group => {
          const visible = [...group.querySelectorAll('.locale-option')]
            .some(o => !o.classList.contains('hidden'));
          group.classList.toggle('hidden', !visible);
        });
      });
    });

    // Language selection
    panel.querySelectorAll('[data-lang]').forEach(btn => {
      btn.addEventListener('click', () => {
        const lang = btn.dataset.lang;
        i18n()?.setLanguage(lang);
        markActive(panel, '[data-lang]', btn);
        buildToggle();
        // Small delay so the language loads before closing
        setTimeout(closePanel, 200);
      });
    });

    // Currency selection
    panel.querySelectorAll('[data-currency]').forEach(btn => {
      btn.addEventListener('click', () => {
        const cur = btn.dataset.currency;
        i18n()?.setCurrency(cur);
        markActive(panel, '[data-currency]', btn);
        buildToggle();
        setTimeout(closePanel, 200);
      });
    });

    // Timezone selection
    panel.querySelectorAll('[data-timezone]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tz = btn.dataset.timezone;
        i18n()?.setTimezone(tz);
        markActive(panel, '[data-timezone]', btn);
        buildToggle();
        setTimeout(closePanel, 200);
      });
    });

    // Focus trap: Tab key cycles within panel
    panel.addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      const focusable = [...panel.querySelectorAll(
        'button:not([disabled]), input, [tabindex="0"]'
      )].filter(el => !el.closest('.hidden'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    });
  }

  function markActive(panel, selector, activeBtn) {
    panel.querySelectorAll(selector).forEach(b => {
      b.classList.remove('locale-option--active');
      b.setAttribute('aria-pressed', 'false');
      b.querySelector('.locale-option__check')?.remove();
    });
    activeBtn.classList.add('locale-option--active');
    activeBtn.setAttribute('aria-pressed', 'true');
    const check = document.createElement('span');
    check.className = 'locale-option__check';
    check.setAttribute('aria-hidden', 'true');
    check.textContent = '✓';
    activeBtn.appendChild(check);
  }

  // ── Live clock ticker ─────────────────────────────────────────
  function tickLiveClocks() {
    document.querySelectorAll('[data-live-time]').forEach(el => {
      el.textContent = liveTime(el.dataset.liveTime);
    });
  }

  // ══════════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════════
  function init() {
    if (i18n()?.currentLocale) {
      buildWidget();
    } else {
      document.addEventListener('ss:i18n-ready', buildWidget, { once: true });
    }

    // Refresh toggle pill on any locale change
    document.addEventListener('ss:currency-changed', buildToggle);
    document.addEventListener('ss:language-changed', buildToggle);
    document.addEventListener('ss:timezone-changed', buildToggle);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
