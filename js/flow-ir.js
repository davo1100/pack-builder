const FlowIR = {
  METHODS: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  ACTOR_TYPES: ["client", "internal", "external", "platform", "process"],
  STEP_TYPES: ["request", "response", "process", "condition"],
  CONDITION_KINDS: ["business", "http", "capability", "routing"],
  PROCESS_MARKS: ["", "ok", "current", "pending"],
  BRANCH_SCHEMES: ["proceed", "stop", "pending"],
  BRANCH_SCHEME_LABELS: {
    proceed: "Proceed",
    stop: "Stop",
    pending: "Pending",
  },
  CONDITION_KIND_LABELS: {
    business: "Business",
    http: "HTTP",
    capability: "Capability",
    routing: "Routing",
  },
  AUDIENCES: ["developer", "ops", "process"],
  VIEWERS: [
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
  DEFAULT_ACTOR_ROLES: {
    client: "YOUR INTEGRATION",
    platform: "PLATFORM API",
    internal: "INTERNAL API",
    process: "CORPORATE CUSTOMER",
    external: "EXTERNAL PARTY",
  },

  defaultActorRole(type) {
    return this.DEFAULT_ACTOR_ROLES[type] || String(type || "").toUpperCase();
  },

  actorRole(actor) {
    const custom = String(actor?.role || actor?.subtitle || "").trim();
    return custom || this.defaultActorRole(actor?.type);
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
        summary: "",
        outcome: "",
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
      summary: String(pres.summary || next.summary || ""),
      outcome: String(pres.outcome || ""),
      outcomeDetail: String(pres.outcomeDetail || ""),
      tags: Array.isArray(pres.tags) ? pres.tags.map(String).filter(Boolean).slice(0, 8) : [],
      nextSteps: Array.isArray(pres.nextSteps)
        ? pres.nextSteps
            .slice(0, 4)
            .map((item) => {
              if (typeof item === "string") return { title: item, detail: "" };
              return { title: String(item?.title || ""), detail: String(item?.detail || item?.description || "") };
            })
            .filter((item) => item.title)
        : [],
    };
    const actorColors = this._normalizeActorColors(pres.actorColors);
    if (actorColors) next.presentation.actorColors = actorColors;
    next.actors = next.actors.map((actor, index) => {
      const nextActor = {
        id: String(actor?.id || this.uid("a")),
        name: String(actor?.name || `Actor ${index + 1}`),
        type: this.ACTOR_TYPES.includes(actor?.type) ? actor.type : "internal",
      };
      const role = String(actor?.role || actor?.subtitle || "").trim();
      if (role) nextActor.role = role;
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
    if (type === "process") {
      if (step?.subtitle) out.subtitle = String(step.subtitle);
      if (this.PROCESS_MARKS.includes(step?.mark)) out.mark = step.mark;
    }
    if (type === "condition") {
      out.kind = this.CONDITION_KINDS.includes(step?.kind) ? step.kind : "business";
      const heading = String(step?.heading || step?.badge || "").trim();
      if (heading) out.heading = heading;
      if (step?.ref) out.ref = String(step.ref);
      const raw = Array.isArray(step?.branches) ? step.branches : Array.isArray(step?.outcomes) ? step.outcomes : this.defaultBranches();
      out.branches = raw.map((branch, i) => this._normalizeBranch(branch, i));
      if (!out.branches.length) out.branches = this.defaultBranches();
    }
    if (!out.label) out.label = out.path || out.operation || (type === "condition" ? "Decide?" : `Step ${index + 1}`);
    return out;
  },

  defaultBranches() {
    return [
      { id: this.uid("b"), label: "Yes", when: "true", target: "", detail: "", ends: false, scheme: "proceed" },
      { id: this.uid("b"), label: "No", when: "false", target: "", detail: "", ends: true, scheme: "stop" },
    ];
  },

  _normalizeBranch(branch, index) {
    const fallback = index === 0 ? "Yes" : index === 1 ? "No" : `Path ${index + 1}`;
    const next = {
      id: String(branch?.id || this.uid("b")),
      label: String(branch?.label || branch?.condition || fallback).trim() || fallback,
      target: branch?.target ? String(branch.target) : "",
      when: branch?.when != null && branch.when !== "" ? String(branch.when) : "",
      scheme: this.branchScheme(branch, index),
    };
    const detail = String(branch?.detail || branch?.action || branch?.description || "").trim();
    if (detail) next.detail = detail;
    const method = String(branch?.method || "").trim().toUpperCase();
    if (method && (this.METHODS.includes(method) || method === "SOAP")) next.method = method;
    const path = String(branch?.path || branch?.operation || "").trim();
    if (path) next.path = path;
    if (branch?.status != null && branch.status !== "") {
      const status = Number(branch.status);
      next.status = Number.isFinite(status) ? status : String(branch.status);
    }
    if (branch?.ends === true || branch?.ends === "true" || branch?.end === true) next.ends = true;
    const footer = String(branch?.footer || branch?.continueText || branch?.endsText || "").trim();
    if (footer) next.footer = footer;
    return next;
  },

  branchTone(branch, index) {
    const scheme = this.branchScheme(branch, index);
    if (scheme === "proceed") return "yes";
    if (scheme === "stop") return "no";
    if (scheme === "pending") return "pending";
    const label = String(branch?.label || "").trim().toLowerCase();
    if (/^(yes|y|true|ok|success|pass|continue)/i.test(label)) return "yes";
    if (/^(no|n|false|fail|error|end|stop|rollback)/i.test(label)) return "no";
    return index === 0 ? "yes" : index === 1 ? "no" : index % 2 === 0 ? "yes" : "no";
  },

  branchScheme(branch, index) {
    const explicit = String(branch?.scheme || branch?.style || "").trim().toLowerCase();
    if (explicit === "yes" || explicit === "ok" || explicit === "success" || explicit === "continue") return "proceed";
    if (explicit === "no" || explicit === "fail" || explicit === "error" || explicit === "end") return "stop";
    if (this.BRANCH_SCHEMES.includes(explicit)) return explicit;
    const label = String(branch?.label || "").trim().toLowerCase();
    if (/^(pending|wait|hold|later|defer)/i.test(label)) return "pending";
    if (/^(yes|y|true|ok|success|pass|continue|proceed)/i.test(label)) return "proceed";
    if (/^(no|n|false|fail|error|end|stop|rollback)/i.test(label)) return "stop";
    if (index === 0) return "proceed";
    if (index === 1) return "stop";
    return "pending";
  },

  branchSchemeLabel(scheme) {
    return this.BRANCH_SCHEME_LABELS[scheme] || this.BRANCH_SCHEME_LABELS.proceed;
  },

  conditionKindLabel(kind) {
    return this.CONDITION_KIND_LABELS[kind] || this.CONDITION_KIND_LABELS.business;
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
    next.presentation.showFields = key === "developer" && next.presentation.showFields !== false;
    if (key === "process") next.presentation.layout = "sequence";
    return next;
  },

  present(model, options) {
    let src = model;
    if (!options?.trusted) {
      const checked = this.validate(model);
      if (!checked.ok) return { ok: false, errors: checked.errors, view: null };
      src = checked.model;
    } else if (!src || typeof src !== "object") {
      return { ok: false, errors: ["No flow to draw"], view: null };
    }
    const pres = { ...src.presentation, audience: this.audienceOf(src.presentation.audience) };
    const hidden = new Set(pres.hidden);
    if (pres.audience === "process") {
      this.CUSTOMER_HIDE.forEach((id) => {
        if (src.actors.some((actor) => actor.id === id) || src.steps.some((step) => step.id === id)) hidden.add(id);
      });
    }
    const platform = pres.platform;
    const actors = src.actors.filter((actor) => !hidden.has(actor.id));
    const visibleIds = new Set(actors.map((actor) => actor.id));
    const steps = (src.steps || [])
      .filter((step) => {
        if (hidden.has(step.id) || !this.stepOnPlatform(step, platform, src.implementations)) return false;
        if (step.type === "condition") {
          const actor = step.actor || step.from;
          return !actor || visibleIds.has(actor);
        }
        if (step.type === "process" && !this.isProcessHop(step)) {
          const actor = step.actor || step.from;
          return !actor || visibleIds.has(actor);
        }
        const fromOk = !step.from || visibleIds.has(step.from);
        const toOk = !step.to || visibleIds.has(step.to);
        return fromOk || toOk;
      })
      .map((step) => this._presentStep(step, pres, src, visibleIds));
    const numbers = Object.create(null);
    steps.forEach((step, index) => {
      numbers[step.id] = index + 1;
      step.number = index + 1;
    });
    steps.forEach((step) => {
      if (step.type !== "condition") return;
      if (step.ref && numbers[step.ref]) {
        step.refNum = numbers[step.ref];
        const linked = steps.find((item) => item.id === step.ref) || (src.steps || []).find((item) => item.id === step.ref);
        step.refLabel = linked ? this._plainAction(linked) || linked.label || "" : "";
      }
      (step.branches || []).forEach((branch) => {
        if (branch.target && numbers[branch.target] != null) branch.targetNum = numbers[branch.target];
      });
    });
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
        numbers,
      },
    };
  },

  isProcessHop(step) {
    return step?.type === "process" && Boolean(step.from && step.to && step.from !== step.to);
  },

  stepOnPlatform(step, platform, implementations) {
    if (!step) return false;
    if (platform === "both") return true;
    if (Array.isArray(step.platforms) && step.platforms.length) return step.platforms.includes(platform);
    const listed = implementations?.[platform]?.steps;
    if (Array.isArray(listed) && listed.length) return listed.includes(step.id);
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

  _presentStep(step, pres, src, visibleIds) {
    const next = { ...step };
    const standIn = visibleIds instanceof Set && visibleIds.size ? [...visibleIds][0] : "";
    const pick = (id) => (id && visibleIds?.has?.(id) ? id : standIn || id);
    if (next.actor) next.actor = pick(next.actor);
    if (next.from) next.from = pick(next.from);
    if (next.to) next.to = pick(next.to);
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
      next.fieldRows = pres.audience === "developer" && pres.showFields !== false ? this.fieldRows(step.fields) : [];
      next.fieldChips = this.fieldChips(step.fields, "developer");
    }
    if (step.type === "process") {
      next.subtitle = pres.audience === "process" ? "" : step.subtitle || "";
      next.mark = step.mark || "";
    }
    if (step.type === "condition") {
      next.kind = this.CONDITION_KINDS.includes(step.kind) ? step.kind : "business";
      next.kindLabel = pres.audience === "process" ? "" : this.conditionKindLabel(next.kind);
      next.heading = String(step.heading || "").trim() || "Decision";
      if (step.ref) next.ref = String(step.ref);
      next.branches = this._presentBranches(step, src);
    }
    if (next.unsupported && pres.audience !== "process") next.caption = `${next.caption || "Step"} — Unsupported`;
    return next;
  },

  _presentBranches(step, src) {
    const raw = Array.isArray(step.branches) ? step.branches : this.defaultBranches();
    return raw.map((branch, index) => {
      const next = this._normalizeBranch(branch, index);
      const target = src.steps.find((item) => item.id === next.target);
      next.targetLabel = target ? this._plainAction(target) || target.label : "";
      next.scheme = this.branchScheme(next, index);
      next.tone = this.branchTone(next, index);
      if (next.footer) next.footer = String(next.footer).trim();
      if (!next.detail && next.targetLabel) next.detail = next.targetLabel;
      return next;
    });
  },

  stepNumbers(model) {
    const presented = this.present(model);
    return presented.ok ? presented.view.numbers || {} : {};
  },

  defaultBranchFooter(branch) {
    if (branch?.ends) return "Flow ends here";
    if (branch?.targetNum) return `Continues to step ${branch.targetNum}`;
    return "Continues below";
  },

  fieldRows(fields) {
    if (!Array.isArray(fields) || !fields.length) return [];
    return fields
      .filter((field) => field?.name)
      .slice(0, 10)
      .map((field) => ({
        name: String(field.name),
        type: field.type ? String(field.type) : "",
        example: field.example ? this._shortExample(field.example) : "",
        required: field.required !== false && field.required !== "false",
      }));
  },

  fieldChips(fields, audience) {
    const view = this.audienceOf(audience);
    if (view === "process" || view === "ops") return [];
    return this.fieldRows(fields).map((row) => {
      const star = row.required ? "*" : "";
      const type = row.type ? `:${row.type}` : "";
      const example = row.example ? ` = ${row.example}` : "";
      return `${row.name}${star}${type}${example}`;
    });
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
    if (step.method && step.path) return step.path;
    if (step.method) return step.method;
    if (step.path) return step.path;
    if (step.operation) return step.operation;
    return step.label || step.type;
  },

  _processCaption(step, src) {
    const actors = src?.actors || [];
    const from = actors.find((actor) => actor.id === step.from)?.name || actors.find((actor) => actor.id === step.actor)?.name || "Requester";
    const to = actors.find((actor) => actor.id === step.to)?.name || "Receiver";
    const action = this._plainAction(step, src);
    if (step.type === "process") return this.isProcessHop(step) ? `${from} → ${to}: ${action}` : action;
    if (step.type === "condition") return /[?？]$/.test(action) ? action : `${action}?`;
    return `${from} → ${to}: ${action}`;
  },

  _plainAction(step, src) {
    if (step?.type === "process") {
      const own = String(step.label || "").trim();
      if (own) return own;
    }
    const named = this._actionFromContract(step, src);
    if (named) return named;
    let label = String(step.label || "").trim();
    label = label.replace(/\b(GET|POST|PUT|PATCH|DELETE|SOAP|REST|API|HTTP)\b/gi, "");
    label = label.replace(/\/[A-Za-z0-9._~-]+/g, "");
    label = label.replace(/\b[1-5]\d{2}\b/g, "");
    label = label.replace(/\s{2,}/g, " ").replace(/^[-:.\s]+|[-:.\s]+$/g, "").trim();
    if (label) return label;
    if (step.type === "response") return Number(step.status) >= 400 ? "reports a problem" : "confirms creation";
    if (step.type === "condition") return "Decide";
    if (step.type === "process") return "handles the work";
    return step.operation ? String(step.operation).replace(/([a-z])([A-Z])/g, "$1 $2") : "continues the process";
  },

  _actionFromContract(step, src) {
    let hay = `${step.label || ""} ${step.path || ""} ${step.operation || ""}`;
    if (step.type === "response" && src?.steps) {
      const index = src.steps.findIndex((item) => item.id === step.id);
      const prev = [...src.steps.slice(0, Math.max(0, index))].reverse().find((item) => item.type === "request");
      if (prev) hay = `${hay} ${prev.path || ""} ${prev.label || ""}`;
    }
    if (/accountholders/i.test(hay)) return step.type === "response" ? "account holder created" : "create account holder";
    if (/\/cards\b|card_profile/i.test(hay)) return step.type === "response" ? "card created" : "issue card";
    if (/\/accounts\b/i.test(hay)) return step.type === "response" ? "account created" : "create account";
    return "";
  },

  _shortExample(value) {
    const text = String(value || "").trim();
    if (/^<[^>]+>/.test(text) && text.length <= 56) return text;
    return text.length > 42 ? `${text.slice(0, 39)}…` : text;
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
