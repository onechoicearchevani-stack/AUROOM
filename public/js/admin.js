/* Admin panel: auth, live order board (SSE), menu & category management. */

const A = { user: null, categories: [], orders: new Map(), evtSource: null };
const L = (f) => f + '_' + I18N.current;

// ── small helpers ──────────────────────────────────────────
const $ = (id) => document.getElementById(id);
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 401) {
    toast(errText('session_expired'));
    showAuth();
    throw new Error('auth');
  }
  return res;
}
let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}
function errText(code) {
  return I18N.t('errors.' + code) !== 'errors.' + code
    ? I18N.t('errors.' + code)
    : I18N.t('errors.generic');
}

// Resize/compress an image in the browser before upload so large photos upload
// reliably, the menu loads fast, and disk space stays small.
async function resizeImage(file, maxDim = 1400, quality = 0.85) {
  // Decode: prefer createImageBitmap (fast + robust for large photos), fall back to <img>.
  let source, sw, sh;
  try {
    source = await createImageBitmap(file);
    sw = source.width; sh = source.height;
  } catch (_) {
    source = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode_failed')); };
      img.src = url;
    });
    sw = source.naturalWidth; sh = source.naturalHeight;
  }
  let width = sw, height = sh;
  if (width > maxDim || height > maxDim) {
    if (width >= height) { height = Math.round((height * maxDim) / width); width = maxDim; }
    else { width = Math.round((width * maxDim) / height); height = maxDim; }
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(source, 0, 0, width, height);
  if (source.close) source.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('resize_failed');
  return blob;
}

// ── Language ───────────────────────────────────────────────
function paintLang() {
  document.querySelectorAll('#langSwitch button').forEach((b) =>
    b.classList.toggle('active', b.dataset.lang === I18N.current)
  );
}
document.addEventListener('click', (e) => {
  const langBtn = e.target.closest('#langSwitch button');
  if (langBtn) {
    I18N.load(langBtn.dataset.lang).then(() => {
      paintLang();
      if (A.user) {
        renderOrders();
        loadMenuTable();
        loadCategories();
      }
    });
  }
});

// ── Auth UI toggling ───────────────────────────────────────
function showAuth() {
  $('authScreen').style.display = 'grid';
  $('dashboard').style.display = 'none';
  document.querySelectorAll('.modal-backdrop.show').forEach((m) => m.classList.remove('show'));
  if (A.evtSource) A.evtSource.close();
}
function showDashboard() {
  $('authScreen').style.display = 'none';
  $('dashboard').style.display = 'block';
  $('whoami').textContent = (A.user.fullName || A.user.username) + ' · ' + A.user.role;
  connectStream();
  loadCategories();
  loadMenuTable();
}
$('showRegister').addEventListener('click', () => {
  $('loginForm').style.display = 'none';
  $('registerForm').style.display = 'block';
  $('authTitle').textContent = I18N.t('admin.register_title');
});
$('showLogin').addEventListener('click', () => {
  $('registerForm').style.display = 'none';
  $('loginForm').style.display = 'block';
  $('authTitle').textContent = I18N.t('admin.login_title');
});
function authError(code) {
  const el = $('authError');
  el.textContent = errText(code);
  el.classList.add('show');
}

$('loginBtn').addEventListener('click', async () => {
  $('authError').classList.remove('show');
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: $('loginUser').value, password: $('loginPass').value }),
    });
    const data = await res.json();
    if (!res.ok) return authError(data.error);
    A.user = data.user;
    showDashboard();
  } catch {
    authError('generic');
  }
});

$('registerBtn').addEventListener('click', async () => {
  $('authError').classList.remove('show');
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: $('regName').value,
        username: $('regUser').value,
        password: $('regPass').value,
        role: $('regRole').value,
        registrationCode: $('regCode').value,
      }),
    });
    const data = await res.json();
    if (!res.ok) return authError(data.error);
    A.user = data.user;
    showDashboard();
  } catch {
    authError('generic');
  }
});

$('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  A.user = null;
  showAuth();
});

// ── Tabs ───────────────────────────────────────────────────
document.querySelectorAll('.admin-tab').forEach((tab) =>
  tab.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.admin-view').forEach((v) =>
      v.classList.toggle('active', v.dataset.view === tab.dataset.view)
    );
    if (tab.dataset.view === 'site') loadSettings();
  })
);

// ── Site content management ────────────────────────────────
A.gallery = [];
A.stats = [];
const STAT_SLOTS = 3;

function setTri(prefix, obj) {
  ['ka', 'en', 'ru'].forEach((l) => {
    const el = $(prefix + l);
    if (el) el.value = (obj && obj[l]) || '';
  });
}
function getTri(prefix) {
  return { ka: $(prefix + 'ka').value, en: $(prefix + 'en').value, ru: $(prefix + 'ru').value };
}

function renderStatsForm() {
  const wrap = $('statsForm');
  let html = '';
  for (let i = 0; i < STAT_SLOTS; i++) {
    const s = A.stats[i] || { num: '', label: {} };
    html += `
      <div class="stat-row">
        <label class="field stat-num"><span data-i18n="admin.site_stat_num">რიცხვი</span><input id="s_stat${i}_num" type="text" value="${(s.num || '').replace(/"/g, '&quot;')}" /></label>
        <label class="field"><span>KA</span><input id="s_stat${i}_ka" type="text" value="${((s.label && s.label.ka) || '').replace(/"/g, '&quot;')}" /></label>
        <label class="field"><span>EN</span><input id="s_stat${i}_en" type="text" value="${((s.label && s.label.en) || '').replace(/"/g, '&quot;')}" /></label>
        <label class="field"><span>RU</span><input id="s_stat${i}_ru" type="text" value="${((s.label && s.label.ru) || '').replace(/"/g, '&quot;')}" /></label>
      </div>`;
  }
  wrap.innerHTML = html;
  I18N.apply();
}

async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const s = await res.json();
    setTri('s_hloc_', s.hero_location);
    setTri('s_hsub_', s.hero_subtitle);
    setTri('s_aeye_', s.about_eyebrow);
    setTri('s_atit_', s.about_title);
    setTri('s_about_', s.about);
    A.stats = Array.isArray(s.stats) ? s.stats.slice() : [];
    renderStatsForm();
    $('s_phone').value = s.phone || '';
    $('s_address').value = s.address || '';
    $('s_hours').value = s.hours || '';
    $('s_email').value = s.email || '';
    $('s_instagram').value = s.instagram || '';
    $('s_facebook').value = s.facebook || '';
    A.gallery = Array.isArray(s.gallery) ? s.gallery.slice() : [];
    renderGallery();
  } catch (_) {
    toast(errText('generic'));
  }
}

function renderGallery() {
  const wrap = $('galleryManage');
  if (!A.gallery.length) {
    wrap.innerHTML = `<div class="gallery-empty" data-i18n="admin.site_no_photos">ფოტოები ჯერ არ არის</div>`;
    I18N.apply();
    return;
  }
  wrap.innerHTML = A.gallery
    .map(
      (url, idx) => `
      <div class="gallery-thumb">
        <img src="${url}" alt="" />
        <button data-remove="${idx}" title="✕">✕</button>
      </div>`
    )
    .join('');
  wrap.querySelectorAll('[data-remove]').forEach((b) =>
    b.addEventListener('click', () => {
      A.gallery.splice(Number(b.dataset.remove), 1);
      renderGallery();
    })
  );
}

$('galleryFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    let payload = file;
    let filename = file.name || 'photo.jpg';
    try { payload = await resizeImage(file, 1600, 0.85); filename = 'photo.jpg'; } catch (_) {}
    const fd = new FormData();
    fd.append('image', payload, filename);
    const up = await fetch('/api/menu/upload', { method: 'POST', body: fd });
    if (up.status === 401) { toast(errText('session_expired')); return showAuth(); }
    if (!up.ok) return toast(errText((await up.json().catch(() => ({}))).error));
    A.gallery.push((await up.json()).url);
    renderGallery();
  } catch (_) {
    toast(errText('generic'));
  } finally {
    e.target.value = '';
  }
});

$('saveSiteBtn').addEventListener('click', async () => {
  try {
    const stats = [];
    for (let i = 0; i < STAT_SLOTS; i++) {
      const num = $('s_stat' + i + '_num').value.trim();
      const label = getTri('s_stat' + i + '_');
      if (num || label.ka || label.en || label.ru) stats.push({ num, label });
    }
    const body = JSON.stringify({
      hero_location: getTri('s_hloc_'),
      hero_subtitle: getTri('s_hsub_'),
      about_eyebrow: getTri('s_aeye_'),
      about_title: getTri('s_atit_'),
      about: getTri('s_about_'),
      stats,
      phone: $('s_phone').value,
      address: $('s_address').value,
      hours: $('s_hours').value,
      email: $('s_email').value,
      instagram: $('s_instagram').value,
      facebook: $('s_facebook').value,
      gallery: A.gallery,
    });
    const res = await api('/settings', { method: 'PUT', body });
    if (!res.ok) return toast(errText((await res.json().catch(() => ({}))).error));
    toast(I18N.t('admin.saved'));
  } catch (e) {
    if (e.message !== 'auth') toast(errText('generic'));
  }
});

// ── Live orders (Server-Sent Events) ───────────────────────
function connectStream() {
  if (A.evtSource) A.evtSource.close();
  const es = new EventSource('/api/orders/stream');
  A.evtSource = es;

  es.addEventListener('snapshot', (e) => {
    A.orders.clear();
    JSON.parse(e.data).forEach((o) => A.orders.set(o.id, o));
    renderOrders();
  });
  es.addEventListener('order', (e) => {
    const payload = JSON.parse(e.data);
    if (payload.type === 'new') {
      A.orders.set(payload.order.id, payload.order);
      chime();
    } else if (payload.type === 'status') {
      const o = A.orders.get(payload.orderId);
      if (o) o.status = payload.status;
    } else if (payload.type === 'removed') {
      A.orders.delete(payload.orderId);
    }
    renderOrders();
  });
  es.onerror = () => {
    $('liveDot').textContent = I18N.t('admin.connection_lost');
    // EventSource auto-reconnects; restore label on next message.
    es.onopen = () => ($('liveDot').textContent = 'LIVE');
  };
}

function renderOrders() {
  const grid = $('ordersGrid');
  const empty = $('ordersEmpty');
  const list = Array.from(A.orders.values()).sort(
    (a, b) => new Date(a.created_at) - new Date(b.created_at)
  );
  empty.style.display = list.length ? 'none' : 'block';
  grid.innerHTML = list
    .map((o) => {
      const time = new Date(o.created_at + 'Z').toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      const lines = o.items
        .map(
          (it) =>
            `<div class="order-card__line"><span><span class="q">${it.quantity}×</span>${it[L('name')]}</span><span>${(it.price * it.quantity).toFixed(0)}</span></div>`
        )
        .join('');
      const note = o.note
        ? `<div class="order-card__note">“${escapeHtml(o.note)}”</div>`
        : '';
      const statusLabel =
        o.status === 'preparing' ? I18N.t('admin.status_preparing') : I18N.t('admin.status_new');
      return `
        <div class="order-card ${o.status}">
          <div class="order-card__head">
            <div class="order-card__table">${o.table_number}<span>${I18N.t('admin.order_table')}</span></div>
            <div style="text-align:right">
              <div class="order-card__status ${o.status}">${statusLabel}</div>
              <div class="order-card__time">${time}</div>
            </div>
          </div>
          <div class="order-card__lines">
            ${lines}
            ${o.customer_name || o.phone ? `<div class="order-card__note">${escapeHtml(o.customer_name)} ${escapeHtml(o.phone)}</div>` : ''}
            ${note}
          </div>
          <div class="order-card__foot">
            ${o.status === 'new' ? `<button class="btn btn--ghost btn--sm" data-prep="${o.id}">${I18N.t('admin.mark_preparing')}</button>` : ''}
            <button class="btn btn--solid btn--sm" data-done="${o.id}">${I18N.t('admin.mark_done')}</button>
          </div>
        </div>`;
    })
    .join('');

  grid.querySelectorAll('[data-prep]').forEach((b) =>
    b.addEventListener('click', () =>
      api(`/orders/${b.dataset.prep}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'preparing' }),
      })
    )
  );
  grid.querySelectorAll('[data-done]').forEach((b) =>
    b.addEventListener('click', () => api(`/orders/${b.dataset.done}`, { method: 'DELETE' }))
  );
}

// soft notification beep using the Web Audio API (no asset needed)
function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    o.start();
    o.stop(ctx.currentTime + 0.4);
  } catch {}
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Categories management ──────────────────────────────────
async function loadCategories() {
  const res = await api('/categories/all');
  A.categories = await res.json();
  const tbody = $('catTbody');
  tbody.innerHTML = A.categories
    .map(
      (c) => `
      <tr>
        <td>${escapeHtml(c.name_ka)}</td>
        <td>${escapeHtml(c.name_en)}</td>
        <td>${escapeHtml(c.name_ru)}</td>
        <td>${c.sort_order}</td>
        <td><div class="row-actions">
          <button class="btn btn--ghost btn--sm" data-edit-cat="${c.id}">${I18N.t('admin.edit')}</button>
          <button class="btn btn--ghost btn--sm" data-del-cat="${c.id}">${I18N.t('admin.delete')}</button>
        </div></td>
      </tr>`
    )
    .join('');
  tbody.querySelectorAll('[data-edit-cat]').forEach((b) =>
    b.addEventListener('click', () => openCatModal(Number(b.dataset.editCat)))
  );
  tbody.querySelectorAll('[data-del-cat]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm(I18N.t('admin.confirm_delete'))) return;
      await api(`/categories/${b.dataset.delCat}`, { method: 'DELETE' });
      loadCategories();
      loadMenuTable();
    })
  );
}

function openCatModal(id) {
  const c = id ? A.categories.find((x) => x.id === id) : null;
  $('catId').value = c ? c.id : '';
  $('c_name_ka').value = c ? c.name_ka : '';
  $('c_name_en').value = c ? c.name_en : '';
  $('c_name_ru').value = c ? c.name_ru : '';
  $('c_sort').value = c ? c.sort_order : 0;
  $('catModalTitle').textContent = I18N.t(c ? 'admin.edit' : 'admin.add_category');
  $('catModal').classList.add('show');
}
$('addCatBtn').addEventListener('click', () => openCatModal(null));
$('saveCatBtn').addEventListener('click', async () => {
 try {
  const id = $('catId').value;
  const body = JSON.stringify({
    name_ka: $('c_name_ka').value,
    name_en: $('c_name_en').value,
    name_ru: $('c_name_ru').value,
    sort_order: Number($('c_sort').value) || 0,
    is_active: 1,
  });
  const res = await api(id ? `/categories/${id}` : '/categories', {
    method: id ? 'PUT' : 'POST',
    body,
  });
  if (!res.ok) return toast(errText((await res.json().catch(() => ({}))).error));
  $('catModal').classList.remove('show');
  loadCategories();
 } catch (e) {
  if (e.message !== 'auth') toast(errText('generic'));
 }
});

// ── Menu management ────────────────────────────────────────
async function loadMenuTable() {
  if (!A.categories.length) await loadCategories();
  const res = await api('/menu/all');
  const items = await res.json();
  const catName = (cid) => {
    const c = A.categories.find((x) => x.id === cid);
    return c ? c[L('name')] : I18N.t('admin.no_category');
  };
  const tbody = $('menuTbody');
  tbody.innerHTML = items
    .map(
      (i) => `
      <tr>
        <td>${i.image_url ? `<img class="thumb" src="${i.image_url}" alt="" />` : '<div class="thumb"></div>'}</td>
        <td>${escapeHtml(i[L('name')])}${i.is_featured ? ' <span class="star" style="color:var(--gold)">✦</span>' : ''}</td>
        <td>${escapeHtml(catName(i.category_id))}</td>
        <td>${Number(i.price).toFixed(0)}</td>
        <td><span class="tag ${i.is_available ? 'on' : 'off'}">${i.is_available ? '✓' : '✕'}</span></td>
        <td><div class="row-actions">
          <button class="btn btn--ghost btn--sm" data-edit-item="${i.id}">${I18N.t('admin.edit')}</button>
          <button class="btn btn--ghost btn--sm" data-del-item="${i.id}">${I18N.t('admin.delete')}</button>
        </div></td>
      </tr>`
    )
    .join('');
  A._items = items;
  tbody.querySelectorAll('[data-edit-item]').forEach((b) =>
    b.addEventListener('click', () => openItemModal(Number(b.dataset.editItem)))
  );
  tbody.querySelectorAll('[data-del-item]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm(I18N.t('admin.confirm_delete'))) return;
      await api(`/menu/${b.dataset.delItem}`, { method: 'DELETE' });
      loadMenuTable();
    })
  );
}

function fillCategorySelect(selectedId) {
  const sel = $('f_category');
  sel.innerHTML =
    `<option value="">${I18N.t('admin.no_category')}</option>` +
    A.categories
      .map((c) => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${c[L('name')]}</option>`)
      .join('');
}

let editingImageUrl = '';
function openItemModal(id) {
  const i = id ? A._items.find((x) => x.id === id) : null;
  $('itemId').value = i ? i.id : '';
  $('f_name_ka').value = i ? i.name_ka : '';
  $('f_name_en').value = i ? i.name_en : '';
  $('f_name_ru').value = i ? i.name_ru : '';
  $('f_desc_ka').value = i ? i.description_ka : '';
  $('f_desc_en').value = i ? i.description_en : '';
  $('f_desc_ru').value = i ? i.description_ru : '';
  $('f_price').value = i ? i.price : '';
  $('f_available').checked = i ? !!i.is_available : true;
  $('f_featured').checked = i ? !!i.is_featured : false;
  $('f_image_file').value = '';
  editingImageUrl = i ? i.image_url : '';
  fillCategorySelect(i ? i.category_id : null);
  $('itemModalTitle').textContent = I18N.t(i ? 'admin.edit' : 'admin.add_item');
  $('itemModal').classList.add('show');
}
$('addItemBtn').addEventListener('click', () => openItemModal(null));

$('saveItemBtn').addEventListener('click', async () => {
 try {
  // Upload a new image first, if one was picked.
  const file = $('f_image_file').files[0];
  let imageUrl = editingImageUrl;
  if (file) {
    let payload = file;
    let filename = file.name || 'dish.jpg';
    try {
      payload = await resizeImage(file);
      filename = 'dish.jpg';
    } catch (_) {
      // Couldn't resize — upload the original file as-is (server allows up to 12 MB).
    }
    const fd = new FormData();
    fd.append('image', payload, filename);
    const up = await fetch('/api/menu/upload', { method: 'POST', body: fd });
    if (up.status === 401) { toast(errText('session_expired')); return showAuth(); }
    if (up.ok) imageUrl = (await up.json()).url;
    else return toast(errText((await up.json().catch(() => ({}))).error));
  }

  const id = $('itemId').value;
  const body = JSON.stringify({
    name_ka: $('f_name_ka').value,
    name_en: $('f_name_en').value,
    name_ru: $('f_name_ru').value,
    description_ka: $('f_desc_ka').value,
    description_en: $('f_desc_en').value,
    description_ru: $('f_desc_ru').value,
    price: $('f_price').value,
    category_id: $('f_category').value ? Number($('f_category').value) : null,
    image_url: imageUrl,
    is_available: $('f_available').checked ? 1 : 0,
    is_featured: $('f_featured').checked ? 1 : 0,
  });
  const res = await api(id ? `/menu/${id}` : '/menu', { method: id ? 'PUT' : 'POST', body });
  if (!res.ok) return toast(errText((await res.json().catch(() => ({}))).error));
  $('itemModal').classList.remove('show');
  loadMenuTable();
 } catch (e) {
  if (e.message !== 'auth') toast(errText('generic'));
 }
});

// close modals
document.querySelectorAll('[data-close-modal]').forEach((b) =>
  b.addEventListener('click', () =>
    document.querySelectorAll('.modal-backdrop').forEach((m) => m.classList.remove('show'))
  )
);
document.querySelectorAll('.modal-backdrop').forEach((m) =>
  m.addEventListener('click', (e) => {
    if (e.target === m) m.classList.remove('show');
  })
);

// ── Boot ───────────────────────────────────────────────────
I18N.load().then(async () => {
  paintLang();
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      A.user = (await res.json()).user;
      showDashboard();
    } else {
      showAuth();
    }
  } catch {
    showAuth();
  }
});
