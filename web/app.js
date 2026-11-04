/* Billora — app logic */
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = (n, l = 2) => String(n).padStart(l, '0');
const dkey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toP = r => Math.round((+r || 0) * 100);            // rupees -> paise (integer)
const fmtN = p => (p / 100).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const cur = () => S.settings.currency || '₹';
const money = p => cur() + fmtN(p);
const money0 = p => cur() + (p / 100).toLocaleString('en-IN', {maximumFractionDigits: 2});
const fmtDate = iso => { const d = new Date(iso); return `${pad(d.getDate())}-${pad(d.getMonth()+1)}-${d.getFullYear()}`; };
const fmtTime = iso => new Date(iso).toLocaleTimeString('en-IN', {hour: '2-digit', minute: '2-digit', hour12: true});
const normPhone = p => String(p || '').replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');

const DEFAULT_SETTINGS = {
  shopName: '', legalName: '', address: '', phone: '', email: '', gstin: '',
  stateName: '', stateCode: '', gstMode: 'none', gstRate: 5, sac: '9997',
  invoicePrefix: 'INV', billSize: '80mm', showLogo: true, footer: 'Thank you! Visit again.',
  logo: '', groups: ['Women', 'Men'], currency: '₹', setupDone: false
};
const SAMPLE = {
  Women: [['Hair Cut', 'Hair Cut', 300], ['Hair Cut', 'Hair Wash', 150], ['Threading', 'Eyebrow', 50], ['Threading', 'Upper Lips', 40],
          ['Facials', 'Clean Up', 700], ['Facials', 'Fruit Facial', 1200], ['Hair Colour', 'Root Touch Up', 1200], ['Hands & Feet', 'Pedicure', 600]],
  Men: [['Hair & Beard', 'Hair Cut', 200], ['Hair & Beard', 'Shave', 100], ['Hair & Beard', 'Beard Trim', 100], ['Hair Colour', 'Beard Colour', 300],
        ['Facials', 'Clean Up', 700], ['Massage', 'Head Massage', 300]],
  General: [['Hair', 'Hair Cut', 200], ['Hair', 'Hair Wash', 100], ['Skin', 'Facial', 1000], ['Skin', 'Threading', 50]]
};

// products: [{id, name, brand, cat, code (barcode/SKU), hsn, price (rupees), gstRate ('' = use default), stock, low, active}]
const S = { settings: {...DEFAULT_SETTINGS}, services: [], staff: [], bills: [], products: [] };
const COLLECTIONS = ['settings', 'services', 'staff', 'bills', 'products'];

/* ---------------- storage ---------------- */
async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  if (!r.ok) throw new Error(await r.text());
  return r;
}
const saveQ = {};
async function save(key) {
  try { await api('/api/store/' + key, S[key]); }
  catch (e) { toast('Could not save! ' + e.message, true); throw e; }
}
async function load() {
  const d = await (await api('/api/load')).json();
  S.settings = {...DEFAULT_SETTINGS, ...(d.settings || {})};
  S.services = d.services || [];
  S.staff = d.staff || [];
  S.bills = d.bills || [];
  S.products = d.products || [];
}
setInterval(() => fetch('/api/ping').catch(() => {}), 5000);
fetch('/api/ping').catch(() => {});

/* ---------------- ui helpers ---------------- */
let toastT;
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastT); toastT = setTimeout(() => t.className = '', err ? 4000 : 2200);
}
function modal(html, onMount) {
  $('#modalBox').innerHTML = html; $('#modal').classList.remove('hidden');
  onMount && onMount($('#modalBox'));
}
function closeModal() { $('#modal').classList.add('hidden'); $('#modalBox').innerHTML = ''; }
$('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal(); });
function confirmBox(msg, yesLabel = 'Yes') {
  return new Promise(res => {
    modal(`<h3>Please confirm</h3><p>${msg}</p><div class="row gap"><span class="grow"></span><button class="ghost" id="cNo">Cancel</button><button class="pri" id="cYes">${esc(yesLabel)}</button></div>`, b => {
      b.querySelector('#cNo').onclick = () => { closeModal(); res(false); };
      b.querySelector('#cYes').onclick = () => { closeModal(); res(true); };
      b.querySelector('#cYes').focus();
    });
  });
}
function segInit(el, onChange) {
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    el.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    onChange(b.dataset.v);
  });
}
const segVal = el => el.querySelector('button.on')?.dataset.v;
function download(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], {type}));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const csvCell = v => { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const toCSV = rows => '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
function rangeDates(v) {
  const t = new Date(); const y = t.getFullYear(), m = t.getMonth();
  switch (v) {
    case 'today': return [dkey(t), dkey(t)];
    case 'yest': { const d = new Date(t); d.setDate(d.getDate() - 1); return [dkey(d), dkey(d)]; }
    case 'week': { const d = new Date(t); d.setDate(d.getDate() - 6); return [dkey(d), dkey(t)]; }
    case 'month': return [dkey(new Date(y, m, 1)), dkey(t)];
    case 'lmonth': return [dkey(new Date(y, m - 1, 1)), dkey(new Date(y, m, 0))];
    case 'fy': { const fy = m >= 3 ? y : y - 1; return [dkey(new Date(fy, 3, 1)), dkey(t)]; }
  }
}
const RANGES = [['today', 'Today'], ['yest', 'Yesterday'], ['week', '7 days'], ['month', 'This month'], ['lmonth', 'Last month'], ['fy', 'This FY']];
function rangeSeg(el, fromEl, toEl, cb, def = 'today') {
  el.innerHTML = RANGES.map(([v, l]) => `<button data-v="${v}" class="${v === def ? 'on' : ''}">${l}</button>`).join('');
  const apply = v => { const [a, b] = rangeDates(v); fromEl.value = a; toEl.value = b; cb(); };
  segInit(el, apply); apply(def);
  [fromEl, toEl].forEach(x => x.addEventListener('change', () => { el.querySelectorAll('button').forEach(b => b.classList.remove('on')); cb(); }));
}
const billsIn = (from, to, all) => S.bills.filter(b => { const k = b.date.slice(0, 10); return k >= from && k <= to && (all || b.status !== 'cancelled'); });

/* ---------------- money math (all paise) ---------------- */
// Each item may carry its own gstRate (products); otherwise the bill's default `rate` applies.
// The bill discount is shared across lines by value (the biggest line takes the rounding
// remainder), then each line is taxed. Returns per-line figures (`lines`, same order as
// items) and per-rate totals (`taxes`) so mixed-rate bills and HSN summaries are exact.
const itemRate = (i, rate) => (i.gstRate === '' || i.gstRate == null) ? (+rate || 0) : (+i.gstRate || 0);
function calc(items, discType, discVal, mode, rate) {
  const g = items.map(i => toP(i.price) * (+i.qty || 0));
  const gross = g.reduce((s, x) => s + x, 0);
  let discount = discType === 'pct' ? Math.round(gross * Math.min(100, +discVal || 0) / 100) : Math.min(gross, toP(discVal));
  discount = Math.max(0, discount);
  const big = g.indexOf(Math.max(0, ...g));
  const d = g.map((x, k) => k === big ? 0 : (gross ? Math.round(discount * x / gross) : 0));
  if (big >= 0) d[big] = discount - d.reduce((s, x) => s + x, 0);
  let net = 0, taxable = 0, cgst = 0;
  const byRate = {};
  const lines = items.map((it, k) => {
    const n = g[k] - d[k], r = mode === 'none' ? 0 : itemRate(it, rate);
    let c = 0, tx = n;
    if (r > 0 && mode === 'inclusive') {
      // CGST and SGST must be equal: round each half once, and let the taxable value take
      // the odd paisa so taxable + CGST + SGST is still exactly the price paid.
      c = Math.round(n * r / (2 * (100 + r))); tx = n - 2 * c;
    } else if (r > 0 && mode === 'exclusive') c = Math.round(n * r / 200);
    net += n; taxable += tx; cgst += c;
    if (r > 0) { const b = byRate[r] = byRate[r] || {rate: r, taxable: 0, cgst: 0, sgst: 0}; b.taxable += tx; b.cgst += c; b.sgst += c; }
    return {rate: r, taxable: tx, cgst: c, sgst: c};
  });
  const total = mode === 'exclusive' ? net + 2 * cgst : net;
  const grand = Math.round(total / 100) * 100;
  return {gross, discount, taxable, cgst, sgst: cgst, tax: 2 * cgst, total, roundOff: grand - total, grand,
    lines, taxes: Object.values(byRate).sort((a, b) => a.rate - b.rate)};
}
// GST lines of a saved bill; old bills (before per-item rates) have no `taxes`.
const billTaxes = b => b.taxes || (b.gstMode !== 'none' && b.gstRate > 0 ? [{rate: b.gstRate, taxable: b.taxable, cgst: b.cgst, sgst: b.sgst}] : []);
const hasGST = b => b.gstMode !== 'none' && billTaxes(b).length > 0;

/* ---------------- invoice numbers ---------------- */
function fyOf(d) { const y = d.getFullYear(), m = d.getMonth(); const s = m >= 3 ? y : y - 1; return `${pad(s % 100)}-${pad((s + 1) % 100)}`; }
function nextInvoice(date = new Date()) {
  const fy = fyOf(date);
  const seq = S.bills.filter(b => b.fy === fy).reduce((m, b) => Math.max(m, b.seq || 0), 0) + 1;
  const pre = (S.settings.invoicePrefix || 'INV').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  return {fy, seq, no: `${pre}/${fy}/${pad(seq, 4)}`};
}

/* ================= NEW BILL ================= */
let cart = [], group = 'All', cat = 'All', pick = 'svc'; // pick: 'svc' | 'prod' (what the grid shows)
const groups = () => (S.settings.groups && S.settings.groups.length ? S.settings.groups : ['General']);
const activeSvcs = () => S.services.filter(s => s.active !== false);
const activeProds = () => S.products.filter(p => p.active !== false);
const prodRate = p => (p.gstRate === '' || p.gstRate == null) ? '' : +p.gstRate; // '' = bill default
const stockOf = p => +p.stock || 0;
const lowOf = p => (p.low === '' || p.low == null) ? 3 : +p.low;

function renderPick() {
  $('#pickMode').classList.toggle('hidden', !activeProds().length && pick === 'svc');
  $('#pickMode').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === pick));
  $('#svcSearch').placeholder = pick === 'prod'
    ? 'Search product or scan barcode…  (F2)  — Enter adds the first match'
    : 'Search service…  (F2)  — press Enter to add the first match';
}
segInit($('#pickMode'), v => { pick = v; cat = 'All'; $('#svcSearch').value = ''; renderPick(); renderGroupBtns(); renderCats(); renderGrid(); $('#svcSearch').focus(); });

function renderGroupBtns() {
  const g = groups();
  const el = $('#groupBtns');
  if (g.length < 2 || pick === 'prod') { el.classList.add('hidden'); if (g.length < 2) group = 'All'; return; }
  el.classList.remove('hidden');
  if (!['All', ...g].includes(group)) group = 'All';
  el.innerHTML = ['All', ...g].map(x => `<button data-v="${esc(x)}" class="${x === group ? 'on' : ''}">${esc(x)}</button>`).join('');
}
segInit($('#groupBtns'), v => { group = v; cat = 'All'; renderCats(); renderGrid(); });

function svcFiltered() {
  const q = $('#svcSearch').value.trim().toLowerCase();
  if (pick === 'prod') return activeProds().filter(p => q
    ? (p.name + ' ' + (p.brand || '') + ' ' + (p.cat || '') + ' ' + (p.code || '')).toLowerCase().includes(q)
    : (cat === 'All' || (p.cat || 'Products') === cat));
  return activeSvcs().filter(s => (group === 'All' || s.group === group)
    && (q ? (s.name + ' ' + s.cat + ' ' + s.group).toLowerCase().includes(q) : (cat === 'All' || s.cat === cat)));
}
function renderCats() {
  const cats = pick === 'prod' ? [...new Set(activeProds().map(p => p.cat || 'Products'))]
    : [...new Set(activeSvcs().filter(s => group === 'All' || s.group === group).map(s => s.cat))];
  if (!['All', ...cats].includes(cat)) cat = 'All';
  $('#catChips').innerHTML = ['All', ...cats].map(c => `<button data-c="${esc(c)}" class="${c === cat ? 'on' : ''}">${esc(c)}</button>`).join('');
}
$('#catChips').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  cat = b.dataset.c; $('#svcSearch').value = ''; renderCats(); renderGrid();
});
function renderGrid() {
  const list = svcFiltered();
  if (pick === 'prod') {
    $('#svcGrid').innerHTML = list.map(p => { const s = stockOf(p);
      return `<button class="svc prod${s <= 0 ? ' out' : ''}" data-pid="${p.id}">
        <span class="c">${esc([p.brand, p.cat].filter(Boolean).join(' · ') || 'Product')}</span>
        <span class="n">${esc(p.name)}</span>
        <span class="p">${money0(toP(p.price))}<span class="stk${s <= 0 ? ' none' : s <= lowOf(p) ? ' low' : ''}">${s <= 0 ? 'Out of stock' : s + ' in stock'}</span></span></button>`; }).join('')
      || `<div class="empty">No products found. Add them in the <b>Products</b> tab.</div>`;
    return;
  }
  const showG = group === 'All' && groups().length > 1;
  $('#svcGrid').innerHTML = list.map(s => `<button class="svc" data-id="${s.id}">
      ${showG ? `<span class="g">${esc(s.group)}</span>` : ''}
      <span class="n">${esc(s.name)}</span><span class="c">${esc(s.cat)}</span>
      <span class="p">${s.price ? money0(toP(s.price)) : 'Enter price'}${s.max ? ' – ' + money0(toP(s.max)) : ''}</span></button>`).join('')
    || `<div class="empty">No services found. Add them in the <b>Services</b> tab.</div>`;
}
$('#svcGrid').addEventListener('click', e => {
  const b = e.target.closest('.svc'); if (!b) return;
  if (b.dataset.pid) addProduct(S.products.find(p => p.id === b.dataset.pid));
  else addToCart(S.services.find(s => s.id === b.dataset.id));
});
$('#svcSearch').addEventListener('input', renderGrid);
$('#svcSearch').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    // A barcode scanner types the code + Enter: an exact code match adds that product from either view.
    const q = e.target.value.trim().toLowerCase();
    const byCode = q && activeProds().find(p => p.code && String(p.code).toLowerCase() === q);
    if (byCode) { addProduct(byCode); e.target.value = ''; renderGrid(); return; }
    const f = svcFiltered()[0];
    if (f) { pick === 'prod' ? addProduct(f) : addToCart(f); e.target.select(); }
  }
  if (e.key === 'Escape') { e.target.value = ''; renderGrid(); }
});

function addProduct(p) {
  if (!p) return;
  const ex = cart.find(c => c.pid === p.id);
  if (ex) ex.qty++;
  else cart.push({key: uid(), pid: p.id, kind: 'product', name: p.name, group: '', cat: p.cat || 'Products', price: p.price || 0,
    qty: 1, staff: '', hsn: p.hsn || '', gstRate: prodRate(p)});
  const inCart = cart.filter(c => c.pid === p.id).reduce((s, c) => s + c.qty, 0);
  if (inCart > stockOf(p)) toast(`Only ${Math.max(0, stockOf(p))} × ${p.name} in stock`, true);
  renderCart();
  if (!p.price) setTimeout(() => { const i = $$('#cartBody input.pr').pop(); i && (i.focus(), i.select()); }, 30);
}
function addToCart(s) {
  if (!s) return;
  const ex = cart.find(c => c.sid === s.id && !s.max && s.price);
  if (ex) ex.qty++;
  else cart.push({key: uid(), sid: s.id, name: s.name, group: s.group, cat: s.cat, price: s.price || 0, min: s.price, max: s.max || 0, qty: 1, staff: lastStaff || ''});
  renderCart();
  if (!s.price || s.max) setTimeout(() => { const i = $$('#cartBody input.pr').pop(); i && (i.focus(), i.select()); }, 30);
}
let lastStaff = '';
function renderCart() {
  const staff = S.staff.filter(s => s.active !== false);
  $('#cartBody').innerHTML = cart.map(c => `<tr data-k="${c.key}">
    <td><div class="nm">${esc(c.name)}</div><div class="sub">${c.kind === 'product'
      ? esc(['Product', c.hsn && 'HSN ' + c.hsn, c.gstRate !== '' && S.settings.gstMode !== 'none' ? c.gstRate + '% GST' : ''].filter(Boolean).join(' · '))
      : esc([groups().length > 1 ? c.group : '', c.cat].filter(Boolean).join(' · '))}${c.max ? ` · range ${money0(toP(c.min))}–${money0(toP(c.max))}` : ''}</div></td>
    <td>${staff.length ? `<select class="st"><option value="">—</option>${staff.map(s => `<option ${s.name === c.staff ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}<option value="__add">+ Add staff…</option></select>` : '<button class="link addst" title="Add a staff member">+ Add</button>'}</td>
    <td><input class="qt num" type="number" min="1" step="1" value="${c.qty}"></td>
    <td><input class="pr num" type="number" min="0" step="1" value="${c.price}"></td>
    <td class="amt">${fmtN(toP(c.price) * c.qty)}</td>
    <td><button class="x ghost" title="Remove">×</button></td></tr>`).join('');
  $('#cartEmpty').classList.toggle('hidden', cart.length > 0);
  renderTotals();
}
$('#cartBody').addEventListener('input', e => {
  const tr = e.target.closest('tr'); const c = cart.find(x => x.key === tr.dataset.k); if (!c) return;
  if (e.target.classList.contains('qt')) c.qty = Math.max(1, parseInt(e.target.value) || 1);
  if (e.target.classList.contains('pr')) c.price = Math.max(0, +e.target.value || 0);
  tr.querySelector('.amt').textContent = fmtN(toP(c.price) * c.qty);
  renderTotals();
});
$('#cartBody').addEventListener('change', e => {
  if (!e.target.classList.contains('st')) return;
  const c = cart.find(x => x.key === e.target.closest('tr').dataset.k);
  if (e.target.value === '__add') { e.target.value = c.staff || ''; return staffNameBox('', async n => { if (await addStaff(n)) { c.staff = lastStaff = n; renderCart(); } }); }
  c.staff = lastStaff = e.target.value;
});
$('#cartBody').addEventListener('click', e => {
  if (e.target.classList.contains('addst')) {
    const c = cart.find(x => x.key === e.target.closest('tr').dataset.k);
    return staffNameBox('', async n => { if (await addStaff(n)) { c.staff = lastStaff = n; renderCart(); } });
  }
  if (!e.target.classList.contains('x')) return;
  cart = cart.filter(x => x.key !== e.target.closest('tr').dataset.k); renderCart();
});
$('#addCustom').onclick = () => {
  modal(`<h3>Add custom item</h3>
    <label class="f">Item / service name<input id="cuN"></label>
    <label class="f">Price<input id="cuP" type="number" min="0" class="num"></label>
    <div class="row gap"><span class="grow"></span><button class="ghost" id="cuX">Cancel</button><button class="pri" id="cuOk">Add</button></div>`, b => {
    b.querySelector('#cuN').focus();
    b.querySelector('#cuX').onclick = closeModal;
    const ok = () => { const n = b.querySelector('#cuN').value.trim(); if (!n) return;
      cart.push({key: uid(), sid: '', name: n, group: '', cat: 'Other', price: Math.max(0, +b.querySelector('#cuP').value || 0), qty: 1, staff: lastStaff});
      closeModal(); renderCart(); };
    b.querySelector('#cuOk').onclick = ok;
    b.querySelector('#cuP').onkeydown = e => { if (e.key === 'Enter') ok(); }; // braces: returning false would block typing
  });
};

segInit($('#discType'), renderTotals);
$('#discVal').addEventListener('input', renderTotals);
segInit($('#payMode'), v => { $('#splitBox').classList.toggle('hidden', v !== 'Split'); $('#cashBox').classList.toggle('hidden', v !== 'Cash'); });
$('#received').addEventListener('input', renderChange);
function currentCalc() {
  const st = S.settings;
  return calc(cart, segVal($('#discType')), $('#discVal').value, st.gstMode || 'none', st.gstRate);
}
function renderTotals() {
  const st = S.settings, t = currentCalc(), incl = st.gstMode === 'inclusive';
  const lines = [['Subtotal', t.gross]];
  if (t.discount) lines.push(['Discount', -t.discount]);
  if (t.taxes.length) {
    if (incl) lines.push(['Taxable value', t.taxable]);
    for (const x of t.taxes) lines.push([`CGST ${x.rate / 2}%${incl ? ' (incl.)' : ''}`, x.cgst], [`SGST ${x.rate / 2}%${incl ? ' (incl.)' : ''}`, x.sgst]);
  }
  if (t.roundOff) lines.push(['Round off', t.roundOff]);
  $('#totLines').innerHTML = lines.map(([k, v]) => `<div><span>${k}</span><span>${v < 0 ? '−' : ''}${money(Math.abs(v))}</span></div>`).join('');
  $('#grand').textContent = money(t.grand);
  const rates = t.taxes.length ? t.taxes.map(x => x.rate).join(' / ') : (+st.gstRate || 0);
  $('#gstModeLbl').textContent = incl ? `Prices include ${rates}% GST` : st.gstMode === 'exclusive' ? `+${rates}% GST added` : 'No GST';
  renderChange();
}
function renderChange() {
  const rec = toP($('#received').value), g = currentCalc().grand;
  $('#changeLbl').textContent = rec ? (rec >= g ? `Return: ${money(rec - g)}` : `Short: ${money(g - rec)}`) : '';
}

/* customer lookup */
function customers() {
  const m = new Map();
  for (const b of S.bills) {
    if (b.status === 'cancelled') continue;
    const p = normPhone(b.customer?.phone); const key = p || ('n:' + (b.customer?.name || '').toLowerCase().trim());
    if (key === 'n:') continue;
    const c = m.get(key) || {phone: p, name: '', visits: 0, spent: 0, last: '', first: b.date};
    c.visits++; c.spent += b.grand; if (b.date > c.last) { c.last = b.date; c.name = b.customer.name || c.name; }
    if (b.date < c.first) c.first = b.date;
    m.set(key, c);
  }
  return [...m.values()].sort((a, b) => b.last.localeCompare(a.last));
}
$('#cPhone').addEventListener('input', () => {
  const p = normPhone($('#cPhone').value);
  if (p.length < 10) { $('#custInfo').textContent = ''; return; }
  const hist = S.bills.filter(b => b.status !== 'cancelled' && normPhone(b.customer?.phone) === p).sort((a, b) => b.date.localeCompare(a.date));
  if (!hist.length) { $('#custInfo').innerHTML = 'New customer'; return; }
  if (!$('#cName').value) $('#cName').value = hist[0].customer.name || '';
  const spent = hist.reduce((s, b) => s + b.grand, 0);
  $('#custInfo').innerHTML = `Returning customer · <b>${hist.length}</b> visit${hist.length > 1 ? 's' : ''} · spent ${money0(spent)} · last on ${fmtDate(hist[0].date)} (${esc(hist[0].items.map(i => i.name).slice(0, 3).join(', '))})`;
});

function clearBill() {
  cart = []; $('#cPhone').value = ''; $('#cName').value = ''; $('#custInfo').textContent = '';
  $('#discVal').value = ''; $('#received').value = ''; $('#bNotes').value = '';
  ['#spCash', '#spUpi', '#spCard'].forEach(s => $(s).value = '');
  $('#discType').querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === 0));
  $('#payMode').querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === 0));
  $('#splitBox').classList.add('hidden'); $('#cashBox').classList.remove('hidden');
  renderCart(); $('#svcSearch').focus();
}
$('#btnClear').onclick = async () => { if (!cart.length || await confirmBox('Clear this bill?', 'Clear')) clearBill(); };

let saving = false;
async function saveBill(print, wa) {
  if (saving) return;
  if (!cart.length) return toast('Add at least one service or product', true);
  const ph = normPhone($('#cPhone').value);
  if ($('#cPhone').value && ph.length !== 10) return toast('Mobile number should be 10 digits', true);
  if (wa && ph.length !== 10) { $('#cPhone').focus(); return toast('Enter the customer mobile to send on WhatsApp', true); }
  if (cart.some(c => !(+c.price > 0)) && !(await confirmBox('Some items have price ₹0. Save anyway?', 'Save'))) return;
  const t = currentCalc(); const st = S.settings;
  const mode = segVal($('#payMode'));
  let pay = {mode, cash: 0, upi: 0, card: 0};
  if (mode === 'Split') {
    pay.cash = toP($('#spCash').value); pay.upi = toP($('#spUpi').value); pay.card = toP($('#spCard').value);
    if (pay.cash + pay.upi + pay.card !== t.grand) return toast(`Split amounts must add up to ${money(t.grand)}`, true);
  } else pay[mode.toLowerCase()] = t.grand;
  saving = true;
  const now = new Date(); const inv = nextInvoice(now);
  const {lines, ...tot} = t;
  const bill = {
    id: uid(), no: inv.no, fy: inv.fy, seq: inv.seq, date: now.toISOString(),
    customer: {name: $('#cName').value.trim(), phone: ph},
    items: cart.map((c, k) => ({
      ...(c.kind === 'product' ? {pid: c.pid, kind: 'product', hsn: c.hsn || ''} : {sid: c.sid}),
      name: c.name, group: c.group, cat: c.cat, price: toP(c.price), qty: c.qty, staff: c.staff || '',
      gstRate: lines[k].rate, taxable: lines[k].taxable, cgst: lines[k].cgst, sgst: lines[k].sgst})),
    discType: segVal($('#discType')), discVal: +$('#discVal').value || 0,
    ...tot, gstMode: st.gstMode || 'none', gstRate: +st.gstRate || 0,
    pay, received: toP($('#received').value), notes: $('#bNotes').value.trim(), status: 'ok'
  };
  S.bills.push(bill);
  try { await save('bills'); }
  catch (e) { S.bills.pop(); saving = false; return; }
  saving = false;
  if (bill.items.some(i => i.pid)) moveStock(bill, -1);
  toast(`Saved ${bill.no} · ${money(bill.grand)}`);
  if (print) printBill(bill);
  if (wa) whatsapp(bill);
  clearBill();
}
// Stock goes down when a bill is saved (dir -1) and back up when it is cancelled (dir +1).
async function moveStock(bill, dir) {
  let changed = false;
  for (const i of bill.items) {
    const p = i.pid && S.products.find(x => x.id === i.pid);
    if (p) { p.stock = stockOf(p) + dir * (+i.qty || 0); changed = true; }
  }
  if (!changed) return;
  try { await save('products'); } catch (e) { /* toast shown by save() */ }
  if (pick === 'prod') renderGrid();
  const low = dir < 0 && bill.items.map(i => S.products.find(x => x.id === i.pid)).filter(p => p && stockOf(p) <= lowOf(p));
  if (low && low.length) setTimeout(() => toast('Low stock: ' + low.map(p => `${p.name} (${stockOf(p)})`).join(', '), true), 2300);
}
$('#btnSave').onclick = () => saveBill(false);
$('#btnSaveWa').onclick = () => saveBill(false, true);
$('#btnSavePrint').onclick = () => saveBill(true);

/* ================= PRINT ================= */
// Bill totals lines shared by both layouts: [label, paise].
function billTotals(b) {
  const tl = [['Subtotal', b.gross]];
  if (b.discount) tl.push([`Discount${b.discType === 'pct' ? ` (${b.discVal}%)` : ''}`, -b.discount]);
  if (hasGST(b)) {
    tl.push(['Taxable value', b.taxable]);
    for (const x of billTaxes(b)) tl.push([`CGST @ ${x.rate / 2}%`, x.cgst], [`SGST @ ${x.rate / 2}%`, x.sgst]);
  }
  if (b.roundOff) tl.push(['Round off', b.roundOff]);
  return tl;
}
const isProduct = i => i.kind === 'product';
const payText = b => b.pay.mode === 'Split' ? ['cash', 'upi', 'card'].filter(k => b.pay[k]).map(k => `${k.toUpperCase()} ${fmtN(b.pay[k])}`).join(' + ') : b.pay.mode;

// Thermal receipt (80 mm / 58 mm). Used for printing, the on-screen preview and the WhatsApp
// picture. Paper version is pure black (thermal printers can't do grey); image=true swaps the
// black accent for navy and keeps the logo in colour.
function thermalBillHTML(b, size, forPrint, image) {
  const st = S.settings, gst = hasGST(b);
  const ac = image ? '#16306e' : '#000';
  const page = size === '58mm'
    ? '@page{size:58mm auto;margin:1.5mm 2mm}body{width:52mm;font-size:10.5px}'
    : '@page{size:80mm auto;margin:2mm 3mm}body{width:72mm;font-size:12px}';
  const qty = b.items.reduce((s, i) => s + (+i.qty || 0), 0);
  const mixed = billTaxes(b).length > 1, hasSvc = b.items.some(i => !isProduct(i)), hasProd = b.items.some(isProduct);
  const items = b.items.map(i => `<div class="li"><div class="ln"><span>${esc(i.name)}</span><span class="am">${fmtN(i.price * i.qty)}</span></div>
      <div class="sub">${i.qty} × ${fmtN(i.price)}${isProduct(i) && i.hsn ? ` · HSN ${esc(i.hsn)}` : ''}${gst && mixed && i.gstRate ? ` · GST ${i.gstRate}%` : ''}${i.staff ? ` · by ${esc(i.staff)}` : ''}</div></div>`).join('');
  const tl = billTotals(b);
  const totals = tl.length > 1 ? tl.map(([k, v]) => `<div class="kv"><span>${k}</span><span>${v < 0 ? '−' : ''}${fmtN(Math.abs(v))}</span></div>`).join('') : '';
  const change = b.received > b.grand && b.pay.mode === 'Cash'
    ? `<div class="kv"><span>Cash received</span><span>${fmtN(b.received)}</span></div><div class="kv"><span>Change returned</span><span>${fmtN(b.received - b.grand)}</span></div>` : '';
  const kv = (k, v) => `<span class="k">${k}</span><span class="v">${v}</span>`;
  const logo = st.showLogo && st.logo ? `<img class="logo" src="${st.logo}">` : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(b.no)}</title><style>
    ${page}
    *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{margin:0 auto;font-family:"Segoe UI",Arial,sans-serif;color:#000;line-height:1.35}
    ${forPrint ? '' : 'html{background:#e5e7eb}body{background:#fff;padding:12px;margin:10px auto;box-shadow:0 2px 10px rgba(0,0,0,.15);border-radius:4px}'}
    .hd{text-align:center}
    .logo{width:19mm;height:19mm;object-fit:contain;display:block;margin:0 auto 4px;${image ? '' : 'filter:grayscale(1) contrast(1.3)'}}
    .sn{font-size:1.65em;font-weight:800;line-height:1.15;color:${ac}}
    .ad{font-size:.92em;margin-top:3px}.gs{font-size:.92em;font-weight:700;margin-top:2px}
    .tt{background:${ac};color:#fff;text-align:center;font-weight:800;font-size:.95em;letter-spacing:.3em;padding:3px 0 3px .3em;margin:8px 0 6px;border-radius:3px}
    .mt{display:grid;grid-template-columns:auto 1fr;gap:1px 10px}.mt .v{text-align:right;font-weight:600}
    .rule{border-top:1px dashed #000;margin:6px 0}
    .hdr{display:flex;justify-content:space-between;font-size:.8em;font-weight:800;letter-spacing:.1em}
    .li{padding:4px 0;border-bottom:1px dotted #000}.li:last-of-type{border-bottom:0}
    .ln{display:flex;justify-content:space-between;gap:10px;font-weight:700}.am{white-space:nowrap}
    .sub{font-size:.88em;margin-top:1px}
    .cnt{font-size:.85em;text-align:right}
    .kv{display:flex;justify-content:space-between;gap:10px;padding:1px 0}.kv b{text-align:right}
    .gt{display:flex;justify-content:space-between;align-items:center;background:${ac};color:#fff;font-weight:800;padding:5px 8px;margin:7px 0;border-radius:4px}
    .gt .a{font-size:1.55em;letter-spacing:.01em}
    .save{text-align:center;font-weight:700;color:${ac};border:1.5px solid ${ac};border-radius:4px;padding:3px;margin:7px 0 2px}
    .nt{margin-top:4px;font-size:.92em}
    .ft{text-align:center;font-weight:600;white-space:pre-line}
    .cx{border:3px solid #000;text-align:center;font-weight:800;font-size:1.4em;margin:0 0 8px;padding:4px;letter-spacing:.1em}
  </style></head><body>
    ${b.status === 'cancelled' ? '<div class="cx">CANCELLED</div>' : ''}
    <div class="hd">${logo}<div class="sn">${esc(st.shopName)}</div>
      ${st.address ? `<div class="ad">${esc(st.address).replace(/\n/g, '<br>')}</div>` : ''}
      ${st.phone ? `<div class="ad">Ph: ${esc(st.phone)}</div>` : ''}
      ${st.gstin ? `<div class="gs">GSTIN: ${esc(st.gstin)}</div>` : ''}</div>
    <div class="tt">${gst ? 'TAX INVOICE' : 'BILL'}</div>
    <div class="mt">${kv('Bill No', esc(b.no))}${kv('Date', `${fmtDate(b.date)}, ${fmtTime(b.date)}`)}
      ${b.customer.name ? kv('Customer', esc(b.customer.name)) : ''}${b.customer.phone ? kv('Mobile', esc(b.customer.phone)) : ''}</div>
    <div class="rule"></div>
    <div class="hdr"><span>ITEM</span><span>AMOUNT</span></div>
    ${items}
    <div class="cnt">${b.items.length} item${b.items.length === 1 ? '' : 's'} · Qty ${qty}</div>
    <div class="rule"></div>
    ${totals}
    <div class="gt"><span>TOTAL</span><span class="a">${cur()}${fmtN(b.grand)}</span></div>
    <div class="kv"><span>Paid via</span><b>${esc(payText(b))}</b></div>${change}
    ${gst && st.sac && hasSvc ? `<div class="kv"><span>SAC code${hasProd ? ' (services)' : ''}</span><span>${esc(st.sac)}</span></div>` : ''}
    ${b.discount ? `<div class="save">You saved ${cur()}${fmtN(b.discount)} today!</div>` : ''}
    ${b.notes ? `<div class="nt">Note: ${esc(b.notes)}</div>` : ''}
    ${st.footer ? `<div class="rule"></div><div class="ft">${esc(st.footer)}</div>` : ''}
  </body></html>`;
}

function billHTML(b, forPrint = true, sizeOverride = '', image = false) {
  const st = S.settings, size = sizeOverride || st.billSize || '80mm';
  if (size.endsWith('mm')) return thermalBillHTML(b, size, forPrint, image);
  // A5 / A4 invoice
  const gst = hasGST(b), mixed = billTaxes(b).length > 1;
  const title = gst ? 'TAX INVOICE' : 'BILL';
  const itemRows = b.items.map((i, n) =>
    `<tr><td>${n + 1}</td><td>${esc(i.name)}${i.staff ? `<div class="stf">by ${esc(i.staff)}</div>` : ''}${gst && mixed && i.gstRate ? `<div class="stf">GST ${i.gstRate}%</div>` : ''}</td><td class="c">${esc(isProduct(i) ? (i.hsn || '') : (st.sac || ''))}</td><td class="r">${i.qty}</td><td class="r">${fmtN(i.price)}</td><td class="r">${fmtN(i.price * i.qty)}</td></tr>`).join('');
  const totRows = billTotals(b).map(([k, v]) => `<tr><td colspan="5" class="r">${k}</td><td class="r">${v < 0 ? '-' : ''}${fmtN(Math.abs(v))}</td></tr>`).join('');
  const payTxt = payText(b);
  const css = {
    'A5': '@page{size:A5;margin:9mm}body{font-size:11.5px}',
    'A4': '@page{size:A4;margin:12mm}body{font-size:12.5px}'
  }[size] || '@page{size:A4;margin:12mm}body{font-size:12.5px}';
  const logo = st.showLogo && st.logo ? `<img class="logo" src="${st.logo}">` : '';
  const head =
      `<div class="hdA">${logo}<div class="hdT"><div class="sn">${esc(st.shopName)}</div>
         ${st.legalName ? `<div class="muted">Prop: ${esc(st.legalName)}</div>` : ''}
         ${st.address ? `<div>${esc(st.address).replace(/\n/g, '<br>')}</div>` : ''}
         <div>${[st.phone && 'Ph: ' + esc(st.phone), st.email && esc(st.email)].filter(Boolean).join(' · ')}</div>
         ${st.gstin ? `<div><b>GSTIN: ${esc(st.gstin)}</b>${st.stateName ? ` · State: ${esc(st.stateName)}${st.stateCode ? ' (' + esc(st.stateCode) + ')' : ''}` : ''}</div>` : ''}</div>
         <div class="ttA">${title}</div></div>
       <table class="metaA"><tr>
         <td><div class="lbl">Billed to</div><b>${esc(b.customer.name || 'Walk-in customer')}</b>${b.customer.phone ? `<br>${esc(b.customer.phone)}` : ''}</td>
         <td class="r"><div class="lbl">Invoice No</div><b>${esc(b.no)}</b><br>${fmtDate(b.date)} ${fmtTime(b.date)}${gst && st.stateName ? `<br>Place of supply: ${esc(st.stateName)}` : ''}</td></tr></table>`;
  const table =
      `<table class="itA"><thead><tr><th>#</th><th>Item</th><th class="c">HSN/SAC</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>${itemRows}</tbody>
         <tfoot>${totRows}<tr class="gt"><td colspan="5" class="r">TOTAL</td><td class="r">${cur()}${fmtN(b.grand)}</td></tr></tfoot></table>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(b.no)}</title><style>
    ${css}
    *{box-sizing:border-box}body{margin:0 auto;font-family:"Segoe UI",Arial,sans-serif;color:#000;line-height:1.3}
    ${forPrint ? '' : 'html{background:#e5e7eb}body{background:#fff;margin:10px auto;box-shadow:0 2px 8px rgba(0,0,0,.15);width:190mm;padding:12mm}'}
    table{width:100%;border-collapse:collapse}.r{text-align:right}.c{text-align:center}
    .sn{font-size:1.45em;font-weight:800;margin:2px 0}
    .gt td{font-weight:800;font-size:1.25em;border-top:1px solid #000;border-bottom:1px solid #000;padding:3px 0!important}
    .hdA{display:flex;gap:14px;align-items:flex-start;border-bottom:2px solid #000;padding-bottom:8px}
    .hdA .logo{width:24mm;height:24mm;object-fit:contain}.hdT{flex:1}.ttA{font-weight:800;font-size:1.3em;letter-spacing:.08em}
    .muted{color:#444}.lbl{font-size:.8em;color:#555;text-transform:uppercase;letter-spacing:.05em}
    .metaA{margin:8px 0}.metaA td{vertical-align:top;padding:4px 0}
    .itA th{background:#eee;border-top:1px solid #000;border-bottom:1px solid #000;padding:5px 6px;text-align:left}.itA th.r{text-align:right}.itA th.c{text-align:center}
    .itA td{padding:5px 6px;border-bottom:1px solid #ddd;vertical-align:top}.itA .stf{font-size:.85em;color:#555}
    .itA tfoot td{border-bottom:0;padding:3px 6px}
    .ftA{margin-top:14px;display:flex;justify-content:space-between;align-items:flex-end}
    .sign{text-align:center;border-top:1px solid #000;padding-top:3px;min-width:45mm;margin-top:30px}
    ${b.status === 'cancelled' ? '.cx{border:3px solid #000;text-align:center;font-weight:800;font-size:1.4em;margin:6px 0;padding:4px}' : ''}
  </style></head><body>
    ${b.status === 'cancelled' ? '<div class="cx">CANCELLED</div>' : ''}
    ${head}${table}
    <div class="ftA"><div>Payment: <b>${esc(payTxt)}</b>${b.notes ? `<br>Note: ${esc(b.notes)}` : ''}<br><br>${esc(st.footer || '')}</div>
      <div class="sign">For ${esc(st.shopName)}</div></div>
  </body></html>`;
}
function printBill(b) {
  const f = $('#printFrame');
  f.onload = () => { setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast('Print failed: ' + e.message, true); } }, 150); f.onload = null; };
  f.srcdoc = billHTML(b, true);
}
function previewBill(b) {
  modal(`<div class="row center gap"><h3 class="grow">${esc(b.no)} ${b.status === 'cancelled' ? '<span class="pill bad">Cancelled</span>' : ''}</h3><button class="ghost" id="pvX">Close</button></div>
    <iframe id="pvF"></iframe>
    <div class="row gap wrap">
      ${b.status !== 'cancelled' ? '<button class="ghost danger" id="pvC">Cancel bill</button>' : ''}
      <span class="grow"></span>
      ${b.customer.phone ? '<button class="sec" id="pvW">Send on WhatsApp</button>' : ''}
      <button class="pri" id="pvP">Print</button></div>`, m => {
    m.querySelector('#pvF').srcdoc = billHTML(b, false);
    m.querySelector('#pvX').onclick = closeModal;
    m.querySelector('#pvP').onclick = () => printBill(b);
    m.querySelector('#pvW') && (m.querySelector('#pvW').onclick = () => whatsapp(b));
    m.querySelector('#pvC') && (m.querySelector('#pvC').onclick = async () => {
      if (!(await confirmBox(`Cancel bill <b>${esc(b.no)}</b> (${money(b.grand)})? It stays in records marked as cancelled and is not counted in sales.`, 'Cancel bill'))) return;
      b.status = 'cancelled'; b.cancelledAt = new Date().toISOString(); await save('bills'); await moveStock(b, +1); toast('Bill cancelled'); renderBills();
    });
  });
}
function waText(b) {
  const st = S.settings;
  return [`*${st.shopName}*`, `Bill: ${b.no}`, `Date: ${fmtDate(b.date)}`, '',
    ...b.items.map(i => `${i.name}${i.qty > 1 ? ' x' + i.qty : ''} - ${cur()}${fmtN(i.price * i.qty)}`), '',
    b.discount ? `Discount: -${cur()}${fmtN(b.discount)}` : '', b.tax ? `GST: ${cur()}${fmtN(b.tax)}${b.gstMode === 'inclusive' ? ' (included)' : ''}` : '',
    `*Total: ${cur()}${fmtN(b.grand)}*`, `Paid: ${b.pay.mode}`, '', st.footer || ''].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}
function waShort(b) {
  const st = S.settings, name = (b.customer?.name || '').trim();
  return `Hi${name ? ' ' + name : ''}, thank you for visiting *${st.shopName}*! Your bill ${b.no} for *${cur()}${fmtN(b.grand)}*.`;
}

// Draws the 80 mm thermal receipt (same HTML as the printout) as a PNG, for WhatsApp.
// Renders the HTML inside an SVG <foreignObject>; the logo is a data: URL so nothing is external.
async function receiptPNG(b) {
  const W = 300, SCALE = 3; // 300 css px wide (72 mm + padding), drawn at 3x for sharp phone screens
  const extra = `body{width:${W}px!important;margin:0!important;padding:18px 16px!important;background:#fff!important;box-shadow:none!important;border-radius:0!important}`;
  const html = billHTML(b, true, '80mm', true).replace(/@page\{[^}]*\}/g, '').replace('</style>', extra + '</style>');
  // 1) measure the receipt height in an off-screen frame
  const f = document.createElement('iframe');
  f.style.cssText = `position:fixed;left:-10000px;top:0;width:${W}px;height:100px;border:0;visibility:hidden`;
  document.body.appendChild(f);
  try {
    await new Promise((ok, bad) => { f.onload = ok; f.onerror = bad; f.srcdoc = html; });
    const d = f.contentDocument;
    const H = Math.ceil(d.documentElement.scrollHeight);
    // 2) serialise as XHTML (keeps the <style>) and paint it onto a canvas
    const xml = new XMLSerializer().serializeToString(d.documentElement);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject width="100%" height="100%">${xml}</foreignObject></svg>`;
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await img.decode();
    const c = document.createElement('canvas');
    c.width = W * SCALE; c.height = H * SCALE;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.scale(SCALE, SCALE); g.drawImage(img, 0, 0, W, H);
    return await new Promise((ok, bad) => c.toBlob(bl => bl ? ok(bl) : bad(new Error('image failed')), 'image/png'));
  } finally { f.remove(); }
}

// Copies the receipt picture to the clipboard and opens the customer's WhatsApp chat.
// Staff press Ctrl+V (paste the receipt) and Enter. If the picture can't be made, the
// receipt is sent as text instead. In Billora's own window WhatsApp Desktop opens directly.
async function whatsapp(b) {
  const phone = normPhone(b.customer?.phone);
  if (phone.length !== 10) return toast('Enter the 10-digit customer mobile to send on WhatsApp', true);
  let copied = false;
  try {
    // Pass the promise straight to ClipboardItem so the click still counts while the image renders.
    await navigator.clipboard.write([new ClipboardItem({'image/png': receiptPNG(b)})]);
    copied = true;
  } catch (e) { console.warn('receipt image', e); }
  const text = copied ? waShort(b) : waText(b);
  if (NATIVE) toNative('wa:' + phone + '\n' + text);
  else window.open('https://wa.me/91' + phone + '?text=' + encodeURIComponent(text), '_blank');
  toast(copied ? 'Receipt copied. In WhatsApp press Ctrl+V, then Enter' : 'Could not make the receipt picture, so it was sent as text', !copied);
}

/* ================= BILLS TAB ================= */
function renderBills() {
  const q = $('#bSearch').value.trim().toLowerCase();
  const list = billsIn($('#bFrom').value, $('#bTo').value, true)
    .filter(b => !q || (b.no + ' ' + b.customer.name + ' ' + b.customer.phone).toLowerCase().includes(q))
    .sort((a, b) => b.date.localeCompare(a.date));
  const ok = list.filter(b => b.status !== 'cancelled');
  const sum = k => ok.reduce((s, b) => s + (b[k] || 0), 0);
  $('#billsSummary').innerHTML = [['Bills', ok.length], ['Sales', money(sum('grand'))], ['GST', money(sum('tax'))], ['Discounts', money(sum('discount'))]]
    .map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  $('#billsTable').innerHTML = `<thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Mobile</th><th>Items</th><th>Payment</th><th class="r">Total</th><th></th></tr></thead><tbody>` +
    (list.map(b => `<tr class="${b.status === 'cancelled' ? 'cancel' : ''}" data-id="${b.id}">
      <td><b>${esc(b.no)}</b></td><td>${fmtDate(b.date)} <span class="muted small">${fmtTime(b.date)}</span></td>
      <td>${esc(b.customer.name) || '<span class="muted">—</span>'}</td><td>${esc(b.customer.phone)}</td>
      <td class="small">${esc(b.items.map(i => i.name).join(', ')).slice(0, 70)}</td><td>${esc(b.pay.mode)}</td>
      <td class="r"><b>${money(b.grand)}</b></td>
      <td class="act"><button class="sec" data-a="view">View</button> <button class="sec" data-a="print">Print</button></td></tr>`).join('')
      || '<tr><td colspan="8" class="empty">No bills in this period</td></tr>') + '</tbody>';
}
$('#billsTable').addEventListener('click', e => {
  const btn = e.target.closest('button'); const tr = e.target.closest('tr[data-id]'); if (!tr) return;
  const b = S.bills.find(x => x.id === tr.dataset.id);
  if (btn?.dataset.a === 'print') printBill(b); else previewBill(b);
});
$('#bSearch').addEventListener('input', renderBills);
$('#bExport').onclick = () => {
  const list = billsIn($('#bFrom').value, $('#bTo').value, true).sort((a, b) => a.date.localeCompare(b.date));
  download(`bills_${$('#bFrom').value}_to_${$('#bTo').value}.csv`, toCSV([
    ['Invoice No', 'Date', 'Time', 'Customer', 'Mobile', 'Services', 'Staff', 'Subtotal', 'Discount', 'Taxable', 'CGST', 'SGST', 'Round off', 'Total', 'Payment', 'Cash', 'UPI', 'Card', 'Status', 'Note'],
    ...list.map(b => [b.no, fmtDate(b.date), fmtTime(b.date), b.customer.name, b.customer.phone, b.items.map(i => i.name + (i.qty > 1 ? ' x' + i.qty : '')).join('; '),
      [...new Set(b.items.map(i => i.staff).filter(Boolean))].join('; '),
      fmtN(b.gross), fmtN(b.discount), fmtN(b.taxable), fmtN(b.cgst), fmtN(b.sgst), fmtN(b.roundOff), fmtN(b.grand), b.pay.mode,
      fmtN(b.pay.cash), fmtN(b.pay.upi), fmtN(b.pay.card), b.status === 'cancelled' ? 'Cancelled' : 'OK', b.notes].map(v => String(v).replace(/,(?=\d{3})/g, '')))
  ]), 'text/csv');
};

/* ================= CUSTOMERS ================= */
function renderCustomers() {
  const q = $('#custSearch').value.trim().toLowerCase();
  const list = customers().filter(c => !q || (c.name + ' ' + c.phone).toLowerCase().includes(q));
  $('#custTable').innerHTML = `<thead><tr><th>Name</th><th>Mobile</th><th class="r">Visits</th><th class="r">Total spent</th><th>First visit</th><th>Last visit</th><th></th></tr></thead><tbody>` +
    (list.slice(0, 1000).map(c => `<tr><td><b>${esc(c.name) || '—'}</b></td><td>${esc(c.phone)}</td><td class="r">${c.visits}</td><td class="r">${money0(c.spent)}</td>
      <td>${fmtDate(c.first)}</td><td>${fmtDate(c.last)}</td>
      <td class="act">${c.phone ? `<button class="sec" data-p="${c.phone}">Bills</button>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="7" class="empty">Customers appear here after you save bills with a name or mobile number</td></tr>') + '</tbody>';
}
$('#custSearch').addEventListener('input', renderCustomers);
$('#custTable').addEventListener('click', e => {
  const p = e.target.closest('button')?.dataset.p; if (!p) return;
  switchTab('bills'); $('#bFrom').value = '2000-01-01'; $('#bTo').value = dkey(new Date());
  $('#billsRange').querySelectorAll('button').forEach(b => b.classList.remove('on')); $('#bSearch').value = p; renderBills();
});
$('#custExport').onclick = () => download('customers.csv', toCSV([['Name', 'Mobile', 'Visits', 'Total spent', 'First visit', 'Last visit'],
  ...customers().map(c => [c.name, c.phone, c.visits, (c.spent / 100).toFixed(2), fmtDate(c.first), fmtDate(c.last)])]), 'text/csv');

/* ================= REPORTS ================= */
// GST split of one bill line. New bills store it per line; older bills are recomputed the same way.
function itemTax(b, i) {
  if (i.taxable != null) return {rate: +i.gstRate || 0, taxable: i.taxable, cgst: i.cgst || 0, sgst: i.sgst || 0};
  const factor = b.gross ? (b.gross - b.discount) / b.gross : 1, n = Math.round(i.price * i.qty * factor);
  const r = b.gstMode === 'none' ? 0 : (+b.gstRate || 0); let c = 0, tx = n;
  if (r && b.gstMode === 'inclusive') { c = Math.round(n * r / (2 * (100 + r))); tx = n - 2 * c; }
  else if (r && b.gstMode === 'exclusive') c = Math.round(n * r / 200);
  return {rate: r, taxable: tx, cgst: c, sgst: c};
}
function repData() {
  const from = $('#rFrom').value, to = $('#rTo').value, list = billsIn(from, to);
  const sum = k => list.reduce((s, b) => s + (b[k] || 0), 0);
  const pay = {Cash: 0, UPI: 0, Card: 0};
  list.forEach(b => { pay.Cash += b.pay.cash || 0; pay.UPI += b.pay.upi || 0; pay.Card += b.pay.card || 0; });
  const staff = {}, svc = {}, prod = {}, catm = {}, days = {}, hsn = {}, rates = {};
  let svcSales = 0, prodSales = 0, prodQty = 0;
  for (const b of list) {
    for (const i of b.items) {
      const x = itemTax(b, i), amt = x.taxable + x.cgst + x.sgst; // after discount, with GST
      const sk = i.staff || '(not set)';
      staff[sk] = staff[sk] || {n: 0, amt: 0}; staff[sk].n += i.qty; staff[sk].amt += amt;
      if (isProduct(i)) {
        prod[i.name] = prod[i.name] || {n: 0, amt: 0}; prod[i.name].n += i.qty; prod[i.name].amt += amt;
        prodSales += amt; prodQty += i.qty;
      } else {
        const vk = (i.group ? i.group + ' · ' : '') + i.name;
        svc[vk] = svc[vk] || {n: 0, amt: 0}; svc[vk].n += i.qty; svc[vk].amt += amt; svcSales += amt;
      }
      const ck = i.cat || 'Other'; catm[ck] = (catm[ck] || 0) + amt;
      const code = isProduct(i) ? (i.hsn || 'No HSN') : (S.settings.sac || 'SAC'), hk = code + '|' + x.rate;
      const h = hsn[hk] = hsn[hk] || {code, kind: isProduct(i) ? 'Goods' : 'Services', rate: x.rate, qty: 0, taxable: 0, cgst: 0, sgst: 0};
      h.qty += i.qty; h.taxable += x.taxable; h.cgst += x.cgst; h.sgst += x.sgst;
    }
    for (const t of billTaxes(b)) {
      const r = rates[t.rate] = rates[t.rate] || {taxable: 0, cgst: 0, sgst: 0};
      r.taxable += t.taxable; r.cgst += t.cgst; r.sgst += t.sgst;
    }
    const d = b.date.slice(0, 10); days[d] = days[d] || {n: 0, amt: 0, tax: 0}; days[d].n++; days[d].amt += b.grand; days[d].tax += b.tax;
  }
  const stockAlerts = activeProds().filter(p => stockOf(p) <= lowOf(p)).sort((a, b) => stockOf(a) - stockOf(b));
  return {from, to, list, count: list.length, grand: sum('grand'), tax: sum('tax'), cgst: sum('cgst'), sgst: sum('sgst'), taxable: sum('taxable'),
    discount: sum('discount'), gross: sum('gross'), pay, staff, svc, prod, catm, days, hsn, rates, svcSales, prodSales, prodQty, stockAlerts,
    cancelled: billsIn(from, to, true).filter(b => b.status === 'cancelled').length};
}
function barRows(obj, valFn, labelFn, limit = 15) {
  const arr = Object.entries(obj).sort((a, b) => valFn(b[1]) - valFn(a[1])).slice(0, limit);
  const max = Math.max(1, ...arr.map(a => valFn(a[1])));
  return arr.map(([k, v]) => `<tr><td>${esc(k)}<div class="bar"><i style="width:${(valFn(v) / max * 100).toFixed(1)}%"></i></div></td><td class="r">${labelFn(v)}</td></tr>`).join('')
    || '<tr><td class="empty">No data</td></tr>';
}
function renderReports() {
  const d = repData();
  const stat = (k, v) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  const hasProducts = S.products.length > 0 || d.prodQty > 0;
  const rateRows = Object.entries(d.rates).sort((a, b) => a[0] - b[0]).map(([r, v]) =>
    `<tr><td>GST ${r}% <span class="muted small">(CGST ${r / 2}% + SGST ${r / 2}%)</span></td><td class="r">${money(v.taxable)}</td><td class="r">${money(v.cgst + v.sgst)}</td></tr>`).join('');
  const hsnRows = Object.values(d.hsn).sort((a, b) => a.kind.localeCompare(b.kind) || a.code.localeCompare(b.code) || a.rate - b.rate).map(h =>
    `<tr><td><b>${esc(h.code)}</b> <span class="muted small">${h.kind}</span></td><td class="r">${h.rate}%</td><td class="r">${h.qty}</td><td class="r">${money(h.taxable)}</td><td class="r">${money(h.cgst)}</td><td class="r">${money(h.sgst)}</td></tr>`).join('');
  $('#repBody').innerHTML = `<div class="summary">${stat('Total sales', money(d.grand))}${stat('Bills', d.count)}${stat('Average bill', money(d.count ? Math.round(d.grand / d.count) : 0))}
      ${hasProducts ? stat('Services sales', money(d.svcSales)) + stat('Product sales', `${money(d.prodSales)} <span class="muted small">(${d.prodQty} sold)</span>`) : ''}
      ${stat('GST collected', money(d.tax))}${stat('Discounts given', money(d.discount))}${d.cancelled ? stat('Cancelled bills', d.cancelled) : ''}</div>
    <div class="rep-grid">
      <div class="card"><h3>Payment modes</h3><table class="list">${barRows(d.pay, v => v, v => money(v))}</table></div>
      <div class="card"><h3>GST summary</h3><table class="list">
        ${rateRows ? `<tr><th>Rate</th><th class="r">Taxable value</th><th class="r">GST</th></tr>${rateRows}` : ''}
        <tr><td>Taxable value</td><td class="r" colspan="2">${money(d.taxable)}</td></tr>
        <tr><td>CGST</td><td class="r" colspan="2">${money(d.cgst)}</td></tr><tr><td>SGST</td><td class="r" colspan="2">${money(d.sgst)}</td></tr>
        <tr><td><b>Total GST</b></td><td class="r" colspan="2"><b>${money(d.tax)}</b></td></tr>
        <tr><td>Invoice value (incl. GST)</td><td class="r" colspan="2">${money(d.grand)}</td></tr></table></div>
      <div class="card"><h3>Staff performance</h3><table class="list">${barRows(d.staff, v => v.amt, v => `${v.n} items · ${money0(v.amt)}`)}</table>
        <p class="muted small">Amounts are after discount and include GST.</p></div>
      <div class="card"><h3>Top services</h3><table class="list">${barRows(d.svc, v => v.amt, v => `${v.n} × · ${money0(v.amt)}`)}</table></div>
      ${hasProducts ? `<div class="card"><h3>Product sales</h3><table class="list">${barRows(d.prod, v => v.amt, v => `${v.n} sold · ${money0(v.amt)}`, 30)}</table></div>
      <div class="card"><h3>Stock alerts</h3><table class="list">${d.stockAlerts.map(p => `<tr><td>${esc(p.name)}${p.brand ? ` <span class="muted small">${esc(p.brand)}</span>` : ''}</td>
        <td class="r">${stockOf(p) <= 0 ? '<span class="pill bad">Out of stock</span>' : `<span class="pill warn">${stockOf(p)} left</span>`}</td></tr>`).join('')
        || '<tr><td class="empty">All products are in stock</td></tr>'}</table></div>` : ''}
      <div class="card"><h3>By category</h3><table class="list">${barRows(d.catm, v => v, v => money0(v), 30)}</table></div>
      <div class="card"><h3>HSN / SAC summary <span class="muted small">(for GSTR-1)</span></h3><table class="list">
        <tr><th>Code</th><th class="r">Rate</th><th class="r">Qty</th><th class="r">Taxable</th><th class="r">CGST</th><th class="r">SGST</th></tr>
        ${hsnRows || '<tr><td class="empty" colspan="6">No data</td></tr>'}</table></div>
      <div class="card"><h3>Day by day</h3><table class="list"><tr><th>Date</th><th class="r">Bills</th><th class="r">GST</th><th class="r">Sales</th></tr>
        ${Object.entries(d.days).sort().reverse().map(([k, v]) => `<tr><td>${fmtDate(k)}</td><td class="r">${v.n}</td><td class="r">${money0(v.tax)}</td><td class="r"><b>${money0(v.amt)}</b></td></tr>`).join('') || '<tr><td class="empty" colspan="4">No data</td></tr>'}</table></div>
    </div>`;
}
const r2 = p => (p / 100).toFixed(2);
// One row per invoice per GST rate (a bill with 5% services and an 18% product gives two rows).
$('#rExport').onclick = () => {
  const d = repData(), pos = (S.settings.stateCode ? S.settings.stateCode + '-' : '') + (S.settings.stateName || '');
  const rows = [];
  for (const b of d.list.sort((a, b) => a.date.localeCompare(b.date))) {
    const taxes = billTaxes(b).length ? billTaxes(b) : [{rate: 0, taxable: b.taxable, cgst: 0, sgst: 0}];
    const exempt = b.taxable - taxes.reduce((s, t) => s + t.taxable, 0); // lines at 0% inside a GST bill
    if (exempt && billTaxes(b).length) taxes.push({rate: 0, taxable: exempt, cgst: 0, sgst: 0});
    taxes.forEach((t, k) => rows.push([b.no, fmtDate(b.date), b.customer.name, b.customer.phone, pos, t.rate,
      r2(t.taxable), r2(t.cgst), r2(t.sgst), r2(t.cgst + t.sgst), k ? '' : r2(b.roundOff), k ? '' : r2(b.grand)]));
  }
  download(`gst_sales_${d.from}_to_${d.to}.csv`, toCSV([
    ['Invoice No', 'Invoice Date', 'Customer', 'Mobile', 'Place of Supply', 'GST Rate %', 'Taxable Value', 'CGST', 'SGST', 'Total GST', 'Round off', 'Invoice Value'],
    ...rows, [], ['TOTAL', '', '', '', '', '', r2(d.taxable), r2(d.cgst), r2(d.sgst), r2(d.tax), '', r2(d.grand)]
  ]), 'text/csv');
};
$('#rHsn').onclick = () => {
  const d = repData();
  download(`hsn_summary_${d.from}_to_${d.to}.csv`, toCSV([
    ['HSN/SAC', 'Type', 'GST Rate %', 'Quantity', 'Taxable Value', 'CGST', 'SGST', 'Total Value'],
    ...Object.values(d.hsn).map(h => [h.code, h.kind, h.rate, h.qty, r2(h.taxable), r2(h.cgst), r2(h.sgst), r2(h.taxable + h.cgst + h.sgst)])
  ]), 'text/csv');
};
$('#rPrint').onclick = () => {
  const d = repData(); const st = S.settings;
  const f = $('#printFrame');
  f.onload = () => { setTimeout(() => f.contentWindow.print(), 150); f.onload = null; };
  f.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:12mm}body{font:12px "Segoe UI",Arial}h1{font-size:18px;margin:0}
    table{width:100%;border-collapse:collapse;margin:8px 0 14px}td,th{border-bottom:1px solid #ddd;padding:4px 6px;text-align:left}.r{text-align:right}h2{font-size:14px;margin:12px 0 0}</style></head><body>
    <h1>${esc(st.shopName)} — Sales report</h1><div>${fmtDate(d.from)} to ${fmtDate(d.to)} · printed ${fmtDate(new Date().toISOString())}</div>
    <h2>Summary</h2><table><tr><td>Bills</td><td class="r">${d.count}</td></tr><tr><td>Total sales</td><td class="r">${money(d.grand)}</td></tr>
    <tr><td>Discounts</td><td class="r">${money(d.discount)}</td></tr><tr><td>Taxable value</td><td class="r">${money(d.taxable)}</td></tr>
    <tr><td>CGST</td><td class="r">${money(d.cgst)}</td></tr><tr><td>SGST</td><td class="r">${money(d.sgst)}</td></tr>
    ${Object.entries(d.pay).map(([k, v]) => `<tr><td>${k}</td><td class="r">${money(v)}</td></tr>`).join('')}</table>
    ${d.prodQty ? `<h2>Services &amp; products</h2><table><tr><td>Services sales</td><td class="r">${money(d.svcSales)}</td></tr><tr><td>Product sales (${d.prodQty} sold)</td><td class="r">${money(d.prodSales)}</td></tr></table>
    <h2>Product sales</h2><table><tr><th>Product</th><th class="r">Qty sold</th><th class="r">Amount</th></tr>${Object.entries(d.prod).sort((a, b) => b[1].amt - a[1].amt).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${v.n}</td><td class="r">${money(v.amt)}</td></tr>`).join('')}</table>` : ''}
    <h2>HSN / SAC summary</h2><table><tr><th>Code</th><th>Type</th><th class="r">Rate</th><th class="r">Qty</th><th class="r">Taxable</th><th class="r">CGST</th><th class="r">SGST</th></tr>${Object.values(d.hsn).map(h => `<tr><td>${esc(h.code)}</td><td>${h.kind}</td><td class="r">${h.rate}%</td><td class="r">${h.qty}</td><td class="r">${money(h.taxable)}</td><td class="r">${money(h.cgst)}</td><td class="r">${money(h.sgst)}</td></tr>`).join('')}</table>
    <h2>Staff</h2><table>${Object.entries(d.staff).sort((a, b) => b[1].amt - a[1].amt).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${v.n}</td><td class="r">${money(v.amt)}</td></tr>`).join('')}</table>
    <h2>Day by day</h2><table><tr><th>Date</th><th class="r">Bills</th><th class="r">GST</th><th class="r">Sales</th></tr>${Object.entries(d.days).sort().map(([k, v]) => `<tr><td>${fmtDate(k)}</td><td class="r">${v.n}</td><td class="r">${money(v.tax)}</td><td class="r">${money(v.amt)}</td></tr>`).join('')}</table>
    </body></html>`;
};

/* ================= SERVICES TAB ================= */
let svcGroupF = 'All';
function renderSvcAdmin() {
  const g = groups();
  $('#svcGroupFilter').innerHTML = (g.length > 1 ? ['All', ...g] : ['All']).map(x => `<button data-v="${esc(x)}" class="${x === svcGroupF ? 'on' : ''}">${esc(x)}</button>`).join('');
  const q = $('#svcAdminSearch').value.trim().toLowerCase();
  const list = S.services.filter(s => (svcGroupF === 'All' || s.group === svcGroupF) && (!q || (s.name + ' ' + s.cat).toLowerCase().includes(q)));
  let html = `<thead><tr>${g.length > 1 ? '<th>Group</th>' : ''}<th>Category</th><th>Service</th><th class="r">Price</th><th class="r">Max price</th><th>Status</th><th></th></tr></thead><tbody>`;
  html += list.map(s => `<tr data-id="${s.id}">${g.length > 1 ? `<td>${esc(s.group)}</td>` : ''}<td>${esc(s.cat)}</td><td><b>${esc(s.name)}</b></td>
    <td class="r">${s.price ? money0(toP(s.price)) : '<span class="muted">ask</span>'}</td><td class="r">${s.max ? money0(toP(s.max)) : ''}</td>
    <td>${s.active === false ? '<span class="pill off">Hidden</span>' : '<span class="pill">Active</span>'}</td>
    <td class="act"><button class="sec" data-a="edit">Edit</button> <button class="ghost danger" data-a="del">Delete</button></td></tr>`).join('')
    || `<tr><td colspan="7" class="empty">No services yet. Click “+ Add service”.</td></tr>`;
  $('#svcTable').innerHTML = html + '</tbody>';
}
segInit($('#svcGroupFilter'), v => { svcGroupF = v; renderSvcAdmin(); });
$('#svcAdminSearch').addEventListener('input', renderSvcAdmin);
$('#svcTable').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  const s = S.services.find(x => x.id === b.closest('tr').dataset.id);
  if (b.dataset.a === 'edit') editService(s);
  if (b.dataset.a === 'del' && await confirmBox(`Delete <b>${esc(s.name)}</b>? Old bills are not affected.`, 'Delete')) {
    S.services = S.services.filter(x => x !== s); await save('services'); refreshAll(); toast('Deleted');
  }
});
$('#svcAdd').onclick = () => editService(null);
function editService(s) {
  const g = groups(), isNew = !s;
  s = s || {group: svcGroupF !== 'All' ? svcGroupF : g[0], cat: '', name: '', price: '', max: '', active: true};
  const cats = [...new Set(S.services.map(x => x.cat))];
  modal(`<h3>${isNew ? 'Add service' : 'Edit service'}</h3>
    <div class="grid2">
      ${g.length > 1 ? `<label class="f">Group<select id="eG">${g.map(x => `<option ${x === s.group ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>` : ''}
      <label class="f ${g.length > 1 ? '' : 'span2'}">Category<input id="eC" list="catList" value="${esc(s.cat)}"><datalist id="catList">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
      <label class="f span2">Service name<input id="eN" value="${esc(s.name)}"></label>
      <label class="f">Price (leave 0 to ask every time)<input id="eP" type="number" min="0" class="num" value="${s.price || ''}"></label>
      <label class="f">Max price (only for a range)<input id="eM" type="number" min="0" class="num" value="${s.max || ''}"></label>
      <label class="chk span2"><input type="checkbox" id="eA" ${s.active !== false ? 'checked' : ''}> Show on billing screen</label>
    </div>
    <div class="row gap"><span class="grow"></span><button class="ghost" id="eX">Cancel</button><button class="pri" id="eOk">Save</button></div>`, m => {
    m.querySelector(isNew ? '#eN' : '#eP').focus();
    m.querySelector('#eX').onclick = closeModal;
    m.querySelector('#eOk').onclick = async () => {
      const name = m.querySelector('#eN').value.trim(); if (!name) return toast('Enter service name', true);
      const obj = isNew ? {id: 's' + uid()} : s;
      Object.assign(obj, {group: g.length > 1 ? m.querySelector('#eG').value : g[0], cat: m.querySelector('#eC').value.trim() || 'General', name,
        price: Math.max(0, +m.querySelector('#eP').value || 0), max: Math.max(0, +m.querySelector('#eM').value || 0), active: m.querySelector('#eA').checked});
      if (obj.max && obj.max <= obj.price) obj.max = 0;
      if (isNew) S.services.push(obj);
      await save('services'); closeModal(); refreshAll(); toast('Saved');
    };
  });
}
$('#svcExportCsv').onclick = () => download('services.csv', toCSV([['Group', 'Category', 'Service', 'Price', 'Max price', 'Active'],
  ...S.services.map(s => [s.group, s.cat, s.name, s.price, s.max || '', s.active === false ? 'No' : 'Yes'])]), 'text/csv');
$('#svcImportCsv').onclick = () => {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.csv,text/csv';
  inp.onchange = async () => {
    const rows = parseCSV(await inp.files[0].text()); if (rows.length < 2) return toast('CSV is empty', true);
    const h = rows[0].map(x => x.trim().toLowerCase());
    const ix = n => h.findIndex(x => x.startsWith(n));
    const [gi, ci, ni, pi, mi, ai] = [ix('group'), ix('cat'), ix('serv') >= 0 ? ix('serv') : ix('name'), ix('price'), ix('max'), ix('active')];
    if (ni < 0 || pi < 0) return toast('CSV needs at least "Service" and "Price" columns', true);
    const g = groups();
    const items = rows.slice(1).filter(r => (r[ni] || '').trim()).map(r => ({id: 's' + uid(), group: (gi >= 0 && r[gi]?.trim()) || g[0], cat: (ci >= 0 && r[ci]?.trim()) || 'General',
      name: r[ni].trim(), price: +String(r[pi]).replace(/[^\d.]/g, '') || 0, max: mi >= 0 ? (+String(r[mi]).replace(/[^\d.]/g, '') || 0) : 0,
      active: ai >= 0 ? !/^n/i.test(r[ai] || '') : true}));
    const replace = await confirmBox(`Found <b>${items.length}</b> services. Replace your current list (${S.services.length})? Choose Cancel to add them to the existing list instead.`, 'Replace');
    S.services = replace ? items : S.services.concat(items);
    const newG = [...new Set(items.map(i => i.group))].filter(x => !g.includes(x));
    if (newG.length) { S.settings.groups = g.concat(newG); await save('settings'); }
    await save('services'); refreshAll(); toast(`Imported ${items.length} services`);
  };
  inp.click();
};

/* ================= PRODUCTS TAB ================= */
function renderProducts() {
  const q = $('#prodSearch').value.trim().toLowerCase();
  const all = S.products, st = S.settings;
  const list = all.filter(p => !q || (p.name + ' ' + (p.brand || '') + ' ' + (p.cat || '') + ' ' + (p.code || '') + ' ' + (p.hsn || '')).toLowerCase().includes(q))
    .sort((a, b) => (a.cat || '').localeCompare(b.cat || '') || a.name.localeCompare(b.name));
  const live = all.filter(p => p.active !== false);
  const value = live.reduce((s, p) => s + toP(p.price) * Math.max(0, stockOf(p)), 0);
  const stat = (k, v) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  $('#prodSummary').innerHTML = stat('Products', live.length) + stat('Stock value (at selling price)', money0(value))
    + stat('Low stock', live.filter(p => stockOf(p) > 0 && stockOf(p) <= lowOf(p)).length) + stat('Out of stock', live.filter(p => stockOf(p) <= 0).length);
  const gstOn = st.gstMode !== 'none';
  $('#prodTable').innerHTML = `<thead><tr><th>Product</th><th>Category</th><th>Barcode / code</th><th>HSN</th><th class="r">Price</th>${gstOn ? '<th class="r">GST</th>' : ''}<th class="r">Stock</th><th>Status</th><th></th></tr></thead><tbody>` +
    (list.map(p => { const s = stockOf(p);
      return `<tr data-id="${p.id}"><td><b>${esc(p.name)}</b>${p.brand ? `<div class="muted small">${esc(p.brand)}</div>` : ''}</td><td>${esc(p.cat || '')}</td>
      <td>${esc(p.code || '')}</td><td>${esc(p.hsn || '')}</td><td class="r">${money0(toP(p.price))}</td>
      ${gstOn ? `<td class="r">${prodRate(p) === '' ? `<span class="muted">${+st.gstRate || 0}%</span>` : prodRate(p) + '%'}</td>` : ''}
      <td class="r">${s <= 0 ? `<span class="pill bad">${s}</span>` : s <= lowOf(p) ? `<span class="pill warn">${s}</span>` : `<b>${s}</b>`}</td>
      <td>${p.active === false ? '<span class="pill off">Hidden</span>' : '<span class="pill">Active</span>'}</td>
      <td class="act"><button class="sec" data-a="stock">+ Stock</button> <button class="sec" data-a="edit">Edit</button> <button class="ghost danger" data-a="del">Delete</button></td></tr>`; }).join('')
      || `<tr><td colspan="9" class="empty">No products yet. Click “+ Add product” to add shampoo, hair serum and other items you sell.</td></tr>`) + '</tbody>';
}
$('#prodSearch').addEventListener('input', renderProducts);
$('#prodAdd').onclick = () => editProduct(null);
$('#prodTable').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  const p = S.products.find(x => x.id === b.closest('tr').dataset.id); if (!p) return;
  if (b.dataset.a === 'edit') editProduct(p);
  if (b.dataset.a === 'stock') addStock(p);
  if (b.dataset.a === 'del' && await confirmBox(`Delete <b>${esc(p.name)}</b>? Old bills are not affected.`, 'Delete')) {
    S.products = S.products.filter(x => x !== p); await save('products'); refreshAll(); toast('Deleted');
  }
});
function editProduct(p) {
  const isNew = !p, st = S.settings, def = +st.gstRate || 0;
  p = p || {name: '', brand: '', cat: '', code: '', hsn: '', price: '', gstRate: '', stock: 0, low: 3, active: true};
  const cats = [...new Set(S.products.map(x => x.cat).filter(Boolean).concat(['Hair Care', 'Skin Care']))];
  const priceLbl = st.gstMode === 'exclusive' ? 'Selling price ₹ (before GST)' : st.gstMode === 'inclusive' ? 'Selling price ₹ (MRP, incl. GST)' : 'Selling price ₹';
  const rate = prodRate(p);
  modal(`<h3>${isNew ? 'Add product' : 'Edit product'}</h3>
    <div class="grid2">
      <label class="f span2">Product name *<input id="pN" value="${esc(p.name)}" placeholder="e.g. Anti-dandruff Shampoo 200 ml"></label>
      <label class="f">Brand<input id="pB" value="${esc(p.brand || '')}"></label>
      <label class="f">Category<input id="pC" list="pCats" value="${esc(p.cat || '')}" placeholder="Hair Care"><datalist id="pCats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
      <label class="f">${priceLbl}<input id="pP" type="number" min="0" step="0.01" class="num" value="${p.price || ''}"></label>
      <label class="f">GST rate
        <select id="pG" ${st.gstMode === 'none' ? 'disabled' : ''}>
          <option value="" ${rate === '' ? 'selected' : ''}>Same as services (${def}%)</option>
          ${[0, 5, 12, 18, 28].map(r => `<option value="${r}" ${rate === r ? 'selected' : ''}>${r}%</option>`).join('')}
        </select></label>
      <label class="f">HSN code<input id="pH" value="${esc(p.hsn || '')}" placeholder="e.g. 3305" maxlength="8"></label>
      <label class="f">Barcode / product code<input id="pK" value="${esc(p.code || '')}" placeholder="scan or type"></label>
      <label class="f">${isNew ? 'Opening stock (qty)' : 'Stock in hand (qty)'}<input id="pS" type="number" step="1" class="num" value="${stockOf(p)}"></label>
      <label class="f">Warn when stock is at or below<input id="pL" type="number" min="0" step="1" class="num" value="${lowOf(p)}"></label>
      <label class="chk span2"><input type="checkbox" id="pA" ${p.active !== false ? 'checked' : ''}> Show on billing screen</label>
    </div>
    <p class="muted small">Check the product's GST rate and HSN code on its purchase invoice, or with your accountant.</p>
    <div class="row gap"><span class="grow"></span><button class="ghost" id="pX">Cancel</button><button class="pri" id="pOk">Save</button></div>`, m => {
    m.querySelector(isNew ? '#pN' : '#pP').focus();
    m.querySelector('#pX').onclick = closeModal;
    m.querySelector('#pOk').onclick = async () => {
      const name = m.querySelector('#pN').value.trim(); if (!name) return toast('Enter product name', true);
      const code = m.querySelector('#pK').value.trim();
      if (code && S.products.some(x => x !== p && x.code && String(x.code).toLowerCase() === code.toLowerCase())) return toast('Another product already has this barcode', true);
      const g = m.querySelector('#pG').value;
      const obj = isNew ? {id: 'p' + uid()} : p;
      Object.assign(obj, {name, brand: m.querySelector('#pB').value.trim(), cat: m.querySelector('#pC').value.trim() || 'Products', code,
        hsn: m.querySelector('#pH').value.replace(/\D/g, ''), price: Math.max(0, +m.querySelector('#pP').value || 0),
        gstRate: g === '' ? '' : +g, stock: parseInt(m.querySelector('#pS').value) || 0,
        low: Math.max(0, parseInt(m.querySelector('#pL').value) || 0), active: m.querySelector('#pA').checked});
      if (isNew) S.products.push(obj);
      await save('products'); closeModal(); refreshAll(); toast('Saved');
    };
  });
}
// Receive new stock (or correct it with a negative number, e.g. damaged or used in the salon).
function addStock(p) {
  modal(`<h3>Update stock · ${esc(p.name)}</h3>
    <p class="muted">In stock now: <b>${stockOf(p)}</b></p>
    <label class="f">Quantity to add (use minus for damaged / used items, e.g. -1)<input id="aQ" type="number" step="1" class="num" placeholder="e.g. 12"></label>
    <div class="row gap"><span class="grow"></span><button class="ghost" id="aX">Cancel</button><button class="pri" id="aOk">Update stock</button></div>`, m => {
    const q = m.querySelector('#aQ'); q.focus();
    m.querySelector('#aX').onclick = closeModal;
    const ok = async () => {
      const n = parseInt(q.value); if (!n) return toast('Enter a quantity', true);
      p.stock = stockOf(p) + n; await save('products'); closeModal(); refreshAll();
      toast(`${p.name}: stock is now ${p.stock}`);
    };
    m.querySelector('#aOk').onclick = ok; q.onkeydown = e => { if (e.key === 'Enter') ok(); }; // braces: returning false would block typing
  });
}
$('#prodExport').onclick = () => download('products.csv', toCSV([['Product', 'Brand', 'Category', 'Barcode', 'HSN', 'Price', 'GST %', 'Stock', 'Low stock level', 'Active'],
  ...S.products.map(p => [p.name, p.brand || '', p.cat || '', p.code || '', p.hsn || '', p.price, prodRate(p) === '' ? '' : prodRate(p), stockOf(p), lowOf(p), p.active === false ? 'No' : 'Yes'])]), 'text/csv');

/* ================= STAFF ================= */
function renderStaff() {
  $('#staffTable').innerHTML = `<thead><tr><th>Name</th><th>Status</th><th></th></tr></thead><tbody>` +
    (S.staff.map((s, i) => `<tr data-i="${i}"><td><b>${esc(s.name)}</b></td><td>${s.active === false ? '<span class="pill off">Inactive</span>' : '<span class="pill">Active</span>'}</td>
      <td class="act"><button class="sec" data-a="ren">Rename</button> <button class="sec" data-a="tog">${s.active === false ? 'Activate' : 'Deactivate'}</button> <button class="ghost danger" data-a="del">Delete</button></td></tr>`).join('')
      || '<tr><td colspan="3" class="empty">No staff added</td></tr>') + '</tbody>';
}
const staffExists = (n, except) => S.staff.some(s => s !== except && String(s.name).toLowerCase() === n.toLowerCase());
// Adds a staff member; returns true when added (and saved). Used by the Staff tab and the bill.
async function addStaff(n) {
  n = String(n || '').trim().replace(/\s+/g, ' ');
  if (!n) { toast('Enter the staff name', true); return false; }
  if (staffExists(n)) { toast(`${n} is already in the staff list`, true); return false; }
  S.staff.push({name: n, active: true});
  try { await save('staff'); } catch (e) { S.staff.pop(); return false; }
  renderStaff(); renderCart(); toast(`Added ${n}`);
  return true;
}
// Small dialog asking for a staff name (add or rename). onOk(name) runs when confirmed.
function staffNameBox(current, onOk) {
  modal(`<h3>${current ? 'Rename staff' : 'Add staff'}</h3>
    <label class="f">Staff name<input id="snN" value="${esc(current)}" maxlength="40"></label>
    <div class="row gap"><span class="grow"></span><button class="ghost" id="snX">Cancel</button><button class="pri" id="snOk">${current ? 'Rename' : 'Add'}</button></div>`, m => {
    const inp = m.querySelector('#snN'); inp.focus(); inp.select();
    m.querySelector('#snX').onclick = closeModal;
    const ok = async () => { const n = inp.value.trim(); if (!n) return toast('Enter the staff name', true); closeModal(); await onOk(n); };
    m.querySelector('#snOk').onclick = ok; inp.onkeydown = e => { if (e.key === 'Enter') ok(); }; // braces: returning false would block typing
  });
}
$('#staffAdd').onclick = async () => { if (await addStaff($('#staffNew').value)) $('#staffNew').value = ''; $('#staffNew').focus(); };
$('#staffNew').addEventListener('keydown', e => e.key === 'Enter' && $('#staffAdd').click());
$('#staffTable').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return; const s = S.staff[+b.closest('tr').dataset.i]; if (!s) return;
  if (b.dataset.a === 'ren') return staffNameBox(s.name, async n => {
    if (staffExists(n, s)) return toast(`${n} is already in the staff list`, true);
    s.name = n; await save('staff'); renderStaff(); renderCart(); toast('Renamed');
  });
  if (b.dataset.a === 'tog') s.active = s.active === false;
  if (b.dataset.a === 'del') { if (!(await confirmBox(`Delete ${esc(s.name)}? Their old bills keep the name.`, 'Delete'))) return; S.staff.splice(S.staff.indexOf(s), 1); }
  await save('staff'); renderStaff(); renderCart();
});

/* ================= SETTINGS ================= */
function fillSettings() {
  const st = S.settings;
  $$('[data-s]').forEach(el => {
    const k = el.dataset.s;
    if (k === 'groupsText') el.value = groups().join(', ');
    else if (el.type === 'checkbox') el.checked = !!st[k];
    else el.value = st[k] ?? '';
  });
  $('#logoPrev').src = st.logo || '';
  $('#nextInvLbl').textContent = 'Next invoice number: ' + nextInvoice().no + ' (numbers restart every financial year on 1 April)';
}
$('#saveSettings').onclick = async () => {
  const st = S.settings;
  $$('[data-s]').forEach(el => {
    const k = el.dataset.s;
    if (k === 'groupsText') { const g = el.value.split(',').map(x => x.trim()).filter(Boolean); st.groups = g.length ? [...new Set(g)] : ['General']; }
    else if (el.type === 'checkbox') st[k] = el.checked;
    else if (el.type === 'number') st[k] = +el.value || 0;
    else st[k] = el.value.trim();
  });
  st.gstin = st.gstin.toUpperCase(); st.invoicePrefix = (st.invoicePrefix || 'INV').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'INV';
  if (st.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(st.gstin)) toast('Note: GSTIN format looks wrong — please check', true);
  if (st.gstin && !st.stateCode) st.stateCode = st.gstin.slice(0, 2);
  // services in removed groups move to first group
  S.services.forEach(s => { if (!st.groups.includes(s.group)) s.group = st.groups[0]; });
  await save('settings'); await save('services'); refreshAll(); toast('Settings saved');
};
$('#logoPick').onclick = () => $('#logoFile').click();
$('#logoFile').onchange = async () => {
  const f = $('#logoFile').files[0]; if (!f) return;
  const img = new Image(); img.src = URL.createObjectURL(f); await img.decode();
  const c = document.createElement('canvas'); const sc = Math.min(1, 320 / Math.max(img.width, img.height));
  c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  S.settings.logo = c.toDataURL('image/png'); $('#logoPrev').src = S.settings.logo; $('#logoFile').value = '';
  toast('Logo ready — click Save settings');
};
$('#logoRemove').onclick = () => { S.settings.logo = ''; $('#logoPrev').src = ''; };
$('#testPrint').onclick = () => {
  const t = calc([{price: 200, qty: 1}, {price: 50, qty: 2}], 'amt', 0, S.settings.gstMode, S.settings.gstRate);
  printBill({no: nextInvoice().no.replace(/\d+$/, 'TEST'), date: new Date().toISOString(), customer: {name: 'Test Customer', phone: '9876543210'},
    items: [{name: 'Sample Hair Cut', price: 20000, qty: 1, staff: ''}, {name: 'Sample Threading', price: 5000, qty: 2, staff: ''}],
    ...t, discType: 'amt', discVal: 0, gstMode: S.settings.gstMode, gstRate: +S.settings.gstRate, pay: {mode: 'Cash', cash: t.grand}, received: 0, notes: '', status: 'ok'});
};
$('#bkExport').onclick = () => {
  download(`billora-backup-${dkey(new Date())}.json`, JSON.stringify({type: 'billora-backup', version: 1, exportedAt: new Date().toISOString(), ...S}), 'application/json');
  toast('Backup saved to your Downloads folder');
};
async function importBackup(file) {
  let d; try { d = JSON.parse(await file.text()); } catch (e) { return toast('That is not a valid backup file', true); }
  if (!['billora-backup', 'salon-billing-backup'].includes(d.type)) return toast('That is not a Billora backup file', true);
  const msg = S.bills.length
    ? `This will REPLACE all current data (${S.bills.length} bills) with the file's data (${(d.bills || []).length} bills, ${(d.services || []).length} services). Continue?`
    : `Load ${(d.services || []).length} services${(d.products || []).length ? `, ${d.products.length} products` : ''} and settings for <b>${esc(d.settings?.shopName || '')}</b>?`;
  if (!(await confirmBox(msg, 'Load'))) return false;
  S.settings = {...DEFAULT_SETTINGS, ...(d.settings || {}), setupDone: true};
  S.services = d.services || []; S.staff = d.staff || []; S.bills = d.bills || []; S.products = d.products || [];
  for (const k of COLLECTIONS) await save(k);
  refreshAll(); toast('Data loaded'); return true;
}
$('#bkImport').onclick = () => $('#bkFile').click();
$('#bkFile').onchange = () => { const f = $('#bkFile').files[0]; $('#bkFile').value = ''; f && importBackup(f); };
$('#openData').onclick = () => fetch('/api/opendata');

/* ================= SETUP WIZARD ================= */
function showSetup() { $('#setup').classList.remove('hidden'); $('#suName').focus(); }
$('#suImport').onclick = () => $('#suFile').click();
$('#suFile').onchange = async () => { const f = $('#suFile').files[0]; $('#suFile').value = ''; if (f && await importBackup(f)) $('#setup').classList.add('hidden'); };
$('#suGo').onclick = async () => {
  const name = $('#suName').value.trim(); if (!name) return toast('Please enter your business name', true);
  const gstin = $('#suGstin').value.trim().toUpperCase();
  const g = $('#suGroups').value.split(',');
  Object.assign(S.settings, {shopName: name, address: $('#suAddr').value.trim(), phone: $('#suPhone').value.trim(), gstin,
    stateCode: gstin.slice(0, 2), gstMode: $('#suGst').value, groups: g, setupDone: true,
    invoicePrefix: (name.replace(/[^A-Za-z ]/g, '').split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 4)) || 'INV'});
  if (gstin && S.settings.gstMode === 'none') S.settings.gstMode = 'inclusive';
  if ($('#suSample').checked && !S.services.length) {
    for (const grp of g) for (const [c, n, p] of (SAMPLE[grp] || SAMPLE.General)) S.services.push({id: 's' + uid(), group: grp, cat: c, name: n, price: p, max: 0, active: true});
    await save('services');
  }
  await save('settings'); $('#setup').classList.add('hidden'); refreshAll(); toast('All set! Start billing.');
};

/* ================= NAV / BOOT ================= */
function switchTab(t) {
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $$('.tab').forEach(s => s.classList.toggle('on', s.id === 'tab-' + t));
  ({bills: renderBills, customers: renderCustomers, reports: renderReports, services: renderSvcAdmin, products: renderProducts, staff: renderStaff, settings: fillSettings}[t] || (() => $('#svcSearch').focus()))();
}
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); b && switchTab(b.dataset.tab); });
document.addEventListener('keydown', e => {
  if (!$('#modal').classList.contains('hidden')) { if (e.key === 'Escape') closeModal(); return; }
  if (e.key === 'F1') { e.preventDefault(); switchTab('bill'); }
  if (e.key === 'F2') { e.preventDefault(); switchTab('bill'); $('#svcSearch').focus(); $('#svcSearch').select(); }
  if (e.key === 'F9' && $('#tab-bill').classList.contains('on')) { e.preventDefault(); saveBill(true); }
});
function refreshAll() {
  const st = S.settings;
  $('#brandName').textContent = st.shopName || 'Billora';
  document.title = (st.shopName ? st.shopName + ' — ' : '') + 'Billora';
  if (st.logo) $('#brandLogo').src = st.logo; else $('#brandLogo').removeAttribute('src');
  if (!activeProds().length) pick = 'svc';
  renderPick(); renderGroupBtns(); renderCats(); renderGrid(); renderCart();
  const on = $('.tab.on')?.id?.slice(4); if (on && on !== 'bill') switchTab(on);
  const names = [...new Set(customers().map(c => c.name).filter(Boolean))].slice(0, 500);
  $('#custNames').innerHTML = names.map(n => `<option value="${esc(n)}">`).join('');
}
function tick() { const d = new Date(); $('#clock').textContent = d.toLocaleDateString('en-IN', {weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'}) + '  ' + d.toLocaleTimeString('en-IN', {hour: '2-digit', minute: '2-digit'}); }
setInterval(tick, 15000); tick();

const sleep = ms => new Promise(r => setTimeout(r, ms));
// NATIVE: running in Billora's own window (WebView2). The launch screen is then a separate
// native window (splash_windows.go) and the main window is shown when we post 'ready'.
const NATIVE = !!(window.chrome && window.chrome.webview);
const toNative = m => { try { window.chrome.webview.postMessage(m); } catch (e) {} };
function splash(pct, txt) {
  if (NATIVE) return toNative('splash:' + pct + ':' + (txt || ''));
  $('#spFill').style.width = pct + '%'; if (txt) $('#spTxt').textContent = txt;
}
(async function boot() {
  const t0 = Date.now();
  const wait = ms => NATIVE ? Promise.resolve() : sleep(ms); // window is hidden while loading
  if (NATIVE) $('#splash').remove(); else requestAnimationFrame(() => splash(18));
  await wait(450); splash(42, 'Loading your data...');
  try { await load(); } catch (e) { toast('Could not load data: ' + e.message, true); }
  await wait(350); splash(74, 'Preparing billing...');
  rangeSeg($('#billsRange'), $('#bFrom'), $('#bTo'), renderBills);
  rangeSeg($('#repRange'), $('#rFrom'), $('#rTo'), renderReports);
  refreshAll();
  fetch('/api/info').then(r => r.json()).then(i => $('#dataDirLbl').textContent = 'Data folder: ' + i.dataDir).catch(() => {});
  if (NATIVE) toNative('ready');
  else {
    await sleep(Math.max(0, 1900 - (Date.now() - t0))); splash(100, 'Ready');
    await sleep(450); $('#splash').classList.add('out'); setTimeout(() => $('#splash').remove(), 500);
  }
  if (!S.settings.setupDone) showSetup(); else $('#svcSearch').focus();
})();
