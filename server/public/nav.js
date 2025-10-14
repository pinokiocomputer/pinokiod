document.addEventListener("DOMContentLoaded", () => {
  const newWindowButton = document.querySelector("#new-window");
  if (newWindowButton) {
    newWindowButton.addEventListener("click", (event) => {
      const agent = document.body.getAttribute("data-agent");
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
  if (!header || !minimizeButton || !homeLink) {
    return;
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
  }

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

  dispatchHeaderState(state.minimized, { phase: "init" });

  const MIN_MARGIN = 8;

  const clampPosition = (left, top) => {
    const rect = header.getBoundingClientRect();
    const maxLeft = Math.max(0, window.innerWidth - rect.width);
    const maxTop = Math.max(0, window.innerHeight - rect.height);
    return {
      left: Math.min(Math.max(0, left), maxLeft),
      top: Math.min(Math.max(0, top), maxTop),
    };
  };

  const applyPosition = (left, top) => {
    header.style.left = `${left}px`;
    header.style.top = `${top}px`;
    header.style.right = "auto";
    header.style.bottom = "auto";
  };

  const rememberOriginalPosition = () => {
    state.originalPosition = {
      top: header.style.top || "",
      left: header.style.left || "",
      right: header.style.right || "",
      bottom: header.style.bottom || "",
    };
  };

  const measureRect = (configureClone) => {
    const clone = header.cloneNode(true);
    clone.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
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
    clone.remove();
    return rect;
  };

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
  };

  const minimize = () => {
    if (state.minimized || header.classList.contains("transitioning")) {
      return;
    }

    rememberOriginalPosition();

    const firstRect = header.getBoundingClientRect();
    const minimizedSize = measureRect((clone) => {
      clone.classList.add("minimized");
    });

    const defaultLeft = Math.max(MIN_MARGIN, window.innerWidth - minimizedSize.width - MIN_MARGIN);
    const defaultTop = Math.max(MIN_MARGIN, window.innerHeight - minimizedSize.height - MIN_MARGIN);
    const targetLeft = state.hasCustomPosition ? state.lastLeft : defaultLeft;
    const targetTop = state.hasCustomPosition ? state.lastTop : defaultTop;

    state.lastLeft = targetLeft;
    state.lastTop = targetTop;

    stopTransition();

    header.classList.add("minimized");
    applyPosition(targetLeft, targetTop);

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

    state.transitionHandler = (event) => {
      if (event.propertyName !== "transform") {
        return;
      }
      header.removeEventListener("transitionend", state.transitionHandler);
      state.transitionHandler = null;
      stopTransition();
      state.minimized = true;
      dispatchHeaderState(true, { phase: "settled" });
    };

    header.addEventListener("transitionend", state.transitionHandler);
  };

  const restore = () => {
    if (!state.minimized || header.classList.contains("transitioning")) {
      return;
    }

    const firstRect = header.getBoundingClientRect();

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
      dispatchHeaderState(false, { phase: "settled" });
    };

    header.addEventListener("transitionend", state.transitionHandler);
  };

  minimizeButton.addEventListener("click", (event) => {
    event.preventDefault();
    minimize();
  });

  homeLink.addEventListener("click", (event) => {
    if (!state.minimized) {
      return;
    }
    event.preventDefault();
    restore();
  });

  const onPointerDown = (event) => {
    if (!state.minimized || header.classList.contains("transitioning")) {
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
    event.preventDefault();
  };

  const onPointerMove = (event) => {
    if (!state.minimized || state.pointerId !== event.pointerId) {
      return;
    }
    const left = event.clientX - state.offsetX;
    const top = event.clientY - state.offsetY;
    const clamped = clampPosition(left, top);
    state.lastLeft = clamped.left;
    state.lastTop = clamped.top;
    state.hasCustomPosition = true;
    applyPosition(clamped.left, clamped.top);
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
    state.pointerId = null;
  };

  dragHandle.addEventListener("pointerdown", onPointerDown);
  dragHandle.addEventListener("pointermove", onPointerMove);
  dragHandle.addEventListener("pointerup", onPointerEnd);
  dragHandle.addEventListener("pointercancel", onPointerEnd);

  window.addEventListener("resize", () => {
    if (!state.minimized || header.classList.contains("transitioning")) {
      return;
    }
    const { left, top } = clampPosition(state.lastLeft, state.lastTop);
    state.lastLeft = left;
    state.lastTop = top;
    applyPosition(left, top);
  });
});
