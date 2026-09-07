(function () {
  const MIN_RATIO = 0.25;
  const MAX_RATIO = 8;
  const overlay = document.createElement("div");
  overlay.className = "pack-zoom";
  overlay.hidden = true;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Enlarged view");
  overlay.innerHTML =
    '<div class="pack-zoom-tools">' +
    '<button type="button" class="pack-zoom-out" aria-label="Zoom out">−</button>' +
    '<span class="pack-zoom-level">100%</span>' +
    '<button type="button" class="pack-zoom-in" aria-label="Zoom in">+</button>' +
    '<button type="button" class="pack-zoom-reset">Reset</button>' +
    '<button type="button" class="pack-zoom-close" aria-label="Close">Close</button>' +
    "</div>" +
    '<div class="pack-zoom-view"><div class="pack-zoom-stage"></div></div>';
  document.body.appendChild(overlay);
  const view = overlay.querySelector(".pack-zoom-view");
  const stage = overlay.querySelector(".pack-zoom-stage");
  const level = overlay.querySelector(".pack-zoom-level");
  const closeBtn = overlay.querySelector(".pack-zoom-close");

  let scale = 1;
  let x = 0;
  let y = 0;
  let fitScale = 1;
  let dragging = false;
  let dragged = false;
  let lastX = 0;
  let lastY = 0;
  let pinch = 0;

  function sourceOf(event) {
    if (event.target.closest(".pack-zoom, .pack-flow-tab, .pack-flow-tabs, .pack-flow-radio, a, button, summary")) {
      return null;
    }
    return event.target.closest(".pack-image, .diagram-container, .pack-flow");
  }

  function apply() {
    stage.style.transform = "translate(" + x + "px, " + y + "px) scale(" + scale + ")";
    level.textContent = Math.round((scale / fitScale) * 100) + "%";
  }

  function contentSize() {
    stage.style.transform = "none";
    return { width: Math.max(1, stage.offsetWidth), height: Math.max(1, stage.offsetHeight) };
  }

  function fit() {
    const size = contentSize();
    const pad = 24;
    const next = Math.min((view.clientWidth - pad) / size.width, (view.clientHeight - pad) / size.height);
    fitScale = Math.min(1, next) || 1;
    scale = fitScale;
    x = (view.clientWidth - size.width * scale) / 2;
    y = (view.clientHeight - size.height * scale) / 2;
    apply();
  }

  function zoomTo(next, cx, cy) {
    const low = fitScale * MIN_RATIO;
    const high = fitScale * MAX_RATIO;
    next = Math.min(high, Math.max(low, next));
    const rect = view.getBoundingClientRect();
    const px = cx - rect.left;
    const py = cy - rect.top;
    const ratio = next / scale;
    x = px - (px - x) * ratio;
    y = py - (py - y) * ratio;
    scale = next;
    apply();
  }

  function viewCenter() {
    const rect = view.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function open(source) {
    const clone = source.cloneNode(true);
    clone.querySelectorAll("input[type=radio][name]").forEach((input) => {
      input.name += "-zoom";
    });
    clone.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
    stage.replaceChildren(clone);
    overlay.hidden = false;
    document.body.style.overflow = "hidden";
    fit();
    closeBtn.focus();
  }

  function close() {
    if (overlay.hidden) return;
    overlay.hidden = true;
    dragging = false;
    stage.replaceChildren();
    document.body.style.overflow = "";
    view.classList.remove("is-dragging");
  }

  overlay.querySelector(".pack-zoom-in").addEventListener("click", (event) => {
    event.stopPropagation();
    const center = viewCenter();
    zoomTo(scale * 1.25, center.x, center.y);
  });
  overlay.querySelector(".pack-zoom-out").addEventListener("click", (event) => {
    event.stopPropagation();
    const center = viewCenter();
    zoomTo(scale / 1.25, center.x, center.y);
  });
  overlay.querySelector(".pack-zoom-reset").addEventListener("click", (event) => {
    event.stopPropagation();
    fit();
  });
  closeBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    close();
  });

  view.addEventListener("wheel", (event) => {
    event.preventDefault();
    const factor = event.deltaY > 0 ? 0.9 : 1.1;
    zoomTo(scale * factor, event.clientX, event.clientY);
  }, { passive: false });

  view.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".pack-flow-tab, .pack-flow-tabs, .pack-flow-radio, a, button, summary")) return;
    dragging = true;
    dragged = false;
    lastX = event.clientX;
    lastY = event.clientY;
    view.setPointerCapture(event.pointerId);
    view.classList.add("is-dragging");
  });

  view.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragged = true;
    x += dx;
    y += dy;
    lastX = event.clientX;
    lastY = event.clientY;
    apply();
  });

  function stopDrag(event) {
    if (!dragging) return;
    dragging = false;
    view.classList.remove("is-dragging");
    if (view.hasPointerCapture?.(event.pointerId)) view.releasePointerCapture(event.pointerId);
  }

  view.addEventListener("pointerup", stopDrag);
  view.addEventListener("pointercancel", stopDrag);

  view.addEventListener("dblclick", (event) => {
    if (event.target.closest(".pack-flow-tab, .pack-flow-tabs, .pack-flow-radio, a, button, summary")) return;
    event.preventDefault();
    if (scale > fitScale * 1.05) fit();
    else zoomTo(scale * 2, event.clientX, event.clientY);
  });

  view.addEventListener("touchstart", (event) => {
    if (event.touches.length === 2) {
      const a = event.touches[0];
      const b = event.touches[1];
      pinch = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    }
  }, { passive: true });

  view.addEventListener("touchmove", (event) => {
    if (event.touches.length !== 2 || !pinch) return;
    event.preventDefault();
    const a = event.touches[0];
    const b = event.touches[1];
    const next = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    zoomTo(scale * (next / pinch), (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
    pinch = next;
  }, { passive: false });

  view.addEventListener("touchend", () => {
    pinch = 0;
  });

  document.addEventListener("click", (event) => {
    if (!overlay.hidden) {
      if (dragged) {
        dragged = false;
        return;
      }
      if (event.target === overlay) close();
      return;
    }
    const source = sourceOf(event);
    if (!source) return;
    event.preventDefault();
    open(source);
  });

  document.addEventListener("keydown", (event) => {
    if (overlay.hidden) return;
    if (event.key === "Escape") {
      close();
      return;
    }
    const center = viewCenter();
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomTo(scale * 1.25, center.x, center.y);
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      zoomTo(scale / 1.25, center.x, center.y);
    } else if (event.key === "0") {
      event.preventDefault();
      fit();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      x += 48;
      apply();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      x -= 48;
      apply();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      y += 48;
      apply();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      y -= 48;
      apply();
    }
  });
})();
