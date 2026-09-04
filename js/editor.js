const BLOCK_SELECTOR = [
  ".hero",
  ".page-header",
  ".content-card",
  ".overview-section",
  ".toc-card",
  ".card",
  ".api-box",
  ".diagram-container",
  ".callout",
  ".callout-warning",
  ".checklist-box",
  ".rule-grid",
  "details.code-fold",
  ".code-container",
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
  loadedId: null,
  pendingId: null,

  bind(iframe, handlers) {
    this.iframe = iframe;
    this.onChange = handlers.onChange || (() => {});
    this.onSelect = handlers.onSelect || (() => {});
    this.onEditDiagram = handlers.onEditDiagram || (() => {});
    iframe.addEventListener("load", () => this._prepare());
  },

  load(html, clientCss, themeCss, pageId, editable) {
    this.selected = null;
    this.anchor = null;
    this.lastTable = null;
    this.lastDiagram = null;
    this.loadedId = null;
    this.pendingId = pageId || null;
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
    return clone.innerHTML;
  },

  command(name, value) {
    const doc = this.doc();
    const info = this.selectionInfo();
    if (!doc) return false;
    if (info.plain && !["undo", "redo"].includes(name)) return false;
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
    const pageLevel = PAGE_LEVEL_KINDS.has(kind);
    const html = this._snippet(kind, { inside: Boolean(!pageLevel && this._insertContainer()) });
    if (!html) return;
    this._placeHtml(html, { pageLevel });
  },

  insertHtml(html) {
    this._placeHtml(html, { pageLevel: false });
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
    if (selected?.matches?.(".content-card")) return selected;
    const fromSelected = selected?.closest?.(".content-card");
    if (fromSelected) return fromSelected;
    if (this.anchor?.closest) {
      const fromAnchor = this.anchor.closest(".content-card");
      if (fromAnchor) return fromAnchor;
    }
    if (selected?.matches?.(".overview-section")) return selected;
    return null;
  },

  _placeHtml(html, options) {
    const root = this.root();
    const doc = this.doc();
    if (!root || !doc || !html) return;
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

    const template = doc.createElement("template");
    template.innerHTML = html.trim();
    const nodes = [...template.content.childNodes];
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
    } else if (action === "delete") {
      if (!this.doc().defaultView.confirm("Delete this block?")) return false;
      const parent = block.parentNode;
      block.remove();
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
    root.setAttribute("contenteditable", "true");
    root.querySelectorAll(BLOCK_SELECTOR).forEach((el) => el.setAttribute("data-layout-block", "true"));
    root.querySelectorAll("pre, .code-container, .code-fold, table, .diagram-container").forEach((el) => {
      const lock = el.closest(".code-fold, .code-container, .diagram-container") || el;
      lock.setAttribute("contenteditable", "false");
      lock.setAttribute("data-protected", "true");
      if (lock.matches("table") || lock.querySelector("table")) lock.setAttribute("data-lock-label", "Table");
      else if (lock.matches(".diagram-container")) lock.setAttribute("data-lock-label", "Diagram");
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
      root.addEventListener("input", () => this._changed());
      root.addEventListener("paste", (event) => this._onPaste(event));
      root.addEventListener("keydown", (event) => this._onKey(event));
      root.addEventListener("focusout", (event) => {
        const code = event.target.closest?.("pre code") || event.target.closest?.("pre")?.querySelector("code");
        if (code && typeof PackSyntax !== "undefined") PackSyntax.paint(code);
      });
      root.addEventListener("dblclick", (event) => {
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
  },

  _onClick(event) {
    const table = event.target.closest("table");
    if (table) this.lastTable = table;
    const diagram = event.target.closest(".diagram-container");
    if (diagram) this.lastDiagram = diagram;
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
    if (el.matches(".diagram-container, .diagram-container *")) return "Diagram";
    if (el.matches(".code-fold, .code-container, pre")) return "Code example";
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
  },
};
