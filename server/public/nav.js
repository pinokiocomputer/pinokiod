document.addEventListener("DOMContentLoaded", () => {
  // Logging disabled for production
  const log = () => {};
  const rectInfo = () => null;

  const newWindowButton = document.querySelector("#new-window");
  const agent = document.body.getAttribute("data-agent");
  if (newWindowButton) {
    newWindowButton.addEventListener("click", (event) => {
      if (agent === "electron") {
        window.open("/", "_blank", "pinokio");
      } else {
        window.open("/", "_blank");
      }
    });
  }

  const header = document.querySelector("header.navheader");
  const minimizeButton = document.querySelector("#minimize-header");
  const homeLink = header ? header.querySelector(".home") : null;
  log("init:elements", { hasHeader: !!header, hasMinimize: !!minimizeButton, hasHome: !!homeLink });
  // Only require the header; other controls may be missing on some views
  if (!header) {
    log("init:abort:no-header", {});
    return;
  }

  const homeIcon = homeLink ? homeLink.querySelector("img.icon") : null;
  const ensureHomeExpandIcon = () => {
    if (!homeLink || !homeIcon) {
      return null;
    }
    let icon = homeLink.querySelector(".home-expand-icon");
    if (!icon) {
      icon = document.createElement("i");
      icon.className = "fa-solid fa-expand home-expand-icon";
      icon.setAttribute("aria-hidden", "true");
      homeLink.appendChild(icon);
    }
    return icon;
  };
  ensureHomeExpandIcon();

  // Helper functions used during initial restore must be defined before use
  const MIN_MARGIN = 0;
  const LEGACY_MARGIN = 8;

  function clampPosition(left, top, sizeOverride) {
    const rect = header.getBoundingClientRect();
    const width = sizeOverride && Number.isFinite(sizeOverride.width) ? sizeOverride.width : rect.width;
    const height = sizeOverride && Number.isFinite(sizeOverride.height) ? sizeOverride.height : rect.height;
    const maxLeft = Math.max(0, window.innerWidth - width);
    const maxTop = Math.max(0, window.innerHeight - height);
    return {
      left: Math.min(Math.max(0, left), maxLeft),
      top: Math.min(Math.max(0, top), maxTop),
    };
  }

  function applyPosition(left, top) {
    header.style.left = `${left}px`;
    header.style.top = `${top}px`;
    header.style.right = "auto";
    header.style.bottom = "auto";
    log("pos:apply", { left, top });
  }

  function measureRect(configureClone) {
    const clone = header.cloneNode(true);
    // Avoid duplicate-IDs while preserving #refresh-page so measurement matches visible controls
    clone.querySelectorAll("[id]").forEach((node) => {
      if (node.id !== "refresh-page") {
        node.removeAttribute("id");
      }
    });
    Object.assign(clone.style, {
      transition: "none",
      transform: "none",
      position: "fixed",
      visibility: "hidden",
      pointerEvents: "none",
      margin: "0",
      left: "0",
      top: "0",
      right: "auto",
      bottom: "auto",
      width: "auto",
      height: "auto",
    });
    document.body.appendChild(clone);
    if (typeof configureClone === "function") {
      configureClone(clone);
    }
    clone.style.right = "auto";
    clone.style.bottom = "auto";
    const rect = clone.getBoundingClientRect();
    log("measure", { minimized: !!clone.classList.contains("minimized"), rect: rectInfo(rect) });
    clone.remove();
    return rect;
  }

  const dispatchHeaderState = (minimized, detail = {}) => {
    if (typeof window === "undefined" || typeof window.CustomEvent !== "function") {
      return;
    }
    const payload = { minimized, ...detail };
    document.dispatchEvent(new CustomEvent("pinokio:header-state", { detail: payload }));
    const aliasEvent = minimized ? "pinokio:header-minimized" : "pinokio:header-restored";
    document.dispatchEvent(new CustomEvent(aliasEvent, { detail: { ...payload } }));
  };

  const headerTitle = header.querySelector("h1") || header;
  let dragHandle = headerTitle.querySelector(".header-drag-handle");
  if (!dragHandle) {
    dragHandle = document.createElement("div");
    dragHandle.className = "header-drag-handle";
    dragHandle.setAttribute("aria-hidden", "true");
    dragHandle.setAttribute("title", "Drag minimized header");
    headerTitle.insertBefore(dragHandle, homeLink ? homeLink.nextSibling : headerTitle.firstChild);
    log("init:drag-handle:created", {});
  }

  const STORAGE_KEY = () => `pinokio:header-state:v1:${location.pathname}`;
  const RESTORE_ONCE_KEY = () => `pinokio:header-restore-once:${location.pathname}`;
  const storage = (() => {
    try { return window.sessionStorage; } catch (_) { return null; }
  })();
  const readPersisted = () => {
    if (!storage) return null;
    try {
      const raw = storage.getItem(STORAGE_KEY());
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object") return null;
      const left = Number.isFinite(data.left) ? data.left : null;
      const top = Number.isFinite(data.top) ? data.top : null;
      const minimized = !!data.minimized;
      const out = { minimized, left, top };
      log("storage:read", { key: STORAGE_KEY(), value: out });
      return out;
    } catch (_) {
      return null;
    }
  };
  const writePersisted = (data) => {
    if (!storage) return;
    try {
      const prev = readPersisted() || {};
      const next = { ...prev, ...data };
      storage.setItem(STORAGE_KEY(), JSON.stringify(next));
      log("storage:write", { key: STORAGE_KEY(), value: next });
    } catch (_) {}
  };
  const readRestoreOnce = () => {
    if (!storage) return false;
    try {
      const raw = storage.getItem(RESTORE_ONCE_KEY());
      storage.removeItem(RESTORE_ONCE_KEY());
      return raw === "1";
    } catch (_) { return false; }
  };

  const state = {
    minimized: header.classList.contains("minimized"),
    pointerId: null,
    offsetX: 0,
    offsetY: 0,
    lastLeft: parseFloat(header.style.left) || 0,
    lastTop: parseFloat(header.style.top) || 0,
    hasCustomPosition: false,
    originalPosition: {
      top: header.style.top || "",
      left: header.style.left || "",
      right: header.style.right || "",
      bottom: header.style.bottom || "",
    },
    transitionHandler: null,
  };
  log("init:state", {
    minimizedClass: header.classList.contains("minimized"),
    style: { left: header.style.left, top: header.style.top, right: header.style.right, bottom: header.style.bottom },
    rect: rectInfo(header.getBoundingClientRect())
  });

  // Restore persisted or respect DOM state on load (per path, per session)
  const persisted = readPersisted();
  const restoreFromStorage = !!(persisted && persisted.minimized);
  const hasStoredPosition = !!(persisted && Number.isFinite(persisted.left) && Number.isFinite(persisted.top));
  const isLegacyDefault = hasStoredPosition
    && Math.abs(persisted.left - LEGACY_MARGIN) < 0.5
    && Math.abs(persisted.top - LEGACY_MARGIN) < 0.5;
  const useStoredPosition = restoreFromStorage && hasStoredPosition && !isLegacyDefault;
  const domIsMinimized = header.classList.contains("minimized");
  if (restoreFromStorage || domIsMinimized) {
    header.classList.add("minimized");
    // Use minimized size for clamping/positioning
    const size = measureRect((clone) => { clone.classList.add("minimized"); });
    const fallbackLeft = MIN_MARGIN;
    const fallbackTop = MIN_MARGIN;
    const left = useStoredPosition ? persisted.left : fallbackLeft;
    const top = useStoredPosition ? persisted.top : fallbackTop;
    const clamped = clampPosition(left, top, size);
    state.lastLeft = clamped.left;
    state.lastTop = clamped.top;
    state.hasCustomPosition = useStoredPosition;
    state.minimized = true;
    // Apply immediately and once after layout settles
    applyPosition(clamped.left, clamped.top);
    requestAnimationFrame(() => applyPosition(clamped.left, clamped.top));
    log("init:restore", { restoreFromStorage, domIsMinimized, measured: { width: size.width, height: size.height }, fallback: { left: fallbackLeft, top: fallbackTop }, chosen: { left, top }, clamped });
  } else {
    // Leave DOM/styles as rendered (expanded)
    state.minimized = false;
    log("init:expanded", {});
  }

  dispatchHeaderState(state.minimized, { phase: "init" });

  // MIN_MARGIN is already declared above

  const rememberOriginalPosition = () => {
    state.originalPosition = {
      top: header.style.top || "",
      left: header.style.left || "",
      right: header.style.right || "",
      bottom: header.style.bottom || "",
    };
  };

  // measureRect declared above for early use

  const stopTransition = () => {
    if (state.transitionHandler) {
      header.removeEventListener("transitionend", state.transitionHandler);
      state.transitionHandler = null;
    }
    header.classList.remove("transitioning");
    header.style.transition = "";
    header.style.transform = "";
    header.style.transformOrigin = "";
    header.style.opacity = "";
    header.style.willChange = "";
    log("transition:stop", {});
  };

  const minimize = () => {
    if (state.minimized || header.classList.contains("transitioning")) {
      return;
    }

    rememberOriginalPosition();
    log("minimize:start", { rect: rectInfo(header.getBoundingClientRect()), original: { ...state.originalPosition } });

    const firstRect = header.getBoundingClientRect();
    const minimizedSize = measureRect((clone) => {
      clone.classList.add("minimized");
    });

    const defaultLeft = MIN_MARGIN;
    const defaultTop = MIN_MARGIN;
    const targetLeft = state.hasCustomPosition ? state.lastLeft : defaultLeft;
    const targetTop = state.hasCustomPosition ? state.lastTop : defaultTop;

    // Clamp final position using minimized size so it anchors bottom-right correctly
    const clamped = clampPosition(targetLeft, targetTop, minimizedSize);
    state.lastLeft = clamped.left;
    state.lastTop = clamped.top;
    log("minimize:computed", { minimizedSize, default: { left: defaultLeft, top: defaultTop }, target: { left: targetLeft, top: targetTop }, clamped });

    stopTransition();

    header.classList.add("minimized");
    applyPosition(clamped.left, clamped.top);
    writePersisted({ minimized: true, left: clamped.left, top: clamped.top });

    dispatchHeaderState(true, { phase: "start" });

    const lastRect = header.getBoundingClientRect();
    const deltaX = firstRect.left - lastRect.left;
    const deltaY = firstRect.top - lastRect.top;
    const scaleX = firstRect.width / lastRect.width;
    const scaleY = firstRect.height / lastRect.height;

    header.style.transition = "none";
    header.style.transformOrigin = "top left";
    header.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`;
    header.style.willChange = "transform";

    header.offsetWidth;

    header.classList.add("transitioning");
    header.style.transition = "transform 520ms cubic-bezier(0.22, 1, 0.36, 1)";
    header.style.transform = "";
    // Failsafe: clear transitioning if the event never fires
    setTimeout(() => {
      if (header.classList.contains("transitioning")) {
        log("minimize:failsafe", {});
        stopTransition();
      }
    }, 900);
    // Failsafe: clear transitioning if the event never fires
    setTimeout(() => {
      if (header.classList.contains("transitioning")) {
        stopTransition();
      }
    }, 900);

    state.transitionHandler = (event) => {
      if (event.propertyName !== "transform") {
        return;
      }
      header.removeEventListener("transitionend", state.transitionHandler);
      state.transitionHandler = null;
      stopTransition();
      state.minimized = true;
      writePersisted({ minimized: true, left: state.lastLeft, top: state.lastTop });
      dispatchHeaderState(true, { phase: "settled" });
      log("minimize:done", { lastLeft: state.lastLeft, lastTop: state.lastTop });
    };

    header.addEventListener("transitionend", state.transitionHandler);
  };

  const restore = () => {
    if (!header.classList.contains("minimized") || header.classList.contains("transitioning")) {
      return;
    }

    const firstRect = header.getBoundingClientRect();
    log("restore:start", { rect: rectInfo(firstRect), original: { ...state.originalPosition } });

    stopTransition();

    header.classList.add("transitioning");
    header.style.willChange = "transform";
    header.style.transition = "none";
    header.style.transformOrigin = "top left";

    header.classList.remove("minimized");
    header.style.left = state.originalPosition.left;
    header.style.top = state.originalPosition.top;
    header.style.right = state.originalPosition.right;
    header.style.bottom = state.originalPosition.bottom;

    dispatchHeaderState(false, { phase: "start" });

    const lastRect = header.getBoundingClientRect();
    const deltaX = firstRect.left - lastRect.left;
    const deltaY = firstRect.top - lastRect.top;
    const scaleX = firstRect.width / lastRect.width;
    const scaleY = firstRect.height / lastRect.height;

    header.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`;

    header.offsetWidth;

    header.style.transition = "transform 560ms cubic-bezier(0.18, 0.85, 0.4, 1)";
    header.style.transform = "";
    // Failsafe: clear transitioning if the event never fires
    setTimeout(() => {
      if (header.classList.contains("transitioning")) {
        log("restore:failsafe", {});
        stopTransition();
      }
    }, 900);
    // Failsafe: clear transitioning if the event never fires
    setTimeout(() => {
      if (header.classList.contains("transitioning")) {
        stopTransition();
      }
    }, 900);

    state.transitionHandler = (event) => {
      if (event.propertyName !== "transform") {
        return;
      }
      header.removeEventListener("transitionend", state.transitionHandler);
      state.transitionHandler = null;
      stopTransition();
      state.minimized = false;
      state.hasCustomPosition = false;
      state.lastLeft = parseFloat(header.style.left) || 0;
      state.lastTop = parseFloat(header.style.top) || 0;
      writePersisted({ minimized: false, left: state.lastLeft, top: state.lastTop });
      dispatchHeaderState(false, { phase: "settled" });
      log("restore:done", { left: state.lastLeft, top: state.lastTop });
    };

    header.addEventListener("transitionend", state.transitionHandler);
  };

  if (minimizeButton) {
    minimizeButton.addEventListener("click", (event) => {
      log("click:minimize", {});
      event.preventDefault();
      minimize();
    });
  }

  if (homeLink) {
    homeLink.addEventListener("click", (event) => {
      const minimizedNow = header.classList.contains("minimized");
      log("click:home", { minimizedNow });
      if (!minimizedNow) {
        return;
      }
      event.preventDefault();
      restore();
    });
  }

  const onPointerDown = (event) => {
    if (!header.classList.contains("minimized") || header.classList.contains("transitioning")) {
      return;
    }
    state.pointerId = event.pointerId;
    const rect = header.getBoundingClientRect();
    state.offsetX = event.clientX - rect.left;
    state.offsetY = event.clientY - rect.top;
    if (typeof dragHandle.setPointerCapture === "function") {
      try {
        dragHandle.setPointerCapture(event.pointerId);
      } catch (error) {}
    }
    dragHandle.classList.add("dragging");
    log("drag:start", { pointerId: state.pointerId, rect: rectInfo(rect), offsetX: Math.round(state.offsetX), offsetY: Math.round(state.offsetY) });
    event.preventDefault();
  };

  let __lastPointerLog = 0;
  const onPointerMove = (event) => {
    if (!header.classList.contains("minimized") || state.pointerId !== event.pointerId) {
      return;
    }
    const left = event.clientX - state.offsetX;
    const top = event.clientY - state.offsetY;
    const clamped = clampPosition(left, top);
    state.lastLeft = clamped.left;
    state.lastTop = clamped.top;
    state.hasCustomPosition = true;
    applyPosition(clamped.left, clamped.top);
    writePersisted({ minimized: true, left: clamped.left, top: clamped.top });
    const t = Date.now();
    if (t - __lastPointerLog > 150) {
      __lastPointerLog = t;
      log("drag:move", { left, top, clamped });
    }
  };

  const onPointerEnd = (event) => {
    if (state.pointerId !== event.pointerId) {
      return;
    }
    if (typeof dragHandle.releasePointerCapture === "function") {
      try {
        dragHandle.releasePointerCapture(event.pointerId);
      } catch (error) {}
    }
    dragHandle.classList.remove("dragging");
    log("drag:end", { pointerId: event.pointerId, lastLeft: state.lastLeft, lastTop: state.lastTop });
    state.pointerId = null;
  };

  dragHandle.addEventListener("pointerdown", onPointerDown);
  dragHandle.addEventListener("pointermove", onPointerMove);
  dragHandle.addEventListener("pointerup", onPointerEnd);
  dragHandle.addEventListener("pointercancel", onPointerEnd);
  // Fallback: allow dragging by grabbing empty areas of the minimized header
  const isInteractive = (el) => !!el.closest("a, button, [role='button'], input, select, textarea");
  header.addEventListener("pointerdown", (event) => {
    if (!header.classList.contains("minimized") || isInteractive(event.target) || event.target.closest(".header-drag-handle")) {
      // Interactive controls and the dedicated drag handle use their own handlers
      return;
    }
    log("drag:fallback:pointerdown", { target: event.target && (event.target.id || event.target.className || event.target.nodeName) });
    onPointerDown(event);
  });
  header.addEventListener("pointermove", onPointerMove);
  header.addEventListener("pointerup", onPointerEnd);
  header.addEventListener("pointercancel", onPointerEnd);

  window.addEventListener("resize", () => {
    if (!header.classList.contains("minimized") || header.classList.contains("transitioning")) {
      return;
    }
    const before = { left: state.lastLeft, top: state.lastTop };
    const { left, top } = clampPosition(state.lastLeft, state.lastTop);
    state.lastLeft = left;
    state.lastTop = top;
    applyPosition(left, top);
    writePersisted({ minimized: state.minimized, left, top });
    log("resize:clamp", { before, after: { left, top } });
  });


  // Inspector handling
  const inspectorButton = document.querySelector('#inspector');
  const isDesktop = agent === 'electron';



  if (inspectorButton && isDesktop) {
    inspectorButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();

      try {
        const frameElement = window.frameElement || null;
        const hostNodeId = frameElement?.dataset?.nodeId || null;

        let targetFrame = null;
        try {
          targetFrame =
            document.querySelector('.appcanvas iframe.selected') ||
            document.querySelector('.appcanvas iframe:not(.hidden)');
        } catch (_) {
          targetFrame = null;
        }

        const frameUrl = (() => {
          if (!targetFrame) return window.location.href;
          const attr = targetFrame.getAttribute('src');
          if (attr && attr.trim()) return attr.trim();
          try {
            if (targetFrame.src && targetFrame.src.trim()) {
              return targetFrame.src.trim();
            }
          } catch (_) {}
          return window.location.href;
        })();

        const frameName = (() => {
          if (targetFrame && targetFrame.name && targetFrame.name.trim()) {
            return targetFrame.name.trim();
          }
          if (typeof window.name === 'string' && window.name.trim()) {
            return window.name.trim();
          }
          return null;
        })();

        const frameNodeId =
          (targetFrame?.dataset?.nodeId && targetFrame.dataset.nodeId.trim()) ||
          (hostNodeId && hostNodeId.trim()) ||
          null;

        window.top?.postMessage(
          {
            e: 'pinokio-start-inspector',
            frameUrl,
            frameName,
            frameNodeId,
          },
          '*'
        );
      } catch (err) {
        console.warn('[PinokioInspector] postMessage failed', err);
      }
    }, true);
    window.addEventListener('message', (event) => {
      if (!event || event.source === window || !event.data || !event.data.pinokioInspector) {
        return;
      }
      try {
        window.top?.postMessage(event.data, '*');
      } catch (err) {
        console.warn('[PinokioInspector] relay failed', err);
      }
    });
  }


  if (inspectorButton && !isDesktop) {
    const message = 'The 1-click inspect feature is only available inside the Pinokio desktop app.';

    inspectorButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (window.Swal?.fire) {
        window.Swal.fire({
//          icon: 'info',
          title: 'Switch to Pinokio Desktop',
          html: `<div class="simple-modal-desc2"><div>${message}</div><img src="/inspect.gif"/></div>`,
          showConfirmButton: false,
          customClass: {
            popup: 'min-popup2',
            title: 'min-title',
          },
        });
      } else {
        window.alert(message);
      }
    }, true);
  }


});
