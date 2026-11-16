const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'news.json');

class Store {
  constructor({ maxItems = 3000, retentionDays = 7 } = {}) {
    this.items = new Map();
    this.links = new Set();
    this.maxItems = maxItems;
    this.retentionMs = retentionDays * 24 * 3600 * 1000;
    this._timer = null;
  }

  load() {
    try {
      const arr = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      for (const it of arr) this._put(it);
      console.log(`[store] loaded ${this.items.size} saved items`);
    } catch {
      /* first run */
    }
    this.prune();
  }

  _put(it) {
    this.items.set(it.id, it);
    if (it.link) this.links.add(it.link);
  }

  has(item) {
    return this.items.has(item.id) || (item.link && this.links.has(item.link));
  }

  add(item) {
    if (this.has(item)) return false;
    this._put(item);
    this._scheduleSave();
    return true;
  }

  all() {
    return [...this.items.values()];
  }

  list(limit = 500) {
    return this.all().sort((a, b) => b.publishedAt - a.publishedAt).slice(0, limit);
  }

  prune() {
    const cutoff = Date.now() - this.retentionMs;
    for (const [id, it] of this.items) {
      if (it.publishedAt < cutoff) this._remove(id, it);
    }
    if (this.items.size > this.maxItems) {
      const oldest = this.all().sort((a, b) => a.publishedAt - b.publishedAt);
      for (const it of oldest.slice(0, this.items.size - this.maxItems)) this._remove(it.id, it);
    }
  }

  _remove(id, it) {
    this.items.delete(id);
    if (it.link) this.links.delete(it.link);
    this._scheduleSave();
  }

  _scheduleSave() {
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this.save();
    }, 2000);
  }

  save() {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.list(this.maxItems)));
      fs.renameSync(tmp, FILE);
    } catch (e) {
      console.warn('[store] save failed:', e.message);
    }
  }
}

module.exports = Store;
