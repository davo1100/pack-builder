const state = {
  docs: [],
  selected: null,
  tab: "preview",
  lastHtml: "",
  clientCss: "",
  previewTimer: null,
  previewUrl: "",
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
  if (settings.page_title) els.pageTitle.value = settings.page_title;
  if (settings.header_doc) els.headerDoc.value = settings.header_doc;
  if (settings.logo_url) els.logoUrl.value = settings.logo_url;
  if (settings.logo_alt) els.logoAlt.value = settings.logo_alt;
  if ("confidential" in settings) els.confidential.checked = Boolean(settings.confidential);
  if (settings.footer) els.footer.value = settings.footer;
  if (settings.output_filename) els.outputFilename.value = settings.output_filename;
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
}

function settingsPayload() {
  return {
    page_title: els.pageTitle.value.trim(),
    header_doc: els.headerDoc.value.trim(),
    logo_url: els.logoUrl.value.trim(),
    logo_alt: els.logoAlt.value.trim(),
    confidential: els.confidential.checked,
    footer: els.footer.value,
    output_filename: els.outputFilename.value.trim() || "documentation.html",
    theme: themePayload(),
  };
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

function mergeIncoming(docs) {
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
  return syncOverview({ skipFlush: true }).then(() => {
    renderList();
    if (state.tab === "edit") loadEditor();
    if (state.tab === "preview") revealPreviewSelection();
    schedulePreview();
    els.btnDownload.disabled = !state.docs.some((d) => d.include);
  });
}

async function syncOverview(options) {
  if (!state.docs.length) return;
  if (!options?.skipFlush) flushEditor();
  const res = await fetch("/api/sync-overview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildPayload()),
  });
  const data = await res.json();
  if (!res.ok) {
    setStatus(data.error || "Could not update contents page", "error");
    return;
  }
  let overview = state.docs.find((doc) => doc.role === "overview")
    || state.docs.find((doc) => doc.filename === data.filename);
  const editingOverview = overview && state.selected === overview.id && state.tab === "edit";
  if (!overview) {
    overview = {
      id: uid(),
      filename: data.filename || "00_Contents.html",
      title: data.title || "Contents",
      role: "overview",
      include: true,
      draft: Boolean(data.draft),
      num: data.num || "00",
      body: data.body || "",
    };
    state.docs.unshift(overview);
    if (!state.selected) state.selected = overview.id;
  } else {
    overview.body = data.body || "";
    overview.role = "overview";
    overview.include = true;
    overview.num = data.num || overview.num || "00";
    if (data.filename) overview.filename = overview.filename || data.filename;
  }
  pinOverviews();
  if (editingOverview) loadEditor();
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
  const keys = [file.name];
  const relative = String(file.webkitRelativePath || "").replace(/\\/g, "/");
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

async function ingestFiles(fileList) {
  const files = [];
  const images = {};
  for (const file of fileList) {
    const name = file.name;
    const lower = name.toLowerCase();
    if (lower.endsWith(".html")) {
      files.push({ filename: name, html: await file.text() });
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
  if (!files.length) {
    setStatus("No HTML, Word, or PowerPoint files found", "error");
    return;
  }
  setStatus("Converting pages…");
  const res = await fetch("/api/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files, images }),
  });
  const data = await res.json();
  if (!res.ok) {
    setStatus(data.error || "Could not read files", "error");
    return;
  }
  applyIncomingSettings(data.settings);
  await mergeIncoming(data.docs || []);
  setStatus(`${state.docs.length} page${state.docs.length === 1 ? "" : "s"} loaded`, "ok");
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

["page-title", "header-doc", "logo-url", "logo-alt", "confidential", "footer", "output-filename"].forEach((id) => {
  document.getElementById(id).addEventListener("input", () => schedulePreview());
  document.getElementById(id).addEventListener("change", () => schedulePreview());
});

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
  const insert = event.target.closest("button[data-insert]");
  if (insert) {
    closeInsertMenu();
    if (insert.dataset.insert === "diagram") {
      openDiagramEditor(false);
      return;
    }
    PackEditor.insert(insert.dataset.insert);
    if (insert.dataset.insert === "hero") {
      setStatus("Header box ready — pick a colour and edit the text", "ok");
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
    button.disabled = locked;
  });
  els.editorHint.classList.toggle("locked", locked);
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
  onSelect(info) {
    setToolbarLocked(Boolean(info.plain || info.protected));
    const isDiagram = info.label === "Diagram";
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
    renderSectionOutline();
    if (isDiagram) {
      els.editorHint.textContent = "Diagram selected. Click Edit diagram, or double-click it to open the creator.";
    } else if (isTable) {
      els.editorHint.textContent = "Table selected. Add a row or column here, or edit the cells in the page.";
    } else if (header) {
      els.editorHint.textContent = "Header box selected. Pick a colour, then edit the title, description, and labels.";
    } else if (card) {
      els.editorHint.textContent = "Contents card selected. Change the label and icon here. The summary and tags can be edited in the card.";
    } else if (info.plain || info.protected) {
      els.editorHint.textContent = `${info.label}: plain-text only. Structure is locked so the layout stays intact.`;
    } else if (PackEditor.selected?.matches?.(".content-card, .overview-section")) {
      els.editorHint.textContent = "Section selected. Use Add to page for tables, notes, diagrams, and other blocks.";
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
  if (document.getElementById("diagram-modal").hidden) return;
  if (event.key === "Escape") DiagramEditor.close();
  if (event.key === "Delete" || event.key === "Backspace") {
    const tag = event.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    event.preventDefault();
    DiagramEditor.deleteSelected();
  }
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
  setStatus("Building preview…");
  const res = await fetch("/api/build", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildPayload()),
  });
  const data = await res.json();
  if (!res.ok) {
    setStatus(data.error || "Build failed", "error");
    return;
  }
  state.lastHtml = data.html;
  showPreviewHtml(data.html);
  setStatus("Preview up to date", "ok");
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
  if (html) doc.body = html;
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
  const res = await fetch("/api/build", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildPayload()),
  });
  const data = await res.json();
  if (!res.ok) {
    setStatus(data.error || "Download failed", "error");
    return;
  }
  const blob = new Blob([data.html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = data.filename || settingsPayload().output_filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setStatus("Downloaded " + a.download, "ok");
}

els.btnPreview.addEventListener("click", () => schedulePreview(true));
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
