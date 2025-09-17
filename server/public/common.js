function downloadBlob(blob, filename = 'screenshot.png') {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
async function uploadBlob(blob, filename = 'screenshot.png') {
  const fd = new FormData();
  fd.append('file', blob, filename);

  // Adjust URL as needed; include credentials if you use cookies/sessions
  const res = await fetch('/screenshot', {
    method: 'POST',
    body: fd,
    credentials: 'include'
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed: ${res.status} ${text}`);
  }
  const json = await res.json();
  return json

}
async function screenshot(opts = {}) {
  const {
    container = document.body,
    mimeType = 'image/png',
    autoDownload = false,
    filename = 'screenshot.png'
  } = opts;

  // 1) Capture one frame (no modal visible yet)
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { cursor: 'always' },
    audio: false
  });

  const video = document.createElement('video');
  video.srcObject = stream;
  video.playsInline = true;
  video.muted = true;
  Object.assign(video.style, {
    position: 'fixed', opacity: '0', pointerEvents: 'none', transform: 'translate(-99999px,-99999px)'
  });
  document.body.appendChild(video);

  await new Promise(res => {
    const ready = () => (video.readyState >= 2 ? res() : (video.onloadeddata = () => res()));
    video.addEventListener('loadedmetadata', ready, { once: true });
    video.addEventListener('loadeddata', ready, { once: true });
  });
  await video.play().catch(()=>{});

  const vw = video.videoWidth || 1920;
  const vh = video.videoHeight || 1080;
  const snap = document.createElement('canvas');
  snap.width = vw; snap.height = vh;
  snap.getContext('2d').drawImage(video, 0, 0, vw, vh);

  // Stop quickly; we only needed one frame
  stream.getTracks().forEach(t => t.stop());
  video.remove();

  // 2) Crop UI over STILL image
  const root = document.createElement('div');
  root.style.cssText = `
    position:fixed; inset:0; z-index:2147483647;
    background:rgba(0,0,0,.65); display:grid; place-items:center;
    font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  `;
  const frame = document.createElement('div');
  frame.style.cssText = `
    position:relative; background:#111; border-radius:12px; overflow:hidden;
    box-shadow:0 10px 40px rgba(0,0,0,.5);
    width:min(90vw,1200px);
    display:grid; grid-template-rows:1fr auto;
  `;
  const stage = document.createElement('div');
  stage.style.cssText = `position:relative;background:#000;`;

  const img = new Image();
  img.src = snap.toDataURL('image/png');
  img.style.cssText = `max-width:100%;max-height:100%;display:block;margin:auto;user-select:none;`;

  const overlay = document.createElement('canvas');
  overlay.style.cssText = `position:absolute;inset:0;cursor:crosshair;touch-action:none;`;

  const toolbar = document.createElement('div');
  toolbar.style.cssText = `
    display:flex;gap:8px;padding:10px;background:#0b0b0b;border-top:1px solid #222;
    align-items:center;justify-content:space-between;color:#ddd;font-size:14px;
  `;
  const hint = document.createElement('div');
  hint.textContent = 'Drag to select an area. Click “Save” to export.';
  const right = document.createElement('div');
  right.style.cssText = 'display:flex;gap:8px;';
  const btnCancel = document.createElement('button');
  const btnSave = document.createElement('button');
  [btnCancel, btnSave].forEach(b => {
    b.textContent = b === btnCancel ? 'Cancel' : 'Save';
    b.style.cssText = `
      padding:8px 12px;border-radius:8px;border:1px solid #2a2a2a;
      background:#1a1a1a;color:#eee;cursor:pointer;
    `;
    b.onpointerdown = e => e.preventDefault();
    b.onmouseenter = () => (b.style.background = '#222');
    b.onmouseleave = () => (b.style.background = '#1a1a1a');
  });

  right.append(btnCancel, btnSave);
  toolbar.append(hint, right);
  stage.append(img, overlay);
  frame.append(stage, toolbar);
  root.append(frame);
  container.append(root);

  // 3) Cropping logic (DPR aware + exact image box)
  const dpr = window.devicePixelRatio || 1;
  const ctx = overlay.getContext('2d');

  let dragging = false;
  let start = { x: 0, y: 0 };
  let rect = null; // {x,y,w,h} in CSS px

  function fit() {
    const r = stage.getBoundingClientRect();

    // keep CSS size for layout
    overlay.style.width = r.width + 'px';
    overlay.style.height = r.height + 'px';

    // scale backing store for HiDPI
    overlay.width  = Math.round(r.width  * dpr);
    overlay.height = Math.round(r.height * dpr);

    // 1 canvas unit == 1 CSS px
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    drawOverlay();
  }

  function drawOverlay() {
    ctx.clearRect(0, 0, overlay.width / dpr, overlay.height / dpr);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, overlay.width / dpr, overlay.height / dpr);
    if (rect && rect.w > 2 && rect.h > 2) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
      ctx.strokeStyle = '#00d1ff';
      ctx.lineWidth = 2;
      ctx.setLineDash([6,6]);
      ctx.strokeRect(rect.x+1, rect.y+1, rect.w-2, rect.h-2);
    }
  }

  function toLocal(e) {
    const r = overlay.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  overlay.addEventListener('pointerdown', e => {
    dragging = true;
    start = toLocal(e);
    rect = { x: start.x, y: start.y, w: 0, h: 0 };
    drawOverlay();
  });
  overlay.addEventListener('pointermove', e => {
    if (!dragging) return;
    const p = toLocal(e);
    rect = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
    drawOverlay();
  });
  const endDrag = () => (dragging = false);
  overlay.addEventListener('pointerup', endDrag);
  overlay.addEventListener('pointerleave', endDrag);
  window.addEventListener('resize', fit);

  await new Promise(res => (img.complete ? res() : (img.onload = res)));
  fit();

  function cleanup() {
    window.removeEventListener('resize', fit);
    root.remove();
  }

  // Exact image placement from layout
  function computeImageBox() {
    const ir = img.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    return {
      offsetX: ir.left - sr.left,
      offsetY: ir.top  - sr.top,
      displayW: ir.width,
      displayH: ir.height,
      iw: img.naturalWidth,
      ih: img.naturalHeight
    };
  }

  async function exportCrop() {
    const { offsetX, offsetY, displayW, displayH, iw, ih } = computeImageBox();

    let sx = 0, sy = 0, sw = iw, sh = ih;

    if (rect && rect.w > 4 && rect.h > 4) {
      const rx = Math.max(0, rect.x - offsetX);
      const ry = Math.max(0, rect.y - offsetY);
      const rw = Math.max(0, Math.min(rect.w, displayW - rx));
      const rh = Math.max(0, Math.min(rect.h, displayH - ry));

      const scaleX = iw / displayW;
      const scaleY = ih / displayH;

      // Optional tiny inset to avoid 1px halos on borders
      const epsilon = 0.01;

      sx = Math.max(0, Math.round((rx + epsilon) * scaleX));
      sy = Math.max(0, Math.round((ry + epsilon) * scaleY));
      sw = Math.max(1, Math.round(rw * scaleX));
      sh = Math.max(1, Math.round(rh * scaleY));
    }

    const out = document.createElement('canvas');
    out.width = sw; out.height = sh;
    const octx = out.getContext('2d');
    octx.imageSmoothingQuality = 'high';
    // draw from the full-res snapshot
    octx.drawImage(snap, sx, sy, sw, sh, 0, 0, sw, sh);

    const blob = await new Promise(res => out.toBlob(res, mimeType));
    const dataURL = out.toDataURL(mimeType);

    if (autoDownload && blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
    uploadBlob(blob)
//    downloadBlob(blob)
    return { blob, dataURL };
  }

  return new Promise((resolve, reject) => {
    btnCancel.onclick = () => { cleanup(); reject(new DOMException('Canceled', 'AbortError')); };
    btnSave.onclick = async () => {
      try {
        const res = await exportCrop();
        cleanup();
        resolve(res);
      } catch (e) {
        cleanup();
        reject(e);
      }
    };
  });
}

const open_url2 = (href, target, features) => {
  if (target) {
    if (target === "_blank") {
      // if target=_blank => open in new window
      //  - if features=pinokio => open in pinokio
      //  - otherwise => open in a regular browser
      if (features && features.includes("pinokio")) {
        window.open(href, "_blank", features)
      } else {
        window.open(href, "_blank", features)
        //fetch("/go", {
        //  method: "POST",
        //  headers: {
        //    "Content-Type": "application/json"
        //  },
        //  body: JSON.stringify({ url: el.href })
        //}).then((res) => {
        //  return res.json()
        //}).then((res) => {
        //  console.log(res)
        //})
      }
    } else {
      // no target => just move from the same window
      window.open(href, target, features)
    }
  } else {
    // no target => just use window.open => move in the current window
    window.open(href, "_self", features)
  }
}
hotkeys("ctrl+t,cmd+t,ctrl+n,cmd+n", (e) => {
  open_url2(location.href, "_blank")
//  window.open("/", "_blank", "self")
})
const refreshParent = (e) => {
  if (window.parent === window.top) {
    window.parent.postMessage(e, "*")
  }
}
let tippyInstances = [];

function initTippy() {
  try {
    tippyInstances = tippy("[data-tippy-content]", {
      theme: "pointer",
      onCreate(instance) {
        updateTippyPlacement(instance);
      }
    });
  } catch(e) {
  }
}

function updateTippyPlacement(instance) {
  //const isMobileOrMinimized = window.innerWidth <= 800 || document.body.classList.contains('minimized');
  const isMinimized = document.body.classList.contains('minimized');
  const isHeaderElement = instance.reference.closest('header.navheader');
  const isSidebarTab = instance.reference.closest('aside') && instance.reference.classList.contains('tab');
  
  //if (isHeaderElement && isMobileOrMinimized) {
  if (isMinimized) {
    instance.setProps({ placement: 'right' });
  } else if (isSidebarTab) {
    instance.setProps({ placement: 'left' });
  } else {
    instance.setProps({ placement: 'top' });
  }
}

function updateAllTooltips() {
  tippyInstances.forEach(updateTippyPlacement);
}

function setTabTooltips() {
  // Set data-tippy-content for sidebar tabs based on their .caption text
  const tabs = document.querySelectorAll('aside .tab');
  tabs.forEach(tab => {
    const caption = tab.querySelector('.caption');
    if (caption && caption.textContent.trim()) {
      tab.setAttribute('data-tippy-content', caption.textContent.trim());
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setTabTooltips();
  initTippy();

  if (window.windowStorage) {
    let frame_key = window.frameElement?.name || "";
    let window_mode = windowStorage.getItem(frame_key + ":window_mode")
    if (window_mode) {
      if (window_mode === "minimized") {
        document.body.classList.add("minimized")
        updateAllTooltips()
      }
    }
  }

  if (window !== window.top) {
    document.body.removeAttribute("data-agent")
  }
  
  // Listen for window resize
  window.addEventListener('resize', updateAllTooltips);
  
  // Listen for body class changes (for minimize/maximize)
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.attributeName === 'class' && mutation.target === document.body) {
        updateAllTooltips();
      }
    });
  });
  observer.observe(document.body, { attributes: true });
  
  if (document.querySelector("#screenshot")) {
    document.querySelector("#screenshot").addEventListener("click", (e) => {
      screenshot()
    })
  }
  if (document.querySelector("#back")) {
    document.querySelector("#back").addEventListener("click", (e) => {
      history.back()
    })
  }
  if (document.querySelector("#forward")) {
    document.querySelector("#forward").addEventListener("click", (e) => {
      history.forward()
    })
  }
  if (document.querySelector("#refresh-page")) {
    document.querySelector("#refresh-page").addEventListener("click", (e) => {
      let browserview = document.querySelector(".browserview")
      if (browserview) {
        let iframe = browserview.querySelector("iframe:not(.hidden)")
        try {
          iframe.contentWindow.location.reload()
        } catch (e) {
          iframe.src=iframe.src
        }
        refresh()
      } else {
        location.reload()
      }
    })
  }
  if (document.querySelector("#clone-win")) {
    document.querySelector("#clone-win").addEventListener("click", (e) => {
      open_url2(location.href, "_blank")
    })
  }

  const dropdown = document.querySelector('.dropdown');
  if (dropdown) {
    const dropdownBtn = document.getElementById('window-management');
    const dropdownContent = document.getElementById('dropdown-content');
    let hoverTimeout;

    // Show dropdown on hover
    /*
    dropdown.addEventListener('mouseenter', function() {
        clearTimeout(hoverTimeout);
        openDropdown();
    });

    // Hide dropdown when mouse leaves (with small delay)
    dropdown.addEventListener('mouseleave', function() {
        hoverTimeout = setTimeout(() => {
            closeDropdown();
        }, 100); // Small delay to prevent flickering when moving mouse
    });
    */

    // Toggle dropdown on button click (still works for touch devices)
    dropdownBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        const isOpen = dropdownContent.classList.contains('show');
        
        if (isOpen) {
            closeDropdown();
        } else {
            openDropdown();
        }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', function(e) {
//        if (!dropdown.contains(e.target)) {
            closeDropdown();
//        }
    });

    // Close dropdown when pressing Escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeDropdown();
        }
    });

    function openDropdown() {
        const isMinimized = document.body.classList.contains('minimized');
        
        if (isMinimized) {
            // Create a portal container for centered positioning
            let portal = document.getElementById('dropdown-portal');
            if (!portal) {
                portal = document.createElement('div');
                portal.id = 'dropdown-portal';
                portal.style.cssText = `
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    z-index: 1000000000;
                    pointer-events: none;
                `;
                document.body.appendChild(portal);
            }
            
            // Move dropdown to portal and make it visible
            portal.appendChild(dropdownContent);
            dropdownContent.style.position = 'static';
            dropdownContent.style.pointerEvents = 'auto';
        }
        
        dropdownContent.classList.add('show');
        dropdown.classList.add('active');
    }

    function closeDropdown() {
        const isMinimized = document.body.classList.contains('minimized');
        
        if (isMinimized) {
            // Move dropdown back to original container
            const portal = document.getElementById('dropdown-portal');
            if (portal && dropdownContent.parentElement === portal) {
                dropdown.appendChild(dropdownContent);
                dropdownContent.style.position = '';
                dropdownContent.style.pointerEvents = '';
            }
        }
        
        dropdownContent.classList.remove('show');
        dropdown.classList.remove('active');
    }
  }


  if (document.querySelector("#genlog")) {
    document.querySelector("#genlog").addEventListener("click", (e) => {
      e.preventDefault()
      e.stopPropagation()
      e.target.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>'
      fetch("/pinokio/log", {
        method: "post",
      }).then((res) => {
        let btn = document.querySelector("#genlog")
        let btn2 = document.querySelector("#downloadlogs")
        btn2.classList.remove("hidden") 
        btn.classList.add("hidden")
        btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Generated!'
        //btn.classList.add("hidden")
      })
    })
  }
  if (document.querySelector("#collapse") && window.windowStorage) {
    document.querySelector("#collapse").addEventListener("click", (e) => {
      document.body.classList.toggle("minimized")
      let frame_key = window.frameElement?.name || "";
      if (document.body.classList.contains("minimized")) {
        windowStorage.setItem(frame_key + ":window_mode", "minimized")
      } else {
        windowStorage.setItem(frame_key + ":window_mode", "full")
      }
    })
  }
  if (document.querySelector("#close-window")) {
    const isInIframe = window.self !== window.top;
    if (isInIframe) {
      document.querySelector("#close-window").classList.remove("hidden")
      document.querySelector("#close-window").addEventListener("click", (e) => {
        window.parent.postMessage({
          e: "close"
        }, "*")
//        open_url2(location.href, "_blank")
      })
    }
  }
  if (document.querySelector("#create-new-folder")) {
    document.querySelector("#create-new-folder").addEventListener("click", async (e) => {
      e.preventDefault()
      e.stopPropagation()
      let result = await Swal.fire({
        title: "Create",
        inputPlaceholder: "Enter a folder name to create",
        allowOutsideClick: true,
        confirmButtonText: 'Create',
        input: "text",
      })
      if (result.isDismissed) {
        return false
      }
      let folder = result.value
      //let folder = prompt("Enter a folder name to create")
      if (folder && folder.length > 0) {
      } else {
        alert("Please enter a folder name")
        return false
      }
      if (folder && folder.includes(" ")) {
        alert("Please use a folder path without a space")
        return false
      }
      let response = await fetch("/mkdir", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ folder })
      }).then((res) => {
        return res.json()
      })
      if (response.error) {
        alert(response.error)
      } else {
        location.href = response.success
      }
    })
  }

  initCreateLauncherFlow();

  let createLauncherModalInstance = null;
  let createLauncherKeydownHandler = null;

  function initCreateLauncherFlow() {
    const trigger = document.getElementById('create-launcher-button');
    if (!trigger) return;
    if (trigger.dataset.createLauncherInit === 'true') return;
    trigger.dataset.createLauncherInit = 'true';

    trigger.addEventListener('click', () => {
      showCreateLauncherModal();
    });
  }

  function ensureCreateLauncherModal() {
    if (createLauncherModalInstance) {
      return createLauncherModalInstance;
    }

    const overlay = document.createElement('div');
    overlay.className = 'create-launcher-modal-overlay';
    overlay.style.display = 'none';

    const modal = document.createElement('div');
    modal.className = 'create-launcher-modal';

    const title = document.createElement('h3');
    title.textContent = 'Create';

//    const description = document.createElement('p');
//    description.className = 'create-launcher-modal-description';
//    description.textContent = 'Describe what you want to make.';

    const promptLabel = document.createElement('label');
    promptLabel.className = 'create-launcher-modal-label';
    promptLabel.textContent = 'Prompt';

    const promptTextarea = document.createElement('textarea');
    promptTextarea.className = 'create-launcher-modal-textarea';
    promptTextarea.placeholder = "What do you want to do?";
    promptLabel.appendChild(promptTextarea);

    const folderLabel = document.createElement('label');
    folderLabel.className = 'create-launcher-modal-label';
    folderLabel.textContent = 'Folder name';

    const folderInput = document.createElement('input');
    folderInput.type = 'text';
    folderInput.placeholder = 'example: my-launcher';
    folderInput.className = 'create-launcher-modal-input';
    folderLabel.appendChild(folderInput);


    const toolWrapper = document.createElement('div');
    toolWrapper.className = 'create-launcher-modal-tools';

    const toolTitle = document.createElement('div');
    toolTitle.className = 'create-launcher-modal-tools-title';
    toolTitle.textContent = 'Choose a tool';

    const toolOptions = document.createElement('div');
    toolOptions.className = 'create-launcher-modal-tools-options';

    const tools = [
      { value: 'claude', label: 'Claude Code', defaultChecked: true },
      { value: 'codex', label: 'OpenAI Codex', defaultChecked: false },
      { value: 'gemini', label: 'Google Gemini CLI', defaultChecked: false }
    ];

    const toolEntries = [];

    tools.forEach(({ value, label, defaultChecked }) => {
      const option = document.createElement('label');
      option.className = 'create-launcher-modal-tool';

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'create-launcher-tool';
      radio.value = value;
      if (defaultChecked) {
        radio.checked = true;
      }

      const badge = document.createElement('span');
      badge.className = 'create-launcher-modal-tool-label';
      badge.textContent = label;

      option.appendChild(radio);
      option.appendChild(badge);
      toolOptions.appendChild(option);
      toolEntries.push({ input: radio, container: option });
      radio.addEventListener('change', () => {
        updateToolSelections(toolEntries);
      });
    });

    toolWrapper.appendChild(toolTitle);
    toolWrapper.appendChild(toolOptions);

    const error = document.createElement('div');
    error.className = 'create-launcher-modal-error';

    const actions = document.createElement('div');
    actions.className = 'create-launcher-modal-actions';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'create-launcher-modal-button cancel';
    cancelButton.textContent = 'Cancel';

    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = 'create-launcher-modal-button confirm';
    confirmButton.textContent = 'Create';

    actions.appendChild(cancelButton);
    actions.appendChild(confirmButton);

    const advancedLink = document.createElement('a');
    advancedLink.className = 'create-launcher-modal-advanced';
    advancedLink.href = '/init';
    advancedLink.textContent = 'or, try advanced options';

    modal.appendChild(title);
//    modal.appendChild(description);
    modal.appendChild(promptLabel);
    modal.appendChild(folderLabel);
    modal.appendChild(toolWrapper);
    modal.appendChild(error);
    modal.appendChild(actions);
    modal.appendChild(advancedLink);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    let folderEditedByUser = false;

    folderInput.addEventListener('input', () => {
      folderEditedByUser = true;
    });

    promptTextarea.addEventListener('input', () => {
      if (folderEditedByUser) return;
      folderInput.value = generateFolderSuggestion(promptTextarea.value);
    });

    cancelButton.addEventListener('click', hideCreateLauncherModal);
    confirmButton.addEventListener('click', submitCreateLauncherModal);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        hideCreateLauncherModal();
      }
    });

    advancedLink.addEventListener('click', () => {
      hideCreateLauncherModal();
    });

    createLauncherModalInstance = {
      overlay,
      modal,
      folderInput,
      promptTextarea,
      cancelButton,
      confirmButton,
      error,
      toolEntries,
//      description,
      resetFolderTracking() {
        folderEditedByUser = false;
      }
    };

    updateToolSelections(toolEntries);

    return createLauncherModalInstance;
  }

  function showCreateLauncherModal() {
    const modal = ensureCreateLauncherModal();

    modal.error.textContent = '';
    modal.folderInput.value = '';
    modal.promptTextarea.value = '';
    modal.resetFolderTracking();
    modal.toolEntries.forEach((entry, index) => {
      entry.input.checked = index === 0;
    });
    updateToolSelections(modal.toolEntries);

    modal.overlay.style.display = 'flex';

    requestAnimationFrame(() => {
      //modal.folderInput.focus();
      modal.folderInput.select();
      modal.promptTextarea.focus();
    });

    createLauncherKeydownHandler = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        hideCreateLauncherModal();
      } else if (event.key === 'Enter' && event.target === modal.folderInput) {
        event.preventDefault();
        submitCreateLauncherModal();
      }
    };

    document.addEventListener('keydown', createLauncherKeydownHandler, true);
  }

  function hideCreateLauncherModal() {
    if (!createLauncherModalInstance) return;
    createLauncherModalInstance.overlay.style.display = 'none';
    if (createLauncherKeydownHandler) {
      document.removeEventListener('keydown', createLauncherKeydownHandler, true);
      createLauncherKeydownHandler = null;
    }
  }

  function submitCreateLauncherModal() {
    const modal = ensureCreateLauncherModal();
    const folderName = modal.folderInput.value.trim();
    const prompt = modal.promptTextarea.value.trim();
    const selectedTool = modal.toolEntries.find((entry) => entry.input.checked)?.input.value || 'claude';

    if (!folderName) {
      debugger
      modal.error.textContent = 'Please enter a folder name.';
      modal.folderInput.focus();
      return;
    }

    if (folderName.includes(' ')) {
      debugger
      modal.error.textContent = 'Folder names cannot contain spaces.';
      modal.folderInput.focus();
      return;
    }

    if (!prompt) {
      debugger
      modal.error.textContent = 'Please enter a prompt.';
      modal.promptTextarea.focus();
      return;
    }

    const url = `/pro?name=${encodeURIComponent(folderName)}&message=${encodeURIComponent(prompt)}&tool=${encodeURIComponent(selectedTool)}`;
    hideCreateLauncherModal();
    window.location.href = url;
  }

  function generateFolderSuggestion(prompt) {
    if (!prompt) return '';
    return prompt
      .toLowerCase()
      .replace(/[^a-z0-9\-\s_]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);
  }

  function updateToolSelections(entries) {
    entries.forEach(({ input, container }) => {
      if (input.checked) {
        container.classList.add('selected');
      } else {
        container.classList.remove('selected');
      }
    });
  }
})
