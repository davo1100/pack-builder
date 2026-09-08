const BLOCK_SELECTOR = [
  ".hero",
  ".page-header",
  ".content-card",
  ".overview-section",
  ".toc-card",
  ".card",
  ".api-box",
  ".diagram-container",
  ".pack-flow",
  ".pack-image",
  ".pack-columns",
  ".pack-column",
  ".pack-tabs",
  ".pack-tab-panel",
  ".callout",
  ".callout-warning",
  ".checklist-box",
  ".rule-grid",
  "details.code-fold",
  ".code-container",
  ".pack-html",
  "table",
].join(", ");

const PAGE_SECTION_SELECTOR = ".content-card, .overview-section, .page-header, .hero, .toc-card";
const FLOW_SELECTOR = "p, h1, h2, h3, h4, h5, h6, ul, ol, table, blockquote, details";
const PAGE_LEVEL_KINDS = new Set(["card", "hero"]);

const PROTECTED_SELECTOR = [
  "pre",
  "code",
  "table",
  "svg",
  ".code-container",
  ".code-fold",
  ".diagram-container",
  ".pack-flow",
  ".api-table",
].join(", ");

const PackEditor = {
  iframe: null,
  onChange: null,
  onSelect: null,
  selected: null,
  anchor: null,
  lastTable: null,
  lastDiagram: null,
  lastFlow: null,
  pendingFlowReplace: null,
  lastCode: null,
  loadedId: null,
  pendingId: null,
  history: [],
  historyIndex: -1,
  _historyTimer: null,
  _historyPaused: false,

  bind(iframe, handlers) {
    this.iframe = iframe;
    this.onChange = handlers.onChange || (() => {});
    this.onSelect = handlers.onSelect || (() => {});
    this.onEditDiagram = handlers.onEditDiagram || (() => {});
    this.onEditFlow = handlers.onEditFlow || (() => {});
    this.onEditHtml = handlers.onEditHtml || (() => {});
    this.onHistory = handlers.onHistory || (() => {});
    iframe.addEventListener("load", () => this._prepare());
  },

  load(html, clientCss, themeCss, pageId, editable) {
    this.selected = null;
    this.anchor = null;
    this.lastTable = null;
    this.lastDiagram = null;
    this.lastFlow = null;
    this.pendingFlowReplace = null;
    this.lastCode = null;
    this.loadedId = null;
    this.pendingId = pageId || null;
    this._resetHistory();
    const iframe = this.iframe;
    const canEdit = editable !== false;
    const safe = typeof PackSyntax !== "undefined" ? PackSyntax.sanitizeHtml(html) : html;
    iframe.srcdoc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style id="pack-client-css">${clientCss}</style>
  <style id="theme-override">${themeCss || ""}</style>
  <style>
    body { background: var(--cream, #F2EEE2); }
    #edit-root { padding: 28px 32px 80px; max-width: 980px; margin: 0 auto; }
    #edit-root:focus { outline: none; }
    [data-layout-block].is-selected {
      outline: 2px solid #7E6DE2;
      outline-offset: 4px;
    }
    [data-protected] {
      box-shadow: inset 0 0 0 1px rgba(133, 125, 107, 0.55);
      position: relative;
    }
    [data-protected]::after {
      content: attr(data-lock-label);
      position: absolute;
      top: 8px;
      right: 8px;
      font: 700 10px Arial, sans-serif;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #857D6B;
      background: #FFFAE2;
      border: 1px solid #DCC606;
      border-radius: 999px;
      padding: 2px 7px;
      pointer-events: none;
      z-index: 3;
    }
    [data-plain] { caret-color: #FD0966; }
    .pack-image {
      display: block;
      position: relative;
      width: var(--pack-image-width, 56%);
      max-width: 100%;
      margin: 16px 0;
    }
    .pack-image img {
      display: block;
      width: 100%;
      height: auto;
      border-radius: 8px;
    }
    .pack-html {
      margin: 16px 0;
      outline: 1px dashed rgba(126, 109, 226, 0.4);
      outline-offset: 6px;
      min-height: 1.2em;
      max-width: 100%;
      overflow: hidden;
    }
    .pack-html-frame {
      display: block;
      width: 100%;
      border: 0;
      min-height: 80px;
      pointer-events: none;
      background: transparent;
    }
    .pack-image-left { margin-right: auto; margin-left: 0; }
    .pack-image-center { margin-left: auto; margin-right: auto; }
    .pack-image-right { margin-left: auto; margin-right: 0; }
    [data-flow-candidate] {
      position: relative;
    }
    [data-flow-candidate]::before {
      content: "API flow";
      position: absolute;
      top: 8px;
      left: 8px;
      font: 700 10px Arial, sans-serif;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #fff;
      background: #7E6DE2;
      border-radius: 999px;
      padding: 2px 7px;
      pointer-events: none;
      z-index: 3;
    }
    .pack-image-handle {
      position: absolute;
      right: -5px;
      bottom: -5px;
      width: 14px;
      height: 14px;
      background: #7E6DE2;
      border: 2px solid #fff;
      border-radius: 3px;
      box-shadow: 0 1px 4px rgba(32, 29, 34, 0.25);
      cursor: nwse-resize;
    }
    .pack-columns {
      display: grid;
      grid-template-columns: repeat(var(--pack-columns, 2), minmax(0, 1fr));
      gap: 16px;
      margin: 16px 0;
      align-items: start;
    }
    .pack-column {
      min-width: 0;
      min-height: 72px;
      padding: 8px 10px;
      border-radius: 8px;
      outline: 1px dashed rgba(126, 109, 226, 0.4);
    }
    .pack-tabs-bar,
    .pack-tab {
      user-select: none;
    }
    .pack-tab-panel {
      min-height: 88px;
    }
    #edit-root .is-hidden {
      display: block !important;
      opacity: 0.4;
      outline: 1px dashed #857D6B;
      outline-offset: 4px;
    }
  </style>
</head>
<body>
  <div id="edit-root" class="content"${canEdit ? ' contenteditable="true"' : ""}>${safe}</div>
</body>
</html>`;
  },

  applyClientCss(css) {
    const doc = this.doc();
    if (!doc) return;
    let tag = doc.getElementById("pack-client-css");
    if (!tag) {
      tag = doc.createElement("style");
      tag.id = "pack-client-css";
      doc.head.insertBefore(tag, doc.head.firstChild);
    }
    tag.textContent = css || "";
  },

  applyTheme(themeCss) {
    const doc = this.doc();
    if (!doc) return;
    let tag = doc.getElementById("theme-override");
    if (!tag) {
      tag = doc.createElement("style");
      tag.id = "theme-override";
      doc.head.appendChild(tag);
    }
    tag.textContent = themeCss || "";
  },

  doc() {
    return this.iframe?.contentDocument || null;
  },

  root() {
    return this.doc()?.getElementById("edit-root") || null;
  },

  flush() {
    const root = this.root();
    if (!root) return "";
    const clone = root.cloneNode(true);
    clone.querySelectorAll(".is-selected").forEach((el) => el.classList.remove("is-selected"));
    clone.querySelectorAll("pre code").forEach((code) => {
      const text =
        typeof PackSyntax !== "undefined" && PackSyntax.plainText
          ? PackSyntax.plainText(code)
          : code.textContent;
      code.textContent = text;
    });
    clone.querySelectorAll("[contenteditable], [data-protected], [data-plain], [data-layout-block], [data-lock-label]").forEach((el) => {
      el.removeAttribute("contenteditable");
      el.removeAttribute("data-protected");
      el.removeAttribute("data-plain");
      el.removeAttribute("data-layout-block");
      el.removeAttribute("data-lock-label");
    });
    clone.querySelectorAll(".pack-image-handle").forEach((el) => el.remove());
    clone.querySelectorAll(".pack-html-frame").forEach((frame) => {
      frame.removeAttribute("srcdoc");
      frame.removeAttribute("data-mounted");
      frame.style.removeProperty("height");
    });
    return clone.innerHTML;
  },

  _refreshFlows() {
    const root = this.root();
    if (!root || typeof FlowRender === "undefined") return;
    root.querySelectorAll(".pack-flow[data-flow]").forEach((el) => {
      const model = FlowRender.parseEmbed(el);
      if (!model) return;
      const drawn = FlowRender.html(model);
      if (!drawn.ok || !drawn.html) return;
      const holder = root.ownerDocument.createElement("div");
      holder.innerHTML = drawn.html;
      const next = holder.querySelector(".pack-flow");
      if (!next) return;
      el.innerHTML = next.innerHTML;
      el.setAttribute("data-flow", next.getAttribute("data-flow") || el.getAttribute("data-flow"));
    });
  },

  command(name, value) {
    if (name === "undo") return this.undo();
    if (name === "redo") return this.redo();
    const doc = this.doc();
    const info = this.selectionInfo();
    if (!doc) return false;
    if (info.plain) return false;
    doc.defaultView.focus();
    if (name === "createLink") {
      const href = value || doc.defaultView.prompt("Link URL", "https://");
      if (!href) return false;
      doc.execCommand("createLink", false, href);
    } else if (name === "formatBlock") {
      const tag = String(value || "p");
      doc.execCommand("formatBlock", false, tag.startsWith("<") ? tag : `<${tag}>`);
    } else if (name === "foreColor" || name === "hiliteColor") {
      doc.execCommand(name, false, value);
    } else {
      doc.execCommand(name, false, value || false);
    }
    this._changed();
    return true;
  },

  insert(kind) {
    if (!this.doc()) return;
    if (kind === "hero") {
      const root = this.root();
      const existing = root?.querySelector(".hero, .page-header");
      if (existing) {
        this._select(existing);
        return;
      }
      this._placeHtml(this._snippet("hero"), { pageLevel: true, prepend: true });
      return;
    }
    if (kind === "columns") {
      const grid = this.selected?.closest?.(".pack-columns");
      if (grid) this._select(grid);
      this._placeHtml(this._snippet("columns"));
      return;
    }
    if (kind === "tabs") {
      this._placeHtml(this._tabsMarkup(2));
      return;
    }
    const pageLevel = PAGE_LEVEL_KINDS.has(kind);
    const html = this._snippet(kind, { inside: Boolean(!pageLevel && this._insertContainer()) });
    if (!html) return;
    this._placeHtml(html, { pageLevel });
  },

  insertHtml(html) {
    this._placeHtml(html, { pageLevel: false });
  },

  htmlFromSelection() {
    if (this.selected?.matches?.(".pack-html")) return this.selected;
    return this.selected?.closest?.(".pack-html") || this.anchor?.closest?.(".pack-html") || null;
  },

  htmlSource() {
    const block = this.htmlFromSelection();
    if (!block) return "";
    const encoded = block.getAttribute("data-html-src");
    if (encoded && typeof PackHtml !== "undefined") return PackHtml.decode(encoded);
    const frame = block.querySelector(".pack-html-frame");
    if (frame?.srcdoc && typeof PackHtml !== "undefined") return PackHtml.stripBridge(frame.srcdoc);
    return block.innerHTML || "";
  },

  _htmlBlock(source) {
    const doc = this.doc();
    const wrap = doc.createElement("div");
    wrap.className = "pack-html";
    if (typeof PackHtml !== "undefined") wrap.setAttribute("data-html-src", PackHtml.encode(source));
    const frame = doc.createElement("iframe");
    frame.className = "pack-html-frame";
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("title", "Embedded HTML");
    wrap.appendChild(frame);
    return wrap;
  },

  insertHtmlSnippet(raw) {
    const source = String(raw || "").trim();
    if (!source || !this.root() || typeof PackHtml === "undefined") return false;
    if (!this._insertContainer()) return false;
    this._placeElement(this._htmlBlock(source), { pageLevel: false });
    return true;
  },

  replaceHtmlSnippet(raw) {
    const block = this.htmlFromSelection();
    const source = String(raw || "").trim();
    if (!block || !source || typeof PackHtml === "undefined") return false;
    block.setAttribute("data-html-src", PackHtml.encode(source));
    block.replaceChildren(this._htmlBlock(source).firstChild);
    this._prepare();
    this._select(block);
    this._changed();
    return true;
  },

  _safeImageSrc(src) {
    const value = String(src || "").trim();
    if (/^https?:\/\//i.test(value)) return value;
    if (/^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,/i.test(value)) return value;
    return "";
  },

  insertImage(src, alt) {
    const safeSrc = this._safeImageSrc(src);
    if (!safeSrc || !this.root()) return false;
    const altText = String(alt || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
    const encoded = safeSrc.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
    this._placeHtml(
      `<figure class="pack-image pack-image-center" style="--pack-image-width:56%"><img src="${encoded}" alt="${altText}"></figure>`
    );
    return true;
  },

  imageFromSelection() {
    if (this.selected?.matches?.(".pack-image")) return this.selected;
    return this.selected?.closest?.(".pack-image") || null;
  },

  imageInfo() {
    const figure = this.imageFromSelection();
    if (!figure) return null;
    const img = figure.querySelector("img");
    const raw = figure.style.getPropertyValue("--pack-image-width");
    const width = Math.max(10, Math.min(100, parseInt(raw, 10) || 56));
    const align = figure.classList.contains("pack-image-left")
      ? "left"
      : figure.classList.contains("pack-image-right")
        ? "right"
        : "center";
    return {
      width,
      align,
      alt: img?.getAttribute("alt") || "",
      src: img?.getAttribute("src") || "",
    };
  },

  setImageSize(percent) {
    const figure = this.imageFromSelection();
    if (!figure) return false;
    const width = Math.max(10, Math.min(100, Math.round(Number(percent) || 56)));
    figure.style.setProperty("--pack-image-width", `${width}%`);
    this._changed();
    return true;
  },

  setImageAlign(align) {
    const figure = this.imageFromSelection();
    if (!figure) return false;
    const next = ["left", "center", "right"].includes(align) ? align : "center";
    figure.classList.remove("pack-image-left", "pack-image-center", "pack-image-right");
    figure.classList.add(`pack-image-${next}`);
    this._changed();
    return true;
  },

  codeFromSelection() {
    if (this.selected?.matches?.(".code-fold, .code-container")) return this.selected;
    const nested = this.selected?.closest?.(".code-fold, .code-container");
    if (nested) return nested;
    const node = this.doc()?.getSelection()?.anchorNode;
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    const fromCaret = el?.closest?.(".code-fold, .code-container");
    if (fromCaret) return fromCaret;
    return null;
  },

  codeInfo() {
    const block = this.codeFromSelection();
    if (!block) return null;
    const summary = block.matches("details") ? block.querySelector(":scope > summary") : null;
    const headerTitle = block.querySelector(".code-header > span");
    const title = (summary?.textContent || headerTitle?.textContent || "").replace(/\s+/g, " ").trim();
    return { title };
  },

  setCodeTitle(title) {
    const block = this.codeFromSelection();
    if (!block) return false;
    const next = String(title ?? "");
    const summary = block.matches("details") ? block.querySelector(":scope > summary") : null;
    if (summary) summary.textContent = next;
    let headerTitle = block.querySelector(".code-header > span:first-child");
    if (!headerTitle) {
      const header = block.querySelector(".code-header");
      if (header) {
        headerTitle = this.doc().createElement("span");
        header.prepend(headerTitle);
      }
    }
    if (headerTitle) headerTitle.textContent = next;
    if (!summary && !headerTitle) return false;
    this._changed();
    return true;
  },

  setImageAlt(alt) {
    const img = this.imageFromSelection()?.querySelector("img");
    if (!img) return false;
    img.setAttribute("alt", String(alt || ""));
    this._changed();
    return true;
  },

  replaceImageSrc(src) {
    const img = this.imageFromSelection()?.querySelector("img");
    const safeSrc = this._safeImageSrc(src);
    if (!img || !safeSrc) return false;
    img.setAttribute("src", safeSrc);
    this._changed();
    return true;
  },

  flowImageFromSelection() {
    const host =
      this.pendingFlowReplace && this.root()?.contains(this.pendingFlowReplace)
        ? this.pendingFlowReplace
        : this.imageFromSelection() || this.diagramFromSelection();
    if (!host || host.matches?.(".pack-flow") || host.closest?.(".pack-flow")) return null;
    const img = host.matches?.("img") ? host : host.querySelector?.("img");
    const svg = host.matches?.("svg") ? host : host.querySelector?.("svg");
    const src =
      img?.currentSrc ||
      img?.src ||
      img?.getAttribute("src") ||
      img?.getAttribute("data-image-src") ||
      "";
    if (!img && !svg) return null;
    return { el: host, img, svg, src, alt: img?.getAttribute("alt") || "" };
  },

  replaceFlowSource(html) {
    const source = this.flowImageFromSelection();
    const current = source?.el;
    this.pendingFlowReplace = null;
    if (current) {
      current.outerHTML = html;
      this.lastDiagram = null;
      this.lastFlow = null;
      this._prepare();
      this._changed();
      return true;
    }
    this.insertHtml(html);
    return true;
  },

  _markFlowCandidates() {
    const root = this.root();
    if (!root) return;
    root.querySelectorAll(".pack-image img, .diagram-container img").forEach((img) => {
      const host = img.closest(".pack-image, .diagram-container");
      if (!host) return;
      const apply = () => {
        const yes = typeof FlowImage !== "undefined" && FlowImage.looksLikeDiagram(img);
        if (yes) host.setAttribute("data-flow-candidate", "true");
        else host.removeAttribute("data-flow-candidate");
        if (this.selected === host || host.contains?.(this.selected)) this.onSelect(this.selectionInfo());
      };
      apply();
      if (!img.complete || !img.naturalWidth) img.addEventListener("load", apply, { once: true });
    });
  },

  _sectionFromSelection() {
    if (this.selected?.matches?.(".content-card, .overview-section")) return this.selected;
    return this.selected?.closest?.(".content-card, .overview-section")
      || this.anchor?.closest?.(".content-card, .overview-section")
      || null;
  },

  columnsFromSelection() {
    if (this.selected?.matches?.(".pack-columns")) return this.selected;
    const nested = this.selected?.closest?.(".pack-columns");
    if (nested) return nested;
    return this._sectionFromSelection()?.querySelector(":scope > .pack-columns") || null;
  },

  columnsInfo() {
    const grid = this.columnsFromSelection();
    const section = this._sectionFromSelection();
    if (!grid && !section) return null;
    const count = grid ? grid.querySelectorAll(":scope > .pack-column").length : 1;
    return { count: Math.max(1, Math.min(4, count)), hasGrid: Boolean(grid) };
  },

  setColumnCount(count) {
    const n = Math.max(1, Math.min(4, Math.round(Number(count) || 2)));
    const section = this._sectionFromSelection();
    let grid = this.columnsFromSelection();
    if (!grid && section && n > 1) grid = this._wrapSectionInColumns(section);
    if (!grid) return false;
    this._applyColumnCount(grid, n);
    this._prepare();
    if (n === 1) {
      if (section && this.root()?.contains(section)) this._select(section);
    } else if (this.root()?.contains(grid)) this._select(grid);
    this._changed();
    return true;
  },

  addColumn() {
    const info = this.columnsInfo();
    return this.setColumnCount(Math.min(4, (info?.count || 1) + 1));
  },

  removeColumn() {
    const info = this.columnsInfo();
    if (!info || info.count <= 1) return false;
    return this.setColumnCount(info.count - 1);
  },

  _wrapSectionInColumns(section) {
    const doc = this.doc();
    const grid = doc.createElement("div");
    grid.className = "pack-columns pack-columns-2";
    grid.style.setProperty("--pack-columns", "2");
    const col = doc.createElement("div");
    col.className = "pack-column";
    const heading = section.firstElementChild?.matches?.("h1, h2") ? section.firstElementChild : null;
    [...section.children].forEach((child) => {
      if (child === heading) return;
      col.appendChild(child);
    });
    if (!col.childNodes.length) {
      const p = doc.createElement("p");
      p.textContent = "Add copy here.";
      col.appendChild(p);
    }
    grid.appendChild(col);
    section.appendChild(grid);
    return grid;
  },

  _columnPlaceholder(col) {
    const text = col.textContent.trim();
    return !text || text === "Add copy here." || text === "Left column" || text === "Right column";
  },

  _applyColumnCount(grid, count) {
    const n = Math.max(1, Math.min(4, count));
    const cols = [...grid.querySelectorAll(":scope > .pack-column")];
    const doc = this.doc();
    while (cols.length < n) {
      const col = doc.createElement("div");
      col.className = "pack-column";
      const p = doc.createElement("p");
      p.textContent = "Add copy here.";
      col.appendChild(p);
      grid.appendChild(col);
      cols.push(col);
    }
    while (cols.length > n) {
      const last = cols.pop();
      if (!this._columnPlaceholder(last) && cols.length) {
        const prev = cols[cols.length - 1];
        while (last.firstChild) prev.appendChild(last.firstChild);
      }
      last.remove();
    }
    if (n === 1) {
      const col = grid.querySelector(":scope > .pack-column");
      const parent = grid.parentNode;
      while (col?.firstChild) parent.insertBefore(col.firstChild, grid);
      grid.remove();
      return;
    }
    this._syncColumnVar(grid);
  },

  _syncColumnVar(grid) {
    if (!grid) return;
    const n = grid.querySelectorAll(":scope > .pack-column").length;
    grid.style.setProperty("--pack-columns", String(n));
    grid.classList.remove("pack-columns-1", "pack-columns-2", "pack-columns-3", "pack-columns-4");
    if (n > 1) grid.classList.add(`pack-columns-${n}`);
  },

  tabsFromSelection() {
    if (this.selected?.matches?.(".pack-tabs")) return this.selected;
    return this.selected?.closest?.(".pack-tabs") || this.anchor?.closest?.(".pack-tabs") || null;
  },

  tabsInfo() {
    const tabs = this.tabsFromSelection();
    if (!tabs) return null;
    const panels = [...tabs.querySelectorAll(":scope > .pack-tab-panel")];
    const checked = tabs.querySelector(".pack-tab-radio:checked");
    const index = checked ? Number(checked.value) : 0;
    const label = tabs.querySelectorAll(".pack-tab-name")[index];
    return {
      count: panels.length,
      index: Number.isFinite(index) ? index : 0,
      title: label ? label.textContent.trim() : "",
    };
  },

  _activeTabPanel(tabs) {
    if (!tabs) return null;
    const checked = tabs.querySelector(".pack-tab-radio:checked");
    const index = checked ? checked.value : "0";
    return tabs.querySelector(`:scope > .pack-tab-panel[data-tab="${index}"]`)
      || tabs.querySelector(":scope > .pack-tab-panel");
  },

  _tabPlaceholder(panel) {
    const text = panel?.textContent.trim() || "";
    return !text || text === "Add copy here.";
  },

  _tabsMarkup(count, titles) {
    const n = Math.max(2, Math.min(6, count || 2));
    const name = "pt" + Math.random().toString(36).slice(2, 8);
    const labels = [];
    const panels = [];
    for (let i = 0; i < n; i += 1) {
      const title = this._escTabName(titles?.[i] || `Tab ${i + 1}`);
      const checked = i === 0 ? " checked" : "";
      labels.push(`<label class="pack-tab"><input class="pack-tab-radio" type="radio" name="${name}" value="${i}"${checked}><span class="pack-tab-name">${title}</span></label>`);
      panels.push(`<div class="pack-tab-panel" data-tab="${i}"><p>Add copy here.</p></div>`);
    }
    return `<div class="pack-tabs"><div class="pack-tabs-bar" role="tablist">${labels.join("")}</div>${panels.join("")}</div>`;
  },

  _escTabName(text) {
    return String(text || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  },

  _syncTabRadios(tabs) {
    if (!tabs) return;
    const name = "pt" + Math.random().toString(36).slice(2, 8);
    const radios = [...tabs.querySelectorAll(".pack-tab-radio")];
    const panels = [...tabs.querySelectorAll(":scope > .pack-tab-panel")];
    radios.forEach((radio, i) => {
      radio.name = name;
      radio.value = String(i);
    });
    panels.forEach((panel, i) => panel.setAttribute("data-tab", String(i)));
  },

  _uniqTabRadios(tabs, root) {
    if (!tabs) return;
    const first = tabs.querySelector(".pack-tab-radio");
    const name = first?.getAttribute("name") || "";
    const clash = name && [...(root || this.root())?.querySelectorAll(".pack-tabs") || []].some((other) => {
      if (other === tabs) return false;
      return other.querySelector(".pack-tab-radio")?.getAttribute("name") === name;
    });
    if (!name || clash) this._syncTabRadios(tabs);
    else {
      [...tabs.querySelectorAll(".pack-tab-radio")].forEach((radio, i) => { radio.value = String(i); });
      [...tabs.querySelectorAll(":scope > .pack-tab-panel")].forEach((panel, i) => panel.setAttribute("data-tab", String(i)));
    }
  },

  setTabCount(count) {
    const tabs = this.tabsFromSelection();
    if (!tabs) return false;
    const n = Math.max(2, Math.min(6, Math.round(Number(count) || 2)));
    const bar = tabs.querySelector(".pack-tabs-bar");
    const doc = this.doc();
    if (!bar || !doc) return false;
    let labels = [...bar.querySelectorAll(":scope > .pack-tab")];
    let panels = [...tabs.querySelectorAll(":scope > .pack-tab-panel")];
    while (labels.length < n) {
      const i = labels.length;
      const label = doc.createElement("label");
      label.className = "pack-tab";
      label.innerHTML = `<input class="pack-tab-radio" type="radio" value="${i}"><span class="pack-tab-name">Tab ${i + 1}</span>`;
      bar.appendChild(label);
      labels.push(label);
      const panel = doc.createElement("div");
      panel.className = "pack-tab-panel";
      panel.setAttribute("data-tab", String(i));
      panel.innerHTML = "<p>Add copy here.</p>";
      tabs.appendChild(panel);
      panels.push(panel);
    }
    while (labels.length > n) {
      const lastLabel = labels.pop();
      const lastPanel = panels.pop();
      if (lastPanel && !this._tabPlaceholder(lastPanel) && panels.length) {
        const prev = panels[panels.length - 1];
        while (lastPanel.firstChild) prev.appendChild(lastPanel.firstChild);
      }
      lastLabel?.remove();
      lastPanel?.remove();
    }
    this._syncTabRadios(tabs);
    const radios = [...tabs.querySelectorAll(".pack-tab-radio")];
    const last = radios[radios.length - 1];
    if (last) last.checked = true;
    this._prepare();
    const active = this._activeTabPanel(tabs);
    this._select(active || tabs);
    this._changed();
    return true;
  },

  addTab() {
    const info = this.tabsInfo();
    if (!info || info.count >= 6) return false;
    return this.setTabCount(info.count + 1);
  },

  removeTab() {
    const info = this.tabsInfo();
    if (!info || info.count <= 2) return false;
    return this.setTabCount(info.count - 1);
  },

  setTabTitle(title) {
    const tabs = this.tabsFromSelection();
    const info = this.tabsInfo();
    if (!tabs || !info) return false;
    const name = tabs.querySelectorAll(".pack-tab-name")[info.index];
    if (!name) return false;
    const next = String(title || "").trim() || `Tab ${info.index + 1}`;
    name.textContent = next;
    this._changed();
    return true;
  },

  _icon(name, size) {
    return typeof IconLibrary !== "undefined" ? IconLibrary.html(name, size) : "";
  },

  _snippet(kind, options) {
    const inside = Boolean(options?.inside);
    const snippets = {
      paragraph: "<p>New paragraph</p>",
      heading: inside ? "<h3>New heading</h3>" : "<h2>New heading</h2>",
      callout: `<div class="callout callout-with-icon">${this._icon("info")}<div><p>Note for implementers.</p></div></div>`,
      warning: `<div class="callout-warning callout-with-icon">${this._icon("warning")}<div><p>Warning for implementers.</p></div></div>`,
      rules: `<div class="rule-grid">
  <div class="rule-item"><h4>${this._icon("clock", 18)} Spend Amount Limits</h4><p>Limits on maximum single transaction values and cumulative spend totals over periods.</p></div>
  <div class="rule-item"><h4>${this._icon("clipboard", 18)} Spend Count Limits</h4><p>Limits on total number of spend authorisations over periods (daily, weekly, monthly, yearly).</p></div>
  <div class="rule-item"><h4>${this._icon("clock", 18)} Time Restrictions</h4><p>Restrictions on allowed time-of-day windows per weekday during which transactions are permitted.</p></div>
  <div class="rule-item"><h4>${this._icon("calendar", 18)} Date Restrictions</h4><p>Restrictions on specific calendar dates or date ranges.</p></div>
  <div class="rule-item"><h4>${this._icon("credit-card", 18)} Acceptance Method</h4><p>Restricts POS, eCommerce, Contactless, or tokenised mobile wallet channels.</p></div>
  <div class="rule-item"><h4>${this._icon("globe", 18)} Country Code Limits</h4><p>Restricts allowed countries where authorisations can be processed.</p></div>
</div>`,
      card: '<div class="content-card"><h2>New section</h2><p>Add copy here.</p></div>',
      columns: `<div class="pack-columns pack-columns-2" style="--pack-columns:2">
  <div class="pack-column"><p>Left column</p></div>
  <div class="pack-column"><p>Right column</p></div>
</div>`,
      hero: `<header class="hero">
  <h1>Page title</h1>
  <p>Short description of this page.</p>
  <div class="hero-meta">
    <span><strong>Label:</strong> Value</span>
    <span><strong>Label:</strong> Value</span>
  </div>
</header>`,
      table: `<table class="api-table">
  <tr><th>Label</th><td>Value</td></tr>
  <tr><th>Label</th><td>Value</td></tr>
</table>`,
      code: `<details class="code-fold" open><summary>JSON Payload</summary>
<div class="code-container">
  <div class="code-header">
    <span>JSON Payload</span>
    <span>Example</span>
  </div>
  <pre><code data-lang="json">{
  "key": "value"
}</code></pre>
</div>
</details>`,
      api: `<div class="api-box">
  <div class="api-row">
    <span class="api-label">API</span>
    <span class="api-value"><code>api-name</code></span>
  </div>
  <div class="api-row">
    <span class="api-label">Endpoint</span>
    <span class="api-value"><code>endpoint-name</code></span>
  </div>
  <div class="api-row">
    <span class="api-label">Request</span>
    <span class="api-value"><span class="badge badge-get">GET</span> <code>https://&lt;host&gt;.pps.edenred.com/path</code></span>
  </div>
</div>`,
      checklist: `<div class="checklist-box">
  <ul>
    <li><span class="check-icon">&#10003;</span> First task</li>
    <li><span class="check-icon">&#10003;</span> Second task</li>
  </ul>
</div>`,
    };
    return snippets[kind] || "";
  },

  _insertContainer() {
    const selected = this.selected;
    const fromTab = selected?.matches?.(".pack-tab-panel")
      ? selected
      : selected?.closest?.(".pack-tab-panel") || this.anchor?.closest?.(".pack-tab-panel");
    if (fromTab) return fromTab;
    const tabsHost = selected?.matches?.(".pack-tabs")
      ? selected
      : selected?.closest?.(".pack-tabs") || this.anchor?.closest?.(".pack-tabs");
    if (tabsHost) {
      const active = this._activeTabPanel(tabsHost);
      if (active) return active;
    }
    if (selected?.matches?.(".pack-column")) return selected;
    const fromColumn = selected?.closest?.(".pack-column") || this.anchor?.closest?.(".pack-column");
    if (fromColumn) return fromColumn;
    if (selected?.matches?.(".content-card")) return selected;
    const fromSelected = selected?.closest?.(".content-card");
    if (fromSelected) return fromSelected;
    if (this.anchor?.closest) {
      const fromAnchor = this.anchor.closest(".content-card");
      if (fromAnchor) return fromAnchor;
    }
    if (selected?.matches?.(".overview-section")) return selected;
    const cards = this.root()?.querySelectorAll(".content-card, .overview-section");
    if (cards?.length === 1) return cards[0];
    return null;
  },

  _placeHtml(html, options) {
    const root = this.root();
    const doc = this.doc();
    if (!root || !doc || !html) return;
    const template = doc.createElement("template");
    template.innerHTML = html.trim();
    this._placeNodes([...template.content.childNodes], options);
  },

  _placeElement(el, options) {
    if (!el) return;
    this._placeNodes([el], options);
  },

  _placeNodes(nodes, options) {
    const root = this.root();
    const doc = this.doc();
    if (!root || !doc || !nodes?.length) return;
    const pageLevel = Boolean(options?.pageLevel);
    const selected = this.selected;
    let target = null;
    let position = "beforeend";

    if (options?.prepend) {
      target = root;
      position = "afterbegin";
    } else if (pageLevel) {
      const outer = selected?.closest?.(PAGE_SECTION_SELECTOR) || selected;
      if (outer?.parentNode) {
        target = outer;
        position = "afterend";
      } else {
        target = root;
      }
    } else {
      const container = this._insertContainer();
      if (container) {
        const inner = (selected && selected !== container && container.contains(selected) && selected)
          || (this.anchor && this.anchor !== container && container.contains(this.anchor) && this.anchor)
          || null;
        if (inner) {
          target = inner;
          position = "afterend";
        } else {
          target = container;
        }
      } else if (selected?.parentNode) {
        target = selected;
        position = "afterend";
      } else {
        target = root;
      }
    }

    const panel = target?.matches?.(".pack-tab-panel")
      ? target
      : target?.closest?.(".pack-tab-panel") || null;
    if (panel && this._isTabPlaceholder(panel) && nodes.some((node) => node.nodeType === 1)) {
      panel.replaceChildren();
      target = panel;
      position = "beforeend";
    }

    if (position === "afterbegin") {
      target.prepend(...nodes);
    } else if (position === "afterend") {
      let ref = target;
      nodes.forEach((node) => {
        ref.after(node);
        if (node.nodeType === 1) ref = node;
      });
    } else {
      nodes.forEach((node) => target.appendChild(node));
    }

    const placed = [...nodes].reverse().find((node) => node.nodeType === 1);
    this._prepare();
    if (placed?.matches?.(BLOCK_SELECTOR)) this._select(placed);
    else if (placed) this.anchor = placed;
    this._changed();
  },

  _isTabPlaceholder(panel) {
    if (!panel?.matches?.(".pack-tab-panel")) return false;
    const text = String(panel.textContent || "").replace(/\u00a0/g, " ").trim().toLowerCase();
    if (!text || text === "add copy here." || text === "add copy here") return true;
    const meaningful = [...panel.children].some((node) => {
      if (node.matches?.("br")) return false;
      if (node.matches?.(".pack-flow, .pack-html, .pack-image, .diagram-container, table, img, svg, iframe")) return true;
      const inner = String(node.textContent || "").replace(/\u00a0/g, " ").trim().toLowerCase();
      return Boolean(inner) && inner !== "add copy here." && inner !== "add copy here";
    });
    return !meaningful;
  },

  _stripTabPlaceholderAroundObjects(panel) {
    if (!panel?.matches?.(".pack-tab-panel")) return;
    const hasObject = panel.querySelector(":scope > .pack-flow, :scope > .pack-html, :scope > .pack-image, :scope > .diagram-container");
    if (!hasObject) return;
    [...panel.children].forEach((node) => {
      if (node.matches?.(".pack-flow, .pack-html, .pack-image, .diagram-container, table")) return;
      const inner = String(node.textContent || "").replace(/\u00a0/g, " ").trim().toLowerCase();
      if (!inner || inner === "add copy here." || inner === "add copy here") node.remove();
    });
  },

  insertInline(html) {
    const doc = this.doc();
    const info = this.selectionInfo();
    if (!doc || !html) return false;
    if (info.plain) return false;
    doc.defaultView.focus();
    const ok = doc.execCommand("insertHTML", false, `${html}&nbsp;`);
    this._changed();
    return ok;
  },

  diagramFromSelection() {
    return (
      (this.lastDiagram && this.root()?.contains(this.lastDiagram) && this.lastDiagram) ||
      this.selected?.closest?.(".diagram-container") ||
      this.selected?.querySelector?.(".diagram-container") ||
      null
    );
  },

  replaceDiagram(html) {
    const current = this.diagramFromSelection();
    if (current) {
      current.outerHTML = html;
      this.lastDiagram = null;
      this._prepare();
      this._changed();
      return;
    }
    this.insertHtml(html);
  },

  flowFromSelection() {
    return (
      (this.lastFlow && this.root()?.contains(this.lastFlow) && this.lastFlow) ||
      this.selected?.closest?.(".pack-flow") ||
      this.selected?.querySelector?.(".pack-flow") ||
      null
    );
  },

  replaceFlow(html) {
    const current = this.flowFromSelection();
    if (current) {
      current.outerHTML = html;
      this.lastFlow = null;
      this._prepare();
      this._changed();
      return;
    }
    this.insertHtml(html);
  },

  layout(action, extra) {
    if (action === "add-row" || action === "add-col") {
      const table = this._tableFromSelection();
      if (!table) return false;
      if (action === "add-row") {
        const cols = table.querySelector("tr")?.children.length || 2;
        const row = table.insertRow(-1);
        for (let i = 0; i < cols; i += 1) {
          row.insertCell(-1).textContent = "Value";
        }
      } else {
        table.querySelectorAll("tr").forEach((row, index) => {
          const cell = this.doc().createElement(index === 0 && row.querySelector("th") ? "th" : "td");
          cell.textContent = index === 0 ? "Label" : "Value";
          row.appendChild(cell);
        });
      }
      this._prepare();
      this._changed();
      return true;
    }
    const block = this.selected;
    if (!block) return false;
    if (action === "up" && block.previousElementSibling) {
      const prev = block.previousElementSibling;
      const parent = block.parentNode;
      const lockTitle = parent?.matches?.(".content-card, .overview-section")
        && prev.matches("h1, h2")
        && prev === parent.firstElementChild;
      if (!lockTitle) parent.insertBefore(block, prev);
    } else if (action === "down" && block.nextElementSibling) {
      block.parentNode.insertBefore(block.nextElementSibling, block);
    } else if (action === "duplicate") {
      const copy = block.cloneNode(true);
      copy.classList.remove("is-selected");
      block.after(copy);
      if (copy.matches?.(".pack-tabs")) this._syncTabRadios(copy);
    } else if (action === "delete") {
      if (!this.doc().defaultView.confirm("Delete this block?")) return false;
      const parent = block.parentNode;
      const parentGrid = block.matches(".pack-column") ? block.parentElement : null;
      const parentTabs = block.matches(".pack-tab-panel") ? block.closest(".pack-tabs") : null;
      const tabIndex = block.matches(".pack-tab-panel") ? block.getAttribute("data-tab") : null;
      block.remove();
      if (parentGrid) {
        if (!parentGrid.querySelector(":scope > .pack-column")) parentGrid.remove();
        else this._syncColumnVar(parentGrid);
      }
      if (parentTabs) {
        [...parentTabs.querySelectorAll(".pack-tab")].find((el) => el.querySelector("input")?.value === tabIndex)?.remove();
        this._syncTabRadios(parentTabs);
        if (!parentTabs.querySelector(":scope > .pack-tab-panel")) parentTabs.remove();
      }
      this.selected = parent?.querySelector(BLOCK_SELECTOR)
        || (parent?.matches?.(BLOCK_SELECTOR) ? parent : null);
    } else if (action === "hide") {
      block.classList.toggle("is-hidden");
    } else if (action === "width") {
      block.classList.remove("layout-narrow", "layout-wide");
      if (extra) block.classList.add(extra);
    } else if (action === "align") {
      block.classList.toggle("layout-center", extra === "center");
    } else if (action === "space") {
      block.classList.remove("layout-space-sm", "layout-space-lg");
      if (extra) block.classList.add(extra);
    } else if (action === "tone") {
      if (!block.matches(".hero, .page-header")) return false;
      if (!extra || extra === "magenta") block.removeAttribute("data-tone");
      else block.setAttribute("data-tone", extra);
    }
    const grid = this.selected?.matches?.(".pack-columns")
      ? this.selected
      : this.selected?.closest?.(".pack-columns");
    if (grid && this.root()?.contains(grid)) this._syncColumnVar(grid);
    this._prepare();
    if (this.selected) this._select(this.selected);
    this._changed();
    return true;
  },

  selectionInfo() {
    const doc = this.doc();
    const empty = { plain: false, protected: false, label: "Page", tag: "" };
    if (!doc) return empty;
    const sel = doc.getSelection();
    const node = sel?.anchorNode ? (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement) : this.selected;
    if (!node || !this.root()?.contains(node)) {
      return this.selected
        ? { plain: this.selected.hasAttribute("data-protected"), protected: this.selected.hasAttribute("data-protected"), label: this._label(this.selected), tag: this.selected.tagName }
        : empty;
    }
    const plain = Boolean(node.closest("[data-plain]"));
    const locked = node.closest("[data-protected]");
    return {
      plain,
      protected: Boolean(locked),
      label: this._label(locked || this.selected || node),
      tag: (this.selected || node).tagName || "",
    };
  },

  _prepare() {
    const root = this.root();
    const doc = this.doc();
    if (!root || !doc) return;
    this.loadedId = this.pendingId;
    this._refreshFlows();
    if (typeof PackHtml !== "undefined") PackHtml.bind(root);
    root.setAttribute("contenteditable", "true");
    this._wrapLooseImages();
    this._markFlowCandidates();
    root.querySelectorAll(".pack-tabs").forEach((tabs) => this._uniqTabRadios(tabs, root));
    root.querySelectorAll(BLOCK_SELECTOR).forEach((el) => el.setAttribute("data-layout-block", "true"));
    root.querySelectorAll(".pack-image").forEach((figure) => {
      figure.setAttribute("contenteditable", "false");
      if (!figure.querySelector(".pack-image-handle")) {
        const handle = doc.createElement("span");
        handle.className = "pack-image-handle";
        handle.setAttribute("contenteditable", "false");
        figure.appendChild(handle);
      }
    });
    root.querySelectorAll(".pack-tabs-bar, .pack-tab").forEach((el) => {
      el.setAttribute("contenteditable", "false");
    });
    root.querySelectorAll(".pack-tab-panel").forEach((el) => {
      el.setAttribute("contenteditable", "true");
      this._stripTabPlaceholderAroundObjects(el);
    });
    root.querySelectorAll("pre, .code-container, .code-fold, table, .diagram-container, .pack-flow, .pack-html").forEach((el) => {
      const lock = el.closest(".code-fold, .code-container, .diagram-container, .pack-flow, .pack-html") || el;
      lock.setAttribute("contenteditable", "false");
      lock.setAttribute("data-protected", "true");
      if (lock.matches("table") || lock.querySelector("table")) lock.setAttribute("data-lock-label", "Table");
      else if (lock.matches(".diagram-container")) lock.setAttribute("data-lock-label", "Diagram");
      else if (lock.matches(".pack-flow")) lock.setAttribute("data-lock-label", "API flow");
      else if (lock.matches(".pack-html")) lock.setAttribute("data-lock-label", "HTML");
      else lock.setAttribute("data-lock-label", "Code");
    });
    root.querySelectorAll("pre, pre code").forEach((el) => {
      el.setAttribute("contenteditable", "true");
      el.setAttribute("data-plain", "true");
    });
    root.querySelectorAll("td, th").forEach((el) => {
      el.setAttribute("contenteditable", "true");
      el.setAttribute("data-plain", "true");
    });
    if (typeof PackSyntax !== "undefined") {
      const active = doc.activeElement;
      root.querySelectorAll("pre code").forEach((el) => {
        if (active && (el === active || el.contains(active))) return;
        PackSyntax.paint(el);
      });
    }
    if (!root.dataset.bound) {
      root.dataset.bound = "1";
      root.addEventListener("click", (event) => this._onClick(event));
      root.addEventListener("keyup", () => this._changed());
      root.addEventListener("input", (event) => {
        if (event.target.closest(".pack-flow-radio, .pack-flow-tabs, .pack-tab-radio, .pack-tabs-bar")) return;
        this._changed();
      });
      root.addEventListener("paste", (event) => this._onPaste(event));
      root.addEventListener("keydown", (event) => this._onKey(event));
      root.addEventListener("focusout", (event) => {
        const code = event.target.closest?.("pre code") || event.target.closest?.("pre")?.querySelector("code");
        if (code && typeof PackSyntax !== "undefined") PackSyntax.paint(code);
      });
      root.addEventListener("mousedown", (event) => {
        const handle = event.target.closest(".pack-image-handle");
        if (!handle) return;
        const figure = handle.closest(".pack-image");
        if (figure) this._startImageResize(event, figure);
      });
      root.addEventListener("dblclick", (event) => {
        const flow = event.target.closest(".pack-flow");
        if (event.target.closest(".pack-flow-tab, .pack-flow-tabs, .pack-flow-radio, .pack-tab, .pack-tabs-bar, .pack-tab-radio")) return;
        if (flow && (flow.hasAttribute("data-flow") || flow.querySelector("svg"))) {
          event.preventDefault();
          this.lastFlow = flow;
          this.onEditFlow(flow);
          return;
        }
        const htmlBlock = event.target.closest(".pack-html");
        if (htmlBlock) {
          event.preventDefault();
          this._select(htmlBlock);
          this.onEditHtml(htmlBlock);
          return;
        }
        const diagram = event.target.closest(".diagram-container");
        if (!diagram) return;
        if (!diagram.hasAttribute("data-diagram") && !diagram.querySelector("svg")) return;
        event.preventDefault();
        this.lastDiagram = diagram;
        this.onEditDiagram(diagram);
      });
      doc.addEventListener("selectionchange", () => {
        this._rememberAnchor();
        this.onSelect(this.selectionInfo());
      });
      try {
        doc.execCommand("styleWithCSS", false, true);
      } catch (err) {
        /* ignore */
      }
    }
    this.onSelect(this.selectionInfo());
    if (this.historyIndex < 0 && !this._historyPaused) this._pushHistory();
  },

  _wrapLooseImages() {
    const root = this.root();
    const doc = this.doc();
    if (!root || !doc) return;
    root.querySelectorAll("img").forEach((img) => {
      if (img.closest(".pack-image, .diagram-container, .pack-flow, .brand-lockup, table, .hero, .site-header")) return;
      const figure = doc.createElement("figure");
      figure.className = "pack-image pack-image-center";
      figure.style.setProperty("--pack-image-width", "80%");
      const parent = img.parentElement;
      if (parent && parent.matches("p") && parent.children.length === 1 && !parent.textContent.trim()) {
        parent.replaceWith(figure);
      } else {
        img.replaceWith(figure);
      }
      figure.appendChild(img);
    });
  },

  _startImageResize(event, figure) {
    event.preventDefault();
    event.stopPropagation();
    this._select(figure);
    const startX = event.clientX;
    const startW = figure.getBoundingClientRect().width;
    const parentW = (figure.parentElement?.getBoundingClientRect().width || startW);
    const grow = figure.classList.contains("pack-image-right") ? -1 : 1;
    const move = (ev) => {
      const pct = Math.round(((startW + (ev.clientX - startX) * grow) / parentW) * 100);
      figure.style.setProperty("--pack-image-width", `${Math.max(10, Math.min(100, pct))}%`);
    };
    const stop = () => {
      this.doc()?.removeEventListener("mousemove", move);
      this.doc()?.removeEventListener("mouseup", stop);
      this._changed();
      this.onSelect(this.selectionInfo());
    };
    this.doc().addEventListener("mousemove", move);
    this.doc().addEventListener("mouseup", stop);
  },

  _onClick(event) {
    const table = event.target.closest("table");
    if (table) this.lastTable = table;
    const diagram = event.target.closest(".diagram-container");
    if (diagram) this.lastDiagram = diagram;
    const flow = event.target.closest(".pack-flow");
    if (flow) this.lastFlow = flow;
    const tab = event.target.closest(".pack-tab");
    if (tab) {
      const radio = tab.querySelector(".pack-tab-radio");
      if (radio && !radio.checked) radio.checked = true;
    }
    const code = event.target.closest(".code-fold, .code-container");
    if (code) this.lastCode = code;
    const locked = event.target.closest("[data-protected]");
    const fromClick = event.target.closest(`${FLOW_SELECTOR}, [data-layout-block]`);
    this.anchor = locked || fromClick || this.anchor;
    const block = event.target.closest("[data-layout-block]");
    if (block) this._select(block);
    else this.onSelect(this.selectionInfo());
  },

  _rememberAnchor() {
    const root = this.root();
    const sel = this.doc()?.getSelection();
    const node = sel?.anchorNode;
    const el = !node ? null : node.nodeType === 1 ? node : node.parentElement;
    if (!el || !root?.contains(el)) return;
    const locked = el.closest("[data-protected]");
    if (locked && root.contains(locked)) {
      this.anchor = locked;
      return;
    }
    this.anchor = el.closest(`${FLOW_SELECTOR}, [data-layout-block]`) || this.anchor;
  },

  _tableFromSelection() {
    const doc = this.doc();
    const sel = doc?.getSelection();
    const node = sel?.anchorNode
      ? sel.anchorNode.nodeType === 1
        ? sel.anchorNode
        : sel.anchorNode.parentElement
      : null;
    if (node?.closest) {
      const fromCaret = node.closest("table");
      if (fromCaret) return fromCaret;
    }
    if (this.selected?.matches?.("table")) return this.selected;
    const fromSelected = this.selected?.closest?.("table");
    if (fromSelected) return fromSelected;
    if (this.lastTable && this.root()?.contains(this.lastTable)) return this.lastTable;
    return null;
  },

  _select(block) {
    const root = this.root();
    if (!root) return;
    root.querySelectorAll(".is-selected").forEach((el) => el.classList.remove("is-selected"));
    this.selected = block;
    block.classList.add("is-selected");
    this.onSelect(this.selectionInfo());
  },

  _onPaste(event) {
    const plain = event.target.closest("[data-plain]");
    if (!plain) return;
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    this.doc().execCommand("insertText", false, text);
    this._changed();
  },

  _onKey(event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      this.redo();
      return;
    }
    const plain = event.target.closest("[data-plain]");
    if (!plain) return;
    if ((event.ctrlKey || event.metaKey) && ["b", "i", "u"].includes(event.key.toLowerCase())) {
      event.preventDefault();
    }
  },

  _label(el) {
    if (!el) return "Page";
    if (el.matches(".hero, .page-header")) return "Header box";
    if (el.matches(".content-card")) return "Content card";
    if (el.matches(".overview-section")) return "Overview section";
    if (el.matches(".toc-card")) return "Table of contents";
    if (el.matches(".checklist-box")) return "Checklist";
    if (el.matches(".rule-grid")) return "Icon cards";
    if (el.matches(".card")) return "Contents card";
    if (el.matches(".api-box")) return "API box";
    if (el.matches(".pack-columns")) return "Columns";
    if (el.matches(".pack-column, .pack-column *")) return "Column";
    if (el.matches(".pack-tabs, .pack-tab, .pack-tabs-bar")) return "Tabs";
    if (el.matches(".pack-tab-panel, .pack-tab-panel *")) return "Tab";
    if (el.matches(".pack-image, .pack-image *")) return "Image";
    if (el.matches(".diagram-container, .diagram-container *")) return "Diagram";
    if (el.matches(".pack-flow, .pack-flow *")) return "API flow";
    if (el.matches(".code-fold, .code-container, pre")) return "Code example";
    if (el.matches(".pack-html, .pack-html *")) return "HTML";
    if (el.matches("table")) return "Table";
    if (el.matches(".callout, .callout-warning")) return "Callout";
    return el.tagName.toLowerCase();
  },

  listSections() {
    const root = this.root();
    if (!root) return [];
    const out = [];
    root.querySelectorAll(".content-card").forEach((card) => {
      const h2 = card.querySelector(":scope > h2");
      if (h2) {
        if (!h2.id) h2.id = "sec-" + Math.random().toString(36).slice(2, 8);
        out.push({ el: h2, level: 2, num: this._headingNum(h2), title: this._headingTitle(h2) });
      }
      card.querySelectorAll(":scope h3").forEach((h3) => {
        if (!h3.id) h3.id = "sec-" + Math.random().toString(36).slice(2, 8);
        out.push({ el: h3, level: 3, num: this._headingNum(h3), title: this._headingTitle(h3) });
      });
    });
    return out;
  },

  setSectionNumber(index, num) {
    const item = this.listSections()[index];
    if (!item || !String(num || "").trim()) return false;
    this._applyNumber(item.el, String(num).trim());
    this.rebuildToc();
    this._prepare();
    this._changed();
    return true;
  },

  renumberSections() {
    let n = 0;
    this.listSections().forEach((item) => {
      if (item.level === 2) {
        n += 1;
        this._h3Count = 0;
        this._applyNumber(item.el, String(n));
      } else {
        this._h3Count = (this._h3Count || 0) + 1;
        this._applyNumber(item.el, `${n || 1}.${this._h3Count}`);
      }
    });
    this.rebuildToc();
    this._prepare();
    this._changed();
  },

  promoteSection(index) {
    const item = this.listSections()[index];
    if (!item || item.level !== 3) return false;
    const doc = this.doc();
    const h3 = item.el;
    const card = h3.closest(".content-card");
    if (!doc || !card) return false;
    const newCard = doc.createElement("div");
    newCard.className = "content-card";
    const h2 = doc.createElement("h2");
    h2.id = h3.id;
    h2.innerHTML = h3.innerHTML;
    newCard.appendChild(h2);
    let node = h3.nextSibling;
    h3.remove();
    while (node) {
      const next = node.nextSibling;
      if (node.nodeType === 1 && node.matches("h2, h3")) break;
      newCard.appendChild(node);
      node = next;
    }
    card.after(newCard);
    this.rebuildToc();
    this._prepare();
    this._select(newCard);
    this._changed();
    return true;
  },

  demoteSection(index) {
    const items = this.listSections();
    const item = items[index];
    if (!item || item.level !== 2) return false;
    const card = item.el.closest(".content-card");
    const prev = card?.previousElementSibling;
    if (!prev?.matches(".content-card")) return false;
    const h3 = this.doc().createElement("h3");
    h3.id = item.el.id;
    h3.innerHTML = item.el.innerHTML;
    h3.querySelector(".pack-icon")?.remove();
    item.el.remove();
    prev.appendChild(h3);
    while (card.firstChild) prev.appendChild(card.firstChild);
    card.remove();
    this.rebuildToc();
    this._prepare();
    this._select(prev);
    this._changed();
    return true;
  },

  rebuildToc() {
    const root = this.root();
    const toc = root?.querySelector(".toc-card");
    if (!root || !toc) return;
    const items = this.listSections();
    const head = toc.querySelector("h3")?.outerHTML || "<h3>Table of Contents</h3>";
    if (!items.length) {
      toc.remove();
      return;
    }
    const rows = [];
    let current = null;
    let nested = [];
    const flush = () => {
      if (!current) return;
      const nest = nested.length ? `\n<ul>\n${nested.join("\n")}\n</ul>` : "";
      const id = current.el.id || "";
      rows.push(`<li><a href="#${id}">${this._escape(this._headingPlain(current.el))}</a>${nest}</li>`);
      nested = [];
    };
    items.forEach((item) => {
      if (item.level === 2) {
        flush();
        current = item;
      } else if (current) {
        const id = item.el.id || "";
        nested.push(`<li><a href="#${id}">${this._escape(this._headingPlain(item.el))}</a></li>`);
      }
    });
    flush();
    toc.innerHTML = `${head}\n<ul>\n${rows.join("\n")}\n</ul>`;
  },

  _headingPlain(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll(".pack-icon, svg").forEach((node) => node.remove());
    return (clone.textContent || "").replace(/\s+/g, " ").trim();
  },

  _headingNum(el) {
    const badge = el.querySelector(".step-badge");
    if (badge) return (badge.textContent || "").trim();
    const match = this._headingPlain(el).match(/^(\d+(?:\.\d+)*)[.)]?\s+/);
    return match ? match[1] : "";
  },

  _headingTitle(el) {
    const badge = el.querySelector(".step-badge");
    if (badge) {
      const clone = el.cloneNode(true);
      clone.querySelectorAll(".pack-icon, .step-badge, svg").forEach((node) => node.remove());
      return (clone.textContent || "").replace(/\s+/g, " ").trim();
    }
    return this._headingPlain(el).replace(/^\d+(?:\.\d+)*[.)]?\s+/, "");
  },

  _applyNumber(el, num) {
    const title = this._headingTitle(el);
    const badge = el.querySelector(".step-badge");
    if (badge) {
      badge.textContent = num;
      return;
    }
    const icon = el.querySelector(".pack-icon");
    const keep = icon ? icon.cloneNode(true) : null;
    el.textContent = "";
    if (keep) {
      el.appendChild(keep);
      el.appendChild(this.doc().createTextNode(" "));
    }
    el.appendChild(this.doc().createTextNode(`${num}. ${title}`));
  },

  _escape(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  },

  setCardLabel(text) {
    const card = this.selected?.matches?.(".card") ? this.selected : null;
    if (!card) return false;
    const header = card.querySelector(".card-header");
    let status = card.querySelector(".card-status");
    const value = String(text || "").trim() || "Current";
    if (!status) {
      status = this.doc().createElement("span");
      (header || card).appendChild(status);
    }
    const draft = /^draft$/i.test(value);
    status.className = `card-status ${draft ? "status-draft" : "status-current"}`;
    status.setAttribute("data-custom", "1");
    status.textContent = value;
    this._changed();
    return true;
  },

  setCardIcon(name) {
    const card = this.selected?.matches?.(".card") ? this.selected : null;
    if (!card || !name || typeof IconLibrary === "undefined") return false;
    const html = IconLibrary.html(name, 18);
    const h3 = card.querySelector("h3");
    if (!h3 || !html) return false;
    const template = this.doc().createElement("template");
    template.innerHTML = html.trim();
    const icon = template.content.firstElementChild;
    if (!icon) return false;
    const existing = h3.querySelector(".pack-icon");
    if (existing) existing.replaceWith(icon);
    else h3.prepend(icon, this.doc().createTextNode(" "));
    card.setAttribute("data-icon", name);
    this._changed();
    return true;
  },

  cardLabel() {
    return this.selected?.querySelector?.(".card-status")?.textContent.trim() || "";
  },

  _changed() {
    this.onChange();
    this._scheduleHistory();
  },

  historyInfo() {
    return {
      canUndo: this.historyIndex > 0,
      canRedo: this.historyIndex >= 0 && this.historyIndex < this.history.length - 1,
    };
  },

  undo() {
    if (this._historyTimer) this._pushHistory();
    if (!this.historyInfo().canUndo) return false;
    this.historyIndex -= 1;
    this._restoreHistory();
    return true;
  },

  redo() {
    if (this._historyTimer) this._pushHistory();
    if (!this.historyInfo().canRedo) return false;
    this.historyIndex += 1;
    this._restoreHistory();
    return true;
  },

  _resetHistory() {
    clearTimeout(this._historyTimer);
    this.history = [];
    this.historyIndex = -1;
    this._historyPaused = false;
    this.onHistory?.(this.historyInfo());
  },

  _scheduleHistory() {
    if (this._historyPaused) return;
    clearTimeout(this._historyTimer);
    this._historyTimer = setTimeout(() => this._pushHistory(), 400);
  },

  _pushHistory() {
    if (this._historyPaused || !this.root()) return;
    clearTimeout(this._historyTimer);
    const html = this.flush();
    if (this.historyIndex >= 0 && this.history[this.historyIndex] === html) {
      this.onHistory?.(this.historyInfo());
      return;
    }
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(html);
    if (this.history.length > 80) {
      this.history.shift();
    }
    this.historyIndex = this.history.length - 1;
    this.onHistory?.(this.historyInfo());
  },

  _restoreHistory() {
    const root = this.root();
    if (!root) return;
    this._historyPaused = true;
    clearTimeout(this._historyTimer);
    this.selected = null;
    this.anchor = null;
    this.lastTable = null;
    this.lastDiagram = null;
    this.lastFlow = null;
    this.lastCode = null;
    root.innerHTML = this.history[this.historyIndex] || "";
    this._prepare();
    this.onChange();
    this._historyPaused = false;
    this.onHistory?.(this.historyInfo());
  },
};
