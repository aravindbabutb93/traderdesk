(async () => {
  const { api, categoryPicker, checks, flash, REGION_LABELS } = MN;
  const $ = (id) => document.getElementById(id);
  const me = await api('/api/me');
  const p = me.user.prefs;
  $('who').textContent = `${me.user.name} (${me.user.username})`;
  MN.nav($('nav'), me.user, 'settings');

  const getCats = categoryPicker($('cats'), me.options.categories, p.categories);
  const getRegions = checks($('regions'), me.options.regions, p.regions, REGION_LABELS);
  const getCcys = checks($('ccys'), me.options.ccys, p.ccys);
  $('minImpact').value = p.minImpact;
  $('watchOnly').checked = p.watchOnly;

  $('chatId').value = p.telegramChatId;
  $('alertMin').value = p.alertMinImpact;
  $('alertWatch').checked = p.alertWatchMedium;
  $('calAlerts').checked = p.calendarAlerts;
  $('tgHint').innerHTML = me.telegramBot
    ? 'Open Telegram, message the TradeDesk bot once (ask the admin for its name), then message <b>@userinfobot</b> to get your chat ID and paste it here. Alerts follow your categories above.'
    : 'The admin has not set up the Telegram bot yet (TELEGRAM_BOT_TOKEN in .env). You can still save your chat ID now.';

  $('newsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const regions = getRegions();
    if (!regions.length) return flash($('newsMsg'), 'Pick at least one region', false);
    try {
      await api('/api/me/prefs', { method: 'PUT', body: { prefs: { categories: getCats(), regions, ccys: getCcys(), minImpact: $('minImpact').value, watchOnly: $('watchOnly').checked } } });
      flash($('newsMsg'), 'Saved. Your feed is updated.');
    } catch (err) { flash($('newsMsg'), err.message, false); }
  });

  $('tgForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const chat = $('chatId').value.trim();
    if (chat && !/^-?\d{1,20}$/.test(chat)) return flash($('tgMsg'), 'Chat ID is a number, like 123456789', false);
    try {
      await api('/api/me/prefs', { method: 'PUT', body: { prefs: { telegramChatId: chat, alertMinImpact: $('alertMin').value, alertWatchMedium: $('alertWatch').checked, calendarAlerts: $('calAlerts').checked } } });
      flash($('tgMsg'), 'Saved');
    } catch (err) { flash($('tgMsg'), err.message, false); }
  });

  $('tgTest').addEventListener('click', async () => {
    try { const r = await api('/api/telegram/test', { method: 'POST' }); flash($('tgMsg'), r.message, r.ok); }
    catch (err) { flash($('tgMsg'), err.message, false); }
  });

  $('pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if ($('pwNew').value !== $('pwNew2').value) return flash($('pwMsg'), 'New passwords do not match', false);
    try {
      await api('/api/me/password', { method: 'POST', body: { current: $('pwCur').value, password: $('pwNew').value } });
      e.target.reset();
      flash($('pwMsg'), 'Password changed. Other devices are signed out.');
    } catch (err) { flash($('pwMsg'), err.message, false); }
  });
})();
