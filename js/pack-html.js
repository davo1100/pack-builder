(function (root) {
  const BRIDGE_ATTR = "data-pack-html-bridge";
  const DESIGN_W = 1600;

  function encode(text) {
    const bytes = new TextEncoder().encode(String(text || ""));
    let bin = "";
    bytes.forEach((b) => {
      bin += String.fromCharCode(b);
    });
    return btoa(bin);
  }

  function decode(encoded) {
    try {
      const bin = atob(String(encoded || ""));
      const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch {
      return "";
    }
  }

  function isFullDocument(raw) {
    const text = String(raw || "").trim();
    return /<!DOCTYPE\s+html/i.test(text) || /<html[\s>]/i.test(text);
  }

  function stripBridge(html) {
    return String(html || "")
      .replace(new RegExp(`<style[^>]*${BRIDGE_ATTR}[\\s\\S]*?<\\/style>`, "gi"), "")
      .replace(new RegExp(`<script[^>]*${BRIDGE_ATTR}[\\s\\S]*?<\\/script>`, "gi"), "")
      .trim();
  }

  function documentFor(raw) {
    const text = String(raw || "").trim();
    if (!text) return "";
    if (isFullDocument(text)) return text;
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${text}</body></html>`;
  }

  function withBridge(html) {
    const source = stripBridge(documentFor(html));
    if (!source) return "";
    // Keep 1600px journey sheets inside the pack content column (clip pills, scale from top-left).
    const style =
      `<style ${BRIDGE_ATTR}>` +
      `html,body{margin:0;padding:0;width:100%;max-width:100%;min-height:0;height:auto;overflow:hidden!important}` +
      `.fit{display:block!important;min-height:0!important;padding:0!important;margin:0!important;` +
      `width:100%!important;max-width:100%!important;overflow:hidden!important;` +
      `justify-content:flex-start!important;align-items:stretch!important}` +
      `.fit-inner,#sheet{transform-origin:top left!important;margin:0!important}` +
      `.ab,.jsheet{overflow:hidden!important}` +
      `</style>`;
    const script =
      `<script ${BRIDGE_ATTR}>(function(){` +
      `var DESIGN=${DESIGN_W};` +
      `function sheetEl(){return document.getElementById("sheet")||document.querySelector(".fit-inner")||document.querySelector(".ab,.jsheet");}` +
      `function naturalHeight(el){` +
      `var inner=el.querySelector&&el.querySelector(".ab,.jsheet");` +
      `var node=inner||el;` +
      `return Math.max(node.scrollHeight||0,node.offsetHeight||0,608);` +
      `}` +
      `function fit(){` +
      `var el=sheetEl();` +
      `if(!el){report();return;}` +
      `var w=Math.max(1,document.documentElement.clientWidth||window.innerWidth||DESIGN);` +
      `var s=Math.min(1,w/DESIGN);` +
      `el.style.boxSizing="border-box";` +
      `el.style.transformOrigin="top left";` +
      `el.style.width=DESIGN+"px";` +
      `el.style.maxWidth="none";` +
      `el.style.margin="0";` +
      `el.style.transform="scale("+s+")";` +
      `var nat=naturalHeight(el);` +
      `el.style.height=Math.ceil(nat*s)+"px";` +
      `report(Math.ceil(nat*s));` +
      `}` +
      `function report(forced){` +
      `var h=forced||0;` +
      `var el=sheetEl();` +
      `if(el){var r=el.getBoundingClientRect();h=Math.max(h,Math.ceil(r.height)||0);}` +
      `h=Math.max(h,Math.ceil((document.body&&document.body.scrollHeight)||0),1);` +
      `try{parent.postMessage({type:"pack-html-size",height:h},"*")}catch(e){}` +
      `}` +
      `window.addEventListener("load",fit);` +
      `window.addEventListener("resize",fit);` +
      `if(typeof ResizeObserver!=="undefined"){try{new ResizeObserver(fit).observe(document.documentElement)}catch(e){}}` +
      `setTimeout(fit,50);setTimeout(fit,400);` +
      `if(document.readyState==="complete")fit();else document.addEventListener("DOMContentLoaded",fit);` +
      `})();</scr` + `ipt>`;
    if (/<\/body>/i.test(source)) return source.replace(/<\/body>/i, `${style}${script}</body>`);
    if (/<\/html>/i.test(source)) return source.replace(/<\/html>/i, `${style}${script}</html>`);
    return `${source}${style}${script}`;
  }

  function ensureFrame(block) {
    let frame = block.querySelector(".pack-html-frame");
    if (frame) return frame;
    frame = block.ownerDocument.createElement("iframe");
    frame.className = "pack-html-frame";
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("title", "Embedded HTML");
    frame.setAttribute("loading", "lazy");
    block.appendChild(frame);
    return frame;
  }

  function mount(root) {
    const scope = root || document;
    if (!scope.querySelectorAll) return;
    scope.querySelectorAll(".pack-html[data-html-src]").forEach((block) => {
      const encoded = block.getAttribute("data-html-src") || "";
      const source = decode(encoded);
      if (!source) return;
      const framed = withBridge(source);
      const frame = ensureFrame(block);
      if (frame.getAttribute("data-mounted") === encoded && frame.srcdoc) return;
      frame.setAttribute("sandbox", "allow-scripts");
      frame.setAttribute("title", "Embedded HTML");
      frame.setAttribute("data-mounted", encoded);
      frame.srcdoc = framed;
    });
  }

  function listen(win) {
    const target = win || (typeof window !== "undefined" ? window : null);
    if (!target || target.__packHtmlListen) return;
    target.__packHtmlListen = true;
    target.addEventListener("message", (event) => {
      if (!event.data || event.data.type !== "pack-html-size") return;
      const height = Number(event.data.height);
      if (!height) return;
      const doc = target.document;
      if (!doc) return;
      doc.querySelectorAll(".pack-html-frame").forEach((frame) => {
        if (frame.contentWindow === event.source) {
          frame.style.height = `${Math.ceil(height)}px`;
        }
      });
    });
  }

  function bind(root) {
    const doc = root?.ownerDocument || (typeof document !== "undefined" ? document : null);
    listen(doc?.defaultView);
    mount(root || doc);
  }

  const PackHtml = {
    encode,
    decode,
    isFullDocument,
    stripBridge,
    documentFor,
    withBridge,
    mount,
    listen,
    bind,
  };

  root.PackHtml = PackHtml;
  if (typeof document !== "undefined") {
    const boot = () => bind(document);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
  }
})(typeof window !== "undefined" ? window : this);
