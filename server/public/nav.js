document.addEventListener("DOMContentLoaded", () => {
  const newWindowButton = document.querySelector("#new-window");
  if (newWindowButton) {
    newWindowButton.addEventListener("click", (event) => {
      let agent = document.body.getAttribute("data-agent");
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

  const headerTitle = header.querySelector("h1") || header;
  let dragHandle = headerTitle.querySelector(".header-drag-handle");
  if (!dragHandle) {
    dragHandle = document.createElement("div");
    dragHandle.className = "header-drag-handle";
    dragHandle.setAttribute("aria-hidden", "true");
    dragHandle.setAttribute("title", "Drag minimized header");
    headerTitle.insertBefore(dragHandle, homeLink.nextSibling);
  }

  const state = {
    minimized: header.classList.contains("minimized"),
    pointerId: null,
    offsetX: 0,
    offsetY: 0,
    lastLeft: 0,
    lastTop: 0,
    hasCustomPosition: false,
    originalPosition: {
      top: header.style.top || "",
      left: header.style.left || "",
      right: header.style.right || "",
      bottom: header.style.bottom || "",
    },
  };

  const rememberOriginalPosition = () => {
    state.originalPosition = {
      top: header.style.top || "",
      left: header.style.left || "",
      right: header.style.right || "",
      bottom: header.style.bottom || "",
    };
  };

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
    header.style.right = 'auto';
    header.style.bottom = 'auto';
  };

  const minimize = () => {
    if (state.minimized) {
      return;
    }
    rememberOriginalPosition();
    header.classList.add("minimized");
    state.minimized = true;
    header.style.right = 'auto';
    header.style.bottom = 'auto';
    const defaultLeft = window.innerWidth - header.offsetWidth - 8;
    const defaultTop = window.innerHeight - header.offsetHeight - 8;
    const desiredLeft = state.hasCustomPosition ? state.lastLeft : defaultLeft;
    const desiredTop = state.hasCustomPosition ? state.lastTop : defaultTop;
    const { left, top } = clampPosition(desiredLeft, desiredTop);
    state.lastLeft = left;
    state.lastTop = top;
    applyPosition(left, top);
  };

  const restore = () => {
    if (!state.minimized) {
      return;
    }
    header.classList.remove("minimized");
    state.minimized = false;
    header.style.left = state.originalPosition.left;
    header.style.top = state.originalPosition.top;
    header.style.right = state.originalPosition.right;
    header.style.bottom = state.originalPosition.bottom;
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
    if (!state.minimized) {
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
    if (!state.minimized) {
      return;
    }
    const { left, top } = clampPosition(state.lastLeft, state.lastTop);
    state.lastLeft = left;
    state.lastTop = top;
    applyPosition(left, top);
  });
});
