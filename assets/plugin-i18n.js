/**
 * StaySphere AOS — plugin-i18n.js
 * Internationalisation: detection, currency conversion, translation, timezone.
 * Loaded on every page (added to theme.liquid before theme.js).
 *
 * Exposes: window.StaySphere.i18n
 *
 * Phase A — Detection & data layer
 * Phase B — Currency converter (live rates)
 * Phase C — Translation layer
 * Phase D — Timezone / datetime formatter
 * Phase E — Selector widget (in locale-selector.liquid + plugin-locale-selector.js)
 */
(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════
  // CONSTANTS
  // ═══════════════════════════════════════════════════════════════

  const STORAGE_KEY   = 'ss_locale';
  const RATES_KEY     = 'ss_fx_rates';
  const RATES_TTL_MS  = 3_600_000;   // 1 hour
  const DETECT_TTL_MS = 86_400_000;  // 24 hours
  const DETECT_KEY    = 'ss_geo';

  /** Supported languages — code: { label, dir, flag } */
  const LANGUAGES = {
    en: { label: 'English',    dir: 'ltr', flag: '🇬🇧' },
    fr: { label: 'Français',   dir: 'ltr', flag: '🇫🇷' },
    es: { label: 'Español',    dir: 'ltr', flag: '🇪🇸' },
    pt: { label: 'Português',  dir: 'ltr', flag: '🇧🇷' },
    de: { label: 'Deutsch',    dir: 'ltr', flag: '🇩🇪' },
    ar: { label: 'العربية',    dir: 'rtl', flag: '🇸🇦' },
    zh: { label: '中文',        dir: 'ltr', flag: '🇨🇳' },
  };

  /** ISO currency code → { symbol, name } */
  const CURRENCIES = {
    USD: { symbol: '$',   name: 'US Dollar'        },
    EUR: { symbol: '€',   name: 'Euro'             },
    GBP: { symbol: '£',   name: 'British Pound'    },
    JPY: { symbol: '¥',   name: 'Japanese Yen'     },
    AUD: { symbol: 'A$',  name: 'Australian Dollar'},
    CAD: { symbol: 'C$',  name: 'Canadian Dollar'  },
    CHF: { symbol: 'Fr',  name: 'Swiss Franc'      },
    CNY: { symbol: '¥',   name: 'Chinese Yuan'     },
    INR: { symbol: '₹',   name: 'Indian Rupee'     },
    MXN: { symbol: 'MX$', name: 'Mexican Peso'     },
    BRL: { symbol: 'R$',  name: 'Brazilian Real'   },
    ZAR: { symbol: 'R',   name: 'South African Rand'},
    AED: { symbol: 'د.إ', name: 'UAE Dirham'       },
    SGD: { symbol: 'S$',  name: 'Singapore Dollar' },
    HKD: { symbol: 'HK$', name: 'Hong Kong Dollar' },
    NZD: { symbol: 'NZ$', name: 'New Zealand Dollar'},
    SEK: { symbol: 'kr',  name: 'Swedish Krona'    },
    NOK: { symbol: 'kr',  name: 'Norwegian Krone'  },
    DKK: { symbol: 'kr',  name: 'Danish Krone'     },
    KES: { symbol: 'KSh', name: 'Kenyan Shilling'  },
    NGN: { symbol: '₦',   name: 'Nigerian Naira'   },
    EGP: { symbol: 'E£',  name: 'Egyptian Pound'   },
    NAD: { symbol: 'N$',  name: 'Namibian Dollar'  },
  };

  /** Country code → { currency, language, timezone } */
  const COUNTRY_DEFAULTS = {
    US: { currency: 'USD', language: 'en', tz: 'America/New_York' },
    GB: { currency: 'GBP', language: 'en', tz: 'Europe/London' },
    FR: { currency: 'EUR', language: 'fr', tz: 'Europe/Paris' },
    DE: { currency: 'EUR', language: 'de', tz: 'Europe/Berlin' },
    ES: { currency: 'EUR', language: 'es', tz: 'Europe/Madrid' },
    BR: { currency: 'BRL', language: 'pt', tz: 'America/Sao_Paulo' },
    PT: { currency: 'EUR', language: 'pt', tz: 'Europe/Lisbon' },
    CN: { currency: 'CNY', language: 'zh', tz: 'Asia/Shanghai' },
    JP: { currency: 'JPY', language: 'en', tz: 'Asia/Tokyo' },
    AU: { currency: 'AUD', language: 'en', tz: 'Australia/Sydney' },
    NZ: { currency: 'NZD', language: 'en', tz: 'Pacific/Auckland' },
    CA: { currency: 'CAD', language: 'en', tz: 'America/Toronto' },
    IN: { currency: 'INR', language: 'en', tz: 'Asia/Kolkata' },
    ZA: { currency: 'ZAR', language: 'en', tz: 'Africa/Johannesburg' },
    NG: { currency: 'NGN', language: 'en', tz: 'Africa/Lagos' },
    KE: { currency: 'KES', language: 'en', tz: 'Africa/Nairobi' },
    EG: { currency: 'EGP', language: 'ar', tz: 'Africa/Cairo' },
    SA: { currency: 'AED', language: 'ar', tz: 'Asia/Riyadh' },
    AE: { currency: 'AED', language: 'ar', tz: 'Asia/Dubai' },
    SG: { currency: 'SGD', language: 'en', tz: 'Asia/Singapore' },
    HK: { currency: 'HKD', language: 'en', tz: 'Asia/Hong_Kong' },
    MX: { currency: 'MXN', language: 'es', tz: 'America/Mexico_City' },
    NA: { currency: 'NAD', language: 'en', tz: 'Africa/Windhoek' },
    CH: { currency: 'CHF', language: 'de', tz: 'Europe/Zurich' },
    SE: { currency: 'SEK', language: 'en', tz: 'Europe/Stockholm' },
    NO: { currency: 'NOK', language: 'en', tz: 'Europe/Oslo' },
    DK: { currency: 'DKK', language: 'en', tz: 'Europe/Copenhagen' },
  };

  const DEFAULT_LOCALE = { language: 'en', currency: 'USD', timezone: 'UTC', country: '' };

  // ═══════════════════════════════════════════════════════════════
  // PHASE A — LocaleStore (read / write / detect)
  // ═══════════════════════════════════════════════════════════════

  const LocaleStore = {
    /** Load from localStorage, falling back to defaults */
    load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return { ...DEFAULT_LOCALE, ...JSON.parse(raw) };
      } catch (_) {}
      return { ...DEFAULT_LOCALE };
    },

    /** Persist user's explicit choice */
    save(partial) {
      const current = LocaleStore.load();
      const next = { ...current, ...partial, userOverride: true };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (_) {}
      return next;
    },

    /** Save detection result (only if user hasn't overridden) */
    saveDetected(detected) {
      const current = LocaleStore.load();
      if (current.userOverride) return current; // respect user's choice
      const next = { ...current, ...detected };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (_) {}
      return next;
    },

    clear() {
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    },

    clearDetected() {
      try { localStorage.removeItem(DETECT_KEY); } catch (_) {}
    },
  };

  // ═══════════════════════════════════════════════════════════════
  // PHASE A — GeoDetector (IP → country → defaults)
  // ═══════════════════════════════════════════════════════════════

  const GeoDetector = {
    /** Returns cached or fetched geo data */
    async detect() {
      // 1. Check browser timezone as a free hint
      const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

      // 2. Check cache
      try {
        const cached = localStorage.getItem(DETECT_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Date.now() - parsed._ts < DETECT_TTL_MS) {
            return { ...parsed, _fromCache: true };
          }
        }
      } catch (_) {}

      // 3. Fetch from ipapi.co (free, no key, 1000 req/day)
      try {
        const res = await fetch('https://ipapi.co/json/', {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(4000),
        });
        if (res.ok) {
          const data = await res.json();
          const country = data.country_code || '';
          const defaults = COUNTRY_DEFAULTS[country] || {};
          const result = {
            country,
            countryName: data.country_name || '',
            city:        data.city || '',
            region:      data.region || '',
            currency:    data.currency || defaults.currency || DEFAULT_LOCALE.currency,
            language:    (data.languages || '').split(',')[0].split('-')[0] || defaults.language || 'en',
            timezone:    data.timezone || browserTz || defaults.tz || 'UTC',
            _source:     'ip',
            _fromCache:  false,
            _ts:         Date.now(),
          };
          // Normalise language to one we support
          if (!LANGUAGES[result.language]) result.language = 'en';
          try { localStorage.setItem(DETECT_KEY, JSON.stringify(result)); } catch (_) {}
          return result;
        }
      } catch (_) {}

      // 4. Fallback — derive from browser timezone alone (no network request)
      const browserLang = (navigator.language || 'en').split('-')[0];
      return {
        country:    '',
        countryName:'',
        city:       '',
        currency:   DEFAULT_LOCALE.currency,
        language:   LANGUAGES[browserLang] ? browserLang : 'en',
        timezone:   browserTz || 'UTC',
        _source:    'browser',
        _fromCache: false,
        _ts:        Date.now(),
      };
    },
  };

  // ═══════════════════════════════════════════════════════════════
  // PHASE B — CurrencyConverter
  // ═══════════════════════════════════════════════════════════════

  const CurrencyConverter = {
    rates: {},      // { USD: 1, EUR: 0.92, ... }
    base: 'USD',
    loaded: false,

    async loadRates() {
      // Check cache
      try {
        const cached = localStorage.getItem(RATES_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Date.now() - parsed._ts < RATES_TTL_MS) {
            this.rates = parsed.rates;
            this.base  = parsed.base || 'USD';
            this.loaded = true;
            return;
          }
        }
      } catch (_) {}

      // Fetch from open.er-api.com (free tier, no key needed)
      try {
        const res = await fetch('https://open.er-api.com/v6/latest/USD', {
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.result === 'success') {
            this.rates  = data.rates;
            this.base   = 'USD';
            this.loaded = true;
            try {
              localStorage.setItem(RATES_KEY, JSON.stringify({
                rates: data.rates, base: 'USD', _ts: Date.now(),
              }));
            } catch (_) {}
            return;
          }
        }
      } catch (_) {}

      // Fallback hardcoded rates (major currencies, updated periodically)
      this.rates = {
        USD:1,EUR:0.92,GBP:0.79,JPY:149,AUD:1.53,CAD:1.36,CHF:0.89,
        CNY:7.24,INR:83.1,MXN:17.1,BRL:4.97,ZAR:18.6,AED:3.67,
        SGD:1.34,HKD:7.82,NZD:1.63,SEK:10.4,NOK:10.6,DKK:6.89,
        KES:129,NGN:1550,EGP:30.9,NAD:18.6,
      };
      this.base  = 'USD';
      this.loaded = true;
    },

    /**
     * Convert amount from `from` currency to `to` currency.
     * Always routes through USD as the base.
     */
    convert(amount, from, to) {
      if (!this.loaded || from === to) return amount;
      const n = Number(amount);
      if (isNaN(n)) return amount;
      const toUsd   = from === 'USD' ? n : n / (this.rates[from] || 1);
      const toTarget = to   === 'USD' ? toUsd : toUsd * (this.rates[to] || 1);
      return toTarget;
    },

    /** Format a converted amount with the target currency symbol */
    format(amount, from, to) {
      const converted = this.convert(amount, from, to);
      const currInfo  = CURRENCIES[to] || { symbol: to };
      const sym = currInfo.symbol;

      // BCP 47 locale tag for digit grouping (e.g. 'fr' → 1 234, 'de' → 1.234)
      // Map language code to full BCP 47 tag for reliable Intl support
      const langMap = {
        en:'en-US', fr:'fr-FR', es:'es-ES', de:'de-DE',
        pt:'pt-BR', ar:'ar-SA', zh:'zh-CN',
      };
      const lang = (window.StaySphere?.i18n?.currentLanguage?.() || 'en');
      const bcp47 = langMap[lang] || 'en-US';

      // Property/auction prices are always whole numbers — no decimal places.
      // Exception: currencies where sub-units matter (BHD, KWD etc.) — none
      // in our supported set, so 0 decimal places everywhere.
      try {
        return sym + new Intl.NumberFormat(bcp47, {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }).format(Math.round(converted));
      } catch (_) {
        return sym + Math.round(converted).toLocaleString();
      }
    },

    /**
     * Return just the numeric string without symbol, for use in
     * elements that render the symbol separately.
     */
    formatNumber(amount, from, to) {
      const converted = this.convert(amount, from, to);
      const langMap = { en:'en-US', fr:'fr-FR', es:'es-ES', de:'de-DE', pt:'pt-BR', ar:'ar-SA', zh:'zh-CN' };
      const lang  = (window.StaySphere?.i18n?.currentLanguage?.() || 'en');
      const bcp47 = langMap[lang] || 'en-US';
      try {
        return new Intl.NumberFormat(bcp47, { minimumFractionDigits:0, maximumFractionDigits:0 })
          .format(Math.round(converted));
      } catch (_) {
        return String(Math.round(converted));
      }
    },
  };

  // ═══════════════════════════════════════════════════════════════
  // PHASE C — Translator
  // ═══════════════════════════════════════════════════════════════

  const Translator = {
    catalogs: {},   // { en: {...}, fr: {...} }
    current: 'en',

    /** Register a translation catalog */
    register(lang, catalog) {
      this.catalogs[lang] = catalog;
    },

    /** Get a translated string by dot-key, e.g. 'general.search' */
    t(key, vars = {}) {
      const lang = this.current;
      const catalog = this.catalogs[lang] || this.catalogs['en'] || {};
      const parts = key.split('.');
      let value = catalog;
      for (const part of parts) {
        value = value?.[part];
        if (value === undefined) break;
      }
      // Fallback to English
      if (value === undefined && lang !== 'en') {
        let en = this.catalogs['en'] || {};
        for (const part of parts) { en = en?.[part]; if (!en) break; }
        value = en;
      }
      if (typeof value !== 'string') return key;
      // Variable substitution: {{ var }}
      return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) =>
        vars[k] !== undefined ? vars[k] : `{{ ${k} }}`
      );
    },

    /** Set active language and apply to the DOM */
    setLanguage(lang) {
      if (!LANGUAGES[lang]) lang = 'en';
      this.current = lang;
      document.documentElement.lang = lang;
      document.documentElement.dir  = LANGUAGES[lang]?.dir || 'ltr';
      this._applyDOM();
    },

    /** Re-translate all [data-i18n] elements */
    _applyDOM() {
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key  = el.dataset.i18n;
        const vars = el.dataset.i18nVars ? JSON.parse(el.dataset.i18nVars) : {};
        el.textContent = this.t(key, vars);
      });
      document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        el.placeholder = this.t(el.dataset.i18nPlaceholder);
      });
      document.querySelectorAll('[data-i18n-aria]').forEach(el => {
        el.setAttribute('aria-label', this.t(el.dataset.i18nAria));
      });
    },

    /** Load a remote locale JSON file (for non-English) */
    async loadRemote(lang) {
      if (this.catalogs[lang]) return;
      try {
        // Build URL from CDN host injected by theme.liquid into ssI18nConfig
        const cdn = window.ssI18nConfig?.cdnHost || '';
        const url = cdn
          ? `${cdn}/assets/locale.${lang}.json`
          : `//${window.location.host}/cdn/shop/assets/locale.${lang}.json`;
        const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
        if (res.ok) {
          const data = await res.json();
          this.register(lang, data);
          console.debug('[i18n] Loaded locale:', lang, `(${Object.keys(data).length} sections)`);
        } else {
          console.warn('[i18n] Could not load locale', lang, res.status);
        }
      } catch (e) {
        console.warn('[i18n] loadRemote failed for', lang, e.message);
        // Silently fall back to English
      }
    },

    /** Re-translate any newly inserted [data-i18n] elements via MutationObserver */
    watchTranslations() {
      const observer = new MutationObserver(mutations => {
        if (this.current === 'en') return; // nothing to do in English
        let needsApply = false;
        mutations.forEach(mutation => {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType !== 1) return;
            if (node.dataset?.i18n || node.querySelector?.('[data-i18n]')) {
              needsApply = true;
            }
          });
        });
        if (needsApply) this._applyDOM();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    },
  };

  // ═══════════════════════════════════════════════════════════════
  // PHASE D — TimeFormatter
  // ═══════════════════════════════════════════════════════════════

  const TimeFormatter = {
    timezone: 'UTC',

    setTimezone(tz) {
      this.timezone = tz || 'UTC';
      this._repaintDates();
    },

    /**
     * Format an ISO datetime string in the user's timezone.
     * @param {string} iso      — ISO 8601 string
     * @param {'date'|'time'|'datetime'|'relative'} style
     */
    format(iso, style = 'datetime') {
      if (!iso) return '–';
      const date = new Date(iso);
      if (isNaN(date)) return iso;

      const locale = I18n.currentLocale().language || 'en';
      const tz     = this.timezone;

      try {
        if (style === 'relative') return this._relative(date, locale);

        const opts = { timeZone: tz };
        if (style === 'date' || style === 'datetime') {
          opts.day = 'numeric'; opts.month = 'short'; opts.year = 'numeric';
        }
        if (style === 'time' || style === 'datetime') {
          opts.hour = '2-digit'; opts.minute = '2-digit';
        }
        return new Intl.DateTimeFormat(locale, opts).format(date);
      } catch (_) {
        return date.toLocaleString();
      }
    },

    /** Human-readable relative time ("2 hours ago", "in 3 days") */
    _relative(date, locale) {
      const diffMs  = date.getTime() - Date.now();
      const diffSec = Math.round(diffMs / 1000);
      try {
        const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
        const abs = Math.abs(diffSec);
        if (abs < 60)   return rtf.format(diffSec,           'second');
        if (abs < 3600) return rtf.format(Math.round(diffSec / 60),   'minute');
        if (abs < 86400)return rtf.format(Math.round(diffSec / 3600), 'hour');
        return rtf.format(Math.round(diffSec / 86400), 'day');
      } catch (_) {
        return date.toLocaleDateString();
      }
    },

    /** Re-paint all [data-datetime] elements when timezone changes */
    _repaintDates() {
      document.querySelectorAll('[data-datetime]').forEach(el => {
        const iso   = el.dataset.datetime;
        const style = el.dataset.datetimeStyle || 'datetime';
        el.textContent = this.format(iso, style);
        el.title = this.format(iso, 'datetime');
      });
    },
  };

  // ═══════════════════════════════════════════════════════════════
  // PRICE PATCHER — rewrites all .price elements on currency change
  // ═══════════════════════════════════════════════════════════════

  const PricePatcher = {
    baseCurrency: 'USD',

    /**
     * Stamp a base price on every element that has a price.
     * Called once on page load, before any conversion.
     */
    stampPrices() {
      document.querySelectorAll('[data-price]').forEach(el => {
        // already stamped
        if (el.dataset.priceBase) return;
        const raw = el.dataset.price;
        if (!isNaN(parseFloat(raw))) {
          el.dataset.priceBase     = raw;
          el.dataset.priceCurrency = this.baseCurrency;
        }
      });
    },

    /**
     * Re-render all stamped prices in the new currency.
     * Also updates data-currency-symbol on <body> so sym() calls
     * in other plugins stay consistent after a currency change.
     */
    repaintAll(toCurrency) {
      const currInfo = CURRENCIES[toCurrency] || { symbol: toCurrency };
      // Keep body data-attribute in sync so existing sym() reads work
      document.body.dataset.currencySymbol = currInfo.symbol;
      document.body.dataset.currency       = toCurrency;

      document.querySelectorAll('[data-price-base]').forEach(el => {
        const base     = parseFloat(el.dataset.priceBase);
        const fromCurr = el.dataset.priceCurrency || this.baseCurrency;
        if (isNaN(base)) return;
        el.textContent = CurrencyConverter.format(base, fromCurr, toCurrency);
      });
    },

    /**
     * Observe DOM mutations and stamp / convert any newly inserted
     * [data-price] elements automatically.
     * Called once from init() after the first stampPrices().
     */
    watchMutations() {
      const observer = new MutationObserver(mutations => {
        const currentCurrency = window.StaySphere?.i18n?.currentCurrency?.() || this.baseCurrency;
        let needsRepaint = false;

        mutations.forEach(mutation => {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType !== 1) return; // element nodes only
            // Check the node itself
            if (node.dataset?.price && !node.dataset?.priceBase) {
              const raw = node.dataset.price;
              if (!isNaN(parseFloat(raw))) {
                node.dataset.priceBase     = raw;
                node.dataset.priceCurrency = node.dataset.priceCurrency || this.baseCurrency;
                needsRepaint = true;
              }
            }
            // Check descendants
            node.querySelectorAll?.('[data-price]:not([data-price-base])').forEach(el => {
              const raw = el.dataset.price;
              if (!isNaN(parseFloat(raw))) {
                el.dataset.priceBase     = raw;
                el.dataset.priceCurrency = el.dataset.priceCurrency || this.baseCurrency;
                needsRepaint = true;
              }
            });
          });
        });

        if (needsRepaint && currentCurrency !== this.baseCurrency) {
          this.repaintAll(currentCurrency);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
    },
  };

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API — window.StaySphere.i18n
  // ═══════════════════════════════════════════════════════════════

  const I18n = {
    // Expose sub-modules
    store:     LocaleStore,
    geo:       GeoDetector,
    fx:        CurrencyConverter,
    translate: Translator,
    time:      TimeFormatter,
    prices:    PricePatcher,

    // Constants (read-only for other modules)
    LANGUAGES,
    CURRENCIES,
    COUNTRY_DEFAULTS,

    // ── Getters ──────────────────────────────────────────────────
    currentLocale() { return LocaleStore.load(); },

    currentCurrency() {
      return LocaleStore.load().currency || 'USD';
    },

    currentLanguage() {
      return LocaleStore.load().language || 'en';
    },

    currentTimezone() {
      return LocaleStore.load().timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    },

    // ── Setters (user-triggered) ─────────────────────────────────

    /** User explicitly picks a currency */
    setCurrency(code) {
      if (!CURRENCIES[code]) return;
      LocaleStore.save({ currency: code });
      CurrencyConverter.loadRates().then(() => {
        // Repaint first, then notify listeners so they see converted prices
        PricePatcher.repaintAll(code);
        const sym  = CURRENCIES[code]?.symbol || code;
        const rate = CurrencyConverter.rates[code];
        document.dispatchEvent(new CustomEvent('ss:currency-changed', {
          detail: { currency: code, symbol: sym, rate },
        }));
        console.debug('[i18n] Currency changed to', code, sym,
          '| 1 USD =', rate, code);
      });
    },

    /** User explicitly picks a language */
    setLanguage(lang) {
      if (!LANGUAGES[lang]) return;
      LocaleStore.save({ language: lang });
      Translator.loadRemote(lang).then(() => {
        Translator.setLanguage(lang);
        document.dispatchEvent(new CustomEvent('ss:language-changed', { detail: { language: lang } }));
      });
    },

    /** User explicitly picks a timezone */
    setTimezone(tz) {
      LocaleStore.save({ timezone: tz });
      TimeFormatter.setTimezone(tz);
      document.dispatchEvent(new CustomEvent('ss:timezone-changed', { detail: { timezone: tz } }));
    },

    // ── Internal: used by locale-selector widget ─────────────────
    _assetUrl(lang) {
      // Shopify CDN URL pattern — filled at runtime by theme.liquid
      const base = document.body.dataset.cdnHost || '';
      return base ? `${base}/assets/locale.${lang}.json` : null;
    },

    // ── Bootstrap ────────────────────────────────────────────────

    /**
     * Bootstrap sequence (called once on DOMContentLoaded):
     *
     * Phase A:
     *   1. Read ssI18nConfig (injected by theme.liquid)
     *   2. Register English catalog stub
     *   3. If autoDetect enabled: run GeoDetector → saveDetected
     *   4. If autoDetect disabled: apply operator defaults from ssI18nConfig
     *   5. Emit ss:locale-detected with full detection result
     *
     * Phase B–D: applied in the same init() call after detection.
     *   6. Load exchange rates (background)
     *   7. Stamp prices / repaint if currency differs from base
     *   8. Load + apply language
     *   9. Apply timezone
     *  10. Emit ss:i18n-ready
     */
    async init() {
      const cfg = window.ssI18nConfig || {};

      // Register full English catalog — covers every data-i18n key in the theme
      Translator.register('en', {
        general: {
          search:'Search', close:'Close', loading:'Loading…', error:'Something went wrong',
          save:'Save', cancel:'Cancel', confirm:'Confirm', back:'Back', next:'Next',
          view_all:'View all listings', sign_in:'Sign in', sign_out:'Sign out',
          create_account:'Get started', or:'or', required:'Required',
          guest_details:'Guest details', payment:'Payment',
          whats_next:'What happens next', setup_banner_title:'Connect StaySphere AOS to go live',
        },
        nav: {
          home:'Home', properties:'Properties', auctions:'Auctions',
          about:'About', contact:'Contact', sign_in:'Sign in',
          get_started:'Get started', my_bookings:'My bookings',
          messages:'Messages', profile:'Profile & settings',
          agent_dashboard:'Agent dashboard', admin_panel:'Admin panel',
        },
        hero: {
          search_where:'Where', search_checkin:'Check-in',
          search_checkout:'Check-out', search_guests:'Guests',
          search_button:'Search', ai_label:'Or describe what you\'re looking for',
          ai_placeholder:'Describe the property you\'re looking for…',
          ai_button:'Ask AI',
        },
        how_it_works: {
          heading:'The complete real estate platform',
          step1_title:'List', step2_title:'Auction or Book', step3_title:'Close the deal',
        },
        property: {
          bedrooms:'bed', bedrooms_plural:'beds',
          bathrooms:'bath', bathrooms_plural:'baths',
          guests:'guest', guests_plural:'guests',
          per_night:'/ night', per_listing:'/ listing',
          book_now:'Reserve', make_offer:'Make an offer',
          check_availability:'Check availability',
          save_wishlist:'Save', remove_wishlist:'Saved',
          new_listing:'New listing', view_listing:'View listing',
          cleaning_fee:'Cleaning / admin fee',
          service_fee:'Service fee', taxes:'Taxes', total:'Total',
          not_charged_yet:'You won\'t be charged yet',
        },
        auction: {
          live:'Live', upcoming:'Upcoming', closed:'Closed',
          bid_now:'Bid now', current_bid:'Current bid',
          starting_price:'Starting price', bids:'bids',
          deposit_required:'Deposit required', time_remaining:'Time remaining',
          auction_closed:'Auction closed', sold:'Sold!',
        },
        booking: {
          confirm:'Confirm your transaction', confirmed:'Confirmed', pending:'Pending',
          check_in:'Check-in', check_out:'Check-out',
          special_requests:'Any specific requirements or conditions…',
          agree_terms:'I agree to the House rules and Privacy policy',
          secure_payment:'Secured by Stripe — You won\'t be charged until confirmed',
        },
        account: {
          heading:'My account', bids:'My bids', wins:'Won lots',
          deposits:'Deposits', kyc:'Identity', transactions:'Transactions',
          sign_out:'Sign out',
        },
        auth: {
          login_heading:'Sign in to your account',
          register_heading:'Create your account',
          email:'Email', password:'Password',
          forgot_password:'Forgot password?',
          no_account:'New here?', have_account:'Already have an account?',
          submit_login:'Sign in', submit_register:'Get started',
          terms:'I agree to the Terms of Service and Privacy Policy',
          become_agent:'I also want to list properties as an agent',
        },
        trust: {
          verified_agents:'Verified agents',
          verified_agents_text:'Every agent is licensed and ID-verified before listing.',
          secure_transactions:'Secure transactions',
          secure_transactions_text:'Buyer deposits held in escrow, released on deal completion.',
          support:'24/7 support',
          support_text:'Our team is available around the clock.',
        },
        footer: {
          tagline:'The complete property platform for agents worldwide.',
          rights:'All rights reserved.',
        },
        errors: {
          no_results:'No listings found. Try adjusting your search.',
          api_offline:'Our servers are loading. Showing cached results.',
          required_field:'This field is required',
          invalid_email:'Please enter a valid email address',
          password_short:'Password must be at least 8 characters',
        },
      });

      // ── Phase A: detection ──────────────────────────────────────
      const autoDetect = cfg.autoDetect !== false;
      let detected = null;

      if (autoDetect) {
        try {
          detected = await GeoDetector.detect();
          LocaleStore.saveDetected({
            currency:    detected.currency,
            language:    detected.language,
            timezone:    detected.timezone,
            country:     detected.country,
            countryName: detected.countryName,
            city:        detected.city,
          });
          document.dispatchEvent(new CustomEvent('ss:locale-detected', {
            detail: {
              source:      detected._source || 'ip',
              country:     detected.country,
              countryName: detected.countryName || '',
              city:        detected.city || '',
              currency:    detected.currency,
              language:    detected.language,
              timezone:    detected.timezone,
              fromCache:   detected._fromCache || false,
            },
          }));
          console.debug('[i18n] Detected locale:', detected.country,
            detected.currency, detected.language, detected.timezone);
        } catch (e) {
          console.warn('[i18n] Geo detection failed, using defaults:', e.message);
        }
      } else {
        // Operator has disabled auto-detect — use theme settings as defaults
        // (only if user hasn't already set an override)
        const stored = LocaleStore.load();
        if (!stored.userOverride) {
          LocaleStore.saveDetected({
            currency: cfg.defaultCurrency || 'USD',
            language: cfg.defaultLanguage || 'en',
            timezone: cfg.defaultTimezone || 'UTC',
          });
        }
      }

      // ── Phase B–D: apply current locale ────────────────────────
      const locale = LocaleStore.load();

      // Currency — stamp all existing prices, start mutation observer,
      // then load live rates and repaint if visitor's currency differs from base
      PricePatcher.baseCurrency = cfg.defaultCurrency || document.body.dataset.currency || 'USD';
      PricePatcher.stampPrices();
      PricePatcher.watchMutations();   // auto-stamp JS-rendered cards
      Translator.watchTranslations();    // auto-translate JS-rendered content
      CurrencyConverter.loadRates().then(() => {
        const targetCurrency = locale.currency || PricePatcher.baseCurrency;
        if (targetCurrency !== PricePatcher.baseCurrency) {
          PricePatcher.repaintAll(targetCurrency);
        }
        console.debug('[i18n] Exchange rates loaded. Base:', PricePatcher.baseCurrency,
          '→ Target:', targetCurrency,
          '| 1 USD =', CurrencyConverter.rates[targetCurrency] || 1, targetCurrency);
      }).catch(() => {
        console.warn('[i18n] Exchange rates unavailable — using fallback rates');
      });

      // Language
      if (locale.language && locale.language !== 'en') {
        await Translator.loadRemote(locale.language).catch(() => {});
      }
      Translator.setLanguage(locale.language || 'en');

      // Timezone
      TimeFormatter.setTimezone(
        locale.timezone
        || (detected && detected.timezone)
        || cfg.defaultTimezone
        || 'UTC'
      );

      // Expose on SDK
      window.StaySphere = window.StaySphere || {};
      window.StaySphere.i18n = I18n;

      document.dispatchEvent(new CustomEvent('ss:i18n-ready', { detail: locale }));
      console.debug('[i18n] Ready. Locale:', locale);
    },
  };

  // ── Kick off ──────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => I18n.init());
  } else {
    I18n.init();
  }

  // Expose early (before init completes) so other scripts can register catalogs
  window.StaySphere = window.StaySphere || {};
  window.StaySphere.i18n = I18n;

})();
