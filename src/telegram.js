const { istTime, sleep } = require('./utils');

const queue = [];
let busy = false;

// The bot token is shared (set once by the admin in .env); each user sets their own chat ID.
const enabled = () => Boolean(process.env.TELEGRAM_BOT_TOKEN);

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function drain() {
  if (busy) return;
  busy = true;
  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  while (queue.length) {
    const { text, chatId } = queue.shift();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });
      if (res.status === 429) {
        const j = await res.json().catch(() => ({}));
        queue.unshift({ text, chatId });
        await sleep(((j.parameters && j.parameters.retry_after) || 5) * 1000);
        continue;
      }
      if (!res.ok) console.warn('[telegram]', res.status, (await res.text()).slice(0, 200));
    } catch (e) {
      console.warn('[telegram]', e.message);
    }
    // Telegram allows ~30 msg/s overall and ~1 msg/s per chat; keep a short gap
    await sleep(queue.length && queue[0].chatId === chatId ? 1050 : 40);
  }
  busy = false;
}

function send(text, chatId) {
  if (!enabled() || !chatId) return false;
  queue.push({ text, chatId: String(chatId) });
  drain();
  return true;
}

const IMPACT_ICON = { High: '🔴', Medium: '🟠', Low: '⚪' };
const SENT_ICON = { bullish: '▲', bearish: '▼', neutral: '' };

function formatNews(item, labels = {}) {
  const tags = [
    item.regions.join('/'),
    ...item.categories.map((c) => labels[c] || c),
    ...item.watch.map((s) => `#${s}`),
  ].join(' · ');
  return [
    `${IMPACT_ICON[item.impact]} <b>${item.impact}</b> ${SENT_ICON[item.sentiment]}  ${esc(tags)}`,
    `<b>${esc(item.title)}</b>`,
    `<i>${esc(item.source)} · ${istTime(item.publishedAt)} IST</i>`,
    item.link ? `<a href="${esc(item.link)}">Open article</a>` : '',
  ].filter(Boolean).join('\n');
}

function formatEvent(ev, minutes) {
  const extra = [ev.forecast && `F: ${ev.forecast}`, ev.previous && `P: ${ev.previous}`].filter(Boolean).join('  ');
  return `⏰ <b>${esc(ev.country)} – ${esc(ev.title)}</b>\nin ${minutes} min · ${istTime(ev.time, true)} IST${extra ? `\n${esc(extra)}` : ''}`;
}

module.exports = { enabled, send, formatNews, formatEvent };
