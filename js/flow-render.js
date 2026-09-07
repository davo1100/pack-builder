const FlowRender = {
  LANE_W: 180,
  HEADER_H: 58,
  STEP_GAP: 36,
  TITLE_H: 32,
  PAD: 28,
  CARD_W: 220,
  CARD_H: 74,

  actorFill(type, presentation) {
    return FlowIR.actorPalette({ presentation }, type);
  },

  methodStyle(method) {
    const key = String(method || "").toUpperCase();
    if (key === "GET") return { fill: "#EBEAFC", stroke: "#7E6DE2", ink: "#3d3480" };
    if (key === "POST") return { fill: "#E8F5E6", stroke: "#93CD8F", ink: "#404C37" };
    if (key === "PUT" || key === "PATCH") return { fill: "#FBF6C8", stroke: "#DCC606", ink: "#404C37" };
    if (key === "DELETE") return { fill: "#FFE8DD", stroke: "#FD0966", ink: "#521D39" };
    if (key === "SOAP") return { fill: "#404C37", stroke: "#404C37", ink: "#FFFFFF" };
    return { fill: "#F2EEE2", stroke: "#404C37", ink: "#201D22" };
  },

  hopStyle(step, audience) {
    const showTech = FlowIR.audienceOf(audience) !== "process";
    if (!showTech) return { fill: "#F2EEE2", stroke: "#857D6B", ink: "#201D22" };
    if (step.type === "response" && step.status) {
      const code = Number(step.status);
      if (code >= 200 && code < 300) return this.methodStyle("POST");
      if (code >= 400 && code < 500) return this.methodStyle("DELETE");
      if (code >= 300 && code < 400) return this.methodStyle("GET");
      if (code >= 500) return { fill: "#F2EEE2", stroke: "#201D22", ink: "#201D22" };
    }
    const method = step.protocol === "SOAP" || (step.operation && !step.method) ? "SOAP" : step.method;
    return this.methodStyle(method);
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
    const views = [];
    const errors = [];
    FlowIR.VIEWERS.forEach((viewer) => {
      const drawn = this.svg(this.viewModel(source, viewer.key), { trusted: true, source });
      if (!drawn.ok) {
        errors.push(...(drawn.errors || []));
        return;
      }
      views.push({ ...viewer, svg: drawn.svg });
    });
    if (!views.length) return { ok: false, errors: errors.length ? errors : ["Could not draw the flow"], html: "" };
    const json = options?.embed === false ? "" : this.attr(JSON.stringify(source));
    const id = this.uid("pf");
    const preferred = FlowIR.audienceOf(source.presentation?.audience);
    const radios = views
      .map((view) => `<input class="pack-flow-radio" type="radio" name="${id}" id="${id}-${view.key}" value="${view.key}"${view.key === preferred ? " checked" : ""}>`)
      .join("");
    const tabs = `<div class="pack-flow-tabs" role="tablist">${views
      .map((view) => `<label class="pack-flow-tab" for="${id}-${view.key}">${this.escape(view.label)}</label>`)
      .join("")}</div>`;
    const panels = views
      .map((view) => `<div class="pack-flow-panel" data-view="${view.key}">${view.svg}</div>`)
      .join("");
    return { ok: true, errors, html: `<div class="pack-flow"${json ? ` data-flow="${json}"` : ""}>${radios}${tabs}${panels}</div>` };
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
    return `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="120" viewBox="0 0 560 120" role="img" aria-label="${this.attr(title)}">
      <rect width="560" height="120" fill="#F2EEE2" rx="12"/>
      <text x="280" y="64" text-anchor="middle" font-family="Arial, sans-serif" font-size="15" fill="#404C37">${this.escape(title)}</text>
    </svg>`;
  },

  _stepSize(step, audience) {
    if (step.type === "condition") return this._conditionMetrics(step, audience);
    if (step.type === "process") return this._actionMetrics(step);
    return this._labelMetrics(step, audience);
  },

  _sequenceRows(steps) {
    const byId = Object.fromEntries(steps.map((step) => [step.id, step]));
    const drawn = new Set();
    const rows = [];
    steps.forEach((step) => {
      if (drawn.has(step.id)) return;
      if (step.type === "condition") {
        const branches = (Array.isArray(step.branches) ? step.branches : []).slice(0, 4);
        rows.push({ kind: "condition", step, branches });
        drawn.add(step.id);
        rows.push({
          kind: "fork",
          parent: step,
          items: branches.map((branch) => {
            const target = branch.target ? byId[branch.target] : null;
            const take = Boolean(target && !drawn.has(target.id));
            if (take) drawn.add(target.id);
            return { branch, step: take ? target : null };
          }),
        });
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
    const boxW = 156;
    const nameLines = actors.map((actor) => this._fitName(actor.name, 18, 2));
    const hasLogo = actors.some((actor) => actor.logo);
    const headerH = Math.max(this.HEADER_H, hasLogo ? 78 : 0, ...nameLines.map((lines) => 22 + lines.length * 14 + 20));
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
    const gaps = rows.map((row) => {
      if (row.kind === "fork") return Math.max(this.STEP_GAP, row.h + 28);
      const step = row.step;
      const self = step && step.from && step.from === step.to && !FlowIR.isProcessHop(step);
      return Math.max(this.STEP_GAP, row.size.h + (self ? 48 : 36));
    });
    const stepsH = gaps.reduce((sum, gap) => sum + gap, 0) || this.STEP_GAP;
    const layout = this._sequenceLayout(actors, rows, boxW);
    const width = layout.width;
    const xs = layout.xs;
    const height = this.PAD + this.TITLE_H + headerH + 16 + stepsH + this.PAD;
    const marker = this.uid("m");
    const top = this.PAD + this.TITLE_H;
    const lineTop = top + headerH;
    const lineBot = height - this.PAD;
    const parts = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${this.attr(view.title)}">`,
      `<rect width="${width}" height="${height}" fill="#FFFFFF"/>`,
      `<defs><marker id="${marker}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#201D22"/></marker></defs>`,
      `<text x="${this.PAD}" y="${this.PAD + 16}" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="#201D22">${this.escape(view.title)}</text>`,
      `<text x="${width - this.PAD}" y="${this.PAD + 16}" text-anchor="end" font-family="Arial, sans-serif" font-size="11" font-weight="700" fill="#404C37">${this.escape(FlowIR.protocolLabel(view.presentation.platform, view.presentation.audience))}</text>`,
    ];
    actors.forEach((actor, index) => {
      const pal = this.actorFill(actor.type, view.presentation);
      const x = xs[actor.id] - boxW / 2;
      const boxH = headerH - 8;
      parts.push(`<line x1="${xs[actor.id]}" y1="${lineTop}" x2="${xs[actor.id]}" y2="${lineBot}" stroke="#C9C4B8" stroke-width="2"/>`);
      parts.push(`<g>`);
      parts.push(`<rect x="${x}" y="${top}" width="${boxW}" height="${boxH}" rx="10" fill="${pal.fill}"/>`);
      parts.push(this._actorFace(actor, xs[actor.id], top, boxW, pal, view.presentation.platform, nameLines[index], "lane"));
      parts.push(`</g>`);
    });
    let y = lineTop + 16;
    let forkAt = null;
    rows.forEach((row, index) => {
      if (row.kind === "condition") {
        const actorId = row.step.actor || row.step.from || actors[0]?.id;
        const x = this._clampHopX(xs[actorId] || this.PAD + this.LANE_W / 2, row.size.w, width);
        parts.push(this._conditionBox(x, y, row.step, row.size));
        forkAt = { x, y: y + row.size.h, size: row.size, ink: row.size.ink };
      } else if (row.kind === "fork") {
        parts.push(this._forkRow(forkAt, row, y, width, marker, audience));
        forkAt = null;
      } else {
        parts.push(this._laneStep(row.step, row.size, y, xs, actors, width, marker));
      }
      y += gaps[index];
    });
    parts.push("</svg>");
    return parts.join("");
  },

  _laneStep(step, size, y, xs, actors, width, marker) {
    if (step.type === "condition") {
      const actorId = step.actor || step.from || actors[0]?.id;
      const x = this._clampHopX(xs[actorId] || this.PAD + this.LANE_W / 2, size.w, width);
      return this._conditionBox(x, y, step, size);
    }
    if (step.type === "process" && !FlowIR.isProcessHop(step)) {
      const actorId = step.actor || step.from || actors[0]?.id;
      const x = this._clampHopX(xs[actorId] || this.PAD + this.LANE_W / 2, size.w, width);
      return this._actionBox(x, y, step, size);
    }
    const fallbackX = xs[actors[0]?.id] || this.PAD + this.LANE_W / 2;
    const x1 = xs[step.from] ?? fallbackX;
    const x2 = xs[step.to] ?? fallbackX;
    const arrowY = y + size.h + 8;
    const hopX = this._clampHopX((x1 + x2) / 2, size.w, width);
    if (step.type === "process") {
      return this._actionBox(hopX, y, step, size) + this._messageArrow(x1, x2, arrowY, step, marker);
    }
    return this._labelGroup(hopX, arrowY, step, size) + this._messageArrow(x1, x2, arrowY, step, marker);
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
    if (step.type === "process") return this._actionBox(x, y, step, size);
    return this._labelGroup(x, y + size.h + 4, step, size);
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
    const cardH = Math.max(this.CARD_H, hasLogo ? 92 : 0, 28 + Math.max(...nameLines.map((lines) => lines.length), 1) * 16 + 22);
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
      `<rect width="${width}" height="${height}" fill="#FFFFFF"/>`,
      `<defs><marker id="${marker}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#201D22"/></marker></defs>`,
      `<text x="${this.PAD}" y="${this.PAD + 16}" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="#201D22">${this.escape(view.title)}</text>`,
      `<text x="${width - this.PAD}" y="${this.PAD + 16}" text-anchor="end" font-family="Arial, sans-serif" font-size="11" font-weight="700" fill="#404C37">${this.escape(FlowIR.protocolLabel(view.presentation.platform, view.presentation.audience))}</text>`,
    ];
    boxes.forEach((box) => {
      const pal = this.actorFill(box.actor.type, view.presentation);
      const lines = this._fitName(box.actor.name, 24, 2);
      parts.push(`<g>`);
      parts.push(`<rect x="${box.x}" y="${box.y}" width="${this.CARD_W}" height="${box.h}" rx="12" fill="${pal.fill}"/>`);
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
      const dashed = step.type === "response" ? ' stroke-dasharray="6 5"' : "";
      const hopSize = step.type === "process" ? this._actionMetrics(step) : this._labelMetrics(step, view.presentation.audience);
      const hopX = this._clampHopX((x1 + x2) / 2, hopSize.w, width);
      parts.push(`<path d="M${x1} ${y1} L${x1} ${midY} L${x2} ${midY} L${x2} ${y2 - 8}" fill="none" stroke="#201D22" stroke-width="1.75"${dashed} marker-end="url(#${marker})"/>`);
      parts.push(step.type === "process" ? this._actionBox(hopX, midY - hopSize.h - 4, step, hopSize) : this._labelGroup(hopX, midY - 4, step, hopSize));
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
    const sub = this._actorProtocol(actor, platform);
    const logo = actor?.logo ? String(actor.logo) : "";
    if (logo) {
      const logoW = size === "card" ? 132 : 108;
      const logoH = size === "card" ? 40 : 32;
      const lx = cx - logoW / 2;
      const ly = top + (size === "card" ? 12 : 8);
      return [
        `<title>${this.escape(actor.name)}</title>`,
        `<rect x="${lx - 6}" y="${ly - 3}" width="${logoW + 12}" height="${logoH + 6}" rx="6" fill="#FFFFFF"/>`,
        `<image href="${this.attr(logo)}" x="${lx}" y="${ly}" width="${logoW}" height="${logoH}" preserveAspectRatio="xMidYMid meet"/>`,
        `<text x="${cx}" y="${ly + logoH + 16}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${size === "card" ? 11 : 10}" fill="${pal.sub}">${this.escape(sub)}</text>`,
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
      const need = size.w + 36;
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
        spanBox(row.step.actor || row.step.from, row.size);
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

  _messageArrow(x1, x2, y, step, marker) {
    const dashed = step.type === "response" ? ' stroke-dasharray="6 5"' : "";
    const mark = ` marker-end="url(#${marker})"`;
    if (Math.abs(x2 - x1) < 12) {
      const loop = 42;
      return `<path d="M${x1} ${y} C${x1 + loop} ${y},${x1 + loop} ${y + 18},${x1 + 8} ${y + 18}" fill="none" stroke="#201D22" stroke-width="1.75"${dashed}${mark}/>`;
    }
    const dir = x2 >= x1 ? 1 : -1;
    return `<line x1="${x1}" y1="${y}" x2="${x2 - 10 * dir}" y2="${y}" stroke="#201D22" stroke-width="1.75"${dashed}${mark}/>`;
  },

  _labelMetrics(step, audience) {
    const showTech = FlowIR.audienceOf(audience) !== "process";
    const style = this.hopStyle(step, audience);
    const method = step.protocol === "SOAP" || (step.operation && !step.method) ? "SOAP" : step.method;
    const badge = showTech && method && step.type === "request" ? method : showTech && step.status ? String(step.status) : "";
    const padX = 16;
    const padY = 12;
    const maxInner = 300;
    const badgeW = badge ? Math.max(36, this._monoWidth(badge, 9) + 16) : 0;
    const badgeGap = badge ? 8 : 0;
    const captionLines = this._wrapToWidth(step.caption || step.label || "", 11, Math.max(72, maxInner - badgeW - badgeGap));
    const fields = (Array.isArray(step.fieldChips) ? step.fieldChips : []).flatMap((line) => this._wrapFieldChip(line, 9, maxInner));
    const captionW = Math.max(...captionLines.map((line) => this._textWidth(line, 11)), 40);
    const fieldW = fields.length ? Math.max(...fields.map((line) => this._monoWidth(line, 9))) : 0;
    const innerW = Math.max(badgeW + badgeGap + captionW, fieldW, 72);
    const w = innerW + padX * 2;
    const headerH = Math.max(18, captionLines.length * 15);
    const hasFields = fields.length > 0;
    const fieldLead = 16;
    const h = hasFields ? padY + headerH + 10 + 16 + (fields.length - 1) * fieldLead + 16 : padY + headerH + padY;
    const radius = hasFields || captionLines.length > 1 ? 12 : Math.round(h / 2);
    return { w, h, badge, badgeW, captionLines, fields, style, headerH, padX, padY, radius, hasFields, fieldLead };
  },

  _labelGroup(x, y, step, size) {
    const metrics = size && size.captionLines ? size : this._labelMetrics(step, "developer");
    const { w, h, badge, badgeW, captionLines, fields, style } = metrics;
    const padX = metrics.padX ?? 16;
    const padY = metrics.padY ?? 12;
    const headerH = metrics.headerH || Math.max(18, Math.max(captionLines.length, 1) * 15);
    const fieldLead = metrics.fieldLead || 16;
    const radius = metrics.radius ?? (fields.length ? 12 : Math.round(h / 2));
    const top = y - h - 4;
    const left = x - w / 2;
    const stroke = step.unsupported ? "#FD0966" : style.stroke;
    const fill = fields.length ? style.fill : "#FFFFFF";
    let html = `<g><rect x="${left}" y="${top}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="1.25"/>`;
    const badgeX = left + padX;
    const badgeY = top + padY;
    if (badge) {
      html += `<rect x="${badgeX}" y="${badgeY}" width="${badgeW}" height="18" rx="5" fill="#FFFFFF" stroke="${style.stroke}"/>`;
      html += `<text x="${badgeX + badgeW / 2}" y="${badgeY + 13}" text-anchor="middle" font-family="Consolas, monospace" font-size="9" font-weight="700" fill="${style.ink}">${this.escape(badge)}</text>`;
    }
    const tx = badgeX + badgeW + (badge ? 8 : 0);
    captionLines.forEach((line, index) => {
      html += `<text x="${tx}" y="${badgeY + 13 + index * 15}" font-family="Arial, sans-serif" font-size="11" fill="#201D22">${this.escape(line)}</text>`;
    });
    if (fields.length) {
      const ruleY = top + padY + headerH + 10;
      html += `<line x1="${left + padX}" y1="${ruleY}" x2="${left + w - padX}" y2="${ruleY}" stroke="${style.stroke}" stroke-opacity="0.35" stroke-width="1"/>`;
      const fieldX = left + padX;
      const fieldTop = ruleY + 16;
      fields.forEach((line, index) => {
        html += `<text x="${fieldX}" y="${fieldTop + index * fieldLead}" font-family="Consolas, monospace" font-size="9" fill="#404C37">${this.escape(line)}</text>`;
      });
    }
    html += "</g>";
    return html;
  },

  _actionMetrics(step) {
    const lines = this._fitName(step.caption || step.label || "", 22, 2);
    const sub = step.subtitle ? this._fitName(step.subtitle, 24, 1) : [];
    const markW = step.mark ? 16 : 0;
    const w = Math.max(148, ...lines.map((line) => this._textWidth(line, 12) + 36 + markW), ...sub.map((line) => this._textWidth(line, 10) + 28));
    return { w, h: 20 + lines.length * 16 + (sub.length ? 14 : 0) + 14, lines, sub, mark: step.mark || "" };
  },

  _actionBox(x, y, step, size) {
    const metrics = size && size.lines ? size : this._actionMetrics(step);
    const top = y;
    const left = x - metrics.w / 2;
    const mark = metrics.mark === "ok" ? "✓" : metrics.mark === "current" ? "→" : metrics.mark === "pending" ? "·" : "";
    let html = `<rect x="${left}" y="${top}" width="${metrics.w}" height="${metrics.h}" rx="16" fill="#F7F4EA" stroke="#404C37"/>`;
    const textX = x + (mark ? 8 : 0);
    metrics.lines.forEach((line, index) => {
      html += `<text x="${textX}" y="${top + 22 + index * 16}" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" fill="#201D22">${this.escape(line)}</text>`;
    });
    if (mark) {
      html += `<text x="${left + 16}" y="${top + 22}" font-family="Arial, sans-serif" font-size="12" fill="#404C37">${mark}</text>`;
    }
    metrics.sub.forEach((line, index) => {
      html += `<text x="${x}" y="${top + 22 + metrics.lines.length * 16 + 12 + index * 12}" text-anchor="middle" font-family="Arial, sans-serif" font-size="10" fill="#857D6B">${this.escape(line)}</text>`;
    });
    return html;
  },

  _conditionInk(kind) {
    if (kind === "http") return "#404C37";
    if (kind === "capability") return "#FD0966";
    if (kind === "routing") return "#201D22";
    return "#7E6DE2";
  },

  _conditionMetrics(step) {
    const question = this._fitName(step.caption || step.label || "Decide?", 20, 2);
    const branches = (Array.isArray(step.branches) ? step.branches : []).slice(0, 4);
    const kind = step.kindLabel || "";
    const qW = Math.max(...question.map((line) => this._textWidth(line, 11)), 88);
    const w = Math.max(128, qW + 20);
    const h = (kind ? 12 : 4) + 26 + question.length * 13 + 8;
    return { w, h, question, branches, kind, ink: this._conditionInk(step.kind) };
  },

  _conditionBox(x, y, step, size) {
    const metrics = size && size.question ? size : this._conditionMetrics(step);
    const ink = metrics.ink || "#7E6DE2";
    let top = y + 2;
    let html = "";
    if (metrics.kind) {
      html += `<text x="${x}" y="${top + 9}" text-anchor="middle" font-family="Arial, sans-serif" font-size="8" font-weight="700" letter-spacing="0.08em" fill="${ink}">${this.escape(metrics.kind.toUpperCase())}</text>`;
      top += 12;
    }
    const d = 9;
    const cy = top + d + 2;
    html += `<path d="M${x} ${cy - d} L${x + d} ${cy} L${x} ${cy + d} L${x - d} ${cy} Z" fill="#FFFFFF" stroke="${ink}" stroke-width="1.5"/>`;
    const qTop = cy + d + 14;
    metrics.question.forEach((line, index) => {
      html += `<text x="${x}" y="${qTop + index * 13}" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" fill="#201D22">${this.escape(line)}</text>`;
    });
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
