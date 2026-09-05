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

  svg(model) {
    const presented = FlowIR.present(model);
    if (!presented.ok) return { ok: false, errors: presented.errors, svg: "" };
    const view = presented.view;
    if (!view.actors.length) {
      return { ok: true, errors: [], svg: this._emptySvg(view.title || "API flow") };
    }
    const svg = view.presentation.layout === "architecture" ? this._architecture(view) : this._sequence(view);
    return { ok: true, errors: [], svg };
  },

  html(model) {
    const checked = FlowIR.validate(model);
    if (!checked.ok) return { ok: false, errors: checked.errors, html: "" };
    const source = FlowIR.normalize(checked.model);
    source.presentation.audience = "developer";
    const views = [];
    const errors = [];
    FlowIR.VIEWERS.forEach((viewer) => {
      const drawn = this.svg(FlowIR.forView(source, viewer.key));
      if (!drawn.ok) {
        errors.push(...(drawn.errors || []));
        return;
      }
      views.push({ ...viewer, svg: drawn.svg });
    });
    if (!views.length) return { ok: false, errors: errors.length ? errors : ["Could not draw the flow"], html: "" };
    const json = this.attr(JSON.stringify(source));
    const id = this.uid("pf");
    const radios = views
      .map((view, index) => `<input class="pack-flow-radio" type="radio" name="${id}" id="${id}-${view.key}" value="${view.key}"${index === 0 ? " checked" : ""}>`)
      .join("");
    const tabs = `<div class="pack-flow-tabs" role="tablist">${views
      .map((view) => `<label class="pack-flow-tab" for="${id}-${view.key}">${this.escape(view.label)}</label>`)
      .join("")}</div>`;
    const panels = views
      .map((view) => `<div class="pack-flow-panel" data-view="${view.key}">${view.svg}</div>`)
      .join("");
    return { ok: true, errors, html: `<div class="pack-flow" data-flow="${json}">${radios}${tabs}${panels}</div>` };
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

  _emptySvg(title) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="120" viewBox="0 0 560 120" role="img" aria-label="${this.attr(title)}">
      <rect width="560" height="120" fill="#F2EEE2" rx="12"/>
      <text x="280" y="64" text-anchor="middle" font-family="Arial, sans-serif" font-size="15" fill="#404C37">${this.escape(title)}</text>
    </svg>`;
  },

  _sequence(view) {
    const actors = view.actors;
    const steps = view.steps;
    const audience = view.presentation.audience;
    const boxW = 156;
    const nameLines = actors.map((actor) => this._fitName(actor.name, 18, 2));
    const hasLogo = actors.some((actor) => actor.logo);
    const headerH = Math.max(this.HEADER_H, hasLogo ? 78 : 0, ...nameLines.map((lines) => 22 + lines.length * 14 + 20));
    const metrics = steps.map((step) =>
      step.type === "process" || step.type === "condition" ? this._processMetrics(step) : this._labelMetrics(step, audience)
    );
    const gaps = metrics.map((item, index) => {
      const step = steps[index];
      const self = step && step.from && step.from === step.to;
      return Math.max(this.STEP_GAP, item.h + (self ? 48 : 36));
    });
    const stepsH = gaps.reduce((sum, gap) => sum + gap, 0) || this.STEP_GAP;
    const layout = this._sequenceLayout(actors, steps, metrics, boxW);
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
    steps.forEach((step, index) => {
      const size = metrics[index];
      if (step.type === "process" || step.type === "condition") {
        const actorId = step.actor || step.from || actors[0]?.id;
        const x = this._clampHopX(xs[actorId] || this.PAD + this.LANE_W / 2, size.w, width);
        parts.push(this._processBox(x, y, step, size));
      } else {
        const x1 = xs[step.from];
        const x2 = xs[step.to];
        if (x1 != null && x2 != null) {
          const arrowY = y + size.h + 8;
          const hopX = this._clampHopX((x1 + x2) / 2, size.w, width);
          parts.push(this._labelGroup(hopX, arrowY, step, size));
          parts.push(this._messageArrow(x1, x2, arrowY, step, marker));
        }
      }
      y += gaps[index];
    });
    parts.push("</svg>");
    return parts.join("");
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
      if (step.type === "process" || step.type === "condition") return;
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
      const hopSize = this._labelMetrics(step, view.presentation.audience);
      const hopX = this._clampHopX((x1 + x2) / 2, hopSize.w, width);
      parts.push(`<path d="M${x1} ${y1} L${x1} ${midY} L${x2} ${midY} L${x2} ${y2 - 8}" fill="none" stroke="#201D22" stroke-width="1.75"${dashed} marker-end="url(#${marker})"/>`);
      parts.push(this._labelGroup(hopX, midY - 4, step, hopSize));
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

  _sequenceLayout(actors, steps, metrics, boxW) {
    const n = actors.length;
    const indexOf = Object.fromEntries(actors.map((actor, index) => [actor.id, index]));
    const gaps = Array(Math.max(0, n - 1)).fill(this.LANE_W);
    steps.forEach((step, index) => {
      if (step.type === "process" || step.type === "condition") return;
      const from = indexOf[step.from];
      const to = indexOf[step.to];
      if (from == null || to == null || from === to) return;
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);
      const need = metrics[index].w + 36;
      const span = gaps.slice(lo, hi).reduce((sum, gap) => sum + gap, 0);
      if (need > span) {
        const bump = (need - span) / (hi - lo);
        for (let i = lo; i < hi; i += 1) gaps[i] += bump;
      }
    });
    const xsArr = [this.PAD + this.LANE_W / 2];
    gaps.forEach((gap, index) => xsArr.push(xsArr[index] + gap));
    let minX = xsArr[0] - boxW / 2;
    let maxX = xsArr[n - 1] + boxW / 2;
    steps.forEach((step, index) => {
      const size = metrics[index];
      if (step.type === "process" || step.type === "condition") {
        const i = indexOf[step.actor || step.from] ?? 0;
        minX = Math.min(minX, xsArr[i] - size.w / 2);
        maxX = Math.max(maxX, xsArr[i] + size.w / 2);
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
    const method = step.protocol === "SOAP" || (step.operation && !step.method) ? "SOAP" : step.method;
    const showTech = FlowIR.audienceOf(audience) !== "process";
    const style = showTech ? this.methodStyle(method) : { fill: "#F2EEE2", stroke: "#857D6B", ink: "#201D22" };
    const badge = showTech && method && step.type === "request" ? method : showTech && step.status ? String(step.status) : "";
    const captionLines = this._wrapWords(step.caption || step.label || "", 42);
    const fields = (Array.isArray(step.fieldChips) ? step.fieldChips : []).flatMap((line) => this._wrapWords(line, 64));
    const badgeW = badge ? Math.max(36, badge.length * 7 + 12) : 0;
    const captionW = Math.max(...captionLines.map((line) => this._textWidth(line, 11)), 48);
    const fieldW = fields.length ? Math.max(...fields.map((line) => this._textWidth(line, 9))) : 0;
    const w = Math.max(badgeW + captionW + (badge ? 28 : 24), fieldW + 24, 88);
    const captionH = Math.max(captionLines.length, 1) * 14;
    const fieldGap = fields.length ? 22 : 0;
    const fieldH = fields.length * 16;
    const h = 10 + captionH + fieldGap + fieldH + 12;
    return { w, h, badge, badgeW, captionLines, fields, style, captionH, fieldGap };
  },

  _labelGroup(x, y, step, size) {
    const metrics = size && size.captionLines ? size : this._labelMetrics(step, "developer");
    const { w, h, badge, badgeW, captionLines, fields, style } = metrics;
    const top = y - h - 4;
    const left = x - w / 2;
    const unsupported = step.unsupported ? ` stroke="#FD0966"` : ` stroke="${style.stroke}"`;
    let html = `<g><rect x="${left}" y="${top}" width="${w}" height="${h}" rx="6" fill="#FFFFFF"${unsupported}/>`;
    const captionY = top + 16;
    if (badge) {
      html += `<rect x="${left + 4}" y="${top + 6}" width="${badgeW}" height="14" rx="4" fill="${style.fill}" stroke="${style.stroke}"/>`;
      html += `<text x="${left + 4 + badgeW / 2}" y="${captionY}" text-anchor="middle" font-family="Consolas, monospace" font-size="9" font-weight="700" fill="${style.ink}">${this.escape(badge)}</text>`;
    }
    const tx = left + 10 + badgeW + (badge ? 6 : 0);
    captionLines.forEach((line, index) => {
      html += `<text x="${tx}" y="${captionY + index * 14}" font-family="Arial, sans-serif" font-size="11" fill="#201D22">${this.escape(line)}</text>`;
    });
    const captionH = metrics.captionH || Math.max(captionLines.length, 1) * 14;
    const fieldGap = metrics.fieldGap || (fields.length ? 22 : 0);
    if (fields.length) {
      const ruleY = top + 10 + captionH + 8;
      html += `<line x1="${left + 8}" y1="${ruleY}" x2="${left + w - 8}" y2="${ruleY}" stroke="#E4DFD4" stroke-width="1"/>`;
    }
    const fieldX = left + 10;
    const fieldTop = top + 10 + captionH + fieldGap + 10;
    fields.forEach((line, index) => {
      html += `<text x="${fieldX}" y="${fieldTop + index * 16}" font-family="Consolas, monospace" font-size="9" fill="#404C37">${this.escape(line)}</text>`;
    });
    html += "</g>";
    return html;
  },

  _processMetrics(step) {
    const lines = this._fitName(step.caption || step.label || "", 26, 3);
    const w = Math.max(136, ...lines.map((line) => this._textWidth(line, 11) + 20), step.type === "condition" ? 150 : 136);
    return { w, h: 12 + lines.length * 14, lines, round: step.type === "condition" ? 16 : 8 };
  },

  _processBox(x, y, step, size) {
    const metrics = size && size.lines ? size : this._processMetrics(step);
    const top = y;
    let html = `<rect x="${x - metrics.w / 2}" y="${top}" width="${metrics.w}" height="${metrics.h}" rx="${metrics.round}" fill="#F2EEE2" stroke="#404C37"/>`;
    metrics.lines.forEach((line, index) => {
      html += `<text x="${x}" y="${top + 16 + index * 14}" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" fill="#201D22">${this.escape(line)}</text>`;
    });
    return html;
  },

  _textWidth(text, fontSize) {
    return String(text || "").length * fontSize * 0.64;
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
