const FlowImage = {
  MAX_BYTES: 8 * 1024 * 1024,
  TESS_SRC: [
    "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js",
    "https://unpkg.com/tesseract.js@5/dist/tesseract.min.js",
  ],
  SKIP: new Set([
    "internal",
    "external",
    "platform",
    "process",
    "rest",
    "soap",
    "rest client",
    "soap client",
    "darwin rest",
    "chopin soap",
    "business process",
    "ops",
    "developer",
    "http",
    "capability",
    "routing",
    "choose a step",
    "optional",
  ]),

  _worker: null,
  _tessReady: null,

  read(input, options = {}) {
    if (!input) return Promise.resolve({ ok: false, errors: ["No image to convert"], model: null });
    if (typeof input === "string") return this.fromSrc(input, options);
    const tag = String(input.tagName || "").toLowerCase();
    if (tag === "img") return this.fromImage(input, options);
    if (tag === "svg") return this.fromSvgNode(input, options);
    if (tag && (typeof input.querySelector === "function" || typeof input.matches === "function")) {
      return this.fromElement(input, options);
    }
    if (typeof File !== "undefined" && input instanceof File) return this.fromFile(input, options);
    if (typeof Blob !== "undefined" && input instanceof Blob) {
      return this.fromFile(new File([input], "diagram.png", { type: input.type || "image/png" }), options);
    }
    return Promise.resolve({ ok: false, errors: ["That image cannot be converted"], model: null });
  },

  fromFile(file, options = {}) {
    if (!file) return Promise.resolve({ ok: false, errors: ["Choose a flow image first"], model: null });
    if (file.size > this.MAX_BYTES) return Promise.resolve({ ok: false, errors: ["That image is larger than 8 MB"], model: null });
    const name = String(file.name || "").toLowerCase();
    const type = String(file.type || "").toLowerCase();
    const svg = type.includes("svg") || name.endsWith(".svg");
    const html = type.includes("html") || name.endsWith(".html") || name.endsWith(".htm");
    if (svg || html || type === "application/xml" || type === "text/xml") {
      return file.text().then((text) => {
        const stored = this._storedModel(text);
        if (stored) return stored;
        return this._rasterizeSvgMarkup(text)
          .then((url) => this.fromRaster(url, options))
          .catch(() => this.fromMarkup(text, options));
      });
    }
    const raster = type.startsWith("image/") || !type || /\.(png|jpe?g|gif|webp|bmp)$/i.test(name);
    if (!raster) {
      return Promise.resolve({ ok: false, errors: ["Use a PNG, JPEG, WebP, GIF, or SVG of the flow"], model: null });
    }
    return this._readDataUrl(file).then((dataUrl) => this.fromRaster(dataUrl, options));
  },

  fromMarkup(text, options = {}) {
    const raw = String(text || "").trim();
    if (!raw) return { ok: false, errors: ["That file is empty"], model: null };
    const stored = this._storedModel(raw);
    if (stored) return stored;
    if (raw.includes("<svg")) {
      const tokens = this._svgTokens(raw);
      if (tokens.tokens.length) return this._modelFromTokens(tokens, options);
    }
    return { ok: false, errors: ["No flow could be read from that file"], model: null };
  },

  fromRaster(dataUrl, options = {}) {
    return this._prepareImage(dataUrl).then((prepared) => this._ocrBest(prepared, dataUrl, options));
  },

  _ocrBest(prepared, original, options) {
    const tryPass = (src, psm) =>
      this._ocrTokens(src, options.onStatus, psm).then((layout) => {
        const built = this._modelFromTokens(layout, options);
        return { built, score: this._scoreBuild(built, layout) };
      });
    return tryPass(prepared, "11").then((first) => {
      if (first.score >= 78) return first.built;
      return tryPass(prepared, "4").then((second) => {
        const best = second.score > first.score ? second : first;
        if (best.score >= 70) return best.built;
        return tryPass(original, "11").then((third) => (third.score > best.score ? third.built : best.built));
      });
    });
  },

  _scoreBuild(built, layout) {
    if (!built?.ok || !built.model) return 0;
    const steps = built.model.steps || [];
    let score = steps.length * 4;
    score += steps.filter((step) => step.type === "request" && /\/[A-Za-z]/.test(step.path || "")).length * 10;
    score += steps.filter((step) => step.type === "response" && step.status).length * 8;
    score += steps.reduce((sum, step) => sum + (step.fields || []).length, 0) * 2;
    score += (built.model.actors || []).length * 3;
    score -= steps.filter((step) => /mmm|eee|__|\.J|^=|[|]{2,}/.test(step.label || "")).length * 12;
    score += Math.min(12, (layout.tokens || []).length);
    return score;
  },

  fromSrc(src, options = {}) {
    let value = String(src || "").trim();
    if (!value) return Promise.resolve({ ok: false, errors: ["No image to convert"], model: null });
    if (/^data:image\/svg\+xml/i.test(value)) {
      const text = this._dataUrlText(value);
      const stored = this._storedModel(text);
      if (stored) return Promise.resolve(stored);
      return this._rasterizeSvgMarkup(text)
        .then((url) => this.fromRaster(url, options))
        .catch(() => Promise.resolve(this.fromMarkup(text, options)));
    }
    if (/^data:image\//i.test(value)) return this.fromRaster(value, options);
    if (value.startsWith("//") && typeof location !== "undefined") value = `${location.protocol}${value}`;
    if (!/^(blob:|data:|https?:\/\/)/i.test(value) && typeof location !== "undefined") {
      try {
        value = new URL(value, location.href).href;
      } catch {
        /* keep the original string */
      }
    }
    if (value.startsWith("blob:") || /^https?:\/\//i.test(value)) {
      return fetch(value)
        .then((response) => {
          if (!response.ok) throw new Error("Could not download that image");
          const type = String(response.headers.get("content-type") || "");
          if (type.includes("text/html") || type.includes("application/json")) {
            throw new Error("That picture could not be opened");
          }
          return response.blob();
        })
        .then((blob) => this.fromFile(new File([blob], "diagram.png", { type: blob.type || "image/png" }), options))
        .catch((err) => ({ ok: false, errors: [err.message || "Could not read that image"], model: null }));
    }
    return Promise.resolve({ ok: false, errors: ["That image cannot be converted"], model: null });
  },

  fromElement(el, options = {}) {
    if (!el) return Promise.resolve({ ok: false, errors: ["No image to convert"], model: null });
    const img = el.matches?.("img") ? el : el.querySelector?.("img");
    if (img) return this.fromImage(img, options);
    const svg = el.matches?.("svg") ? el : el.querySelector?.("svg");
    if (svg) return this.fromSvgNode(svg, options);
    return Promise.resolve({ ok: false, errors: ["No image to convert"], model: null });
  },

  fromImage(img, options = {}) {
    if (!img) return Promise.resolve({ ok: false, errors: ["No image to convert"], model: null });
    const ready = typeof img.decode === "function" ? img.decode().catch(() => {}) : Promise.resolve();
    return ready.then(() => {
      const src = String(
        img.currentSrc || img.src || img.getAttribute?.("src") || img.getAttribute?.("data-image-src") || ""
      ).trim();
      const trySrc =
        src && (/^data:image\//i.test(src) || src.startsWith("blob:") || /^(https?:)?\/\//i.test(src) || !src.startsWith("data:"))
          ? this.fromSrc(src, options)
          : Promise.resolve({ ok: false, errors: [], model: null });
      return trySrc
        .then((parsed) => {
          if (parsed?.ok) return parsed;
          return this._fileFromDrawnImage(img).then((file) => this.fromFile(file, options));
        })
        .catch(() => this._fileFromDrawnImage(img).then((file) => this.fromFile(file, options)));
    });
  },

  fromSvgNode(svg, options = {}) {
    if (!svg) return Promise.resolve({ ok: false, errors: ["No image to convert"], model: null });
    const clone = svg.cloneNode(true);
    if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const xml = new XMLSerializer().serializeToString(clone);
    const stored = this._storedModel(xml);
    if (stored) return Promise.resolve(stored);
    return this._rasterizeSvgMarkup(xml)
      .then((url) => this.fromRaster(url, options))
      .catch(() => Promise.resolve(this.fromMarkup(xml, options)));
  },

  _fileFromDrawnImage(img) {
    return new Promise((resolve, reject) => {
      const width = Math.max(0, Number(img.naturalWidth || img.width || 0));
      const height = Math.max(0, Number(img.naturalHeight || img.height || 0));
      if (width < 8 || height < 8) {
        reject(new Error("That picture could not be opened"));
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not read that image"));
        return;
      }
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, width, height);
      try {
        ctx.drawImage(img, 0, 0, width, height);
      } catch {
        reject(new Error("Could not read that image"));
        return;
      }
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Could not read that image"));
          return;
        }
        resolve(new File([blob], "diagram.png", { type: "image/png" }));
      }, "image/png");
    });
  },

  _rasterizeSvgMarkup(text) {
    const raw = String(text || "").trim();
    if (!raw) return Promise.reject(new Error("That picture could not be opened"));
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(raw)}`;
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, img.naturalWidth || img.width || 800);
        canvas.height = Math.max(1, img.naturalHeight || img.height || 600);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Could not read that image"));
          return;
        }
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => reject(new Error("That picture could not be opened"));
      img.src = url;
    });
  },

  looksLikeDiagram(img) {
    if (!img) return false;
    if (img.closest?.(".diagram-container") && !img.closest(".pack-flow")) return true;
    const alt = String(img.getAttribute?.("alt") || "").toLowerCase();
    const src = String(img.getAttribute?.("src") || img.src || "").toLowerCase();
    if (/sequence|flow|uml|plantuml|swimlane|lifeline|accountholder|diagram/.test(`${alt} ${src}`)) return true;
    const width = Number(img.naturalWidth || img.width || 0);
    const height = Number(img.naturalHeight || img.height || 0);
    if (/logo|icon|favicon|avatar/i.test(`${alt} ${src}`) && width < 480) return false;
    if (width >= 480 && height >= 300) return true;
    if (width >= 280 && height >= 360 && height / width >= 1.12) return true;
    if (/image\/svg|\.svg(\?|$)/.test(src) && (height >= 180 || width >= 240)) return true;
    return false;
  },

  _dataUrlText(dataUrl) {
    const comma = String(dataUrl || "").indexOf(",");
    if (comma < 0) return "";
    const meta = dataUrl.slice(0, comma);
    const payload = dataUrl.slice(comma + 1);
    if (/;base64/i.test(meta)) {
      try {
        return decodeURIComponent(escape(atob(payload)));
      } catch {
        try {
          return atob(payload);
        } catch {
          return "";
        }
      }
    }
    try {
      return decodeURIComponent(payload);
    } catch {
      return payload;
    }
  },

  dispose() {
    const worker = this._worker;
    this._worker = null;
    if (worker?.terminate) return worker.terminate().catch(() => {});
    return Promise.resolve();
  },

  _storedModel(text) {
    const cdata = text.match(/id=["']pack-flow-ir["'][^>]*>\s*<!\[CDATA\[([\s\S]*?)\]\]>/);
    if (cdata) return this._validateJson(cdata[1], "Loaded the flow stored in this SVG.");
    const meta = text.match(/id=["']pack-flow-ir["'][^>]*>([\s\S]*?)<\/metadata>/);
    if (meta) return this._validateJson(meta[1].replace(/<!\[CDATA\[|\]\]>/g, ""), "Loaded the flow stored in this SVG.");
    const attr = text.match(/data-flow="([^"]+)"/);
    if (attr) {
      const decoded = this._decodeAttr(attr[1]);
      if (decoded) return this._validateJson(decoded, "Loaded the flow stored in this file.");
    }
    return null;
  },

  _validateJson(raw, note) {
    try {
      const parsed = FlowParse.fromJson(raw);
      if (!parsed.ok) return parsed;
      parsed.note = note;
      return parsed;
    } catch (err) {
      return { ok: false, errors: [err.message || "Stored flow JSON is invalid"], model: null };
    }
  },

  _decodeAttr(value) {
    const text = String(value || "")
      .replaceAll("&quot;", '"')
      .replaceAll("&#39;", "'")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&amp;", "&");
    try {
      JSON.parse(text);
      return text;
    } catch {
      return "";
    }
  },

  _svgTokens(markup) {
    const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
    if (doc.querySelector("parsererror")) return { tokens: [], width: 0, height: 0 };
    const root = doc.documentElement;
    const tokens = [];
    doc.querySelectorAll("text").forEach((node) => {
      const text = String(node.textContent || "").replace(/\s+/g, " ").trim();
      if (!text) return;
      const x = Number(node.getAttribute("x") || 0);
      const y = Number(node.getAttribute("y") || 0);
      const size = Number(node.getAttribute("font-size") || 11);
      const anchor = node.getAttribute("text-anchor") || "start";
      const w = Math.max(12, text.length * size * 0.58);
      const left = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
      tokens.push({
        text,
        x: left,
        y: y - size,
        w,
        h: size + 4,
        cx: left + w / 2,
        cy: y - size / 2,
      });
    });
    return {
      tokens,
      width: Number(root.getAttribute("width") || 800),
      height: Number(root.getAttribute("height") || 600),
      titleHint: this._titleHint(tokens),
    };
  },

  _ocrTokens(dataUrl, onStatus, psm) {
    if (typeof onStatus === "function") onStatus("Reading the picture…");
    return this._ocrWorker(psm || "11").then((worker) =>
      worker.recognize(dataUrl).then((result) => {
        const fromLines = this._tokensFromOcr(result?.data?.lines, 18);
        const fromWords = this._tokensFromOcr(result?.data?.words, 22);
        const tokens = this._mergeTokenSets(fromLines, fromWords);
        return {
          tokens,
          width: result?.data?.imageWidth || 0,
          height: result?.data?.imageHeight || 0,
        };
      })
    );
  },

  _tokensFromOcr(items, minConfidence) {
    return (items || [])
      .filter((item) => item?.text && Number(item.confidence) >= minConfidence)
      .map((item) => {
        const box = item.bbox || {};
        const x = Number(box.x0 || 0);
        const y = Number(box.y0 || 0);
        const w = Math.max(6, Number(box.x1 || 0) - x);
        const h = Math.max(8, Number(box.y1 || 0) - y);
        return {
          text: this._normalizeTokenText(item.text),
          x,
          y,
          w,
          h,
          cx: x + w / 2,
          cy: y + h / 2,
        };
      })
      .filter((token) => token.text && !/^[\W_]+$/.test(token.text) && !/^(oa|de|eview)$/i.test(token.text));
  },

  _mergeTokenSets(lines, words) {
    const out = lines.length ? lines.map((token) => ({ ...token })) : [];
    const covered = (word) =>
      out.some((line) => {
        const overlapX = Math.min(line.x + line.w, word.x + word.w) - Math.max(line.x, word.x);
        const overlapY = Math.min(line.y + line.h, word.y + word.h) - Math.max(line.y, word.y);
        return overlapX > word.w * 0.35 && overlapY > word.h * 0.35;
      });
    (words || []).forEach((word) => {
      if (covered(word)) return;
      if (!/\b(business|client|cent|eps|pps|darwin|member|application|organisation|organization|spend|policy|kyb|kyc)\b/i.test(word.text)) return;
      out.push({ ...word });
    });
    return out.sort((a, b) => a.cy - b.cy || a.x - b.x);
  },

  _ocrWorker(psm) {
    return this._loadTesseract().then((Tesseract) => {
      if (this._worker) {
        return this._worker
          .setParameters({
            tessedit_pageseg_mode: String(psm || "11"),
            preserve_interword_spaces: "1",
          })
          .then(() => this._worker);
      }
      return Tesseract.createWorker("eng").then((worker) => {
        this._worker = worker;
        return worker
          .setParameters({
            tessedit_pageseg_mode: String(psm || "11"),
            preserve_interword_spaces: "1",
          })
          .then(() => worker);
      });
    });
  },

  _loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (this._tessReady) return this._tessReady;
    const sources = Array.isArray(this.TESS_SRC) ? this.TESS_SRC : [this.TESS_SRC];
    this._tessReady = sources
      .reduce(
        (prev, src) =>
          prev.catch(() => this._loadScript(src).then(() => {
            if (!window.Tesseract) throw new Error("The image reader did not load");
            return window.Tesseract;
          })),
        Promise.reject(new Error("start"))
      )
      .catch(() => {
        this._tessReady = null;
        throw new Error("Could not read the picture. Connect to the internet once so the reader can load, or import an SVG from Download SVG.");
      });
    return this._tessReady;
  },

  _loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => resolve(src);
      script.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.appendChild(script);
    });
  },

  _prepareImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = img.width < 1400 ? Math.min(2, 1700 / img.width) : img.width > 2200 ? 1800 / img.width : 1;
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        try {
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = pixels.data;
          for (let i = 0; i < data.length; i += 4) {
            let value = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            value = (value - 128) * 1.45 + 128;
            value = value < 48 ? 0 : value > 210 ? 255 : value;
            data[i] = data[i + 1] = data[i + 2] = value;
          }
          ctx.putImageData(pixels, 0, 0);
        } catch {
          /* keep the scaled colour image */
        }
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => reject(new Error("That picture could not be opened"));
      img.src = dataUrl;
    });
  },

  _modelFromTokens(layout, options = {}) {
    const tokens = (layout.tokens || []).filter((token) => token.text);
    const snippet = tokens
      .slice(0, 8)
      .map((token) => token.text)
      .join(" ");
    if (tokens.length < 2) {
      return {
        ok: false,
        errors: [snippet ? `Could not read enough text from that picture (${snippet})` : "Could not read any text from that picture"],
        model: null,
      };
    }
    const rows = this._rows(tokens);
    if (!rows.length) return { ok: false, errors: ["Could not read the diagram layout"], model: null };
    const platform = this._platformOf(tokens, options.platform);
    let actors = this._actorsOf(rows, tokens);
    actors = this._rejectStepActors(actors);
    if (actors.length < 2) actors = this._defaultActors(tokens);
    actors = this._ensureSequenceLanes(actors, tokens);
    const topY = Math.min(...actors.map((actor) => actor.y));
    const cutoff = this._headerCutoff(tokens);
    const body = rows.filter(
      (row) => !this._isChrome(row) && (row.cy > Math.max(topY + 18, cutoff - 4) || this._looksLikeStep(row.text))
    );
    let steps = this._stepsOf(body.length ? body : rows.slice(1), actors, platform).filter(
      (step) => !this._isActorEcho(step.label, actors)
    );
    if (steps.length <= 1 && tokens.some((token) => this._methodOf(token.text) || this._isStatusLine(token.text))) {
      steps = this._stepsOf(
        rows.filter((row) => !this._isChrome(row) && row.cy > cutoff - 4),
        actors,
        platform
      ).filter((step) => !this._isActorEcho(step.label, actors));
    }
    this._polishKnownLabels(steps, tokens, actors);
    this._healSequence(steps, tokens, actors);
    if (!steps.length) {
      return { ok: false, errors: [`Found actors but no steps. Read: ${snippet || "no labels"}`], model: null };
    }
    const title = this._titleOf(rows, layout.titleHint, steps);
    const stepIds = steps.map((step) => step.id);
    const soap = platform === "chopin";
    const checked = FlowIR.validate({
      id: FlowParse._slug(title),
      title,
      actors: actors.map((actor) => ({ id: actor.id, name: actor.name, type: actor.type })),
      steps,
      endpoints: [],
      implementations: {
        darwin: { protocol: "REST", steps: soap ? [] : stepIds },
        chopin: { protocol: "SOAP", steps: soap ? stepIds : [] },
      },
      presentation: { audience: "developer", layout: "sequence", platform, hidden: [], showFields: true },
    });
    if (!checked.ok) return checked;
    checked.note = `Created from the picture: ${actors.length} actors, ${steps.length} steps. Check names and hops.`;
    return checked;
  },

  _rows(tokens) {
    const heights = tokens.map((token) => token.h).sort((a, b) => a - b);
    const gap = Math.max(14, (heights[Math.floor(heights.length / 2)] || 16) * 0.9);
    const sorted = [...tokens].sort((a, b) => a.cy - b.cy || a.x - b.x);
    const rows = [];
    sorted.forEach((token) => {
      const last = rows[rows.length - 1];
      if (!last || token.cy - last.cy > gap) {
        rows.push({ cy: token.cy, y: token.y, tokens: [token] });
        return;
      }
      last.tokens.push(token);
      last.cy = last.tokens.reduce((sum, item) => sum + item.cy, 0) / last.tokens.length;
    });
    rows.forEach((row) => {
      row.tokens.sort((a, b) => a.x - b.x);
      row.tokens = this._mergeRow(row.tokens);
      row.text = row.tokens.map((token) => token.text).join(" ");
    });
    return rows;
  },

  _mergeRow(tokens) {
    const out = [];
    tokens.forEach((token) => {
      const last = out[out.length - 1];
      const gap = last ? token.x - (last.x + last.w) : 999;
      if (last && this._shouldJoin(last, token, gap)) {
        last.text = `${last.text} ${token.text}`.replace(/\s+/g, " ").trim();
        last.w = token.x + token.w - last.x;
        last.cx = last.x + last.w / 2;
        last.h = Math.max(last.h, token.h);
        return;
      }
      out.push({ ...token });
    });
    return out;
  },

  _shouldJoin(last, token, gap) {
    if (gap < Math.max(7, last.h * 0.65)) return true;
    const pathish = /\/$|\.\.\.$/.test(last.text) || /^\//.test(token.text) || /\.\.\./.test(token.text);
    if (pathish && gap < Math.max(36, last.h * 2.4)) return true;
    if (/\b(GET|POST|PUT|PATCH|DELETE)\b/i.test(last.text) && /^[./[]?(accounts|cards|accountholders)\b/i.test(token.text) && gap < 90) {
      return true;
    }
    if (/account-manag/i.test(last.text) && /cards|accounts/i.test(token.text) && gap < 90) return true;
    if (/provider\/?$/i.test(last.text) && /kyc/i.test(token.text)) return true;
    const fieldish = /:$/.test(last.text) || /^</.test(token.text) || /^:\s*/.test(token.text);
    if (fieldish && gap < Math.max(28, last.h * 2)) return true;
    const idish = /^id\b/i.test(last.text) && /(holder|card|id|<)/i.test(token.text);
    if (idish && gap < Math.max(80, last.h * 6) && Math.abs(token.cy - last.cy) < last.h * 1.6) return true;
    return false;
  },

  _titleHint(tokens) {
    const first = [...tokens].sort((a, b) => a.y - b.y || a.x - b.x)[0];
    return first && first.x < 80 ? first.text : "";
  },

  _titleOf(rows, hint, steps) {
    const firstAction = (steps || []).find(
      (step) =>
        step.type === "process" &&
        !/^create\b/i.test(step.label) &&
        (this._isStartProcess(step.label) || (step.from && step.to && step.from !== step.to)) &&
        !this._isFieldLine(step.label)
    );
    const fromStep = firstAction ? firstAction.label : "";
    if (fromStep) return fromStep.slice(0, 80);
    const top = rows[0];
    if (!top) return hint || "API flow";
    const names = top.tokens.filter(
      (token) => !this._isSkip(token.text) && !this._isProtocol(token.text) && !this._isActorType(token.text)
    );
    if (names.length >= 2) return fromStep || hint || "API flow";
    const left = names[0] || top.tokens.find((token) => !this._isSkip(token.text) && !this._isProtocol(token.text));
    const text = String(left?.text || hint || "API flow").trim();
    if (this._looksLikeStep(text) || this._isActorType(text) || this._isActorCandidate(text)) return fromStep || hint || "API flow";
    return text.slice(0, 80);
  },

  _platformOf(tokens, fallback) {
    const hay = tokens.map((token) => token.text.toLowerCase()).join(" ");
    if (/\bchopin\b/.test(hay) && /\bsoap\b/.test(hay) && !/\bdarwin\b/.test(hay)) return "chopin";
    if (/\bboth\b/.test(hay) && /\bdarwin\b/.test(hay) && /\bchopin\b/.test(hay)) return "both";
    if (FlowIR.PLATFORMS.includes(fallback)) return fallback;
    return "darwin";
  },

  _actorsOf(rows, tokens) {
    const known = this._actorsFromKnownNames(tokens);
    if (known.length >= 2) return known;
    const lanes = this._actorsFromLifelines(tokens);
    if (lanes.length >= 2) return lanes;
    const typed = this._actorsFromTypes(tokens);
    const named = typed.filter((actor) => !this._isActorType(actor.name));
    if (named.length >= 2) return this._uniqueActors(this._repairActors(named, tokens));
    const band = this._actorsFromHeaderBand(tokens);
    if (band.length >= 2) return band;
    const top = this._actorsFromTopRow(rows);
    if (top.length >= 2) return this._uniqueActors(this._repairActors(top, tokens));
    if (named.length) return this._uniqueActors(this._repairActors(named, tokens));
    return [];
  },

  _actorsFromLifelines(tokens) {
    if (!tokens.length) return [];
    const cutoff = this._headerCutoff(tokens);
    const header = tokens.filter(
      (token) => token.cy <= cutoff && (this._isActorCandidate(token.text) || this._isChromeLabel(token.text))
    );
    if (header.length < 2) return [];
    const actors = this._clusterX(header, 88)
      .map((column) => {
        const stacked = [...column].sort((a, b) => a.cy - b.cy);
        const parts = stacked.filter((token) => this._isActorCandidate(token.text) && !this._isActorType(token.text));
        const extra = stacked.filter((token) => this._isChromeLabel(token.text));
        const names = parts.length ? parts : stacked.filter((token) => !this._isActorType(token.text) && !this._isChromeLabel(token.text));
        if (!names.length && extra.length) {
          names.push({ ...extra[0], text: "EPS (DARWIN)" });
        }
        if (!names.length) return null;
        const text = this._pickActorName(names, extra);
        const left = Math.min(...names.map((token) => token.x));
        const right = Math.max(...names.map((token) => token.x + token.w));
        const typeTok = stacked.find((token) => this._isActorType(token.text));
        return this._makeActor(
          {
            text,
            x: left,
            y: names[0].y,
            w: Math.max(24, right - left),
            cx: (left + right) / 2,
            cy: names[0].cy,
          },
          typeTok?.text || ""
        );
      })
      .filter(Boolean);
    return this._uniqueActors(this._repairActors(actors, tokens));
  },

  _actorsFromHeaderBand(tokens) {
    const topY = Math.min(...tokens.map((token) => token.cy));
    const header = tokens.filter(
      (token) => token.cy <= topY + 90 && this._isActorCandidate(token.text) && !this._isProtocol(token.text)
    );
    return this._uniqueActors(
      this._repairActors(
        this._clusterX(header, 90)
          .map((column) => {
            const stacked = [...column].sort((a, b) => a.cy - b.cy);
            const name = stacked.find((token) => !this._isActorType(token.text)) || null;
            if (!name || !this._isActorCandidate(name.text) || this._isProtocol(name.text)) return null;
            const typeTok = stacked.find((token) => token !== name && this._isActorType(token.text));
            return this._makeActor({ ...name, text: this._cleanActorName(name.text) }, typeTok?.text || "");
          })
          .filter(Boolean),
        tokens
      )
    );
  },

  _actorsFromTypes(tokens) {
    const typeTokens = tokens.filter((token) => this._isActorType(token.text));
    if (typeTokens.length < 2) return [];
    const typeCy = this._median(typeTokens.map((token) => token.cy));
    const header = tokens.filter((token) => {
      if (this._isProtocol(token.text) || this._looksLikeStep(token.text)) return false;
      return Math.abs(token.cy - typeCy) <= 36 || (token.cy < typeCy && typeCy - token.cy <= 70);
    });
    const columns = this._clusterX(header, 72);
    return this._uniqueActors(
      columns
        .map((column) => {
          const stacked = [...column].sort((a, b) => a.cy - b.cy);
          const typeTok = stacked.find((token) => this._isActorType(token.text)) || stacked[stacked.length - 1];
          const name =
            stacked.find((token) => !this._isActorType(token.text) && !this._looksLikeStep(token.text)) ||
            tokens
              .filter(
                (token) =>
                  !this._isActorType(token.text) &&
                  !this._looksLikeStep(token.text) &&
                  !this._isProtocol(token.text) &&
                  Math.abs(token.cx - typeTok.cx) < 110 &&
                  token.cy < typeTok.cy &&
                  typeTok.cy - token.cy < 80
              )
              .sort((a, b) => b.cy - a.cy)[0];
          if (!name || this._isProtocol(name.text) || this._looksLikeStep(name.text) || this._isActorType(name.text)) return null;
          return this._makeActor(name, typeTok?.text || "");
        })
        .filter(Boolean)
    );
  },

  _actorsFromTopRow(rows) {
    const candidates = rows.filter((row) => !this._isChrome(row) && !this._isProtocol(row.text));
    for (const row of candidates.slice(0, 5)) {
      const names = row.tokens.filter((token) => this._isActorCandidate(token.text) && !this._isActorType(token.text));
      if (names.length >= 2) {
        return names.map((token) => this._makeActor({ ...token, text: this._cleanActorName(token.text) }, ""));
      }
    }
    return [];
  },

  _isActorCandidate(text) {
    const value = String(text || "").trim();
    if (!value || value.length < 2 || value.length > 48) return false;
    if (!/[A-Za-z]{3,}/.test(value) && !/^(eps|pps)$/i.test(value)) return false;
    if (this._isProtocol(value) || this._isFieldLine(value) || this._isStatusLine(value)) return false;
    if (this._looksLikeStep(value) || this._isChromeLabel(value) || this._isActionName(value)) return false;
    if (/\b(kyc|kyb|ekyc)\b/i.test(value)) return false;
    if (/\bprocess\b/i.test(value) && !/\bbusiness\b/i.test(value)) return false;
    if (value.includes("/") && !/darwin|chopin/i.test(value)) return false;
    if (this._isSkip(value) && !/^(client|platform)$/i.test(value)) return false;
    return /^(?:[A-Za-z][\w .()-]{0,40}|\(?\s*(?:DARWIN|CHOPIN|EPS|PPS)\s*\)?)$/i.test(value);
  },

  _headerCutoff(tokens) {
    const firstStep = [...tokens]
      .filter((token) => this._looksLikeStep(token.text) || this._isActionName(token.text))
      .sort((a, b) => a.cy - b.cy)[0];
    if (firstStep) return firstStep.cy - 8;
    const minY = Math.min(...tokens.map((token) => token.cy));
    const maxY = Math.max(...tokens.map((token) => token.cy));
    return minY + Math.max(80, Math.min(150, (maxY - minY) * 0.12));
  },

  _pickActorName(names, extra) {
    const texts = [...names, ...(extra || [])].map((token) => token.text);
    const preferred = texts.find((text) => /^(business|client|member|application|eps|pps)\b/i.test(text));
    const platform = texts.filter((text) => this._isChromeLabel(text) || /^(eps|pps)$/i.test(text));
    if (preferred) return this._cleanActorName([preferred, ...platform].join(" "));
    const useful = texts.filter((text) => text.length > 2 && !/^[QAIS]$/i.test(text));
    return this._cleanActorName((useful.length ? useful : texts).join(" "));
  },

  _cleanActorName(name) {
    let text = String(name || "")
      .replace(/\s+/g, " ")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")")
      .replace(/\bPPS\b/g, "EPS")
      .replace(/^(cent|c[li]ent|clent|cient)$/i, "Client")
      .trim();
    text = text.replace(/\bEPS(?:\s+EPS)+\b/gi, "EPS");
    if (/\bEPS\b/i.test(text)) return "EPS (DARWIN)";
    return text;
  },

  _repairActors(actors, tokens) {
    const hay = (tokens || []).map((token) => token.text).join(" ");
    return (actors || []).map((actor, index) => {
      let name = this._cleanActorName(actor.name);
      if (/^(pps|eps)$/i.test(name) && /darwin/i.test(hay)) name = "EPS (DARWIN)";
      if (/^(cent|c[li]ent|clent|cient)$/i.test(name)) name = "Client";
      if (index === 0 && (actors || []).length >= 3 && /business/i.test(hay) && !/business/i.test(name)) name = "Business";
      return { ...actor, name, id: FlowParse._slug(name) || actor.id, type: this._actorType(name, "") };
    });
  },

  _isActorEcho(label, actors) {
    const text = this._cleanCaption(label).toLowerCase();
    if (!text) return true;
    return (actors || []).some((actor) => {
      const name = String(actor.name || "").toLowerCase();
      const short = name.replace(/\(.*\)/, "").trim();
      return text === name || text === short;
    });
  },

  _actorsFromKnownNames(tokens) {
    if (!tokens.length) return [];
    const minY = Math.min(...tokens.map((token) => token.cy));
    const maxY = Math.max(...tokens.map((token) => token.cy));
    const top = minY + Math.max(80, (maxY - minY) * 0.3);
    const specs = [
      { re: /\bbusiness\b/i, name: "Business" },
      { re: /\b(client|cent|clent|cient)\b/i, name: "Client" },
      { re: /\b(eps|pps)\b/i, name: "EPS (DARWIN)" },
    ];
    const found = specs
      .map((spec) => {
        const inTop = tokens.filter((token) => token.cy <= top && spec.re.test(token.text)).sort((a, b) => a.cy - b.cy);
        const hit = inTop[0] || tokens.filter((token) => spec.re.test(token.text)).sort((a, b) => a.cy - b.cy)[0];
        return hit ? this._makeActor({ ...hit, text: spec.name }, "") : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.x - b.x);
    return this._uniqueActors(this._repairActors(found, tokens));
  },

  _rejectStepActors(actors) {
    return (actors || []).filter((actor) => !this._looksLikeStep(actor.name) && !this._isActionName(actor.name));
  },

  _isActionName(text) {
    const value = String(text || "").trim();
    return /^(sign\s*up|onboard|create|update|delete|issue|send|apply|enrol|enroll|register|activate|spend|set)\b/i.test(
      value
    );
  },

  _isStartProcess(caption) {
    return /^(sign\s*up|issue|onboard|request|apply|enrol|enroll|register|open|start)\b/i.test(
      this._cleanCaption(caption)
    );
  },

  _ensureSequenceLanes(actors, tokens) {
    const hay = (tokens || []).map((token) => token.text).join(" ");
    const known = this._actorsFromKnownNames(tokens);
    const real = this._rejectStepActors(actors);
    if (known.length >= 3) return known;
    const names = (real || []).map((actor) => actor.name.toLowerCase());
    const hasBusiness = names.some((name) => /business/.test(name));
    const hasClient = names.some((name) => /client/.test(name));
    const hasEps = names.some((name) => /eps|darwin|pps/.test(name));
    if (hasBusiness && hasClient && hasEps) return real;
    const sequence =
      /\b(GET|POST|PUT|PATCH|DELETE)\b/i.test(hay) &&
      /\b(business|client|cent|eps|pps|darwin|accountholder|identity-management|spend)\b/i.test(hay);
    if (sequence && known.length >= 2) return this._threeLaneActors(tokens);
    if (sequence && real.length < 2) return this._threeLaneActors(tokens);
    return real.length >= 2 ? real : actors;
  },

  _threeLaneActors(tokens) {
    const width = Math.max(...tokens.map((token) => token.x + token.w), 400);
    const y = Math.min(...tokens.map((token) => token.y));
    const known = this._actorsFromKnownNames(tokens);
    const byName = (re, fallback) => known.find((actor) => re.test(actor.name)) || fallback;
    return this._uniqueActors([
      byName(/business/i, { id: "business", name: "Business", type: "process", x: width * 0.12, y, w: 90 }),
      byName(/client/i, { id: "client", name: "Client", type: "client", x: width * 0.42, y, w: 80 }),
      byName(/eps|darwin/i, { id: "eps-darwin", name: "EPS (DARWIN)", type: "platform", x: width * 0.78, y, w: 100 }),
    ]);
  },

  _defaultActors(tokens) {
    const hay = (tokens || []).map((token) => token.text).join(" ");
    if (/\b(eps|pps|darwin)\b/i.test(hay)) return this._threeLaneActors(tokens);
    const known = this._actorsFromKnownNames(tokens);
    if (known.length >= 2) return known;
    const width = Math.max(...tokens.map((token) => token.x + token.w), 400);
    const y = Math.min(...tokens.map((token) => token.y));
    return this._uniqueActors([
      { id: "client", name: "Client", type: "client", x: width * 0.28, y, w: 80 },
      { id: "api", name: "API", type: "internal", x: width * 0.72, y, w: 80 },
    ]);
  },

  _polishKnownLabels(steps, tokens, actors) {
    const actorId = (re, fallback) => {
      const hit = (actors || []).find((actor) => re.test(actor.name) || re.test(actor.id));
      return hit ? hit.id : fallback;
    };
    for (let index = (steps || []).length - 1; index >= 0; index -= 1) {
      const step = steps[index];
      if (step.type === "process" && /^\.?j?accounts\b/i.test(step.label)) {
        const prev = steps.slice(0, index).reverse().find((item) => item.type === "request");
        if (prev && !/\/accounts\b/i.test(prev.path || "")) {
          prev.path = "/account-management/.../accounts";
          prev.label = `${prev.method || "POST"} ${prev.path}`;
        }
        step.label = "Create Account";
        const eps = actorId(/eps|darwin/i, step.from);
        step.from = eps;
        step.to = eps;
        continue;
      }
      if (this._isReturnProcess(step.label)) {
        step.from = actorId(/client/i, step.from);
        step.to = actorId(/business/i, step.to);
      }
      if (/account holder/i.test(step.label) && !/^create/i.test(step.label)) step.label = "Create Account Holder";
      if (/organis/i.test(step.label) && !/^create/i.test(step.label) && !/type:/i.test(step.label)) {
        step.label = "Create Organisation";
      }
      if (/spend\s*polic/i.test(step.label) && !/^create/i.test(step.label)) step.label = "Create Spend Policy";
      if (/kyb process/i.test(step.label) && !/provider/i.test(step.label)) step.label = "eKYB provider / KYB process";
      if (/kyc process/i.test(step.label) && !/provider/i.test(step.label)) step.label = "eKYC provider / KYC process";
      if (step.type === "request") this._repairRequestPath(step);
    }
  },

  _repairRequestPath(step) {
    const own = `${step.path || ""} ${step.label || ""} ${(step.fields || []).map((field) => field.name).join(" ")}`;
    let path = step.path || "";
    const garbage = !path || path.length < 12 || /__|mat$|Jaccount|\[cards|account-ma$/i.test(path);
    if (!garbage && /\/[A-Za-z].+\//.test(path)) return;
    if (/identity-management|accountholders/i.test(own) && !/\/accounts\b|\/cards\b|account_profile|card_profile/i.test(own)) {
      path = "/identity-management/.../accountholders";
    } else if (/card_profile|expiry_date|\/cards\b/i.test(own)) {
      path = "/account-management/.../cards";
    } else if (/account_profile|parent_account|\/accounts\b/i.test(own)) {
      path = "/account-management/.../accounts";
    }
    if (path && path.length >= 8) {
      step.path = path;
      step.label = `${step.method || "POST"} ${path}`;
    }
  },

  _normalizeTokenText(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .replace(/\bhitp\b/gi, "http")
      .replace(/\bPPS\b/g, "EPS")
      .replace(/\b(Cent|Clent|Cient)\b/g, "Client")
      .replace(/\bountholder\b/gi, "accountholder")
      .replace(/\bsernal\b/gi, "serial")
      .replace(/account-mat(?:agement)?/gi, "account-management")
      .replace(/identity-manag(?:ement)?/gi, "identity-management")
      .replace(/\{\s*(\d+)\s*\]/g, "[$1]")
      .replace(/\[\s*(\d+)\s*\}/g, "[$1]")
      .replace(/parent_account\s+account_no/gi, "parent_account.account_no")
      .replace(/onboarded_products\[[^\]]+\]\s+status/gi, (match) => match.replace(/\s+status/i, ".status"))
      .replace(/^\.?Jaccounts\b/i, "/accounts")
      .replace(/^\[cards\b/i, "/cards")
      .replace(/^[=m\s—\-_|[\]]+(?=card issued)/i, "")
      .replace(/\bekyb\b/gi, "eKYB")
      .trim();
  },

  _healSequence(steps, tokens, actors) {
    if (!Array.isArray(steps)) return;
    this._dropNoiseSteps(steps);
    this._insertMissingCreates(steps, tokens);
  },

  _dropNoiseSteps(steps) {
    const noise = /^(oa|de|eview|preview|mmm|eee|post|account)$/i;
    for (let i = steps.length - 1; i >= 0; i -= 1) {
      const step = steps[i];
      if (step.type === "process" && (noise.test(step.label) || String(step.label || "").length <= 2)) {
        steps.splice(i, 1);
        continue;
      }
      if (step.type === "request" && !step.path && !this._methodOf(step.label)) steps.splice(i, 1);
    }
  },

  _insertMissingCreates(steps, tokens) {
    const creates = (tokens || [])
      .map((token) => this._cleanCaption(token.text))
      .filter((text) => /^create\b/i.test(text) && text.split(/\s+/).length <= 6);
    const out = [];
    steps.forEach((step, index) => {
      out.push(step);
      if (step.type !== "request") return;
      const next = steps[index + 1];
      if (next && next.type === "process" && next.from === step.to && next.to === step.to) return;
      const used = new Set(out.filter((item) => item.type === "process").map((item) => String(item.label || "").toLowerCase()));
      const fromTokens = creates.find((label) => !used.has(label.toLowerCase()) && this._createMatchesRequest(label, step));
      const label = fromTokens || this._createLabelFromPath(step.path || step.label, step);
      if (!label) return;
      out.push({
        id: `do-${FlowParse._slug(label)}-${out.length}`,
        type: "process",
        label,
        from: step.to,
        to: step.to,
      });
    });
    steps.splice(0, steps.length, ...out);
  },

  _createMatchesRequest(label, step) {
    const hay = `${step.path || ""} ${step.label || ""} ${(step.fields || []).map((field) => `${field.name} ${field.example || ""}`).join(" ")}`;
    if (/organis/i.test(label)) return /accountholder|identity|organis/i.test(hay);
    if (/account holder/i.test(label)) return /accountholder|identity/i.test(hay);
    if (/spend|polic/i.test(label)) return /spend|polic/i.test(hay);
    if (/\bcard\b/i.test(label)) return /card/i.test(hay);
    if (/\baccount\b/i.test(label)) return /account/i.test(hay);
    return true;
  },

  _createLabelFromPath(path, step) {
    const hay = `${path || ""} ${step?.label || ""} ${(step?.fields || []).map((field) => `${field.name} ${field.example || ""}`).join(" ")}`;
    if (/spend|polic/i.test(hay)) return "Create Spend Policy";
    if (/organis/i.test(hay)) return "Create Organisation";
    if (/accountholders|identity-management/i.test(hay)) return "Create Account Holder";
    if (/\/cards\b|card_profile/i.test(hay)) return "Create Card";
    if (/\/accounts\b|account-management/i.test(hay)) return "Create Account";
    return "";
  },

  _median(values) {
    const list = [...values].sort((a, b) => a - b);
    if (!list.length) return 0;
    return list[Math.floor(list.length / 2)];
  },

  _makeActor(token, subtitle) {
    return {
      id: FlowParse._slug(token.text) || "actor",
      name: token.text,
      type: this._actorType(token.text, subtitle),
      x: token.cx,
      y: token.y,
      w: token.w,
    };
  },

  _uniqueActors(actors) {
    const used = new Set();
    return actors.map((actor, index) => {
      let id = actor.id || `a${index + 1}`;
      if (used.has(id)) id = `${id}-${index + 1}`;
      used.add(id);
      return { ...actor, id };
    });
  },

  _clusterX(tokens, gap) {
    const sorted = [...tokens].sort((a, b) => a.cx - b.cx);
    const groups = [];
    sorted.forEach((token) => {
      const last = groups[groups.length - 1];
      if (!last || token.cx - last[last.length - 1].cx > gap) groups.push([token]);
      else last.push(token);
    });
    return groups;
  },

  _stepsOf(rows, actors, platform) {
    const steps = [];
    const used = new Set();
    let pending = null;
    rows.forEach((row) => {
      if (this._isChrome(row)) return;
      const groups = this._groups(row.tokens, actors);
      if (this._isOutcomeRow(groups) && pending) {
        pending.branches = groups.map((group, index) => ({
          id: `b${steps.length}-${index}`,
          label: this._outcomeLabel(group),
          target: "",
          when: index === 0 ? "true" : index === 1 ? "false" : "",
        }));
        return;
      }
      if (groups.length > 1 && pending?.type === "condition") {
        groups.forEach((group, index) => {
          const step = this._stepFromGroup(group, actors, platform, used, steps.length);
          if (!step) return;
          steps.push(step);
          if (pending.branches?.[index]) pending.branches[index].target = step.id;
        });
        pending = null;
        return;
      }
      groups.forEach((group) => {
        const fieldTokens = group.filter((token) => this._isFieldLine(token.text));
        const other = group.filter(
          (token) => !this._isFieldLine(token.text) && !this._isSkip(token.text) && !this._isChromeLabel(token.text)
        );
        const fieldLines = fieldTokens.map((token) => token.text);
        if (!other.length) {
          if (fieldLines.length) this._attachFields(steps, fieldLines);
          return;
        }
        const step = this._stepFromGroup(other, actors, platform, used, steps.length);
        if (!step) {
          if (fieldLines.length) this._attachFields(steps, fieldLines);
          return;
        }
        if (fieldLines.length) {
          if (step.type === "request" || step.type === "response") {
            const side = step.type === "response" ? "response" : "body";
            step.fields = [...(step.fields || []), ...this._fieldsOf(fieldLines, side)];
          } else {
            this._attachFields(steps, fieldLines);
          }
        }
        if (this._mergeProcess(steps, step)) return;
        this._fixHop(step, actors, steps);
        if (pending?.type === "condition" && pending.branches?.some((branch) => !branch.target)) {
          const open = pending.branches.find((branch) => !branch.target);
          if (open) open.target = step.id;
        }
        steps.push(step);
        pending = step.type === "condition" ? step : null;
      });
    });
    this._healBranches(steps);
    return steps;
  },

  _attachFields(steps, lines) {
    if (!steps.length) return false;
    const useful = lines.filter((line) => !this._isSkip(line) && !this._isChromeLabel(line));
    if (!useful.length) return true;
    const onlyFields = useful.every((line) => this._isFieldLine(line));
    if (!onlyFields) return false;
    const target = this._fieldTarget(steps);
    if (!target) return false;
    const side = target.type === "response" ? "response" : "body";
    target.fields = [...(target.fields || []), ...this._fieldsOf(useful, side)];
    return true;
  },

  _fieldTarget(steps) {
    let lastReq = null;
    let lastRes = null;
    steps.forEach((step) => {
      if (step.type === "request") lastReq = step;
      if (step.type === "response") lastRes = step;
    });
    if (lastReq && (!lastRes || steps.indexOf(lastReq) > steps.indexOf(lastRes))) return lastReq;
    return lastRes || lastReq || steps[steps.length - 1];
  },

  _mergeProcess(steps, step) {
    const prev = steps[steps.length - 1];
    if (!prev || prev.type !== "process" || step.type !== "process") return false;
    if (prev.from !== step.from || prev.to !== step.to) return false;
    if (!this._isPartialProcess(prev.label) && step.label.split(/\s+/).length > 3) return false;
    prev.label = `${prev.label} ${step.label}`.replace(/\s*\/\s*/g, " / ").replace(/\s+/g, " ").trim();
    return true;
  },

  _isPartialProcess(label) {
    const text = String(label || "").trim();
    return /\/\s*$/.test(text) || /^(create|update|delete|get|issue|send|process|account|card|holder)$/i.test(text);
  },

  _groups(tokens, actors) {
    if (tokens.length <= 1) return tokens.length ? [tokens] : [];
    const gap = actors.length > 1 ? Math.max(36, (actors[1].x - actors[0].x) * 0.28) : 48;
    const groups = [];
    tokens.forEach((token) => {
      const last = groups[groups.length - 1];
      if (!last || token.x - (last[last.length - 1].x + last[last.length - 1].w) > gap) groups.push([token]);
      else last.push(token);
    });
    return groups;
  },

  _stepFromGroup(tokens, actors, platform, used, index) {
    const lines = tokens.map((token) => token.text).filter((text) => !this._isSkip(text) && !this._isChromeLabel(text));
    if (!lines.length) return null;
    const blob = lines.join(" ");
    if (this._isProtocol(blob) || this._isSkip(blob) || this._isChromeLabel(blob)) return null;
    const method = this._methodOf(blob);
    const status = this._statusOf(blob);
    if (this._isFieldLine(blob) && !method && !status && lines.every((line) => this._isFieldLine(line) || this._isSkip(line))) return null;
    const question = /\?$/.test(blob.trim()) || /^(is|if|can|has|should|authoris|authoriz|valid|allowed)\b/i.test(blob);
    const side = status || this._isStatusLine(blob) ? "response" : "body";
    const fields = this._fieldsOf(lines, side);
    const caption = this._captionOf(lines, method, status);
    if (!caption || this._isJunkStep(caption, method, status)) return null;
    let type = "process";
    if (question && !method) type = "condition";
    else if (method) type = "request";
    else if (status || this._isStatusLine(blob)) type = "response";
    const span = this._span(tokens, actors, type, caption);
    const id = this._stepId(type, caption, used, index);
    const step = { id, type, label: caption, from: span.from, to: span.to };
    if (type === "condition") {
      step.actor = span.actor;
      step.kind = /4\d\d|5\d\d|status|http/i.test(blob) ? "http" : "business";
      step.branches = FlowIR.defaultBranches();
    }
    if (type === "request") {
      if (platform === "chopin" || method === "SOAP") {
        step.operation = caption.replace(/^SOAP\s+/i, "");
        step.platforms = ["chopin"];
      } else {
        step.method = method || "POST";
        step.path = this._pathOf(blob, caption);
        step.platforms = ["darwin"];
      }
    }
    if (type === "request" && step.path) step.label = `${step.method} ${step.path}`;
    if (type === "response" && status) {
      step.status = status;
      step.label = `HTTP ${status}`;
    }
    if (fields.length) step.fields = fields;
    return step;
  },

  _span(tokens, actors, type, caption) {
    const minX = Math.min(...tokens.map((token) => token.x));
    const maxX = Math.max(...tokens.map((token) => token.x + token.w));
    const cx = (minX + maxX) / 2;
    const nearest = (x) => actors.reduce((best, actor) => (Math.abs(actor.x - x) < Math.abs(best.x - x) ? actor : best), actors[0]);
    const left = nearest(minX);
    const right = nearest(maxX);
    const home = nearest(cx);
    const ret = this._isReturnProcess(caption);
    if (left.id !== right.id && maxX - minX >= home.w + 24) {
      if (type === "response" || ret) return { from: right.id, to: left.id, actor: home.id };
      return { from: left.id, to: right.id, actor: home.id };
    }
    return { from: home.id, to: home.id, actor: home.id };
  },

  _fixHop(step, actors, steps) {
    if (!step || step.type === "condition") return;
    const lastReq = [...(steps || [])].reverse().find((item) => item.type === "request");
    if (step.type === "response" && lastReq) {
      step.from = lastReq.to;
      step.to = lastReq.from;
      return;
    }
    if (step.type === "process" && this._isStartProcess(step.label) && actors[0] && actors[1]) {
      if (step.from === step.to) {
        step.from = actors[0].id;
        step.to = actors[1].id;
      }
      return;
    }
    if (step.from !== step.to) return;
    const index = actors.findIndex((actor) => actor.id === step.from);
    if (index < 0) return;
    if (step.type === "request" && index < actors.length - 1) step.to = actors[index + 1].id;
    if (step.type === "process" && this._isReturnProcess(step.label)) {
      if (index === 0 && actors[1]) {
        step.from = actors[1].id;
        step.to = actors[0].id;
      } else if (index > 0) {
        step.to = actors[index - 1].id;
      }
    }
  },

  _isReturnProcess(caption) {
    const text = this._cleanCaption(caption);
    if (/^create\b/i.test(text)) return false;
    return (
      /card issued|onboarded|issued$|complete|completed|done|success|returned|created$/i.test(text) ||
      /^(issued|complete|completed|done|success|returned)\b/i.test(text)
    );
  },

  _captionOf(lines, method, status) {
    const useful = lines.filter(
      (line) => !this._isFieldLine(line) && !this._isSkip(line) && !this._isChromeLabel(line) && !/^[✓→·]$/.test(line)
    );
    let text = useful[0] || lines[0] || "";
    if (method && text.toUpperCase() === method) text = useful[1] || text;
    if (status && String(status) === text) text = useful.find((line) => this._isStatusLine(line)) || useful[1] || text;
    return this._cleanCaption(text);
  },

  _cleanCaption(text) {
    return String(text || "")
      .replace(/^[\[|—~\-_`'‘=m\s]+/, "")
      .replace(/^[e]{2,}\s+(?=card issued)/i, "")
      .replace(/[=m\s—_|`‘\]]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  },

  _methodOf(text) {
    const match = String(text || "").toUpperCase().match(/\b(GET|POST|PUT|PATCH|DELETE|SOAP)\b/);
    return match ? match[1] : "";
  },

  _statusOf(text) {
    const match = String(text || "").match(/\b([1-5]\d{2})\b/);
    return match ? Number(match[1]) : 0;
  },

  _pathOf(blob, caption) {
    const cleaned = String(blob || caption || "")
      .replace(/management[.\s'’]+\[?/gi, "management/")
      .replace(/[_\s]+\/+/g, "/")
      .replace(/\s+/g, "");
    const match = cleaned.match(/\/[A-Za-z0-9._\-{}/]*/);
    return match ? match[0].replace(/\/{2,}/g, "/").replace(/\/+$/, "") : "";
  },

  _fieldsOf(lines, place) {
    return lines
      .filter((line) => this._isFieldLine(line))
      .slice(0, 8)
      .map((line) => {
        const raw = line.replace(/…/g, "").trim();
        const loc = /^(path|query|header)\s+/i.test(raw) ? raw.split(/\s+/)[0].toLowerCase() : place === "response" ? "response" : "body";
        const rest = raw.replace(/^(path|query|header)\s+/i, "");
        const assign = rest.includes(" = ") ? rest.indexOf(" = ") : -1;
        const colon = rest.match(/^([^:]+):\s*(.*)$/);
        let name = rest;
        let example = "";
        let type = "";
        if (assign >= 0) {
          name = rest.slice(0, assign).trim();
          example = rest.slice(assign + 3).trim();
        } else if (colon) {
          name = colon[1].trim();
          example = colon[2].trim();
        } else {
          const loose = rest.match(/^([A-Za-z_][\w.[\]]+)\s+(<[^>]+>|.+)$/);
          if (loose) {
            name = loose[1];
            example = loose[2];
          }
        }
        const star = name.includes("*");
        const field = { name: this._cleanFieldName(name.replace(/\*/g, "")), in: loc, required: star, type };
        if (example) {
          example = example.replace(/\s*card_prof\s*$/i, "").trim();
          if (/^id$/i.test(field.name) && /holder/i.test(example)) example = "<accountholder id>";
          if (/^id$/i.test(field.name) && /card id/i.test(example)) example = "<card id>";
          field.example = example;
        }
        if (place === "response") field.side = "response";
        return field;
      })
      .filter((field) => field.name && !/^http\s*status$/i.test(field.name) && !/^(e_id|card_prof)$/i.test(field.name));
  },

  _cleanFieldName(name) {
    let text = String(name || "")
      .replace(/\{/g, "[")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/\._/g, ".")
      .replace(/_$/g, "")
      .trim();
    if (/^ount_profile_id$/i.test(text)) return "account_profile_id";
    if (/account_profile/i.test(text) && /id$/i.test(text)) return "account_profile_id";
    if (/card_profile/i.test(text) && /id$/i.test(text)) return "card_profile_id";
    if (/^expiry_date$/i.test(text) || /^expiry_date$/i.test(text.replace(/\s/g, "_"))) return "expiry_date";
    if (/onboarded_products\[[^\]]+\]_?\.?status/i.test(text)) return text.replace(/_?status$/i, ".status").replace("..", ".");
    if (/^parent_account[._]account_no$/i.test(text)) return "parent_account.account_no";
    return text;
  },

  _isFieldLine(text) {
    const line = String(text || "").trim();
    if (!line || this._isStatusLine(line)) return false;
    if (/^(GET|POST|PUT|PATCH|DELETE|SOAP)\b/i.test(line) && /[\/[]/.test(line)) return false;
    const cleaned = line.replace(/\{/g, "[");
    if (/^[A-Za-z_][\w.\[\]{ }]*\s*:\s*\S/.test(cleaned)) return true;
    if (/[A-Za-z_][\w.\[\]{} ]*\s*:?\s*<[^>]+>/.test(cleaned)) return true;
    if (
      /\b(product_class_id|account_profile_id|card_profile_id|profile_id|responsible_accountholders|parent_account|expiry_date|serial_no|account_no|onboarded_products)\b/i.test(
        line
      ) &&
      (/:/.test(line) || /</.test(line))
    ) {
      return true;
    }
    if (/^(path|query|header)\s+/i.test(line)) return true;
    if (/ = /.test(line)) return true;
    return false;
  },

  _isStatusLine(text) {
    const line = String(text || "");
    return /h[ilt]{1,2}p\s*status/i.test(line) || /status\s*:?\s*[1-5]\d{2}\b/i.test(line);
  },

  _isChromeLabel(text) {
    return /^\(?\s*(darwin|chopin)\s*\)?$/i.test(String(text || "").trim());
  },

  _isOutcomeRow(groups) {
    if (groups.length < 2 || groups.length > 4) return false;
    return groups.every((group) => {
      const text = group.map((token) => token.text).join(" ");
      return /^(yes|no|true|false|ok|fail|darwin|chopin|allowed|denied)$/i.test(text.trim());
    });
  },

  _outcomeLabel(group) {
    return group.map((token) => token.text).join(" ").trim() || "Path";
  },

  _healBranches(steps) {
    steps.forEach((step, index) => {
      if (step.type !== "condition") return;
      const branches = Array.isArray(step.branches) ? step.branches : FlowIR.defaultBranches();
      branches.forEach((branch, offset) => {
        if (branch.target && steps.some((item) => item.id === branch.target)) return;
        const next = steps[index + 1 + offset];
        if (next && next.id !== step.id) branch.target = next.id;
      });
      step.branches = branches;
    });
  },

  _stepId(type, caption, used, index) {
    let id = `${type === "request" ? "req" : type === "response" ? "res" : type === "condition" ? "if" : "do"}-${FlowParse._slug(caption) || index + 1}`;
    if (used.has(id)) id = `${id}-${index + 1}`;
    used.add(id);
    return id;
  },

  _actorType(name, subtitle) {
    const sub = String(subtitle || "").toLowerCase();
    if (/rest client|soap client/.test(sub)) return "client";
    if (sub === "platform") return "platform";
    if (sub === "client") return "client";
    if (sub === "external") return "external";
    if (sub === "process") return "process";
    if (sub === "internal") return "internal";
    const text = String(name || "").toLowerCase();
    if (/\b(eps|pps|darwin|chopin)\b/.test(text)) return "platform";
    if (/\b(business|member)\b/.test(text)) return "process";
    if (/\b(client|application|app)\b/.test(text)) return "client";
    if (/\bauth\b|\bissuer\b/.test(text)) return "external";
    return "internal";
  },

  _isJunkStep(caption, method, status) {
    const text = String(caption || "").trim();
    if (method || status || this._isStatusLine(text)) return false;
    if (this._isChromeLabel(text) || this._isFieldLine(text)) return true;
    if (/^(header|path|query|body|type|status|object|enum|string|preview|eview|de|http|card id|ountholder id|e_id|card_prof|oa)$/i.test(text)) return true;
    if (text.length <= 2) return true;
    if (/^[a-z]{1,3}_[a-z]{1,3}$/i.test(text)) return true;
    if (/^[A-Fa-f0-9.]{10,}$/.test(text)) return true;
    if (/^(PERSON|ACTIVE|INACTIVE|ORGANISATION|ORGANIZATION)$/i.test(text)) return true;
    return false;
  },

  _looksLikeStep(text) {
    const value = String(text || "").trim();
    return (
      /^(GET|POST|PUT|PATCH|DELETE|SOAP)\b/i.test(value) ||
      /^[1-5]\d{2}\b/.test(value) ||
      this._isStatusLine(value) ||
      /^(issue|create|update|delete|send|card issued|e?ky[cb]|sign\s*up|onboard|apply|enrol|enroll|register|activate|spend)\b/i.test(
        value
      ) ||
      /\?$/.test(value) ||
      this._isFieldLine(value)
    );
  },

  _isActorType(text) {
    return /^(internal|external|process|rest client|soap client)$/i.test(String(text || "").trim());
  },

  _isProtocol(text) {
    return /^(darwin rest|chopin soap|both)$/i.test(String(text || "").trim());
  },

  _isSkip(text) {
    return this.SKIP.has(String(text || "").trim().toLowerCase());
  },

  _isChrome(row) {
    const text = String(row?.text || "").trim().toLowerCase();
    return this._isProtocol(text) || text === "business process" || text === "ops" || text === "developer";
  },

  _readDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Could not read that image"));
      reader.readAsDataURL(file);
    });
  },
};
