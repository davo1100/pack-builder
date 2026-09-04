const DIAGRAM_FILLS = {
  charcoal: { fill: "#201D22", title: "#FFFFFF", sub: "#F2EEE2" },
  olive: { fill: "#404C37", title: "#FFFFFF", sub: "#F2EEE2" },
  violet: { fill: "#7E6DE2", title: "#FFFFFF", sub: "#EBEAFC" },
  magenta: { fill: "#FD0966", title: "#FFFFFF", sub: "#FFE8DD" },
};

function diagramUid() {
  return "n" + Math.random().toString(36).slice(2, 8);
}

function snap(value) {
  return Math.round(value / 10) * 10;
}

function nodeCenter(node) {
  return { x: node.x + node.w / 2, y: node.y + node.h / 2 };
}

function nodeSides(node) {
  const c = nodeCenter(node);
  return {
    left: { x: node.x, y: c.y },
    right: { x: node.x + node.w, y: c.y },
    top: { x: c.x, y: node.y },
    bottom: { x: c.x, y: node.y + node.h },
  };
}

function sideNameFromPoint(node, pt) {
  const sides = nodeSides(node);
  let best = "right";
  let dist = Infinity;
  for (const [name, point] of Object.entries(sides)) {
    const d = (point.x - pt.x) ** 2 + (point.y - pt.y) ** 2;
    if (d < dist) {
      dist = d;
      best = name;
    }
  }
  return best;
}

function attachFromPoint(model, pt, excludeId) {
  const node = [...model.nodes].reverse().find((item) => {
    if (item.id === excludeId) return false;
    return pt.x >= item.x - 12 && pt.x <= item.x + item.w + 12 && pt.y >= item.y - 12 && pt.y <= item.y + item.h + 12;
  });
  if (!node) return { node: null, side: null, x: snap(pt.x), y: snap(pt.y) };
  const side = sideNameFromPoint(node, pt);
  const anchor = nodeSides(node)[side];
  return { node, side, x: anchor.x, y: anchor.y };
}

function paletteFor(fill) {
  const hex = String(fill || "#201D22");
  const match = Object.values(DIAGRAM_FILLS).find((item) => item.fill.toLowerCase() === hex.toLowerCase());
  if (match) return match;
  if (!hex.startsWith("#") || hex.length < 7) return DIAGRAM_FILLS.charcoal;
  const n = parseInt(hex.slice(1, 7), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const light = r * 0.3 + g * 0.59 + b * 0.11 > 160;
  return { fill: hex, title: light ? "#201D22" : "#FFFFFF", sub: light ? "#404C37" : "#F2EEE2" };
}

function defaultDiagram() {
  return {
    width: 860,
    height: 220,
    nodes: [
      { id: "a", type: "box", x: 20, y: 70, w: 180, h: 80, title: "Start", subtitle: "First step", fill: "#201D22" },
      { id: "b", type: "box", x: 340, y: 70, w: 180, h: 80, title: "Process", subtitle: "API / action", fill: "#7E6DE2" },
      { id: "c", type: "box", x: 660, y: 70, w: 180, h: 80, title: "Result", subtitle: "Outcome", fill: "#404C37" },
    ],
    edges: [
      { id: "e1", from: "a", to: "b", fromSide: "right", toSide: "left", route: "straight", heads: "end", label: "" },
      { id: "e2", from: "b", to: "c", fromSide: "right", toSide: "left", route: "straight", heads: "end", label: "" },
    ],
  };
}

function edgeEnds(model, edge) {
  const fromNode = edge.from ? model.nodes.find((n) => n.id === edge.from) : null;
  const toNode = edge.to ? model.nodes.find((n) => n.id === edge.to) : null;
  const start = fromNode
    ? nodeSides(fromNode)[edge.fromSide || "right"]
    : { x: edge.x1, y: edge.y1 };
  const end = toNode
    ? nodeSides(toNode)[edge.toSide || "left"]
    : { x: edge.x2, y: edge.y2 };
  if (start.x == null || end.x == null) return null;
  return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
}

function edgePath(ends, route, fromSide) {
  if (route !== "elbow") return `M ${ends.x1} ${ends.y1} L ${ends.x2} ${ends.y2}`;
  const verticalStart = fromSide === "top" || fromSide === "bottom";
  if (verticalStart) {
    const midY = (ends.y1 + ends.y2) / 2;
    return `M ${ends.x1} ${ends.y1} L ${ends.x1} ${midY} L ${ends.x2} ${midY} L ${ends.x2} ${ends.y2}`;
  }
  const midX = (ends.x1 + ends.x2) / 2;
  return `M ${ends.x1} ${ends.y1} L ${midX} ${ends.y1} L ${midX} ${ends.y2} L ${ends.x2} ${ends.y2}`;
}

function distToSegment(pt, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy || 1;
  let t = ((pt.x - x1) * dx + (pt.y - y1) * dy) / len;
  t = Math.max(0, Math.min(1, t));
  const x = x1 + t * dx;
  const y = y1 + t * dy;
  return Math.hypot(pt.x - x, pt.y - y);
}

function distToPath(pt, ends, route, fromSide) {
  if (route !== "elbow") return distToSegment(pt, ends.x1, ends.y1, ends.x2, ends.y2);
  const verticalStart = fromSide === "top" || fromSide === "bottom";
  if (verticalStart) {
    const midY = (ends.y1 + ends.y2) / 2;
    return Math.min(
      distToSegment(pt, ends.x1, ends.y1, ends.x1, midY),
      distToSegment(pt, ends.x1, midY, ends.x2, midY),
      distToSegment(pt, ends.x2, midY, ends.x2, ends.y2)
    );
  }
  const midX = (ends.x1 + ends.x2) / 2;
  return Math.min(
    distToSegment(pt, ends.x1, ends.y1, midX, ends.y1),
    distToSegment(pt, midX, ends.y1, midX, ends.y2),
    distToSegment(pt, midX, ends.y2, ends.x2, ends.y2)
  );
}

function renderDiagramSvg(model, opts) {
  const options = opts || {};
  const markerId = options.markerId || "diagram-arrow";
  const startId = markerId + "-start";
  const selectedId = options.selectedId || "";
  const parts = [];
  parts.push(
    `<svg width="${model.width}" height="${model.height}" viewBox="0 0 ${model.width} ${model.height}" style="max-width:100%; height:auto;" xmlns="http://www.w3.org/2000/svg">`
  );
  parts.push(
    `<defs>
      <marker id="${markerId}" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="#857D6B"/></marker>
      <marker id="${startId}" markerWidth="10" markerHeight="7" refX="1" refY="3.5" orient="auto"><polygon points="10 0, 0 3.5, 10 7" fill="#857D6B"/></marker>
    </defs>`
  );
  if (options.grid) {
    parts.push(`<rect width="100%" height="100%" fill="#F2EEE2"/>`);
    for (let x = 0; x <= model.width; x += 20) {
      parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${model.height}" stroke="#e4dfd3" stroke-width="1"/>`);
    }
    for (let y = 0; y <= model.height; y += 20) {
      parts.push(`<line x1="0" y1="${y}" x2="${model.width}" y2="${y}" stroke="#e4dfd3" stroke-width="1"/>`);
    }
  }
  for (const edge of model.edges) {
    const ends = edgeEnds(model, edge);
    if (!ends) continue;
    const selected = edge.id === selectedId;
    const d = edgePath(ends, edge.route || "straight", edge.fromSide);
    const heads = edge.heads || "end";
    const markerEnd = heads === "end" || heads === "both" ? `url(#${markerId})` : "none";
    const markerStart = heads === "start" || heads === "both" ? `url(#${startId})` : "none";
    parts.push(
      `<path d="${d}" fill="none" stroke="${selected ? "#FD0966" : "#857D6B"}" stroke-width="${selected ? 3 : 2}" marker-end="${markerEnd}" marker-start="${markerStart}"/>`
    );
    if (edge.label) {
      const lx = (ends.x1 + ends.x2) / 2;
      const ly = (ends.y1 + ends.y2) / 2 - 8;
      parts.push(
        `<text x="${lx}" y="${ly}" fill="#201D22" font-size="11" font-weight="bold" text-anchor="middle" font-family="Arial, Helvetica, sans-serif">${escapeXml(edge.label)}</text>`
      );
    }
    if (options.edit && selected) {
      parts.push(`<circle cx="${ends.x1}" cy="${ends.y1}" r="6" fill="#fff" stroke="#FD0966" stroke-width="2"/>`);
      parts.push(`<circle cx="${ends.x2}" cy="${ends.y2}" r="6" fill="#fff" stroke="#FD0966" stroke-width="2"/>`);
    }
  }
  if (options.draft) {
    const draft = options.draft;
    parts.push(
      `<line x1="${draft.x1}" y1="${draft.y1}" x2="${draft.x2}" y2="${draft.y2}" stroke="#FD0966" stroke-width="2" stroke-dasharray="6 4" marker-end="url(#${markerId})"/>`
    );
  }
  for (const node of model.nodes) {
    const colors = paletteFor(node.fill);
    const selected = node.id === selectedId;
    const stroke = selected ? "#FD0966" : "none";
    const sw = selected ? 3 : 0;
    if (node.type === "diamond") {
      const cx = node.x + node.w / 2;
      const cy = node.y + node.h / 2;
      const points = `${cx},${node.y} ${node.x + node.w},${cy} ${cx},${node.y + node.h} ${node.x},${cy}`;
      parts.push(
        `<polygon points="${points}" fill="${colors.fill}" stroke="${stroke}" stroke-width="${sw}" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.15))"/>`
      );
    } else {
      const rx = node.type === "round" ? node.h / 2 : 8;
      parts.push(
        `<rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="${rx}" fill="${colors.fill}" stroke="${stroke}" stroke-width="${sw}" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.15))"/>`
      );
    }
    const cx = node.x + node.w / 2;
    const titleY = node.subtitle ? node.y + node.h / 2 - 4 : node.y + node.h / 2 + 5;
    parts.push(
      `<text x="${cx}" y="${titleY}" fill="${colors.title}" font-size="13" font-weight="bold" text-anchor="middle" font-family="Arial, Helvetica, sans-serif">${escapeXml(node.title || "")}</text>`
    );
    if (node.subtitle) {
      parts.push(
        `<text x="${cx}" y="${titleY + 18}" fill="${colors.sub}" font-size="11" text-anchor="middle" font-family="Arial, Helvetica, sans-serif">${escapeXml(node.subtitle)}</text>`
      );
    }
  }
  parts.push("</svg>");
  return parts.join("");
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function parseDiagram(container) {
  const raw = container.getAttribute("data-diagram");
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch (err) {
      /* fall through */
    }
  }
  const svg = container.querySelector("svg");
  if (!svg) return defaultDiagram();
  const view = svg.viewBox.baseVal;
  const model = {
    width: Math.round(view.width || Number(svg.getAttribute("width")) || 860),
    height: Math.round(view.height || Number(svg.getAttribute("height")) || 220),
    nodes: [],
    edges: [],
  };
  const texts = [...svg.querySelectorAll("text")];
  svg.querySelectorAll("rect").forEach((rect) => {
    if (!rect.getAttribute("x")) return;
    const x = Number(rect.getAttribute("x"));
    const y = Number(rect.getAttribute("y"));
    const w = Number(rect.getAttribute("width"));
    const h = Number(rect.getAttribute("height"));
    const cx = x + w / 2;
    const nearby = texts
      .filter((text) => Math.abs(Number(text.getAttribute("x")) - cx) < w / 2 + 4)
      .filter((text) => {
        const ty = Number(text.getAttribute("y"));
        return ty >= y && ty <= y + h + 6;
      })
      .sort((a, b) => Number(a.getAttribute("y")) - Number(b.getAttribute("y")));
    model.nodes.push({
      id: diagramUid(),
      type: Number(rect.getAttribute("rx") || 0) > h / 3 ? "round" : "box",
      x,
      y,
      w,
      h,
      title: (nearby[0]?.textContent || "Step").trim(),
      subtitle: (nearby[1]?.textContent || "").trim(),
      fill: String(rect.getAttribute("fill") || "#201D22").startsWith("url")
        ? "#201D22"
        : rect.getAttribute("fill") || "#201D22",
    });
  });
  svg.querySelectorAll("line").forEach((line) => {
    const x1 = Number(line.getAttribute("x1"));
    const y1 = Number(line.getAttribute("y1"));
    const x2 = Number(line.getAttribute("x2"));
    const y2 = Number(line.getAttribute("y2"));
    const start = attachFromPoint(model, { x: x1, y: y1 });
    const end = attachFromPoint(model, { x: x2, y: y2 });
    model.edges.push({
      id: diagramUid(),
      from: start.node?.id || null,
      to: end.node?.id || null,
      fromSide: start.side,
      toSide: end.side,
      x1,
      y1,
      x2,
      y2,
      route: "straight",
      heads: "end",
      label: "",
    });
  });
  return model.nodes.length ? model : defaultDiagram();
}

function diagramHtml(model) {
  const markerId = "arrow-" + diagramUid();
  const svg = renderDiagramSvg(model, { markerId });
  const json = JSON.stringify(model).replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  return `<div class="diagram-container" data-diagram="${json}">${svg}</div>`;
}

const DiagramEditor = {
  model: null,
  selectedId: null,
  selectedKind: "node",
  tool: "select",
  drag: null,
  draft: null,
  onSave: null,

  open(model, onSave) {
    this.model = JSON.parse(JSON.stringify(model || defaultDiagram()));
    this.selectedId = this.model.nodes[0]?.id || null;
    this.selectedKind = "node";
    this.tool = "select";
    this.draft = null;
    this.onSave = onSave;
    document.getElementById("diagram-modal").hidden = false;
    document.getElementById("diagram-width").value = this.model.width;
    document.getElementById("diagram-height").value = this.model.height;
    this._setTool("select");
    this._syncFields();
    this._draw();
  },

  close() {
    document.getElementById("diagram-modal").hidden = true;
    this.model = null;
    this.onSave = null;
  },

  apply() {
    if (!this.model || !this.onSave) return;
    this.model.width = Number(document.getElementById("diagram-width").value) || 860;
    this.model.height = Number(document.getElementById("diagram-height").value) || 220;
    this.onSave(diagramHtml(this.model), this.model);
    this.close();
  },

  _node() {
    return this.selectedKind === "node" ? this.model?.nodes.find((n) => n.id === this.selectedId) || null : null;
  },

  _edge() {
    return this.selectedKind === "edge" ? this.model?.edges.find((e) => e.id === this.selectedId) || null : null;
  },

  _setTool(tool) {
    this.tool = tool;
    this.draft = null;
    document.querySelectorAll("[data-dtool]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.dtool === tool);
    });
    const hint = document.getElementById("diagram-arrow-hint");
    if (hint) hint.hidden = tool !== "arrow";
  },

  _syncFields() {
    const node = this._node();
    const edge = this._edge();
    const nodeProps = document.getElementById("diagram-node-props");
    const edgeProps = document.getElementById("diagram-edge-props");
    nodeProps.hidden = !node;
    edgeProps.hidden = !edge;
    if (node) {
      document.getElementById("diagram-title").value = node.title || "";
      document.getElementById("diagram-subtitle").value = node.subtitle || "";
    }
    if (edge) {
      document.getElementById("diagram-label").value = edge.label || "";
      document.getElementById("diagram-route").value = edge.route || "straight";
      document.getElementById("diagram-heads").value = edge.heads || "end";
    }
  },

  _draw() {
    const host = document.getElementById("diagram-canvas");
    host.innerHTML = renderDiagramSvg(this.model, {
      grid: true,
      edit: true,
      selectedId: this.selectedId,
      markerId: "editor-arrow",
      draft: this.draft,
    });
    if (!host.dataset.bound) {
      host.dataset.bound = "1";
      host.addEventListener("mousedown", (event) => {
        const svg = host.querySelector("svg");
        if (svg) this._down(event, svg);
      });
      host.addEventListener("dblclick", (event) => {
        const svg = host.querySelector("svg");
        if (svg) this._dbl(event, svg);
      });
    }
  },

  _point(svg, event) {
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: loc.x, y: loc.y };
  },

  _hitNode(pt) {
    return [...this.model.nodes].reverse().find((node) => pt.x >= node.x && pt.x <= node.x + node.w && pt.y >= node.y && pt.y <= node.y + node.h);
  },

  _hitEdge(pt) {
    let best = null;
    let dist = 10;
    for (const edge of this.model.edges) {
      const ends = edgeEnds(this.model, edge);
      if (!ends) continue;
      const d = distToPath(pt, ends, edge.route || "straight", edge.fromSide);
      if (d < dist) {
        dist = d;
        best = edge;
      }
    }
    return best;
  },

  _hitHandle(pt) {
    const edge = this._edge();
    if (!edge) return null;
    const ends = edgeEnds(this.model, edge);
    if (!ends) return null;
    if (Math.hypot(pt.x - ends.x1, pt.y - ends.y1) <= 10) return "start";
    if (Math.hypot(pt.x - ends.x2, pt.y - ends.y2) <= 10) return "end";
    return null;
  },

  _down(event, svg) {
    const pt = this._point(svg, event);
    if (this.tool === "box" || this.tool === "round" || this.tool === "diamond") {
      const node = {
        id: diagramUid(),
        type: this.tool === "box" ? "box" : this.tool,
        x: snap(pt.x - 90),
        y: snap(pt.y - 40),
        w: 180,
        h: 80,
        title: this.tool === "diamond" ? "Decision" : "New step",
        subtitle: this.tool === "diamond" ? "Yes / No" : "Description",
        fill: this.tool === "diamond" ? "#FD0966" : "#201D22",
      };
      this.model.nodes.push(node);
      this.selectedId = node.id;
      this.selectedKind = "node";
      this._setTool("select");
      this._syncFields();
      this._draw();
      return;
    }

    if (this.tool === "arrow") {
      const start = attachFromPoint(this.model, pt);
      this.draft = {
        x1: start.x,
        y1: start.y,
        x2: start.x,
        y2: start.y,
        from: start.node?.id || null,
        fromSide: start.side,
      };
      const host = document.getElementById("diagram-canvas");
      const move = (ev) => {
        const live = host.querySelector("svg");
        if (!live || !this.draft) return;
        const now = attachFromPoint(this.model, this._point(live, ev), this.draft.from);
        this.draft.x2 = now.x;
        this.draft.y2 = now.y;
        this._draw();
      };
      const up = (ev) => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        const live = host.querySelector("svg");
        const now = live ? attachFromPoint(this.model, this._point(live, ev), this.draft.from) : attachFromPoint(this.model, pt, this.draft.from);
        if (Math.hypot(now.x - this.draft.x1, now.y - this.draft.y1) > 16) {
          const edge = {
            id: diagramUid(),
            from: this.draft.from,
            to: now.node?.id || null,
            fromSide: this.draft.fromSide,
            toSide: now.side,
            x1: this.draft.x1,
            y1: this.draft.y1,
            x2: now.x,
            y2: now.y,
            route: "straight",
            heads: "end",
            label: "",
          };
          this.model.edges.push(edge);
          this.selectedId = edge.id;
          this.selectedKind = "edge";
        }
        this.draft = null;
        this._syncFields();
        this._draw();
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      this._draw();
      return;
    }

    const handle = this._hitHandle(pt);
    if (handle) {
      this.drag = { kind: "handle", which: handle, id: this.selectedId };
      this._dragEdgeHandle();
      return;
    }

    const edge = this._hitEdge(pt);
    const node = this._hitNode(pt);
    const insideNode =
      node &&
      pt.x > node.x + 8 &&
      pt.x < node.x + node.w - 8 &&
      pt.y > node.y + 8 &&
      pt.y < node.y + node.h - 8;
    if (edge && !insideNode) {
      this.selectedId = edge.id;
      this.selectedKind = "edge";
      this._syncFields();
      this._draw();
      return;
    }
    if (!node) {
      this.selectedId = null;
      this.selectedKind = "node";
      this._syncFields();
      this._draw();
      return;
    }
    this.selectedId = node.id;
    this.selectedKind = "node";
    this._syncFields();
    this.drag = { kind: "node", id: node.id, dx: pt.x - node.x, dy: pt.y - node.y };
    const host = document.getElementById("diagram-canvas");
    const move = (ev) => {
      const live = host.querySelector("svg");
      if (!live || !this.drag) return;
      const now = this._point(live, ev);
      const current = this.model.nodes.find((n) => n.id === this.drag.id);
      if (!current) return;
      current.x = snap(now.x - this.drag.dx);
      current.y = snap(now.y - this.drag.dy);
      this._draw();
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      this.drag = null;
      this._draw();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    this._draw();
  },

  _dragEdgeHandle() {
    const host = document.getElementById("diagram-canvas");
    const move = (ev) => {
      const live = host.querySelector("svg");
      const edge = this.model.edges.find((item) => item.id === this.drag.id);
      if (!live || !edge) return;
      const now = attachFromPoint(this.model, this._point(live, ev));
      if (this.drag.which === "start") {
        edge.from = now.node?.id || null;
        edge.fromSide = now.side;
        edge.x1 = now.x;
        edge.y1 = now.y;
      } else {
        edge.to = now.node?.id || null;
        edge.toSide = now.side;
        edge.x2 = now.x;
        edge.y2 = now.y;
      }
      this._draw();
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      this.drag = null;
      this._draw();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  },

  _dbl(event, svg) {
    const pt = this._point(svg, event);
    const edge = this._hitEdge(pt);
    if (edge && !this._hitNode(pt)) {
      const label = window.prompt("Arrow label", edge.label || "");
      if (label == null) return;
      edge.label = label;
      this.selectedId = edge.id;
      this.selectedKind = "edge";
      this._syncFields();
      this._draw();
      return;
    }
    const hit = this._hitNode(pt);
    if (!hit) return;
    const title = window.prompt("Box title", hit.title || "");
    if (title == null) return;
    const subtitle = window.prompt("Box subtitle", hit.subtitle || "");
    if (subtitle == null) return;
    hit.title = title;
    hit.subtitle = subtitle;
    this._syncFields();
    this._draw();
  },

  deleteSelected() {
    if (!this.selectedId) return;
    if (this.selectedKind === "edge") {
      this.model.edges = this.model.edges.filter((e) => e.id !== this.selectedId);
    } else {
      this.model.nodes = this.model.nodes.filter((n) => n.id !== this.selectedId);
      this.model.edges = this.model.edges.filter((e) => e.from !== this.selectedId && e.to !== this.selectedId);
    }
    this.selectedId = this.model.nodes[0]?.id || null;
    this.selectedKind = "node";
    this._syncFields();
    this._draw();
  },

  setFill(fill) {
    const node = this._node();
    if (!node) return;
    node.fill = fill;
    this._draw();
  },

  setEdgeRoute(route) {
    const edge = this._edge();
    if (!edge) return;
    edge.route = route;
    this._draw();
  },

  setEdgeHeads(heads) {
    const edge = this._edge();
    if (!edge) return;
    edge.heads = heads;
    this._draw();
  },

  reverseEdge() {
    const edge = this._edge();
    if (!edge) return;
    const swap = {
      from: edge.to,
      to: edge.from,
      fromSide: edge.toSide,
      toSide: edge.fromSide,
      x1: edge.x2,
      y1: edge.y2,
      x2: edge.x1,
      y2: edge.y1,
    };
    Object.assign(edge, swap);
    this._draw();
  },
};
