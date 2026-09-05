const FlowStudio = {
  model: null,
  backup: null,
  customerUndo: null,
  openApiOps: null,
  wsdlOps: null,
  onSave: null,
  _syncing: false,

  open(model, onSave) {
    this.model = FlowIR.normalize(model || FlowIR.empty());
    this.backup = FlowIR.clone(this.model);
    this.customerUndo = null;
    this.onSave = onSave || (() => {});
    document.getElementById("flow-modal").hidden = false;
    this._bindOnce();
    this._renderAll();
  },

  close() {
    document.getElementById("flow-modal").hidden = true;
    this.model = null;
    this.backup = null;
    this.customerUndo = null;
    this.onSave = null;
  },

  apply() {
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
    const drawn = FlowRender.svg(FlowIR.forView(this.model, "developer"));
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
    document.getElementById("flow-title").addEventListener("input", (event) => {
      this.model.title = event.target.value;
      this._afterStructure();
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
      this._afterStructure();
    });
    document.getElementById("flow-add-actor").addEventListener("click", () => this._addActor());
    document.getElementById("flow-actor-colors").addEventListener("input", (event) => this._onActorColor(event));
    document.getElementById("flow-actor-colors").addEventListener("click", (event) => {
      if (!event.target.closest("[data-actor-colors-reset]")) return;
      delete this.model.presentation.actorColors;
      this._renderActorColors();
      this._afterStructure();
    });
    document.getElementById("flow-add-step").addEventListener("click", () => this._addStep());
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
    document.getElementById("flow-actors").addEventListener("input", (event) => this._onActorField(event));
    document.getElementById("flow-actors").addEventListener("change", (event) => this._onActorField(event));
    document.getElementById("flow-actors").addEventListener("click", (event) => this._onActorClick(event));
    document.getElementById("flow-steps").addEventListener("input", (event) => this._onStepField(event));
    document.getElementById("flow-steps").addEventListener("change", (event) => this._onStepField(event));
    document.getElementById("flow-steps").addEventListener("click", (event) => this._onStepClick(event));
  },

  _renderAll() {
    this._syncing = true;
    document.getElementById("flow-title").value = this.model.title || "";
    document.getElementById("flow-layout").value = this.model.presentation.layout;
    document.getElementById("flow-platform").value = this.model.presentation.platform;
    document.getElementById("flow-show-fields").checked = this.model.presentation.showFields !== false;
    document.getElementById("flow-source").value = JSON.stringify(this.model, null, 2);
    this._renderActorColors();
    this._renderActors();
    this._renderSteps();
    this._renderEndpointPicker();
    this._syncProtocolChrome();
    this._preview();
    this._syncing = false;
  },

  _afterStructure() {
    if (this._syncing) return;
    this._syncImplementations();
    this.model = FlowIR.normalize(this.model);
    this._syncing = true;
    document.getElementById("flow-source").value = JSON.stringify(this.model, null, 2);
    this._syncing = false;
    this._preview();
  },

  _fromSource(rebuild) {
    if (this._syncing) return;
    const parsed = FlowParse.fromJson(document.getElementById("flow-source").value);
    if (!parsed.ok) {
      this._errors(parsed.errors);
      return;
    }
    this.model = parsed.model;
    this._syncing = true;
    document.getElementById("flow-title").value = this.model.title || "";
    document.getElementById("flow-layout").value = this.model.presentation.layout;
    document.getElementById("flow-platform").value = this.model.presentation.platform;
    document.getElementById("flow-show-fields").checked = this.model.presentation.showFields !== false;
    if (rebuild) {
      this._renderActorColors();
      this._renderActors();
      this._renderSteps();
    }
    this._syncProtocolChrome();
    this._syncing = false;
    this._preview();
  },

  _preview() {
    const checked = FlowIR.validate(this.model);
    const host = document.getElementById("flow-preview");
    if (!checked.ok) {
      this._errors(checked.errors);
      host.innerHTML = `<p class="flow-error">${this._esc(checked.errors.join(" · "))}</p>`;
      return;
    }
    const drawn = FlowRender.html(checked.model);
    if (!drawn.ok) {
      this._errors(drawn.errors);
      host.innerHTML = `<p class="flow-error">${this._esc(drawn.errors.join(" · "))}</p>`;
      return;
    }
    this._errors([]);
    host.innerHTML = drawn.html;
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
    this.model.actors.push({ id: FlowIR.uid("a"), name: "New actor", type: "internal" });
    this._renderActors();
    this._renderSteps();
    this._afterStructure();
  },

  _addStep() {
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

  _endpointOptions(selected) {
    const groups = {};
    const endpoints = this._visibleEndpoints();
    const useSource = endpoints.some((item) => item.source);
    endpoints.forEach((item) => {
      const group = useSource ? item.source || item.tags?.[0] || "API" : item.tags?.[0] || "API";
      (groups[group] = groups[group] || []).push(item);
    });
    const parts = [`<option value="">Select an endpoint</option>`];
    Object.keys(groups).forEach((group) => {
      parts.push(`<optgroup label="${this._esc(group)}">`);
      groups[group].forEach((item) => {
        parts.push(
          `<option value="${this._esc(item.key)}"${item.key === selected ? " selected" : ""}>${this._esc(this._endpointLabel(item))}</option>`
        );
      });
      parts.push("</optgroup>");
    });
    return parts.join("");
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
        return;
      }
      step.label = item.summary || item.operation || item.key;
      step.operation = item.operation;
      step.chopin = { operation: item.operation, namespace: item.namespace || "", supported: true };
      step.platforms = [...new Set([...(step.platforms || []), "chopin"])];
      step.fields = FlowParse._hopFields(item.requestFields);
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
    this._afterStructure();
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
            <code>${this._esc(actor.id)}</code>
            <button type="button" data-aremove>Remove</button>
          </div>
          <div class="flow-row flow-actor-logo">
            ${actor.logo ? `<img class="flow-actor-thumb" src="${this._esc(actor.logo)}" alt="">` : ""}
            <input data-afield="logo" value="${this._esc(actor.logo && !String(actor.logo).startsWith("data:") ? actor.logo : "")}" placeholder="Logo URL — replaces the name on the diagram" aria-label="Actor logo URL">
            <input type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" data-alogo hidden>
            <button type="button" data-alogo-pick>Upload logo</button>
            ${actor.logo ? `<button type="button" data-alogo-clear>Remove logo</button>` : ""}
          </div>
        </div>`;
      })
      .join("");
  },

  _renderSteps() {
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
        .map((step) => {
          const onPlatform = drawnIds.has(step.id);
          const typeOpts = FlowIR.STEP_TYPES.map((type) => `<option value="${type}"${type === step.type ? " selected" : ""}>${type}</option>`).join("");
          const methodValue = step.darwin?.method || step.method || "";
          const methodOpts = ["", ...FlowIR.METHODS].map((method) => `<option value="${method}"${method === methodValue ? " selected" : ""}>${method || "—"}</option>`).join("");
          const fromOpts = this._actorOptions(step.from || step.actor);
          const toOpts = this._actorOptions(step.to);
          const hop = step.type === "process" || step.type === "condition" ? "" : this._stepContractFields(step, platform, methodOpts);
          const off = onPlatform ? "" : `<p class="flow-filter-note">Not drawn on ${FlowIR.protocolLabel(platform)}.</p>`;
          const endpoint =
            this._visibleEndpoints().length && (step.type === "request" || step.type === "response")
              ? `<div class="flow-row"><select data-sfield="endpoint" aria-label="API endpoint">${this._endpointOptions(step.endpoint)}</select></div>`
              : "";
          return `<div class="flow-step${onPlatform ? "" : " flow-step-off"}" data-step="${this._esc(step.id)}" data-protocol="${platform === "chopin" || FlowIR._chopinOnly(step) ? "soap" : platform === "both" ? "both" : "rest"}">
          <div class="flow-row">
            <select data-sfield="type" aria-label="Step type">${typeOpts}</select>
            <select data-sfield="from" aria-label="From">${fromOpts}</select>
            <select data-sfield="to" aria-label="To">${toOpts}</select>
            <button type="button" data-sremove>Remove</button>
          </div>
          ${endpoint}
          <div class="flow-row">
            <input data-sfield="label" value="${this._esc(step.label || "")}" placeholder="Label">
            <input data-sfield="status" value="${step.status || ""}" placeholder="${platform === "chopin" ? "Fault code" : "Status"}" inputmode="numeric">
          </div>
          ${off}
          ${hop}
          ${this._fieldsEditor(step)}
        </div>`;
        })
        .join("");
  },

  _fieldsEditor(step) {
    if (step.type === "process" || step.type === "condition") return "";
    const catalog = FlowIR.catalogForStep(this.model, step);
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

  _fieldOptions(catalog, field, custom) {
    const key = FlowIR.fieldKey(field);
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
        parts.push(`<option value="${this._esc(itemKey)}"${!custom && itemKey === key ? " selected" : ""}>${this._esc(label)}</option>`);
      });
      parts.push("</optgroup>");
    });
    parts.push(`<option value="__custom__"${custom ? " selected" : ""}>Other…</option>`);
    return parts.join("");
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
    if (add) add.textContent = platform === "chopin" ? "Add SOAP step" : platform === "both" ? "Add step" : "Add REST step";
    this._renderEndpointPicker();
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
    if (field === "type") actor.type = event.target.value;
    if (field === "logo") {
      const logo = FlowIR.safeLogo(event.target.value);
      if (logo) actor.logo = logo;
      else delete actor.logo;
    }
    this._afterStructure();
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
    if (field === "type") step.type = value;
    if (field === "from") {
      if (step.type === "process" || step.type === "condition") step.actor = value;
      else step.from = value;
    }
    if (field === "to") step.to = value;
    if (field === "label") step.label = value;
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
    if (event.target.dataset.ffield) {
      const rebuilt = this._onApiField(step, event.target);
      if (rebuilt || field === "hasDarwin" || field === "hasChopin") this._renderSteps();
      this._afterStructure();
      return;
    }
    if (field === "hasDarwin" || field === "hasChopin") this._renderSteps();
    this._afterStructure();
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
      const hit = FlowIR.catalogForStep(this.model, step).find((item) => FlowIR.fieldKey(item) === value);
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

  _onStepClick(event) {
    const card = event.target.closest("[data-step]");
    const step = this.model.steps.find((item) => item.id === card?.dataset.step);
    if (event.target.closest("[data-add-field]") && step) {
      step.fields = step.fields || [];
      const unused = FlowIR.catalogForStep(this.model, step).find((item) => !step.fields.some((field) => FlowIR.fieldKey(field) === FlowIR.fieldKey(item)));
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
    if (!event.target.closest("[data-sremove]")) return;
    const id = card?.dataset.step;
    this.model.steps = this.model.steps.filter((item) => item.id !== id);
    this._renderSteps();
    this._afterStructure();
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
    const ids = new Set(this.model.steps.map((step) => step.id));
    ["darwin", "chopin"].forEach((key) => {
      const impl = this.model.implementations[key] || { protocol: key === "chopin" ? "SOAP" : "REST" };
      const existing = Array.isArray(impl.steps) ? impl.steps.filter((id) => ids.has(id)) : [];
      this.model.steps.forEach((step) => {
        if (existing.includes(step.id)) return;
        if (!step.platforms || step.platforms.includes(key)) existing.push(step.id);
      });
      this.model.implementations[key] = { protocol: impl.protocol || (key === "chopin" ? "SOAP" : "REST"), steps: existing };
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
  },

  _readWsdl() {
    const text = document.getElementById("flow-wsdl").value.trim();
    if (!text) {
      if (this.wsdlOps?.operations?.length) {
        this._applyWsdlList(this.wsdlOps);
        return;
      }
      this._errors(["Paste or upload a Chopin WSDL first"]);
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

  _readWsdlFiles(event) {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    if (!files.length) return;
    Promise.all(
      files.map((file) =>
        file.text().then((text) => {
          const listed = FlowParse.listWsdl(text);
          listed.file = file.name;
          if (!listed.ok) listed.errors = (listed.errors || []).map((err) => `${file.name}: ${err}`);
          return listed;
        })
      )
    )
      .then((results) => this._applyWsdlList(FlowParse.mergeListed([this.wsdlOps, ...results])))
      .catch((err) => this._errors([`Could not read WSDL files: ${err.message}`]));
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
