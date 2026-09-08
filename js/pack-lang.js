(function (global) {
  const STORAGE_KEY = "pack-reader-lang";
  const SOURCE = "en";
  const ATTRS = ["alt", "title", "aria-label", "placeholder"];
  const SKIP_TAGS = /^(SCRIPT|STYLE|NOSCRIPT|CODE|PRE|KBD|SAMP|TEXTAREA)$/;

  const PHRASES = {
    fr: {
      Language: "Langue",
      Contents: "Sommaire",
      Pages: "Pages",
      "Specification Documents": "Documents de spécification",
      Confidential: "Confidentiel",
      "Open section": "Ouvrir la section",
      Draft: "Brouillon",
      Current: "En cours",
      "Technical documentation": "Documentation technique",
      "Documentation sections": "Sections de la documentation",
      "Business process": "Processus métier",
      Ops: "Exploitation",
      Developer: "Développeur",
      Close: "Fermer",
      Reset: "Réinitialiser",
      "Zoom in": "Zoom avant",
      "Zoom out": "Zoom arrière",
      "Enlarged view": "Vue agrandie",
      "Click to enlarge": "Cliquer pour agrandir",
      "Translating…": "Traduction…",
      "Downloading language pack…": "Téléchargement du pack linguistique…",
      "Could not translate the full document in this browser. Headings and controls are in French.":
        "Impossible de traduire tout le document dans ce navigateur. Les titres et commandes sont en français.",
      Business: "Métier",
      Capability: "Capacité",
      Routing: "Routage",
      Client: "Client",
      Internal: "Interne",
      External: "Externe",
      Platform: "Plateforme",
      Process: "Processus",
      Overview: "Vue d’ensemble",
      Introduction: "Introduction",
      Request: "Requête",
      Response: "Réponse",
      Condition: "Condition",
      Success: "Succès",
      Error: "Erreur",
      Warning: "Avertissement",
      Note: "Remarque",
      Example: "Exemple",
      Required: "Obligatoire",
      Optional: "Facultatif",
      Description: "Description",
      Status: "Statut",
      "New page": "Nouvelle page",
      "Sections:": "Sections :",
      "Each section of this pack, in reading order, with a short summary and a link to open it.":
        "Chaque section de ce pack, dans l’ordre de lecture, avec un court résumé et un lien pour l’ouvrir.",
      "Include at least one chapter page to list it here.":
        "Incluez au moins une page de chapitre pour l’afficher ici.",
      "for authorised clients only": "réservé aux clients autorisés",
      "Confidential — for authorised clients only": "Confidentiel — réservé aux clients autorisés",
      "Edenred Payment Solutions • Technical documentation • Confidential — for authorised clients only":
        "Edenred Payment Solutions • Documentation technique • Confidentiel — réservé aux clients autorisés",
      "Technical documentation | Edenred Payment Solutions":
        "Documentation technique | Edenred Payment Solutions",
    },
  };

  const maps = { fr: Object.assign({}, PHRASES.fr) };
  const reverse = { fr: {} };
  const originalText = new WeakMap();
  const originalAttr = new WeakMap();
  let phraseKeys = [];

  function rebuildLookups() {
    reverse.fr = {};
    Object.keys(maps.fr).forEach((en) => {
      reverse.fr[maps.fr[en]] = en;
    });
    phraseKeys = Object.keys(PHRASES.fr).sort((a, b) => b.length - a.length);
  }
  rebuildLookups();

  function ingestPackMap() {
    const pack = global.PACK_I18N;
    if (!pack || !pack.fr || typeof pack.fr !== "object") return;
    Object.keys(pack.fr).forEach((en) => {
      if (typeof pack.fr[en] === "string" && pack.fr[en]) maps.fr[en] = pack.fr[en];
    });
    rebuildLookups();
  }

  function norm(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function shouldTranslate(text) {
    const value = norm(text);
    if (value.length < 2) return false;
    if (/^[\d\s.,:;%+\-–—/\\()[\]#*]+$/.test(value)) return false;
    if (/^https?:\/\//i.test(value) || /^[\w.+-]+@[\w.-]+$/.test(value)) return false;
    if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/.test(value) && /\/[A-Za-z0-9]/.test(value)) return false;
    if (/^\/[A-Za-z0-9._\-{}\/]+$/.test(value)) return false;
    if (/^\{[A-Za-z0-9_.]+\}$/.test(value)) return false;
    if (/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$/.test(value) && value.length < 80) return false;
    if (/^(application\/|text\/|multipart\/|image\/|audio\/|video\/)/i.test(value)) return false;
    return true;
  }

  function isSkipped(el) {
    if (!el || el.nodeType !== 1) return true;
    if (SKIP_TAGS.test(el.tagName)) return true;
    if (el.closest(".pack-lang, pre, code, kbd, samp, script, style, noscript, textarea")) return true;
    const classes = el.classList ? Array.from(el.classList) : [];
    if (classes.some((name) => name === "tok" || name.startsWith("tok-"))) return true;
    return false;
  }

  function collectTargets(root) {
    const targets = [];
    if (!root) return targets;
    const doc = root.nodeType === 9 ? root : root.ownerDocument || document;
    const title = doc.querySelector("title");
    if (title && title.firstChild && title.firstChild.nodeType === 3 && !root.contains(title)) {
      if (shouldTranslate(title.firstChild.nodeValue)) {
        targets.push({ kind: "text", node: title.firstChild, attr: null });
      }
    }
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      if (isSkipped(node.parentElement)) continue;
      if (!shouldTranslate(node.nodeValue)) continue;
      targets.push({ kind: "text", node, attr: null });
    }
    if (typeof root.querySelectorAll === "function") {
      root.querySelectorAll("[alt], [title], [aria-label], [placeholder]").forEach((el) => {
        if (isSkipped(el)) return;
        ATTRS.forEach((attr) => {
          if (!el.hasAttribute(attr)) return;
          const value = el.getAttribute(attr);
          if (!shouldTranslate(value)) return;
          targets.push({ kind: "attr", node: el, attr });
        });
      });
    }
    return targets;
  }

  function readTarget(target) {
    if (target.kind === "attr") return target.node.getAttribute(target.attr) || "";
    return target.node.nodeValue || "";
  }

  function writeTarget(target, value) {
    if (target.kind === "attr") target.node.setAttribute(target.attr, value);
    else target.node.nodeValue = value;
  }

  function englishOf(value) {
    const text = norm(value);
    if (!text) return text;
    if (maps.fr[text]) return text;
    if (reverse.fr[text]) return reverse.fr[text];
    return text;
  }

  function sourceOf(target) {
    if (target.kind === "attr") {
      let bag = originalAttr.get(target.node);
      if (!bag) {
        bag = {};
        originalAttr.set(target.node, bag);
      }
      if (!(target.attr in bag)) bag[target.attr] = englishOf(readTarget(target));
      return bag[target.attr];
    }
    if (!originalText.has(target.node)) originalText.set(target.node, englishOf(readTarget(target)));
    return originalText.get(target.node);
  }

  function withPhrases(english, lang) {
    if (lang === SOURCE) return english;
    const dict = maps[lang];
    if (!dict) return english;
    if (dict[english]) return dict[english];
    let out = english;
    phraseKeys.forEach((key) => {
      if (!key || key.length < 4 || out.indexOf(key) === -1) return;
      const replacement = dict[key];
      if (!replacement || replacement === key) return;
      const pattern = key.indexOf(" ") === -1
        ? new RegExp("\\b" + escapeRegExp(key) + "\\b", "g")
        : new RegExp(escapeRegExp(key), "g");
      out = out.replace(pattern, replacement);
    });
    return out;
  }

  function uniqueEnglish(root) {
    const seen = new Set();
    collectTargets(root).forEach((target) => {
      const english = sourceOf(target);
      if (english) seen.add(english);
    });
    return Array.from(seen);
  }

  function applyLang(lang, root) {
    collectTargets(root || document.body).forEach((target) => {
      writeTarget(target, withPhrases(sourceOf(target), lang));
    });
  }

  function splitForTranslate(text) {
    if (text.length <= 1200) return [text];
    const parts = [];
    const sentences = text.split(/(?<=[.!?])\s+/);
    let buffer = "";
    sentences.forEach((sentence) => {
      if (buffer && buffer.length + sentence.length + 1 > 1200) {
        parts.push(buffer);
        buffer = sentence;
      } else {
        buffer = buffer ? buffer + " " + sentence : sentence;
      }
    });
    if (buffer) parts.push(buffer);
    return parts.length ? parts : [text];
  }

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), ms);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }

  async function mapPool(items, limit, fn) {
    const results = new Array(items.length);
    let index = 0;
    async function worker() {
      while (index < items.length) {
        const current = index++;
        results[current] = await fn(items[current], current);
      }
    }
    const workers = Math.min(Math.max(1, limit), items.length || 1);
    await Promise.all(Array.from({ length: workers }, () => worker()));
    return results;
  }

  async function getTranslator(onDownload, readyOnly) {
    if (!("Translator" in global)) return null;
    const options = { sourceLanguage: "en", targetLanguage: "fr" };
    let availability = "unavailable";
    try {
      availability = await withTimeout(Translator.availability(options), 4000);
    } catch (err) {
      return null;
    }
    if (availability === "unavailable") return null;
    if (readyOnly && availability !== "available") return null;
    try {
      return await withTimeout(
        Translator.create({
          sourceLanguage: "en",
          targetLanguage: "fr",
          monitor(monitor) {
            monitor.addEventListener("downloadprogress", (event) => {
              onDownload?.(Math.round((event.loaded || 0) * 100));
            });
          },
        }),
        readyOnly ? 6000 : 20000
      );
    } catch (err) {
      return null;
    }
  }

  async function translateMissing(strings, onProgress, readyOnly) {
    const missing = strings.filter((text) => text && !maps.fr[text]);
    if (!missing.length) return { translated: 0, failed: false };
    let translator = null;
    try {
      translator = await getTranslator((percent) => {
        onProgress?.("Downloading language pack…", percent);
      }, readyOnly);
    } catch (err) {
      translator = null;
    }
    if (!translator) return { translated: 0, failed: true };
    let done = 0;
    await mapPool(missing, 6, async (text) => {
      try {
        const chunks = splitForTranslate(text);
        const parts = [];
        for (let i = 0; i < chunks.length; i++) {
          parts.push(await translator.translate(chunks[i]));
        }
        const result = parts.join(" ").trim();
        if (result) maps.fr[text] = result;
      } catch (err) {
        /* keep English for this string */
      }
      done += 1;
      onProgress?.("Translating…", Math.round((done / missing.length) * 100));
    });
    rebuildLookups();
    return { translated: missing.filter((text) => maps.fr[text]).length, failed: false };
  }

  function setStatus(el, message, lang) {
    if (!el) return;
    const text = message ? withPhrases(message, lang || SOURCE) : "";
    el.textContent = text;
    el.hidden = !text;
  }

  function rememberedLang() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "fr" || stored === "en") return stored;
    } catch (err) {
      /* ignore */
    }
    return SOURCE;
  }

  function rememberLang(lang) {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (err) {
      /* ignore */
    }
  }

  function yieldPaint() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  async function setDocumentLang(lang, options) {
    ingestPackMap();
    const next = lang === "fr" ? "fr" : "en";
    const root = options?.root || document.body;
    const status = options?.status;
    const select = options?.select;
    if (select) select.value = next;
    document.documentElement.lang = next;
    rememberLang(next);
    if (select) select.setAttribute("aria-label", withPhrases("Language", next));
    if (select && next === SOURCE) select.removeAttribute("title");

    applyLang(next, root);
    if (next === SOURCE) {
      setStatus(status, "", next);
      return true;
    }

    const pending = uniqueEnglish(root).filter((text) => !maps.fr[text]);
    if (!pending.length) {
      setStatus(status, "", next);
      return true;
    }

    setStatus(status, "Translating…", next);
    await yieldPaint();
    const result = await translateMissing(pending, (message, percent) => {
      const label = withPhrases(message, next);
      setStatus(status, percent != null ? label + " " + percent + "%" : label, next);
    }, false);
    applyLang(next, root);
    if (result.failed && pending.some((text) => !maps.fr[text])) {
      const note = withPhrases(
        "Could not translate the full document in this browser. Headings and controls are in French.",
        next
      );
      if (select) select.title = note;
      setStatus(status, "", next);
      return false;
    }
    setStatus(status, "", next);
    return true;
  }

  function init() {
    ingestPackMap();
    const select = document.querySelector(".pack-lang-select");
    if (!select) return;
    const status = document.querySelector(".pack-lang-status");
    const start = rememberedLang();
    select.value = start;
    select.addEventListener("change", () => {
      setDocumentLang(select.value, { select, status });
    });
    if (start !== SOURCE) setDocumentLang(start, { select, status });
  }

  function extraTranslations() {
    const extra = {};
    Object.keys(maps.fr).forEach((key) => {
      if (PHRASES.fr[key] !== maps.fr[key]) extra[key] = maps.fr[key];
    });
    return extra;
  }

  async function embedTranslations(html, onStatus) {
    ingestPackMap();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const strings = uniqueEnglish(doc.body || doc.documentElement);
    const missing = strings.filter((text) => !maps.fr[text]);
    if (missing.length) {
      onStatus?.("Adding French translation…");
      await translateMissing(missing, (message, percent) => {
        onStatus?.(percent != null ? message + " " + percent + "%" : message);
      }, true);
    }
    const extra = extraTranslations();
    if (!Object.keys(extra).length) return html;
    const payload = { source: SOURCE, fr: extra };
    const json = JSON.stringify(payload).split("<").join("\\u003c");
    const close = "</scr" + "ipt>";
    const tag = "<script>window.PACK_I18N=" + json + ";" + close + "\n";
    const existing = new RegExp("<script>window\\.PACK_I18N=[\\s\\S]*?;" + close + "\\n?");
    if (existing.test(html)) return html.replace(existing, tag);
    const headClose = "</hea" + "d>";
    if (html.indexOf(headClose) !== -1) return html.replace(headClose, tag + headClose);
    const bodyClose = "</bod" + "y>";
    if (html.indexOf(bodyClose) !== -1) return html.replace(bodyClose, tag + bodyClose);
    return html + tag;
  }

  global.PackLang = {
    init,
    setDocumentLang,
    embedTranslations,
    collectStrings: uniqueEnglish,
  };

  function boot() {
    if (document.querySelector(".pack-lang-select")) init();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(typeof window !== "undefined" ? window : this);
