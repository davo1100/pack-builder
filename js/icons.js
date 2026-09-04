const IconLibrary = {
  items: {},

  async load() {
    if (Object.keys(this.items).length) return this.items;
    const res = await fetch("/data/icons.json");
    this.items = await res.json();
    return this.items;
  },

  html(name, size) {
    const spec = this.items[name];
    if (!spec) return "";
    const px = size || 22;
    return (
      `<span class="pack-icon" data-icon="${name}" contenteditable="false" aria-hidden="true">` +
      `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
      `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${spec.svg}</svg></span>`
    );
  },

  list() {
    return Object.entries(this.items).map(([name, spec]) => ({ name, ...spec }));
  },

  grouped(query) {
    const needle = (query || "").trim().toLowerCase();
    const groups = new Map();
    for (const item of this.list()) {
      const hay = `${item.name} ${item.label} ${item.group}`.toLowerCase();
      if (needle && !hay.includes(needle)) continue;
      if (!groups.has(item.group)) groups.set(item.group, []);
      groups.get(item.group).push(item);
    }
    return groups;
  },
};
