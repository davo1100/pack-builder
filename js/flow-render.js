const FlowRender = {
  LANE_W: 230,
  HEADER_H: 62,
  STEP_GAP: 32,
  TITLE_H: 32,
  PAD: 32,
  CARD_W: 220,
  CARD_H: 74,
  GUTTER: 44,
  SHEET: "#F5F3FB",
  WIRE_REQ: "#191320",
  WIRE_RES: "#E4136B",
  PROC_BD: "#E7A93C",
  PROC_FG: "#9A6207",
  PROC_BADGE: "#C0801C",

  actorFill(type, presentation) {
    return FlowIR.actorPalette({ presentation }, type);
  },

  actorAccent(type, presentation) {
    const custom = FlowIR.normalizeColor(presentation?.actorColors?.[type], "");
    if (custom) return custom;
    if (type === "client") return "#1E7BD6";
    if (type === "platform" || type === "internal") return "#591BDD";
    if (type === "process" || type === "external") return "#E4136B";
    return FlowIR.actorColor({ presentation }, type);
  },

  methodStyle(method) {
    const key = String(method || "").toUpperCase();
    if (key === "GET") return { fill: "#1E7BD6", ink: "#FFFFFF", tint: "#E4F0FC", stroke: "#1E7BD6" };
    if (key === "POST") return { fill: "#16A34A", ink: "#FFFFFF", tint: "#E1F5E9", stroke: "#16A34A" };
    if (key === "PUT") return { fill: "#E8710A", ink: "#FFFFFF", tint: "#FCEBD9", stroke: "#E8710A" };
    if (key === "PATCH") return { fill: "#0E9C9C", ink: "#FFFFFF", tint: "#DBF3F2", stroke: "#0E9C9C" };
    if (key === "DELETE") return { fill: "#E11D48", ink: "#FFFFFF", tint: "#FCE2E8", stroke: "#E11D48" };
    if (key === "SOAP") return { fill: "#6D28D9", ink: "#FFFFFF", tint: "#ECE5FB", stroke: "#6D28D9" };
    return { fill: "#6D28D9", ink: "#FFFFFF", tint: "#ECE5FB", stroke: "#6D28D9" };
  },

  hopStyle(step, audience) {
    if (step.type === "response" && step.status) {
      const code = Number(step.status);
      if (code >= 200 && code < 300) return { fill: "#16A34A", ink: "#FFFFFF", tint: "#E1F5E9", stroke: "#16A34A" };
      if (code >= 300 && code < 400) return { fill: "#7C3AED", ink: "#FFFFFF", tint: "#ECE5FB", stroke: "#7C3AED" };
      if (code >= 400 && code < 500) return { fill: "#C2410C", ink: "#FFFFFF", tint: "#FBE7DA", stroke: "#C2410C" };
      if (code >= 500) return { fill: "#E11D48", ink: "#FFFFFF", tint: "#FCE2E8", stroke: "#E11D48" };
    }
    const method = step.protocol === "SOAP" || (step.operation && !step.method) ? "SOAP" : step.method;
    return this.methodStyle(method);
  },

  statusPhrase(code) {
    const map = {
      200: "OK",
      201: "Created",
      202: "Accepted",
      204: "No Content",
      400: "Bad Request",
      401: "Unauthorized",
      403: "Forbidden",
      404: "Not Found",
      409: "Conflict",
      422: "Unprocessable",
      500: "Error",
    };
    const n = Number(code);
    return map[n] || "";
  },

  escape(text) {
    return String(text ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  },

  attr(text) {
    return String(text ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;");
  },

  uid(prefix) {
    return (prefix || "flow") + Math.random().toString(36).slice(2, 8);
  },

  svg(model, options) {
    const presented = FlowIR.present(model, options);
    if (!presented.ok) return { ok: false, errors: presented.errors, svg: "" };
    const view = presented.view;
    if (!view.actors.length) {
      return { ok: true, errors: [], svg: this._emptySvg(view.title || "API flow") };
    }
    const svg = view.presentation.layout === "architecture" ? this._architecture(view) : this._sequence(view);
    return { ok: true, errors: [], svg: this._stampIr(svg, options?.source || model) };
  },

  viewModel(model, audience) {
    const key = FlowIR.audienceOf(audience);
    const presentation = {
      ...(model.presentation || {}),
      audience: key,
      showFields: key === "developer" && model.presentation?.showFields !== false,
    };
    if (key === "process") presentation.layout = "sequence";
    return { ...model, presentation };
  },

  html(model, options) {
    let source = model;
    if (!options?.trusted) {
      const checked = FlowIR.validate(model);
      if (!checked.ok) return { ok: false, errors: checked.errors, html: "" };
      source = checked.model;
    } else if (!source || typeof source !== "object") {
      return { ok: false, errors: ["No flow to draw"], html: "" };
    }
    if (source.presentation) source.presentation.audience = "developer";
    const drawn = this.svg(this.viewModel(source, "developer"), { trusted: true, source });
    if (!drawn.ok) return { ok: false, errors: drawn.errors || ["Could not draw the flow"], html: "" };
    const json = options?.embed === false ? "" : this.attr(JSON.stringify(source));
    return { ok: true, errors: [], html: `<div class="pack-flow"${json ? ` data-flow="${json}"` : ""}>${drawn.svg}</div>` };
  },

  parseEmbed(el) {
    const raw = el?.getAttribute?.("data-flow");
    if (!raw) return null;
    try {
      return FlowIR.normalize(JSON.parse(raw));
    } catch (err) {
      return null;
    }
  },

  _stampIr(svg, model) {
    if (!svg || !model) return svg;
    try {
      const checked = typeof FlowIR?.validate === "function" ? FlowIR.validate(model) : { ok: false };
      const payload = JSON.stringify(checked.ok ? checked.model : FlowIR.normalize(model));
      const meta = `<metadata id="pack-flow-ir"><![CDATA[${payload}]]></metadata>`;
      return svg.replace(/<svg\b([^>]*)>/, (match, attrs) => {
        if (/\bdata-pack-flow=/.test(attrs)) return `<svg${attrs}>${meta}`;
        return `<svg data-pack-flow="1"${attrs}>${meta}`;
      });
    } catch {
      return svg;
    }
  },

  _emptySvg(title) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="160" viewBox="0 0 640 160" role="img" aria-label="${this.attr(title)}">
      <rect width="640" height="160" fill="${this.SHEET}" rx="12"/>
      <text x="320" y="84" text-anchor="middle" font-family="Arial, sans-serif" font-size="15" fill="#404C37">${this.escape(title)}</text>
    </svg>`;
  },

  _stepSize(step, audience) {
    if (step.type === "condition") return this._conditionMetrics(step, audience);
    if (step.type === "process") return this._actionMetrics(step);
    return this._labelMetrics(step, audience);
  },

  _sequenceRows(steps) {
    const drawn = new Set();
    const rows = [];
    steps.forEach((step) => {
      if (drawn.has(step.id)) return;
      if (step.type === "condition") {
        rows.push({ kind: "condition", step, branches: (Array.isArray(step.branches) ? step.branches : []).slice(0, 4) });
        drawn.add(step.id);
        return;
      }
      rows.push({ kind: "single", step });
      drawn.add(step.id);
    });
    return rows;
  },

  _sequence(view) {
    const actors = view.actors;
    const audience = view.presentation.audience;
    const boxW = 196;
    const nameLines = actors.map((actor) => this._fitName(actor.name, 18, 2));
    const headerH = Math.max(
      this.HEADER_H,
      ...actors.map((actor, index) => (actor.logo ? 92 : 34 + nameLines[index].length * 14 + 18))
    );
    const rows = this._sequenceRows(view.steps);
    rows.forEach((row) => {
      if (row.kind === "condition") row.size = this._conditionMetrics(row.step, audience);
      else if (row.kind === "fork") {
        row.items.forEach((item) => {
          item.size = item.step ? this._stepSize(item.step, audience) : { w: 72, h: 20 };
        });
        row.h = row.items.reduce((max, item) => Math.max(max, item.size.h), 20);
        row.w = row.items.reduce((sum, item) => sum + item.size.w, 0) + Math.max(0, row.items.length - 1) * 24;
      } else row.size = this._stepSize(row.step, audience);
    });
    const apiSizes = rows
      .filter((row) => row.kind === "single" && (row.step.type === "request" || row.step.type === "response"))
      .map((row) => row.size);
    const apiW = Math.max(360, ...apiSizes.map((size) => size.w));
    apiSizes.forEach((size) => {
      size.w = apiW;
    });
    const gaps = rows.map((row, index) => {
      if (row.kind === "fork") return Math.max(this.STEP_GAP, row.h + 36);
      const step = row.step;
      const next = rows[index + 1];
      const paired = Boolean(
        step &&
          next?.kind === "single" &&
          step.type === "request" &&
          next.step.type === "response" &&
          step.from === next.step.to &&
          step.to === next.step.from
      );
      if (step && step.type === "condition") return Math.max(56, row.size.h + 28);
      if (step && (step.type === "request" || step.type === "response")) {
        return 24 + row.size.h + (paired ? 8 : 22);
      }
      const self = step && step.from && step.from === step.to && !FlowIR.isProcessHop(step);
      return Math.max(44, row.size.h + (self ? 28 : 22));
    });
    const stepsH = gaps.reduce((sum, gap) => sum + gap, 0) || this.STEP_GAP;
    const layout = this._sequenceLayout(actors, rows, boxW);
    const width = Math.max(1000, layout.width);
    const xs = layout.xs;
    const meta = this._sheetMeta(view);
    const headH = this._sheetHeadH(meta, width);
    const legendH = this._legendH();
    const height = this.PAD + headH + headerH + 12 + stepsH + legendH + this.PAD;
    const marker = this.uid("m");
    const mag = this.uid("p");
    const top = this.PAD + headH;
    const lineTop = top + headerH;
    const lineBot = height - this.PAD - legendH;
    const parts = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${this.attr(view.title)}">`,
      `<rect width="${width}" height="${height}" fill="${this.SHEET}"/>`,
      `<defs>`,
      `<marker id="${marker}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="${this.WIRE_REQ}"/></marker>`,
      `<marker id="${mag}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="${this.WIRE_RES}"/></marker>`,
      `</defs>`,
      this._sheetHead(meta, width),
    ];
    actors.forEach((actor, index) => {
      parts.push(`<line x1="${xs[actor.id]}" y1="${lineTop}" x2="${xs[actor.id]}" y2="${lineBot}" stroke="#C4BED6" stroke-width="2"/>`);
      parts.push(this._actorLaneCard(actor, xs[actor.id], top, boxW, headerH, nameLines[index], view.presentation));
    });
    const ys = [];
    let y = lineTop + 18;
    rows.forEach((row, index) => {
      ys.push(y);
      y += gaps[index];
    });
    parts.push(this._activationBars(rows, ys, xs, actors, view.presentation));
    let forkAt = null;
    let num = 1;
    let prevRequest = null;
    rows.forEach((row, index) => {
      const at = ys[index];
      if (row.kind === "condition") {
        const actorId = row.step.actor || row.step.from || actors[0]?.id;
        const laneX = xs[actorId] || this.PAD + this.LANE_W / 2;
        parts.push(this._conditionLane(laneX, at, row.step, row.size, num, width, apiW));
        forkAt = null;
        num += 1;
        prevRequest = null;
      } else if (row.kind === "fork") {
        parts.push(this._forkRow(forkAt, row, at, width, marker, audience));
        forkAt = null;
        prevRequest = null;
      } else {
        parts.push(this._laneStep(row.step, row.size, at, xs, actors, width, marker, mag, num, prevRequest));
        if (row.step.type === "request") prevRequest = row.step;
        else if (row.step.type !== "response") prevRequest = null;
        num += 1;
      }
    });
    parts.push(this._legend(view, width, lineBot + 16));
    parts.push("</svg>");
    return parts.join("");
  },

  _sheetMeta(view) {
    const pres = view.presentation || {};
    const src = view.source || {};
    const platform = pres.platform || "darwin";
    const tags = [];
    const add = (value) => {
      const text = String(value || "").trim();
      if (!text) return;
      if (tags.some((item) => item.toLowerCase() === text.toLowerCase())) return;
      if (tags.length >= 6) return;
      tags.push(text);
    };
    if (platform === "chopin") {
      add("SOAP");
      add("Chopin platform");
    } else if (platform === "both") {
      add("REST + SOAP");
      add("Darwin + Chopin");
    } else {
      add("REST");
      add("Darwin platform");
    }
    (Array.isArray(pres.tags) ? pres.tags : []).forEach(add);
    (Array.isArray(src.endpoints) ? src.endpoints : []).forEach((item) => (item.tags || []).forEach(add));
    const summary = String(pres.summary || "").trim()
      || (Array.isArray(src.endpoints) ? src.endpoints.find((item) => item.summary)?.summary : "")
      || "";
    const nextSteps = Array.isArray(pres.nextSteps)
      ? pres.nextSteps
          .slice(0, 4)
          .map((item) => (typeof item === "string"
            ? { title: item, detail: "" }
            : { title: String(item?.title || ""), detail: String(item?.detail || item?.description || "") }))
          .filter((item) => item.title)
      : [];
    const logoActor = (view.actors || []).find((actor) => actor.logo && (actor.type === "platform" || actor.type === "internal"));
    const lastOk = [...(view.steps || [])].reverse().find((step) => step.type === "process" && step.mark === "ok")
      || [...(view.steps || [])].reverse().find((step) => step.type === "response" && Number(step.status) >= 200 && Number(step.status) < 400)
      || [...(view.steps || [])].reverse().find((step) => step.type === "process");
    return {
      title: view.title || "API flow",
      kicker: "DEVELOPER INTEGRATION FLOW",
      brand: "Edenred Payment Solutions",
      summary: String(summary || "").trim(),
      tags,
      outcome: String(pres.outcome || lastOk?.label || "Complete").trim(),
      outcomeDetail: String(pres.outcomeDetail || "").trim(),
      nextSteps,
      logo: logoActor?.logo || "",
    };
  },

  _sheetHeadH(meta, width) {
    const inner = Math.max(280, width - this.PAD * 2);
    const summaryLines = meta.summary ? this._wrapToWidth(meta.summary, 12, inner) : [];
    const tags = this._tagLayout(meta.tags, inner);
    return 22 + 20 + 36 + (summaryLines.length ? summaryLines.length * 16 + 10 : 4) + (tags.h ? tags.h + 10 : 0) + 16;
  },

  _tagLayout(tags, maxW) {
    const placed = [];
    let x = 0;
    let y = 0;
    (tags || []).forEach((text) => {
      const w = Math.max(36, this._textWidth(text, 10) + 20);
      if (x && x + w > maxW) {
        x = 0;
        y += 26;
      }
      placed.push({ text, x, y, w });
      x += w + 8;
    });
    return { placed, h: placed.length ? y + 22 : 0 };
  },

  _sheetHead(meta, width) {
    const x = this.PAD;
    const inner = Math.max(280, width - this.PAD * 2);
    let y = this.PAD + 4;
    let html = `<g class="flow-sheet-head">`;
    html += `<text x="${x}" y="${y + 12}" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="#201D22">${this.escape(meta.brand)}</text>`;
    y += 22;
    html += `<text x="${x}" y="${y + 12}" font-family="Arial, sans-serif" font-size="11" font-weight="700" letter-spacing="0.12em" fill="#FD0966">${this.escape(meta.kicker)}</text>`;
    y += 20;
    html += `<text x="${x}" y="${y + 22}" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="#201D22">${this.escape(meta.title)}</text>`;
    y += 36;
    if (meta.summary) {
      this._wrapToWidth(meta.summary, 12, inner).forEach((line) => {
        html += `<text x="${x}" y="${y + 14}" font-family="Arial, sans-serif" font-size="12" fill="#6B675E">${this.escape(line)}</text>`;
        y += 16;
      });
      y += 8;
    }
    const tags = this._tagLayout(meta.tags, inner);
    tags.placed.forEach((tag) => {
      html += `<rect x="${x + tag.x}" y="${y + tag.y}" width="${tag.w}" height="22" rx="11" fill="#E8E4DA"/>`;
      html += `<text x="${x + tag.x + tag.w / 2}" y="${y + tag.y + 15}" text-anchor="middle" font-family="Arial, sans-serif" font-size="10" fill="#5C574E">${this.escape(tag.text)}</text>`;
    });
    html += `</g>`;
    return html;
  },

  _actorRole(actor) {
    return FlowIR.actorRole(actor);
  },

  _actorLaneCard(actor, cx, top, boxW, headerH, nameLines, presentation) {
    const accent = this.actorAccent(actor.type, presentation);
    const left = cx - boxW / 2;
    const role = this._actorRole(actor);
    const clip = this.uid("ac");
    let html = `<g>`;
    html += `<defs><clipPath id="${clip}"><rect x="${left}" y="${top}" width="${boxW}" height="${headerH}" rx="12"/></clipPath></defs>`;
    html += `<rect x="${left}" y="${top}" width="${boxW}" height="${headerH}" rx="12" fill="#FFFFFF" stroke="#E6E1D6"/>`;
    html += `<g clip-path="url(#${clip})"><rect x="${left}" y="${top}" width="${boxW}" height="5" fill="${accent}"/></g>`;
    if (actor.logo) {
      const logoW = Math.min(156, boxW - 28);
      const logoH = 40;
      const logoY = top + 14;
      html += `<image href="${this.attr(actor.logo)}" x="${cx - logoW / 2}" y="${logoY}" width="${logoW}" height="${logoH}" preserveAspectRatio="xMidYMid meet"/>`;
      html += `<text x="${cx}" y="${logoY + logoH + 16}" text-anchor="middle" font-family="Arial, sans-serif" font-size="9" font-weight="700" letter-spacing="0.08em" fill="#857D6B">${this.escape(role)}</text>`;
    } else {
      const lines = nameLines || this._fitName(actor.name, 18, 2);
      const nameY = top + 26;
      lines.forEach((line, index) => {
        html += `<text x="${cx}" y="${nameY + index * 14}" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="#201D22">${this.escape(line)}</text>`;
      });
      html += `<text x="${cx}" y="${nameY + lines.length * 14 + 12}" text-anchor="middle" font-family="Arial, sans-serif" font-size="9" font-weight="700" letter-spacing="0.08em" fill="#857D6B">${this.escape(role)}</text>`;
    }
    html += `</g>`;
    return html;
  },

  _stepNumber(n, x, y, fill) {
    const color = fill || "#201D22";
    return `<g>
      <circle cx="${x}" cy="${y}" r="14" fill="${this.SHEET}"/>
      <circle cx="${x}" cy="${y}" r="11" fill="${color}"/>
      <text x="${x}" y="${y + 4}" text-anchor="middle" font-family="Arial, sans-serif" font-size="10.5" font-weight="700" fill="#FFFFFF">${n}</text>
    </g>`;
  },

  _activationBars(rows, ys, xs, actors, presentation) {
    let html = "";
    for (let i = 0; i < rows.length - 1; i += 1) {
      const a = rows[i];
      const b = rows[i + 1];
      if (a.kind !== "single" || b.kind !== "single") continue;
      const req = a.step;
      const res = b.step;
      if (req.type !== "request" || res.type !== "response") continue;
      if (req.from !== res.to || req.to !== res.from) continue;
      const y1 = ys[i] + 12;
      const y2 = ys[i + 1] + 12;
      const h = Math.max(12, y2 - y1);
      [req.from, req.to].forEach((id) => {
        const actor = actors.find((item) => item.id === id);
        if (!actor || xs[id] == null) return;
        const fill = this.actorAccent(actor.type, presentation);
        html += `<rect x="${xs[id] - 5.5}" y="${y1}" width="11" height="${h}" rx="6" fill="${fill}"/>`;
      });
    }
    return html;
  },

  _legendH() {
    return 132;
  },

  _chipPath(x, y, w, h) {
    const tl = 5;
    const tr = 5;
    const br = 5;
    const bl = 2;
    return `M${x + tl} ${y} H${x + w - tr} Q${x + w} ${y} ${x + w} ${y + tr} V${y + h - br} Q${x + w} ${y + h} ${x + w - br} ${y + h} H${x + bl} Q${x} ${y + h} ${x} ${y + h - bl} V${y + tl} Q${x} ${y} ${x + tl} ${y} Z`;
  },

  _legendChip(x, y, text, fill, ink) {
    const label = String(text || "");
    const w = Math.max(36, this._monoWidth(label, 8.5) + 14);
    const h = 16;
    const html = `<path d="${this._chipPath(x, y, w, h)}" fill="${fill}"/>
      <text x="${x + w / 2}" y="${y + 12}" text-anchor="middle" font-family="ui-monospace, Consolas, 'Courier New', monospace" font-size="8.5" font-weight="700" letter-spacing="0.05em" fill="${ink || "#FFFFFF"}">${this.escape(label)}</text>`;
    return { html, w };
  },

  _legend(view, width, y) {
    const left = this.PAD;
    const w = width - this.PAD * 2;
    const h = this._legendH() - 12;
    const steps = view?.steps || [];
    const usedMethods = new Set(
      steps
        .filter((step) => step.type === "request")
        .map((step) => String(step.method || (step.protocol === "SOAP" ? "SOAP" : "")).toUpperCase())
        .filter(Boolean)
    );
    const usedCodes = [];
    steps.forEach((step) => {
      if (step.type !== "response" || step.status == null || step.status === "") return;
      const code = String(step.status);
      const phrase = this.statusPhrase(code);
      const label = phrase ? `${code} ${phrase}` : code;
      if (!usedCodes.some((item) => item.code === code)) usedCodes.push({ code, label });
    });
    const muted = "#5B5560";
    const ink = "#201D22";
    const rowX = left + 96;
    const labelX = left + 20;
    const rowYs = [y + 16, y + 52, y + 88];
    let html = `<g>`;
    html += `<path d="${this._cardPath(left, y, w, h)}" fill="#FFFFFF"/>`;
    html += `<line x1="${left + 16}" y1="${y + 42}" x2="${left + w - 16}" y2="${y + 42}" stroke="#E7E3F2"/>`;
    html += `<line x1="${left + 16}" y1="${y + 78}" x2="${left + w - 16}" y2="${y + 78}" stroke="#E7E3F2"/>`;
    const rowLabel = (text, cy) =>
      `<text x="${labelX}" y="${cy}" font-family="Arial, sans-serif" font-size="9" font-weight="700" letter-spacing="0.11em" fill="#857E8C">${text}</text>`;
    html += rowLabel("METHODS", rowYs[0] + 12);
    html += rowLabel("RESPONSES", rowYs[1] + 12);
    html += rowLabel("LINES", rowYs[2] + 12);

    const drawItem = (x, cy, chip, caption, on) => {
      const chipY = cy;
      let out = chip.html;
      const tx = x + chip.w + 6;
      out += `<text x="${tx}" y="${cy + 12}" font-family="Arial, sans-serif" font-size="10" font-weight="${on ? "600" : "400"}" fill="${on ? ink : muted}">${this.escape(caption)}</text>`;
      return { html: out, w: chip.w + 6 + this._textWidth(caption, 10) + 16 };
    };

    let x = rowX;
    [
      { method: "GET", caption: "read" },
      { method: "POST", caption: "create" },
      { method: "PUT", caption: "replace" },
      { method: "PATCH", caption: "update" },
      { method: "DELETE", caption: "remove" },
    ].forEach((item) => {
      const style = this.methodStyle(item.method);
      const chip = this._legendChip(x, rowYs[0], item.method, style.fill);
      const drawn = drawItem(x, rowYs[0], chip, item.caption, usedMethods.has(item.method));
      html += drawn.html;
      x += drawn.w;
    });

    x = rowX;
    [
      { label: "2xx", caption: "success", style: { fill: "#16A34A" } },
      { label: "3xx", caption: "redirect", style: { fill: "#7C3AED" } },
      { label: "4xx", caption: "client error", style: { fill: "#C2410C" } },
      { label: "5xx", caption: "server error", style: { fill: "#E11D48" } },
    ].forEach((item) => {
      const chip = this._legendChip(x, rowYs[1], item.label, item.style.fill);
      const drawn = drawItem(x, rowYs[1], chip, item.caption, false);
      html += drawn.html;
      x += drawn.w;
    });
    if (usedCodes.length) {
      html += `<text x="${x}" y="${rowYs[1] + 12}" font-family="Arial, sans-serif" font-size="10" fill="${muted}">in this flow</text>`;
      x += this._textWidth("in this flow", 10) + 8;
      usedCodes.slice(0, 3).forEach((item) => {
        const chip = this._legendChip(x, rowYs[1], item.label, "#F3F1F8", ink);
        html += chip.html;
        x += chip.w + 8;
      });
    }

    x = rowX;
    const lineSpecs = [
      { kind: "req", caption: "request" },
      { kind: "res", caption: "response" },
      { kind: "proc", caption: "off-platform step" },
      { kind: "decision", caption: "decision (yes / no)" },
      { kind: "dot", caption: "required field" },
    ];
    lineSpecs.forEach((item) => {
      const cy = rowYs[2] + 8;
      let markW = 24;
      if (item.kind === "req") {
        html += `<line x1="${x}" y1="${cy}" x2="${x + 24}" y2="${cy}" stroke="${this.WIRE_REQ}" stroke-width="2.5"/>`;
      } else if (item.kind === "res") {
        html += `<line x1="${x}" y1="${cy}" x2="${x + 24}" y2="${cy}" stroke="${this.WIRE_RES}" stroke-width="2" stroke-dasharray="6 5"/>`;
      } else if (item.kind === "proc") {
        html += `<line x1="${x}" y1="${cy}" x2="${x + 24}" y2="${cy}" stroke="${this.PROC_BD}" stroke-width="1.75" stroke-dasharray="5 4"/>`;
      } else if (item.kind === "decision") {
        html += `<rect x="${x + 7.5}" y="${cy - 4.5}" width="9" height="9" rx="2" fill="#6D28D9" transform="rotate(45 ${x + 12} ${cy})"/>`;
        markW = 24;
      } else {
        html += `<circle cx="${x + 4.5}" cy="${cy}" r="4.5" fill="#FD0966"/>`;
        markW = 9;
      }
      html += `<text x="${x + markW + 6}" y="${rowYs[2] + 12}" font-family="Arial, sans-serif" font-size="10" fill="${muted}">${this.escape(item.caption)}</text>`;
      x += markW + 6 + this._textWidth(item.caption, 10) + 16;
    });

    html += `</g>`;
    return html;
  },

  _arrowCaption(step) {
    const label = String(step.label || "").trim();
    if (!label) return "";
    const path = String(step.path || step.operation || "").trim();
    if (path && (label === path || label.endsWith(path))) return "";
    if (step.type === "request" && step.method && label.toUpperCase().startsWith(`${step.method} `)) return "";
    return this._clipToWidth(label, 11, 280);
  },

  _laneStep(step, size, y, xs, actors, width, marker, mag, num, prevRequest) {
    if (step.type === "condition") {
      const actorId = step.actor || step.from || actors[0]?.id;
      const laneX = xs[actorId] || this.PAD + this.LANE_W / 2;
      return this._conditionLane(laneX, y, step, size, num, width, size.w);
    }
    const fallbackX = xs[actors[0]?.id] || this.PAD + this.LANE_W / 2;
    const x1 = xs[step.from] ?? xs[step.actor] ?? fallbackX;
    const x2 = xs[step.to] ?? x1;
    if (step.type === "process") {
      return this._processRow(step, size, y, x1, x2, num);
    }
    const arrowY = y + 12;
    const lo = Math.min(x1, x2);
    const left = this._clampHopX(lo + 44 + size.w / 2, size.w, width) - size.w / 2;
    const style = this.hopStyle(step);
    const srcX = x1;
    return (
      this._messageArrow(x1, x2, arrowY, step, marker, mag) +
      this._wireLabel(step, x1, x2, arrowY) +
      this._stepNumber(num, srcX, arrowY, style.fill) +
      this._labelGroup(left, y + 24, step, size, prevRequest)
    );
  },

  _processRow(step, size, y, x1, x2, num) {
    const cy = y + size.h / 2;
    const hop = Math.abs(x2 - x1) >= 12;
    const cx = hop ? (x1 + x2) / 2 : x1;
    let html = "";
    if (hop) {
      html += this._processWire(x1, x2, cy);
    } else {
      html += `<path d="M${x1} ${cy - 10} H${x1 + 18} A8 8 0 0 1 ${x1 + 18} ${cy + 10} H${x1 + 4}" fill="none" stroke="${this.PROC_BD}" stroke-width="2.5" stroke-linecap="round"/>`;
      html += `<path d="M${x1 + 4} ${cy + 10} l8 -4.5 v9 z" fill="${this.PROC_BD}"/>`;
    }
    html += this._actionBox(hop ? cx : x1 + 46 + size.w / 2, cy, step, size, num);
    return html;
  },

  _processWire(x1, x2, y) {
    const dir = x2 >= x1 ? 1 : -1;
    return `<line x1="${x1}" y1="${y}" x2="${x2 - 10 * dir}" y2="${y}" stroke="${this.PROC_BD}" stroke-width="1.75" stroke-dasharray="5 4"/>
      <polygon points="${x2},${y} ${x2 - 11 * dir},${y - 6} ${x2 - 11 * dir},${y + 6}" fill="${this.PROC_BD}"/>`;
  },

  _wireLabel(step, x1, x2, y) {
    const label = this._arrowCaption(step);
    if (!label) return "";
    const mid = (x1 + x2) / 2;
    const tw = this._textWidth(label, 11);
    const fill = step.type === "response" ? this.WIRE_RES : "#201D22";
    return `<rect x="${mid - tw / 2 - 10}" y="${y - 9}" width="${tw + 20}" height="16" rx="3" fill="${this.SHEET}"/>
      <text x="${mid}" y="${y + 4}" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" font-weight="600" fill="${fill}">${this.escape(label)}</text>`;
  },

  _forkRow(origin, row, y, width, marker, audience) {
    const items = row.items || [];
    if (!items.length) return "";
    const ink = origin?.ink || this._conditionInk(row.parent?.kind);
    const total = row.w;
    const start = this._clampHopX(origin?.x || width / 2, total, width) - total / 2;
    let x = start;
    const stemY = origin ? origin.y - 2 : y - 8;
    let html = "";
    items.forEach((item) => {
      const cx = x + item.size.w / 2;
      html += `<line x1="${origin?.x || cx}" y1="${stemY}" x2="${cx}" y2="${y}" stroke="#C9C4B8" stroke-width="1"/>`;
      html += `<text x="${cx}" y="${y + 11}" text-anchor="middle" font-family="Arial, sans-serif" font-size="9" font-weight="700" fill="${ink}">${this.escape(item.branch.label || "")}</text>`;
      if (item.step) html += this._outcomeStep(cx, y + 16, item.step, item.size, marker);
      else html += `<text x="${cx}" y="${y + 28}" text-anchor="middle" font-family="Arial, sans-serif" font-size="9" fill="#857D6B">Choose a step</text>`;
      x += item.size.w + 24;
    });
    return html;
  },

  _outcomeStep(x, y, step, size, marker) {
    if (step.type === "condition") return this._conditionBox(x, y, step, size);
    if (step.type === "process") return this._actionBox(x, y + size.h / 2, step, size);
    return this._labelGroup(x - size.w / 2, y, step, size);
  },

  _architecture(view) {
    const both = view.presentation.platform === "both";
    const platforms = view.actors.filter((actor) => actor.type === "platform");
    const stack = view.actors.filter((actor) => actor.type !== "platform");
    const split = both && platforms.length >= 2;
    const rows = split ? [...stack, platforms] : view.actors.map((actor) => [actor]);
    const colCount = split ? 2 : 1;
    const hopSizes = view.steps.map((step) => this._labelMetrics(step, view.presentation.audience));
    const maxHopW = hopSizes.reduce((max, item) => Math.max(max, item.w), 0);
    const maxHopH = hopSizes.reduce((max, item) => Math.max(max, item.h), 20);
    const width = Math.max(560, this.PAD * 2 + colCount * this.CARD_W + (colCount - 1) * 36, maxHopW + this.PAD * 2);
    const nameLines = view.actors.map((actor) => this._fitName(actor.name, 24, 2));
    const hasLogo = view.actors.some((actor) => actor.logo);
    const cardH = Math.max(this.CARD_H, hasLogo ? 104 : 0, 28 + Math.max(...nameLines.map((lines) => lines.length), 1) * 16 + 22);
    const rowPitch = cardH + 36 + maxHopH;
    const height = this.PAD + this.TITLE_H + rows.length * rowPitch + this.PAD;
    const marker = this.uid("m");
    const boxes = [];
    rows.forEach((row, rowIndex) => {
      const items = Array.isArray(row) ? row : [row];
      const rowW = items.length * this.CARD_W + (items.length - 1) * 36;
      const startX = (width - rowW) / 2;
      const y = this.PAD + this.TITLE_H + rowIndex * rowPitch;
      items.forEach((actor, col) => {
        boxes.push({
          actor,
          x: startX + col * (this.CARD_W + 36),
          y,
          cx: startX + col * (this.CARD_W + 36) + this.CARD_W / 2,
          cy: y + cardH / 2,
          h: cardH,
        });
      });
    });
    const byId = Object.fromEntries(boxes.map((box) => [box.actor.id, box]));
    const parts = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${this.attr(view.title)}">`,
      `<rect width="${width}" height="${height}" fill="${this.SHEET}"/>`,
      `<defs><marker id="${marker}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#201D22"/></marker></defs>`,
      `<text x="${this.PAD}" y="${this.PAD + 16}" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="#201D22">${this.escape(view.title)}</text>`,
      `<text x="${width - this.PAD}" y="${this.PAD + 16}" text-anchor="end" font-family="Arial, sans-serif" font-size="11" font-weight="700" fill="#404C37">${this.escape(FlowIR.protocolLabel(view.presentation.platform, view.presentation.audience))}</text>`,
    ];
    boxes.forEach((box) => {
      const accent = this.actorAccent(box.actor.type, view.presentation);
      const pal = { fill: "#FFFFFF", title: "#201D22", sub: "#857D6B" };
      const lines = this._fitName(box.actor.name, 24, 2);
      parts.push(`<g>`);
      const clip = this.uid("ac");
      parts.push(`<defs><clipPath id="${clip}"><rect x="${box.x}" y="${box.y}" width="${this.CARD_W}" height="${box.h}" rx="12"/></clipPath></defs>`);
      parts.push(`<rect x="${box.x}" y="${box.y}" width="${this.CARD_W}" height="${box.h}" rx="12" fill="#FFFFFF" stroke="#E6E1D6"/>`);
      parts.push(`<g clip-path="url(#${clip})"><rect x="${box.x}" y="${box.y}" width="${this.CARD_W}" height="5" fill="${accent}"/></g>`);
      parts.push(this._actorFace(box.actor, box.cx, box.y, this.CARD_W, pal, view.presentation.platform, lines, "card"));
      parts.push(`</g>`);
    });
    const drawn = new Set();
    view.steps.forEach((step) => {
      if (step.type === "condition" || (step.type === "process" && !FlowIR.isProcessHop(step))) return;
      const from = byId[step.from];
      const to = byId[step.to];
      if (!from || !to) return;
      const key = `${step.from}->${step.to}`;
      if (drawn.has(key)) return;
      drawn.add(key);
      const x1 = from.cx;
      const y1 = from.y + from.h;
      const x2 = to.cx;
      const y2 = to.y;
      const midY = (y1 + y2) / 2;
      const dashed = step.type === "response" ? ' stroke="#FD0966" stroke-dasharray="7 5"' : ' stroke="#201D22"';
      const hopSize = step.type === "process" ? this._actionMetrics(step) : this._labelMetrics(step, view.presentation.audience);
      const hopX = this._clampHopX((x1 + x2) / 2, hopSize.w, width);
      parts.push(`<path d="M${x1} ${y1} L${x1} ${midY} L${x2} ${midY} L${x2} ${y2 - 8}" fill="none" stroke-width="1.75"${dashed} marker-end="url(#${marker})"/>`);
      parts.push(step.type === "process" ? this._actionBox(hopX, midY, step, hopSize) : this._labelGroup(hopX - hopSize.w / 2, midY - hopSize.h - 4, step, hopSize));
    });
    if (split) {
      const api = boxes.find((box) => box.actor.type === "internal") || boxes.find((box) => box.actor.id === "api");
      platforms.forEach((actor) => {
        const dest = byId[actor.id];
        if (!api || !dest || drawn.has(`${api.actor.id}->${actor.id}`)) return;
        const midY = (api.y + api.h + dest.y) / 2;
        parts.push(`<path d="M${api.cx} ${api.y + api.h} L${api.cx} ${midY} L${dest.cx} ${midY} L${dest.cx} ${dest.y - 8}" fill="none" stroke="#201D22" stroke-width="1.75" marker-end="url(#${marker})"/>`);
      });
    }
    parts.push("</svg>");
    return parts.join("");
  },

  _actorFace(actor, cx, top, boxW, pal, platform, nameLines, size) {
    const sub = this._actorRole(actor);
    const logo = actor?.logo ? String(actor.logo) : "";
    if (logo) {
      const logoW = size === "card" ? 156 : 120;
      const logoH = size === "card" ? 44 : 36;
      const lx = cx - logoW / 2;
      const ly = top + (size === "card" ? 16 : 10);
      return [
        `<title>${this.escape(actor.name)}</title>`,
        `<image href="${this.attr(logo)}" x="${lx}" y="${ly}" width="${logoW}" height="${logoH}" preserveAspectRatio="xMidYMid meet"/>`,
        `<text x="${cx}" y="${ly + logoH + 18}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${size === "card" ? 10 : 9}" font-weight="700" letter-spacing="0.08em" fill="${pal.sub}">${this.escape(sub)}</text>`,
      ].join("");
    }
    const nameSize = size === "card" ? 14 : 12;
    const lead = size === "card" ? 16 : 14;
    const firstY = top + (size === "card" ? 28 : 20);
    const lines = (nameLines || []).map(
      (line, index) =>
        `<text x="${cx}" y="${firstY + index * lead}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${nameSize}" font-weight="700" fill="${pal.title}">${this.escape(line)}</text>`
    );
    lines.push(
      `<text x="${cx}" y="${firstY + (nameLines?.length || 1) * lead + (size === "card" ? 4 : 2)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${size === "card" ? 11 : 10}" fill="${pal.sub}">${this.escape(sub)}</text>`
    );
    return lines.join("");
  },

  _actorProtocol(actor, platform) {
    if (actor.id === "chopin" || (platform === "chopin" && actor.type === "platform")) return "SOAP";
    if (actor.id === "darwin" || (platform === "darwin" && actor.type === "platform")) return "REST";
    if (platform === "chopin") return actor.type === "client" ? "SOAP client" : actor.type;
    if (platform === "darwin") return actor.type === "client" ? "REST client" : actor.type;
    return actor.type;
  },

  _sequenceLayout(actors, rows, boxW) {
    const n = actors.length;
    const indexOf = Object.fromEntries(actors.map((actor, index) => [actor.id, index]));
    const gaps = Array(Math.max(0, n - 1)).fill(this.LANE_W);
    const placeHop = (step, size) => {
      if (!step || step.type === "condition" || (step.type === "process" && !FlowIR.isProcessHop(step))) return;
      const from = indexOf[step.from];
      const to = indexOf[step.to];
      if (from == null || to == null || from === to) return;
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);
      const need = size.w + 88;
      const span = gaps.slice(lo, hi).reduce((sum, gap) => sum + gap, 0);
      if (need > span) {
        const bump = (need - span) / (hi - lo);
        for (let i = lo; i < hi; i += 1) gaps[i] += bump;
      }
    };
    rows.forEach((row) => {
      if (row.kind === "single") placeHop(row.step, row.size);
      if (row.kind === "fork") row.items.forEach((item) => placeHop(item.step, item.size));
    });
    const xsArr = [this.PAD + this.LANE_W / 2];
    gaps.forEach((gap, index) => xsArr.push(xsArr[index] + gap));
    let minX = xsArr[0] - boxW / 2;
    let maxX = xsArr[n - 1] + boxW / 2;
    const spanBox = (actorId, size) => {
      const i = indexOf[actorId] ?? 0;
      minX = Math.min(minX, xsArr[i] - size.w / 2);
      maxX = Math.max(maxX, xsArr[i] + size.w / 2);
    };
    rows.forEach((row) => {
      if (row.kind === "condition") {
        const i = indexOf[row.step.actor || row.step.from] ?? 0;
        const cardLeft = xsArr[i] + 74;
        minX = Math.min(minX, xsArr[i] - 24, cardLeft);
        maxX = Math.max(maxX, cardLeft + row.size.w);
        return;
      }
      if (row.kind === "fork") {
        const i = indexOf[row.parent?.actor || row.parent?.from] ?? 0;
        minX = Math.min(minX, xsArr[i] - row.w / 2);
        maxX = Math.max(maxX, xsArr[i] + row.w / 2);
        return;
      }
      const step = row.step;
      const size = row.size;
      if (step.type === "process" && !FlowIR.isProcessHop(step)) {
        spanBox(step.actor || step.from, size);
        return;
      }
      const from = indexOf[step.from];
      const to = indexOf[step.to];
      if (from == null || to == null) return;
      const cx = (xsArr[from] + xsArr[to]) / 2;
      minX = Math.min(minX, cx - size.w / 2);
      maxX = Math.max(maxX, cx + size.w / 2);
    });
    const shift = this.PAD - minX;
    const xs = Object.fromEntries(actors.map((actor, index) => [actor.id, xsArr[index] + shift]));
    return { xs, width: Math.max(560, Math.ceil(maxX + shift + this.PAD)) };
  },

  _clampHopX(prefer, hopW, width) {
    const half = hopW / 2;
    const min = this.PAD + half;
    const max = width - this.PAD - half;
    if (max < min) return width / 2;
    return Math.min(max, Math.max(min, prefer));
  },

  _messageArrow(x1, x2, y, step, marker, mag) {
    const response = step.type === "response";
    const process = step.type === "process";
    const stroke = response ? this.WIRE_RES : process ? this.PROC_BD : this.WIRE_REQ;
    const dash = response ? ' stroke-dasharray="6 5"' : process ? ' stroke-dasharray="5 4"' : "";
    const mark = response && mag ? ` marker-end="url(#${mag})"` : ` marker-end="url(#${marker})"`;
    const width = response ? 2 : 2.5;
    if (Math.abs(x2 - x1) < 12) {
      const loop = 42;
      return `<path d="M${x1} ${y} C${x1 + loop} ${y},${x1 + loop} ${y + 18},${x1 + 8} ${y + 18}" fill="none" stroke="${stroke}" stroke-width="${width}"${dash}${mark}/>`;
    }
    const dir = x2 >= x1 ? 1 : -1;
    return `<line x1="${x1}" y1="${y}" x2="${x2 - 10 * dir}" y2="${y}" stroke="${stroke}" stroke-width="${width}"${dash}${mark}/>`;
  },

  _cardPath(x, y, w, h) {
    const tl = 20;
    const tr = 20;
    const br = 20;
    const bl = 5;
    return `M${x + tl} ${y} H${x + w - tr} Q${x + w} ${y} ${x + w} ${y + tr} V${y + h - br} Q${x + w} ${y + h} ${x + w - br} ${y + h} H${x + bl} Q${x} ${y + h} ${x} ${y + h - bl} V${y + tl} Q${x} ${y} ${x + tl} ${y} Z`;
  },

  _labelMetrics(step, audience) {
    const style = this.hopStyle(step, audience);
    const method = step.protocol === "SOAP" || (step.operation && !step.method) ? "SOAP" : step.method;
    const status = step.type === "response" && step.status ? String(step.status) : "";
    const phrase = status ? this.statusPhrase(status) : "";
    const badge = step.type === "request" && method
      ? method
      : status
        ? `${status}${phrase ? ` ${phrase}` : ""}`
        : "";
    const path = step.type === "request" ? (step.path || step.operation || "") : "";
    const endRef = step.type === "response"
      ? [method, step.path || step.operation || ""].filter(Boolean).join(" ")
      : "";
    const padX = 14;
    const headerH = 36;
    const fieldRows = Array.isArray(step.fieldRows) ? step.fieldRows : [];
    const badgeW = badge ? Math.max(46, this._monoWidth(badge, 10) + 18) : 0;
    const pathW = path ? this._monoWidth(path, 12) : 0;
    const endW = endRef ? this._monoWidth(endRef, 9.5) : 0;
    const nameW = fieldRows.reduce((max, row) => Math.max(max, this._monoWidth(row.name, 10) + (row.required ? 8 : 0)), 48);
    const typeW = fieldRows.reduce((max, row) => Math.max(max, row.type ? this._monoWidth(String(row.type).toLowerCase(), 8.5) + 12 : 0), 0);
    const valueW = fieldRows.reduce((max, row) => Math.max(max, this._monoWidth(row.example || "", 10)), 0);
    const fieldInner = fieldRows.length ? nameW + 8 + typeW + 10 + valueW : 0;
    const headerInner = badgeW + 9 + Math.max(pathW, endW);
    const innerW = Math.max(headerInner, fieldInner, 280);
    const w = Math.min(520, innerW + padX * 2 + 8);
    const fieldH = fieldRows.length ? 10 + fieldRows.length * 17 + 6 : 0;
    const h = headerH + fieldH;
    return {
      w,
      h,
      badge,
      badgeW,
      path,
      endRef,
      fieldRows,
      style,
      headerH,
      padX,
      nameW,
      hasFields: fieldRows.length > 0,
    };
  },

  _labelGroup(left, top, step, size, prevRequest) {
    const metrics = size && size.badge != null ? size : this._labelMetrics(step, "developer");
    const { w, h, badge, badgeW, style } = metrics;
    const fieldRows = metrics.fieldRows || [];
    const padX = metrics.padX ?? 14;
    const headerH = metrics.headerH || 36;
    const path = metrics.path || "";
    const endRef = metrics.endRef
      || (step.type === "response"
        ? [prevRequest?.method || step.method, prevRequest?.path || prevRequest?.operation || step.path || ""].filter(Boolean).join(" ")
        : "");
    const clip = this.uid("cd");
    const tint = style.tint || "#ECE5FB";
    let html = `<g>`;
    html += `<defs><clipPath id="${clip}">${`<path d="${this._cardPath(left, top, w, h)}"/>`}</clipPath></defs>`;
    html += `<path d="${this._cardPath(left, top, w, h)}" fill="#FFFFFF"/>`;
    html += `<g clip-path="url(#${clip})">`;
    html += `<rect x="${left}" y="${top}" width="4" height="${h}" fill="${style.fill}"/>`;
    html += `<rect x="${left}" y="${top}" width="${w}" height="${headerH}" fill="${tint}"/>`;
    if (fieldRows.length) html += `<line x1="${left + 4}" y1="${top + headerH}" x2="${left + w}" y2="${top + headerH}" stroke="rgba(0,0,0,0.06)"/>`;
    html += `</g>`;
    const badgeX = left + padX + 4;
    const badgeY = top + (headerH - 20) / 2;
    if (badge) {
      html += `<rect x="${badgeX}" y="${badgeY}" width="${badgeW}" height="20" rx="4" fill="${style.fill}"/>`;
      html += `<text x="${badgeX + badgeW / 2}" y="${badgeY + 14}" text-anchor="middle" font-family="ui-monospace, Consolas, 'Courier New', monospace" font-size="10" font-weight="700" letter-spacing="0.04em" fill="#FFFFFF">${this.escape(step.type === "request" ? badge.toUpperCase() : badge)}</text>`;
    }
    if (path) {
      html += `<text x="${badgeX + badgeW + 9}" y="${top + headerH / 2 + 5}" font-family="ui-monospace, Consolas, 'Courier New', monospace" font-size="12" font-weight="600" fill="#201D22">${this.escape(this._clipToWidth(path, 12, w - padX * 2 - badgeW - 20, true))}</text>`;
    } else if (endRef) {
      html += `<text x="${left + w - padX}" y="${top + headerH / 2 + 4}" text-anchor="end" font-family="ui-monospace, Consolas, 'Courier New', monospace" font-size="9.5" fill="#857E8C">${this.escape(this._clipToWidth(endRef, 9.5, w - padX * 2 - badgeW - 24, true))}</text>`;
    }
    fieldRows.forEach((row, index) => {
      const fy = top + headerH + 16 + index * 17;
      const nx = left + padX + 4;
      html += `<text x="${nx}" y="${fy}" font-family="ui-monospace, Consolas, 'Courier New', monospace" font-size="10" font-weight="600" fill="#201D22">${this.escape(row.name)}</text>`;
      let cursor = nx + this._monoWidth(row.name, 10);
      if (row.required) {
        html += `<text x="${cursor + 1}" y="${fy}" font-family="Arial, sans-serif" font-size="10" font-weight="700" fill="#FD0966">*</text>`;
        cursor += 8;
      }
      if (row.type) {
        const type = String(row.type).toLowerCase();
        const tw = this._monoWidth(type, 8.5) + 10;
        const tx2 = nx + (metrics.nameW || 64) + 8;
        html += `<rect x="${tx2}" y="${fy - 10}" width="${tw}" height="13" rx="4" fill="#F3F1F8"/>`;
        html += `<text x="${tx2 + tw / 2}" y="${fy}" text-anchor="middle" font-family="ui-monospace, Consolas, 'Courier New', monospace" font-size="8.5" fill="#857E8C">${this.escape(type)}</text>`;
        if (row.example) {
          html += `<text x="${tx2 + tw + 8}" y="${fy}" font-family="ui-monospace, Consolas, 'Courier New', monospace" font-size="10" fill="#5B5560">${this.escape(row.example)}</text>`;
        }
      } else if (row.example) {
        html += `<text x="${cursor + 10}" y="${fy}" font-family="ui-monospace, Consolas, 'Courier New', monospace" font-size="10" fill="#5B5560">${this.escape(row.example)}</text>`;
      }
    });
    html += "</g>";
    return html;
  },

  _actionMetrics(step) {
    const title = String(step.caption || step.label || "").trim() || "Process";
    const sub = String(step.subtitle || "Off-platform").trim();
    const titleW = this._textWidth(title, 11.5);
    const subW = this._textWidth(sub.toUpperCase(), 8);
    const w = Math.max(148, 7 + 22 + 9 + Math.max(titleW, subW) + 18);
    return { w, h: 38, title, sub, mark: step.mark || "" };
  },

  _actionBox(x, y, step, size, num) {
    const metrics = size && size.title != null ? size : this._actionMetrics(step);
    const top = y - metrics.h / 2;
    const left = x - metrics.w / 2;
    let html = `<rect x="${left}" y="${top}" width="${metrics.w}" height="${metrics.h}" rx="${metrics.h / 2}" fill="#FFFFFF" stroke="${this.PROC_BD}" stroke-width="1.5" stroke-dasharray="5 4"/>`;
    const nx = left + 18;
    const cy = y;
    if (num != null) {
      html += `<circle cx="${nx}" cy="${cy}" r="11" fill="${this.PROC_BADGE}"/>`;
      html += `<text x="${nx}" y="${cy + 4}" text-anchor="middle" font-family="Arial, sans-serif" font-size="10.5" font-weight="700" fill="#FFFFFF">${num}</text>`;
    }
    const tx = nx + 20;
    html += `<text x="${tx}" y="${cy - 3}" font-family="Arial, sans-serif" font-size="11.5" font-weight="600" fill="#201D22">${this.escape(metrics.title)}</text>`;
    html += `<text x="${tx}" y="${cy + 11}" font-family="Arial, sans-serif" font-size="8" font-weight="600" letter-spacing="0.1em" fill="${this.PROC_FG}">${this.escape(metrics.sub.toUpperCase())}</text>`;
    return html;
  },

  _conditionInk(kind) {
    return "#6D28D9";
  },

  _conditionMetrics(step) {
    const question = String(step.caption || step.label || "Decide?");
    const qLines = this._wrapToWidth(question, 13, 390);
    const heading = String(step.heading || "Decision").trim() || "Decision";
    const branches = (Array.isArray(step.branches) ? step.branches : []).slice(0, 4);
    const branchMetrics = branches.map((branch, index) => this._conditionBranchMetrics(branch, index));
    const headerH = 12 + 14 + qLines.length * 16 + 10 + (step.refNum ? 14 : 0);
    const branchesH = branchMetrics.reduce((sum, item) => sum + item.h, 0);
    const w = Math.max(420, ...branchMetrics.map((item) => item.w), 48 + Math.max(...qLines.map((line) => this._textWidth(line, 13)), 120));
    const h = headerH + branchesH;
    return {
      w: Math.min(520, w),
      h,
      question: qLines,
      heading,
      refNum: step.refNum || null,
      refLabel: step.refLabel || "",
      branches: branchMetrics,
      headerH,
      kind: "Decision",
      ink: this._conditionInk(step.kind),
    };
  },

  _conditionBranchMetrics(branch, index) {
    const scheme = branch.scheme || FlowIR.branchScheme(branch, index);
    const tone = branch.tone || FlowIR.branchTone(branch, index);
    const label = String(branch.label || (scheme === "stop" ? "No" : scheme === "pending" ? "Pending" : "Yes"));
    const detail = String(branch.detail || branch.targetLabel || "").trim();
    const detailLines = detail ? this._wrapToWidth(detail, 11, 320) : [];
    const method = String(branch.method || "").toUpperCase();
    const path = String(branch.path || "").trim();
    const status = branch.status != null && branch.status !== "" ? String(branch.status) : "";
    const ends = Boolean(branch.ends);
    const continues = !ends;
    const footer = String(branch.footer || "").trim() || FlowIR.defaultBranchFooter(branch);
    const footerLines = footer ? this._wrapToWidth(footer, 9, 320) : [];
    let h = 20;
    if (detailLines.length) h += detailLines.length * 14;
    else h += 14;
    if (method || path || status) h += 18;
    if (footerLines.length) h += footerLines.length * 12 + 4;
    h += 8;
    const callW =
      (method ? this._monoWidth(method, 8.5) + 14 : 0) +
      (path ? this._monoWidth(path, 10) + 8 : 0) +
      (status ? this._monoWidth(status, 8.5) + 14 : 0) +
      70;
    const detailW = detailLines.reduce((max, line) => Math.max(max, this._textWidth(line, 11)), 0);
    const footerW = footerLines.reduce((max, line) => Math.max(max, this._textWidth(line, 9)), 0);
    const w = Math.max(360, 70 + Math.max(detailW, callW, footerW) + 30);
    return {
      scheme,
      tone,
      label,
      detailLines,
      method,
      path,
      status,
      ends,
      continues,
      footer,
      footerLines,
      targetNum: branch.targetNum || null,
      targetLabel: branch.targetLabel || "",
      h,
      w,
    };
  },

  _conditionLane(laneX, y, step, size, num, width, preferW) {
    const metrics = size && size.question ? size : this._conditionMetrics(step);
    const w = Math.min(metrics.w, preferW || metrics.w);
    const cardLeft = this._clampHopX(laneX + 74 + w / 2, w, width) - w / 2;
    const stubStart = laneX + 21;
    const stubEnd = Math.max(stubStart + 12, cardLeft);
    const diamondY = y + 16;
    const ink = "#6D28D9";
    const badge = step.refNum || step.number || num;
    let html = `<g>`;
    html += `<line x1="${stubStart}" y1="${diamondY}" x2="${stubEnd}" y2="${diamondY}" stroke="${ink}" stroke-width="2" stroke-dasharray="2 4"/>`;
    html += this._decisionDiamond(laneX, diamondY, badge, ink);
    html += this._conditionBox(cardLeft + w / 2, y + 8, step, { ...metrics, w });
    html += `</g>`;
    return html;
  },

  _decisionDiamond(cx, cy, num, ink) {
    const fill = ink || "#6D28D9";
    const size = 30;
    const half = size / 2;
    return `<g>
      <rect x="${cx - half}" y="${cy - half}" width="${size}" height="${size}" rx="9" fill="${fill}" transform="rotate(45 ${cx} ${cy})"/>
      <text x="${cx}" y="${cy + 4.5}" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="#FFFFFF">${num}</text>
    </g>`;
  },

  _conditionBox(x, y, step, size) {
    const metrics = size && size.question ? size : this._conditionMetrics(step);
    const w = metrics.w;
    const h = metrics.h;
    const left = x - w / 2;
    const top = y;
    const ink = metrics.ink || "#6D28D9";
    const tint = "#ECE5FB";
    const headerH = metrics.headerH || 42;
    const heading = String(metrics.heading || step.heading || "Decision").toUpperCase();
    const path = this._decisionCardPath(left, top, w, h);
    let html = `<g>`;
    html += `<path d="${path}" fill="#FFFFFF" stroke="${ink}" stroke-width="1.5"/>`;
    html += `<path d="${this._decisionHeaderPath(left, top, w, headerH)}" fill="${tint}"/>`;
    html += `<line x1="${left}" y1="${top + headerH}" x2="${left + w}" y2="${top + headerH}" stroke="${ink}" stroke-width="1.5"/>`;
    html += `<text x="${left + 15}" y="${top + 18}" font-family="ui-monospace, Consolas, 'Courier New', monospace" font-size="8.5" font-weight="700" letter-spacing="0.16em" fill="${ink}">${this.escape(heading)}</text>`;
    let qy = top + 36;
    if (metrics.refNum) {
      const refBits = [`STEP ${metrics.refNum}`];
      if (metrics.refLabel) refBits.push(metrics.refLabel);
      html += `<text x="${left + 15}" y="${qy}" font-family="Arial, sans-serif" font-size="9" font-weight="700" letter-spacing="0.04em" fill="${ink}">${this.escape(refBits.join(" · "))}</text>`;
      qy += 14;
    }
    metrics.question.forEach((line, index) => {
      html += `<text x="${left + 15}" y="${qy + index * 16}" font-family="Arial, sans-serif" font-size="13" font-weight="600" fill="#201D22">${this.escape(line)}</text>`;
    });
    let by = top + headerH;
    (metrics.branches || []).forEach((branch, index) => {
      html += this._conditionBranch(left, by, w, branch, index);
      by += branch.h;
    });
    html += `</g>`;
    return html;
  },

  _decisionCardPath(x, y, w, h) {
    const tl = 16;
    const tr = 16;
    const br = 16;
    const bl = 5;
    return `M${x + tl} ${y} H${x + w - tr} Q${x + w} ${y} ${x + w} ${y + tr} V${y + h - br} Q${x + w} ${y + h} ${x + w - br} ${y + h} H${x + bl} Q${x} ${y + h} ${x} ${y + h - bl} V${y + tl} Q${x} ${y} ${x + tl} ${y} Z`;
  },

  _decisionHeaderPath(x, y, w, h) {
    const tl = 16;
    const tr = 16;
    return `M${x + tl} ${y} H${x + w - tr} Q${x + w} ${y} ${x + w} ${y + tr} V${y + h} H${x} V${y + tl} Q${x} ${y} ${x + tl} ${y} Z`;
  },

  _branchSchemeStyle(scheme) {
    if (scheme === "stop") {
      return { tint: "#FCE2E8", tag: "#E11D48", tip: "#E11D48", icon: "stop" };
    }
    if (scheme === "pending") {
      return { tint: "#FEF3C7", tag: "#D97706", tip: "#9A6207", icon: "pending" };
    }
    return { tint: "#E1F5E9", tag: "#16A34A", tip: "#0E6E33", icon: "proceed" };
  },

  _branchSchemeIcon(kind, cx, cy) {
    if (kind === "stop") {
      return `<g stroke="#FFFFFF" fill="none" stroke-width="1.9" stroke-linecap="round">
        <line x1="${cx - 3.4}" y1="${cy - 3.4}" x2="${cx + 3.4}" y2="${cy + 3.4}"/>
        <line x1="${cx + 3.4}" y1="${cy - 3.4}" x2="${cx - 3.4}" y2="${cy + 3.4}"/>
      </g>`;
    }
    if (kind === "pending") {
      return `<g fill="none" stroke="#FFFFFF" stroke-width="1.7" stroke-linecap="round">
        <circle cx="${cx}" cy="${cy}" r="4.4"/>
        <line x1="${cx}" y1="${cy + 0.2}" x2="${cx}" y2="${cy - 2.4}"/>
        <line x1="${cx}" y1="${cy + 0.2}" x2="${cx + 2.1}" y2="${cy + 1.3}"/>
      </g>`;
    }
    return `<path d="M${cx - 3.8} ${cy + 0.2} l2.6 2.6 5.2-5.2" fill="none" stroke="#FFFFFF" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>`;
  },

  _conditionBranch(left, top, w, branch, index) {
    const scheme = branch.scheme || FlowIR.branchScheme?.(branch, index) || (index === 0 ? "proceed" : index === 1 ? "stop" : "pending");
    const style = this._branchSchemeStyle(scheme);
    const padX = 15;
    const padY = 10;
    const gradId = this.uid("cg");
    let html = `<g>`;
    html += `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="${style.tint}"/><stop offset="62%" stop-color="${style.tint}" stop-opacity="0"/></linearGradient></defs>`;
    html += `<rect x="${left}" y="${top}" width="${w}" height="${branch.h}" fill="url(#${gradId})"/>`;
    if (index > 0) html += `<line x1="${left}" y1="${top}" x2="${left + w}" y2="${top}" stroke="#E7E3F2"/>`;
    const tagLabel = String(branch.label || (scheme === "stop" ? "No" : scheme === "pending" ? "Pending" : "Yes")).toUpperCase();
    const tagW = Math.max(56, 22 + this._monoWidth(tagLabel, 9) + 14);
    const chipX = left + padX;
    const chipY = top + padY;
    html += `<path d="${this._chipPath(chipX, chipY, tagW, 20)}" fill="${style.tag}"/>`;
    html += this._branchSchemeIcon(style.icon, chipX + 12, chipY + 10);
    html += `<text x="${chipX + 22}" y="${chipY + 14}" font-family="ui-monospace, Consolas, 'Courier New', monospace" font-size="9" font-weight="700" letter-spacing="0.05em" fill="#FFFFFF">${this.escape(tagLabel)}</text>`;
    const bodyX = left + padX + tagW + 11;
    let ty = top + padY + 12;
    const lines = branch.detailLines?.length ? branch.detailLines : [""];
    lines.forEach((line) => {
      if (line) html += `<text x="${bodyX}" y="${ty}" font-family="Arial, sans-serif" font-size="11" font-weight="600" fill="#201D22">${this.escape(line)}</text>`;
      ty += 14;
    });
    if (branch.method || branch.path || branch.status) {
      let cx = bodyX;
      if (branch.method) {
        const methodStyle = this.methodStyle(branch.method);
        const mw = Math.max(40, this._monoWidth(branch.method, 8.5) + 12);
        html += `<path d="${this._chipPath(cx, ty - 10, mw, 16)}" fill="${methodStyle.fill}"/>`;
        html += `<text x="${cx + mw / 2}" y="${ty + 1}" text-anchor="middle" font-family="ui-monospace, Consolas, 'Courier New', monospace" font-size="8.5" font-weight="700" fill="#FFFFFF">${this.escape(branch.method)}</text>`;
        cx += mw + 6;
      }
      if (branch.path) {
        const path = this._clipToWidth(branch.path, 10, Math.max(80, left + w - cx - 60), true);
        html += `<text x="${cx}" y="${ty + 1}" font-family="ui-monospace, Consolas, 'Courier New', monospace" font-size="10" font-weight="600" fill="#201D22">${this.escape(path)}</text>`;
        cx += this._monoWidth(path, 10) + 8;
      }
      if (branch.status) {
        const st = this.hopStyle({ type: "response", status: Number(branch.status) || branch.status });
        const sw = Math.max(28, this._monoWidth(String(branch.status), 8.5) + 12);
        html += `<rect x="${cx}" y="${ty - 10}" width="${sw}" height="16" rx="4" fill="${st.fill}"/>`;
        html += `<text x="${cx + sw / 2}" y="${ty + 1}" text-anchor="middle" font-family="ui-monospace, Consolas, 'Courier New', monospace" font-size="8.5" font-weight="700" fill="#FFFFFF">${this.escape(String(branch.status))}</text>`;
      }
      ty += 18;
    }
    if (branch.ends) {
      const lines = branch.footerLines?.length ? branch.footerLines : [branch.footer || "Flow ends here"];
      lines.forEach((line, index) => {
        const prefix = index === 0 ? "▪ " : "";
        html += `<text x="${bodyX}" y="${ty + 2 + index * 12}" font-family="Arial, sans-serif" font-size="9" font-weight="700" letter-spacing="0.04em" fill="${style.tip}">${this.escape(prefix + String(line).toUpperCase())}</text>`;
      });
    } else {
      const lines = branch.footerLines?.length ? branch.footerLines : [branch.footer || "Continues below"];
      lines.forEach((line, index) => {
        const prefix = index === 0 ? "→ " : "";
        html += `<text x="${bodyX}" y="${ty + 2 + index * 12}" font-family="Arial, sans-serif" font-size="9" font-weight="700" letter-spacing="0.04em" fill="${style.tip}">${this.escape(prefix + String(line).toUpperCase())}</text>`;
      });
    }
    html += `</g>`;
    return html;
  },

  _textWidth(text, fontSize) {
    return String(text || "").length * fontSize * 0.64;
  },

  _monoWidth(text, fontSize) {
    return String(text || "").length * fontSize * 0.62;
  },

  _wrapToWidth(text, fontSize, maxW) {
    const words = String(text || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!words.length) return [""];
    const lines = [];
    let current = "";
    const wider = (value) => this._textWidth(value, fontSize) > maxW;
    words.forEach((word) => {
      if (wider(word)) {
        if (current) lines.push(current);
        current = "";
        let chunk = "";
        Array.from(word).forEach((ch) => {
          if (chunk && wider(chunk + ch)) {
            lines.push(chunk);
            chunk = ch;
          } else chunk += ch;
        });
        current = chunk;
        return;
      }
      const next = current ? `${current} ${word}` : word;
      if (current && wider(next)) {
        lines.push(current);
        current = word;
      } else current = next;
    });
    if (current) lines.push(current);
    return lines;
  },

  _wrapFieldChip(text, fontSize, maxW) {
    const raw = String(text || "");
    if (this._monoWidth(raw, fontSize) <= maxW) return [raw];
    const colon = raw.indexOf(": ");
    if (colon > 0 && colon < raw.length - 2) {
      const name = raw.slice(0, colon);
      const rest = raw.slice(colon + 2);
      return [`${name}:`, this._clipToWidth(rest, fontSize, maxW, true)];
    }
    return [this._clipToWidth(raw, fontSize, maxW, true)];
  },

  _clipToWidth(text, fontSize, maxW, mono) {
    const raw = String(text || "");
    const widthOf = (value) => (mono ? this._monoWidth(value, fontSize) : this._textWidth(value, fontSize));
    if (widthOf(raw) <= maxW) return raw;
    let keep = raw;
    while (keep.length > 1 && widthOf(`${keep}…`) > maxW) keep = keep.slice(0, -1);
    return `${keep}…`;
  },

  _wrapWords(text, maxChars) {
    const words = String(text || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!words.length) return [""];
    const lines = [];
    let current = "";
    words.forEach((word) => {
      if (word.length > maxChars) {
        if (current) lines.push(current);
        current = "";
        for (let i = 0; i < word.length; i += maxChars) lines.push(word.slice(i, i + maxChars));
        return;
      }
      const next = current ? `${current} ${word}` : word;
      if (next.length > maxChars) {
        if (current) lines.push(current);
        current = word;
      } else current = next;
    });
    if (current) lines.push(current);
    return lines;
  },

  _fitName(name, maxChars, maxLines) {
    const lines = this._wrapWords(name, maxChars);
    if (lines.length <= maxLines) return lines;
    const kept = lines.slice(0, maxLines);
    const last = kept[maxLines - 1];
    kept[maxLines - 1] = last.length >= maxChars ? `${last.slice(0, Math.max(1, maxChars - 1))}…` : `${last}…`;
    return kept;
  },
};

function flowHtml(model) {
  return FlowRender.html(model);
}
