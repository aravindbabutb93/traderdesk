(async () => {
  const { api, esc, categoryPicker, flash } = MN;
  const $ = (id) => document.getElementById(id);
  const me = await api('/api/me');
  if (me.user.role !== 'admin') return (location.href = '/');
  MN.nav($('nav'), me.user, 'admin');
  $('who').textContent = me.user.name;
  const cats = me.options.categories;
  const catLabel = Object.fromEntries(cats.map((c) => [c.id, c.label]));
  const fmt = (ts) => ts ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ts)) : '—';
  let list = [];

  async function load() {
    list = await api('/api/admin/users');
    const active = list.filter((u) => u.active).length;
    $('summary').textContent = `${list.length} user(s) · ${active} active · ${list.filter((u) => u.role === 'admin').length} admin`;
    $('rows').innerHTML = list.map((u) => `
      <tr class="${u.active ? '' : 'off'}">
        <td>${esc(u.name)}${u.id === me.user.id ? ' <span class="muted small">(you)</span>' : ''}</td>
        <td>${esc(u.username)}</td>
        <td><span class="pill ${u.role}">${u.role}</span>${u.active ? '' : ' <span class="pill">disabled</span>'}</td>
        <td class="small">${u.prefs.categories.length ? u.prefs.categories.map((c) => esc(catLabel[c] || c)).join(', ') : '<span class="muted">All</span>'}</td>
        <td class="small">${u.prefs.telegramChatId ? '✓' : '<span class="muted">—</span>'}</td>
        <td class="small muted">${fmt(u.lastLogin)}</td>
        <td><div class="acts">
          <button type="button" class="ghost" data-edit="${u.id}">Edit</button>
          <button type="button" class="ghost" data-toggle="${u.id}">${u.active ? 'Disable' : 'Enable'}</button>
          ${u.id === me.user.id ? '' : `<button type="button" class="danger" data-del="${u.id}">Delete</button>`}
        </div></td>
      </tr>`).join('');
  }

  // ---- add ----
  const getAddCats = categoryPicker($('aCats'), cats, []);
  $('genPw').addEventListener('click', () => {
    const a = new Uint8Array(9); crypto.getRandomValues(a);
    $('aPass').value = btoa(String.fromCharCode(...a)).replace(/[+/=]/g, '').slice(0, 12);
  });
  $('addForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const u = await api('/api/admin/users', { method: 'POST', body: {
        name: $('aName').value, username: $('aUser').value, password: $('aPass').value, role: $('aRole').value,
        prefs: { categories: getAddCats() },
      } });
      flash($('addMsg'), `Added ${u.username}. Share the password with them; they can change it in Settings.`);
      $('aName').value = ''; $('aUser').value = ''; $('aPass').value = '';
      $('aCats').querySelectorAll('input').forEach((i) => { i.checked = false; });
      load();
    } catch (err) { flash($('addMsg'), err.message, false); }
  });

  // ---- row actions ----
  let editing = null, getEditCats = null;
  $('rows').addEventListener('click', async (e) => {
    const d = e.target.dataset;
    try {
      if (d.edit) {
        editing = list.find((u) => u.id === d.edit);
        $('eTitle').textContent = `Edit ${editing.username}`;
        $('eName').value = editing.name; $('eRole').value = editing.role;
        $('ePass').value = ''; $('eActive').checked = editing.active; $('eMsg').textContent = '';
        getEditCats = categoryPicker($('eCats'), cats, editing.prefs.categories);
        $('editDlg').showModal();
      } else if (d.toggle) {
        const u = list.find((x) => x.id === d.toggle);
        await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } });
        load();
      } else if (d.del) {
        const u = list.find((x) => x.id === d.del);
        if (!confirm(`Delete ${u.username}? This removes their settings and watchlist.`)) return;
        await api(`/api/admin/users/${u.id}`, { method: 'DELETE' });
        load();
      }
    } catch (err) { alert(err.message); }
  });

  $('eCancel').addEventListener('click', () => $('editDlg').close());
  $('editForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { name: $('eName').value, role: $('eRole').value, active: $('eActive').checked, prefs: { categories: getEditCats() } };
    if ($('ePass').value) body.password = $('ePass').value;
    try {
      await api(`/api/admin/users/${editing.id}`, { method: 'PATCH', body });
      $('editDlg').close();
      load();
    } catch (err) { flash($('eMsg'), err.message, false); }
  });

  load();
})();
