(function (global) {
  const STORAGE_KEY = "pack-reader-lang";
  const SOURCE = "en";
  const ATTRS = ["alt", "title", "aria-label", "placeholder"];
  const SKIP_TAGS = /^(SCRIPT|STYLE|NOSCRIPT|CODE|PRE|KBD|SAMP|TEXTAREA)$/;
  const CONCURRENCY = 14;
  const CHUNK = 2000;
  const TRANSLATOR_CACHE = Object.create(null);

  const FLAG_SVG = {
    en:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40" aria-hidden="true">' +
      '<rect width="60" height="40" fill="#012169"/>' +
      '<path d="M0,0 60,40M60,0 0,40" stroke="#fff" stroke-width="10"/>' +
      '<path d="M0,0 60,40M60,0 0,40" stroke="#C8102E" stroke-width="6"/>' +
      '<path d="M30,0v40M0,20h60" stroke="#fff" stroke-width="16"/>' +
      '<path d="M30,0v40M0,20h60" stroke="#C8102E" stroke-width="10"/>' +
      "</svg>",
    fr:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40" aria-hidden="true">' +
      '<rect width="20" height="40" fill="#002395"/>' +
      '<rect x="20" width="20" height="40" fill="#fff"/>' +
      '<rect x="40" width="20" height="40" fill="#ED2939"/>' +
      "</svg>",
    de:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40" aria-hidden="true">' +
      '<rect width="60" height="13.34" fill="#000"/>' +
      '<rect y="13.34" width="60" height="13.33" fill="#D00"/>' +
      '<rect y="26.67" width="60" height="13.33" fill="#FFCE00"/>' +
      "</svg>",
    es:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40" aria-hidden="true">' +
      '<rect width="60" height="40" fill="#AA151B"/>' +
      '<rect y="10" width="60" height="20" fill="#F1BF00"/>' +
      "</svg>",
    it:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40" aria-hidden="true">' +
      '<rect width="20" height="40" fill="#009246"/>' +
      '<rect x="20" width="20" height="40" fill="#fff"/>' +
      '<rect x="40" width="20" height="40" fill="#CE2B37"/>' +
      "</svg>",
    pt:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40" aria-hidden="true">' +
      '<rect width="60" height="40" fill="#FF0000"/>' +
      '<rect width="23" height="40" fill="#006600"/>' +
      '<circle cx="23" cy="20" r="7.5" fill="#FFCC00"/>' +
      '<circle cx="23" cy="20" r="5" fill="#FF0000"/>' +
      "</svg>",
    nl:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40" aria-hidden="true">' +
      '<rect width="60" height="13.34" fill="#AE1C28"/>' +
      '<rect y="13.34" width="60" height="13.33" fill="#fff"/>' +
      '<rect y="26.67" width="60" height="13.33" fill="#21468B"/>' +
      "</svg>",
    pl:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40" aria-hidden="true">' +
      '<rect width="60" height="20" fill="#fff"/>' +
      '<rect y="20" width="60" height="20" fill="#DC143C"/>' +
      "</svg>",
  };

  const LANGS = {
    en: { code: "en", label: "English", native: "English", svg: FLAG_SVG.en },
    fr: { code: "fr", label: "French", native: "Français", svg: FLAG_SVG.fr },
    de: { code: "de", label: "German", native: "Deutsch", svg: FLAG_SVG.de },
    es: { code: "es", label: "Spanish", native: "Español", svg: FLAG_SVG.es },
    it: { code: "it", label: "Italian", native: "Italiano", svg: FLAG_SVG.it },
    pt: { code: "pt", label: "Portuguese", native: "Português", svg: FLAG_SVG.pt },
    nl: { code: "nl", label: "Dutch", native: "Nederlands", svg: FLAG_SVG.nl },
    pl: { code: "pl", label: "Polish", native: "Polski", svg: FLAG_SVG.pl },
  };

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
      "Preparing translations…": "Préparation des traductions…",
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
    de: {
      Language: "Sprache",
      Contents: "Inhalt",
      Confidential: "Vertraulich",
      "Translating…": "Übersetzung…",
      "Downloading language pack…": "Sprachpaket wird geladen…",
      "Preparing translations…": "Übersetzungen werden vorbereitet…",
      Overview: "Übersicht",
      Draft: "Entwurf",
    },
    es: {
      Language: "Idioma",
      Contents: "Contenido",
      Confidential: "Confidencial",
      "Translating…": "Traduciendo…",
      "Downloading language pack…": "Descargando el paquete de idioma…",
      "Preparing translations…": "Preparando traducciones…",
      Overview: "Resumen",
      Draft: "Borrador",
    },
    it: {
      Language: "Lingua",
      Contents: "Sommario",
      Confidential: "Riservato",
      "Translating…": "Traduzione…",
      "Downloading language pack…": "Download del pacchetto lingua…",
      "Preparing translations…": "Preparazione delle traduzioni…",
      Overview: "Panoramica",
      Draft: "Bozza",
    },
    pt: {
      Language: "Idioma",
      Contents: "Conteúdo",
      Confidential: "Confidencial",
      "Translating…": "A traduzir…",
      "Downloading language pack…": "A transferir o pacote de idioma…",
      "Preparing translations…": "A preparar traduções…",
      Overview: "Visão geral",
      Draft: "Rascunho",
    },
    nl: {
      Language: "Taal",
      Contents: "Inhoud",
      Confidential: "Vertrouwelijk",
      "Translating…": "Vertalen…",
      "Downloading language pack…": "Taalpakket downloaden…",
      "Preparing translations…": "Vertalingen voorbereiden…",
      Overview: "Overzicht",
      Draft: "Concept",
    },
    pl: {
      Language: "Język",
      Contents: "Spis treści",
      Confidential: "Poufne",
      "Translating…": "Tłumaczenie…",
      "Downloading language pack…": "Pobieranie pakietu językowego…",
      "Preparing translations…": "Przygotowywanie tłumaczeń…",
      Overview: "Przegląd",
      Draft: "Szkic",
    },
  };

  const maps = Object.create(null);
  const reverse = Object.create(null);
  const originalText = new WeakMap();
  const originalAttr = new WeakMap();
  let phraseKeys = Object.create(null);
  let activeTargets = ["fr"];

  function ensureLang(lang) {
    if (!lang || lang === SOURCE) return;
    if (!maps[lang]) maps[lang] = Object.assign({}, PHRASES[lang] || {});
    if (!reverse[lang]) reverse[lang] = {};
    if (!phraseKeys[lang]) phraseKeys[lang] = [];
  }

  function rebuildLookups(lang) {
    const codes = lang ? [lang] : Object.keys(maps);
    codes.forEach((code) => {
      ensureLang(code);
      reverse[code] = {};
      Object.keys(maps[code]).forEach((en) => {
        reverse[code][maps[code][en]] = en;
      });
      phraseKeys[code] = Object.keys(maps[code]).sort((a, b) => b.length - a.length);
    });
  }

  Object.keys(PHRASES).forEach((code) => ensureLang(code));
  rebuildLookups();

  function normalizeTargets(list) {
    const out = [];
    (list || []).forEach((code) => {
      const key = String(code || "").toLowerCase();
      if (!key || key === SOURCE || !LANGS[key] || out.includes(key)) return;
      out.push(key);
      ensureLang(key);
    });
    return out;
  }

  function readHostConfig(root) {
    const host = (root || document).querySelector?.(".pack-lang") || document.querySelector(".pack-lang");
    if (!host) return { targets: activeTargets.slice() };
    const raw = host.getAttribute("data-targets") || "fr";
    return { targets: normalizeTargets(raw.split(/[,\s]+/)) };
  }

  function ingestPackMap() {
    const pack = global.PACK_I18N;
    if (!pack || typeof pack !== "object") return;
    const bucket = pack.maps && typeof pack.maps === "object" ? pack.maps : null;
    if (bucket) {
      Object.keys(bucket).forEach((lang) => {
        if (!bucket[lang] || typeof bucket[lang] !== "object") return;
        ensureLang(lang);
        Object.keys(bucket[lang]).forEach((en) => {
          if (typeof bucket[lang][en] === "string" && bucket[lang][en]) maps[lang][en] = bucket[lang][en];
        });
      });
    }
    // Backward-compatible single-fr payload
    if (pack.fr && typeof pack.fr === "object") {
      ensureLang("fr");
      Object.keys(pack.fr).forEach((en) => {
        if (typeof pack.fr[en] === "string" && pack.fr[en]) maps.fr[en] = pack.fr[en];
      });
    }
    if (Array.isArray(pack.targets)) activeTargets = normalizeTargets(pack.targets);
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
    for (const lang of Object.keys(maps)) {
      if (maps[lang][text]) return text;
      if (reverse[lang] && reverse[lang][text]) return reverse[lang][text];
    }
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
    if (!lang || lang === SOURCE) return english;
    ensureLang(lang);
    const dict = maps[lang];
    if (!dict) return english;
    if (dict[english]) return dict[english];
    let out = english;
    (phraseKeys[lang] || []).forEach((key) => {
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
    if (text.length <= CHUNK) return [text];
    const parts = [];
    const sentences = text.split(/(?<=[.!?])\s+/);
    let buffer = "";
    sentences.forEach((sentence) => {
      if (buffer && buffer.length + sentence.length + 1 > CHUNK) {
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

  async function getTranslator(target, onDownload, readyOnly) {
    if (!target || target === SOURCE) return null;
    if (!("Translator" in global)) return null;
    const cacheKey = SOURCE + ":" + target;
    if (TRANSLATOR_CACHE[cacheKey]) return TRANSLATOR_CACHE[cacheKey];
    const options = { sourceLanguage: SOURCE, targetLanguage: target };
    let availability = "unavailable";
    try {
      availability = await withTimeout(Translator.availability(options), 3500);
    } catch (err) {
      return null;
    }
    if (availability === "unavailable") return null;
    if (readyOnly && availability !== "available") return null;
    try {
      const translator = await withTimeout(
        Translator.create({
          sourceLanguage: SOURCE,
          targetLanguage: target,
          monitor(monitor) {
            monitor.addEventListener("downloadprogress", (event) => {
              onDownload?.(Math.round((event.loaded || 0) * 100));
            });
          },
        }),
        readyOnly ? 8000 : 45000
      );
      TRANSLATOR_CACHE[cacheKey] = translator;
      return translator;
    } catch (err) {
      return null;
    }
  }

  async function translateMissing(lang, strings, onProgress, readyOnly) {
    ensureLang(lang);
    const missing = strings.filter((text) => text && !maps[lang][text]);
    if (!missing.length) return { translated: 0, failed: false };
    let translator = null;
    try {
      translator = await getTranslator(lang, (percent) => {
        onProgress?.("Downloading language pack…", percent);
      }, readyOnly);
    } catch (err) {
      translator = null;
    }
    if (!translator) return { translated: 0, failed: true };
    let done = 0;
    await mapPool(missing, CONCURRENCY, async (text) => {
      try {
        const chunks = splitForTranslate(text);
        const parts = [];
        for (let i = 0; i < chunks.length; i++) {
          parts.push(await translator.translate(chunks[i]));
        }
        const result = parts.join(" ").trim();
        if (result) maps[lang][text] = result;
      } catch (err) {
        /* keep English for this string */
      }
      done += 1;
      onProgress?.("Translating…", Math.round((done / missing.length) * 100));
    });
    rebuildLookups(lang);
    return { translated: missing.filter((text) => maps[lang][text]).length, failed: false };
  }

  function setStatus(el, message, lang) {
    if (!el) return;
    const text = message ? withPhrases(message, lang || SOURCE) : "";
    el.textContent = text;
    el.hidden = !text;
  }

  function rememberedLang(allowed) {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === SOURCE) return SOURCE;
      if (stored && allowed.includes(stored)) return stored;
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

  function metaFor(code) {
    return LANGS[code] || { code, label: code, native: code, svg: FLAG_SVG.en };
  }

  function flagHtml(code) {
    const meta = metaFor(code);
    return '<span class="pack-lang-flag" aria-hidden="true">' + (meta.svg || FLAG_SVG.en) + "</span>";
  }

  function syncTrigger(root, lang) {
    const meta = metaFor(lang);
    const btn = root.querySelector(".pack-lang-btn");
    const flag = btn ? btn.querySelector(".pack-lang-flag") : root.querySelector(".pack-lang-flag");
    const name = root.querySelector(".pack-lang-name");
    if (flag) flag.innerHTML = meta.svg || FLAG_SVG.en;
    if (name) name.textContent = meta.native;
    if (btn) {
      btn.setAttribute("aria-label", withPhrases("Language", lang) + ": " + meta.native);
      btn.setAttribute("aria-expanded", "false");
    }
    root.querySelectorAll(".pack-lang-option").forEach((option) => {
      const active = option.getAttribute("data-lang") === lang;
      option.setAttribute("aria-selected", active ? "true" : "false");
      option.classList.toggle("is-active", active);
    });
  }

  function closeMenu(root) {
    const list = root.querySelector(".pack-lang-list");
    const btn = root.querySelector(".pack-lang-btn");
    if (list) list.hidden = true;
    if (btn) btn.setAttribute("aria-expanded", "false");
    root.classList.remove("is-open");
  }

  function openMenu(root) {
    const list = root.querySelector(".pack-lang-list");
    const btn = root.querySelector(".pack-lang-btn");
    if (list) list.hidden = false;
    if (btn) btn.setAttribute("aria-expanded", "true");
    root.classList.add("is-open");
  }

  async function setDocumentLang(lang, options) {
    ingestPackMap();
    const cfg = readHostConfig(options?.host || document);
    const allowed = [SOURCE].concat(cfg.targets);
    const next = allowed.includes(lang) ? lang : SOURCE;
    const root = options?.root || document.body;
    const status = options?.status;
    const host = options?.host || document.querySelector(".pack-lang");
    if (host) syncTrigger(host, next);
    document.documentElement.lang = next;
    rememberLang(next);

    applyLang(next, root);
    if (next === SOURCE) {
      setStatus(status, "", next);
      return true;
    }

    const pending = uniqueEnglish(root).filter((text) => !maps[next][text]);
    if (!pending.length) {
      setStatus(status, "", next);
      return true;
    }

    setStatus(status, "Translating…", next);
    await yieldPaint();
    const result = await translateMissing(next, pending, (message, percent) => {
      const label = withPhrases(message, next);
      setStatus(status, percent != null ? label + " " + percent + "%" : label, next);
    }, false);
    applyLang(next, root);
    if (result.failed && pending.some((text) => !maps[next][text])) {
      const note = withPhrases(
        "Could not translate the full document in this browser. Headings and controls are in French.",
        next
      );
      if (host) host.title = note;
      setStatus(status, "", next);
      return false;
    }
    setStatus(status, "", next);
    return true;
  }

  function bindMenu(host) {
    const btn = host.querySelector(".pack-lang-btn");
    const list = host.querySelector(".pack-lang-list");
    const status = host.querySelector(".pack-lang-status");
    if (!btn || !list) return;
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      if (host.classList.contains("is-open")) closeMenu(host);
      else openMenu(host);
    });
    list.addEventListener("click", (event) => {
      const option = event.target.closest(".pack-lang-option");
      if (!option) return;
      const lang = option.getAttribute("data-lang");
      closeMenu(host);
      setDocumentLang(lang, { host, status });
    });
    document.addEventListener("click", (event) => {
      if (!host.contains(event.target)) closeMenu(host);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu(host);
    });
  }

  function ensureMenuStyles() {
    if (document.getElementById("pack-lang-menu-css")) return;
    const style = document.createElement("style");
    style.id = "pack-lang-menu-css";
    style.textContent =
      ".pack-lang-menu{position:relative}" +
      ".pack-lang-btn{appearance:none;display:inline-flex;align-items:center;gap:8px;font-family:inherit;font-size:.82rem;font-weight:600;color:inherit;background:#fff;border:1px solid #e4e0da;border-radius:999px;padding:7px 12px 7px 10px;line-height:1;cursor:pointer;box-shadow:0 1px 2px rgba(32,29,34,.04)}" +
      ".pack-lang-btn:hover,.pack-lang.is-open .pack-lang-btn{border-color:#591bdd;box-shadow:0 0 0 3px rgba(89,27,221,.12)}" +
      ".pack-lang-flag{display:inline-flex;width:20px;height:14px;border-radius:2px;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(0,0,0,.1);flex:0 0 auto}" +
      ".pack-lang-flag svg{width:100%;height:100%;display:block}" +
      ".pack-lang-name{max-width:9.5rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".pack-lang-caret{width:0;height:0;margin-left:2px;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid #857d6b}" +
      ".pack-lang-list{position:absolute;top:calc(100% + 8px);right:0;min-width:200px;margin:0;padding:6px;list-style:none;background:#fff;border:1px solid #e4e0da;border-radius:14px;box-shadow:0 16px 40px rgba(32,29,34,.14);z-index:40}" +
      ".pack-lang-option{display:flex;align-items:center;gap:10px;width:100%;border:0;background:transparent;border-radius:10px;padding:9px 10px;font:inherit;font-size:.84rem;font-weight:600;color:inherit;cursor:pointer;text-align:left}" +
      ".pack-lang-option:hover{background:#f5f3fc}" +
      ".pack-lang-option.is-active{background:#efeaff;color:#45219e}" +
      ".pack-lang-select{display:none!important}";
    document.head.appendChild(style);
  }

  function upgradeLegacyHost(host) {
    if (host.querySelector(".pack-lang-btn")) return false;
    const select = host.querySelector(".pack-lang-select");
    const cfg = readHostConfig(host);
    const codes = [SOURCE].concat(cfg.targets);
    const options = codes
      .map((code) => {
        const meta = metaFor(code);
        return (
          '<li role="option" class="pack-lang-option" data-lang="' +
          code +
          '" aria-selected="false">' +
          flagHtml(code) +
          "<span>" +
          meta.native +
          "</span></li>"
        );
      })
      .join("");
    const en = metaFor(SOURCE);
    const menu = document.createElement("div");
    menu.className = "pack-lang-menu";
    menu.innerHTML =
      '<button type="button" class="pack-lang-btn" aria-haspopup="listbox" aria-expanded="false" aria-label="Language: ' +
      en.native +
      '">' +
      flagHtml(SOURCE) +
      '<span class="pack-lang-name">' +
      en.native +
      "</span>" +
      '<span class="pack-lang-caret" aria-hidden="true"></span>' +
      "</button>" +
      '<ul class="pack-lang-list" role="listbox" hidden>' +
      options +
      "</ul>";
    if (select) select.replaceWith(menu);
    else host.insertBefore(menu, host.firstChild);
    ensureMenuStyles();
    return true;
  }

  function init() {
    ingestPackMap();
    const host = document.querySelector(".pack-lang");
    if (!host) return;
    const cfg = readHostConfig(host);
    activeTargets = cfg.targets;
    const allowed = [SOURCE].concat(activeTargets);
    const start = rememberedLang(allowed);
    upgradeLegacyHost(host);
    ensureMenuStyles();
    if (host.querySelector(".pack-lang-btn")) {
      syncTrigger(host, start);
      bindMenu(host);
    }
    if (start !== SOURCE) setDocumentLang(start, { host, status: host.querySelector(".pack-lang-status") });
  }

  function extraTranslations(lang) {
    ensureLang(lang);
    const seeded = PHRASES[lang] || {};
    const extra = {};
    Object.keys(maps[lang]).forEach((key) => {
      if (seeded[key] !== maps[lang][key]) extra[key] = maps[lang][key];
    });
    return extra;
  }

  function hashStrings(strings) {
    let h = strings.length * 2654435761;
    for (let i = 0; i < strings.length; i++) {
      const s = strings[i];
      h ^= s.length << ((i % 7) + 1);
      if (s) h = (h + s.charCodeAt(0) * (i + 3)) | 0;
      if (s.length > 1) h = (h + s.charCodeAt(s.length - 1) * (i + 11)) | 0;
    }
    return String(h);
  }

  function ingestMapsFromHtml(html) {
    const text = String(html || "");
    const marker = "window.PACK_I18N=";
    const at = text.indexOf(marker);
    if (at === -1) return;
    const start = at + marker.length;
    if (text[start] !== "{") return;
    let depth = 0;
    let inStr = false;
    let esc = false;
    let end = -1;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) {
          esc = false;
          continue;
        }
        if (ch === "\\") {
          esc = true;
          continue;
        }
        if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') {
        inStr = true;
        continue;
      }
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end === -1) return;
    try {
      const pack = JSON.parse(text.slice(start, end));
      global.PACK_I18N = pack;
      ingestPackMap();
    } catch (err) {
      /* ignore malformed pack maps */
    }
  }

  function buildEmbedPayload(targets) {
    const mapsOut = {};
    targets.forEach((lang) => {
      const extra = extraTranslations(lang);
      if (Object.keys(extra).length) mapsOut[lang] = extra;
    });
    const payload = {
      source: SOURCE,
      targets,
      maps: mapsOut,
    };
    if (mapsOut.fr) payload.fr = mapsOut.fr;
    return payload;
  }

  async function warmUp(targets, onStatus) {
    const list = normalizeTargets(targets);
    if (!list.length) return;
    onStatus?.("Preparing translations…");
    await Promise.all(
      list.map((lang) =>
        getTranslator(lang, (percent) => {
          onStatus?.("Downloading language pack… " + percent + "%");
        }, false).catch(() => null)
      )
    );
  }

  async function embedTranslations(html, onStatus, options) {
    ingestMapsFromHtml(html);
    ingestPackMap();
    const targets = normalizeTargets(options?.targets || activeTargets || ["fr"]);
    if (!targets.length) return html;
    activeTargets = targets;

    // Fast export path: keep existing maps + seed phrases, do not run machine translation.
    // Readers translate missing strings when they switch language.
    if (options?.fast) {
      onStatus?.("Preparing language switcher…");
      const payload = buildEmbedPayload(targets);
      global.__PACK_I18N_CACHE = {
        key: "fast|" + targets.join(",") + "|" + Object.keys(payload.maps || {}).length,
        payload,
      };
      return injectPayload(html, payload);
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const strings = uniqueEnglish(doc.body || doc.documentElement);
    const cacheKey = hashStrings(strings) + "|" + targets.join(",");
    if (global.__PACK_I18N_CACHE && global.__PACK_I18N_CACHE.key === cacheKey && global.__PACK_I18N_CACHE.payload) {
      return injectPayload(html, global.__PACK_I18N_CACHE.payload);
    }

    // Warm translators in parallel first (fast language-pack download).
    await warmUp(targets, onStatus);

    const budgetMs = Number(options?.timeoutMs) > 0 ? Number(options.timeoutMs) : 0;
    const started = Date.now();
    for (let i = 0; i < targets.length; i++) {
      if (budgetMs && Date.now() - started > budgetMs) break;
      const lang = targets[i];
      const missing = strings.filter((text) => !maps[lang][text]);
      if (!missing.length) continue;
      const label = metaFor(lang).native;
      onStatus?.("Adding " + label + " translation…");
      await translateMissing(lang, missing, (message, percent) => {
        onStatus?.(percent != null ? message + " " + percent + "%" : message);
      }, Boolean(options?.readyOnly));
    }

    const payload = buildEmbedPayload(targets);
    if (!Object.keys(payload.maps || {}).length && !targets.length) return html;
    global.__PACK_I18N_CACHE = { key: cacheKey, payload };
    return injectPayload(html, payload);
  }

  function injectPayload(html, payload) {
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

  function catalog() {
    return Object.keys(LANGS)
      .filter((code) => code !== SOURCE)
      .map((code) => Object.assign({}, LANGS[code]));
  }

  global.PackLang = {
    SOURCE,
    LANGS,
    catalog,
    init,
    setDocumentLang,
    embedTranslations,
    warmUp,
    collectStrings: uniqueEnglish,
    normalizeTargets,
  };

  function boot() {
    if (document.querySelector(".pack-lang")) init();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(typeof window !== "undefined" ? window : this);
