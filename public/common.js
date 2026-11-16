// Shared helpers for the settings and admin pages
window.MN = (() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(url, opts = {}) {
    const res = await fetch(url, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
    });
    if (res.status === 401) { location.href = '/login.html'; throw new Error('Signed out'); }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`);
    return j;
  }

  // Category checkboxes grouped as "Market moving" / "Sector". Nothing ticked = all news.
  function categoryPicker(el, categories, selected = []) {
    const groups = [...new Set(categories.map((c) => c.group))];
    el.innerHTML = groups.map((g) => `
      <div class="cat-group">
        <h3>${esc(g)} <button type="button" data-all="${esc(g)}">select all</button><button type="button" data-none="${esc(g)}">clear</button></h3>
        <div class="check-grid">
          ${categories.filter((c) => c.group === g).map((c) => `
            <label><input type="checkbox" value="${esc(c.id)}" data-group="${esc(g)}" ${selected.includes(c.id) ? 'checked' : ''}/> ${esc(c.label)}</label>`).join('')}
        </div>
      </div>`).join('');
    el.addEventListener('click', (e) => {
      const g = e.target.dataset.all || e.target.dataset.none;
      if (!g) return;
      el.querySelectorAll(`input[data-group="${CSS.escape(g)}"]`).forEach((i) => { i.checked = Boolean(e.target.dataset.all); });
    });
    return () => [...el.querySelectorAll('input:checked')].map((i) => i.value);
  }

  function checks(el, values, selected, labels = {}) {
    el.innerHTML = values.map((v) => `<label><input type="checkbox" value="${esc(v)}" ${selected.includes(v) ? 'checked' : ''}/> ${esc(labels[v] || v)}</label>`).join('');
    return () => [...el.querySelectorAll('input:checked')].map((i) => i.value);
  }

  function flash(el, text, ok = true) {
    el.className = `msg ${ok ? 'ok' : 'err'}`;
    el.textContent = text;
    if (ok) setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 3000);
  }

  const REGION_LABELS = { IN: 'India', US: 'US', GLOBAL: 'Global', FX: 'Forex' };

  // Top navigation shared by every page
  function nav(el, user, active) {
    const links = [['news', '/', '📰 News'], ['journal', '/journal.html', '📒 Journal'], ['settings', '/settings.html', '⚙ Settings']];
    if (user.role === 'admin') links.push(['admin', '/admin.html', '👥 Admin']);
    el.innerHTML = links.map(([k, href, label]) => `<a class="btn ghost ${k === active ? 'on' : ''}" href="${href}">${label}</a>`).join('') +
      `<span class="user muted">${esc(user.name)}</span><button type="button" class="ghost" id="navLogout">Sign out</button>`;
    el.querySelector('#navLogout').onclick = async () => { await fetch('/api/auth/logout', { method: 'POST' }); location.href = '/login.html'; };
  }

  return { esc, api, categoryPicker, checks, flash, nav, REGION_LABELS };
})();
