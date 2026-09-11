(function (root) {
  const DESIGN_W = 1600;

  function ensureSheet(host) {
    if (!host || !host.querySelector) return null;
    let sheet = host.querySelector(":scope > .pack-journey-sheet");
    if (sheet) return sheet;
    const doc = host.ownerDocument;
    sheet = doc.createElement("div");
    sheet.className = "pack-journey-sheet";
    while (host.firstChild) sheet.appendChild(host.firstChild);
    host.appendChild(sheet);
    return sheet;
  }

  /** Width of the page column the journey sits in (aligned with hero, etc.). */
  function measureWidth(host) {
    const w = host.clientWidth || host.getBoundingClientRect().width || 0;
    if (w > 0) return w;
    const parent = host.parentElement;
    if (parent) return Math.max(1, parent.clientWidth || DESIGN_W);
    return DESIGN_W;
  }

  /** Cancel parent card padding so the journey lines up with heroes / page blocks. */
  function alignToPage(host) {
    host.style.boxSizing = "border-box";
    host.style.marginLeft = "";
    host.style.marginRight = "";
    host.style.width = "100%";
    host.style.maxWidth = "100%";

    const card = host.closest(".content-card, .overview-section");
    if (!card || card === host) return;

    const win = host.ownerDocument.defaultView;
    if (!win) return;
    const cs = win.getComputedStyle(card);
    const pl = parseFloat(cs.paddingLeft) || 0;
    const pr = parseFloat(cs.paddingRight) || 0;
    if (!pl && !pr) return;

    // Only break out when the journey is a direct (or near-direct) child of the card.
    if (host.parentElement !== card && host.parentElement?.parentElement !== card) return;

    host.style.marginLeft = -pl + "px";
    host.style.marginRight = -pr + "px";
    host.style.width = "calc(100% + " + (pl + pr) + "px)";
    host.style.maxWidth = "none";
  }

  function fitOne(host) {
    const sheet = ensureSheet(host);
    if (!sheet) return;

    // Inactive tab panels are display:none — measuring them yields 0 and used to
    // bake height:0 into the saved HTML, so downloads showed an empty frame.
    const hostWidth = host.clientWidth || host.getBoundingClientRect().width || 0;
    if (hostWidth < 2) {
      if (host.style.height === "0px") host.style.height = "auto";
      return;
    }

    alignToPage(host);
    host.style.height = "auto";

    const width = measureWidth(host);
    if (width < 2) return;

    const scale = Math.min(1, Math.max(0.05, width / DESIGN_W));
    sheet.style.width = DESIGN_W + "px";
    sheet.style.maxWidth = "none";
    sheet.style.height = "auto";
    sheet.style.marginBottom = "0";
    sheet.style.transformOrigin = "top left";
    sheet.style.transform = "scale(" + scale + ")";

    const natural = Math.max(sheet.scrollHeight || 0, sheet.offsetHeight || 0);
    if (natural < 1) return;

    sheet.style.marginBottom = Math.ceil(natural * scale - natural) + "px";
    host.style.height = Math.ceil(natural * scale) + "px";
    host.style.overflow = "hidden";
    host.style.setProperty("--journey-scale", String(scale));
  }

  function fit(scope) {
    const rootEl = scope && scope.querySelectorAll ? scope : root.document;
    if (!rootEl || !rootEl.querySelectorAll) return;
    rootEl.querySelectorAll(".pack-journey").forEach(fitOne);
  }

  function scheduleFit(rootEl) {
    fit(rootEl);
    const win = rootEl.defaultView || (rootEl.ownerDocument && rootEl.ownerDocument.defaultView) || root;
    if (win && typeof win.requestAnimationFrame === "function") {
      win.requestAnimationFrame(() => fit(rootEl));
    }
  }

  function bind(scope, options) {
    const rootEl = scope && scope.querySelectorAll ? scope : root.document;
    if (!rootEl) return;
    scheduleFit(rootEl);
    const win = rootEl.defaultView || (rootEl.ownerDocument && rootEl.ownerDocument.defaultView) || root;

    if (!rootEl.__packJourneyTabs) {
      rootEl.__packJourneyTabs = true;
      rootEl.addEventListener("change", (event) => {
        if (event.target && event.target.matches && event.target.matches(".pack-tab-radio")) {
          scheduleFit(rootEl);
        }
      });
    }

    if (typeof ResizeObserver === "undefined") {
      win.addEventListener("resize", () => scheduleFit(rootEl));
      return;
    }
    if (!rootEl.__packJourneyRO) {
      rootEl.__packJourneyRO = new ResizeObserver(() => scheduleFit(rootEl));
      rootEl.querySelectorAll(".pack-journey").forEach((host) => rootEl.__packJourneyRO.observe(host));
      if (rootEl.documentElement) rootEl.__packJourneyRO.observe(rootEl.documentElement);
      else if (rootEl.ownerDocument && rootEl.ownerDocument.documentElement) {
        rootEl.__packJourneyRO.observe(rootEl.ownerDocument.documentElement);
      }
    } else {
      rootEl.querySelectorAll(".pack-journey").forEach((host) => {
        try {
          rootEl.__packJourneyRO.observe(host);
        } catch (_) {}
      });
    }
    const frame = options && options.frame;
    if (frame && !frame.__packJourneyRO) {
      frame.__packJourneyRO = new ResizeObserver(() => scheduleFit(rootEl));
      frame.__packJourneyRO.observe(frame);
    }
    // Also watch the parent column so width changes reflow the scale.
    rootEl.querySelectorAll(".pack-journey").forEach((host) => {
      if (host.parentElement) {
        try {
          rootEl.__packJourneyRO.observe(host.parentElement);
        } catch (_) {}
      }
    });
  }

  root.PackJourney = { DESIGN_W, ensureSheet, fitOne, fit, bind, measureWidth };

  if (root.document) {
    const start = () => bind(root.document);
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", start);
    else start();
  }
})(typeof window !== "undefined" ? window : this);
