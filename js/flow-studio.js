const FlowStudio = {
  model: null,
  backup: null,
  customerUndo: null,
  openApiOps: null,
  wsdlOps: null,
  onSave: null,
  _syncing: false,
  _liveTimer: 0,
  _previewFrame: 0,
  _previewId: "",
  _catalogOpts: null,
  _catalogMemo: null,
  _endpointOpts: null,
  _keptEndpoints: null,
  _keptFieldCatalog: null,
  _imageFile: null,

  open(model, onSave) {
    this.model = FlowIR.normalize(model || FlowIR.empty());
    this.backup = FlowIR.clone(this.model);
    this.customerUndo = null;
    this.onSave = onSave || (() => {});
    document.getElementById("flow-modal").hidden = false;
    const preview = document.getElementById("flow-preview");
    if (preview) preview.innerHTML = "";
    this._rememberCatalogs(this.model);
    this._bindOnce();
    this._renderAll();
  },

  close() {
    clearTimeout(this._liveTimer);
    if (this._previewFrame) cancelAnimationFrame(this._previewFrame);
    this._toggleImport(false);
    document.getElementById("flow-modal").hidden = true;
    this.model = null;
    this.backup = null;
    this.customerUndo = null;
    this.onSave = null;
    this._catalogOpts = null;
    this._catalogMemo = null;
    this._endpointOpts = null;
    this._previewFrame = 0;
    this._imageFile = null;
    if (typeof FlowImage?.dispose === "function") FlowImage.dispose();
    this._clearImage(true);
  },

  apply() {
    clearTimeout(this._liveTimer);
    const checked = FlowIR.validate(this.model);
    if (!checked.ok) {
      this._errors(checked.errors);
      return false;
    }
    checked.model.presentation.audience = "developer";
    const drawn = FlowRender.html(checked.model);
    if (!drawn.ok) {
      this._errors(drawn.errors);
      return false;
    }
    this.onSave(drawn.html, checked.model);
    this.close();
    return true;
  },

  downloadSvg() {
    const drawn = FlowRender.svg(FlowIR.forView(this.model, "developer"), { source: this.model });
    if (!drawn.ok) {
      this._errors(drawn.errors);
      return;
    }
    const blob = new Blob([drawn.svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${this.model.id || "flow"}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  },

  _bindOnce() {
    if (this._bound) return;
    this._bound = true;
    document.getElementById("flow-cancel").addEventListener("click", () => this.close());
    document.getElementById("flow-apply").addEventListener("click", () => this.apply());
    document.getElementById("flow-download").addEventListener("click", () => this.downloadSvg());
    document.getElementById("flow-source").addEventListener("input", () => {
      clearTimeout(this._sourceTimer);
      this._sourceTimer = setTimeout(() => this._fromSource(false), 280);
    });
    document.getElementById("flow-source").addEventListener("blur", () => this._fromSource(true));
    document.getElementById("flow-source-box")?.addEventListener("toggle", () => this._onSourceToggle());
    document.getElementById("flow-import-toggle")?.addEventListener("click", () => this._toggleImport());
    document.getElementById("flow-import-close")?.addEventListener("click", () => this._toggleImport(false));
    document.getElementById("flow-title").addEventListener("input", (event) => {
      this.model.title = event.target.value;
      this._schedulePreview();
    });
    document.getElementById("flow-summary").addEventListener("input", (event) => {
      this.model.presentation.summary = event.target.value;
      this._schedulePreview();
    });
    document.getElementById("flow-layout").addEventListener("change", (event) => {
      this.model.presentation.layout = event.target.value;
      this._afterStructure();
    });
    document.getElementById("flow-show-fields").addEventListener("change", (event) => {
      this.model.presentation.showFields = event.target.checked;
      this._afterStructure();
    });
    document.getElementById("flow-platform").addEventListener("change", (event) => {
      this.model.presentation.platform = event.target.value;
      this._ensurePlatformActors();
      this._renderActors();
      this._renderSteps();
      this._syncProtocolChrome();
      this._renderEndpointPicker();
      this._afterStructure();
    });
    document.getElementById("flow-add-actor").addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this._addActor();
    });
    document.getElementById("flow-actor-colors").addEventListener("input", (event) => this._onActorColor(event));
    document.getElementById("flow-actor-colors").addEventListener("click", (event) => {
      if (!event.target.closest("[data-actor-colors-reset]")) return;
      delete this.model.presentation.actorColors;
      this._renderActorColors();
      this._afterStructure();
    });
    document.getElementById("flow-add-step").addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this._addStep();
    });
    document.getElementById("flow-add-endpoint").addEventListener("click", (event) => event.stopPropagation());
    document.getElementById("flow-add-endpoint").addEventListener("change", (event) => this._addFromEndpoint(event.target.value));
    document.getElementById("flow-import-openapi").addEventListener("click", () => this._readOpenApi());
    document.getElementById("flow-openapi-clear").addEventListener("click", () => this._clearOpenApi());
    document.getElementById("flow-openapi-compile").addEventListener("click", () => this._compileOpenApi());
    document.getElementById("flow-openapi-all").addEventListener("click", () => this._toggleOpenApi(true));
    document.getElementById("flow-openapi-none").addEventListener("click", () => this._toggleOpenApi(false));
    document.getElementById("flow-openapi-filter").addEventListener("input", () => this._filterOpenApi());
    document.getElementById("flow-openapi-list").addEventListener("change", () => this._openapiCount());
    document.getElementById("flow-import-wsdl").addEventListener("click", () => this._readWsdl());
    document.getElementById("flow-wsdl-clear").addEventListener("click", () => this._clearWsdl());
    document.getElementById("flow-wsdl-compile").addEventListener("click", () => this._compileWsdl());
    document.getElementById("flow-wsdl-all").addEventListener("click", () => this._toggleWsdl(true));
    document.getElementById("flow-wsdl-none").addEventListener("click", () => this._toggleWsdl(false));
    document.getElementById("flow-wsdl-filter").addEventListener("input", () => this._filterWsdl());
    document.getElementById("flow-wsdl-list").addEventListener("change", () => this._wsdlCount());
    document.getElementById("flow-openapi-file").addEventListener("change", (event) => this._readOpenApiFiles(event));
    document.getElementById("flow-wsdl-file").addEventListener("change", (event) => this._readWsdlFiles(event));
    this._bindWsdlDrop();
    document.getElementById("flow-image-choose").addEventListener("click", () => document.getElementById("flow-image-file").click());
    document.getElementById("flow-image-file").addEventListener("change", (event) => this._readImageFile(event));
    document.getElementById("flow-image-compile").addEventListener("click", () => this._compileImage());
    document.getElementById("flow-image-clear").addEventListener("click", () => this._clearImage());
    const drop = document.getElementById("flow-image-drop");
    drop.addEventListener("click", () => document.getElementById("flow-image-file").click());
    drop.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        document.getElementById("flow-image-file").click();
      }
    });
    ["dragenter", "dragover"].forEach((type) => {
      drop.addEventListener(type, (event) => {
        event.preventDefault();
        drop.classList.add("is-over");
      });
    });
    ["dragleave", "drop"].forEach((type) => {
      drop.addEventListener(type, () => drop.classList.remove("is-over"));
    });
    drop.addEventListener("drop", (event) => {
      event.preventDefault();
      const files = [...(event.dataTransfer?.files || [])];
      const soap = files.filter((file) => this._isWsdlFile(file));
      if (soap.length) {
        this._ingestWsdlFiles(soap);
        return;
      }
      if (files[0]) this._acceptImage(files[0]);
    });
    document.addEventListener("paste", (event) => this._onImagePaste(event));
    document.getElementById("flow-actors").addEventListener("input", (event) => {
      if (event.target.tagName === "SELECT") return;
      this._onActorField(event);
    });
    document.getElementById("flow-actors").addEventListener("change", (event) => this._onActorField(event));
    document.getElementById("flow-actors").addEventListener("click", (event) => this._onActorClick(event));
    document.getElementById("flow-steps").addEventListener("input", (event) => {
      if (event.target.tagName === "SELECT") return;
      this._onStepField(event);
    });
    document.getElementById("flow-steps").addEventListener("change", (event) => this._onStepField(event));
    document.getElementById("flow-steps").addEventListener("click", (event) => this._onStepClick(event));
    document.getElementById("flow-steps").addEventListener("dragstart", (event) => this._onStepDragStart(event));
    document.getElementById("flow-steps").addEventListener("dragover", (event) => this._onStepDragOver(event));
    document.getElementById("flow-steps").addEventListener("drop", (event) => this._onStepDrop(event));
    document.getElementById("flow-steps").addEventListener("dragend", () => this._onStepDragEnd());
  },

  _renderAll() {
    this._syncing = true;
    document.getElementById("flow-title").value = this.model.title || "";
    document.getElementById("flow-summary").value = this.model.presentation.summary || "";
    document.getElementById("flow-layout").value = this.model.presentation.layout;
    document.getElementById("flow-platform").value = this.model.presentation.platform;
    document.getElementById("flow-show-fields").checked = this.model.presentation.showFields !== false;
    this._writeSourceIfOpen();
    this._syncImplementations();
    this._renderActorColors();
    this._renderActors();
    this._renderSteps();
    this._renderEndpointPicker();
    this._syncProtocolChrome();
    this._syncing = false;
    this._paintVisiblePreview();
  },

  _afterStructure() {
    if (this._syncing) return;
    this._syncImplementations();
    this._writeSourceIfOpen();
    this._schedulePreview();
  },

  _isTextControl(el) {
    if (!el || el.tagName === "SELECT") return false;
    return el.type !== "checkbox" && el.type !== "radio" && el.type !== "file";
  },

  _schedulePreview() {
    if (this._previewFrame) return;
    this._previewFrame = requestAnimationFrame(() => {
      this._previewFrame = 0;
      this._paintVisiblePreview();
    });
  },

  _paintVisiblePreview() {
    if (!this.model) return;
    const host = document.getElementById("flow-preview");
    if (!host) return;
    const drawn = FlowRender.svg(FlowRender.viewModel(this.model, "developer"), { trusted: true });
    if (!drawn.ok) {
      this._errors(drawn.errors);
      host.innerHTML = `<p class="flow-error">${this._esc(drawn.errors.join(" · "))}</p>`;
      return;
    }
    this._errors([]);
    host.innerHTML = `<div class="pack-flow">${drawn.svg}</div>`;
  },

  _rememberCatalogs(model) {
    if (!model) return;
    if (Array.isArray(model.fieldCatalog) && model.fieldCatalog.length) this._keptFieldCatalog = model.fieldCatalog;
    this._keptEndpoints = this._keptEndpoints || {};
    (model.endpoints || []).forEach((item) => {
      if (item.requestFields || item.responseFields || item.okFields || item.errFields || item.serverFields) {
        this._keptEndpoints[item.key] = {
          requestFields: item.requestFields,
          responseFields: item.responseFields,
          okFields: item.okFields,
          errFields: item.errFields,
          serverFields: item.serverFields,
        };
      }
    });
  },

  _restoreCatalogs(model) {
    if (!model) return;
    if (!model.fieldCatalog?.length && this._keptFieldCatalog) model.fieldCatalog = this._keptFieldCatalog;
    (model.endpoints || []).forEach((item) => {
      const kept = this._keptEndpoints?.[item.key];
      if (!kept) return;
      ["requestFields", "responseFields", "okFields", "errFields", "serverFields"].forEach((key) => {
        if (!item[key]?.length && kept[key]) item[key] = kept[key];
      });
    });
  },

  _sourcePayload() {
    this._rememberCatalogs(this.model);
    return {
      ...this.model,
      fieldCatalog: undefined,
      endpoints: (this.model.endpoints || []).map((item) => ({
        key: item.key,
        method: item.method,
        path: item.path,
        protocol: item.protocol,
        operation: item.operation,
        namespace: item.namespace,
        soapAction: item.soapAction,
        summary: item.summary,
        operationId: item.operationId,
        tags: item.tags,
        source: item.source,
        okCode: item.okCode,
        errCode: item.errCode,
        serverCode: item.serverCode,
        okLabel: item.okLabel,
        errLabel: item.errLabel,
        serverLabel: item.serverLabel,
      })),
    };
  },

  _writeSourceIfOpen() {
    const box = document.getElementById("flow-source-box");
    if (!box?.open) return;
    this._syncing = true;
    document.getElementById("flow-source").value = JSON.stringify(this._sourcePayload(), null, 2);
    this._syncing = false;
  },

  _toggleImport(open) {
    const drawer = document.getElementById("flow-import-drawer");
    const button = document.getElementById("flow-import-toggle");
    if (!drawer) return;
    if (open === true) drawer.hidden = false;
    else if (open === false) drawer.hidden = true;
    else drawer.hidden = !drawer.hidden;
    if (button) button.setAttribute("aria-expanded", String(!drawer.hidden));
    if (!drawer.hidden) this._writeSourceIfOpen();
  },

  _onSourceToggle() {
    const box = document.getElementById("flow-source-box");
    const source = document.getElementById("flow-source");
    if (!box || !source) return;
    if (box.open) this._writeSourceIfOpen();
    else source.value = "";
  },

  _fromSource(rebuild) {
    if (this._syncing) return;
    const box = document.getElementById("flow-source-box");
    if (box && !box.open) return;
    const text = document.getElementById("flow-source").value;
    if (!String(text || "").trim()) return;
    const parsed = FlowParse.fromJson(text);
    if (!parsed.ok) {
      this._errors(parsed.errors);
      return;
    }
    this._restoreCatalogs(parsed.model);
    this.model = parsed.model;
    this._rememberCatalogs(this.model);
    this._syncing = true;
    document.getElementById("flow-title").value = this.model.title || "";
    document.getElementById("flow-summary").value = this.model.presentation.summary || "";
    document.getElementById("flow-layout").value = this.model.presentation.layout;
    document.getElementById("flow-platform").value = this.model.presentation.platform;
    document.getElementById("flow-show-fields").checked = this.model.presentation.showFields !== false;
    if (rebuild) {
      this._renderActorColors();
      this._renderActors();
      this._renderSteps();
    }
    this._syncProtocolChrome();
    this._renderEndpointPicker();
    this._syncing = false;
    this._paintVisiblePreview();
  },

  _errors(list) {
    const el = document.getElementById("flow-errors");
    if (!list.length) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = list.join(" · ");
  },

  _addActor() {
    document.querySelector('.flow-structure-section[data-kind="actors"]')?.setAttribute("open", "");
    this.model.actors.push({ id: FlowIR.uid("a"), name: "New actor", type: "internal" });
    this._renderActors();
    this._renderSteps();
    this._afterStructure();
  },

  _addStep() {
    document.querySelector('.flow-structure-section[data-kind="steps"]')?.setAttribute("open", "");
    const actors = this.model.actors;
    const platform = this.model.presentation.platform;
    const from = actors.find((actor) => actor.type === "client")?.id || actors[0]?.id || "";
    const to =
      actors.find((actor) => actor.id === "api")?.id ||
      actors.find((actor) => actor.type === "internal")?.id ||
      actors.find((actor) => actor.id !== from)?.id ||
      from;
    const step = { id: FlowIR.uid("s"), type: "request", from, to };
    if (platform === "chopin") {
      Object.assign(step, {
        label: "New operation",
        operation: "NewOperation",
        platforms: ["chopin"],
        chopin: { operation: "NewOperation", namespace: "", supported: true },
      });
    } else if (platform === "both") {
      Object.assign(step, {
        label: "New step",
        method: "POST",
        path: "/path",
        operation: "NewOperation",
        darwin: { method: "POST", path: "/path", supported: true },
        chopin: { operation: "NewOperation", namespace: "", supported: true },
      });
    } else {
      Object.assign(step, {
        label: this._endpoints().length ? "" : "New step",
        method: this._endpoints().length ? "" : "POST",
        path: this._endpoints().length ? "" : "/path",
        endpoint: "",
        platforms: ["darwin"],
        darwin: { method: this._endpoints().length ? "" : "POST", path: this._endpoints().length ? "" : "/path", supported: true },
      });
    }
    this.model.steps.push(step);
    this._syncImplementations();
    this._renderSteps();
    this._afterStructure();
  },

  _endpoints() {
    if (this.model?.endpoints?.length) return this.model.endpoints;
    const rest = (this.openApiOps?.operations || []).map((item) => FlowParse._slimEndpoint(item));
    const soap = (this.wsdlOps?.operations || []).map((item) => FlowParse._slimEndpoint(item));
    return [...rest, ...soap];
  },

  _isSoapEndpoint(item) {
    return item?.protocol === "SOAP" || String(item?.method || "").toUpperCase() === "SOAP";
  },

  _visibleEndpoints() {
    const all = this._endpoints();
    const platform = this.model?.presentation?.platform;
    if (platform === "chopin") return all.filter((item) => this._isSoapEndpoint(item));
    if (platform === "darwin") return all.filter((item) => !this._isSoapEndpoint(item));
    return all;
  },

  _endpointLabel(item) {
    const endpoints = this._endpoints();
    const clash = item.source && endpoints.some((other) => other.key !== item.key && other.method === item.method && other.path === item.path && other.operation === item.operation);
    const source = clash ? ` · ${item.source}` : "";
    if (this._isSoapEndpoint(item)) {
      const name = item.operation || item.path || item.key;
      const title = item.summary && item.summary !== name ? item.summary : "";
      return title ? `SOAP ${name} · ${title}${source}` : `SOAP ${name}${source}`;
    }
    const title = item.summary || item.operationId;
    return title ? `${item.method} ${item.path} · ${title}${source}` : `${item.method} ${item.path}${source}`;
  },

  _endpointOptionsHtml() {
    const endpoints = this._visibleEndpoints();
    const key = `${this.model.presentation.platform}|${endpoints.map((item) => item.key).join("\n")}`;
    if (this._endpointOpts?.key === key) return this._endpointOpts.html;
    const groups = {};
    const useSource = endpoints.some((item) => item.source);
    endpoints.forEach((item) => {
      const group = useSource ? item.source || item.tags?.[0] || "API" : item.tags?.[0] || "API";
      (groups[group] = groups[group] || []).push(item);
    });
    const parts = [`<option value="">Select an endpoint</option>`];
    Object.keys(groups).forEach((group) => {
      parts.push(`<optgroup label="${this._esc(group)}">`);
      groups[group].forEach((item) => {
        parts.push(`<option value="${this._esc(item.key)}">${this._esc(this._endpointLabel(item))}</option>`);
      });
      parts.push("</optgroup>");
    });
    const html = parts.join("");
    this._endpointOpts = { key, html };
    return html;
  },

  _endpointOptions(selected) {
    let html = this._endpointOptionsHtml();
    if (!selected) return html;
    const token = `value="${this._esc(selected)}"`;
    const at = html.indexOf(token);
    if (at === -1) return html;
    return `${html.slice(0, at)}${token} selected${html.slice(at + token.length)}`;
  },

  _renderEndpointPicker() {
    const select = document.getElementById("flow-add-endpoint");
    if (!select) return;
    const endpoints = this._visibleEndpoints();
    const show = Boolean(endpoints.length);
    select.hidden = !show;
    if (!show) return;
    select.innerHTML = `<option value="">Add endpoint…</option>${this._endpointOptions("").replace('<option value="">Select an endpoint</option>', "")}`;
    select.value = "";
  },

  _addFromEndpoint(key) {
    document.querySelector('.flow-structure-section[data-kind="steps"]')?.setAttribute("open", "");
    const picker = document.getElementById("flow-add-endpoint");
    if (picker) picker.value = "";
    if (!key) return;
    const item = this._visibleEndpoints().find((entry) => entry.key === key) || this._endpoints().find((entry) => entry.key === key);
    if (!item) return;
    this.model.endpoints = this.model.endpoints?.length ? this.model.endpoints : this._endpoints();
    const actors = this.model.actors;
    const from = actors.find((actor) => actor.type === "client")?.id || actors[0]?.id || "client";
    const to =
      actors.find((actor) => actor.id === "api")?.id ||
      actors.find((actor) => actor.type === "internal")?.id ||
      actors.find((actor) => actor.id !== from)?.id ||
      "api";
    const used = new Set(this.model.steps.map((step) => step.id));
    FlowParse._operationSteps(item, this.model.steps.length, used).forEach((step) => {
      if (step.from === "client") step.from = from;
      if (step.to === "client") step.to = from;
      if (step.from === "api") step.from = to;
      if (step.to === "api") step.to = to;
      this.model.steps.push(step);
    });
    this.model.fieldCatalog = FlowIR.mergeCatalog(this.model.fieldCatalog, [
      { fields: item.requestFields },
      { fields: item.responseFields },
    ]);
    this._syncImplementations();
    this._renderSteps();
    this._renderEndpointPicker();
    this._afterStructure();
  },

  _applyEndpoint(step, key) {
    if (!key) {
      delete step.endpoint;
      return;
    }
    const item = this._endpoints().find((entry) => entry.key === key);
    if (!item) return;
    step.endpoint = key;
    if (this._isSoapEndpoint(item)) {
      if (step.type === "response") {
        step.label = item.okLabel || "OK";
        step.platforms = [...new Set([...(step.platforms || []), "chopin"])];
        step.chopin = { operation: item.operation, namespace: item.namespace, supported: true };
        step.fields = FlowParse._hopFields(item.okFields?.length ? item.okFields : item.responseFields, 32);
        return;
      }
      step.label = item.summary || item.operation || item.key;
      step.operation = item.operation;
      step.chopin = { operation: item.operation, namespace: item.namespace || "", supported: true };
      step.platforms = [...new Set([...(step.platforms || []), "chopin"])];
      step.fields = FlowParse._hopFields(item.requestFields, 32);
      return;
    }
    if (step.type === "response") {
      const pack = this._responseForEndpoint(step, item);
      step.status = pack.status;
      step.label = pack.label;
      step.platforms = [...new Set([...(step.platforms || []), "darwin"])];
      return;
    }
    step.label = item.summary || item.operationId || item.key;
    step.method = item.method;
    step.path = item.path;
    step.darwin = { method: item.method, path: item.path, supported: true };
    step.platforms = [...new Set([...(step.platforms || []), "darwin"])];
    step.fields = FlowParse._hopFields(item.requestFields);
  },

  _responseForEndpoint(step, item) {
    const status = Number(step.status);
    if (item.errCode && status === Number(item.errCode)) {
      return { status: Number(item.errCode), label: item.errLabel || item.errCode, fields: item.errFields };
    }
    if (item.serverCode && status === Number(item.serverCode)) {
      return { status: Number(item.serverCode), label: item.serverLabel || item.serverCode, fields: item.serverFields };
    }
    return { status: Number(item.okCode) || 200, label: item.okLabel || "OK", fields: item.okFields };
  },

  _ensurePlatformActors() {
    const platform = this.model.presentation.platform;
    const add = (id, name) => {
      if (this.model.actors.some((actor) => actor.id === id)) return;
      this.model.actors.push({ id, name, type: "platform" });
    };
    if (platform === "darwin" || platform === "both") add("darwin", "Darwin");
    if (platform === "chopin" || platform === "both") add("chopin", "Chopin");
    if (!this.model.actors.some((actor) => actor.id === "api")) {
      this.model.actors.push({ id: "api", name: "API Platform", type: "internal" });
    }
  },

  _renderActorColors() {
    const host = document.getElementById("flow-actor-colors");
    if (!host) return;
    host.innerHTML =
      FlowIR.ACTOR_TYPES.map((type) => {
        const hex = FlowIR.actorColor(this.model, type);
        return `<label class="flow-actor-color">
          <input type="color" data-actor-color="${type}" value="${hex.toLowerCase()}" aria-label="${type} colour">
          <span>${type}</span>
        </label>`;
      }).join("") + `<button type="button" data-actor-colors-reset>Reset colours</button>`;
  },

  _onActorColor(event) {
    const type = event.target.dataset.actorColor;
    if (!type) return;
    const hex = FlowIR.normalizeColor(event.target.value, "");
    if (!hex) return;
    const colors = { ...(this.model.presentation.actorColors || {}) };
    colors[type] = hex;
    this.model.presentation.actorColors = colors;
    this._schedulePreview();
  },

  _renderActors() {
    const host = document.getElementById("flow-actors");
    host.innerHTML = this.model.actors
      .map((actor) => {
        const types = FlowIR.ACTOR_TYPES.map((type) => `<option value="${type}"${type === actor.type ? " selected" : ""}>${type}</option>`).join("");
        return `<div class="flow-actor" data-actor="${this._esc(actor.id)}">
          <div class="flow-row">
            <input data-afield="name" value="${this._esc(actor.name)}" placeholder="Actor name" aria-label="Actor name">
            <select data-afield="type" aria-label="Actor type">${types}</select>
            ${actor.logo ? `<img class="flow-actor-thumb" src="${this._esc(actor.logo)}" alt="">` : ""}
            <input data-afield="logo" value="${this._esc(actor.logo && !String(actor.logo).startsWith("data:") ? actor.logo : "")}" placeholder="Logo URL" aria-label="Actor logo URL">
            <input type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" data-alogo hidden>
            <button type="button" data-alogo-pick>Logo</button>
            ${actor.logo ? `<button type="button" data-alogo-clear>Clear</button>` : ""}
            <button type="button" data-aremove>Remove</button>
          </div>
          <div class="flow-row">
            <input data-afield="role" value="${this._esc(actor.role || "")}" placeholder="${this._esc(FlowIR.defaultActorRole(actor.type))}" aria-label="Actor subheading">
          </div>
        </div>`;
      })
      .join("");
  },

  _healStepActors(step) {
    const ids = new Set(this.model.actors.map((actor) => actor.id));
    const fallback = this.model.actors[0]?.id || "";
    if (step.from && !ids.has(step.from)) step.from = fallback;
    if (step.to && !ids.has(step.to)) step.to = fallback;
    if (step.actor && !ids.has(step.actor)) step.actor = step.from || fallback;
    if (!step.from) step.from = step.actor || fallback;
    if (!step.to && step.type !== "condition") step.to = step.type === "process" ? step.from || fallback : fallback;
    return step;
  },

  _renderSteps() {
    this._catalogMemo = new Map();
    const host = document.getElementById("flow-steps");
    const platform = this.model.presentation.platform;
    const drawnIds = new Set(
      this.model.steps.filter((step) => FlowIR.stepOnPlatform(step, platform, this.model.implementations)).map((step) => step.id)
    );
    const hidden = this.model.steps.length - drawnIds.size;
    const note = hidden
      ? `<p class="flow-filter-note">Preview is ${FlowIR.protocolLabel(platform)}. ${hidden} step${hidden === 1 ? " is" : "s are"} listed below but not drawn. Switch Platform to Both to include ${hidden === 1 ? "it" : "them"}.</p>`
      : "";
    host.innerHTML =
      note +
      this.model.steps
        .map((raw, index) => {
          const step = this._healStepActors(raw);
          const onPlatform = drawnIds.has(step.id);
          const typeOpts = FlowIR.STEP_TYPES.map((type) => `<option value="${type}"${type === step.type ? " selected" : ""}>${type}</option>`).join("");
          const methodValue = step.darwin?.method || step.method || "";
          const methodOpts = ["", ...FlowIR.METHODS].map((method) => `<option value="${method}"${method === methodValue ? " selected" : ""}>${method || "—"}</option>`).join("");
          const fromOpts = this._actorOptions(step.from || step.actor);
          const toOpts = this._actorOptions(step.to);
          const local = step.type === "condition";
          const hop = step.type === "process" || step.type === "condition" ? "" : this._stepContractFields(step, platform, methodOpts);
          const off = onPlatform ? "" : `<p class="flow-filter-note">Not drawn on ${FlowIR.protocolLabel(platform)}.</p>`;
          const endpoint =
            this._visibleEndpoints().length && (step.type === "request" || step.type === "response")
              ? `<div class="flow-row"><select data-sfield="endpoint" aria-label="API endpoint">${this._endpointOptions(step.endpoint)}</select></div>`
              : "";
          return `<div class="flow-step${onPlatform ? "" : " flow-step-off"}" data-step="${this._esc(step.id)}" data-protocol="${platform === "chopin" || FlowIR._chopinOnly(step) ? "soap" : platform === "both" ? "both" : "rest"}">
          <div class="flow-row">
            <button type="button" class="flow-step-drag" data-sdrag draggable="true" title="Drag to reorder" aria-label="Drag to reorder">⋮⋮</button>
            <select data-sfield="type" aria-label="Step type">${typeOpts}</select>
            <select data-sfield="from" aria-label="${local ? "Actor" : "From"}">${fromOpts}</select>
            ${local ? "" : `<select data-sfield="to" aria-label="To">${toOpts}</select>`}
            <span class="flow-step-move">
              <button type="button" data-smove="-1" title="Move up" aria-label="Move step up"${index === 0 ? " disabled" : ""}>↑</button>
              <button type="button" data-smove="1" title="Move down" aria-label="Move step down"${index === this.model.steps.length - 1 ? " disabled" : ""}>↓</button>
            </span>
            <button type="button" data-sremove>Remove</button>
          </div>
          ${this._stepMeaning(step, platform, endpoint, hop)}
          ${off}
        </div>`;
        })
        .join("");
  },

  _stepMeaning(step, platform, endpoint, hop) {
    if (step.type === "process") {
      const marks = [
        ["", "No mark"],
        ["ok", "Done"],
        ["current", "Current"],
        ["pending", "Pending"],
      ]
        .map(([value, label]) => `<option value="${value}"${step.mark === value ? " selected" : ""}>${label}</option>`)
        .join("");
      return `<div class="flow-row">
        <input data-sfield="label" value="${this._esc(step.label || "")}" placeholder="Authenticate request">
        <input data-sfield="subtitle" value="${this._esc(step.subtitle || "")}" placeholder="OAuth 2.0">
        <select data-sfield="mark" aria-label="Process mark">${marks}</select>
      </div>
      <p class="flow-filter-note">Phrase it as an action. Same actor does the work. Different actors means one asks the other — not an API.</p>`;
    }
    if (step.type === "condition") {
      const kinds = FlowIR.CONDITION_KINDS.map(
        (kind) => `<option value="${kind}"${(step.kind || "business") === kind ? " selected" : ""}>${FlowIR.conditionKindLabel(kind)}</option>`
      ).join("");
      return `<div class="flow-row">
        <input data-sfield="label" value="${this._esc(step.label || "")}" placeholder="Card valid?">
        <select data-sfield="kind" aria-label="Condition kind">${kinds}</select>
      </div>
      ${this._branchesEditor(step)}`;
    }
    return `${endpoint}
      <div class="flow-row">
        <input data-sfield="label" value="${this._esc(step.label || "")}" placeholder="Label">
        <input data-sfield="status" value="${step.status || ""}" placeholder="${platform === "chopin" ? "Fault code" : "Status"}" inputmode="numeric">
      </div>
      ${hop}
      ${this._fieldsEditor(step)}`;
  },

  _stepChoiceLabel(item) {
    const name = item.label || item.path || item.operation || item.id;
    const kind = item.type === "request" ? item.method || "request" : item.type === "response" ? item.status || "response" : item.type;
    return `${name} · ${kind}`;
  },

  _seedConditionTargets(step) {
    const after = this.model.steps.slice(this.model.steps.indexOf(step) + 1);
    const pool = after.length ? after : this.model.steps.filter((item) => item.id !== step.id);
    step.branches = step.branches || FlowIR.defaultBranches();
    step.branches.forEach((branch, index) => {
      if (!branch.target && pool[index]) branch.target = pool[index].id;
    });
  },

  _nextConditionTarget(step) {
    const used = new Set((step.branches || []).map((branch) => branch.target).filter(Boolean));
    return this.model.steps.find((item) => item.id !== step.id && !used.has(item.id))?.id || "";
  },

  _branchesEditor(step) {
    const branches = Array.isArray(step.branches) && step.branches.length ? step.branches : FlowIR.defaultBranches();
    if (!step.branches?.length) step.branches = branches;
    const rows = branches
      .map((branch, index) => {
        const targets = this.model.steps
          .filter((item) => item.id !== step.id)
          .map((item) => `<option value="${this._esc(item.id)}"${item.id === branch.target ? " selected" : ""}>${this._esc(this._stepChoiceLabel(item))}</option>`)
          .join("");
        const methodSelect = ["", ...FlowIR.METHODS]
          .map((method) => `<option value="${method}"${(branch.method || "") === method ? " selected" : ""}>${method || "—"}</option>`)
          .join("");
        return `<div class="flow-branch-card" data-bindex="${index}">
          <div class="flow-row">
            <input data-bfield="label" value="${this._esc(branch.label || "")}" placeholder="Yes" aria-label="Outcome label">
            <input data-bfield="detail" value="${this._esc(branch.detail || "")}" placeholder="What happens on this path" aria-label="Outcome detail">
            <button type="button" data-bremove>Remove</button>
          </div>
          <div class="flow-row">
            <select data-bfield="method" aria-label="Outcome method">${methodSelect}</select>
            <input data-bfield="path" value="${this._esc(branch.path || "")}" placeholder="/path or operation" aria-label="Outcome path">
            <input data-bfield="status" value="${branch.status != null ? this._esc(branch.status) : ""}" placeholder="Status" inputmode="numeric" aria-label="Outcome status">
            <label class="flow-inline-check"><input type="checkbox" data-bfield="ends"${branch.ends ? " checked" : ""}> Flow ends</label>
          </div>
          <div class="flow-row">
            <select data-bfield="target" aria-label="Linked step">
              <option value="">No linked step</option>
              ${targets}
            </select>
          </div>
        </div>`;
      })
      .join("");
    return `<div class="flow-branches">
      <div class="flow-pane-head">
        <strong>Outcomes</strong>
        <button type="button" data-add-branch>Add outcome</button>
      </div>
      ${rows}
      <p class="flow-filter-note">Yes paths usually continue below. No paths can show a rollback call and end the flow.</p>
    </div>`;
  },

  _stepCatalog(step) {
    const key = `${step.id}|${step.endpoint || ""}|${step.type}|${this.model.presentation.platform}`;
    if (this._catalogMemo?.has(key)) return this._catalogMemo.get(key);
    const catalog = FlowIR.catalogForStep(this.model, step);
    this._catalogMemo = this._catalogMemo || new Map();
    this._catalogMemo.set(key, catalog);
    return catalog;
  },

  _fieldsEditor(step) {
    if (step.type === "process" || step.type === "condition") return "";
    const catalog = this._stepCatalog(step);
    const rows = (step.fields || [])
      .map((field, index) => {
        const key = FlowIR.fieldKey(field);
        const known = catalog.some((item) => FlowIR.fieldKey(item) === key);
        const custom = field.custom || (Boolean(field.name) && !known);
        const options = this._fieldOptions(catalog, field, custom);
        const ins = FlowIR.FIELD_INS.map((item) => `<option value="${item}"${item === field.in ? " selected" : ""}>${item}</option>`).join("");
        return `<div class="flow-row flow-field-row" data-findex="${index}">
          <select data-ffield="name" aria-label="Field name">${options}</select>
          ${custom ? `<input data-ffield="customName" value="${this._esc(field.name)}" placeholder="Field name" aria-label="Custom field name">` : ""}
          <select data-ffield="in" aria-label="Field location">${ins}</select>
          <input data-ffield="type" value="${this._esc(field.type || "")}" placeholder="type" aria-label="Field type">
          <input data-ffield="example" value="${this._esc(field.example || "")}" placeholder="example" aria-label="Field example">
          <label><input type="checkbox" data-ffield="required"${field.required ? " checked" : ""}> Required</label>
          <button type="button" data-fremove>Remove</button>
        </div>`;
      })
      .join("");
    const unused = catalog.filter((item) => !(step.fields || []).some((field) => FlowIR.fieldKey(field) === FlowIR.fieldKey(item))).length;
    return `<div class="flow-fields">
      <div class="flow-pane-head">
        <strong>API fields</strong>
        <button type="button" data-add-field>Add field</button>
      </div>
      ${rows || `<p class="flow-filter-note">${catalog.length ? `${catalog.length} fields from the spec. Add one and choose it from the list.` : "No field list yet. Import OpenAPI or add a custom field."}</p>`}
      ${unused && rows ? `<p class="flow-filter-note">${unused} more in the list</p>` : ""}
    </div>`;
  },

  _catalogOptionsHtml(catalog) {
    const key = catalog.map((item) => `${item.in}::${item.name}::${item.type || ""}::${item.required ? 1 : 0}`).join("|");
    if (this._catalogOpts?.key === key) return this._catalogOpts.html;
    const groups = {};
    catalog.forEach((item) => {
      const group = item.in || "body";
      (groups[group] = groups[group] || []).push(item);
    });
    const parts = [`<option value="">Select a field</option>`];
    FlowIR.FIELD_INS.forEach((group) => {
      const items = groups[group];
      if (!items?.length) return;
      parts.push(`<optgroup label="${this._esc(group)}">`);
      items.forEach((item) => {
        const itemKey = FlowIR.fieldKey(item);
        const label = `${item.name}${item.type ? ` · ${item.type}` : ""}${item.required ? " · required" : ""}`;
        parts.push(`<option value="${this._esc(itemKey)}">${this._esc(label)}</option>`);
      });
      parts.push("</optgroup>");
    });
    parts.push(`<option value="__custom__">Other…</option>`);
    const html = parts.join("");
    this._catalogOpts = { key, html };
    return html;
  },

  _fieldOptions(catalog, field, custom) {
    let html = this._catalogOptionsHtml(catalog);
    if (custom) return html.replace('value="__custom__"', 'value="__custom__" selected');
    if (!field?.name) return html;
    const token = `value="${this._esc(FlowIR.fieldKey(field))}"`;
    const at = html.indexOf(token);
    if (at === -1) return html;
    return `${html.slice(0, at)}${token} selected${html.slice(at + token.length)}`;
  },

  _stepContractFields(step, platform, methodOpts) {
    const rest = `<div class="flow-row flow-rest">
      <span class="flow-proto">Darwin REST</span>
      <select data-sfield="method" aria-label="HTTP method">${methodOpts}</select>
      <input data-sfield="path" value="${this._esc(step.darwin?.path || step.path || "")}" placeholder="/path">
      <label><input type="checkbox" data-sfield="darwinOk"${step.darwin?.supported === false ? "" : " checked"}> Supported</label>
    </div>`;
    const soap = `<div class="flow-row flow-soap">
      <span class="flow-proto">Chopin SOAP</span>
      <input data-sfield="chopinOp" value="${this._esc(step.chopin?.operation || step.operation || "")}" placeholder="CreateCard">
      <input data-sfield="chopinNs" value="${this._esc(step.chopin?.namespace || "")}" placeholder="Namespace">
      <label><input type="checkbox" data-sfield="chopinOk"${step.chopin?.supported === false ? "" : " checked"}> Supported</label>
    </div>`;
    if (platform === "chopin") return soap;
    if (platform === "darwin") return rest;
    const hasDarwin = Boolean(step.darwin) || step.platforms?.includes("darwin") || Boolean(step.method || step.path);
    const hasChopin = Boolean(step.chopin) || step.platforms?.includes("chopin") || Boolean(step.operation);
    return `<div class="flow-row flow-impl">
      <label><input type="checkbox" data-sfield="hasDarwin"${hasDarwin ? " checked" : ""}> Darwin REST</label>
      <label><input type="checkbox" data-sfield="hasChopin"${hasChopin ? " checked" : ""}> Chopin SOAP</label>
    </div>${hasDarwin ? rest : ""}${hasChopin ? soap : ""}`;
  },

  _syncProtocolChrome() {
    const platform = this.model?.presentation?.platform || "darwin";
    const sheet = document.querySelector(".flow-sheet");
    if (sheet) sheet.dataset.platform = platform;
    const hint = document.getElementById("flow-protocol-hint");
    if (hint) hint.textContent = FlowIR.protocolLabel(platform);
    const add = document.getElementById("flow-add-step");
    if (add) add.textContent = "Add step";
  },

  _actorOptions(selected) {
    return this.model.actors
      .map((actor) => `<option value="${this._esc(actor.id)}"${actor.id === selected ? " selected" : ""}>${this._esc(actor.name)}</option>`)
      .join("");
  },

  _onActorField(event) {
    const row = event.target.closest("[data-actor]");
    const actor = this.model.actors.find((item) => item.id === row?.dataset.actor);
    if (!actor) return;
    if (event.target.matches("input[type=file][data-alogo]")) {
      this._readActorLogo(actor, event.target.files?.[0]);
      event.target.value = "";
      return;
    }
    const field = event.target.dataset.afield;
    if (field === "name") actor.name = event.target.value;
    if (field === "type") {
      actor.type = event.target.value;
      const roleInput = row.querySelector('input[data-afield="role"]');
      if (roleInput) roleInput.placeholder = FlowIR.defaultActorRole(actor.type);
    }
    if (field === "role") {
      const role = String(event.target.value || "").trim();
      if (role) actor.role = role;
      else delete actor.role;
    }
    if (field === "logo") {
      const logo = FlowIR.safeLogo(event.target.value);
      if (logo) actor.logo = logo;
      else delete actor.logo;
    }
    if (field === "name") this._relabelActorOptions(actor);
    if (event.type === "change" && this._isTextControl(event.target)) return;
    this._schedulePreview();
  },

  _relabelActorOptions(actor) {
    const safe = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(actor.id) : String(actor.id).replace(/\\/g, "\\\\");
    document.querySelectorAll(`#flow-steps option[value="${safe}"]`).forEach((option) => {
      option.textContent = actor.name;
    });
  },

  _readActorLogo(actor, file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      this._errors(["Choose a PNG, JPEG, GIF, WebP, or SVG logo"]);
      return;
    }
    if (file.size > 400 * 1024) {
      this._errors(["Logo files must be 400 KB or smaller"]);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const logo = FlowIR.safeLogo(String(reader.result || ""));
      if (!logo) {
        this._errors(["That image could not be used as a logo"]);
        return;
      }
      actor.logo = logo;
      this._errors([]);
      this._renderActors();
      this._afterStructure();
    };
    reader.onerror = () => this._errors(["Could not read that logo"]);
    reader.readAsDataURL(file);
  },

  _onActorClick(event) {
    const row = event.target.closest("[data-actor]");
    const actor = this.model.actors.find((item) => item.id === row?.dataset.actor);
    if (event.target.closest("[data-alogo-pick]") && actor) {
      row.querySelector("input[data-alogo]")?.click();
      return;
    }
    if (event.target.closest("[data-alogo-clear]") && actor) {
      delete actor.logo;
      this._renderActors();
      this._renderSteps();
      this._afterStructure();
      return;
    }
    if (!event.target.closest("[data-aremove]")) return;
    const id = row?.dataset.actor;
    this.model.actors = this.model.actors.filter((item) => item.id !== id);
    this.model.steps = this.model.steps.filter((step) => step.from !== id && step.to !== id && step.actor !== id);
    this._renderActors();
    this._renderSteps();
    this._afterStructure();
  },

  _onStepField(event) {
    const card = event.target.closest("[data-step]");
    const step = this.model.steps.find((item) => item.id === card?.dataset.step);
    if (!step) return;
    const field = event.target.dataset.sfield;
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    if (field === "endpoint") {
      this._applyEndpoint(step, value);
      this._renderSteps();
      this._afterStructure();
      return;
    }
    if (field === "type") {
      step.type = value;
      if (value === "process" || value === "condition") {
        step.from = step.from || step.actor;
        step.actor = step.from || step.actor;
        if (value === "process" && !step.to) step.to = step.from;
        if (value === "condition") {
          step.kind = step.kind || "business";
          if (!step.branches?.length) step.branches = FlowIR.defaultBranches();
          this._seedConditionTargets(step);
        }
      }
      this._renderSteps();
      this._afterStructure();
      return;
    }
    if (field === "from") {
      step.from = value;
      if (step.type === "process" || step.type === "condition") step.actor = value;
    }
    if (field === "to") step.to = value;
    if (field === "label") step.label = value;
    if (field === "subtitle") step.subtitle = value;
    if (field === "mark") step.mark = value || undefined;
    if (field === "kind") step.kind = value;
    if (field === "method") {
      step.method = value || undefined;
      step.darwin = step.darwin || { supported: true };
      step.darwin.method = value || undefined;
    }
    if (field === "path") {
      step.path = value || undefined;
      step.darwin = step.darwin || { supported: true };
      step.darwin.path = value;
    }
    if (field === "operation") step.operation = value || undefined;
    if (field === "status") step.status = value ? Number(value) : undefined;
    if (field === "hasDarwin") this._setDarwin(step, value);
    if (field === "hasChopin") this._setChopin(step, value);
    if (field === "darwinPath") {
      step.darwin = step.darwin || { supported: true };
      step.darwin.path = value;
      step.path = value || step.path;
    }
    if (field === "darwinOk") {
      step.darwin = step.darwin || { method: step.method, path: step.path, supported: true };
      step.darwin.supported = value;
    }
    if (field === "chopinOp") {
      step.chopin = step.chopin || { supported: true };
      step.chopin.operation = value;
      step.operation = value || undefined;
    }
    if (field === "chopinNs") {
      step.chopin = step.chopin || { supported: true };
      step.chopin.namespace = value;
    }
    if (field === "chopinOk") {
      step.chopin = step.chopin || { operation: step.operation || step.label, supported: true };
      step.chopin.supported = value;
    }
    if (event.target.dataset.bfield) {
      this._onBranchField(step, event.target);
      if (event.type === "change" && this._isTextControl(event.target)) return;
      this._schedulePreview();
      return;
    }
    if (event.target.dataset.ffield) {
      const rebuilt = this._onApiField(step, event.target);
      if (rebuilt) this._renderSteps();
      else if (event.type === "change" && this._isTextControl(event.target)) return;
      this._schedulePreview();
      return;
    }
    if (field === "hasDarwin" || field === "hasChopin") {
      this._renderSteps();
      this._afterStructure();
      return;
    }
    if (event.type === "change" && this._isTextControl(event.target)) return;
    this._schedulePreview();
  },

  _onApiField(step, input) {
    const index = Number(input.closest("[data-findex]")?.dataset.findex);
    if (Number.isNaN(index) || !step.fields?.[index]) return false;
    const key = input.dataset.ffield;
    const value = input.type === "checkbox" ? input.checked : input.value;
    if (key === "name") {
      if (value === "__custom__") {
        step.fields[index].name = "";
        step.fields[index].custom = true;
        return true;
      }
      if (!value) {
        step.fields[index].name = "";
        delete step.fields[index].custom;
        return true;
      }
      const hit = this._stepCatalog(step).find((item) => FlowIR.fieldKey(item) === value);
      if (hit) {
        step.fields[index] = { ...hit };
        return true;
      }
      step.fields[index].name = value;
      delete step.fields[index].custom;
      return true;
    }
    if (key === "customName") step.fields[index].name = value;
    if (key === "in") step.fields[index].in = value;
    if (key === "type") step.fields[index].type = value;
    if (key === "example") {
      const text = String(value || "").trim();
      if (text) step.fields[index].example = text;
      else delete step.fields[index].example;
    }
    if (key === "required") step.fields[index].required = value;
    return false;
  },

  _onBranchField(step, input) {
    const index = Number(input.closest("[data-bindex]")?.dataset.bindex);
    if (Number.isNaN(index)) return;
    step.branches = step.branches || FlowIR.defaultBranches();
    if (!step.branches[index]) step.branches[index] = { id: FlowIR.uid("b"), label: "", target: "", when: "" };
    const key = input.dataset.bfield;
    const value = input.type === "checkbox" ? input.checked : input.value;
    if (key === "label") step.branches[index].label = value;
    if (key === "detail") {
      const text = String(value || "").trim();
      if (text) step.branches[index].detail = text;
      else delete step.branches[index].detail;
    }
    if (key === "method") {
      if (value) step.branches[index].method = value;
      else delete step.branches[index].method;
    }
    if (key === "path") {
      const text = String(value || "").trim();
      if (text) step.branches[index].path = text;
      else delete step.branches[index].path;
    }
    if (key === "status") {
      if (value === "" || value == null) delete step.branches[index].status;
      else {
        const num = Number(value);
        step.branches[index].status = Number.isFinite(num) ? num : value;
      }
    }
    if (key === "ends") {
      if (value) step.branches[index].ends = true;
      else delete step.branches[index].ends;
    }
    if (key === "target") step.branches[index].target = value;
  },

  _onStepClick(event) {
    const card = event.target.closest("[data-step]");
    const step = this.model.steps.find((item) => item.id === card?.dataset.step);
    if (event.target.closest("[data-add-branch]") && step) {
      step.branches = step.branches || FlowIR.defaultBranches();
      step.branches.push({ id: FlowIR.uid("b"), label: `Path ${step.branches.length + 1}`, target: this._nextConditionTarget(step), when: "", ends: false });
      this._renderSteps();
      this._afterStructure();
      return;
    }
    if (event.target.closest("[data-bremove]") && step) {
      const index = Number(event.target.closest("[data-bindex]")?.dataset.bindex);
      step.branches = (step.branches || []).filter((_, i) => i !== index);
      if (!step.branches.length) step.branches = FlowIR.defaultBranches();
      this._renderSteps();
      this._afterStructure();
      return;
    }
    if (event.target.closest("[data-add-field]") && step) {
      step.fields = step.fields || [];
      const unused = this._stepCatalog(step).find((item) => !step.fields.some((field) => FlowIR.fieldKey(field) === FlowIR.fieldKey(item)));
      step.fields.push(
        unused
          ? { ...unused }
          : { name: "", in: step.type === "response" ? "response" : this.model.presentation.platform === "chopin" ? "soap" : "body", required: true, type: "" }
      );
      this._renderSteps();
      this._afterStructure();
      return;
    }
    if (event.target.closest("[data-fremove]") && step) {
      const index = Number(event.target.closest("[data-findex]")?.dataset.findex);
      step.fields = (step.fields || []).filter((_, i) => i !== index);
      this._renderSteps();
      this._afterStructure();
      return;
    }
    const move = event.target.closest("[data-smove]");
    if (move && step) {
      this._moveStep(step.id, Number(move.dataset.smove));
      return;
    }
    if (!event.target.closest("[data-sremove]")) return;
    const id = card?.dataset.step;
    this.model.steps = this.model.steps.filter((item) => item.id !== id);
    this._renderSteps();
    this._afterStructure();
  },

  _moveStep(id, delta) {
    const index = this.model.steps.findIndex((step) => step.id === id);
    const next = index + delta;
    if (index < 0 || next < 0 || next >= this.model.steps.length) return;
    const [step] = this.model.steps.splice(index, 1);
    this.model.steps.splice(next, 0, step);
    this._alignImplOrder();
    this._renderSteps();
    this._afterStructure();
    document.querySelector(`#flow-steps [data-step="${this._esc(id)}"]`)?.scrollIntoView({ block: "nearest" });
  },

  _moveStepTo(fromId, toId, before) {
    if (!fromId || fromId === toId) return;
    const from = this.model.steps.findIndex((step) => step.id === fromId);
    if (from < 0) return;
    const [step] = this.model.steps.splice(from, 1);
    let to = this.model.steps.findIndex((item) => item.id === toId);
    if (to < 0) {
      this.model.steps.splice(from, 0, step);
      return;
    }
    this.model.steps.splice(before ? to : to + 1, 0, step);
    this._alignImplOrder();
    this._renderSteps();
    this._afterStructure();
  },

  _alignImplOrder() {
    const order = this.model.steps.map((step) => step.id);
    ["darwin", "chopin"].forEach((key) => {
      const list = this.model.implementations?.[key]?.steps;
      if (!Array.isArray(list)) return;
      const keep = new Set(list);
      this.model.implementations[key].steps = order.filter((id) => keep.has(id));
    });
  },

  _onStepDragStart(event) {
    const handle = event.target.closest("[data-sdrag]");
    const card = event.target.closest("[data-step]");
    if (!handle || !card) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData("text/plain", card.dataset.step);
    event.dataTransfer.effectAllowed = "move";
    card.classList.add("flow-step-dragging");
    this._dragStep = card.dataset.step;
  },

  _onStepDragOver(event) {
    const card = event.target.closest("[data-step]");
    if (!this._dragStep || !card) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const before = event.clientY < card.getBoundingClientRect().top + card.offsetHeight / 2;
    document.querySelectorAll("#flow-steps .flow-step-drop-before, #flow-steps .flow-step-drop-after").forEach((el) => {
      el.classList.remove("flow-step-drop-before", "flow-step-drop-after");
    });
    card.classList.add(before ? "flow-step-drop-before" : "flow-step-drop-after");
  },

  _onStepDrop(event) {
    const card = event.target.closest("[data-step]");
    const fromId = this._dragStep || event.dataTransfer.getData("text/plain");
    if (!card || !fromId) return;
    event.preventDefault();
    const before = event.clientY < card.getBoundingClientRect().top + card.offsetHeight / 2;
    this._moveStepTo(fromId, card.dataset.step, before);
    this._onStepDragEnd();
  },

  _onStepDragEnd() {
    this._dragStep = "";
    document.querySelectorAll("#flow-steps .flow-step-dragging, #flow-steps .flow-step-drop-before, #flow-steps .flow-step-drop-after").forEach((el) => {
      el.classList.remove("flow-step-dragging", "flow-step-drop-before", "flow-step-drop-after");
    });
  },

  _setDarwin(step, on) {
    if (on) {
      step.darwin = step.darwin || { method: step.method || "POST", path: step.path || "", supported: true };
      step.platforms = [...new Set([...(step.platforms || []), "darwin"])];
    } else {
      delete step.darwin;
      step.platforms = (step.platforms || []).filter((item) => item !== "darwin");
      if (!step.platforms.length) delete step.platforms;
    }
  },

  _setChopin(step, on) {
    if (on) {
      step.chopin = step.chopin || { operation: step.operation || step.label || "Operation", supported: true };
      step.platforms = [...new Set([...(step.platforms || []), "chopin"])];
    } else {
      delete step.chopin;
      step.platforms = (step.platforms || []).filter((item) => item !== "chopin");
      if (!step.platforms.length) delete step.platforms;
    }
  },

  _syncImplementations() {
    if (!this.model) return;
    this.model.implementations = this.model.implementations || {};
    this.model.steps = this.model.steps || [];
    const order = this.model.steps.map((step) => step.id);
    const ids = new Set(order);
    ["darwin", "chopin"].forEach((key) => {
      const impl = this.model.implementations[key] || { protocol: key === "chopin" ? "SOAP" : "REST" };
      const existing = new Set(Array.isArray(impl.steps) ? impl.steps.filter((id) => ids.has(id)) : []);
      this.model.steps.forEach((step) => {
        if (existing.has(step.id)) return;
        if (!step.platforms || step.platforms.includes(key)) existing.add(step.id);
      });
      this.model.implementations[key] = {
        protocol: impl.protocol || (key === "chopin" ? "SOAP" : "REST"),
        steps: order.filter((id) => existing.has(id)),
      };
    });
  },

  _readOpenApi() {
    const text = document.getElementById("flow-openapi").value;
    if (!String(text || "").trim()) {
      if (this.openApiOps?.operations?.length) {
        this._applyOpenApiList(this.openApiOps);
        return;
      }
      this._errors(["Paste or upload an OpenAPI document first"]);
      return;
    }
    const listed = FlowParse.listOpenApi(text);
    listed.file = listed.ok ? listed.title || "Pasted spec" : "Pasted spec";
    if (!listed.ok && !this.openApiOps?.operations?.length) {
      document.getElementById("flow-openapi-ops").hidden = true;
      this._errors(listed.errors);
      return;
    }
    this._applyOpenApiList(FlowParse.mergeListed([this.openApiOps, listed]));
  },

  _readOpenApiFiles(event) {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    if (!files.length) return;
    Promise.all(
      files.map((file) =>
        file.text().then((text) => {
          const listed = FlowParse.listOpenApi(text);
          listed.file = file.name;
          if (!listed.ok) listed.errors = (listed.errors || []).map((err) => `${file.name}: ${err}`);
          return listed;
        })
      )
    )
      .then((results) => this._applyOpenApiList(FlowParse.mergeListed([this.openApiOps, ...results])))
      .catch((err) => this._errors([`Could not read OpenAPI files: ${err.message}`]));
  },

  _applyOpenApiList(listed) {
    const box = document.getElementById("flow-openapi-ops");
    const kept = this._selectedOpenApiKeys();
    if (!listed?.ok) {
      if (!this.openApiOps?.operations?.length) box.hidden = true;
      this._errors(listed?.errors || ["OpenAPI parse failed"]);
      return;
    }
    this.openApiOps = listed;
    const soap = (this.model.endpoints || []).filter((item) => this._isSoapEndpoint(item));
    this.model.endpoints = [...listed.operations.map((item) => FlowIR._normalizeEndpoint(FlowParse._slimEndpoint(item))), ...soap];
    this.model.fieldCatalog = FlowIR.mergeCatalog(
      this.model.fieldCatalog,
      listed.operations.flatMap((item) => [{ fields: item.requestFields }, { fields: item.responseFields }])
    );
    this._renderEndpointPicker();
    const groups = {};
    listed.operations.forEach((item) => {
      const group = item.source || listed.title || "API";
      (groups[group] = groups[group] || []).push(item);
    });
    const multi = Object.keys(groups).length > 1;
    const host = document.getElementById("flow-openapi-list");
    host.innerHTML = Object.keys(groups)
      .map((group) => {
        const rows = groups[group]
          .map((item) => {
            const extra = [
              item.summary || item.operationId,
              item.tags.join(", "),
              item.hasAuth ? item.authName : "",
              `${item.requestFields.length} in`,
              `${item.responseFields.length} out`,
            ]
              .filter(Boolean)
              .join(" · ");
            const checked = kept.includes(item.key) || (!kept.length && listed.operations.length === 1) ? " checked" : "";
            return `<label class="flow-openapi-op" data-key="${this._esc(item.key)}">
          <input type="checkbox" data-op-key="${this._esc(item.key)}"${checked}>
          <span class="flow-op-method flow-op-${item.method.toLowerCase()}">${this._esc(item.method)}</span>
          <span class="flow-op-path">${this._esc(item.path)}</span>
          <span class="flow-op-meta">${this._esc(extra)}</span>
        </label>`;
          })
          .join("");
        return multi ? `<div class="flow-openapi-group"><p class="flow-openapi-source">${this._esc(group)} · ${groups[group].length}</p>${rows}</div>` : rows;
      })
      .join("");
    box.hidden = false;
    document.getElementById("flow-openapi-box").open = true;
    this._toggleImport(true);
    const sources = listed.sources?.length ? listed.sources : [...new Set(listed.operations.map((item) => item.source).filter(Boolean))];
    const files = document.getElementById("flow-openapi-files");
    if (files) files.textContent = sources.length ? `${sources.length} file${sources.length === 1 ? "" : "s"}: ${sources.join(" · ")}` : "";
    const clear = document.getElementById("flow-openapi-clear");
    if (clear) clear.hidden = false;
    this._filterOpenApi();
    this._errors(listed.errors || []);
  },

  _clearOpenApi() {
    this.openApiOps = null;
    document.getElementById("flow-openapi").value = "";
    document.getElementById("flow-openapi-list").innerHTML = "";
    document.getElementById("flow-openapi-ops").hidden = true;
    const files = document.getElementById("flow-openapi-files");
    if (files) files.textContent = "";
    const clear = document.getElementById("flow-openapi-clear");
    if (clear) clear.hidden = true;
    this._errors([]);
  },

  _filterOpenApi() {
    const query = String(document.getElementById("flow-openapi-filter").value || "").trim().toLowerCase();
    document.querySelectorAll("#flow-openapi-list .flow-openapi-op").forEach((row) => {
      const hay = row.textContent.toLowerCase();
      row.hidden = Boolean(query) && !hay.includes(query);
    });
    document.querySelectorAll("#flow-openapi-list .flow-openapi-group").forEach((group) => {
      const rows = [...group.querySelectorAll(".flow-openapi-op")];
      group.hidden = Boolean(rows.length) && rows.every((row) => row.hidden);
    });
    this._openapiCount();
  },

  _toggleOpenApi(on) {
    document.querySelectorAll("#flow-openapi-list input[data-op-key]").forEach((box) => {
      if (!box.closest(".flow-openapi-op")?.hidden) box.checked = on;
    });
    this._openapiCount();
  },

  _selectedOpenApiKeys() {
    return [...document.querySelectorAll("#flow-openapi-list input[data-op-key]:checked")].map((box) => box.dataset.opKey);
  },

  _openapiCount() {
    const total = this.openApiOps?.operations?.length || 0;
    const selected = this._selectedOpenApiKeys().length;
    const sources = this.openApiOps?.sources?.length || [...new Set((this.openApiOps?.operations || []).map((item) => item.source).filter(Boolean))].length || 1;
    const title = this.openApiOps?.title || "API";
    const fields = (this.openApiOps?.operations || [])
      .filter((item) => this._selectedOpenApiKeys().includes(item.key))
      .reduce((sum, item) => sum + (item.requestFields?.length || 0) + (item.responseFields?.length || 0), 0);
    document.getElementById("flow-openapi-count").textContent = `${selected} of ${total} selected · ${fields} fields · ${title}${sources > 1 ? ` · ${sources} files` : ""}`;
  },

  _compileOpenApi() {
    if (!this.openApiOps) this._readOpenApi();
    const keys = this._selectedOpenApiKeys();
    const parsed = FlowParse.fromListed(this.openApiOps, { keys });
    if (!parsed.ok) {
      this._errors(parsed.errors);
      return;
    }
    this.model = parsed.model;
    this.customerUndo = null;
    this._renderAll();
    this._toggleImport(false);
  },

  _readWsdl() {
    const text = document.getElementById("flow-wsdl").value.trim();
    if (!text) {
      if (this.wsdlOps?.operations?.length) {
        this._applyWsdlList(this.wsdlOps);
        return;
      }
      this._errors(["Paste or upload a Chopin WSDL, XML, or SoapUI project first"]);
      return;
    }
    const listed = FlowParse.listWsdl(text);
    listed.file = listed.ok ? listed.title || "Pasted WSDL" : "Pasted WSDL";
    if (!listed.ok && !this.wsdlOps?.operations?.length) {
      document.getElementById("flow-wsdl-ops").hidden = true;
      this._errors(listed.errors);
      return;
    }
    this._applyWsdlList(FlowParse.mergeListed([this.wsdlOps, listed]));
  },

  _bindWsdlDrop() {
    const box = document.getElementById("flow-wsdl-box");
    if (!box) return;
    ["dragenter", "dragover"].forEach((type) => {
      box.addEventListener(type, (event) => {
        if (![...event.dataTransfer?.items || []].some((item) => item.kind === "file")) return;
        event.preventDefault();
        box.classList.add("is-over");
      });
    });
    ["dragleave", "drop"].forEach((type) => {
      box.addEventListener(type, () => box.classList.remove("is-over"));
    });
    box.addEventListener("drop", (event) => {
      const files = [...(event.dataTransfer?.files || [])].filter((file) => this._isWsdlFile(file));
      if (!files.length) return;
      event.preventDefault();
      event.stopPropagation();
      this._ingestWsdlFiles(files);
    });
  },

  _isWsdlFile(file) {
    const name = String(file?.name || "").toLowerCase();
    const type = String(file?.type || "").toLowerCase();
    return /\.(wsdl|xml)$/i.test(name) || type.includes("xml") || type.includes("wsdl");
  },

  _readWsdlFiles(event) {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    this._ingestWsdlFiles(files);
  },

  _ingestWsdlFiles(files) {
    const list = (files || []).filter((file) => this._isWsdlFile(file));
    if (!list.length) {
      this._errors(["Use a .wsdl or .xml file"]);
      return;
    }
    Promise.all(
      list.map((file) =>
        file.text().then((text) => {
          const listed = FlowParse.listWsdl(text);
          listed.file = file.name;
          if (!listed.ok) listed.errors = (listed.errors || []).map((err) => `${file.name}: ${err}`);
          return listed;
        })
      )
    )
      .then((results) => this._applyWsdlList(FlowParse.mergeListed([this.wsdlOps, ...results])))
      .catch((err) => this._errors([`Could not read WSDL or XML files: ${err.message}`]));
  },

  _applyWsdlList(listed) {
    const box = document.getElementById("flow-wsdl-ops");
    const kept = this._selectedWsdlKeys();
    if (!listed?.ok) {
      if (!this.wsdlOps?.operations?.length) box.hidden = true;
      this._errors(listed?.errors || ["WSDL parse failed"]);
      return;
    }
    this.wsdlOps = listed;
    const rest = (this.model.endpoints || []).filter((item) => !this._isSoapEndpoint(item));
    this.model.endpoints = [...rest, ...listed.operations.map((item) => FlowIR._normalizeEndpoint(FlowParse._slimEndpoint(item)))];
    this.model.fieldCatalog = FlowIR.mergeCatalog(
      this.model.fieldCatalog,
      listed.operations.flatMap((item) => [{ fields: item.requestFields }, { fields: item.responseFields }])
    );
    this._renderEndpointPicker();
    const groups = {};
    listed.operations.forEach((item) => {
      const group = item.source || listed.title || "Chopin";
      (groups[group] = groups[group] || []).push(item);
    });
    const multi = Object.keys(groups).length > 1;
    const host = document.getElementById("flow-wsdl-list");
    host.innerHTML = Object.keys(groups)
      .map((group) => {
        const rows = groups[group]
          .map((item) => {
            const extra = [
              item.summary && item.summary !== item.operation ? item.summary : "",
              item.namespace,
              `${item.requestFields.length} in`,
              `${item.responseFields.length} out`,
            ]
              .filter(Boolean)
              .join(" · ");
            const checked = kept.includes(item.key) || (!kept.length && listed.operations.length === 1) ? " checked" : "";
            return `<label class="flow-openapi-op" data-key="${this._esc(item.key)}">
          <input type="checkbox" data-wsdl-key="${this._esc(item.key)}"${checked}>
          <span class="flow-op-method flow-op-soap">SOAP</span>
          <span class="flow-op-path">${this._esc(item.operation || item.path)}</span>
          <span class="flow-op-meta">${this._esc(extra)}</span>
        </label>`;
          })
          .join("");
        return multi ? `<div class="flow-openapi-group"><p class="flow-openapi-source">${this._esc(group)} · ${groups[group].length}</p>${rows}</div>` : rows;
      })
      .join("");
    box.hidden = false;
    document.getElementById("flow-wsdl-box").open = true;
    this._toggleImport(true);
    const sources = listed.sources?.length ? listed.sources : [...new Set(listed.operations.map((item) => item.source).filter(Boolean))];
    const files = document.getElementById("flow-wsdl-files");
    if (files) files.textContent = sources.length ? `${sources.length} file${sources.length === 1 ? "" : "s"}: ${sources.join(" · ")}` : "";
    const clear = document.getElementById("flow-wsdl-clear");
    if (clear) clear.hidden = false;
    this._filterWsdl();
    this._errors(listed.errors || []);
  },

  _clearWsdl() {
    this.wsdlOps = null;
    document.getElementById("flow-wsdl").value = "";
    document.getElementById("flow-wsdl-list").innerHTML = "";
    document.getElementById("flow-wsdl-ops").hidden = true;
    const files = document.getElementById("flow-wsdl-files");
    if (files) files.textContent = "";
    const clear = document.getElementById("flow-wsdl-clear");
    if (clear) clear.hidden = true;
    if (this.model?.endpoints) this.model.endpoints = this.model.endpoints.filter((item) => !this._isSoapEndpoint(item));
    this._renderEndpointPicker();
    this._errors([]);
  },

  _filterWsdl() {
    const query = String(document.getElementById("flow-wsdl-filter").value || "").trim().toLowerCase();
    document.querySelectorAll("#flow-wsdl-list .flow-openapi-op").forEach((row) => {
      const hay = row.textContent.toLowerCase();
      row.hidden = Boolean(query) && !hay.includes(query);
    });
    document.querySelectorAll("#flow-wsdl-list .flow-openapi-group").forEach((group) => {
      const rows = [...group.querySelectorAll(".flow-openapi-op")];
      group.hidden = Boolean(rows.length) && rows.every((row) => row.hidden);
    });
    this._wsdlCount();
  },

  _toggleWsdl(on) {
    document.querySelectorAll("#flow-wsdl-list input[data-wsdl-key]").forEach((box) => {
      if (!box.closest(".flow-openapi-op")?.hidden) box.checked = on;
    });
    this._wsdlCount();
  },

  _selectedWsdlKeys() {
    return [...document.querySelectorAll("#flow-wsdl-list input[data-wsdl-key]:checked")].map((box) => box.dataset.wsdlKey);
  },

  _wsdlCount() {
    const total = this.wsdlOps?.operations?.length || 0;
    const selected = this._selectedWsdlKeys().length;
    const sources = this.wsdlOps?.sources?.length || [...new Set((this.wsdlOps?.operations || []).map((item) => item.source).filter(Boolean))].length || 1;
    const title = this.wsdlOps?.title || "Chopin";
    const fields = (this.wsdlOps?.operations || [])
      .filter((item) => this._selectedWsdlKeys().includes(item.key))
      .reduce((sum, item) => sum + (item.requestFields?.length || 0) + (item.responseFields?.length || 0), 0);
    document.getElementById("flow-wsdl-count").textContent = `${selected} of ${total} selected · ${fields} fields · ${title}${sources > 1 ? ` · ${sources} files` : ""}`;
  },

  _compileWsdl() {
    if (!this.wsdlOps) this._readWsdl();
    const keys = this._selectedWsdlKeys();
    const parsed = FlowParse.fromListed(this.wsdlOps, { keys });
    if (!parsed.ok) {
      this._errors(parsed.errors);
      return;
    }
    this.model = parsed.model;
    this.customerUndo = null;
    this._renderAll();
    this._toggleImport(false);
  },

  _onImagePaste(event) {
    if (document.getElementById("flow-modal")?.hidden) return;
    if (event.target.closest("textarea, input") && event.clipboardData?.getData("text")) return;
    const file = this._clipboardImage(event.clipboardData);
    if (!file) return;
    event.preventDefault();
    this._toggleImport(true);
    document.getElementById("flow-image-box")?.setAttribute("open", "");
    this._acceptImage(file);
  },

  _clipboardImage(data) {
    if (!data) return null;
    const files = [...(data.files || [])].filter((file) => file.type.startsWith("image/") || /\.svg$/i.test(file.name || ""));
    if (files[0]) return files[0];
    const item = [...(data.items || [])].find((entry) => String(entry.type || "").startsWith("image/"));
    return item?.getAsFile?.() || null;
  },

  _readImageFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) this._acceptImage(file);
  },

  _acceptImage(file) {
    this._imageFile = file;
    const preview = document.getElementById("flow-image-preview");
    const hint = document.getElementById("flow-image-hint");
    const clear = document.getElementById("flow-image-clear");
    if (clear) clear.hidden = false;
    document.getElementById("flow-image-box")?.setAttribute("open", "");
    this._toggleImport(true);
    this._setImageStatus(file.name || "Image ready");
    if (file.type.startsWith("image/") && file.type !== "image/svg+xml") {
      const url = URL.createObjectURL(file);
      preview.hidden = false;
      preview.onload = () => URL.revokeObjectURL(url);
      preview.src = url;
      if (hint) hint.hidden = true;
    } else {
      preview.hidden = true;
      preview.removeAttribute("src");
      if (hint) {
        hint.hidden = false;
        hint.textContent = file.name || "SVG ready";
      }
    }
  },

  _clearImage(silent) {
    this._imageFile = null;
    const preview = document.getElementById("flow-image-preview");
    const hint = document.getElementById("flow-image-hint");
    const clear = document.getElementById("flow-image-clear");
    if (preview) {
      preview.hidden = true;
      preview.removeAttribute("src");
    }
    if (hint) {
      hint.hidden = false;
      hint.textContent = "Drop a PNG, JPEG, or SVG of an existing flow, or paste from the clipboard.";
    }
    if (clear) clear.hidden = true;
    if (!silent) this._setImageStatus("");
  },

  _setImageStatus(text) {
    const el = document.getElementById("flow-image-status");
    if (el) el.textContent = text || "";
  },

  _compileImage() {
    if (!this._imageFile) {
      this._errors(["Drop or choose a flow image first"]);
      return;
    }
    const button = document.getElementById("flow-image-compile");
    if (button) button.disabled = true;
    this._setImageStatus("Creating the flow…");
    this._errors([]);
    FlowImage.read(this._imageFile, {
      platform: this.model?.presentation?.platform || "darwin",
      onStatus: (text) => this._setImageStatus(text),
    })
      .then((parsed) => {
        if (!parsed?.ok) {
          this._errors(parsed?.errors || ["Could not create a flow from that image"]);
          this._setImageStatus("");
          return;
        }
        this.model = parsed.model;
        this.customerUndo = null;
        this._renderAll();
        this._toggleImport(false);
        this._setImageStatus(parsed.note || "Flow created from the image.");
      })
      .catch((err) => {
        this._errors([err.message || "Could not create a flow from that image"]);
        this._setImageStatus("");
      })
      .finally(() => {
        if (button) button.disabled = false;
      });
  },

  _readFile(event, targetId, then) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      document.getElementById(targetId).value = String(reader.result || "");
      if (typeof then === "function") then();
    };
    reader.readAsText(file);
    event.target.value = "";
  },

  _esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  },
};
