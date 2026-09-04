const PackSyntax = {
  methodRe: /^(\s*)(URI:\s*)?(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b(\s*)(.*)$/i,
  headerRe: /^(\s*)([A-Za-z][\w!#$%&'*+.^`|~-]*:)(.*)$/,

  escape(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  },

  sanitizeHtml(html) {
    return String(html || "").replace(
      /(<pre\b[^>]*>\s*<code\b[^>]*>)([\s\S]*?)(<\/code>\s*<\/pre>)/gi,
      (_, open, inner, close) => {
        const text = String(inner)
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<\/?(span|font)(\s[^>]*)?>/gi, "")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"');
        return open + this.escape(text) + close;
      }
    );
  },

  plainText(node) {
    if (!node) return "";
    if (node.nodeType === 3) return node.nodeValue || "";
    if (node.nodeType !== 1) return "";
    const tag = node.tagName.toLowerCase();
    if (tag === "br") return "\n";
    const inner = Array.from(node.childNodes)
      .map((child) => this.plainText(child))
      .join("");
    if (["span", "font", "code", "pre", "div"].includes(tag)) return inner;
    if (!node.attributes.length && /^[a-z][a-z0-9_-]*$/.test(tag)) {
      return `<${tag}>${inner}`;
    }
    return inner;
  },

  tok(cls, text) {
    return `<span class="${cls}">${this.escape(text)}</span>`;
  },

  detect(text, prefix, attr) {
    const named = String(attr || "").trim().toLowerCase();
    const stripped = text.replace(/^\s+/, "");
    if (stripped.startsWith("{") || stripped.startsWith("[")) return "json";
    if (this.methodRe.test(stripped) || stripped.toUpperCase().startsWith("URI:")) return "http";
    if (stripped.startsWith("<") && stripped.slice(0, 280).includes(">") && !stripped.toLowerCase().startsWith("<host")) {
      return "xml";
    }
    if (["json", "http", "xml", "text"].includes(named)) return named;
    const hint = String(prefix || "").toLowerCase();
    if (hint.includes("json")) return "json";
    if (hint.includes("http")) return "http";
    if (hint.includes("xml")) return "xml";
    return "text";
  },

  json(src) {
    let i = 0;
    const n = src.length;
    const out = [];
    const keywords = [
      ["true", "tok-keyword json-boolean"],
      ["false", "tok-keyword json-boolean"],
      ["null", "tok-keyword json-null"],
    ];
    while (i < n) {
      const ch = src[i];
      if (" \t\r\n".includes(ch)) {
        let j = i + 1;
        while (j < n && " \t\r\n".includes(src[j])) j += 1;
        out.push(src.slice(i, j));
        i = j;
        continue;
      }
      if (ch === '"') {
        let j = i + 1;
        while (j < n) {
          if (src[j] === "\\") {
            j += 2;
            continue;
          }
          if (src[j] === '"') {
            j += 1;
            break;
          }
          j += 1;
        }
        let k = j;
        while (k < n && " \t\r\n".includes(src[k])) k += 1;
        const cls = k < n && src[k] === ":" ? "tok-key json-key" : "tok-string json-string";
        out.push(this.tok(cls, src.slice(i, j)));
        i = j;
        continue;
      }
      if (ch === "-" || (ch >= "0" && ch <= "9")) {
        const match = src.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
        if (match && (ch !== "-" || (src[i + 1] >= "0" && src[i + 1] <= "9"))) {
          out.push(this.tok("tok-number json-number", match[0]));
          i += match[0].length;
          continue;
        }
      }
      let matched = false;
      for (const [word, cls] of keywords) {
        if (src.startsWith(word, i)) {
          const end = i + word.length;
          const nxt = src[end] || "";
          if (!/[A-Za-z0-9_]/.test(nxt)) {
            out.push(this.tok(cls, word));
            i = end;
            matched = true;
            break;
          }
        }
      }
      if (matched) continue;
      if ("{}[],:".includes(ch)) {
        out.push(this.tok("tok-punct json-punct", ch));
        i += 1;
        continue;
      }
      let j = i + 1;
      while (j < n && !' \t\r\n{}[],:"'.includes(src[j])) j += 1;
      out.push(this.tok("tok-string json-string", src.slice(i, j)));
      i = j;
    }
    return out.join("");
  },

  http(src) {
    const lines = src.split("\n");
    const parts = [];
    let i = 0;
    const emit = (html, index) => {
      parts.push(html);
      if (index < lines.length - 1) parts.push("\n");
    };
    while (i < lines.length) {
      const line = lines[i];
      const match = line.match(this.methodRe);
      if (match) {
        let html = match[1];
        if (match[2]) html += this.tok("tok-punct json-punct", match[2]);
        html += this.tok("tok-method json-boolean", match[3]) + match[4] + this.tok("tok-string json-string", match[5]);
        emit(html, i);
        i += 1;
        break;
      }
      if (line.trimStart().startsWith("{") || line.trimStart().startsWith("[")) {
        parts.push(this.json(lines.slice(i).join("\n")));
        return parts.join("");
      }
      emit(line.trim() ? this.tok("tok-string json-string", line) : line, i);
      i += 1;
    }
    while (i < lines.length) {
      const line = lines[i];
      if (line.trimStart().startsWith("{") || line.trimStart().startsWith("[")) {
        parts.push(this.json(lines.slice(i).join("\n")));
        return parts.join("");
      }
      const header = line.match(this.headerRe);
      if (header) {
        emit(header[1] + this.tok("tok-key json-key", header[2]) + this.tok("tok-string json-string", header[3]), i);
      } else {
        emit(line.trim() ? this.tok("tok-string json-string", line) : line, i);
      }
      i += 1;
    }
    return parts.join("");
  },

  xmlTag(tag) {
    let i = 0;
    const out = [];
    while (i < tag.length) {
      const ch = tag[i];
      if (" \t\r\n".includes(ch)) {
        let j = i + 1;
        while (j < tag.length && " \t\r\n".includes(tag[j])) j += 1;
        out.push(tag.slice(i, j));
        i = j;
        continue;
      }
      if ("<>/?".includes(ch)) {
        out.push(this.tok("tok-punct json-punct", ch));
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'") {
        let j = i + 1;
        while (j < tag.length && tag[j] !== ch) j += 1;
        if (j < tag.length) j += 1;
        out.push(this.tok("tok-string json-string", tag.slice(i, j)));
        i = j;
        continue;
      }
      if (ch === "=") {
        out.push(this.tok("tok-punct json-punct", ch));
        i += 1;
        continue;
      }
      let j = i + 1;
      while (j < tag.length && !" \t\r\n=<>/\"'".includes(tag[j])) j += 1;
      out.push(this.tok("tok-key json-key", tag.slice(i, j)));
      i = j;
    }
    return out.join("");
  },

  xml(src) {
    let i = 0;
    const out = [];
    while (i < src.length) {
      if (src.startsWith("<!--", i)) {
        let end = src.indexOf("-->", i);
        end = end === -1 ? src.length : end + 3;
        out.push(this.tok("tok-comment", src.slice(i, end)));
        i = end;
        continue;
      }
      if (src[i] === "<") {
        const end = src.indexOf(">", i);
        if (end === -1) {
          out.push(this.tok("tok-key json-key", src.slice(i)));
          break;
        }
        out.push(this.xmlTag(src.slice(i, end + 1)));
        i = end + 1;
        continue;
      }
      let j = i + 1;
      while (j < src.length && src[j] !== "<") j += 1;
      out.push(this.escape(src.slice(i, j)));
      i = j;
    }
    return out.join("");
  },

  highlight(text, lang) {
    if (lang === "json") return this.json(text);
    if (lang === "http") return this.http(text);
    if (lang === "xml") return this.xml(text);
    if (text.trimStart().startsWith("{") || text.trimStart().startsWith("[")) return this.json(text);
    if (this.methodRe.test(text.trimStart()) || text.trimStart().toUpperCase().startsWith("URI:")) {
      return this.http(text);
    }
    return this.escape(text);
  },

  context(code) {
    const fold = code.closest(".code-fold, .code-container");
    const header = fold?.querySelector(".code-header")?.textContent || "";
    const summary = fold?.querySelector("summary")?.textContent || "";
    return `${header} ${summary}`;
  },

  paint(code) {
    if (!code) return;
    const text = code.textContent || "";
    if (!text.trim()) return;
    const lang = this.detect(text, this.context(code), code.getAttribute("data-lang"));
    code.setAttribute("data-lang", lang);
    const html = this.highlight(text, lang);
    if (code.innerHTML !== html) code.innerHTML = html;
  },
};
