// ---------- API helper ----------
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    credentials: 'include',
    headers: opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body instanceof FormData ? opts.body : (opts.body ? JSON.stringify(opts.body) : undefined)
  });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : await res.blob();
  if (!res.ok) {
    throw new Error((data && data.error) || 'Request failed.');
  }
  return data;
}

function fmtMoney(n) {
  return Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Dates are stored/transmitted internally as ISO (YYYY-MM-DD) — that's what
// <input type="date"> requires and what SQLite's date functions need for
// filtering/grouping. This only changes how a stored date is DISPLAYED as
// text (tables, detail views, exports): the site-wide default display format
// is MM/DD/YYYY. Pass through unrecognized/empty values unchanged.
function formatDate(value) {
  if (!value) return '';
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return value;
  const [, y, mo, d] = m;
  return `${mo}/${d}/${y}`;
}

// ---------- MM/DD/YYYY date fields ----------
// Native <input type="date"> displays its calendar/text per the browser/OS locale,
// which we can't force from web content (some locales render DD/MM/YYYY). These
// back a plain text field with a MM/DD/YYYY mask instead, so the app — not the
// browser — always controls the format, and convert to/from the yyyy-mm-dd the
// API and database use internally.
function isoToMDY(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return `${m[2]}/${m[3]}/${m[1]}`;
}
function mdyToISO(mdy) {
  const m = String(mdy || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return '';
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}
function attachDateMask(input) {
  if (!input || input.__dateMaskBound) return;
  input.__dateMaskBound = true;
  input.setAttribute('placeholder', 'MM/DD/YYYY');
  input.setAttribute('maxlength', '10');
  input.addEventListener('input', () => {
    const digits = input.value.replace(/\D/g, '').slice(0, 8);
    let out = digits;
    if (digits.length > 4) out = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    else if (digits.length > 2) out = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    input.value = out;
  });
}

function toast(msg, isError = false) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// ---------- Auth guard ----------
async function requireLogin() {
  try {
    const user = await api('/auth/me');
    window.currentUser = user;
    return user;
  } catch (e) {
    window.location.href = '/login.html';
    return null;
  }
}

async function doLogout() {
  sessionStorage.removeItem('drwsa_cal_year');
  sessionStorage.removeItem('drwsa_cal_month');
  await api('/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
}

// ---------- Shell (sidebar + topbar) ----------
const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', href: '/dashboard.html', icon: 'home' },
  { key: 'report', label: 'Report', href: '/report.html', icon: 'report' },
  { key: 'user', label: 'User', href: '/user.html', icon: 'user' },
  { key: 'analytics', label: 'Analytics', href: '/analytics.html', icon: 'chart' },
  { key: 'catalog', label: 'Catalog', href: '/catalog.html', icon: 'catalog' },
  { key: 'faq', label: 'FAQ', href: '/faq.html', icon: 'faq' }
];

const ICONS = {
  home: '⌂', report: '▤', user: '☺', chart: '📊', catalog: '▥', faq: '?'
};

function renderShell(activeKey, pageTitle) {
  const shell = document.getElementById('shell');
  const navHtml = NAV_ITEMS.map(item => `
    <a class="nav-btn ${item.key === activeKey ? 'active' : ''}" href="${item.href}">
      <span>${ICONS[item.icon]}</span> ${item.label}
    </a>`).join('');

  shell.innerHTML = `
    <aside class="sidebar">
      <div class="brand" id="brand-logo">${defaultLogoSvg(130)}</div>
      <nav>${navHtml}</nav>
      <a class="sidebar-footer" href="/about.html">ⓘ about us</a>
      <div class="copyright">Copyright © 2026<br/>UB Lipa OJT's rights reserved.</div>
    </aside>
    <main class="main">
      <div class="flex-between">
        <h1>${pageTitle}</h1>
      </div>
      <div id="page-content"></div>
    </main>
    <aside class="sidebar-right">
      <div class="profile-pill" id="profile-pill">
        <span class="avatar" id="profile-avatar">☺</span>
        <span id="profile-name">…</span>
        <div class="profile-menu" id="profile-menu">
          <button onclick="doLogout()">Logout</button>
        </div>
      </div>
      <div class="notif-panel">
        <h3>Notifications</h3>
        <div class="notif-list scroll-y" id="notif-list"></div>
      </div>
      <div id="sidebar-extra"></div>
    </aside>
  `;

  document.getElementById('profile-pill').addEventListener('click', (e) => {
    document.getElementById('profile-menu').classList.toggle('open');
    e.stopPropagation();
  });
  document.addEventListener('click', () => document.getElementById('profile-menu')?.classList.remove('open'));

  loadLogo();
  loadProfileAndNotifications();
}

function defaultLogoSvg(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
    <path d="M32 4 L58 14 V30 C58 46 47 56 32 60 C17 56 6 46 6 30 V14 Z" fill="#1c3b6e"/>
    <path d="M32 8 L54 17 V30 C54 44 45 52 32 56 C19 52 10 44 10 30 V17 Z" fill="#2ec2d8"/>
    <circle cx="32" cy="30" r="10" fill="#0b0b0d"/>
  </svg>`;
}

async function loadLogo() {
  try {
    const { logoUrl } = await api('/settings');
    const brand = document.getElementById('brand-logo');
    if (brand && logoUrl) {
      brand.innerHTML = `<img src="${logoUrl}" alt="DRWSA logo" style="width:130px;height:130px;object-fit:contain;border-radius:12px;">`;
    }
  } catch (e) { /* keep default logo */ }
}

async function loadProfileAndNotifications() {
  try {
    const user = window.currentUser || await api('/auth/me');
    document.getElementById('profile-name').textContent = user.name;
    if (user.avatar_path) {
      document.getElementById('profile-avatar').innerHTML = `<img src="${user.avatar_path}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    }
  } catch (e) { /* ignore */ }

  try {
    const notifs = await api('/notifications');
    const list = document.getElementById('notif-list');
    if (!notifs.length) {
      list.innerHTML = '<div class="empty-state">No notifications yet.</div>';
    } else {
      list.innerHTML = notifs.map(n => `
        <div class="notif-item" style="${n.transaction_id ? 'cursor:pointer;' : ''}" data-txn-id="${n.transaction_id || ''}">
          <span class="avatar"></span>
          <span>${escapeHtml(n.message)}</span>
        </div>`).join('');
      list.querySelectorAll('.notif-item').forEach(el => {
        const id = el.getAttribute('data-txn-id');
        if (id) el.addEventListener('click', () => window.location.href = `/catalog.html?open=${id}`);
      });
    }
  } catch (e) { /* ignore */ }
}

// ---------- Simple dependency-free SVG pie chart ----------
const PIE_COLORS = ['#2f6fed', '#7c5cf0', '#f2a93b', '#f2d94e', '#e8607a', '#2ec2d8', '#4caf7d', '#c96de0'];

function drawPieChart(container, data, opts = {}) {
  // data: [{ label, value }]
  data = (data || []).filter(d => d.value > 0);
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total || !data.length) {
    container.innerHTML = '<div class="empty-state">No data to display yet.</div>';
    return;
  }
  const size = opts.size || 260;
  const r = size / 2 - 10;
  const cx = size / 2, cy = size / 2;
  let angle = -90;
  let paths = '';
  let legend = '';

  // A single 100% slice can't be drawn as an SVG arc (the start and end point
  // are identical, so the arc collapses to nothing) — draw a full circle instead.
  if (data.length === 1) {
    const color = PIE_COLORS[0];
    paths = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" stroke="#fff" stroke-width="1.5"
               data-label="${escapeHtml(data[0].label)}" class="pie-slice" style="cursor:pointer;"></circle>
             <text x="${cx}" y="${cy}" font-size="12" fill="#111" text-anchor="middle">100%</text>`;
    legend = `<div style="display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:4px;">
      <span style="width:10px;height:10px;border-radius:50%;background:${color};display:inline-block;"></span>
      ${escapeHtml(data[0].label)} <span class="muted">(100%)</span>
    </div>`;
  } else {
    data.forEach((d, i) => {
      const pct = d.value / total;
      const sweep = pct * 360;
      const x1 = cx + r * Math.cos(Math.PI * angle / 180);
      const y1 = cy + r * Math.sin(Math.PI * angle / 180);
      const endAngle = angle + sweep;
      const x2 = cx + r * Math.cos(Math.PI * endAngle / 180);
      const y2 = cy + r * Math.sin(Math.PI * endAngle / 180);
      const largeArc = sweep > 180 ? 1 : 0;
      const color = PIE_COLORS[i % PIE_COLORS.length];
      const midAngle = angle + sweep / 2;
      const lx = cx + (r * 0.65) * Math.cos(Math.PI * midAngle / 180);
      const ly = cy + (r * 0.65) * Math.sin(Math.PI * midAngle / 180);
      paths += `<path d="M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z"
                  fill="${color}" stroke="#fff" stroke-width="1.5" data-label="${escapeHtml(d.label)}" class="pie-slice" style="cursor:pointer;"></path>`;
      if (pct > 0.04) {
        paths += `<text x="${lx}" y="${ly}" font-size="10" fill="#111" text-anchor="middle">${(pct * 100).toFixed(1)}%</text>`;
      }
      legend += `<div style="display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:4px;">
        <span style="width:10px;height:10px;border-radius:50%;background:${color};display:inline-block;"></span>
        ${escapeHtml(d.label)} <span class="muted">(${(pct * 100).toFixed(1)}%)</span>
      </div>`;
      angle = endAngle;
    });
  }

  container.innerHTML = `
    <div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap;justify-content:center;">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${paths}</svg>
      <div>${legend}</div>
    </div>`;
  if (opts.onSliceClick) {
    container.querySelectorAll('.pie-slice').forEach(el => {
      el.addEventListener('click', () => opts.onSliceClick(el.getAttribute('data-label')));
    });
  }
}

// ---------- Simple dependency-free SVG bar/column chart ----------
function drawBarChart(container, data, opts = {}) {
  data = (data || []).filter(d => d.value >= 0);
  if (!data.length || !data.some(d => d.value > 0)) {
    container.innerHTML = '<div class="empty-state">No data to display yet.</div>';
    return;
  }
  const horizontal = opts.horizontal; // true = "bar" (horizontal), false = "column" (vertical)
  const w = opts.width || 640;
  const titleH = opts.title ? 26 : 0;
  const axisLabelH = opts.xLabel ? 20 : 0;
  const h = (opts.height || 320) + titleH + axisLabelH;
  const padTop = 50 + titleH;
  const padBottom = 50 + axisLabelH;
  const padLeft = horizontal ? 90 : 50;
  const leftAxisLabelW = opts.yLabel ? 16 : 0;
  const max = Math.max(...data.map(d => d.value), 1);
  let bars = '';

  if (horizontal) {
    const plotH = h - padTop - padBottom;
    const barH = Math.min(34, plotH / data.length - 8);
    data.forEach((d, i) => {
      const y = padTop + i * (plotH / data.length);
      const bw = ((w - padLeft - 90) * d.value) / max;
      const color = PIE_COLORS[i % PIE_COLORS.length];
      bars += `<rect x="${padLeft}" y="${y}" width="${Math.max(bw, 1)}" height="${barH}" fill="${color}" data-label="${escapeHtml(d.label)}" class="pie-slice" style="cursor:pointer;"></rect>
        <text x="${padLeft - 4}" y="${y + barH / 2 + 4}" font-size="10" text-anchor="end" fill="#2b2f36">${escapeHtml(truncateLabel(d.label))}</text>
        <text x="${padLeft + bw + 6}" y="${y + barH / 2 + 4}" font-size="10" fill="#2b2f36" font-weight="600">${fmtMoney(d.value)}</text>`;
    });
  } else {
    const plotW = w - padLeft * 2;
    const barW = Math.min(46, plotW / data.length - 10);
    data.forEach((d, i) => {
      const x = padLeft + i * (plotW / data.length);
      const bh = ((h - padTop - padBottom) * d.value) / max;
      const y = h - padBottom - bh;
      const color = PIE_COLORS[i % PIE_COLORS.length];
      bars += `<rect x="${x}" y="${y}" width="${barW}" height="${Math.max(bh, 1)}" fill="${color}" data-label="${escapeHtml(d.label)}" class="pie-slice" style="cursor:pointer;"></rect>
        <text x="${x + barW / 2}" y="${h - padBottom + 14}" font-size="9" text-anchor="middle" fill="#2b2f36">${escapeHtml(truncateLabel(d.label, 8))}</text>
        <text x="${x + barW / 2}" y="${y - 4}" font-size="9" text-anchor="middle" fill="#2b2f36" font-weight="600">${fmtMoney(d.value)}</text>`;
    });
  }

  const titleSvg = opts.title ? `<text x="${w / 2}" y="18" font-size="13" font-weight="700" text-anchor="middle" fill="#1c3b6e">${escapeHtml(opts.title)}</text>` : '';
  const xLabelSvg = opts.xLabel ? `<text x="${padLeft + (w - padLeft * 2) / 2}" y="${h - 6}" font-size="10" text-anchor="middle" fill="#5a6270">${escapeHtml(opts.xLabel)}</text>` : '';
  const yLabelSvg = opts.yLabel ? `<text x="${leftAxisLabelW ? 12 : 12}" y="${padTop + (h - padTop - padBottom) / 2}" font-size="10" text-anchor="middle" fill="#5a6270" transform="rotate(-90, 12, ${padTop + (h - padTop - padBottom) / 2})">${escapeHtml(opts.yLabel)}</text>` : '';

  container.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="max-width:100%;">
      ${titleSvg}
      <line x1="${horizontal ? padLeft : padLeft}" y1="${horizontal ? padTop - 10 : padTop}" x2="${horizontal ? padLeft : padLeft}" y2="${h - padBottom}" stroke="#c7cbd1"></line>
      <line x1="${horizontal ? padLeft : padLeft}" y1="${h - padBottom}" x2="${w - (horizontal ? 20 : padLeft)}" y2="${h - padBottom}" stroke="#c7cbd1"></line>
      ${bars}
      ${xLabelSvg}
      ${yLabelSvg}
    </svg>`;
  if (opts.onSliceClick) {
    container.querySelectorAll('.pie-slice').forEach(el => {
      el.addEventListener('click', () => opts.onSliceClick(el.getAttribute('data-label')));
    });
  }
}

// ---------- Simple dependency-free SVG line chart (category on X axis) ----------
function drawLineChart(container, data, opts = {}) {
  data = (data || []).filter(d => d.value >= 0);
  if (!data.length || !data.some(d => d.value > 0)) {
    container.innerHTML = '<div class="empty-state">No data to display yet.</div>';
    return;
  }
  const w = opts.width || 640;
  const titleH = opts.title ? 26 : 0;
  const axisLabelH = opts.xLabel ? 20 : 0;
  const h = (opts.height || 320) + titleH + axisLabelH;
  const padTop = 50 + titleH;
  const padBottom = 50 + axisLabelH;
  const pad = 50;
  const max = Math.max(...data.map(d => d.value), 1);
  const stepX = (w - pad * 2) / Math.max(data.length - 1, 1);

  const points = data.map((d, i) => {
    const x = pad + i * stepX;
    const y = h - padBottom - ((h - padTop - padBottom) * d.value) / max;
    return { x, y, d };
  });
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const dots = points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="4" fill="#2f6fed" data-label="${escapeHtml(p.d.label)}" class="pie-slice" style="cursor:pointer;"></circle>
      <text x="${p.x}" y="${p.y - 10}" font-size="9" text-anchor="middle" fill="#2b2f36" font-weight="600">${fmtMoney(p.d.value)}</text>
      <text x="${p.x}" y="${h - padBottom + 14}" font-size="9" text-anchor="middle" fill="#2b2f36">${escapeHtml(truncateLabel(p.d.label, 8))}</text>`).join('');

  const titleSvg = opts.title ? `<text x="${w / 2}" y="18" font-size="13" font-weight="700" text-anchor="middle" fill="#1c3b6e">${escapeHtml(opts.title)}</text>` : '';
  const xLabelSvg = opts.xLabel ? `<text x="${w / 2}" y="${h - 6}" font-size="10" text-anchor="middle" fill="#5a6270">${escapeHtml(opts.xLabel)}</text>` : '';
  const yLabelSvg = opts.yLabel ? `<text x="12" y="${padTop + (h - padTop - padBottom) / 2}" font-size="10" text-anchor="middle" fill="#5a6270" transform="rotate(-90, 12, ${padTop + (h - padTop - padBottom) / 2})">${escapeHtml(opts.yLabel)}</text>` : '';

  container.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="max-width:100%;">
      ${titleSvg}
      <line x1="${pad}" y1="${padTop - 10}" x2="${pad}" y2="${h - padBottom}" stroke="#666"></line>
      <line x1="${pad}" y1="${h - padBottom}" x2="${w - pad}" y2="${h - padBottom}" stroke="#666"></line>
      <path d="${linePath}" fill="none" stroke="#2f6fed" stroke-width="2"></path>
      ${dots}
      ${xLabelSvg}
      ${yLabelSvg}
    </svg>`;
  if (opts.onSliceClick) {
    container.querySelectorAll('.pie-slice').forEach(el => {
      el.addEventListener('click', () => opts.onSliceClick(el.getAttribute('data-label')));
    });
  }
}

function truncateLabel(label, max = 12) {
  const s = String(label || '');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// Dispatches to the right chart renderer for a chosen chart type (pie | column | bar | line)
function drawChart(container, data, type, opts = {}) {
  if (type === 'column') return drawBarChart(container, data, { ...opts, horizontal: false });
  if (type === 'bar') return drawBarChart(container, data, { ...opts, horizontal: true });
  if (type === 'line') return drawLineChart(container, data, opts);
  return drawPieChart(container, data, opts);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
}

// ---------- Cursor auto-advance ----------
// Wires up a container so pressing Enter in any field tagged with the
// "enter-nav" class jumps the cursor straight to the next field that still
// needs to be filled in, in on-screen order, instead of doing nothing or
// submitting the form early. Enter on the very last field runs onLast (e.g.
// trigger the Save/Submit button) if one is given, otherwise it's a no-op.
function enableEnterNav(container, onLast) {
  if (!container || container.__enterNavBound) return;
  container.__enterNavBound = true;
  container.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    const target = e.target;
    if (!target.classList || !target.classList.contains('enter-nav')) return;
    if (target.tagName === 'TEXTAREA') return; // allow multi-line fields to keep their own Enter behavior
    e.preventDefault();
    const navEls = [...container.querySelectorAll('.enter-nav')]
      .filter(el => !el.disabled && el.offsetParent !== null); // skip hidden/removed fields
    const idx = navEls.indexOf(target);
    if (idx > -1 && idx < navEls.length - 1) {
      const next = navEls[idx + 1];
      next.focus();
      if (next.select) next.select();
    } else if (onLast) {
      onLast();
    }
  });
}
