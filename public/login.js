(async () => {
  const $ = (id) => document.getElementById(id);
  const st = await (await fetch('/api/auth/state')).json();
  if (st.user) return (location.href = '/');
  const setup = st.setupNeeded;
  if (setup) {
    $('title').textContent = 'Create the admin account';
    $('sub').textContent = 'First run. This account can add and manage other users.';
    $('nameRow').hidden = false; $('confirmRow').hidden = false; $('codeRow').hidden = false;
    $('sub').textContent = 'First run. Enter the setup code from the server log (the console or: journalctl -u tradedesk). This account can add and manage other users.';
    $('password').autocomplete = 'new-password';
    $('submit').textContent = 'Create admin';
  }
  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('msg').textContent = '';
    if (setup && $('password').value !== $('confirm').value) return ($('msg').textContent = 'Passwords do not match');
    $('submit').disabled = true;
    try {
      const res = await fetch(setup ? '/api/auth/setup' : '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: $('username').value, password: $('password').value, name: $('name').value, setupCode: $('setupCode').value }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Sign in failed');
      location.href = setup ? '/settings.html' : '/';
    } catch (err) {
      $('msg').textContent = err.message;
    } finally {
      $('submit').disabled = false;
    }
  });
})();
