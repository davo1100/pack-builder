const FlowIR = {
  METHODS: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  ACTOR_TYPES: ["client", "internal", "external", "platform", "process"],
  STEP_TYPES: ["request", "response", "process", "condition"],
  AUDIENCES: ["developer", "ops", "process"],
  VIEWERS: [
    { key: "process", label: "Business process" },
    { key: "ops", label: "Ops" },
    { key: "developer", label: "Developer" },
  ],
  LAYOUTS: ["sequence", "architecture"],
  PLATFORMS: ["darwin", "chopin", "both"],
  FIELD_INS: ["path", "query", "header", "body", "soap", "response"],
  DEFAULT_ACTOR_COLORS: {
    client: "#201D22",
    internal: "#7E6DE2",
    external: "#FD0966",
    platform: "#404C37",
    process: "#404C37",
  },
  CUSTOMER_HIDE: ["jwt", "rbac", "gateway", "tenant", "adapter", "cloudflare", "traefik", "tenantResolver", "capabilityEngine", "internalAdapter"],
  CUSTOMER_NAMES: {
    client: "Your application",
    api: "Our API",
    darwin: "Card platform",
    chopin: "Card platform",
    platform: "Card platform",
  },

  uid(prefix) {
    return (prefix || "f") + Math.random().toString(36).slice(2, 8);
  },

  empty() {
    return {
      id: this.uid("flow"),
      title: "API flow",
      actors: [],
      steps: [],
      endpoints: [],
      implementations: {},
      presentation: {
        audience: "developer",
        layout: "sequence",
        platform: "darwin",
        hidden: [],
        showFields: true,
      },
    };
  },

  clone(model) {
    return JSON.parse(JSON.stringify(model || this.empty()));
  },

  normalizeColor(value, fallback) {
    const hex = String(value || "").trim();
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.slice(1).toUpperCase()}`;
    if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
      const [r, g, b] = hex.slice(1);
      return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
    }
    return fallback || "";
  },

  _normalizeActorColors(raw) {
    if (!raw || typeof raw !== "object") return undefined;
    const out = {};
    this.ACTOR_TYPES.forEach((type) => {
      const hex = this.normalizeColor(raw[type], "");
      if (hex) out[type] = hex;
    });
    return Object.keys(out).length ? out : undefined;
  },

  actorColor(model, type) {
    const key = this.ACTOR_TYPES.includes(type) ? type : "internal";
    const custom = model?.presentation?.actorColors?.[key];
    return this.normalizeColor(custom, this.DEFAULT_ACTOR_COLORS[key] || this.DEFAULT_ACTOR_COLORS.internal);
  },

  actorPalette(model, type) {
    const hex = this.actorColor(model, type);
    if (typeof paletteFor === "function") return paletteFor(hex);
    return { fill: hex, title: "#FFFFFF", sub: "#F2EEE2" };
  },

  safeLogo(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    if (/^https?:\/\//i.test(text)) return text;
    if (/^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,/i.test(text)) return text;
    if (/^\/[\w./-]+$/i.test(text)) return text;
    return "";
  },

  redact(text) {
    let value = String(text ?? "");
    value = value.replace(/Bearer\s+[A-Za-z0-9._\-+=/]+/gi, "Bearer <token>");
    value = value.replace(/(Authorization\s*:\s*)\S+/gi, "$1<redacted>");
    value = value.replace(/\b(?:api[_-]?key|secret|password|passwd)\s*[:=]\s*\S+/gi, (m) => m.replace(/\S+$/, "<redacted>"));
    value = value.replace(/\b(?:\d[ -]*?){13,19}\b/g, "<pan>");
    value = value.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "<ip>");
    return value;
  },

  redactModel(model) {
    const next = this.clone(model);
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      Object.keys(node).forEach((key) => {
        if (key === "logo" && typeof node[key] === "string") return;
        if (typeof node[key] === "string") node[key] = this.redact(node[key]);
        else walk(node[key]);
      });
    };
    walk(next);
    return next;
  },

  normalize(model) {
    const next = this.redactModel(model && typeof model === "object" ? model : this.empty());
    next.id = String(next.id || this.uid("flow"));
    next.title = String(next.title || "API flow");
    next.actors = Array.isArray(next.actors) ? next.actors : [];
    next.steps = Array.isArray(next.steps) ? next.steps : [];
    next.implementations = next.implementations && typeof next.implementations === "object" ? next.implementations : {};
    const pres = next.presentation && typeof next.presentation === "object" ? next.presentation : {};
    next.presentation = {
      audience: this.audienceOf(pres.audience),
      layout: this.LAYOUTS.includes(pres.layout) ? pres.layout : "sequence",
      platform: this.PLATFORMS.includes(pres.platform) ? pres.platform : "darwin",
      hidden: Array.isArray(pres.hidden) ? pres.hidden.map(String) : [],
      showFields: pres.showFields !== false,
    };
    const actorColors = this._normalizeActorColors(pres.actorColors);
    if (actorColors) next.presentation.actorColors = actorColors;
    next.actors = next.actors.map((actor, index) => {
      const nextActor = {
        id: String(actor?.id || this.uid("a")),
        name: String(actor?.name || `Actor ${index + 1}`),
        type: this.ACTOR_TYPES.includes(actor?.type) ? actor.type : "internal",
      };
      const logo = this.safeLogo(actor?.logo);
      if (logo) nextActor.logo = logo;
      return nextActor;
    });
    next.steps = next.steps.map((step, index) => this._normalizeStep(step, index));
    next.endpoints = Array.isArray(next.endpoints) ? next.endpoints.map((item) => this._normalizeEndpoint(item)) : [];
    next.fieldCatalog = this.mergeCatalog(next.fieldCatalog, next.steps);
    ["darwin", "chopin"].forEach((key) => {
      const impl = next.implementations[key];
      if (!impl || typeof impl !== "object") return;
      next.implementations[key] = {
        protocol: key === "chopin" ? "SOAP" : "REST",
        steps: Array.isArray(impl.steps) ? impl.steps.map(String) : undefined,
      };
    });
    return next;
  },

  _normalizeStep(step, index) {
    const type = this.STEP_TYPES.includes(step?.type) ? step.type : "process";
    const out = {
      id: String(step?.id || this.uid("s")),
      type,
      label: step?.label != null ? String(step.label) : "",
    };
    if (step?.from) out.from = String(step.from);
    if (step?.to) out.to = String(step.to);
    if (step?.actor) out.actor = String(step.actor);
    if (step?.method) out.method = String(step.method).toUpperCase();
    if (step?.path) out.path = String(step.path);
    if (step?.operation) out.operation = String(step.operation);
    if (step?.status != null && step.status !== "") out.status = Number(step.status);
    if (Array.isArray(step?.platforms)) out.platforms = step.platforms.map(String);
    if (step?.darwin && typeof step.darwin === "object") {
      out.darwin = {
        method: step.darwin.method ? String(step.darwin.method).toUpperCase() : undefined,
        path: step.darwin.path != null ? String(step.darwin.path) : undefined,
        supported: step.darwin.supported !== false,
      };
    }
    if (step?.chopin && typeof step.chopin === "object") {
      out.chopin = {
        operation: step.chopin.operation != null ? String(step.chopin.operation) : undefined,
        namespace: step.chopin.namespace != null ? String(step.chopin.namespace) : undefined,
        supported: step.chopin.supported !== false,
      };
    }
    if (Array.isArray(step?.fields)) {
      out.fields = step.fields.map((field) => this._normalizeField(field));
    }
    if (step?.endpoint) out.endpoint = String(step.endpoint);
    if (!out.label) out.label = out.path || out.operation || `Step ${index + 1}`;
    return out;
  },

  _normalizeEndpoint(item) {
    const fields = (list) => (Array.isArray(list) ? list.map((field) => this._normalizeField(field)) : []);
    return {
      key: String(item?.key || `${item?.method || item?.operation || ""} ${item?.path || item?.operation || ""}`.trim()),
      method: String(item?.method || "").toUpperCase(),
      path: String(item?.path || ""),
      protocol: item?.protocol === "SOAP" || String(item?.method || "").toUpperCase() === "SOAP" ? "SOAP" : "REST",
      operation: String(item?.operation || item?.operationId || ""),
      namespace: String(item?.namespace || ""),
      soapAction: String(item?.soapAction || ""),
      summary: String(item?.summary || ""),
      operationId: String(item?.operationId || ""),
      tags: Array.isArray(item?.tags) ? item.tags.map(String) : [],
      source: String(item?.source || ""),
      okCode: item?.okCode != null ? String(item.okCode) : "",
      errCode: item?.errCode != null ? String(item.errCode) : "",
      serverCode: item?.serverCode != null ? String(item.serverCode) : "",
      okLabel: String(item?.okLabel || item?.okCode || ""),
      errLabel: String(item?.errLabel || ""),
      serverLabel: String(item?.serverLabel || ""),
      requestFields: fields(item?.requestFields),
      responseFields: fields(item?.responseFields),
      okFields: fields(item?.okFields),
      errFields: fields(item?.errFields),
      serverFields: fields(item?.serverFields),
    };
  },

  _normalizeField(field) {
    const location = this.FIELD_INS.includes(field?.in) ? field.in : "body";
    const next = {
      name: String(field?.name || "").trim(),
      in: location,
      required: field?.required !== false && field?.required !== "false",
      type: field?.type != null ? String(field.type) : "",
    };
    const example = field?.example != null ? String(field.example).trim() : "";
    if (example) next.example = example;
    if (field?.side === "request" || field?.side === "response") next.side = field.side;
    return next;
  },

  fieldKey(field) {
    return `${field?.in || "body"}::${field?.name || ""}`;
  },

  mergeCatalog(existing, steps) {
    const out = [];
    const seen = new Set();
    const add = (field) => {
      const next = this._normalizeField(field);
      if (!next.name) return;
      const key = this.fieldKey(next);
      if (seen.has(key)) {
        const existing = out.find((item) => this.fieldKey(item) === key);
        if (existing && !existing.example && next.example) existing.example = next.example;
        return;
      }
      seen.add(key);
      out.push(next);
    };
    (Array.isArray(existing) ? existing : []).forEach(add);
    (Array.isArray(steps) ? steps : []).forEach((step) => (step.fields || []).forEach(add));
    return out;
  },

  endpointFor(model, step) {
    const key = step?.endpoint;
    if (!key || !Array.isArray(model?.endpoints)) return null;
    return model.endpoints.find((item) => item.key === key) || null;
  },

  catalogForStep(model, step) {
    const endpoint = this.endpointFor(model, step);
    const fromEndpoint = endpoint
      ? step?.type === "response"
        ? [...(endpoint.responseFields || []), ...(endpoint.okFields || []), ...(endpoint.errFields || []), ...(endpoint.serverFields || [])]
        : endpoint.requestFields
      : null;
    const catalog = this.mergeCatalog(fromEndpoint && fromEndpoint.length ? fromEndpoint : model?.fieldCatalog, fromEndpoint && fromEndpoint.length ? [] : model?.steps);
    const platform = model?.presentation?.platform || "darwin";
    const allowed = new Set(step?.type === "response" ? ["response", "header"] : ["path", "query", "header", "body"]);
    if (platform !== "darwin") allowed.add("soap");
    if (platform === "chopin") ["path", "query", "body"].forEach((item) => allowed.delete(item));
    return catalog.filter((field) => {
      if (!allowed.has(field.in)) return false;
      if (step?.type === "response" && field.side === "request") return false;
      if (step?.type === "request" && field.side === "response") return false;
      return true;
    });
  },

  validate(model) {
    const next = this.normalize(model);
    const errors = [];
    const ids = new Set();
    next.actors.forEach((actor) => {
      if (ids.has(actor.id)) errors.push(`Duplicate actor id “${actor.id}”`);
      ids.add(actor.id);
    });
    const stepIds = new Set();
    next.steps.forEach((step) => {
      if (stepIds.has(step.id)) errors.push(`Duplicate step id “${step.id}”`);
      stepIds.add(step.id);
      if ((step.type === "request" || step.type === "response") && (!step.from || !step.to)) {
        errors.push(`Step “${step.id}” needs from and to`);
      }
      if (step.from && !ids.has(step.from)) errors.push(`Step “${step.id}” from “${step.from}” is not an actor`);
      if (step.to && !ids.has(step.to)) errors.push(`Step “${step.id}” to “${step.to}” is not an actor`);
      if (step.actor && !ids.has(step.actor)) errors.push(`Step “${step.id}” actor “${step.actor}” is not an actor`);
      const chopinOnly = this._chopinOnly(step);
      if (step.method && !chopinOnly && !this.METHODS.includes(step.method)) errors.push(`Step “${step.id}” has an invalid method`);
      if (step.darwin?.method && !this.METHODS.includes(step.darwin.method)) {
        errors.push(`Step “${step.id}” Darwin method is invalid`);
      }
      if (step.type === "request" && chopinOnly && !(step.chopin?.operation || step.operation)) {
        errors.push(`Step “${step.id}” is Chopin SOAP and needs an operation`);
      }
      if (step.status != null && (Number.isNaN(step.status) || step.status < 100 || step.status > 599)) {
        errors.push(`Step “${step.id}” has an invalid HTTP status`);
      }
    });
    next.presentation.hidden.forEach((id) => {
      if (!ids.has(id) && !stepIds.has(id)) errors.push(`Hidden id “${id}” is not in this flow`);
    });
    ["darwin", "chopin"].forEach((key) => {
      const impl = next.implementations[key];
      impl?.steps?.forEach((id) => {
        if (!stepIds.has(id)) errors.push(`${key} implementation references missing step “${id}”`);
      });
    });
    return { ok: errors.length === 0, errors, model: next };
  },

  audienceOf(value) {
    const key = String(value || "developer");
    if (key === "customer") return "process";
    return this.AUDIENCES.includes(key) ? key : "developer";
  },

  forView(model, audience) {
    const next = this.normalize(model);
    const key = this.audienceOf(audience);
    next.presentation.audience = key;
    next.presentation.showFields = key === "developer";
    if (key === "process") next.presentation.layout = "sequence";
    return next;
  },

  present(model) {
    const checked = this.validate(model);
    if (!checked.ok) return { ok: false, errors: checked.errors, view: null };
    const src = checked.model;
    const pres = { ...src.presentation, audience: this.audienceOf(src.presentation.audience) };
    const hidden = new Set(pres.hidden);
    if (pres.audience === "process") {
      this.CUSTOMER_HIDE.forEach((id) => {
        if (src.actors.some((actor) => actor.id === id) || src.steps.some((step) => step.id === id)) hidden.add(id);
      });
      src.actors.forEach((actor) => {
        if (actor.type === "platform") hidden.add(actor.id);
      });
    }
    const platform = pres.platform;
    const steps = src.steps
      .filter((step) => !hidden.has(step.id) && !hidden.has(step.from) && !hidden.has(step.to) && this.stepOnPlatform(step, platform, src.implementations))
      .map((step) => this._presentStep(step, pres, src));
    const actors = src.actors.filter((actor) => !hidden.has(actor.id));
    return {
      ok: true,
      errors: [],
      view: {
        id: src.id,
        title: src.title,
        actors,
        steps,
        presentation: pres,
        source: src,
      },
    };
  },

  stepOnPlatform(step, platform, implementations) {
    if (!step) return false;
    if (platform === "both") return true;
    if (Array.isArray(step.platforms) && step.platforms.length) return step.platforms.includes(platform);
    if (implementations?.[platform]?.steps) return implementations[platform].steps.includes(step.id);
    return true;
  },

  protocolLabel(platform, audience) {
    const view = this.audienceOf(audience || "developer");
    if (view === "process") return "Business process";
    if (platform === "chopin") return "Chopin SOAP";
    if (platform === "both") return "Darwin REST + Chopin SOAP";
    return "Darwin REST";
  },

  _chopinOnly(step) {
    if (step?.darwin) return false;
    if (step?.platforms?.includes("darwin")) return false;
    return Boolean(step?.chopin || step?.platforms?.includes("chopin") || step?.operation);
  },

  _presentStep(step, pres, src) {
    const next = { ...step };
    const platform = pres.platform;
    if (platform === "darwin") {
      next.protocol = "REST";
      if (step.darwin) {
        if (step.darwin.supported === false) next.unsupported = true;
        if (step.darwin.method) next.method = step.darwin.method;
        if (step.darwin.path) next.path = step.darwin.path;
      }
    } else if (platform === "chopin") {
      next.protocol = "SOAP";
      if (step.chopin?.supported === false) next.unsupported = true;
      next.operation = step.chopin?.operation || step.operation || (step.type === "request" ? step.label : next.operation);
      next.namespace = step.chopin?.namespace || step.namespace;
      delete next.method;
      delete next.path;
    } else if (this._chopinOnly(step)) {
      next.protocol = "SOAP";
      next.operation = step.chopin?.operation || step.operation;
      if (step.chopin?.supported === false) next.unsupported = true;
    } else {
      next.protocol = src.implementations.darwin?.protocol || "REST";
    }
    if (pres.audience === "process") {
      next.caption = this._processCaption(step, src);
      next.fieldChips = [];
    } else {
      next.caption = this._developerCaption(next, platform);
      next.fieldChips = pres.audience === "developer" && pres.showFields !== false ? this.fieldChips(step.fields, "developer") : [];
    }
    if (next.unsupported && pres.audience !== "process") next.caption = `${next.caption || "Step"} — Unsupported`;
    return next;
  },

  fieldChips(fields, audience) {
    if (!Array.isArray(fields) || !fields.length) return [];
    const view = this.audienceOf(audience);
    return fields
      .filter((field) => field?.name)
      .slice(0, 8)
      .map((field) => {
        const star = field.required ? "*" : "";
        if (view === "process" || view === "ops") return "";
        const place = field.in && field.in !== "body" && field.in !== "response" && field.in !== "soap" ? `${field.in} ` : "";
        const type = field.type ? `:${field.type}` : "";
        const example = field.example ? ` = ${this._shortExample(field.example)}` : "";
        return `${place}${field.name}${star}${type}${example}`;
      })
      .filter(Boolean);
  },

  _developerCaption(step, platform) {
    if (step.unsupported) return step.label || "Unsupported";
    if (step.type === "process" || step.type === "condition") return step.label || step.type;
    if (platform === "chopin" || step.protocol === "SOAP") {
      if (step.type === "response") {
        const fault = step.status >= 400;
        const label = step.label && !/^soap\b/i.test(step.label) ? step.label : "";
        return fault ? ["SOAP Fault", label].filter(Boolean).join(" ") : ["SOAP", label || "response"].filter(Boolean).join(" ");
      }
      const operation = step.operation || step.label;
      return operation ? `SOAP ${operation}` : "SOAP";
    }
    if (step.type === "response") {
      const status = step.status ? String(step.status) : "";
      let label = step.label || "";
      if (status && label.startsWith(status)) label = label.slice(status.length).trim();
      return label;
    }
    if (step.method && step.path) return `${step.method} ${step.path}`;
    if (step.method) return step.method;
    if (step.path) return step.path;
    if (step.operation) return step.operation;
    return step.label || step.type;
  },

  _processCaption(step, src) {
    const actors = src?.actors || [];
    const from = actors.find((actor) => actor.id === step.from)?.name || actors.find((actor) => actor.id === step.actor)?.name || "Requester";
    const to = actors.find((actor) => actor.id === step.to)?.name || "Receiver";
    const action = this._plainAction(step);
    if (step.type === "process" || step.type === "condition") return `${from}: ${action}`;
    return `${from} → ${to}: ${action}`;
  },

  _plainAction(step) {
    let label = String(step.label || "").trim();
    label = label.replace(/\b(GET|POST|PUT|PATCH|DELETE|SOAP|REST|API|HTTP)\b/gi, "");
    label = label.replace(/\/[A-Za-z0-9._~-]+/g, "");
    label = label.replace(/\b[1-5]\d{2}\b/g, "");
    label = label.replace(/\s{2,}/g, " ").replace(/^[-:.\s]+|[-:.\s]+$/g, "").trim();
    if (label) return label;
    if (step.type === "response") return Number(step.status) >= 400 ? "reports a problem" : "confirms completion";
    if (step.type === "process" || step.type === "condition") return "handles the work";
    return step.operation ? String(step.operation).replace(/([a-z])([A-Z])/g, "$1 $2") : "continues the process";
  },

  _shortExample(value) {
    const text = String(value || "").trim();
    return text.length > 28 ? `${text.slice(0, 25)}…` : text;
  },

  makeCustomerReady(model) {
    const next = this.normalize(model);
    next.presentation.audience = "process";
    next.presentation.layout = "sequence";
    const hide = new Set(next.presentation.hidden);
    this.CUSTOMER_HIDE.forEach((id) => {
      if (next.actors.some((actor) => actor.id === id) || next.steps.some((step) => step.id === id)) hide.add(id);
    });
    next.presentation.hidden = [...hide];
    return next;
  },
};
