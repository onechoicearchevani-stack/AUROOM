/* Public homepage logic: language switching, mobile nav, dynamic menu. */

const state = { categories: [], items: [], activeCat: 'all' };

function L(field) {
  // Returns the right language column name, e.g. name + _en
  return field + '_' + I18N.current;
}

// ── Language switcher buttons ──────────────────────────────
function paintLangButtons() {
  document.querySelectorAll('#langSwitch button').forEach((b) => {
    b.classList.toggle('active', b.dataset.lang === I18N.current);
  });
}
document.getElementById('langSwitch').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  I18N.load(btn.dataset.lang).then(paintLangButtons);
});

// ── Mobile nav ─────────────────────────────────────────────
document.getElementById('navToggle').addEventListener('click', () => {
  document.getElementById('navLinks').classList.toggle('open');
});
document.querySelectorAll('#navLinks a').forEach((a) =>
  a.addEventListener('click', () => document.getElementById('navLinks').classList.remove('open'))
);

// ── Menu rendering ─────────────────────────────────────────
async function loadMenu() {
  // The homepage no longer shows a menu section; skip if its container is absent.
  if (!document.getElementById('menuGrid')) return;
  const [cats, items] = await Promise.all([
    fetch('/api/categories').then((r) => r.json()),
    fetch('/api/menu').then((r) => r.json()),
  ]);
  state.categories = cats;
  state.items = items;
  renderTabs();
  renderItems();
}

function renderTabs() {
  const wrap = document.getElementById('menuTabs');
  const tabs = [{ id: 'all', label: I18N.t('menu.all') }].concat(
    state.categories.map((c) => ({ id: c.id, label: c[L('name')] }))
  );
  wrap.innerHTML = tabs
    .map(
      (t) =>
        `<button class="menu-tab ${state.activeCat == t.id ? 'active' : ''}" data-cat="${t.id}">${t.label}</button>`
    )
    .join('');
  wrap.querySelectorAll('.menu-tab').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.activeCat = btn.dataset.cat;
      renderTabs();
      renderItems();
    })
  );
}

function renderItems() {
  const grid = document.getElementById('menuGrid');
  let items = state.items;
  if (state.activeCat !== 'all') {
    items = items.filter((i) => String(i.category_id) === String(state.activeCat));
  }
  if (items.length === 0) {
    grid.innerHTML = `<p class="menu-empty">${I18N.t('menu.empty')}</p>`;
    return;
  }
  grid.innerHTML = items
    .map((i) => {
      const thumb = i.image_url
        ? `<img class="dish__thumb" src="${i.image_url}" alt="" loading="lazy" />`
        : '';
      const star = i.is_featured ? ' <span class="star">✦</span>' : '';
      const desc = i[L('description')]
        ? `<p class="dish__desc">${i[L('description')]}</p>`
        : '';
      return `
        <article class="dish">
          ${thumb}
          <div class="dish__body">
            <div class="dish__top">
              <h3 class="dish__name">${i[L('name')]}${star}</h3>
              <span class="dish__price">${Number(i.price).toFixed(0)} ${I18N.t('menu.currency')}</span>
            </div>
            ${desc}
          </div>
        </article>`;
    })
    .join('');
}

// ── Editable site content (about, contacts, gallery) ───────
let siteContent = null;
async function loadSiteContent() {
  try {
    siteContent = await fetch('/api/settings').then((r) => r.json());
  } catch (_) {
    siteContent = null;
  }
  renderSiteContent();
}

function renderSiteContent() {
  const s = siteContent;
  if (!s) return;
  const lang = I18N.current;
  const setText = (id, val) => {
    if (!val) return;
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  if (s.about && s.about[lang]) setText('aboutBody', s.about[lang]);
  const tri = (o) => (o && o[lang]) || '';
  setText('heroEyebrow', tri(s.hero_location));
  setText('heroSubtitle', tri(s.hero_subtitle));
  setText('aboutEyebrow', tri(s.about_eyebrow));
  setText('aboutTitle', tri(s.about_title));

  // Stats — rebuild if provided.
  if (Array.isArray(s.stats) && s.stats.length) {
    const sg = document.getElementById('statsGrid');
    if (sg) {
      sg.innerHTML = s.stats
        .map(
          (st) =>
            `<div class="stat"><div class="stat__num">${st.num || ''}</div><div class="stat__label">${(st.label && st.label[lang]) || ''}</div></div>`
        )
        .join('');
    }
  }

  setText('contactPhone', s.phone);
  setText('contactAddress', s.address);
  setText('contactHours', s.hours);

  // Extra contact cards (email + socials), rebuilt each time.
  const grid = document.getElementById('contactGrid');
  if (grid) {
    grid.querySelectorAll('[data-dynamic]').forEach((el) => el.remove());
    const card = (label, value, href) => {
      const inner = href
        ? `<a class="value" href="${href}" target="_blank" rel="noopener">${value}</a>`
        : `<div class="value">${value}</div>`;
      const div = document.createElement('div');
      div.className = 'contact-card';
      div.setAttribute('data-dynamic', '1');
      div.innerHTML = `<div class="label">${label}</div>${inner}`;
      grid.appendChild(div);
    };
    if (s.email) card(I18N.t('contact.email_label'), s.email, 'mailto:' + s.email);
    if (s.instagram) card('Instagram', 'Instagram', s.instagram);
    if (s.facebook) card('Facebook', 'Facebook', s.facebook);
  }

  // Gallery
  if (Array.isArray(s.gallery) && s.gallery.length) {
    const gg = document.getElementById('galleryGrid');
    if (gg) {
      gg.innerHTML = s.gallery
        .map((u) => `<div class="tile tile--photo"><img src="${u}" alt="" loading="lazy" /></div>`)
        .join('');
    }
  }
}

// Re-render menu text when language changes.
I18N.onChange(() => {
  if (state.categories.length) {
    renderTabs();
    renderItems();
  }
  renderSiteContent();
});

// ── Boot ───────────────────────────────────────────────────
document.getElementById('year').textContent = new Date().getFullYear();
I18N.load().then(() => {
  paintLangButtons();
  loadMenu();
  loadSiteContent();
});
