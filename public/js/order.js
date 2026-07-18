/* Ordering flow: pick a table (1–40) → choose dishes → review → send. */

const O = {
  tables: [],
  categories: [],
  items: [],
  selectedTable: null,
  activeCat: 'all',
  cart: new Map(), // id -> { item, qty }
};

const L = (f) => f + '_' + I18N.current;
const cur = () => I18N.t('menu.currency');

// ── Language ───────────────────────────────────────────────
function paintLang() {
  document.querySelectorAll('#langSwitch button').forEach((b) =>
    b.classList.toggle('active', b.dataset.lang === I18N.current)
  );
}
document.getElementById('langSwitch').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  I18N.load(btn.dataset.lang).then(() => {
    paintLang();
    renderMenu();
    renderCart();
  });
});

// ── Steps ──────────────────────────────────────────────────
function goStep(step) {
  document.querySelectorAll('.step-panel').forEach((p) =>
    p.classList.toggle('active', p.dataset.panel === String(step))
  );
  document.querySelectorAll('.step-pill').forEach((p) => {
    const n = Number(p.dataset.step);
    p.classList.toggle('active', typeof step === 'number' && n <= step);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Tables ─────────────────────────────────────────────────
async function loadTables() {
  O.tables = await fetch('/api/tables').then((r) => r.json());
  renderTables();
}
function renderTables() {
  const grid = document.getElementById('tablesGrid');
  grid.innerHTML = O.tables
    .map((t) => {
      const sel = O.selectedTable === t.table_number ? 'selected' : '';
      const busy = t.busy ? 'busy' : '';
      return `<button class="table-cell ${sel} ${busy}" data-table="${t.table_number}" ${t.busy ? 'disabled' : ''}>
                ${t.table_number}
                <span class="seats">${t.seats} ${I18N.t('order.seats')}</span>
              </button>`;
    })
    .join('');
  grid.querySelectorAll('.table-cell:not(.busy)').forEach((c) =>
    c.addEventListener('click', () => {
      O.selectedTable = Number(c.dataset.table);
      document.getElementById('selTableLabel').textContent =
        I18N.t('order.table') + ' № ' + O.selectedTable;
      goStep(2);
    })
  );
}

// ── Menu ───────────────────────────────────────────────────
async function loadMenu() {
  const [cats, items] = await Promise.all([
    fetch('/api/categories').then((r) => r.json()),
    fetch('/api/menu').then((r) => r.json()),
  ]);
  O.categories = cats;
  O.items = items;
  renderMenu();
}
function renderMenu() {
  const navWrap = document.getElementById('orderCatNav');
  const grouped = O.categories
    .map((c) => ({ cat: c, items: O.items.filter((i) => i.category_id === c.id) }))
    .filter((g) => g.items.length);
  const uncategorised = O.items.filter((i) => !i.category_id);
  if (uncategorised.length) grouped.push({ cat: null, items: uncategorised });
  O._grouped = grouped;

  // Category filter chips (All + each category).
  let nav = `<button class="order-cat-chip${O.activeCat === 'all' ? ' active' : ''}" data-cat="all">${I18N.t('menu.all')}</button>`;
  grouped.forEach((g) => {
    if (g.cat) {
      const on = String(O.activeCat) === String(g.cat.id) ? ' active' : '';
      nav += `<button class="order-cat-chip${on}" data-cat="${g.cat.id}">${g.cat[L('name')]}</button>`;
    }
  });
  navWrap.innerHTML = nav;
  navWrap.querySelectorAll('[data-cat]').forEach((b) =>
    b.addEventListener('click', () => {
      O.activeCat = b.dataset.cat === 'all' ? 'all' : Number(b.dataset.cat);
      renderMenu();
    })
  );

  renderMenuItems();
}

function renderMenuItems() {
  const wrap = document.getElementById('orderMenu');
  const grouped = O._grouped || [];
  const shown =
    O.activeCat === 'all'
      ? grouped
      : grouped.filter((g) => g.cat && String(g.cat.id) === String(O.activeCat));

  let html = '';
  shown.forEach((g) => {
    // Show the category heading only in "All" view (as separators).
    if (g.cat && O.activeCat === 'all') html += `<div class="order-cat-head">${g.cat[L('name')]}</div>`;
    g.items.forEach((i) => {
      const desc = i[L('description')] ? `<div class="order-dish__desc">${i[L('description')]}</div>` : '';
      const media = i.image_url
        ? `<img class="order-dish__photo" src="${i.image_url}" alt="" loading="lazy" />`
        : `<div class="order-dish__photo order-dish__photo--empty">AURUM</div>`;
      html += `
        <div class="order-dish">
          ${media}
          <div class="order-dish__info">
            <div class="order-dish__name">${i[L('name')]}</div>
            ${desc}
            <div class="order-dish__price">${Number(i.price).toFixed(0)} ${cur()}</div>
          </div>
          <button class="btn btn--sm" data-add="${i.id}">${I18N.t('order.add')}</button>
        </div>`;
    });
  });
  wrap.innerHTML = html;

  wrap.querySelectorAll('[data-add]').forEach((b) =>
    b.addEventListener('click', () => addToCart(Number(b.dataset.add)))
  );
  wrap.scrollTop = 0;
}

// ── Cart ───────────────────────────────────────────────────
function addToCart(id) {
  const item = O.items.find((i) => i.id === id);
  if (!item) return;
  const entry = O.cart.get(id) || { item, qty: 0 };
  entry.qty += 1;
  O.cart.set(id, entry);
  renderCart();
}
function changeQty(id, delta) {
  const entry = O.cart.get(id);
  if (!entry) return;
  entry.qty += delta;
  if (entry.qty <= 0) O.cart.delete(id);
  renderCart();
}
function cartTotal() {
  let t = 0;
  O.cart.forEach((e) => (t += e.item.price * e.qty));
  return t;
}
function cartLinesHTML(withControls) {
  if (O.cart.size === 0) return `<p class="cart-empty">${I18N.t('order.cart_empty')}</p>`;
  let html = '';
  O.cart.forEach((e, id) => {
    const controls = withControls
      ? `<div class="qty">
           <button data-dec="${id}">−</button><span>${e.qty}</span><button data-inc="${id}">+</button>
         </div>`
      : `<span>× ${e.qty}</span>`;
    html += `<div class="cart-line">
               <span class="name">${e.item[L('name')]}</span>
               ${controls}
               <span>${(e.item.price * e.qty).toFixed(0)}</span>
             </div>`;
  });
  return html;
}
function renderCart() {
  document.getElementById('cartLines').innerHTML = cartLinesHTML(true);
  document.getElementById('cartTotal').textContent = cartTotal().toFixed(0);
  document.querySelectorAll('[data-inc]').forEach((b) =>
    b.addEventListener('click', () => changeQty(Number(b.dataset.inc), 1))
  );
  document.querySelectorAll('[data-dec]').forEach((b) =>
    b.addEventListener('click', () => changeQty(Number(b.dataset.dec), -1))
  );
}

// ── Step navigation buttons ────────────────────────────────
document.getElementById('backToTables').addEventListener('click', () => goStep(1));
document.getElementById('toReview').addEventListener('click', () => {
  if (O.cart.size === 0) return toast(I18N.t('order.cart_empty_alert'));
  document.getElementById('reviewLines').innerHTML = cartLinesHTML(false);
  document.getElementById('reviewTotal').textContent = cartTotal().toFixed(0);
  goStep(3);
});
document.getElementById('backToMenu').addEventListener('click', () => goStep(2));

// ── Send order ─────────────────────────────────────────────
document.getElementById('sendOrder').addEventListener('click', async () => {
  const payload = {
    tableNumber: O.selectedTable,
    customerName: document.getElementById('custName').value,
    phone: document.getElementById('custPhone').value,
    note: document.getElementById('custNote').value,
    items: Array.from(O.cart.values()).map((e) => ({ id: e.item.id, quantity: e.qty })),
  };
  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error();
    document.getElementById('successBody').textContent = I18N.t('order.success_body', {
      table: O.selectedTable,
    });
    goStep('done');
  } catch {
    toast(I18N.t('errors.generic'));
  }
});

document.getElementById('newOrder').addEventListener('click', () => {
  O.cart.clear();
  O.selectedTable = null;
  document.getElementById('custName').value = '';
  document.getElementById('custPhone').value = '';
  document.getElementById('custNote').value = '';
  loadTables();
  renderCart();
  goStep(1);
});

// ── Toast ──────────────────────────────────────────────────
let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ── Boot ───────────────────────────────────────────────────
I18N.load().then(() => {
  paintLang();
  loadTables();
  loadMenu();
});
