/* Shared internationalisation helper for Aurum.
   Loads /locales/<lang>.json, remembers the choice, and translates any
   element carrying a data-i18n="path.to.key" attribute. */

const I18N = (() => {
  const SUPPORTED = ['ka', 'en', 'ru'];
  const STORAGE_KEY = 'aurum_lang';
  let dict = {};
  let lang = localStorage.getItem(STORAGE_KEY);
  if (!SUPPORTED.includes(lang)) lang = 'ka';

  const subscribers = [];

  function get(path) {
    return path.split('.').reduce((o, k) => (o && o[k] != null ? o[k] : null), dict);
  }

  // t('order.success_body', { table: 12 })
  function t(path, vars) {
    let str = get(path);
    if (str == null) return path;
    if (vars) {
      Object.keys(vars).forEach((k) => {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), vars[k]);
      });
    }
    return str;
  }

  async function load(next) {
    if (next && SUPPORTED.includes(next)) lang = next;
    localStorage.setItem(STORAGE_KEY, lang);
    const res = await fetch(`/locales/${lang}.json`);
    dict = await res.json();
    document.documentElement.lang = lang;
    apply();
    subscribers.forEach((fn) => fn(lang));
  }

  // Replace text / placeholder / value on tagged elements.
  function apply(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      const val = t(el.getAttribute('data-i18n'));
      if (val != null) el.textContent = val;
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const val = t(el.getAttribute('data-i18n-placeholder'));
      if (val != null) el.setAttribute('placeholder', val);
    });
  }

  function onChange(fn) {
    subscribers.push(fn);
  }

  return {
    t,
    apply,
    load,
    onChange,
    get current() {
      return lang;
    },
    SUPPORTED,
  };
})();
