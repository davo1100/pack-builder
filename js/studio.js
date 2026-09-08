const state = {
  docs: [],
  selected: null,
  tab: "preview",
  lastHtml: "",
  clientCss: "",
  previewTimer: null,
  previewUrl: "",
  useImportedPreview: false,
};

const els = {
  status: document.getElementById("status"),
  dropzone: document.getElementById("dropzone"),
  fileInput: document.getElementById("file-input"),
  fileList: document.getElementById("file-list"),
  preview: document.getElementById("preview"),
  editor: document.getElementById("editor"),
  editorHint: document.getElementById("editor-hint"),
  workspacePreview: document.getElementById("workspace-preview"),
  workspaceEdit: document.getElementById("workspace-edit"),
  btnPreview: document.getElementById("btn-preview"),
  btnDownload: document.getElementById("btn-download"),
  btnAddPage: document.getElementById("btn-add-page"),
  btnImportLocal: document.getElementById("btn-import-local"),
  panelLeft: document.getElementById("panel-left"),
  btnCollapseNav: document.getElementById("btn-collapse-nav"),
  pageTitle: document.getElementById("page-title"),
  headerDoc: document.getElementById("header-doc"),
  logoUrl: document.getElementById("logo-url"),
  logoAlt: document.getElementById("logo-alt"),
  faviconUrl: document.getElementById("favicon-url"),
  faviconFile: document.getElementById("favicon-file"),
  faviconChoose: document.getElementById("favicon-choose"),
  faviconPreview: document.getElementById("favicon-preview"),
  confidential: document.getElementById("confidential"),
  footer: document.getElementById("footer"),
  outputFilename: document.getElementById("output-filename"),
};

function setStatus(text, kind) {
  els.status.textContent = text || "";
  els.status.className = "status" + (kind ? " " + kind : "");
}

const NAV_COLLAPSED_KEY = "pack-builder-nav-collapsed";

function navCollapsed() {
  return document.querySelector(".studio-app")?.classList.contains("nav-collapsed");
}

function setNavCollapsed(collapsed) {
  const app = document.querySelector(".studio-app");
  if (!app || !els.btnCollapseNav) return;
  app.classList.toggle("nav-collapsed", collapsed);
  const label = collapsed ? "Show files panel" : "Hide files panel";
  els.btnCollapseNav.setAttribute("aria-expanded", collapsed ? "false" : "true");
  els.btnCollapseNav.setAttribute("aria-label", label);
  els.btnCollapseNav.title = label;
  try {
    localStorage.setItem(NAV_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch (_) {}
}

try {
  if (localStorage.getItem(NAV_COLLAPSED_KEY) === "1") setNavCollapsed(true);
} catch (_) {}

IconLibrary.load().catch(() => {});

fetch("/api/config")
  .then((res) => (res.ok ? res.json() : { hosted: false }))
  .then((cfg) => {
    if (cfg.hosted && els.btnImportLocal) els.btnImportLocal.hidden = true;
  })
  .catch(() => {});

function uid() {
  return "doc-" + Math.random().toString(36).slice(2, 9);
}

function px(id, fallback) {
  const raw = document.getElementById(id).value.trim().replace(/px$/i, "");
  const num = Number(raw);
  return Number.isFinite(num) && num > 0 ? `${Math.round(num)}px` : fallback;
}

function themePayload() {
  return {
    magenta: document.getElementById("theme-magenta").value,
    cream: document.getElementById("theme-cream").value,
    olive: document.getElementById("theme-olive").value,
    charcoal: document.getElementById("theme-charcoal").value,
    violet: document.getElementById("theme-violet").value,
    taupe: document.getElementById("theme-taupe").value,
    white: document.getElementById("theme-white").value,
    peach: document.getElementById("theme-peach").value,
    font_body: document.getElementById("theme-font").value,
    content_max_width: px("theme-content-width", "1100px"),
    sidebar_width: px("theme-sidebar-width", "280px"),
    radius: px("theme-radius", "14px"),
  };
}

function themeOverrideCss() {
  const t = themePayload();
  return `:root {
    --eden-magenta: ${t.magenta};
    --olive: ${t.olive};
    --charcoal: ${t.charcoal};
    --cream: ${t.cream};
    --violet: ${t.violet};
    --taupe: ${t.taupe};
    --white: ${t.white};
    --peach: ${t.peach};
    --font-body: ${t.font_body};
    --sidebar-w: ${t.sidebar_width};
    --radius-md: ${t.radius};
    --content-max-width: ${t.content_max_width};
    --color-brand: var(--eden-magenta);
    --color-text: var(--olive);
    --color-text-strong: var(--charcoal);
    --color-text-muted: var(--taupe);
    --color-bg: var(--cream);
    --color-link: var(--eden-magenta);
  }
  .content { max-width: ${t.content_max_width}; }`;
}

function toColorInput(value) {
  const raw = String(value || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
  }
  return "";
}

function applyIncomingSettings(settings) {
  if (!settings || typeof settings !== "object") return;
  if (settings.page_title && els.pageTitle) els.pageTitle.value = settings.page_title;
  if (settings.header_doc && els.headerDoc) els.headerDoc.value = settings.header_doc;
  if (settings.logo_url && els.logoUrl) els.logoUrl.value = settings.logo_url;
  if (settings.logo_alt && els.logoAlt) els.logoAlt.value = settings.logo_alt;
  if ("favicon_url" in settings && els.faviconUrl) els.faviconUrl.value = settings.favicon_url || "";
  if ("confidential" in settings && els.confidential) els.confidential.checked = Boolean(settings.confidential);
  if (settings.footer && els.footer) els.footer.value = settings.footer;
  if (settings.output_filename && els.outputFilename) els.outputFilename.value = settings.output_filename;
  const theme = settings.theme || {};
  const colors = {
    magenta: "theme-magenta",
    cream: "theme-cream",
    olive: "theme-olive",
    charcoal: "theme-charcoal",
    violet: "theme-violet",
    taupe: "theme-taupe",
    white: "theme-white",
    peach: "theme-peach",
  };
  for (const [key, id] of Object.entries(colors)) {
    const hex = toColorInput(theme[key]);
    if (hex) document.getElementById(id).value = hex;
  }
  if (theme.font_body) document.getElementById("theme-font").value = theme.font_body;
  if (theme.content_max_width) {
    document.getElementById("theme-content-width").value = String(theme.content_max_width).replace(/px$/i, "");
  }
  if (theme.sidebar_width) {
    document.getElementById("theme-sidebar-width").value = String(theme.sidebar_width).replace(/px$/i, "");
  }
  if (theme.radius) {
    document.getElementById("theme-radius").value = String(theme.radius).replace(/px$/i, "");
  }
  PackEditor.applyTheme(themeOverrideCss());
  syncFaviconPreview();
}

function settingsPayload() {
  return {
    page_title: els.pageTitle.value.trim(),
    header_doc: els.headerDoc.value.trim(),
    logo_url: els.logoUrl.value.trim(),
    logo_alt: els.logoAlt.value.trim(),
    favicon_url: els.faviconUrl?.value.trim() || "",
    confidential: els.confidential.checked,
    footer: els.footer.value,
    output_filename: els.outputFilename.value.trim() || "documentation.html",
    theme: themePayload(),
  };
}

const FAVICON_MAX_BYTES = 512 * 1024;

function isFaviconFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  return (
    /\.(ico|png|svg|gif|webp|jpe?g)$/i.test(name) ||
    type.includes("icon") ||
    ["image/png", "image/svg+xml", "image/gif", "image/webp", "image/jpeg", "image/x-icon"].includes(type)
  );
}

function faviconDataUrl(file, dataUrl) {
  const value = String(dataUrl || "");
  if (/^data:image\//i.test(value)) return value;
  const raw = value.split(",")[1];
  if (!raw) return value;
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  if (name.endsWith(".ico") || type.includes("icon")) return `data:image/x-icon;base64,${raw}`;
  if (name.endsWith(".svg") || type === "image/svg+xml") return `data:image/svg+xml;base64,${raw}`;
  if (name.endsWith(".png") || type === "image/png") return `data:image/png;base64,${raw}`;
  if (name.endsWith(".webp") || type === "image/webp") return `data:image/webp;base64,${raw}`;
  if (/\.jpe?g$/i.test(name) || type === "image/jpeg") return `data:image/jpeg;base64,${raw}`;
  if (name.endsWith(".gif") || type === "image/gif") return `data:image/gif;base64,${raw}`;
  return value;
}

function syncFaviconPreview() {
  const preview = els.faviconPreview;
  if (!preview) return;
  const src = els.faviconUrl?.value.trim() || els.logoUrl?.value.trim() || "";
  if (!src || /^(javascript:|vbscript:|data:text)/i.test(src)) {
    preview.hidden = true;
    preview.removeAttribute("src");
    return;
  }
  preview.src = src;
  preview.hidden = false;
}

function readFaviconFile(file) {
  if (!isFaviconFile(file)) {
    setStatus("Use an .ico, .png, .svg, .gif, or .webp icon", "error");
    return;
  }
  if (file.size > FAVICON_MAX_BYTES) {
    setStatus("Tab icons must be 512 KB or smaller", "error");
    return;
  }
  readAsDataURL(file)
    .then((dataUrl) => {
      els.faviconUrl.value = faviconDataUrl(file, dataUrl);
      syncFaviconPreview();
      schedulePreview();
      setStatus("Browser tab icon updated", "ok");
    })
    .catch(() => setStatus("Could not read that icon", "error"));
}

function buildPayload() {
  flushEditor();
  return {
    settings: settingsPayload(),
    docs: state.docs.map((doc) => ({
      filename: doc.filename,
      title: decodeEntities(doc.title),
      role: doc.role,
      include: doc.include,
      draft: doc.draft,
      num: chapterNum(doc.num),
      body: String(doc.body || "").replaceAll("&amp;amp;", "&amp;"),
    })),
  };
}

function sortDocs() {
  state.docs.sort((a, b) => {
    if (a.role === "overview" && b.role !== "overview") return -1;
    if (b.role === "overview" && a.role !== "overview") return 1;
    const an = a.num || "";
    const bn = b.num || "";
    if (an && bn && an !== bn) return an.localeCompare(bn, undefined, { numeric: true });
    if (an && !bn) return -1;
    if (!an && bn) return 1;
    return 0;
  });
}

function chapterNum(value) {
  const raw = String(value || "").trim();
  return /^\d{1,2}$/.test(raw) ? raw.padStart(2, "0") : "";
}

function pinOverviews() {
  const overviews = state.docs.filter((d) => d.role === "overview");
  const rest = state.docs.filter((d) => d.role !== "overview");
  state.docs = overviews.concat(rest);
}

function renumberChapters() {
  let n = 1;
  for (const doc of state.docs) {
    if (doc.role === "overview") {
      if (!doc.num) doc.num = "00";
      continue;
    }
    doc.num = String(n).padStart(2, "0");
    n += 1;
  }
}

function mergeIncoming(docs, options = {}) {
  flushEditor();
  let lastId = null;
  for (const incoming of docs) {
    const existing = state.docs.find((d) => d.filename === incoming.filename);
    const next = {
      id: existing?.id || uid(),
      filename: incoming.filename,
      title: decodeEntities(incoming.title || existing?.title || incoming.filename),
      role: incoming.role,
      include: incoming.include !== false,
      draft: Boolean(incoming.draft),
      num: chapterNum(incoming.num) || chapterNum(existing?.num) || "",
      body: String(incoming.body || "").replaceAll("&amp;amp;", "&amp;"),
    };
    if (existing) {
      Object.assign(existing, next, { id: existing.id, body: incoming.body || existing.body });
      lastId = existing.id;
    } else {
      state.docs.push(next);
      lastId = next.id;
    }
  }
  sortDocs();
  if (state.docs.some((doc) => doc.role !== "overview" && !chapterNum(doc.num))) {
    renumberChapters();
  }
  if (lastId) state.selected = lastId;
  else if (!state.selected && state.docs.length) state.selected = state.docs[0].id;
  pinOverviews();
  rebuildContentsFromMenu();
  renderList();
  els.btnDownload.disabled = !state.docs.some((d) => d.include);
  if (state.tab === "edit") loadEditor();
  if (state.tab === "preview") revealPreviewSelection();
  if (!options.skipPreview) schedulePreview();
  return Promise.resolve();
}

function syncOverview(options) {
  if (!state.docs.length) return Promise.resolve();
  if (!options?.skipFlush) flushEditor();
  const overview = rebuildContentsFromMenu();
  pinOverviews();
  renderList();
  if (overview && state.selected === overview.id && state.tab === "edit") loadEditor();
  return Promise.resolve();
}

const CONTENTS_TITLE_ICONS = [
  ["spend amount", "clock"],
  ["amount limit", "clock"],
  ["spend count", "clipboard"],
  ["count limit", "clipboard"],
  ["time restriction", "clock"],
  ["time-of-day", "clock"],
  ["date restriction", "calendar"],
  ["calendar date", "calendar"],
  ["acceptance method", "credit-card"],
  ["country code", "globe"],
  ["country", "globe"],
  ["merchant", "store"],
  ["spend", "sliders"],
  ["account holder", "user"],
  ["accountholder", "user"],
  ["organisation", "building"],
  ["organization", "building"],
  ["onboard", "user-plus"],
  ["card", "credit-card"],
  ["transaction", "receipt"],
  ["search", "search"],
  ["provision", "smartphone"],
  ["wallet", "wallet"],
  ["google", "smartphone"],
  ["apple", "smartphone"],
  ["account", "building"],
  ["api", "code"],
  ["architecture", "layers"],
  ["overview", "layers"],
  ["flow", "git-branch"],
];

function menuChapters() {
  return state.docs.filter((doc) => doc.include && doc.role !== "overview");
}

function iconForTitle(title) {
  const hay = String(title || "").toLowerCase();
  for (const [token, name] of CONTENTS_TITLE_ICONS) {
    if (hay.includes(token)) return name;
  }
  return "file-text";
}

function pageSummary(doc) {
  const body = String(doc.body || "");
  for (const match of body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = decodeEntities(match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
    if (text.length < 28) continue;
    const lowered = text.toLowerCase();
    if (lowered.startsWith("author:") || lowered.startsWith("created by") || lowered.startsWith("last modified") || lowered.startsWith("imported from")) {
      continue;
    }
    return text.length > 220 ? `${text.slice(0, 217).replace(/\s+\S*$/, "")}…` : text;
  }
  const headings = [];
  for (const match of body.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)) {
    const label = decodeEntities(match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " "))
      .replace(/^\d+(?:\.\d+)*[.)]?\s*/, "")
      .trim();
    if (label) headings.push(label);
    if (headings.length === 3) break;
  }
  if (headings.length) return `Includes ${headings.join(", ")}.`;
  return `Open the ${doc.title} section.`;
}

function pageTags(doc) {
  const tags = [];
  const seen = new Set();
  const body = String(doc.body || "");
  for (const match of body.matchAll(/class="api-label">API<\/span>\s*<span class="api-value">([\s\S]*?)<\/span>/gi)) {
    const text = decodeEntities(match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    tags.push(text);
    if (tags.length === 3) break;
  }
  return tags;
}

function contentsCardHtml(doc) {
  const status = doc.draft
    ? '<span class="card-status status-draft">Draft</span>'
    : '<span class="card-status status-current">Current</span>';
  const tags = pageTags(doc);
  const tagHtml = tags.length
    ? `<div class="card-tags">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>`
    : "";
  const icon = typeof IconLibrary !== "undefined" ? IconLibrary.html(iconForTitle(doc.title), 18) : "";
  const arrow = typeof IconLibrary !== "undefined" ? IconLibrary.html("arrow-right", 16) : "";
  return (
    `<div class="card" data-page-id="${escapeAttr(doc.filename)}" data-flow="${escapeAttr(chapterNum(doc.num))}">` +
    "<div>" +
    `<div class="card-header"><span class="card-num">${escapeHtml(chapterNum(doc.num))}</span>${status}</div>` +
    `<h3>${icon} ${escapeHtml(doc.title)}</h3>` +
    `<p>${escapeHtml(pageSummary(doc))}</p>${tagHtml}` +
    "</div>" +
    `<a class="btn-link" href="#${escapeAttr(packAnchorFor(doc))}"><span>Open section</span> ${arrow}</a>` +
    "</div>"
  );
}

function cardTitleText(card) {
  const heading = card.querySelector("h3");
  if (!heading) return "";
  const clone = heading.cloneNode(true);
  clone.querySelectorAll(".pack-icon, svg").forEach((node) => node.remove());
  return decodeEntities(clone.textContent).replace(/\s+/g, " ").trim();
}

function takeMatchingCard(cards, doc) {
  const filename = String(doc.filename || "").toLowerCase();
  const num = chapterNum(doc.num);
  const title = decodeEntities(doc.title || "").toLowerCase();
  const hrefs = new Set([filename].filter(Boolean));
  const tests = [
    (card) => String(card.getAttribute("data-page-id") || "").toLowerCase() === filename,
    (card) => hrefs.has(String(card.querySelector("a[href]")?.getAttribute("href") || "").replace(/^#/, "").toLowerCase())
      || String(card.getAttribute("data-flow") || "") === num && cardTitleText(card).toLowerCase() === title,
    (card) => String(card.querySelector(".card-num")?.textContent || "").trim().padStart(2, "0") === num
      && cardTitleText(card).toLowerCase() === title,
  ];
  for (const test of tests) {
    const index = cards.findIndex(test);
    if (index >= 0) return cards.splice(index, 1)[0];
  }
  const titled = cards.filter((card) => cardTitleText(card).toLowerCase() === title);
  if (titled.length === 1) {
    cards.splice(cards.indexOf(titled[0]), 1);
    return titled[0];
  }
  return null;
}

function refreshContentsCard(card, doc) {
  card.setAttribute("data-page-id", doc.filename);
  card.setAttribute("data-flow", chapterNum(doc.num));
  const num = card.querySelector(".card-num");
  if (num) num.textContent = chapterNum(doc.num);
  const status = card.querySelector(".card-status");
  if (status && !status.hasAttribute("data-custom")) {
    status.className = `card-status ${doc.draft ? "status-draft" : "status-current"}`;
    status.textContent = doc.draft ? "Draft" : "Current";
  }
  const link = card.querySelector("a.btn-link[href], a[href]");
  if (link) link.setAttribute("href", `#${packAnchorFor(doc)}`);
  const heading = card.querySelector("h3");
  if (heading) {
    const icon = heading.querySelector(".pack-icon");
    heading.replaceChildren();
    if (icon) heading.appendChild(icon);
    else if (typeof IconLibrary !== "undefined") {
      heading.insertAdjacentHTML("afterbegin", IconLibrary.html(iconForTitle(doc.title), 18));
    }
    heading.appendChild(document.createTextNode(` ${doc.title}`));
  }
  return card;
}

function overviewHeroHtml(count) {
  const title = (els.pageTitle?.value || "Documentation").split("|")[0].trim() || "Documentation";
  const subtitle = els.headerDoc?.value || "Technical documentation";
  return (
    `<header class="hero"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p>` +
    `<div class="hero-meta"><span><strong>Sections:</strong> ${count}</span></div></header>`
  );
}

function rebuildContentsFromMenu() {
  const chapters = menuChapters();
  let overview = state.docs.find((doc) => doc.role === "overview");
  if (!overview) {
    overview = {
      id: uid(),
      filename: "00_Contents.html",
      title: "Contents",
      role: "overview",
      include: true,
      draft: false,
      num: "00",
      body: "",
    };
    state.docs.unshift(overview);
    if (!state.selected) state.selected = overview.id;
  }
  overview.role = "overview";
  overview.include = true;
  overview.num = overview.num || "00";
  overview.filename = overview.filename || "00_Contents.html";
  if (!overview.title) overview.title = "Contents";

  let body = String(overview.body || "");
  if (!/class=["']hero["']|class=["']page-header["']/.test(body)) {
    body = overviewHeroHtml(chapters.length) + body;
  }
  body = body.replace(/(<strong>Sections:<\/strong> )\d+/, `$1${chapters.length}`);

  const holder = document.createElement("div");
  holder.innerHTML = body;
  let section = holder.querySelector("[data-contents='auto']");
  if (!section) {
    section = document.createElement("div");
    section.className = "overview-section";
    section.setAttribute("data-contents", "auto");
    const listIcon = typeof IconLibrary !== "undefined" ? IconLibrary.html("list") : "";
    section.innerHTML = `<h2>${listIcon} Contents</h2>`;
    holder.appendChild(section);
  }
  const emptyCopy = "Include at least one chapter page to list it here.";
  const introCopy = "Each section of this pack, in reading order, with a short summary and a link to open it.";
  let grid = section.querySelector(".grid");
  if (!chapters.length) {
    if (grid) grid.remove();
    if (![...section.querySelectorAll("p")].some((p) => p.textContent.includes("Include at least one chapter"))) {
      const empty = document.createElement("p");
      empty.textContent = emptyCopy;
      section.appendChild(empty);
    }
    overview.body = holder.innerHTML;
    return overview;
  }
  if (![...section.querySelectorAll("p")].some((p) => p.textContent.includes("in reading order"))) {
    const intro = document.createElement("p");
    intro.textContent = introCopy;
    if (grid) section.insertBefore(intro, grid);
    else section.appendChild(intro);
  }
  [...section.querySelectorAll("p")].forEach((p) => {
    if (p.textContent.includes("Include at least one chapter")) p.remove();
  });
  if (!grid) {
    grid = document.createElement("div");
    grid.className = "grid";
    section.appendChild(grid);
  }
  const unused = [...grid.querySelectorAll(".card")];
  const next = [];
  for (const doc of chapters) {
    const found = takeMatchingCard(unused, doc);
    if (found) next.push(refreshContentsCard(found, doc));
    else {
      const wrap = document.createElement("div");
      wrap.innerHTML = contentsCardHtml(doc);
      if (wrap.firstElementChild) next.push(wrap.firstElementChild);
    }
  }
  grid.replaceChildren(...next);
  overview.body = holder.innerHTML;
  return overview;
}

function renderList() {
  if (!state.docs.length) {
    els.fileList.innerHTML = '<p class="empty file-list-empty">No files yet. Add a blank page or drop files above.</p>';
    return;
  }
  els.fileList.innerHTML = state.docs
    .map((doc) => {
      const selected = doc.id === state.selected ? " selected" : "";
      const excluded = doc.include ? "" : " excluded";
      return `<article class="file-row${selected}${excluded}" data-id="${doc.id}">
        <input type="checkbox" data-act="include" ${doc.include ? "checked" : ""} title="Include in pack">
        <div class="file-main">
          <div class="file-name">${escapeHtml(doc.filename)}</div>
          <input class="file-title" data-act="title" value="${escapeAttr(decodeEntities(doc.title))}">
          <div class="file-meta">
            <label>Role
              <select data-act="role">
                <option value="overview" ${doc.role === "overview" ? "selected" : ""}>Overview</option>
                <option value="chapter" ${doc.role === "chapter" ? "selected" : ""}>Chapter</option>
              </select>
            </label>
            <label>No.
              <input class="num" data-act="num" type="text" value="${escapeAttr(chapterNum(doc.num))}" maxlength="2">
            </label>
            <label><input type="checkbox" data-act="draft" ${doc.draft ? "checked" : ""}> Draft</label>
          </div>
        </div>
        <div class="icon-btns">
          <button type="button" data-act="up" title="Move up">↑</button>
          <button type="button" data-act="down" title="Move down">↓</button>
          <button type="button" data-act="remove" title="Remove">×</button>
        </div>
      </article>`;
    })
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function decodeEntities(value) {
  const holder = document.createElement("textarea");
  holder.innerHTML = String(value || "");
  let text = holder.value;
  if (/&amp;|&#38;|&#x26;/i.test(text)) {
    holder.innerHTML = text;
    text = holder.value;
  }
  return text;
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

function docById(id) {
  return state.docs.find((d) => d.id === id);
}

function packAnchorFor(doc) {
  if (!doc || doc.role === "overview" || !doc.include) return "overview";
  const used = new Set();
  let seq = 1;
  for (const item of state.docs) {
    if (!item.include || item.role === "overview") continue;
    let num = item.num || "";
    if (!num || used.has(num)) {
      while (used.has(String(seq).padStart(2, "0"))) seq += 1;
      num = String(seq).padStart(2, "0");
      seq += 1;
    }
    used.add(num);
    if (item.id === doc.id) return `flow-${num}`;
  }
  return "overview";
}

function revealPreviewSelection() {
  const anchor = packAnchorFor(docById(state.selected));
  const frame = els.preview.contentWindow;
  const frameDoc = els.preview.contentDocument;
  if (!frame || !frameDoc?.getElementById(anchor)) return;
  try {
    if (frame.location.hash !== `#${anchor}`) {
      frame.location.hash = anchor;
    }
  } catch (err) {
    /* ignore */
  }
  frameDoc.getElementById(anchor)?.scrollIntoView({ block: "start" });
}

function moveDoc(id, dir) {
  const index = state.docs.findIndex((d) => d.id === id);
  const next = index + dir;
  if (index < 0 || next < 0 || next >= state.docs.length) return;
  const doc = state.docs[index];
  const other = state.docs[next];
  if (doc.role === "overview" || other.role === "overview") return;
  const [item] = state.docs.splice(index, 1);
  state.docs.splice(next, 0, item);
  renumberChapters();
  syncOverview().then(() => {
    renderList();
    schedulePreview();
  });
}

els.fileList.addEventListener("click", (event) => {
  const row = event.target.closest(".file-row");
  if (!row) return;
  const doc = docById(row.dataset.id);
  if (!doc) return;
  const actEl = event.target.closest("[data-act]");
  const act = actEl && row.contains(actEl) ? actEl.dataset.act : "";
  if (act === "up") return moveDoc(doc.id, -1);
  if (act === "down") return moveDoc(doc.id, 1);
  if (act === "remove") {
    flushEditor();
    state.docs = state.docs.filter((d) => d.id !== doc.id);
    if (state.selected === doc.id) state.selected = state.docs[0]?.id || null;
    syncOverview().then(() => {
      renderList();
      loadEditor();
      schedulePreview();
    });
    return;
  }
  const fromControl = ["include", "draft", "role", "num", "title"].includes(act);
  if (state.selected !== doc.id) {
    flushEditor();
    state.selected = doc.id;
    renderList();
    if (state.tab === "edit") loadEditor();
    if (state.tab === "preview") revealPreviewSelection();
    return;
  }
  if (!fromControl && state.tab === "edit") loadEditor();
  if (!fromControl && state.tab === "preview") revealPreviewSelection();
});

els.fileList.addEventListener("change", (event) => {
  const row = event.target.closest(".file-row");
  if (!row) return;
  const doc = docById(row.dataset.id);
  if (!doc) return;
  const act = event.target.dataset.act;
  if (act === "include") doc.include = event.target.checked;
  if (act === "draft") doc.draft = event.target.checked;
  if (act === "role") {
    doc.role = event.target.value;
    pinOverviews();
  }
  if (act === "num") {
    doc.num = chapterNum(event.target.value);
    sortDocs();
  }
  if (act === "title") doc.title = event.target.value;
  syncOverview().then(() => {
    renderList();
    schedulePreview();
  });
});

els.fileList.addEventListener("input", (event) => {
  const row = event.target.closest(".file-row");
  if (!row) return;
  const doc = docById(row.dataset.id);
  if (!doc) return;
  if (event.target.dataset.act === "title") doc.title = event.target.value;
  if (event.target.dataset.act === "num") doc.num = event.target.value.trim();
});

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function readAllEntries(reader) {
  return new Promise((resolve, reject) => {
    const entries = [];
    const next = () => {
      reader.readEntries((batch) => {
        if (!batch.length) {
          resolve(entries);
          return;
        }
        entries.push(...batch);
        next();
      }, reject);
    };
    next();
  });
}

async function walkEntry(entry, files, prefix) {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    Object.defineProperty(file, "webkitRelativePath", { value: path });
    files.push(file);
    return;
  }
  if (entry.isDirectory) {
    const children = await readAllEntries(entry.createReader());
    for (const child of children) await walkEntry(child, files, path);
  }
}

async function filesFromDrop(dataTransfer) {
  const items = dataTransfer && dataTransfer.items;
  if (items && items.length && typeof items[0].webkitGetAsEntry === "function") {
    const files = [];
    const entries = [];
    for (const item of items) {
      const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
      if (entry) entries.push(entry);
    }
    if (entries.length) {
      for (const entry of entries) await walkEntry(entry, files, "");
      if (files.length) return files;
    }
  }
  return [...(dataTransfer.files || [])];
}

function imageKeys(file) {
  const keys = [];
  const name = String(file?.name || "").replaceAll("\\", "/");
  if (name) keys.push(name, name.split("/").pop());
  const relative = String(file?.webkitRelativePath || "").replaceAll("\\", "/");
  if (relative) {
    keys.push(relative);
    const attach = relative.split("/").reduce((found, part, index, parts) => {
      if (part === "attachments") return parts.slice(index).join("/");
      return found;
    }, "");
    if (attach) keys.push(attach);
  }
  return keys;
}

function readAsBase64(file) {
  return readAsDataURL(file).then((dataUrl) => {
    const text = String(dataUrl || "");
    const comma = text.indexOf(",");
    return comma === -1 ? text : text.slice(comma + 1);
  });
}

const API_TIMEOUT_MS = 25000;
const HOSTED_TIMEOUT_MESSAGE =
  "The hosted converter timed out. Drop a downloaded pack such as documentation.html to load it in the browser, or run Pack Builder locally.";

async function readResponseJson(res) {
  const text = await res.text();
  if (!text) {
    if (res.status === 413) throw new Error("Those files are too large for the hosted converter. Try fewer files, or run Pack Builder locally.");
    if (res.status === 502 || res.status === 504 || res.status === 408) {
      throw new Error(HOSTED_TIMEOUT_MESSAGE);
    }
    throw new Error(res.ok ? "The server sent an empty response" : `Could not convert files (${res.status})`);
  }
  try {
    return JSON.parse(text);
  } catch {
    if (res.status === 413) throw new Error("Those files are too large for the hosted converter. Try fewer files, or run Pack Builder locally.");
    if (res.status === 502 || res.status === 504 || res.status === 408) {
      throw new Error(HOSTED_TIMEOUT_MESSAGE);
    }
    throw new Error(res.ok ? "The server sent an unexpected response" : `Could not convert files (${res.status})`);
  }
}

async function postJson(url, body, timeoutMs = API_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    return { res, data: await readResponseJson(res) };
  } catch (err) {
    if (err && (err.name === "AbortError" || err.name === "TimeoutError")) {
      throw new Error(HOSTED_TIMEOUT_MESSAGE);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function isBuiltPackHtml(html) {
  const text = String(html || "");
  if (!/class=["']site-header["']/.test(text)) return false;
  return /<section\b[^>]*\bchapter\b/i.test(text);
}

function isPackReadyHtml(html) {
  const text = String(html || "");
  return (
    text.includes('class="content-card"')
    || text.includes("class='content-card'")
    || text.includes('class="page-header"')
    || text.includes('class="hero"')
  );
}

function matchingTagEnd(html, start, tag) {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  const isOpen = (at) => {
    if (html.slice(at, at + open.length).toLowerCase() !== open) return false;
    const next = html[at + open.length] || "";
    return " \t\r\n/>".includes(next);
  };
  let pos = start + open.length;
  let depth = 1;
  const lower = html.toLowerCase();
  while (pos < html.length && depth) {
    const nextOpen = (() => {
      let needle = pos;
      while (true) {
        const at = lower.indexOf(open, needle);
        if (at === -1) return -1;
        if (isOpen(at)) return at;
        needle = at + 1;
      }
    })();
    const nextClose = lower.indexOf(close, pos);
    if (nextClose === -1) return html.length;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      pos = nextOpen + open.length;
    } else {
      depth -= 1;
      pos = nextClose + close.length;
    }
  }
  return pos;
}

function attrFromTag(tag, name) {
  const match = String(tag || "").match(new RegExp(`\\b${name}="([^"]*)"`, "i"));
  return match ? decodeEntities(match[1]) : "";
}

function innerText(html, pattern) {
  const match = String(html || "").match(pattern);
  if (!match) return "";
  return decodeEntities(match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function settingsFromPackHtml(html, filename) {
  const logo = String(html || "").match(/<a class="brand-lockup"[^>]*>\s*<img\b([^>]+)>/i);
  const logoTag = logo ? logo[1] : "";
  let favicon = "";
  const links = String(html || "").matchAll(/<link\b([^>]+)>/gi);
  for (const item of links) {
    const rel = attrFromTag(item[1], "rel").toLowerCase();
    if (!/\bicon\b/.test(rel) && !/\bshortcut\b/.test(rel)) continue;
    favicon = attrFromTag(item[1], "href");
    if (favicon) break;
  }
  return {
    page_title: innerText(html, /<title>([\s\S]*?)<\/title>/i) || "",
    header_doc: innerText(html, /<span class="header-doc">([\s\S]*?)<\/span>/i) || "",
    logo_url: attrFromTag(logoTag, "src") || "",
    logo_alt: attrFromTag(logoTag, "alt") || "",
    favicon_url: favicon,
    confidential: /class="confidential"/.test(html),
    footer: innerText(html, /<p class="site-footer">([\s\S]*?)<\/p>/i) || "",
    output_filename: String(filename || "documentation.html").split(/[\\/]/).pop(),
  };
}

function cleanImportedBody(html) {
  let body = String(html || "")
    .replace(/\scontenteditable(?:=(["'][^"']*["']))?/gi, "")
    .replace(/\sdata-layout-block(?:=(["'][^"']*["']))?/gi, "")
    .replace(/\sdata-protected(?:=(["'][^"']*["']))?/gi, "")
    .replace(/\sdata-plain(?:=(["'][^"']*["']))?/gi, "")
    .replace(/\sdata-lock-label="[^"]*"/gi, "")
    .replace(/<p class="site-footer">[\s\S]*?<\/p>/gi, "")
    .replace(/\)\s*!==\s*-1\)\s*return html\.replace[\s\S]*?\(typeof window !== ["']undefined["'] \? window : this\);/g, "")
    .replace(/global\.PackLang\s*=\s*\{[\s\S]*?\(typeof window !== ["']undefined["'] \? window : this\);/g, "");
  const navMark = "border:0;margin-top:28px;justify-content:space-between";
  const pos = body.lastIndexOf(navMark);
  if (pos !== -1) {
    const start = body.lastIndexOf("<div", pos);
    if (start !== -1) {
      const end = matchingTagEnd(body, start, "div");
      body = body.slice(0, start) + body.slice(end);
    }
  }
  return body.trim();
}

function extractContainer(html) {
  const text = String(html || "");
  const marker = '<div class="container">';
  const start = text.indexOf(marker);
  if (start === -1) {
    const body = text.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    let inner = body ? body[1] : text;
    inner = inner.replace(/<nav[\s\S]*?<\/nav>/i, "");
    inner = inner.replace(/<script[\s\S]*?<\/script>/gi, "");
    inner = inner.replace(/<style[\s\S]*?<\/style>/gi, "");
    return inner.trim();
  }
  const end = matchingTagEnd(text, start, "div");
  let inner = text.slice(start + marker.length, end - "</div>".length);
  const pf = inner.indexOf('<div class="page-footer-nav">');
  if (pf !== -1) {
    inner = inner.slice(0, pf) + inner.slice(matchingTagEnd(inner, pf, "div"));
  }
  return inner.replace(/<footer>[\s\S]*?<\/footer>/gi, "").trim();
}

function detectHtmlRole(filename, html) {
  const base = String(filename || "").toLowerCase();
  if (/^00[_-]/.test(base) || /index|hub|overview/.test(base)) return "overview";
  const hasHero = html.includes('class="hero"');
  const hasGrid = html.includes('class="grid"');
  const hasToc = html.includes('class="toc-card"');
  if (hasHero && hasGrid && !hasToc) return "overview";
  return "chapter";
}

function detectHtmlTitle(html, filename) {
  const match = String(html || "").match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (match) {
    const title = decodeEntities(match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    if (title) return title;
  }
  return String(filename || "Page")
    .replace(/\.(html|htm)$/i, "")
    .replace(/^\d+[_-]?/, "")
    .replace(/_/g, " ")
    .trim() || filename;
}

function detectHtmlNum(filename) {
  const match = String(filename || "").match(/^(\d{1,2})(?=[._-])/);
  return match ? match[1].padStart(2, "0") : "";
}

function docFromReadyHtml(html, filename) {
  const body = cleanImportedBody(extractContainer(html));
  const role = detectHtmlRole(filename, body || html);
  return {
    filename: String(filename || "document.html").split(/[\\/]/).pop(),
    title: role === "overview" ? "Overview" : detectHtmlTitle(body || html, filename),
    role,
    include: true,
    draft: /badge-draft|status-draft|>Draft</i.test(html) || /badge-draft|status-draft|>Draft</i.test(body),
    num: detectHtmlNum(filename),
    body: body.replaceAll("&amp;amp;", "&amp;"),
    id: "",
  };
}

function splitBuiltPackHtml(html, filename) {
  const docs = [];
  const usedNames = new Set();
  const usedNums = new Set();
  const uniqueName = (num, title) => {
    const stem = String(title || "Page").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 72) || "Page";
    let name = `${num}_${stem}.html`;
    let extra = 2;
    while (usedNames.has(name.toLowerCase())) {
      name = `${num}_${stem}_${extra}.html`;
      extra += 1;
    }
    usedNames.add(name.toLowerCase());
    return name;
  };
  let pos = 0;
  const lower = html.toLowerCase();
  while (true) {
    let start = pos;
    while (true) {
      const at = lower.indexOf("<section", start);
      if (at === -1) {
        start = -1;
        break;
      }
      const next = html[at + 8] || "";
      if (" \t\r\n/>".includes(next)) {
        start = at;
        break;
      }
      start = at + 1;
    }
    if (start === -1) break;
    const gt = html.indexOf(">", start);
    if (gt === -1) break;
    const openTag = html.slice(start, gt + 1);
    if (!/\bclass="[^"]*\bchapter\b/i.test(openTag)) {
      pos = start + 8;
      continue;
    }
    const end = matchingTagEnd(html, start, "section");
    let inner = cleanImportedBody(html.slice(gt + 1, end - "</section>".length));
    const sectionId = attrFromTag(openTag, "id");
    const role = sectionId === "overview" ? "overview" : "chapter";
    const heading = inner.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || inner.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    let title = heading ? decodeEntities(heading[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()) : "";
    let num = role === "overview" ? "00" : (sectionId.match(/^flow-(\d{1,2})$/) || [])[1] || "";
    if (role === "overview") title = "Contents";
    if (!title) title = role === "overview" ? "Contents" : "New page";
    if (role !== "overview" && (!num || usedNums.has(num.padStart(2, "0")))) {
      let seq = 1;
      while (usedNums.has(String(seq).padStart(2, "0"))) seq += 1;
      num = String(seq).padStart(2, "0");
    }
    if (num) num = String(num).padStart(2, "0");
    usedNums.add(num);
    docs.push({
      filename: uniqueName(num, role === "overview" ? "Contents" : title),
      title,
      role,
      include: true,
      draft: /badge-draft|status-draft|>Draft</i.test(inner),
      num,
      body: inner,
      id: sectionId || "",
    });
    pos = end;
  }
  if (!docs.length) throw new Error("That pack file has no pages to edit");
  return { docs, settings: settingsFromPackHtml(html, filename) };
}

async function ingestFiles(fileList) {
  try {
    setStatus("Reading files…");
    const files = [];
    const images = {};
    const localDocs = [];
    let localSettings = null;
    let importedPackHtml = "";
    for (const file of fileList) {
      const name = file.name;
      const lower = name.toLowerCase();
      if (lower.endsWith(".html") || lower.endsWith(".htm")) {
        const html = await file.text();
        if (isBuiltPackHtml(html)) {
          const split = splitBuiltPackHtml(html, name);
          localDocs.push(...split.docs);
          localSettings = split.settings;
          importedPackHtml = html;
          continue;
        }
        if (isPackReadyHtml(html)) {
          localDocs.push(docFromReadyHtml(html, name));
          continue;
        }
        files.push({ filename: name, html });
        continue;
      }
      if (/\.docx?$/i.test(name)) {
        files.push({ filename: name, docx: await readAsBase64(file) });
        continue;
      }
      if (/\.(pptx?|pptm|ppsx?|ppsm)$/i.test(name)) {
        files.push({ filename: name, pptx: await readAsBase64(file) });
        continue;
      }
      if (/\.(png|jpe?g|gif|svg|webp)$/i.test(name)) {
        const data = await readAsDataURL(file);
        for (const key of imageKeys(file)) images[key] = data;
      }
    }
    if (!files.length && !localDocs.length) {
      setStatus("No HTML, Word, or PowerPoint files found", "error");
      return;
    }
    const skipPreview = Boolean(importedPackHtml) && !files.length;
    if (localDocs.length) {
      applyIncomingSettings(localSettings);
      await mergeIncoming(localDocs, { skipOverview: true, skipPreview });
    }
    if (!files.length) {
      if (importedPackHtml) {
        state.lastHtml = importedPackHtml;
        state.useImportedPreview = true;
        showPreviewHtml(importedPackHtml);
      }
      setStatus(`${state.docs.length} page${state.docs.length === 1 ? "" : "s"} loaded`, "ok");
      return;
    }
    setStatus("Converting pages…");
    const { res, data } = await postJson("/api/ingest", { files, images });
    if (!res.ok) {
      setStatus(data.error || "Could not read files", "error");
      return;
    }
    applyIncomingSettings(data.settings);
    await mergeIncoming(data.docs || [], { skipOverview: Boolean(data.overview_synced) });
    setStatus(`${state.docs.length} page${state.docs.length === 1 ? "" : "s"} loaded`, "ok");
  } catch (err) {
    setStatus(err.message || "Could not convert those files", "error");
  }
}

els.dropzone.addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", async () => {
  await ingestFiles(els.fileInput.files);
  els.fileInput.value = "";
});

["dragenter", "dragover"].forEach((type) => {
  els.dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    els.dropzone.classList.add("dragover");
  });
});
["dragleave", "drop"].forEach((type) => {
  els.dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    els.dropzone.classList.remove("dragover");
  });
});
els.dropzone.addEventListener("drop", async (event) => {
  const files = await filesFromDrop(event.dataTransfer);
  await ingestFiles(files);
});

if (els.btnCollapseNav) {
  els.btnCollapseNav.addEventListener("click", (event) => {
    event.stopPropagation();
    setNavCollapsed(!navCollapsed());
  });
}
if (els.panelLeft) {
  els.panelLeft.addEventListener("click", () => {
    if (navCollapsed()) setNavCollapsed(false);
  });
}

els.btnImportLocal.addEventListener("click", async () => {
  setStatus("Loading project files…");
  const listRes = await fetch("/api/local-files");
  const list = await listRes.json();
  if (!listRes.ok) {
    setStatus(list.error || "Local import is not available", "error");
    return;
  }
  const files = list.files || [];
  if (!files.length) {
    setStatus("Nothing in source/ or inbox/", "error");
    return;
  }
  const docs = [];
  for (const file of files) {
    const res = await fetch(`/api/local-file?folder=${encodeURIComponent(file.folder)}&name=${encodeURIComponent(file.name)}`);
    const data = await res.json();
    if (!res.ok) continue;
    if (Array.isArray(data.docs)) {
      docs.push(...data.docs);
      applyIncomingSettings(data.settings);
    } else {
      docs.push(data);
    }
  }
  await mergeIncoming(docs);
  setStatus(`Imported ${docs.length} file${docs.length === 1 ? "" : "s"}`, "ok");
});

document.querySelectorAll(".tabs button").forEach((button) => {
  button.addEventListener("click", () => {
    flushEditor();
    state.tab = button.dataset.tab;
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b === button));
    els.workspacePreview.hidden = state.tab !== "preview";
    els.workspaceEdit.hidden = state.tab !== "edit";
    if (state.tab === "edit") loadEditor();
    if (state.tab === "preview") schedulePreview(true);
  });
});

["page-title", "header-doc", "logo-url", "logo-alt", "favicon-url", "confidential", "footer", "output-filename"].forEach((id) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("input", () => {
    if (id === "favicon-url" || id === "logo-url") syncFaviconPreview();
    schedulePreview();
  });
  el.addEventListener("change", () => {
    if (id === "favicon-url" || id === "logo-url") syncFaviconPreview();
    schedulePreview();
  });
});

els.faviconChoose?.addEventListener("click", () => els.faviconFile?.click());
els.faviconFile?.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (file) readFaviconFile(file);
});
els.faviconPreview?.addEventListener("error", () => {
  els.faviconPreview.hidden = true;
});
syncFaviconPreview();

[
  "theme-magenta",
  "theme-cream",
  "theme-olive",
  "theme-charcoal",
  "theme-violet",
  "theme-taupe",
  "theme-white",
  "theme-peach",
  "theme-font",
  "theme-content-width",
  "theme-sidebar-width",
  "theme-radius",
].forEach((id) => {
  const el = document.getElementById(id);
  el.addEventListener("input", () => {
    PackEditor.applyTheme(themeOverrideCss());
    schedulePreview();
  });
  el.addEventListener("change", () => {
    PackEditor.applyTheme(themeOverrideCss());
    schedulePreview();
  });
});

document.getElementById("text-toolbar").addEventListener("click", (event) => {
  if (event.target.closest("#btn-icon-picker") || event.target.closest("#icon-picker")) return;
  const button = event.target.closest("button[data-cmd]");
  if (!button) return;
  const ok = PackEditor.command(button.dataset.cmd, button.dataset.value || undefined);
  if (button.dataset.cmd === "undo") {
    if (!ok) setStatus("Nothing to undo", "error");
    return;
  }
  if (button.dataset.cmd === "redo") {
    if (!ok) setStatus("Nothing to redo", "error");
    return;
  }
  if (!ok) setStatus("Rich text is off inside code examples and tables", "error");
});

function closeIconPicker() {
  document.getElementById("icon-picker").hidden = true;
}

function renderIconPicker(query) {
  const mount = document.getElementById("icon-grid");
  const groups = IconLibrary.grouped(query);
  const parts = [];
  for (const [group, items] of groups) {
    parts.push(`<div class="icon-group-label">${escapeHtml(group)}</div><div class="icon-grid">`);
    for (const item of items) {
      parts.push(
        `<button type="button" data-icon="${escapeAttr(item.name)}" title="${escapeAttr(item.label)}">` +
          `${IconLibrary.html(item.name, 20)}<span>${escapeHtml(item.label)}</span></button>`
      );
    }
    parts.push("</div>");
  }
  mount.innerHTML = parts.join("") || '<p class="empty" style="padding:12px 0">No matching icons</p>';
}

document.getElementById("btn-icon-picker").addEventListener("click", async (event) => {
  event.preventDefault();
  const picker = document.getElementById("icon-picker");
  await IconLibrary.load();
  if (picker.hidden) {
    renderIconPicker(document.getElementById("icon-search").value);
    picker.hidden = false;
    document.getElementById("icon-search").focus();
  } else {
    picker.hidden = true;
  }
});

document.getElementById("icon-search").addEventListener("input", (event) => {
  renderIconPicker(event.target.value);
});

document.getElementById("icon-grid").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-icon]");
  if (!button) return;
  closeIconPicker();
  if (PackEditor.selected?.matches?.(".card")) {
    const ok = PackEditor.setCardIcon(button.dataset.icon);
    if (ok) setStatus("Card icon updated", "ok");
    return;
  }
  const html = IconLibrary.html(button.dataset.icon);
  const ok = PackEditor.insertInline(html);
  if (!ok) setStatus("Click in the page text first, then insert an icon", "error");
  else setStatus("Icon inserted", "ok");
});

document.addEventListener("click", (event) => {
  const picker = document.getElementById("icon-picker");
  if (picker.hidden) return;
  if (event.target.closest("#icon-picker") || event.target.closest("#btn-icon-picker") || event.target.closest("#btn-card-icon")) return;
  closeIconPicker();
});

document.getElementById("layout-toolbar").addEventListener("click", (event) => {
  if (event.target.closest("#btn-insert-menu")) return;
  if (event.target.closest("#btn-edit-diagram")) {
    closeInsertMenu();
    openDiagramEditor(true);
    return;
  }
  if (event.target.closest("#btn-edit-flow")) {
    closeInsertMenu();
    openFlowStudio(true);
    return;
  }
  if (event.target.closest("#btn-edit-html")) {
    closeInsertMenu();
    openHtmlModal("edit");
    return;
  }
  if (event.target.closest("#btn-convert-diagram-flow") || event.target.closest("#btn-convert-image-flow")) {
    closeInsertMenu();
    convertSelectedDiagramToFlow();
    return;
  }
  const insert = event.target.closest("button[data-insert]");
  if (insert) {
    closeInsertMenu();
    if (insert.dataset.insert === "diagram") {
      openDiagramEditor(false);
      return;
    }
    if (insert.dataset.insert === "flow") {
      openFlowStudio(false);
      return;
    }
    if (insert.dataset.insert === "image") {
      openImageModal("add");
      return;
    }
    if (insert.dataset.insert === "html") {
      openHtmlModal("add");
      return;
    }
    PackEditor.insert(insert.dataset.insert);
    if (insert.dataset.insert === "hero") {
      setStatus("Header box ready — pick a colour and edit the text", "ok");
    }
    if (insert.dataset.insert === "columns") {
      setStatus("Columns added — click a column to write in it, or change 2–4 columns here", "ok");
    }
    if (insert.dataset.insert === "tabs") {
      setStatus("Tabs added — name them here, then click inside a tab to add a flow, table, or HTML", "ok");
    }
    return;
  }
  const button = event.target.closest("button[data-layout]");
  if (!button) return;
  const tableAction = button.dataset.layout === "add-row" || button.dataset.layout === "add-col";
  if (!PackEditor.selected && !tableAction) {
    setStatus("Click a section in the page first", "error");
    return;
  }
  const ok = PackEditor.layout(button.dataset.layout, button.dataset.value || "");
  if (tableAction && !ok) setStatus("Click inside a table first, then add a row or column", "error");
});

function closeInsertMenu() {
  const menu = document.getElementById("insert-menu");
  const button = document.getElementById("btn-insert-menu");
  if (!menu || !button) return;
  menu.hidden = true;
  button.setAttribute("aria-expanded", "false");
}

document.getElementById("btn-insert-menu").addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  const menu = document.getElementById("insert-menu");
  const open = menu.hidden;
  menu.hidden = !open;
  event.currentTarget.setAttribute("aria-expanded", String(open));
});

document.addEventListener("click", (event) => {
  if (event.target.closest(".insert-menu")) return;
  closeInsertMenu();
});

function setToolbarLocked(locked) {
  document.querySelectorAll("#text-toolbar button").forEach((button) => {
    if (button.id === "btn-undo" || button.id === "btn-redo") return;
    button.disabled = locked;
  });
  syncHistoryButtons();
  els.editorHint.classList.toggle("locked", locked);
}

function syncHistoryButtons() {
  const info = PackEditor.historyInfo();
  const undo = document.getElementById("btn-undo");
  const redo = document.getElementById("btn-redo");
  if (undo) undo.disabled = !info.canUndo;
  if (redo) redo.disabled = !info.canRedo;
}

function renderSectionOutline() {
  const rail = document.getElementById("section-rail");
  const list = document.getElementById("section-list");
  if (!rail || !list) return;
  if (document.activeElement?.matches?.("[data-sec-num]")) return;
  const sections = PackEditor.listSections();
  if (state.tab !== "edit" || !sections.length) {
    rail.hidden = true;
    return;
  }
  rail.hidden = false;
  const count = document.getElementById("section-count");
  if (count) count.textContent = `(${sections.length})`;
  const firstH2 = sections.findIndex((item) => item.level === 2);
  list.innerHTML = sections
    .map((item, index) => {
      const demote = item.level === 2 && index !== firstH2
        ? `<button type="button" data-sec-act="demote" data-index="${index}">Make H3</button>`
        : "";
      const promote = item.level === 3
        ? `<button type="button" data-sec-act="promote" data-index="${index}">Make H2</button>`
        : "";
      return `<div class="section-row" data-level="${item.level}">
        <input data-sec-num data-index="${index}" value="${escapeAttr(item.num)}" aria-label="Section number">
        <span class="sec-title">${escapeHtml(item.title)}</span>
        ${demote}${promote}
      </div>`;
    })
    .join("");
}

PackEditor.bind(els.editor, {
  onChange() {
    schedulePreview();
    renderSectionOutline();
  },
  onHistory() {
    syncHistoryButtons();
  },
  onSelect(info) {
    setToolbarLocked(Boolean(info.plain || info.protected));
    const isDiagram = info.label === "Diagram";
    const isFlow = info.label === "API flow";
    const isTable = info.label === "Table";
    const header = PackEditor.selected?.matches?.(".hero, .page-header") ? PackEditor.selected : null;
    const tones = document.getElementById("hero-tones");
    tones.hidden = !header;
    if (header) {
      const tone = header.getAttribute("data-tone") || "magenta";
      tones.querySelectorAll("button[data-layout='tone']").forEach((button) => {
        button.classList.toggle("is-active", button.dataset.value === tone);
      });
    }
    const card = PackEditor.selected?.matches?.(".card") ? PackEditor.selected : null;
    const cardProps = document.getElementById("card-props");
    cardProps.hidden = !card;
    const labelInput = document.getElementById("card-label");
    if (card && document.activeElement !== labelInput) {
      labelInput.value = PackEditor.cardLabel();
    }
    const tableTools = document.getElementById("table-tools");
    if (tableTools) tableTools.hidden = !isTable;
    const diagramTools = document.getElementById("diagram-tools");
    if (diagramTools) diagramTools.hidden = !isDiagram;
    const flowTools = document.getElementById("flow-tools");
    if (flowTools) flowTools.hidden = !isFlow;
    const htmlTools = document.getElementById("html-tools");
    const htmlBlock = PackEditor.htmlFromSelection();
    if (htmlTools) htmlTools.hidden = !htmlBlock;
    const codeTools = document.getElementById("code-tools");
    const code = PackEditor.codeInfo();
    const codeTitle = document.getElementById("code-title");
    if (codeTools) codeTools.hidden = !code;
    if (code && codeTitle && document.activeElement !== codeTitle) {
      codeTitle.value = code.title;
    }
    const imageTools = document.getElementById("image-tools");
    const image = PackEditor.imageInfo();
    if (imageTools) imageTools.hidden = !image;
    if (image) syncImageTools(image);
    const columnTools = document.getElementById("column-tools");
    const columns = PackEditor.columnsInfo();
    if (columnTools) columnTools.hidden = !columns;
    if (columns) syncColumnTools(columns);
    const tabTools = document.getElementById("tab-tools");
    const tabs = PackEditor.tabsInfo();
    const tabTitle = document.getElementById("tab-title");
    if (tabTools) tabTools.hidden = !tabs;
    if (tabs) syncTabTools(tabs);
    if (tabs && tabTitle && document.activeElement !== tabTitle) tabTitle.value = tabs.title;
    renderSectionOutline();
    syncFlowConvertButtons();
    if (isDiagram) {
      els.editorHint.textContent = PackEditor.flowImageFromSelection()
        ? "Diagram selected. Convert it to an API flow here, or click Edit diagram for the drawing tools."
        : "Diagram selected. Click Edit diagram, or double-click it to open the creator.";
    } else if (isFlow) {
      els.editorHint.textContent = "API flow selected. Click Edit flow, or double-click it to reopen Flow Studio.";
    } else if (htmlBlock) {
      els.editorHint.textContent = "HTML selected. Click Edit HTML, or double-click it to change the markup.";
    } else if (tabs) {
      els.editorHint.textContent = "Tabs selected. Name the current tab here, add more, then click inside a tab to insert a flow, table, or HTML.";
    } else if (code) {
      els.editorHint.textContent = "Code selected. Change the title here. The code itself stays plain text.";
    } else if (image) {
      els.editorHint.textContent = PackEditor.flowImageFromSelection()?.el?.hasAttribute("data-flow-candidate")
        ? "This looks like a sequence diagram. Convert it to an API flow here, or change size and position."
        : "Image selected. Change size or position here, drag the purple corner, or use Block arrows to move it.";
    } else if (columns && columns.hasGrid) {
      els.editorHint.textContent = "Column layout selected. Change 1–4 columns here, click a column to add content, or use Block arrows to reorder a column.";
    } else if (isTable) {
      els.editorHint.textContent = "Table selected. Add a row or column here, or edit the cells in the page.";
    } else if (header) {
      els.editorHint.textContent = "Header box selected. Pick a colour, then edit the title, description, and labels.";
    } else if (card) {
      els.editorHint.textContent = "Contents card selected. Change the label and icon here. The summary and tags can be edited in the card.";
    } else if (info.plain || info.protected) {
      els.editorHint.textContent = `${info.label}: plain-text only. Structure is locked so the layout stays intact.`;
    } else if (PackEditor.selected?.matches?.(".content-card, .overview-section")) {
      els.editorHint.textContent = "Section selected. Use Columns to split it, or Add to page for tables, notes, diagrams, and other blocks.";
    } else if (PackEditor.selected) {
      els.editorHint.textContent = `Selected ${info.label}. Move, duplicate, or hide it here, or add another block.`;
    } else {
      const doc = docById(state.selected);
      els.editorHint.textContent = doc
        ? `Editing ${doc.filename}. Click text to format it, or click a block to change layout.`
        : "Select a page on the left to edit it.";
    }
  },
  onEditDiagram() {
    openDiagramEditor(true);
  },
  onEditFlow() {
    openFlowStudio(true);
  },
  onEditHtml() {
    openHtmlModal("edit");
  },
});

function openDiagramEditor(editExisting) {
  const container = PackEditor.diagramFromSelection();
  if (editExisting && !container) {
    setStatus("Click a diagram first, or use + Diagram to create one", "error");
    return;
  }
  const model = container ? parseDiagram(container) : defaultDiagram();
  DiagramEditor.open(model, (html) => {
    if (container) PackEditor.replaceDiagram(html);
    else PackEditor.insertHtml(html);
    setStatus("Diagram saved", "ok");
    schedulePreview(true);
  });
}

function syncFlowConvertButtons() {
  const source = PackEditor.flowImageFromSelection();
  const host = source?.el;
  const imageBtn = document.getElementById("btn-convert-image-flow");
  const diagramBtn = document.getElementById("btn-convert-diagram-flow");
  if (imageBtn) imageBtn.hidden = !(host?.matches?.(".pack-image") && host.hasAttribute("data-flow-candidate"));
  if (diagramBtn) diagramBtn.hidden = !host?.matches?.(".diagram-container");
}

function convertSelectedDiagramToFlow() {
  const source = PackEditor.flowImageFromSelection();
  if (!source?.el && !source?.img && !source?.src) {
    setStatus("Click a diagram or image first", "error");
    return;
  }
  const buttons = [document.getElementById("btn-convert-image-flow"), document.getElementById("btn-convert-diagram-flow")];
  buttons.forEach((button) => {
    if (button) button.disabled = true;
  });
  PackEditor.pendingFlowReplace = source.el;
  setStatus("Reading the diagram…", "ok");
  FlowImage.read(source.el || source.img || source.src, {
    platform: "darwin",
    onStatus: (text) => setStatus(text, "ok"),
  })
    .then((parsed) => {
      if (!parsed?.ok) {
        PackEditor.pendingFlowReplace = null;
        setStatus(parsed?.errors?.[0] || "Could not turn that diagram into a flow", "error");
        return;
      }
      const apply = document.getElementById("flow-apply");
      if (apply) apply.textContent = "Replace image";
      const cancel = document.getElementById("flow-cancel");
      const forget = () => {
        PackEditor.pendingFlowReplace = null;
      };
      cancel?.addEventListener("click", forget, { once: true });
      FlowStudio.open(parsed.model, (html) => {
        cancel?.removeEventListener("click", forget);
        PackEditor.replaceFlowSource(html);
        setStatus("API flow added in place of the diagram", "ok");
        schedulePreview(true);
      });
      setStatus(parsed.note || "Check the flow, then replace the image.", "ok");
    })
    .catch((err) => {
      PackEditor.pendingFlowReplace = null;
      setStatus(err.message || "Could not turn that diagram into a flow", "error");
    })
    .finally(() => {
      buttons.forEach((button) => {
        if (button) button.disabled = false;
      });
    });
}

function openFlowStudio(editExisting) {
  const container = PackEditor.flowFromSelection();
  if (editExisting && !container) {
    setStatus("Click an API flow first, or use + API flow to create one", "error");
    return;
  }
  const model = container ? FlowRender.parseEmbed(container) : FlowIR.empty();
  if (editExisting && !model) {
    setStatus("This flow has no saved IR to edit", "error");
    return;
  }
  const apply = document.getElementById("flow-apply");
  if (apply) apply.textContent = container ? "Update on page" : "Insert on page";
  FlowStudio.open(model || FlowIR.empty(), (html) => {
    if (container) PackEditor.replaceFlow(html);
    else PackEditor.insertHtml(html);
    setStatus("API flow saved", "ok");
    schedulePreview(true);
  });
}

document.querySelectorAll("[data-dtool]").forEach((button) => {
  button.addEventListener("click", () => DiagramEditor._setTool(button.dataset.dtool));
});
document.querySelectorAll("[data-dfill]").forEach((button) => {
  button.addEventListener("click", () => DiagramEditor.setFill(button.dataset.dfill));
});
document.getElementById("diagram-delete").addEventListener("click", () => DiagramEditor.deleteSelected());
document.getElementById("diagram-cancel").addEventListener("click", () => DiagramEditor.close());
document.getElementById("diagram-apply").addEventListener("click", () => DiagramEditor.apply());
document.getElementById("diagram-title").addEventListener("input", (event) => {
  const node = DiagramEditor._node();
  if (!node) return;
  node.title = event.target.value;
  DiagramEditor._draw();
});
document.getElementById("diagram-subtitle").addEventListener("input", (event) => {
  const node = DiagramEditor._node();
  if (!node) return;
  node.subtitle = event.target.value;
  DiagramEditor._draw();
});
document.getElementById("diagram-label").addEventListener("input", (event) => {
  const edge = DiagramEditor._edge();
  if (!edge) return;
  edge.label = event.target.value;
  DiagramEditor._draw();
});
document.getElementById("diagram-route").addEventListener("change", (event) => {
  DiagramEditor.setEdgeRoute(event.target.value);
});
document.getElementById("diagram-heads").addEventListener("change", (event) => {
  DiagramEditor.setEdgeHeads(event.target.value);
});
document.getElementById("diagram-reverse").addEventListener("click", () => DiagramEditor.reverseEdge());
document.getElementById("diagram-width").addEventListener("change", (event) => {
  if (!DiagramEditor.model) return;
  DiagramEditor.model.width = Number(event.target.value) || DiagramEditor.model.width;
  DiagramEditor._draw();
});
document.getElementById("diagram-height").addEventListener("change", (event) => {
  if (!DiagramEditor.model) return;
  DiagramEditor.model.height = Number(event.target.value) || DiagramEditor.model.height;
  DiagramEditor._draw();
});
document.addEventListener("keydown", (event) => {
  if (!document.getElementById("image-modal").hidden && event.key === "Escape") {
    closeImageModal();
    return;
  }
  if (!document.getElementById("html-modal").hidden && event.key === "Escape") {
    closeHtmlModal();
    return;
  }
  if (!document.getElementById("flow-modal").hidden && event.key === "Escape") {
    FlowStudio.close();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && document.getElementById("diagram-modal").hidden && document.getElementById("image-modal").hidden && document.getElementById("flow-modal").hidden) {
    const tag = event.target.tagName;
    const inField = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    const key = event.key.toLowerCase();
    if (!inField && state.tab === "edit" && (key === "z" || key === "y")) {
      event.preventDefault();
      if (key === "y" || event.shiftKey) PackEditor.redo();
      else PackEditor.undo();
      return;
    }
  }
  if (document.getElementById("diagram-modal").hidden) return;
  if (event.key === "Escape") DiagramEditor.close();
  if (event.key === "Delete" || event.key === "Backspace") {
    const tag = event.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    event.preventDefault();
    DiagramEditor.deleteSelected();
  }
});

const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
let imageModalMode = "add";

function syncImageTools(info) {
  const width = document.getElementById("image-width");
  const label = document.getElementById("image-width-label");
  const alt = document.getElementById("image-alt-edit");
  if (width && document.activeElement !== width) width.value = String(info.width);
  if (label) label.textContent = `${info.width}%`;
  if (alt && document.activeElement !== alt) alt.value = info.alt;
  document.querySelectorAll("#image-tools [data-image-size]").forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.imageSize) === info.width);
  });
  document.querySelectorAll("#image-tools [data-image-align]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.imageAlign === info.align);
  });
}

function syncColumnTools(info) {
  document.querySelectorAll("#column-tools [data-columns]").forEach((button) => {
    const key = button.dataset.columns;
    if (key === "add") button.disabled = info.count >= 4;
    else if (key === "remove") button.disabled = info.count <= 1;
    else button.classList.toggle("is-active", Number(key) === info.count);
  });
}

function syncTabTools(info) {
  document.querySelectorAll("#tab-tools [data-tabs]").forEach((button) => {
    const key = button.dataset.tabs;
    if (key === "add") button.disabled = info.count >= 6;
    else if (key === "remove") button.disabled = info.count <= 2;
    else button.classList.toggle("is-active", Number(key) === info.count);
  });
}

function openImageModal(mode) {
  imageModalMode = mode === "replace" ? "replace" : "add";
  const modal = document.getElementById("image-modal");
  const title = document.getElementById("image-modal-title");
  const apply = document.getElementById("image-apply");
  const url = document.getElementById("image-url");
  const alt = document.getElementById("image-alt");
  const info = PackEditor.imageInfo();
  title.textContent = imageModalMode === "replace" ? "Replace image" : "Add image";
  apply.textContent = imageModalMode === "replace" ? "Replace" : "Add image";
  url.value = info && imageModalMode === "replace" && !info.src.startsWith("data:") ? info.src : "";
  alt.value = info && imageModalMode === "replace" ? info.alt : "";
  modal.hidden = false;
  url.focus();
}

function closeImageModal() {
  document.getElementById("image-modal").hidden = true;
  document.getElementById("image-file").value = "";
}

function applyImageSource(src, alt) {
  if (imageModalMode === "replace") {
    const ok = PackEditor.replaceImageSrc(src);
    if (!ok) {
      setStatus("Use an http(s) image URL or an image file", "error");
      return false;
    }
    PackEditor.setImageAlt(alt);
    setStatus("Image updated", "ok");
  } else {
    const ok = PackEditor.insertImage(src, alt);
    if (!ok) {
      setStatus("Use an http(s) image URL or an image file", "error");
      return false;
    }
    setStatus("Image added — resize or move it with the Image tools", "ok");
  }
  closeImageModal();
  return true;
}

function readImageFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    setStatus("Choose a PNG, JPEG, GIF, WebP, or SVG file", "error");
    return;
  }
  if (file.size > IMAGE_MAX_BYTES) {
    setStatus("Image files must be 8 MB or smaller", "error");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    applyImageSource(String(reader.result || ""), document.getElementById("image-alt").value.trim());
  };
  reader.onerror = () => setStatus("Could not read that image", "error");
  reader.readAsDataURL(file);
}

document.getElementById("column-tools").addEventListener("click", (event) => {
  const button = event.target.closest("[data-columns]");
  if (!button) return;
  const key = button.dataset.columns;
  let ok = false;
  if (key === "add") ok = PackEditor.addColumn();
  else if (key === "remove") ok = PackEditor.removeColumn();
  else ok = PackEditor.setColumnCount(key);
  if (!ok) {
    setStatus("Click a section first, then choose columns", "error");
    return;
  }
  const info = PackEditor.columnsInfo();
  if (info) syncColumnTools(info);
  setStatus(info && info.count > 1 ? `${info.count} columns` : "Section is one column again", "ok");
});

document.getElementById("tab-tools").addEventListener("click", (event) => {
  const button = event.target.closest("[data-tabs]");
  if (!button) return;
  const key = button.dataset.tabs;
  let ok = false;
  if (key === "add") ok = PackEditor.addTab();
  else if (key === "remove") ok = PackEditor.removeTab();
  else ok = PackEditor.setTabCount(key);
  if (!ok) {
    setStatus("Click a tab section first, then add or remove tabs", "error");
    return;
  }
  const info = PackEditor.tabsInfo();
  if (info) syncTabTools(info);
  const title = document.getElementById("tab-title");
  if (info && title) title.value = info.title;
  setStatus(`${info?.count || 2} tabs`, "ok");
});

document.getElementById("tab-title").addEventListener("input", (event) => {
  PackEditor.setTabTitle(event.target.value);
});

document.getElementById("image-tools").addEventListener("click", (event) => {
  const size = event.target.closest("[data-image-size]");
  if (size) {
    PackEditor.setImageSize(size.dataset.imageSize);
    const info = PackEditor.imageInfo();
    if (info) syncImageTools(info);
    return;
  }
  const align = event.target.closest("[data-image-align]");
  if (align) {
    PackEditor.setImageAlign(align.dataset.imageAlign);
    const info = PackEditor.imageInfo();
    if (info) syncImageTools(info);
  }
});

document.getElementById("image-width").addEventListener("input", (event) => {
  PackEditor.setImageSize(event.target.value);
  document.getElementById("image-width-label").textContent = `${event.target.value}%`;
});

document.getElementById("image-alt-edit").addEventListener("input", (event) => {
  PackEditor.setImageAlt(event.target.value);
});

document.getElementById("btn-replace-image").addEventListener("click", () => {
  openImageModal("replace");
});

let htmlModalMode = "add";

function openHtmlModal(mode) {
  htmlModalMode = mode === "edit" ? "edit" : "add";
  if (htmlModalMode === "add" && !PackEditor._insertContainer()) {
    setStatus("Click inside a section first, then insert HTML", "error");
    return;
  }
  if (htmlModalMode === "edit" && !PackEditor.htmlFromSelection()) {
    setStatus("Click an HTML block first, or use + HTML to insert one", "error");
    return;
  }
  const modal = document.getElementById("html-modal");
  const title = document.getElementById("html-modal-title");
  const apply = document.getElementById("html-apply");
  const source = document.getElementById("html-source");
  title.textContent = htmlModalMode === "edit" ? "Edit HTML" : "Insert HTML";
  apply.textContent = htmlModalMode === "edit" ? "Update HTML" : "Insert HTML";
  source.value = htmlModalMode === "edit" ? PackEditor.htmlSource() : "";
  modal.hidden = false;
  source.focus();
}

function closeHtmlModal() {
  const modal = document.getElementById("html-modal");
  if (modal) modal.hidden = true;
}

function applyHtmlSnippet() {
  const raw = document.getElementById("html-source").value;
  const ok = htmlModalMode === "edit"
    ? PackEditor.replaceHtmlSnippet(raw)
    : PackEditor.insertHtmlSnippet(raw);
  if (!ok) {
    if (!String(raw || "").trim()) setStatus("Paste some HTML to render in the section", "error");
    else setStatus("Click inside a section first, then insert HTML", "error");
    return;
  }
  closeHtmlModal();
  setStatus(htmlModalMode === "edit" ? "HTML updated" : "HTML inserted", "ok");
  schedulePreview(true);
}

document.getElementById("html-cancel").addEventListener("click", () => closeHtmlModal());
document.getElementById("html-apply").addEventListener("click", () => applyHtmlSnippet());
document.getElementById("html-source").addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    applyHtmlSnippet();
  }
});
document.getElementById("html-modal").addEventListener("click", (event) => {
  if (event.target.id === "html-modal") closeHtmlModal();
});

document.getElementById("html-choose-file").addEventListener("click", () => {
  document.getElementById("html-file").click();
});
document.getElementById("html-file").addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    document.getElementById("html-source").value = String(reader.result || "");
  };
  reader.onerror = () => setStatus("Could not read that HTML file", "error");
  reader.readAsText(file);
});

document.getElementById("image-cancel").addEventListener("click", () => closeImageModal());
document.getElementById("image-choose-file").addEventListener("click", () => {
  document.getElementById("image-file").click();
});
document.getElementById("image-file").addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  if (file) readImageFile(file);
});
document.getElementById("image-apply").addEventListener("click", () => {
  const url = document.getElementById("image-url").value.trim();
  const alt = document.getElementById("image-alt").value.trim();
  if (!url) {
    setStatus("Paste an image URL, or upload a file", "error");
    return;
  }
  applyImageSource(url, alt);
});
document.getElementById("image-url").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    document.getElementById("image-apply").click();
  }
});
document.getElementById("image-modal").addEventListener("click", (event) => {
  if (event.target.id === "image-modal") closeImageModal();
});

function schedulePreview(immediate) {
  clearTimeout(state.previewTimer);
  if (!state.docs.some((d) => d.include)) {
    const message = state.docs.length
      ? "Include at least one page to preview the pack."
      : "Add a blank page, or drop HTML, Word, or PowerPoint files, to start.";
    showPreviewHtml(emptyPreview(message));
    els.btnDownload.disabled = true;
    return;
  }
  els.btnDownload.disabled = false;
  const run = () => refreshPreview().catch((err) => setStatus(err.message, "error"));
  if (immediate) run();
  else state.previewTimer = setTimeout(run, 450);
}

function emptyPreview(message) {
  return `<!DOCTYPE html><html><body style="font-family:Arial;padding:48px;color:#857D6B;background:#F2EEE2">${escapeHtml(message)}</body></html>`;
}

async function refreshPreview() {
  if (!state.docs.some((d) => d.include)) return;
  if (state.useImportedPreview && state.lastHtml) {
    showPreviewHtml(state.lastHtml);
    return;
  }
  setStatus("Building preview…");
  try {
    const { res, data } = await postJson("/api/build", buildPayload());
    if (!res.ok) {
      if (state.lastHtml) {
        showPreviewHtml(state.lastHtml);
        setStatus(data.error || "Preview is showing the imported pack; rebuild timed out", "error");
        return;
      }
      setStatus(data.error || "Build failed", "error");
      return;
    }
    state.lastHtml = data.html;
    showPreviewHtml(data.html);
    setStatus("Preview up to date", "ok");
  } catch (err) {
    if (state.lastHtml) {
      showPreviewHtml(state.lastHtml);
      setStatus("Preview is showing the imported pack; rebuild timed out", "error");
      return;
    }
    setStatus(err.message || "Build failed", "error");
  }
}

function showPreviewHtml(html) {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  els.preview.removeAttribute("srcdoc");
  const anchor = packAnchorFor(docById(state.selected));
  els.preview.src = `${state.previewUrl}#${anchor}`;
}

function restorePreviewFrame() {
  showPreviewHtml(state.lastHtml || emptyPreview("Add a blank page, or drop HTML, Word, or PowerPoint files, to start."));
}

function bindPreviewLinks() {
  const doc = els.preview.contentDocument;
  if (!doc || doc.documentElement.dataset.previewBound === "1") return;
  doc.documentElement.dataset.previewBound = "1";
  doc.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (!link) return;
    const raw = (link.getAttribute("href") || "").trim();
    if (raw.startsWith("#")) return;
    event.preventDefault();
    if (/^(https?:|mailto:)/i.test(raw)) {
      window.open(link.href, "_blank", "noopener");
    }
  });
}

els.preview.addEventListener("load", () => {
  try {
    const href = String(els.preview.contentWindow?.location?.href || "");
    if (/^https?:/i.test(href)) {
      restorePreviewFrame();
      return;
    }
  } catch (err) {
    /* ignore cross-origin */
  }
  bindPreviewLinks();
  if (state.tab === "preview") revealPreviewSelection();
});

function blankPageBody() {
  return `<header class="hero">
<h1>New page</h1>
<p>Start writing here.</p>
</header>
<div class="content-card">
<h2>1. Overview</h2>
<p>Add copy here.</p>
</div>`;
}

function selectedDoc() {
  const selected = docById(state.selected);
  if (selected) return selected;
  if (state.docs.length) {
    state.selected = state.docs[0].id;
    return state.docs[0];
  }
  return null;
}

function nextBlankPageMeta() {
  const usedNums = new Set(
    state.docs
      .filter((doc) => doc.role !== "overview")
      .map((doc) => chapterNum(doc.num))
      .filter(Boolean)
  );
  let n = 1;
  while (usedNums.has(String(n).padStart(2, "0"))) n += 1;
  const num = String(n).padStart(2, "0");
  const names = new Set(state.docs.map((doc) => doc.filename.toLowerCase()));
  let filename = `${num}_Page.html`;
  let extra = 2;
  while (names.has(filename.toLowerCase())) {
    filename = `${num}_Page_${extra}.html`;
    extra += 1;
  }
  return { num, filename };
}

function addBlankPage() {
  flushEditor();
  const { num, filename } = nextBlankPageMeta();
  const doc = {
    id: uid(),
    filename,
    title: "New page",
    role: "chapter",
    include: true,
    draft: false,
    num,
    body: blankPageBody(),
  };
  state.docs.push(doc);
  pinOverviews();
  state.selected = doc.id;
  els.btnDownload.disabled = false;
  renderList();
  if (state.tab === "edit") loadEditor();
  syncOverview({ skipFlush: true }).then(() => {
    renderList();
    if (state.tab === "edit") loadEditor();
    schedulePreview();
  });
  setStatus("Added blank page", "ok");
  return doc;
}

function flushEditor() {
  const doc = docById(state.selected);
  if (!doc || PackEditor.loadedId !== doc.id) return;
  const html = PackEditor.flush();
  if (html) {
    if (doc.body !== html) state.useImportedPreview = false;
    doc.body = html;
  }
}

function loadEditor() {
  const doc = selectedDoc();
  const rail = document.getElementById("section-rail");
  const toolbar = document.getElementById("text-toolbar");
  if (!doc) {
    if (rail) rail.hidden = true;
    toolbar?.classList.add("is-idle");
    els.editorHint.textContent = "Add a blank page on the left, or drop a file, to start editing.";
    PackEditor.load(
      "<p>Add a blank page on the left, or drop HTML, Word, or PowerPoint files to start.</p>",
      state.clientCss,
      themeOverrideCss(),
      "",
      false
    );
    return;
  }
  toolbar?.classList.remove("is-idle");
  els.editorHint.textContent = doc.role === "overview"
    ? "Contents is generated from included pages. Edit the intro and card summaries here; titles, numbers, and links stay in sync."
    : `Editing ${doc.filename}. Click into a section, then insert tables, icon cards, code, and other blocks inside it.`;
  PackEditor.load(doc.body || "<p></p>", state.clientCss, themeOverrideCss(), doc.id);
}

async function downloadPack() {
  flushEditor();
  setStatus("Creating file…");
  const filename = settingsPayload().output_filename;
  try {
    const { res, data } = await postJson("/api/build", buildPayload());
    if (!res.ok) {
      if (state.lastHtml) {
        await downloadTranslatedPack(state.lastHtml, filename);
        setStatus("Downloaded the imported pack; rebuild timed out", "error");
        return;
      }
      setStatus(data.error || "Download failed", "error");
      return;
    }
    await downloadTranslatedPack(data.html, data.filename || filename);
    setStatus("Downloaded " + (data.filename || filename), "ok");
  } catch (err) {
    if (state.lastHtml) {
      await downloadTranslatedPack(state.lastHtml, filename);
      setStatus("Downloaded the imported pack; rebuild timed out", "error");
      return;
    }
    setStatus(err.message || "Download failed", "error");
  }
}

async function downloadTranslatedPack(html, filename) {
  let packed = html;
  if (window.PackLang?.embedTranslations) {
    try {
      packed = await PackLang.embedTranslations(html, (message) => setStatus(message));
    } catch (err) {
      packed = html;
    }
  }
  triggerHtmlDownload(packed, filename);
}

function triggerHtmlDownload(html, filename) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "documentation.html";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

els.btnPreview.addEventListener("click", () => {
  state.useImportedPreview = false;
  schedulePreview(true);
});
els.btnDownload.addEventListener("click", () => downloadPack());
els.btnAddPage.addEventListener("click", () => addBlankPage());

document.getElementById("btn-card-icon").addEventListener("click", async (event) => {
  event.preventDefault();
  const picker = document.getElementById("icon-picker");
  await IconLibrary.load();
  renderIconPicker(document.getElementById("icon-search").value);
  picker.hidden = false;
  document.getElementById("icon-search").focus();
});

document.getElementById("card-label").addEventListener("input", (event) => {
  PackEditor.setCardLabel(event.target.value);
});

document.getElementById("code-title").addEventListener("input", (event) => {
  PackEditor.setCodeTitle(event.target.value);
});

document.getElementById("btn-renumber-sections").addEventListener("click", () => {
  PackEditor.renumberSections();
  setStatus("Section numbers updated", "ok");
});

document.getElementById("section-list").addEventListener("change", (event) => {
  const input = event.target.closest("[data-sec-num]");
  if (!input) return;
  PackEditor.setSectionNumber(Number(input.dataset.index), input.value);
  setStatus("Section number updated", "ok");
});

document.getElementById("section-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-sec-act]");
  if (!button) return;
  const index = Number(button.dataset.index);
  if (button.dataset.secAct === "promote") PackEditor.promoteSection(index);
  if (button.dataset.secAct === "demote") PackEditor.demoteSection(index);
});

fetch("css/styles.css")
  .then((res) => res.text())
  .then((css) => {
    state.clientCss = css;
    PackEditor.applyClientCss(css);
    PackEditor.applyTheme(themeOverrideCss());
    const tag = PackEditor.doc()?.getElementById("pack-client-css");
    if (state.tab === "edit" && docById(state.selected) && tag && !tag.textContent.trim()) {
      flushEditor();
      loadEditor();
    }
  })
  .catch(() => {});

showPreviewHtml(emptyPreview("Add a blank page, or drop HTML, Word, or PowerPoint files, to start."));
loadEditor();
renderList();
