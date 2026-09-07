const FlowParse = {
  fromJson(text) {
    const redacted = FlowIR.redact(String(text || "").trim());
    if (!redacted) return { ok: false, errors: ["Paste a JSON flow first"], model: null };
    let parsed;
    try {
      parsed = JSON.parse(redacted);
    } catch (err) {
      return { ok: false, errors: [`JSON is invalid: ${err.message}`], model: null };
    }
    return FlowIR.validate(parsed);
  },

  listOpenApi(text) {
    const redacted = FlowIR.redact(String(text || "").trim());
    if (!redacted) return { ok: false, errors: ["Paste or upload an OpenAPI document first"], operations: [] };
    let spec;
    try {
      spec = redacted.startsWith("{") ? JSON.parse(redacted) : this._yamlToJson(redacted);
    } catch (err) {
      return { ok: false, errors: [`OpenAPI parse failed: ${err.message}`], operations: [] };
    }
    if (!spec || typeof spec !== "object" || !spec.paths || typeof spec.paths !== "object") {
      return { ok: false, errors: ["OpenAPI or Swagger needs a paths object"], operations: [] };
    }
    const operations = this._listOperations(spec);
    if (!operations.length) return { ok: false, errors: ["No HTTP operations found in paths"], operations: [] };
    return {
      ok: true,
      errors: [],
      title: spec.info?.title || "API",
      version: spec.info?.version || "",
      operations,
    };
  },

  fromOpenApi(text, options = {}) {
    return this.fromListed(this.listOpenApi(text), options);
  },

  fromListed(listed, options = {}) {
    if (!listed?.operations?.length) {
      return { ok: false, errors: listed?.errors?.length ? listed.errors : ["Read or upload a spec first"], model: null };
    }
    let selected = listed.operations;
    if (Array.isArray(options.keys) && options.keys.length) {
      const wanted = new Set(options.keys.map(String));
      selected = listed.operations.filter((item) => wanted.has(item.key));
    } else if (options.path || options.method) {
      const method = options.method ? String(options.method).toUpperCase() : "";
      selected = listed.operations.filter((item) => (!options.path || item.path === options.path) && (!method || item.method === method));
    } else if (options.keys) {
      selected = [];
    } else {
      selected = [listed.operations[0]];
    }
    if (!selected.length) return { ok: false, errors: ["Select at least one operation"], model: null };
    return this._modelFromOperations(listed, selected);
  },

  mergeListed(results) {
    const operations = [];
    const errors = [];
    (Array.isArray(results) ? results : []).forEach((listed) => {
      if (!listed) return;
      if (Array.isArray(listed.errors)) errors.push(...listed.errors);
      const ops = listed.operations || [];
      ops.forEach((op) => {
        const next = { ...op, source: listed.file || op.source || listed.title || "API" };
        const sig = `${next.source}::${next.method}::${next.path}`;
        if (operations.some((item) => `${item.source}::${item.method}::${item.path}` === sig)) return;
        next.key = this._uniqueOpKey(operations, next.key || `${next.method} ${next.path}`, next.source);
        operations.push(next);
      });
    });
    const sources = [...new Set(operations.map((item) => item.source).filter(Boolean))];
    if (!operations.length) {
      return { ok: false, errors: errors.length ? errors : ["No operations found in the uploaded files"], operations: [] };
    }
    return {
      ok: true,
      errors,
      title: sources.length === 1 ? sources[0] : `${sources.length} APIs`,
      version: "",
      sources,
      operations,
    };
  },

  _uniqueOpKey(operations, key, source) {
    if (!operations.some((item) => item.key === key)) return key;
    const tagged = source ? `${key} · ${source}` : key;
    if (!operations.some((item) => item.key === tagged)) return tagged;
    let n = 2;
    while (operations.some((item) => item.key === `${tagged} ${n}`)) n += 1;
    return `${tagged} ${n}`;
  },

  fromWsdl(text, options = {}) {
    return this.fromListed(this.listWsdl(text), options);
  },

  listWsdl(text) {
    const raw = String(text || "").replace(/^\uFEFF/, "").trim();
    if (!raw) return { ok: false, errors: ["Paste or upload a Chopin WSDL, XML, or SoapUI project first"], operations: [] };
    if (typeof DOMParser === "undefined") {
      return { ok: false, errors: ["WSDL import needs a browser"], operations: [] };
    }
    const embedded = this._embeddedWsdls(raw);
    if (embedded.length) {
      const merged = this.mergeListed(embedded.map((wsdl) => this._parseWsdlXml(wsdl)));
      if (merged.ok) {
        const name = this._soapUiProjectName(raw);
        if (name && !merged.title) merged.title = name;
        return merged;
      }
    }
    const parsed = this._parseWsdlXml(raw);
    if (parsed.ok) return parsed;
    const soapOps = this._listSoapUiOperations(raw);
    if (soapOps.length) {
      return {
        ok: true,
        errors: [],
        title: this._soapUiProjectName(raw) || "SoapUI",
        version: "",
        protocol: "SOAP",
        operations: soapOps,
      };
    }
    return parsed;
  },

  _parseWsdlXml(text) {
    const xml = String(text || "").replace(/^\uFEFF/, "").trim();
    if (!xml) return { ok: false, errors: ["That XML is empty"], operations: [] };
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const fault = doc.querySelector("parsererror");
    if (fault) return { ok: false, errors: ["That XML is invalid"], operations: [] };
    const root = this._wsdlRoot(doc);
    let operations = root ? this._listWsdlOperations(root) : [];
    if (!operations.length) operations = this._listSchemaOperations(doc.documentElement);
    if (!operations.length) {
      const imported = this._xmlKids(doc.documentElement, "import").length + (root ? this._xmlKids(root, "import").length : 0);
      return {
        ok: false,
        errors: [
          imported
            ? "This XML only imports other files. Upload the WSDL or XML that contains the operations, or paste those files too."
            : "No SOAP operations found in this WSDL or XML",
        ],
        operations: [],
      };
    }
    const titleNode = root || doc.documentElement;
    const service = this._xmlAll(titleNode, "service")[0];
    const title = this._xmlAttr(service, "name") || this._xmlAttr(titleNode, "name") || "Chopin";
    operations.forEach((item) => {
      item.source = item.source || title;
    });
    return {
      ok: true,
      errors: [],
      title,
      version: "",
      protocol: "SOAP",
      operations,
    };
  },

  _isSoapUiProject(text) {
    return /<(?:[\w.-]+:)?soapui-project\b/i.test(text) || /eviware\.com\/soapui/i.test(text);
  },

  _soapUiProjectName(text) {
    const match = String(text || "").match(/<(?:[\w.-]+:)?soapui-project\b[^>]*\bname="([^"]+)"/i);
    return match ? match[1] : "";
  },

  _embeddedWsdls(text) {
    const value = String(text || "");
    const found = [];
    const seen = new Set();
    const push = (wsdl) => {
      const clean = String(wsdl || "").trim();
      if (!clean || seen.has(clean)) return;
      seen.add(clean);
      found.push(clean);
    };
    const cdata = /<!\[CDATA\[\s*(<(?:[\w.-]+:)?(?:definitions|description)\b[\s\S]*?<\/(?:[\w.-]+:)?(?:definitions|description)>)\s*\]\]>/gi;
    let match;
    while ((match = cdata.exec(value))) push(match[1]);
    if (found.length) return found;
    if (this._isSoapUiProject(value) || /<(?:[\w.-]+:)?definitionCache\b/i.test(value)) {
      const defs = value.match(/<(?:[\w.-]+:)?(?:definitions|description)\b[\s\S]*?<\/(?:[\w.-]+:)?(?:definitions|description)>/gi) || [];
      defs.forEach(push);
    }
    return found;
  },

  _listSoapUiOperations(text) {
    if (!this._isSoapUiProject(text)) return [];
    const stripped = String(text || "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
    const names = [];
    const seen = new Set();
    const re = /<(?:[\w.-]+:)?operation\b[^>]*\bname="([^"]+)"/gi;
    let match;
    while ((match = re.exec(stripped))) {
      const name = String(match[1] || "").trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
    return names.map((name) => this._soapOperation({ name, summary: name }));
  },

  _wsdlRoot(doc) {
    const root = doc?.documentElement;
    if (!root) return null;
    const name = this._xmlLocal(root);
    if (["definitions", "description"].includes(name)) return root;
    return (
      this._xmlAll(root, "definitions")[0] ||
      this._xmlAll(root, "description")[0] ||
      (this._xmlAll(root, "portType").length || this._xmlAll(root, "interface").length ? root : null)
    );
  },

  _listOperations(spec) {
    const methods = FlowIR.METHODS.map((item) => item.toLowerCase());
    const operations = [];
    Object.keys(spec.paths).forEach((path) => {
      const item = spec.paths[path];
      if (!item || typeof item !== "object") return;
      methods.forEach((method) => {
        const operation = item[method];
        if (!operation || typeof operation !== "object") return;
        const responses = operation.responses && typeof operation.responses === "object" ? operation.responses : {};
        const codes = Object.keys(responses);
        const security = operation.security || spec.security;
        const cleanCode = (code) => String(code).replace(/['"]/g, "");
        const okKey = codes.find((code) => cleanCode(code) === "200") || codes.find((code) => /^2\d\d$/.test(cleanCode(code))) || "";
        const okCode = okKey ? cleanCode(okKey) : "200";
        const errCode = codes.find((code) => /^4\d\d$/.test(String(code).replace(/['"]/g, ""))) || "";
        const serverCode = codes.find((code) => /^5\d\d$/.test(String(code).replace(/['"]/g, ""))) || "";
        const requestFields = this._requestFields(spec, item, operation, path);
        const responseFields = Object.keys(responses).flatMap((code) => this._responseFields(spec, responses[code]));
        operations.push({
          key: `${method.toUpperCase()} ${path}`,
          path,
          method: method.toUpperCase(),
          summary: operation.summary || "",
          operationId: operation.operationId || "",
          source: spec.info?.title || "",
          tags: Array.isArray(operation.tags) ? operation.tags.map(String) : [],
          hasAuth: Array.isArray(security) && security.length > 0,
          authName: Array.isArray(security) && security.length ? this._securityName(spec, security) : "",
          okCode,
          okLabel: this._successMessage(okKey ? responses[okKey] : null, okCode),
          errCode,
          serverCode,
          responses,
          requestFields,
          responseFields: this._uniqueFields(responseFields),
          okFields: this._responseFields(spec, okKey ? responses[okKey] : null),
          errFields: this._responseFields(spec, responses[errCode]),
          serverFields: this._responseFields(spec, responses[serverCode]),
        });
      });
    });
    return operations;
  },

  _modelFromOperations(listed, selected) {
    const sources = [...new Set((selected.length ? selected : listed.operations || []).map((item) => item.source || listed.title).filter(Boolean))];
    const actors = [
      { id: "client", name: "Client", type: "client" },
      { id: "api", name: sources.length === 1 ? sources[0] : "API", type: "internal" },
    ];
    const steps = [];
    const auth = selected.find((item) => item.hasAuth);
    if (auth) {
      actors.splice(1, 0, { id: "auth", name: auth.authName || "Auth", type: "external" });
      steps.push({ id: "auth-check", type: "process", actor: "auth", label: "Authenticate" });
    }
    const used = new Set(steps.map((step) => step.id));
    selected.forEach((item, index) => {
      this._operationSteps(item, index, used).forEach((step) => steps.push(step));
    });
    const first = selected[0];
    const soap = selected.every((item) => this._isSoapOp(item));
    const title =
      selected.length === 1
        ? first.summary || first.operation || first.source || listed.title || first.key
        : sources.length === 1
          ? `${sources[0]} (${selected.length} operations)`
          : `API flow (${selected.length} operations)`;
    const stepIds = steps.map((step) => step.id);
    const catalogSource = listed.operations.length ? listed.operations : selected;
    const fieldCatalog = FlowIR.mergeCatalog(
      [],
      catalogSource.flatMap((item) => [{ fields: item.requestFields }, { fields: item.responseFields }])
    );
    if (soap && actors[1]) actors[1].name = sources[0] || listed.title || "Chopin";
    return FlowIR.validate({
      id: this._slug(selected.length === 1 ? first.operationId || first.operation || first.key : listed.title),
      title,
      actors,
      steps,
      endpoints: catalogSource.map((item) => this._slimEndpoint(item)),
      fieldCatalog,
      implementations: {
        darwin: { protocol: "REST", steps: soap ? [] : stepIds },
        chopin: { protocol: "SOAP", steps: soap ? stepIds : [] },
      },
      presentation: { audience: "developer", layout: "sequence", platform: soap ? "chopin" : "darwin", hidden: [] },
    });
  },

  _isSoapOp(item) {
    return item?.protocol === "SOAP" || String(item?.method || "").toUpperCase() === "SOAP";
  },

  _operationSteps(item, index, usedIds) {
    const used = usedIds || new Set();
    const soap = this._isSoapOp(item);
    let slug = this._slug(item.operationId || item.operation || `${item.method}-${item.path}`) || `op${index + 1}`;
    if (used.has(`req-${slug}`)) slug = `${slug}-${index + 1}`;
    used.add(`req-${slug}`);
    const slim = this._slimEndpoint(item);
    const label = item.summary || item.operation || item.operationId || item.key;
    if (soap) {
      return [
        {
          id: `req-${slug}`,
          from: "client",
          to: "api",
          type: "request",
          operation: slim.operation,
          label,
          endpoint: slim.key,
          platforms: ["chopin"],
          chopin: { operation: slim.operation, namespace: slim.namespace, supported: true },
          fields: this._hopFields(item.requestFields, 32),
        },
        {
          id: `ok-${slug}`,
          from: "api",
          to: "client",
          type: "response",
          label: slim.okLabel || "OK",
          endpoint: slim.key,
          platforms: ["chopin"],
          chopin: { operation: slim.operation, namespace: slim.namespace, supported: true },
          fields: this._hopFields(item.okFields?.length ? item.okFields : item.responseFields, 32),
        },
      ];
    }
    return [
      {
        id: `req-${slug}`,
        from: "client",
        to: "api",
        type: "request",
        method: item.method,
        path: item.path,
        label,
        endpoint: slim.key,
        platforms: ["darwin"],
        darwin: { method: item.method, path: item.path, supported: true },
        fields: this._hopFields(item.requestFields),
      },
      {
        id: `ok-${slug}`,
        from: "api",
        to: "client",
        type: "response",
        status: Number(String(slim.okCode || "200").replace(/['"]/g, "")),
        label: slim.okLabel || "OK",
        endpoint: slim.key,
        platforms: ["darwin"],
        fields: [],
      },
    ];
  },

  _slimEndpoint(item) {
    const soap = this._isSoapOp(item);
    return {
      key: item.key,
      method: soap ? "SOAP" : item.method,
      path: item.path || "",
      protocol: soap ? "SOAP" : "REST",
      operation: item.operation || item.operationId || "",
      namespace: item.namespace || "",
      soapAction: item.soapAction || "",
      summary: item.summary || "",
      operationId: item.operationId || item.operation || "",
      tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
      source: item.source || "",
      okCode: item.okCode || "",
      errCode: item.errCode || "",
      serverCode: item.serverCode || "",
      okLabel: item.okLabel || this._successMessage(item.responses?.[item.okCode], item.okCode || "200"),
      errLabel: item.errLabel || (item.errCode ? this._responseLabel(item.responses?.[item.errCode], item.errCode) : ""),
      serverLabel: item.serverLabel || (item.serverCode ? this._responseLabel(item.responses?.[item.serverCode], item.serverCode) : ""),
      requestFields: item.requestFields || [],
      responseFields: item.responseFields || [],
      okFields: item.okFields || [],
      errFields: item.errFields || [],
      serverFields: item.serverFields || [],
    };
  },

  _requestFields(spec, pathItem, operation, path) {
    const fields = [];
    const params = [...(Array.isArray(pathItem?.parameters) ? pathItem.parameters : []), ...(Array.isArray(operation?.parameters) ? operation.parameters : [])];
    params.forEach((raw) => {
      const param = this._resolveRef(spec, raw);
      if (!param?.name) return;
      if (param.in === "body") {
        fields.push(...this._flattenSchema(spec, param.schema, "body"));
        return;
      }
      const location = param.in === "formData" ? "body" : param.in === "cookie" ? "header" : ["path", "query", "header"].includes(param.in) ? param.in : "query";
      const schema = param.schema || param;
      fields.push(
        this._makeField(String(param.name), location, param.required === true || param.in === "path", schema, this._schemaExample(param, schema))
      );
    });
    String(path || "")
      .match(/\{([^}]+)\}/g)
      ?.forEach((token) => {
        fields.push({ name: token.slice(1, -1), in: "path", required: true, type: "string" });
      });
    fields.push(...this._schemaFields(spec, operation?.requestBody, "body"));
    return this._uniqueFields(fields).map((field) => ({ ...field, side: "request" }));
  },

  _responseFields(spec, response) {
    if (!response) return [];
    const resolved = this._resolveRef(spec, response);
    if (!resolved || typeof resolved !== "object") return [];
    const fields = this._schemaFields(spec, resolved, "response");
    const headers = resolved.headers && typeof resolved.headers === "object" ? resolved.headers : {};
    Object.keys(headers).forEach((name) => {
      const header = this._resolveRef(spec, headers[name]);
      fields.push(this._makeField(name, "header", header?.required === true, header?.schema || header, this._schemaExample(header, header?.schema)));
    });
    return this._uniqueFields(fields).map((field) => ({ ...field, side: "response" }));
  },

  _schemaFields(spec, node, location) {
    const resolved = this._resolveRef(spec, node);
    if (!resolved || typeof resolved !== "object") return [];
    if (resolved.content && typeof resolved.content === "object") {
      const names = Object.keys(resolved.content);
      const preferred = ["application/json", "application/xml", "text/xml", "application/x-www-form-urlencoded", "multipart/form-data"];
      const ordered = [...preferred.filter((type) => resolved.content[type]), ...names.filter((type) => !preferred.includes(type))];
      return this._uniqueFields(
        ordered.flatMap((type) => {
          const media = resolved.content[type];
          return this._flattenSchema(spec, media?.schema, location, "", false, 0, new Set(), this._schemaExample(media, resolved));
        })
      );
    }
    if (resolved.schema) return this._flattenSchema(spec, resolved.schema, location, "", false, 0, new Set(), this._schemaExample(resolved, resolved.schema));
    if (resolved.properties || resolved.items || resolved.allOf || resolved.oneOf || resolved.anyOf) {
      return this._flattenSchema(spec, resolved, location);
    }
    return [];
  },

  _flattenSchema(spec, schema, location, prefix = "", required = false, depth = 0, seen = new Set(), inheritedExample) {
    if (!schema || depth > 8) return [];
    const ref = typeof schema.$ref === "string" ? schema.$ref : "";
    if (ref) {
      if (seen.has(ref)) {
        const resolved = this._resolveRef(spec, schema);
        return prefix ? [this._makeField(prefix, location, required, resolved, this._schemaExample(schema, resolved) ?? inheritedExample)] : [];
      }
      seen = new Set(seen);
      seen.add(ref);
    }
    const s = this._resolveRef(spec, schema);
    if (!s || typeof s !== "object") return [];
    const example = this._schemaExample(schema, s) ?? inheritedExample;
    const out = [];
    const compose = [...(Array.isArray(s.allOf) ? s.allOf : []), ...(Array.isArray(s.oneOf) ? s.oneOf : []), ...(Array.isArray(s.anyOf) ? s.anyOf : [])];
    compose.forEach((part) => {
      out.push(...this._flattenSchema(spec, part, location, prefix, required, depth + 1, seen, example));
    });
    if (s.items && (s.type === "array" || !s.properties)) {
      if (prefix) out.push(this._makeField(prefix, location, required, { ...s, type: this._typeLabel(s) || "array" }, example));
      const itemPrefix = prefix ? `${prefix}[]` : "";
      const items = Array.isArray(s.items) ? s.items : [s.items];
      const itemExample = Array.isArray(example) ? example[0] : undefined;
      items.forEach((item) => {
        out.push(...this._flattenSchema(spec, item, location, itemPrefix, false, depth + 1, seen, itemExample));
      });
      return this._uniqueFields(out).slice(0, 400);
    }
    const props = s.properties && typeof s.properties === "object" ? s.properties : {};
    const requiredNames = new Set(Array.isArray(s.required) ? s.required.map(String) : []);
    if (!Object.keys(props).length) {
      if (prefix) out.push(this._makeField(prefix, location, required, s, example));
      else if ((s.type && s.type !== "object") || s.enum || s.format) {
        out.push(this._makeField(location === "response" ? "value" : "body", location, true, s, example));
      }
      return this._uniqueFields(out);
    }
    if (prefix) out.push(this._makeField(prefix, location, required, { ...s, type: this._typeLabel(s) || "object" }, example));
    Object.keys(props).forEach((key) => {
      const name = prefix ? `${prefix}.${key}` : key;
      const prop = props[key];
      const childRequired = requiredNames.has(key);
      const resolved = this._resolveRef(spec, prop);
      const childExample = this._pickNested(example, key);
      const nested =
        resolved &&
        (resolved.properties ||
          resolved.items ||
          resolved.allOf ||
          resolved.oneOf ||
          resolved.anyOf ||
          resolved.type === "object" ||
          resolved.type === "array");
      if (nested) out.push(...this._flattenSchema(spec, prop, location, name, childRequired, depth + 1, seen, childExample));
      else out.push(this._makeField(name, location, childRequired, resolved || prop, this._schemaExample(prop, resolved) ?? childExample));
    });
    return this._uniqueFields(out).slice(0, 400);
  },

  _makeField(name, location, required, schema, example) {
    const field = {
      name,
      in: location,
      required: Boolean(required),
      type: typeof schema === "string" ? schema : this._typeLabel(schema),
    };
    const text = this._stringifyExample(example);
    if (text) field.example = text;
    return field;
  },

  _schemaExample(...nodes) {
    for (const node of nodes) {
      const raw = this._rawExample(node);
      if (raw !== undefined) return raw;
    }
    return undefined;
  },

  _rawExample(node) {
    if (!node || typeof node !== "object") return undefined;
    if (Object.prototype.hasOwnProperty.call(node, "example")) return node.example;
    if (Object.prototype.hasOwnProperty.call(node, "x-example")) return node["x-example"];
    const examples = node.examples;
    if (Array.isArray(examples) && examples.length) return examples[0];
    if (examples && typeof examples === "object") {
      const first = Object.values(examples)[0];
      if (first && typeof first === "object") {
        if (Object.prototype.hasOwnProperty.call(first, "value")) return first.value;
        if (!("externalValue" in first) && !("summary" in first) && !("description" in first)) return first;
      } else if (first !== undefined) {
        return first;
      }
    }
    if (Object.prototype.hasOwnProperty.call(node, "default")) return node.default;
    return undefined;
  },

  _pickNested(parent, key) {
    if (parent == null) return undefined;
    if (Array.isArray(parent)) return this._pickNested(parent[0], key);
    if (typeof parent === "object" && Object.prototype.hasOwnProperty.call(parent, key)) return parent[key];
    return undefined;
  },

  _stringifyExample(value) {
    if (value === undefined) return "";
    if (value === null) return "null";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    try {
      const text = JSON.stringify(value);
      return text.length > 80 ? `${text.slice(0, 77)}…` : text;
    } catch {
      return "";
    }
  },

  _typeLabel(schema) {
    if (!schema || typeof schema !== "object") return "";
    if (Array.isArray(schema.enum) && schema.enum.length) return "enum";
    if (schema.format) return String(schema.format);
    if (Array.isArray(schema.type)) return schema.type.filter((item) => item && item !== "null").join("|") || "";
    if (schema.type) return String(schema.type);
    if (schema.properties) return "object";
    if (schema.items) return "array";
    return "";
  },

  _uniqueFields(fields) {
    const seen = new Map();
    const out = [];
    (Array.isArray(fields) ? fields : []).forEach((field) => {
      if (!field?.name) return;
      const key = `${field.in || "body"}::${field.name}`;
      if (seen.has(key)) {
        const existing = seen.get(key);
        if (!existing.example && field.example) existing.example = field.example;
        return;
      }
      seen.set(key, field);
      out.push(field);
    });
    return out;
  },

  _hopFields(fields, limit = 8) {
    const list = this._uniqueFields(fields);
    const isLeaf = (field) => field.type && !["object", "array", "element"].includes(field.type);
    const leaves = list.filter(isLeaf);
    const rest = list.filter((field) => !isLeaf(field));
    return [...leaves, ...rest].slice(0, Math.max(1, Number(limit) || 8));
  },

  _resolveRef(spec, node, depth = 0) {
    if (!node || typeof node !== "object" || depth > 6) return node;
    const ref = node.$ref;
    if (typeof ref !== "string" || !ref.startsWith("#/")) return node;
    const parts = ref
      .slice(2)
      .split("/")
      .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
    let cur = spec;
    for (const part of parts) {
      if (!cur || typeof cur !== "object") return node;
      cur = cur[part];
    }
    return this._resolveRef(spec, cur, depth + 1);
  },

  _securityName(spec, security) {
    const first = security.find((item) => item && typeof item === "object");
    const key = first ? Object.keys(first)[0] : "";
    const scheme = spec.components?.securitySchemes?.[key] || spec.securityDefinitions?.[key];
    return scheme?.name || key || scheme?.type || "Auth";
  },

  _responseLabel(response, code) {
    if (response && typeof response === "object" && response.description) return `${code} ${response.description}`;
    return code;
  },

  _successMessage(response, code) {
    const text = response && typeof response === "object" && response.description ? String(response.description).trim() : "";
    if (text) return text;
    const n = String(code || "200").replace(/['"]/g, "");
    if (n === "201") return "Created";
    if (n === "202") return "Accepted";
    if (n === "204") return "No Content";
    return "OK";
  },

  _listWsdlOperations(root) {
    const namespace = this._xmlAttr(root, "targetNamespace");
    const types = this._wsdlTypes(root);
    const messages = this._wsdlMessages(root);
    const actions = this._wsdlSoapActions(root);
    const operations = [];
    const addOp = (name, inputRef, outputRef, faultRef, summary, node) => {
      if (!name) return;
      operations.push(
        this._soapOperation({
          name,
          namespace,
          soapAction: actions[name] || "",
          summary,
          requestFields: this._wsdlMessageFields(messages, types, inputRef, node, "soap"),
          okFields: this._wsdlMessageFields(messages, types, outputRef, node, "response"),
          errFields: this._wsdlMessageFields(messages, types, faultRef, node, "response"),
          faultRef,
        })
      );
    };
    this._xmlAll(root, "portType").forEach((port) => {
      this._xmlKids(port, "operation").forEach((op) => {
        const input = this._xmlKids(op, "input")[0];
        const output = this._xmlKids(op, "output")[0];
        const fault = this._xmlKids(op, "fault")[0];
        addOp(
          this._xmlAttr(op, "name"),
          this._xmlAttr(input, "message"),
          this._xmlAttr(output, "message"),
          this._xmlAttr(fault, "message"),
          this._xmlText(op),
          op
        );
      });
    });
    this._xmlAll(root, "interface").forEach((iface) => {
      this._xmlKids(iface, "operation").forEach((op) => {
        const input = this._xmlKids(op, "input")[0];
        const output = this._xmlKids(op, "output")[0];
        const fault = this._xmlKids(op, "outfault")[0] || this._xmlKids(op, "infault")[0];
        addOp(
          this._xmlAttr(op, "name"),
          this._xmlAttr(input, "element") || this._xmlAttr(input, "message"),
          this._xmlAttr(output, "element") || this._xmlAttr(output, "message"),
          this._xmlAttr(fault, "element") || this._xmlAttr(fault, "ref"),
          this._xmlText(op),
          op
        );
      });
    });
    return operations;
  },

  _listSchemaOperations(root) {
    if (!root) return [];
    const types = this._wsdlTypes(root);
    const schemas = this._xmlSchemas(root);
    if (!schemas.length) return [];
    const namespace = this._xmlAttr(root, "targetNamespace") || this._xmlAttr(schemas[0], "targetNamespace");
    const elements = [];
    schemas.forEach((schema) => {
      this._xmlKids(schema, "element").forEach((el) => {
        const name = this._xmlAttr(el, "name");
        if (name) elements.push({ el, name });
      });
    });
    const byName = Object.fromEntries(elements.map((item) => [item.name, item]));
    const operations = [];
    elements.forEach(({ el, name }) => {
      if (/Response$|Fault$|Result$|Out$/i.test(name)) return;
      const response = byName[`${name}Response`] || byName[`${name}Result`] || byName[`${name}Out`];
      operations.push(
        this._soapOperation({
          name,
          namespace,
          summary: this._xmlText(el),
          requestFields: this._flattenXsdElement(el, types, "soap", "", true, 0, new Set(), true),
          okFields: response ? this._flattenXsdElement(response.el, types, "response", "", true, 0, new Set(), true) : [],
          errFields: [],
        })
      );
    });
    return operations;
  },

  _soapOperation({ name, namespace, soapAction, summary, requestFields, okFields, errFields, faultRef }) {
    const request = (requestFields || []).map((field) => ({ ...field, side: "request", in: field.in || "soap" }));
    const ok = okFields || [];
    const err = errFields || [];
    return {
      key: `SOAP ${name}`,
      method: "SOAP",
      path: name,
      protocol: "SOAP",
      operation: name,
      operationId: name,
      namespace: namespace || "",
      soapAction: soapAction || "",
      summary: summary || "",
      source: "",
      tags: ["Chopin"],
      hasAuth: false,
      authName: "",
      okCode: "",
      okLabel: summary || "OK",
      errCode: faultRef ? "Fault" : "",
      errLabel: faultRef ? "SOAP Fault" : "",
      serverCode: "",
      requestFields: request,
      responseFields: this._uniqueFields([...ok, ...err]).map((field) => ({ ...field, side: "response" })),
      okFields: ok,
      errFields: err,
      serverFields: [],
    };
  },

  _xmlSchemas(root) {
    const found = this._xmlAll(root, "schema");
    if (this._xmlLocal(root) === "schema" && !found.includes(root)) found.unshift(root);
    return found;
  },

  _wsdlSoapActions(root) {
    const actions = {};
    this._xmlAll(root, "binding").forEach((binding) => {
      this._xmlKids(binding, "operation").forEach((op) => {
        const name = this._xmlAttr(op, "name");
        if (!name) return;
        [...op.children].forEach((child) => {
          if (this._xmlLocal(child) !== "operation") return;
          const action = this._xmlAttr(child, "soapAction") || this._xmlAttr(child, "soapActionURI");
          if (action) actions[name] = action;
        });
      });
    });
    return actions;
  },

  _wsdlTypes(root) {
    const types = {};
    this._xmlSchemas(root).forEach((schema) => {
      const tns = this._xmlAttr(schema, "targetNamespace");
      const add = (el, kind) => {
        const name = this._xmlAttr(el, "name");
        if (!name) return;
        const entry = { el, kind, tns };
        types[`${tns}|${name}`] = entry;
        if (!types[name]) types[name] = entry;
      };
      this._xmlKids(schema, "element").forEach((el) => add(el, "element"));
      this._xmlKids(schema, "complexType").forEach((el) => add(el, "complexType"));
      this._xmlKids(schema, "simpleType").forEach((el) => add(el, "simpleType"));
    });
    return types;
  },

  _wsdlMessages(root) {
    const messages = {};
    this._xmlAll(root, "message").forEach((message) => {
      const name = this._xmlAttr(message, "name");
      if (name) messages[name] = message;
    });
    return messages;
  },

  _wsdlMessageFields(messages, types, ref, node, location) {
    if (!ref) return [];
    const qname = this._qname(ref, node);
    const message = messages[qname.local];
    if (!message) {
      const element = this._xsdLookup(types, ref, node);
      return element ? this._flattenXsdElement(element.el, types, location, "", true, 0, new Set(), true) : [];
    }
    const fields = [];
    this._xmlKids(message, "part").forEach((part) => {
      const element = this._xmlAttr(part, "element");
      const type = this._xmlAttr(part, "type");
      const partName = this._xmlAttr(part, "name") || "part";
      if (element) {
        const resolved = this._xsdLookup(types, element, part);
        if (resolved) fields.push(...this._flattenXsdElement(resolved.el, types, location, "", true, 0, new Set(), true));
        else fields.push(this._makeField(this._qname(element, part).local, location, true, { type: "element" }));
        return;
      }
      if (type) {
        if (this._xsdBuiltin(type)) {
          fields.push(this._makeField(partName, location, true, { type: this._xsdBuiltin(type) }));
          return;
        }
        const resolved = this._xsdLookup(types, type, part);
        if (resolved) fields.push(...this._flattenXsdType(resolved.el, types, location, partName, true, 0, new Set()));
        else fields.push(this._makeField(partName, location, true, { type: this._qname(type, part).local }));
        return;
      }
      fields.push(this._makeField(partName, location, true, { type: "string" }));
    });
    return this._uniqueFields(fields);
  },

  _xsdLookup(types, ref, node) {
    const qname = this._qname(ref, node);
    return types[`${qname.ns}|${qname.local}`] || types[qname.local] || null;
  },

  _xsdBuiltin(type) {
    const local = this._qname(type).local.toLowerCase();
    const builtins = {
      string: "string",
      normalizedstring: "string",
      token: "string",
      language: "string",
      nmtoken: "string",
      name: "string",
      ncname: "string",
      id: "string",
      idref: "string",
      anyuri: "uri",
      qname: "qname",
      boolean: "boolean",
      decimal: "number",
      float: "number",
      double: "number",
      integer: "integer",
      int: "integer",
      long: "integer",
      short: "integer",
      byte: "integer",
      positiveinteger: "integer",
      negativeinteger: "integer",
      nonpositiveinteger: "integer",
      nonnegativeinteger: "integer",
      unsignedint: "integer",
      unsignedlong: "integer",
      date: "date",
      datetime: "date-time",
      time: "time",
      duration: "duration",
      base64binary: "binary",
      hexbinary: "binary",
    };
    return builtins[local] || "";
  },

  _xsdParticles(node) {
    if (!node) return [];
    const out = [];
    const walk = (el) => {
      if (!el || el.nodeType !== 1) return;
      const name = this._xmlLocal(el);
      if (name === "element") {
        out.push(el);
        return;
      }
      if (["sequence", "all", "choice", "complexType", "complexContent", "simpleContent", "extension", "restriction", "group"].includes(name)) {
        [...el.children].forEach(walk);
      }
    };
    [...node.children].forEach(walk);
    return out;
  },

  _flattenXsdElement(el, types, location, prefix, required, depth, seen, unwrap) {
    if (!el || depth > 16) return [];
    const ownName = this._xmlAttr(el, "name") || this._qname(this._xmlAttr(el, "ref"), el).local;
    const name = prefix || ownName;
    const ref = this._xmlAttr(el, "ref");
    if (ref) {
      const key = `${this._qname(ref, el).ns}|${this._qname(ref, el).local}`;
      if (seen.has(key)) return name ? [this._makeField(name, location, required, { type: "element" })] : [];
      const nextSeen = new Set(seen);
      nextSeen.add(key);
      const resolved = this._xsdLookup(types, ref, el);
      if (!resolved) return name ? [this._makeField(this._qname(ref, el).local, location, required, { type: "element" })] : [];
      return this._flattenXsdElement(resolved.el, types, location, prefix || resolved.el.getAttribute("name") || this._qname(ref, el).local, required, depth + 1, nextSeen, unwrap);
    }
    const inline = this._xmlKids(el, "complexType")[0] || this._xmlKids(el, "simpleType")[0];
    if (inline) return this._flattenXsdType(inline, types, location, unwrap ? "" : name, required, depth, seen);
    const type = this._xmlAttr(el, "type");
    if (type && this._xsdBuiltin(type)) {
      return name ? [this._makeField(name, location, required, { type: this._xsdBuiltin(type) })] : [];
    }
    if (type) {
      const key = `${this._qname(type, el).ns}|${this._qname(type, el).local}`;
      if (seen.has(key)) return name ? [this._makeField(name, location, required, { type: this._qname(type, el).local })] : [];
      const nextSeen = new Set(seen);
      nextSeen.add(key);
      const resolved = this._xsdLookup(types, type, el);
      if (resolved) return this._flattenXsdType(resolved.el, types, location, unwrap ? "" : name, required, depth + 1, nextSeen);
      return name ? [this._makeField(name, location, required, { type: this._qname(type, el).local })] : [];
    }
    return name ? [this._makeField(name, location, required, { type: "element" })] : [];
  },

  _xsdBaseRef(typeEl) {
    if (!typeEl) return "";
    const content = this._xmlKids(typeEl, "complexContent")[0] || this._xmlKids(typeEl, "simpleContent")[0] || typeEl;
    const inherited = this._xmlKids(content, "extension")[0] || this._xmlKids(content, "restriction")[0];
    return inherited ? this._xmlAttr(inherited, "base") : "";
  },

  _flattenXsdType(typeEl, types, location, prefix, required, depth, seen) {
    if (!typeEl || depth > 16) return [];
    if (this._xmlLocal(typeEl) === "simpleType") {
      const restriction = this._xmlKids(typeEl, "restriction")[0];
      const base = restriction ? this._xsdBuiltin(this._xmlAttr(restriction, "base")) : "";
      const enums = restriction ? this._xmlKids(restriction, "enumeration") : [];
      const type = enums.length ? "enum" : base || "string";
      return prefix ? [this._makeField(prefix, location, required, { type })] : [];
    }
    const out = [];
    if (prefix) out.push(this._makeField(prefix, location, required, { type: "object" }));
    const baseRef = this._xsdBaseRef(typeEl);
    if (baseRef && !this._xsdBuiltin(baseRef)) {
      const key = `${this._qname(baseRef, typeEl).ns}|${this._qname(baseRef, typeEl).local}`;
      if (!seen.has(key)) {
        const nextSeen = new Set(seen);
        nextSeen.add(key);
        const resolved = this._xsdLookup(types, baseRef, typeEl);
        if (resolved) {
          const inherited = this._flattenXsdType(resolved.el, types, location, prefix, required, depth + 1, nextSeen);
          out.push(...inherited.filter((field) => field.name !== prefix));
        }
      }
    } else if (baseRef && this._xsdBuiltin(baseRef) && prefix) {
      out[0] = this._makeField(prefix, location, required, { type: this._xsdBuiltin(baseRef) });
    }
    this._xsdParticles(typeEl).forEach((child) => {
      const childName = this._xmlAttr(child, "name") || this._qname(this._xmlAttr(child, "ref"), child).local;
      const childPrefix = prefix && childName ? `${prefix}.${childName}` : childName;
      const childRequired = this._xmlAttr(child, "minOccurs") !== "0";
      out.push(...this._flattenXsdElement(child, types, location, childPrefix, childRequired, depth + 1, seen, false));
    });
    return this._uniqueFields(out);
  },

  _xmlLocal(node) {
    if (!node) return "";
    return String(node.localName || node.nodeName || "")
      .split(":")
      .pop();
  },

  _xmlKids(node, name) {
    if (!node) return [];
    return [...(node.children || [])].filter((el) => this._xmlLocal(el) === name);
  },

  _xmlAll(root, name) {
    const out = [];
    const walk = (node) => {
      if (!node || node.nodeType !== 1) return;
      if (this._xmlLocal(node) === name) out.push(node);
      [...(node.children || [])].forEach(walk);
    };
    walk(root);
    return out;
  },

  _xmlAttr(el, name) {
    if (!el) return "";
    if (typeof el.getAttribute === "function") {
      const direct = el.getAttribute(name);
      if (direct) return direct;
    }
    const attrs = el.attributes || [];
    for (let i = 0; i < attrs.length; i += 1) {
      const attr = attrs[i];
      const local = String(attr.localName || attr.name || "")
        .split(":")
        .pop();
      if (local === name && attr.value) return attr.value;
    }
    return "";
  },

  _xmlText(el) {
    const doc = this._xmlKids(el, "documentation")[0];
    return String(doc?.textContent || "").replace(/\s+/g, " ").trim();
  },

  _xmlns(node, prefix) {
    if (!node) return "";
    if (typeof node.lookupNamespaceURI === "function") {
      const ns = node.lookupNamespaceURI(prefix || null);
      if (ns) return ns;
    }
    let cur = node;
    while (cur && cur.nodeType === 1) {
      const attr = prefix ? `xmlns:${prefix}` : "xmlns";
      if (typeof cur.getAttribute === "function") {
        const value = cur.getAttribute(attr);
        if (value) return value;
      }
      cur = cur.parentElement || cur.parentNode;
    }
    return "";
  },

  _qname(value, node) {
    const text = String(value || "").trim();
    const index = text.indexOf(":");
    if (index < 0) return { ns: this._xmlns(node, ""), local: text };
    const prefix = text.slice(0, index);
    return { ns: this._xmlns(node, prefix), local: text.slice(index + 1) };
  },

  _slug(value) {
    return String(value || "item")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "item";
  },

  _yamlToJson(text) {
    const lines = String(text).replace(/\t/g, "  ").replace(/\r/g, "").split("\n");
    const root = {};
    const stack = [{ indent: -1, value: root, key: null, kind: "map" }];
    const set = (parent, key, value) => {
      if (parent.kind === "seq") parent.value.push(value);
      else parent.value[key] = value;
    };
    lines.forEach((raw, index) => {
      if (!raw.trim() || raw.trim().startsWith("#")) return;
      const indent = raw.match(/^ */)[0].length;
      const line = raw.trim();
      while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
      const parent = stack[stack.length - 1];
      if (line === "-" || line.startsWith("- ")) {
        if (!Array.isArray(parent.value)) {
          throw new Error(`YAML list in the wrong place on line ${index + 1}`);
        }
        const rest = line.slice(1).trim();
        if (!rest) {
          const next = {};
          parent.value.push(next);
          stack.push({ indent, value: next, key: null, kind: "map" });
          return;
        }
        if (rest.includes(":")) {
          const next = {};
          parent.value.push(next);
          const [k, ...restParts] = rest.split(":");
          const key = k.trim().replace(/^['"]|['"]$/g, "");
          const v = restParts.join(":").trim();
          if (v) next[key] = this._scalar(v);
          else {
            next[key] = {};
            stack.push({ indent, value: next, key, kind: "map" });
            stack.push({ indent: indent + 2, value: next[key], key: null, kind: "map" });
          }
          if (v === "" || v === "|" || v === ">") return;
          return;
        }
        parent.value.push(this._scalar(rest));
        return;
      }
      const colon = line.indexOf(":");
      if (colon < 0) throw new Error(`YAML parse failed on line ${index + 1}`);
      const key = line.slice(0, colon).trim().replace(/^['"]|['"]$/g, "");
      const value = line.slice(colon + 1).trim();
      if (!value) {
        const peek = this._peekKind(lines, index + 1, indent);
        const child = peek === "seq" ? [] : {};
        set(parent, key, child);
        stack.push({ indent, value: child, key, kind: peek });
        return;
      }
      set(parent, key, this._scalar(value));
    });
    return root;
  },

  _peekKind(lines, start, indent) {
    for (let i = start; i < lines.length; i += 1) {
      const raw = lines[i];
      if (!raw.trim() || raw.trim().startsWith("#")) continue;
      const nextIndent = raw.match(/^ */)[0].length;
      if (nextIndent <= indent) return "map";
      return raw.trim().startsWith("-") ? "seq" : "map";
    }
    return "map";
  },

  _scalar(value) {
    const text = String(value).replace(/\s+#.*$/, "").trim();
    if (text === "null" || text === "~") return null;
    if (text === "true") return true;
    if (text === "false") return false;
    if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
      return text.slice(1, -1);
    }
    return text;
  },
};
