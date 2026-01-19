const CAPTURE_MIN_SIZE = 32;
let pinokioDevGuardSatisfied = false;
const createLauncherDebugLog = (...args) => {
  try {
    console.log('[CreateLauncherGuard]', ...args);
  } catch (_) {
    // ignore logging failures
  }
};

const guardedRoutePrefixes = [
  '/pinokio/launch/',
  '/pinokio/browser/',
  '/v/',
  '/p/',
  '/api/',
  '/_api/',
  '/run/',
  '/tools',
  '/bundle/',
  '/init',
  '/connect/',
  '/github',
  '/setup/',
  '/requirements_check/',
  '/agents',
  '/network',
  '/net/',
  '/git/',
  '/dev/',
];

function needsRequirementsGuard(targetUrl) {
  try {
    const url = typeof targetUrl === 'string' ? new URL(targetUrl, window.location.href) : targetUrl;
    const path = url.pathname || '';
    const query = url.searchParams || new URLSearchParams(url.search || '');
    if (path === '/home') {
      const mode = (query.get('mode') || '').toLowerCase();
      return mode === 'download';
    }
    for (const prefix of guardedRoutePrefixes) {
      if (path === prefix || path.startsWith(prefix)) {
        return true;
      }
    }
    return false;
  } catch (_) {
    // Be safe and keep guarding if we cannot parse
    return true;
  }
}

function createMinimalLoadingSwal () {
  if (typeof window === 'undefined' || typeof window.Swal === 'undefined') {
    return () => {};
  }
  const swal = window.Swal;
  if (typeof swal.fire !== 'function') {
    return () => {};
  }
  const close = () => {
    if (swal.isVisible()) {
      swal.close();
    }
  };
  swal.fire({
    html: "<i class='fa-solid fa-circle-notch fa-spin'></i> Backend still warming up...",
    allowOutsideClick: false,
    allowEscapeKey: false,
    showConfirmButton: false,
    customClass: {
      container: 'loader-container',
      popup: 'loader-popup',
      htmlContainer: 'loader-dialog',
      footer: 'hidden',
      actions: 'hidden'
    }
  });
  return close;
}
function check_ready () {
  createLauncherDebugLog('check_ready start');
  return fetch("/pinokio/requirements_ready").then((res) => {
    return res.json()
  }).then((res) => {
    createLauncherDebugLog('check_ready response', res);
    if (res.error) {
      return false
    } else if (!res.requirements_pending) {
      return true
    }
    return false
  })
}

function check_dev () {
  createLauncherDebugLog('check_dev start');
  let controller = null;
  let timeoutId = null;
  if (typeof AbortController === 'function') {
    try {
      controller = new AbortController();
      timeoutId = setTimeout(() => {
        try {
          controller.abort();
        } catch (_) {}
      }, 7000);
    } catch (_) {
      controller = null;
    }
  }

  const fetchPromise = fetch('/bundle/dev', controller ? { signal: controller.signal } : undefined).then((response) => response.json());
  const timedPromise = controller ? fetchPromise : Promise.race([
    fetchPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('dev status timeout')), 7000))
  ]);

  return timedPromise.then((payload) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    createLauncherDebugLog('check_dev response', payload);
    return payload
  }).catch((error) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    createLauncherDebugLog('check_dev error', error);
    return { available: null, transientError: true }
  })
}


/*
let onfinish = await wait_ready()
if (onfinish) {
  onfinish()
}
// The original task
*/
function wait_ready (targetUrl = null, options = {}) {
  createLauncherDebugLog('wait_ready invoked');
  const showLoader = !(options && options.showLoader === false);
  let navTarget = null;
  if (targetUrl) {
    try {
      navTarget = targetUrl instanceof URL ? targetUrl : new URL(targetUrl, window.location.href);
    } catch (_) {
      navTarget = null;
    }
    if (navTarget && !needsRequirementsGuard(navTarget)) {
      createLauncherDebugLog('wait_ready short-circuit (unguarded route)', { path: navTarget.pathname });
      return Promise.resolve({ ready: true, closeModal: null });
    }
  }
  return new Promise((resolve, reject) => {
    check_ready().then((ready) => {
      createLauncherDebugLog('wait_ready initial requirements readiness', ready);
      let loader = null;
      const ensureLoader = () => {
        if (!showLoader) return null;
        if (!loader) {
          loader = createMinimalLoadingSwal();
        }
        return loader;
      };
      const finalize = (result) => {
        if (result && result.ready) {
          pinokioDevGuardSatisfied = true;
        }
        resolve(result);
      };
      if (ready) {
        const initialLoader = pinokioDevGuardSatisfied ? null : ensureLoader();
        ensureDevReady(initialLoader, 'initial', undefined, showLoader).then(finalize)
      } else {
        ensureLoader();
        let interval = setInterval(() => {
          check_ready().then((ready) => {
            createLauncherDebugLog('wait_ready polling requirements readiness', ready);
            if (ready) {
              clearInterval(interval)
              ensureDevReady(loader, 'after poll', undefined, showLoader).then(finalize)
            }
          })
        }, 500)
      }
    })
  })
}

function ensureDevReady(existingLoader = null, label = 'initial', maxWaitMs = 15000, showLoader = true) {
  let loader = existingLoader;
  const ensureLoader = () => {
    if (!showLoader) return null;
    if (!loader) {
      loader = createMinimalLoadingSwal();
    }
    return loader;
  };

  return new Promise((resolve) => {
    const started = Date.now();
    const attempt = (contextLabel) => {
      check_dev().then((data) => {
        if (data && data.transientError) {
          createLauncherDebugLog('wait_ready dev bundle transient error', data);
          ensureLoader();
          setTimeout(() => attempt('retry'), 500);
          return;
        }
        const available = !(data && data.available === false)
        createLauncherDebugLog('wait_ready dev bundle availability (' + contextLabel + ')', available, data);
        if (available) {
          resolve({ ready: true, closeModal: loader })
          return;
        }
        createLauncherDebugLog('wait_ready dev bundle unavailable - resolving immediately', { contextLabel, data });
        resolve({ ready: false, closeModal: ensureLoader() })
        return;
      })
    };
    attempt(label)
  })
}

function collectPostMessageTargets(contextWindow) {
  const ctx = contextWindow || window;
  const targets = new Set();
  const addTarget = (candidate) => {
    if (!candidate || candidate === ctx) {
      return;
    }
    try {
      if (typeof candidate.postMessage !== 'function') {
        return;
      }
    } catch (_) {
      return;
    }
    targets.add(candidate);
  };
  try {
    addTarget(ctx.parent);
  } catch (_) {}
  try {
    addTarget(ctx.top);
  } catch (_) {}
  try {
    addTarget(ctx.opener);
  } catch (_) {}
  return targets;
}

function pinokioBroadcastMessage(payload, targetOrigin = '*', contextWindow = null) {
  const ctx = (contextWindow && typeof contextWindow === 'object') ? contextWindow : window;
  let dispatched = false;
  let targets;
  try {
    targets = collectPostMessageTargets(ctx);
  } catch (_) {
    targets = new Set();
  }
  if (targets.size === 0) {
    try {
      const origin = (() => {
        try {
          return ctx.location ? ctx.location.origin : window.location.origin;
        } catch (_) {
          return '*';
        }
      })();
      const event = new MessageEvent('message', {
        data: payload,
        origin,
        source: ctx
      });
      ctx.dispatchEvent(event);
      dispatched = true;
    } catch (_) {}
    return dispatched;
  }
  targets.forEach((target) => {
    try {
      target.postMessage(payload, targetOrigin);
      dispatched = true;
    } catch (_) {}
  });
  return dispatched;
}

if (typeof window !== 'undefined' && typeof window.PinokioBroadcastMessage !== 'function') {
  window.PinokioBroadcastMessage = pinokioBroadcastMessage;
}

async function uploadCapture(blob, filename) {
  const fd = new FormData();
  fd.append('file', blob, filename);

  const endpoints = ['/capture', '/screenshot'];
  let lastError;

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body: fd,
        credentials: 'include'
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Upload failed: ${res.status} ${text}`);
      }
      return res.json();
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Upload failed');
}

class ScreenCaptureModal {
  static ensureSavedModalStyles() {
    if (document.querySelector('link[href="/urldropdown.css"]')) {
      return;
    }
    if (document.querySelector('style[data-capture-modal-styles="true"]')) {
      return;
    }
    const style = document.createElement('style');
    style.type = 'text/css';
    style.dataset.captureModalStyles = 'true';
    style.textContent = `
.modal-overlay{position:fixed;inset:0;padding:24px;display:flex;align-items:center;justify-content:center;z-index:9999;opacity:0;visibility:hidden;pointer-events:none;transition:opacity 160ms ease,visibility 0s linear 160ms;}
.modal-overlay.is-visible{opacity:1;visibility:visible;pointer-events:auto;transition-delay:0s;}
@media (prefers-reduced-motion: reduce){.modal-overlay{transition:none;}.capture-modal{animation:none;}}
.capture-modal-overlay{background:rgba(15,23,42,0.45);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);}
.capture-modal{width:min(360px,calc(100% - 32px));padding:28px 26px;border-radius:18px;background:rgba(255,255,255,0.92);border:1px solid rgba(15,23,42,0.08);box-shadow:0 30px 80px rgba(15,23,42,0.35);display:flex;flex-direction:column;gap:18px;text-align:center;}
body.dark .capture-modal{background:rgba(15,23,42,0.9);border-color:rgba(148,163,184,0.24);color:rgba(226,232,240,0.96);box-shadow:0 34px 88px rgba(2,6,20,0.82);}
.capture-modal-title{font-size:20px;font-weight:600;letter-spacing:-0.01em;color:rgba(15,23,42,0.92);}
body.dark .capture-modal-title{color:inherit;}
.capture-modal-description{font-size:14px;line-height:1.5;color:rgba(71,85,105,0.82);}
body.dark .capture-modal-description{color:rgba(203,213,225,0.88);}
.capture-modal-actions{display:flex;justify-content:center;gap:12px;}
.capture-modal-button{padding:10px 20px;border-radius:999px;border:1px solid transparent;font-size:14px;font-weight:600;cursor:pointer;transition:background 0.18s ease,color 0.18s ease,box-shadow 0.18s ease,transform 0.12s ease;}
.capture-modal-button.primary{background:linear-gradient(135deg,rgba(127,91,243,0.95),rgba(84,63,196,0.95));color:#fff;box-shadow:0 16px 36px rgba(111,76,242,0.3);}
.capture-modal-button.primary:hover{box-shadow:0 20px 42px rgba(111,76,242,0.38);transform:translateY(-1px);}
.capture-modal-button.secondary{background:rgba(148,163,184,0.18);color:rgba(15,23,42,0.78);}
.capture-modal-button.secondary:hover{background:rgba(148,163,184,0.28);box-shadow:0 12px 28px rgba(15,23,42,0.12);}
body.dark .capture-modal-button.secondary{background:rgba(148,163,184,0.2);color:rgba(226,232,240,0.92);}
.capture-modal-button:active{transform:translateY(1px);}
.capture-modal-button:focus-visible{outline:2px solid rgba(127,91,243,0.8);outline-offset:2px;}
.modal-overlay.is-visible .capture-modal{animation:captureModalPop 160ms ease-out;}
@media (max-width: 640px){.modal-overlay{padding:16px;}.capture-modal{width:calc(100% - 24px);padding:24px 20px;}.capture-modal-actions{flex-direction:column;}.capture-modal-button{width:100%;}}
@keyframes captureModalPop{from{opacity:0;transform:scale(0.97) translateY(12px);}to{opacity:1;transform:scale(1) translateY(0);}}
`;
    document.head.appendChild(style);
  }

  constructor(stream = null, opts = {}) {
    this.stream = stream;
    this.opts = opts;
    this.root = null;
    this.stage = null;
    this.overlay = null;
    this.ctx = null;
    this.statusLabel = null;
    this.btnShot = null;
    this.btnRecord = null;
    this.btnCancel = null;
    this.btnReset = null;
    this.audioToggle = null;
    this.audioCheckbox = null;
    this.rect = null;
    this.dragMode = null;
    this.dragState = null;
    this.dpr = window.devicePixelRatio || 1;
    this.stageSize = null;
    this.selectionLocked = false;
    this.busy = false;
    this.recordingState = 'idle';
    this.mediaRecorder = null;
    this.recordChunks = [];
    this.renderCanvas = null;
    this.renderCtx = null;
    this.renderStream = null;
    this.renderRaf = 0;
    this.timerRaf = 0;
    this.recordingStart = 0;
    this.pendingStopOptions = null;
    this.addedAudioTracks = [];
    this.captureVideo = null;
    this.snapshotCanvas = null;
    this.snapshotUrl = null;
    this.snapshotImg = null;
    this.overlayHidden = false;
    this.floatingControls = null;
    this.floatingStatus = null;
    this.floatingDrag = null;
    this.onFloatingPointerDown = this.startFloatingDrag.bind(this);
    this.onFloatingPointerMove = this.handleFloatingPointerMove.bind(this);
    this.onFloatingPointerUp = (event) => this.stopFloatingDrag(event);
    this.onFloatingWindowResize = this.handleFloatingResize.bind(this);
    this.resolveFn = null;
    this.rejectFn = null;
    this.colorDefault = '#ddd';
    this.colorError = '#ff6666';
    this.keydownHandler = this.onKeyDown.bind(this);
    this.resizeHandler = this.fit.bind(this);
    this.beforeUnloadHandler = this.handleBeforeUnload.bind(this);
    this.navigationGuardHandler = this.handleNavigationGuard.bind(this);
    this.navWarningEl = null;
    this.navWarningTimer = 0;
  }

  async open() {
    try {
      await this.initStream();
      await this.captureSnapshot();
      this.buildDom();
      await this.waitSnapshotReady();
      this.fit();
      this.updateStatus('Drag to select the capture area. Press Esc to cancel or stop.');
      this.syncAudioToggleState();

      return new Promise((resolve, reject) => {
        this.resolveFn = resolve;
        this.rejectFn = reject;
      });
    } catch (err) {
      this.cleanup();
      throw err;
    }
  }

  async initStream() {
    if (!this.stream) {
      this.stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' },
        audio: true
      });
    }

    this.captureVideo = document.createElement('video');
    this.captureVideo.srcObject = this.stream;
    this.captureVideo.playsInline = true;
    this.captureVideo.muted = true;

    await this.waitForVideo(this.captureVideo);
    await this.captureVideo.play().catch(() => {});
  }

  waitForVideo(video) {
    return new Promise((resolve, reject) => {
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = (err) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        video.removeEventListener('loadedmetadata', onReady);
        video.removeEventListener('error', onError);
      };
      if (video.readyState >= 1) {
        resolve();
        return;
      }
      video.addEventListener('loadedmetadata', onReady, { once: true });
      video.addEventListener('error', onError, { once: true });
    });
  }

  async captureSnapshot() {
    const width = this.captureVideo.videoWidth || window.innerWidth || 1920;
    const height = this.captureVideo.videoHeight || window.innerHeight || 1080;
    this.snapshotCanvas = document.createElement('canvas');
    this.snapshotCanvas.width = width;
    this.snapshotCanvas.height = height;
    const ctx = this.snapshotCanvas.getContext('2d');
    ctx.drawImage(this.captureVideo, 0, 0, width, height);
    this.snapshotUrl = this.snapshotCanvas.toDataURL('image/png');
  }

  waitSnapshotReady() {
    if (!this.snapshotImg) return Promise.resolve();
    if (this.snapshotImg.complete) {
      return Promise.resolve();
    }
    return this.snapshotImg.decode().catch(() => {});
  }

  buildDom() {
    this.root = document.createElement('div');
    this.root.style.cssText = `
      position:fixed; inset:0; z-index:2147483647;
      background:rgba(0,0,0,.75);
      display:grid; place-items:center;
      font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
    `;

    const frame = document.createElement('div');
    frame.style.cssText = `
      width:min(92vw,1200px);
      height:min(80vh,720px);
      display:grid;
      grid-template-rows:auto 1fr auto;
      background:#111;
      border-radius:14px;
      overflow:hidden;
      box-shadow:0 20px 60px rgba(0,0,0,0.6);
    `;

    const header = document.createElement('div');
    header.style.cssText = `
      padding:14px 18px;
      display:flex;
      align-items:center;
      justify-content:space-between;
      background:#181818;
      border-bottom:1px solid rgba(255,255,255,0.05);
      color:#eee;
    `;
    const title = document.createElement('div');
    title.textContent = 'Screen Capture';
    title.style.fontWeight = '600';
    header.appendChild(title);

    const headerActions = document.createElement('div');
    headerActions.style.cssText = 'display:flex; gap:10px; align-items:center;';

    this.audioToggle = document.createElement('label');
    this.audioToggle.style.cssText = `
      display:flex; align-items:center; gap:6px;
      font-size:13px; color:#bbb; cursor:pointer;
    `;
    const audioCheckbox = document.createElement('input');
    audioCheckbox.type = 'checkbox';
    audioCheckbox.checked = true;
    audioCheckbox.style.cursor = 'pointer';
    const audioText = document.createElement('span');
    audioText.textContent = 'Include audio when recording';
    this.audioToggle.append(audioCheckbox, audioText);
    this.audioCheckbox = audioCheckbox;

    this.btnReset = document.createElement('button');
    this.btnReset.textContent = 'Reset selection';
    this.btnReset.style.cssText = this.buttonStyle({
      background: '#222',
      color: '#ccc'
    });
    this.btnReset.addEventListener('click', () => {
      if (this.busy || this.recordingState === 'recording') return;
      this.rect = null;
      this.drawOverlay();
      this.updateButtons();
      this.updateStatus('Drag to select the capture area. Press Esc to cancel or stop.');
    });

    headerActions.append(this.btnReset, this.audioToggle);
    header.append(headerActions);

    this.stage = document.createElement('div');
    this.stage.style.cssText = `
      position:relative;
      background:#000;
      overflow:hidden;
      display:grid;
      place-items:center;
    `;

    this.snapshotImg = new Image();
    this.snapshotImg.src = this.snapshotUrl;
    this.snapshotImg.style.cssText = `
      max-width:100%;
      max-height:100%;
      display:block;
      background:#000;
      user-select:none;
    `;

    this.overlay = document.createElement('canvas');
    this.overlay.style.cssText = 'position:absolute; inset:0; cursor:crosshair; touch-action:none;';
    this.ctx = this.overlay.getContext('2d');

    this.stage.append(this.snapshotImg, this.overlay);

    const toolbar = document.createElement('div');
    toolbar.style.cssText = `
      padding:14px 18px;
      display:flex;
      align-items:center;
      justify-content:space-between;
      background:#181818;
      border-top:1px solid rgba(255,255,255,0.05);
      color:#ddd;
      font-size:14px;
    `;

    this.statusLabel = document.createElement('div');
    this.statusLabel.textContent = '';
    this.statusLabel.style.cssText = 'flex:1; min-height:20px; color:currentColor;';

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex; gap:10px; align-items:center;';

    this.btnShot = document.createElement('button');
    this.btnShot.textContent = 'Capture screenshot';
    this.btnShot.style.cssText = this.buttonStyle({ primary: true });
    this.btnShot.addEventListener('click', () => this.handleScreenshot());

    this.btnRecord = document.createElement('button');
    this.btnRecord.textContent = 'Start recording';
    this.btnRecord.style.cssText = this.buttonStyle();
    this.btnRecord.addEventListener('click', () => this.handleRecordButton());

    this.btnCancel = document.createElement('button');
    this.btnCancel.textContent = 'Cancel';
    this.btnCancel.style.cssText = this.buttonStyle({
      background: '#1a1a1a',
      color: '#ccc'
    });
    this.btnCancel.addEventListener('click', () => this.handleCancel());

    buttons.append(this.btnShot, this.btnRecord, this.btnCancel);

    toolbar.append(this.statusLabel, buttons);

    frame.append(header, this.stage, toolbar);
    this.root.append(frame);
    document.body.append(this.root);

    this.overlay.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.overlay.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.overlay.addEventListener('pointerup', () => this.onPointerUp());
    this.overlay.addEventListener('pointerleave', () => this.onPointerUp());
    this.overlay.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('resize', this.resizeHandler);
    window.addEventListener('keydown', this.keydownHandler);
  }

  buttonStyle({ primary = false, background, color } = {}) {
    const baseBg = primary ? '#3a82ff' : (background || '#252525');
    const baseColor = primary ? '#fff' : (color || '#eee');
    return `
      padding:10px 18px;
      border-radius:10px;
      border:1px solid rgba(255,255,255,0.08);
      background:${baseBg};
      color:${baseColor};
      cursor:pointer;
      font-size:14px;
      font-weight:${primary ? '600' : '500'};
    `;
  }

  fit() {
    if (!this.stage || !this.overlay) return;
    const rect = this.stage.getBoundingClientRect();
    const prev = this.stageSize;
    this.stageSize = { width: rect.width, height: rect.height };

    this.overlay.style.width = rect.width + 'px';
    this.overlay.style.height = rect.height + 'px';
    this.overlay.width = Math.round(rect.width * this.dpr);
    this.overlay.height = Math.round(rect.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    if (prev && this.rect) {
      const scaleX = rect.width / prev.width;
      const scaleY = rect.height / prev.height;
      this.rect = this.clampRect({
        x: this.rect.x * scaleX,
        y: this.rect.y * scaleY,
        w: this.rect.w * scaleX,
        h: this.rect.h * scaleY
      });
    }

    this.drawOverlay();
    this.updateButtons();
  }

  syncAudioToggleState() {
    if (!this.audioCheckbox) return;
    const hasAudioTracks = !!(this.stream && this.stream.getAudioTracks && this.stream.getAudioTracks().length);
    if (!hasAudioTracks) {
      this.audioCheckbox.checked = false;
      this.audioCheckbox.disabled = true;
      if (this.audioToggle) {
        this.audioToggle.style.opacity = '0.6';
        this.audioToggle.title = 'Audio capture is unavailable for this share';
      }
    } else {
      this.audioCheckbox.disabled = false;
      if (this.audioToggle) {
        this.audioToggle.style.opacity = '';
        this.audioToggle.title = '';
      }
    }
  }

  clampRect(rect) {
    if (!rect) return rect;
    const bounds = this.getVideoBounds();
    if (!bounds) return rect;

    const minSize = CAPTURE_MIN_SIZE;
    let { x, y, w, h } = rect;
    if (w < 0) { x += w; w *= -1; }
    if (h < 0) { y += h; h *= -1; }

    const maxX = bounds.x + bounds.width;
    const maxY = bounds.y + bounds.height;

    x = Math.max(bounds.x, Math.min(x, maxX));
    y = Math.max(bounds.y, Math.min(y, maxY));

    const maxW = maxX - x;
    const maxH = maxY - y;

    w = Math.max(Math.min(w, maxW), 1);
    h = Math.max(Math.min(h, maxH), 1);

    if (w < minSize) w = Math.min(minSize, maxW);
    if (h < minSize) h = Math.min(minSize, maxH);

    return { x, y, w, h };
  }

  getVideoBounds() {
    if (!this.snapshotImg) return null;
    const imgRect = this.snapshotImg.getBoundingClientRect();
    const stageRect = this.stage.getBoundingClientRect();
    return {
      x: imgRect.left - stageRect.left,
      y: imgRect.top - stageRect.top,
      width: imgRect.width,
      height: imgRect.height
    };
  }

  drawOverlay() {
    if (!this.ctx) return;
    const w = this.overlay.width / this.dpr;
    const h = this.overlay.height / this.dpr;
    this.ctx.clearRect(0, 0, w, h);

    this.ctx.fillStyle = 'rgba(0,0,0,0.45)';
    this.ctx.fillRect(0, 0, w, h);

    if (this.rect) {
      const { x, y, w: rw, h: rh } = this.rect;
      this.ctx.save();
      this.ctx.globalCompositeOperation = 'destination-out';
      this.ctx.fillRect(x, y, rw, rh);
      this.ctx.restore();

      this.ctx.save();
      this.ctx.strokeStyle = '#4cc3ff';
      this.ctx.lineWidth = 2;
      this.ctx.setLineDash([8, 6]);
      this.ctx.strokeRect(x + 1, y + 1, rw - 2, rh - 2);
      this.ctx.restore();

      this.drawHandles();
    }
  }

  drawHandles() {
    if (!this.rect) return;
    const handleSize = 10;
    const half = handleSize / 2;
    const points = this.getHandlePoints();
    this.ctx.save();
    this.ctx.fillStyle = '#4cc3ff';
    points.forEach(({ x, y }) => {
      this.ctx.fillRect(x - half, y - half, handleSize, handleSize);
    });
    this.ctx.restore();
  }

  getHandlePoints() {
    if (!this.rect) return [];
    const { x, y, w, h } = this.rect;
    return [
      { x, y },
      { x: x + w / 2, y },
      { x: x + w, y },
      { x, y: y + h / 2 },
      { x: x + w, y: y + h / 2 },
      { x, y: y + h },
      { x: x + w / 2, y: y + h },
      { x: x + w, y: y + h }
    ];
  }

  pointerToStage(e) {
    const rect = this.overlay.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  onPointerDown(e) {
    if (this.busy || this.selectionLocked) return;
    const point = this.clampPointToVideo(this.pointerToStage(e));
    const hit = this.hitTest(point);

    if (hit.mode === 'move') {
      this.dragMode = 'move';
      this.dragState = {
        offsetX: point.x - this.rect.x,
        offsetY: point.y - this.rect.y
      };
    } else if (hit.mode === 'resize') {
      this.dragMode = 'resize';
      this.dragState = {
        edge: hit.edge,
        startRect: { ...this.rect }
      };
    } else {
      this.dragMode = 'create';
      this.rect = { x: point.x, y: point.y, w: 1, h: 1 };
      this.dragState = { start: point };
    }

    this.overlay.setPointerCapture(e.pointerId);
    this.drawOverlay();
    this.updateButtons();
  }

  onPointerMove(e) {
    if (this.busy || this.selectionLocked) {
      this.updateCursor(e, null);
      return;
    }
    const point = this.clampPointToVideo(this.pointerToStage(e));

    if (this.dragMode === 'create' && this.dragState) {
      const start = this.dragState.start;
      this.rect = this.clampRect({
        x: Math.min(start.x, point.x),
        y: Math.min(start.y, point.y),
        w: Math.abs(point.x - start.x),
        h: Math.abs(point.y - start.y)
      });
      this.drawOverlay();
      this.updateButtons();
      return;
    }

    if (this.dragMode === 'move' && this.dragState && this.rect) {
      const bounds = this.getVideoBounds();
      if (!bounds) return;
      let nx = point.x - this.dragState.offsetX;
      let ny = point.y - this.dragState.offsetY;
      nx = Math.max(bounds.x, Math.min(nx, bounds.x + bounds.width - this.rect.w));
      ny = Math.max(bounds.y, Math.min(ny, bounds.y + bounds.height - this.rect.h));
      this.rect.x = nx;
      this.rect.y = ny;
      this.drawOverlay();
      this.updateButtons();
      return;
    }

    if (this.dragMode === 'resize' && this.dragState && this.rect) {
      const bounds = this.getVideoBounds();
      const { edge, startRect } = this.dragState;
      let { x, y, w, h } = startRect;

      if (edge.includes('left')) {
        const right = x + w;
        x = Math.min(point.x, right - CAPTURE_MIN_SIZE);
        x = Math.max(bounds.x, x);
        w = right - x;
      }
      if (edge.includes('right')) {
        const maxX = bounds.x + bounds.width;
        const newRight = Math.max(point.x, x + CAPTURE_MIN_SIZE);
        w = Math.min(newRight - x, maxX - x);
      }
      if (edge.includes('top')) {
        const bottom = y + h;
        y = Math.min(point.y, bottom - CAPTURE_MIN_SIZE);
        y = Math.max(bounds.y, y);
        h = bottom - y;
      }
      if (edge.includes('bottom')) {
        const maxY = bounds.y + bounds.height;
        const newBottom = Math.max(point.y, y + CAPTURE_MIN_SIZE);
        h = Math.min(newBottom - y, maxY - y);
      }

      this.rect = this.clampRect({ x, y, w, h });
      this.drawOverlay();
      this.updateButtons();
      return;
    }

    this.updateCursor(e, this.hitTest(point));
  }

  onPointerUp() {
    if (this.dragMode) {
      this.dragMode = null;
      this.dragState = null;
      this.drawOverlay();
      this.updateButtons();
    }
  }

  clampPointToVideo(point) {
    const bounds = this.getVideoBounds();
    if (!bounds) return point;
    return {
      x: Math.max(bounds.x, Math.min(point.x, bounds.x + bounds.width)),
      y: Math.max(bounds.y, Math.min(point.y, bounds.y + bounds.height))
    };
  }

  hitTest(point) {
    if (!this.rect) {
      return { mode: 'create' };
    }
    const { x, y, w, h } = this.rect;
    const left = x;
    const right = x + w;
    const top = y;
    const bottom = y + h;
    const margin = 10;

    const nearLeft = Math.abs(point.x - left) <= margin;
    const nearRight = Math.abs(point.x - right) <= margin;
    const nearTop = Math.abs(point.y - top) <= margin;
    const nearBottom = Math.abs(point.y - bottom) <= margin;
    const inside = point.x > left + margin && point.x < right - margin && point.y > top + margin && point.y < bottom - margin;

    if ((nearLeft && nearTop) || (nearRight && nearBottom) || (nearLeft && nearBottom) || (nearRight && nearTop)) {
      const edge = `${nearTop ? 'top' : 'bottom'}-${nearLeft ? 'left' : 'right'}`;
      return { mode: 'resize', edge };
    }

    if (nearLeft) return { mode: 'resize', edge: 'left' };
    if (nearRight) return { mode: 'resize', edge: 'right' };
    if (nearTop) return { mode: 'resize', edge: 'top' };
    if (nearBottom) return { mode: 'resize', edge: 'bottom' };

    if (inside) return { mode: 'move' };
    return { mode: 'create' };
  }

  updateCursor(e, hit) {
    if (!hit) {
      this.overlay.style.cursor = 'crosshair';
      return;
    }
    if (hit.mode === 'move') {
      this.overlay.style.cursor = 'move';
      return;
    }
    if (hit.mode === 'resize') {
      const edge = hit.edge;
      const map = {
        top: 'ns-resize',
        bottom: 'ns-resize',
        left: 'ew-resize',
        right: 'ew-resize',
        'top-left': 'nwse-resize',
        'bottom-right': 'nwse-resize',
        'top-right': 'nesw-resize',
        'bottom-left': 'nesw-resize'
      };
      this.overlay.style.cursor = map[edge] || 'crosshair';
      return;
    }
    this.overlay.style.cursor = 'crosshair';
  }

  hasValidSelection() {
    return this.rect && this.rect.w >= CAPTURE_MIN_SIZE && this.rect.h >= CAPTURE_MIN_SIZE;
  }

  updateButtons() {
    const valid = this.hasValidSelection();
    const disabled = this.busy || (this.recordingState !== 'idle' && this.recordingState !== 'stopping');
    if (this.btnShot) this.btnShot.disabled = disabled || !valid;
    if (this.btnRecord) {
      if (this.recordingState === 'recording') {
        this.btnRecord.textContent = 'Stop recording';
      } else if (this.recordingState === 'stopping') {
        this.btnRecord.textContent = 'Finishing…';
      } else {
        this.btnRecord.textContent = 'Start recording';
      }
      this.btnRecord.disabled = this.busy || (!valid && this.recordingState !== 'recording');
    }
    if (this.btnReset) this.btnReset.disabled = this.busy || this.recordingState === 'recording';
  }

  updateStatus(message, { error = false } = {}) {
    if (!this.statusLabel) return;
    this.statusLabel.textContent = message;
    this.statusLabel.style.color = error ? this.colorError : this.colorDefault;
    if (this.floatingStatus) {
      this.floatingStatus.textContent = message;
      this.floatingStatus.style.color = error ? '#ff9a9a' : '#fff';
    }
  }

  async handleScreenshot() {
    if (!this.hasValidSelection() || this.busy) return;
    const source = this.computeSourceRect();
    if (!source) {
      this.updateStatus('No area selected', { error: true });
      return;
    }
    this.setBusy(true, 'Capturing screenshot…');
    try {
      await this.hideOverlayForCapture();
      const { blob, filename } = await this.captureStill(source);
      await uploadCapture(blob, filename);
      this.showCaptureSavedModal('Screenshot');
      this.resolveAndClose({ type: 'image', filename });
    } catch (err) {
      console.error('Screenshot failed', err);
      await this.showOverlayAfterCapture();
      this.setBusy(false);
      this.updateStatus('Failed to capture screenshot', { error: true });
    }
  }

  async handleRecordButton() {
    if (this.recordingState === 'recording') {
      await this.stopRecording();
      return;
    }
    if (!this.hasValidSelection() || this.busy) return;
    try {
      await this.startRecording();
    } catch (err) {
      console.error('Unable to start recording', err);
      this.updateStatus('Unable to start recording', { error: true });
      this.resetRecordingState();
    }
  }

  async startRecording() {
    const source = this.computeSourceRect();
    if (!source) throw new Error('No selection');

    await this.hideOverlayForCapture({ showControls: true });
    this.selectionLocked = true;
    this.recordingState = 'recording';
    this.setBusy(false, 'Recording… Stay on this page while capturing.');
    this.updateButtons();
    window.addEventListener('beforeunload', this.beforeUnloadHandler);
    document.addEventListener('click', this.navigationGuardHandler, true);

    const { sx, sy, sw, sh } = source;
    this.renderCanvas = document.createElement('canvas');
    this.renderCanvas.width = sw;
    this.renderCanvas.height = sh;
    this.renderCtx = this.renderCanvas.getContext('2d');
    this.renderCtx.imageSmoothingQuality = 'high';

    const fps = 30;
    const drawFrame = () => {
      this.renderCtx.drawImage(this.captureVideo, sx, sy, sw, sh, 0, 0, sw, sh);
      this.renderRaf = requestAnimationFrame(drawFrame);
    };

    drawFrame();

    this.renderStream = this.renderCanvas.captureStream(fps);
    const includeAudio = !!(this.audioCheckbox && this.audioCheckbox.checked);
    this.addedAudioTracks = [];
    if (includeAudio) {
      const audioTracks = this.stream.getAudioTracks();
      audioTracks.forEach(track => {
        const clone = track.clone();
        this.addedAudioTracks.push(clone);
        this.renderStream.addTrack(clone);
      });
    }

    const mime = this.selectMimeType([
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ]);
    this.recordChunks = [];
    this.mediaRecorder = new MediaRecorder(this.renderStream, mime ? { mimeType: mime } : undefined);

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size) this.recordChunks.push(e.data);
    };

    this.mediaRecorder.onerror = (e) => {
      console.error('MediaRecorder error', e);
      this.updateStatus('Recording error', { error: true });
      this.stopRecording({ discard: true });
    };

    this.mediaRecorder.onstop = async () => {
      cancelAnimationFrame(this.renderRaf);
      this.renderRaf = 0;
      if (this.renderStream) {
        this.renderStream.getTracks().forEach(t => t.stop());
      }
      const { discard } = this.pendingStopOptions || {};
      this.pendingStopOptions = null;
      const blob = new Blob(this.recordChunks, { type: mime || 'video/webm' });
      if (discard) {
        await this.showOverlayAfterCapture();
        this.resetRecordingState();
        return;
      }
      try {
        this.setBusy(true, 'Saving recording…');
        const filename = `${Date.now()}.webm`;
        await uploadCapture(blob, filename);
        this.showCaptureSavedModal('Recording');
        this.resolveAndClose({ type: 'video', filename });
      } catch (err) {
        console.error('Failed to save recording', err);
        await this.showOverlayAfterCapture();
        this.setBusy(false);
        this.updateStatus('Failed to save recording', { error: true });
        this.resetRecordingState();
      }
    };

    this.mediaRecorder.start();
    this.recordingStart = performance.now();
    this.updateStatus('Recording… Stay on this page while capturing. Press Stop or Esc to finish.');
    this.updateButtons();
    this.tickTimer();
  }

  tickTimer() {
    if (this.recordingState !== 'recording') {
      cancelAnimationFrame(this.timerRaf);
      this.timerRaf = 0;
      return;
    }
    const elapsed = performance.now() - this.recordingStart;
    const message = `Recording… ${this.formatDuration(elapsed)}`;
    if (this.statusLabel) {
      this.statusLabel.textContent = message;
      this.statusLabel.style.color = this.colorDefault;
    }
    if (this.floatingStatus) {
      this.floatingStatus.textContent = message;
      this.floatingStatus.style.color = '#fff';
    }
    this.timerRaf = requestAnimationFrame(() => this.tickTimer());
  }

  async stopRecording(options = {}) {
    if (this.mediaRecorder && (this.recordingState === 'recording' || this.recordingState === 'stopping')) {
      this.pendingStopOptions = options;
      if (this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
      }
      this.recordingState = 'stopping';
      cancelAnimationFrame(this.timerRaf);
      this.timerRaf = 0;
      this.updateStatus('Finishing recording…');
      this.updateButtons();
    }
  }

  resetRecordingState() {
    this.recordingState = 'idle';
    this.selectionLocked = false;
    this.mediaRecorder = null;
    this.renderCanvas = null;
    this.renderCtx = null;
    this.renderStream = null;
    this.recordChunks = [];
    this.addedAudioTracks = [];
    window.removeEventListener('beforeunload', this.beforeUnloadHandler);
    document.removeEventListener('click', this.navigationGuardHandler, true);
    this.updateStatus('Drag to select the capture area. Press Esc to cancel or stop.');
    this.updateButtons();
  }

  selectMimeType(candidates) {
    if (!window.MediaRecorder) return null;
    return candidates.find(type => MediaRecorder.isTypeSupported(type)) || null;
  }

  computeSourceRect() {
    if (!this.hasValidSelection()) return null;
    const bounds = this.getVideoBounds();
    if (!bounds) return null;
    const { x, y, w, h } = this.rect;

    const rx = x - bounds.x;
    const ry = y - bounds.y;
    const rw = Math.min(w, bounds.width - rx);
    const rh = Math.min(h, bounds.height - ry);

    const videoWidth = this.captureVideo ? this.captureVideo.videoWidth : this.snapshotCanvas?.width;
    const videoHeight = this.captureVideo ? this.captureVideo.videoHeight : this.snapshotCanvas?.height;
    if (!videoWidth || !videoHeight) {
      return null;
    }
    const scaleX = videoWidth / bounds.width;
    const scaleY = videoHeight / bounds.height;

    const sx = Math.max(0, Math.floor(rx * scaleX));
    const sy = Math.max(0, Math.floor(ry * scaleY));
    const sw = Math.max(1, Math.floor(rw * scaleX));
    const sh = Math.max(1, Math.floor(rh * scaleY));

    return { sx, sy, sw, sh };
  }

  async captureStill(source) {
    const region = source || this.computeSourceRect();
    if (!region) throw new Error('No selection');
    const { sx, sy, sw, sh } = region;

    await new Promise((resolve) => requestAnimationFrame(resolve));

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.captureVideo, sx, sy, sw, sh, 0, 0, sw, sh);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))), 'image/png');
    });

    return { blob, filename: `${Date.now()}.png` };
  }

  setBusy(state, message) {
    this.busy = state;
    this.updateButtons();
    if (message) {
      this.updateStatus(message);
    }
  }

  async hideOverlayForCapture({ showControls = false } = {}) {
    if (!this.root || this.overlayHidden) return;
    this.overlayHidden = true;
    this.root.style.opacity = '0';
    this.root.style.pointerEvents = 'none';
    if (showControls) {
      this.ensureFloatingControls();
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (this.root) {
      this.root.style.display = 'none';
    }
  }

  async showOverlayAfterCapture() {
    if (!this.root) return;
    this.overlayHidden = false;
    this.root.style.display = '';
    this.root.style.opacity = '';
    this.root.style.pointerEvents = '';
    this.removeFloatingControls();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    this.fit();
  }

  ensureFloatingControls() {
    if (this.floatingControls) return;
    const controls = document.createElement('div');
    controls.style.cssText = `
      position:fixed; top:16px; right:16px; z-index:2147483647;
      display:flex; align-items:center; gap:12px;
      background:rgba(0,0,0,0.82);
      color:#fff; padding:10px 14px; border-radius:12px;
      box-shadow:0 8px 24px rgba(0,0,0,0.35);
      font-size:14px; font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
      pointer-events:auto; cursor:grab; touch-action:none;
    `;

    const status = document.createElement('div');
    status.textContent = 'Recording…';

    const stopBtn = document.createElement('button');
    stopBtn.textContent = 'Stop recording';
    stopBtn.style.cssText = `
      padding:8px 14px; border-radius:999px; border:none;
      background:#ff4d4f; color:#fff; cursor:pointer; font-weight:600;
    `;
    stopBtn.addEventListener('click', () => {
      if (stopBtn.disabled) return;
      stopBtn.disabled = true;
      stopBtn.textContent = 'Stopping…';
      this.stopRecording();
    });

    controls.append(status, stopBtn);
    document.body.appendChild(controls);
    const rect = controls.getBoundingClientRect();
    const initial = this.clampFloatingPosition(rect);
    controls.style.left = `${initial.left}px`;
    controls.style.top = `${initial.top}px`;
    controls.style.right = 'auto';
    controls.style.bottom = 'auto';
    this.floatingControls = controls;
    this.floatingStatus = status;

    controls.addEventListener('pointerdown', this.onFloatingPointerDown);
    window.addEventListener('resize', this.onFloatingWindowResize, { passive: true });
  }

  removeFloatingControls() {
    this.stopFloatingDrag();
    if (this.floatingControls) {
      this.floatingControls.removeEventListener('pointerdown', this.onFloatingPointerDown);
    }
    window.removeEventListener('resize', this.onFloatingWindowResize);
    if (this.floatingControls && this.floatingControls.parentNode) {
      this.floatingControls.parentNode.removeChild(this.floatingControls);
    }
    this.floatingControls = null;
    this.floatingStatus = null;
  }

  clampFloatingPosition(rect) {
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    const left = Math.min(Math.max(rect.left, margin), maxLeft);
    const top = Math.min(Math.max(rect.top, margin), maxTop);
    return { left, top };
  }

  startFloatingDrag(event) {
    if (!this.floatingControls || event.button !== 0) return;
    if (event.target && event.target.closest('button')) return;
    const rect = this.floatingControls.getBoundingClientRect();
    const { left, top } = this.clampFloatingPosition(rect);
    this.floatingControls.style.left = `${left}px`;
    this.floatingControls.style.top = `${top}px`;
    this.floatingControls.style.right = 'auto';
    this.floatingControls.style.bottom = 'auto';

    this.floatingDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseLeft: left,
      baseTop: top
    };

    if (this.floatingControls.setPointerCapture) {
      try {
        this.floatingControls.setPointerCapture(event.pointerId);
      } catch (_) {
        // Ignore inability to capture pointer (e.g., already captured).
      }
    }
    this.floatingControls.style.cursor = 'grabbing';
    window.addEventListener('pointermove', this.onFloatingPointerMove);
    window.addEventListener('pointerup', this.onFloatingPointerUp);
    window.addEventListener('pointercancel', this.onFloatingPointerUp);
  }

  handleFloatingPointerMove(event) {
    if (!this.floatingDrag || event.pointerId !== this.floatingDrag.pointerId || !this.floatingControls) return;
    const dx = event.clientX - this.floatingDrag.startX;
    const dy = event.clientY - this.floatingDrag.startY;
    const proposed = {
      left: this.floatingDrag.baseLeft + dx,
      top: this.floatingDrag.baseTop + dy,
      width: this.floatingControls.offsetWidth,
      height: this.floatingControls.offsetHeight
    };
    const clamped = this.clampFloatingPosition(proposed);
    this.floatingControls.style.left = `${clamped.left}px`;
    this.floatingControls.style.top = `${clamped.top}px`;
  }

  stopFloatingDrag(event) {
    if (!this.floatingDrag) return;
    if (event && this.floatingDrag.pointerId !== event.pointerId) return;
    window.removeEventListener('pointermove', this.onFloatingPointerMove);
    window.removeEventListener('pointerup', this.onFloatingPointerUp);
    window.removeEventListener('pointercancel', this.onFloatingPointerUp);
    if (this.floatingControls && this.floatingControls.releasePointerCapture && this.floatingDrag.pointerId != null) {
      try {
        this.floatingControls.releasePointerCapture(this.floatingDrag.pointerId);
      } catch (_) {
        // Ignore release errors (e.g., pointer already released).
      }
    }
    if (this.floatingControls) {
      this.floatingControls.style.cursor = 'grab';
    }
    this.floatingDrag = null;
  }

  handleFloatingResize() {
    if (!this.floatingControls) return;
    const rect = this.floatingControls.getBoundingClientRect();
    const clamped = this.clampFloatingPosition(rect);
    this.floatingControls.style.left = `${clamped.left}px`;
    this.floatingControls.style.top = `${clamped.top}px`;
    this.floatingControls.style.right = 'auto';
    this.floatingControls.style.bottom = 'auto';
  }

  formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
  }

  async handleCancel() {
    if (this.recordingState === 'recording') {
      await this.stopRecording({ discard: true });
      this.updateStatus('Recording discarded');
      return;
    }
    this.rejectAndClose(new DOMException('Canceled', 'AbortError'));
  }

  handleBeforeUnload(e) {
    if (this.recordingState === 'recording') {
      const message = 'Screen recording is in progress. Stay on this page to finish saving your capture.';
      e.preventDefault();
      e.returnValue = message;
      return message;
    }
    return undefined;
  }

  handleNavigationGuard(e) {
    if (this.recordingState !== 'recording') return;
    const anchor = e.target.closest && e.target.closest('a[href]');
    if (!anchor) return;
    if (anchor.getAttribute('target') && anchor.getAttribute('target') !== '_self') {
      return;
    }
    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#')) return;
    e.preventDefault();
    e.stopPropagation();
    this.updateStatus('Finish or cancel the recording before navigating away.', { error: true });
    this.showNavigationWarning();
  }

  onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.handleCancel();
    }
  }

  resolveAndClose(payload) {
    this.cleanup();
    if (this.resolveFn) this.resolveFn(payload);
  }

  rejectAndClose(error) {
    this.cleanup();
    if (this.rejectFn) this.rejectFn(error);
  }

  cleanup() {
    cancelAnimationFrame(this.renderRaf);
    cancelAnimationFrame(this.timerRaf);
    if (this.renderStream) {
      this.renderStream.getTracks().forEach(t => t.stop());
    }
    if (this.addedAudioTracks && this.addedAudioTracks.length) {
      this.addedAudioTracks.forEach(track => track.stop());
      this.addedAudioTracks = [];
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try { this.mediaRecorder.stop(); } catch (e) { }
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }
    if (this.captureVideo) {
      try { this.captureVideo.pause(); } catch (e) {}
      this.captureVideo.srcObject = null;
      this.captureVideo.remove();
      this.captureVideo = null;
    }
    this.stream = null;
    this.snapshotCanvas = null;
    this.snapshotUrl = null;
    this.snapshotImg = null;
    window.removeEventListener('beforeunload', this.beforeUnloadHandler);
    document.removeEventListener('click', this.navigationGuardHandler, true);
    this.removeFloatingControls();
    window.removeEventListener('resize', this.resizeHandler);
    window.removeEventListener('keydown', this.keydownHandler);
    this.hideNavigationWarning(true);
    if (this.root && this.root.parentNode) {
      this.root.parentNode.removeChild(this.root);
    }
  }

  showNavigationWarning() {
    if (!this.navWarningEl) {
      const wrap = document.createElement('div');
      wrap.style.cssText = `
        position:fixed; top:16px; left:50%; transform:translateX(-50%);
        background:rgba(0,0,0,0.9); color:#fff;
        padding:12px 20px; border-radius:12px;
        box-shadow:0 10px 30px rgba(0,0,0,0.3);
        font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
        font-size:14px; z-index:2147483647;
      `;
      wrap.textContent = 'You must stay on this page while recording.';
      document.body.appendChild(wrap);
      this.navWarningEl = wrap;
    }
    if (this.navWarningTimer) {
      clearTimeout(this.navWarningTimer);
    }
    this.navWarningEl.style.opacity = '1';
    this.navWarningEl.style.transition = 'opacity 0.25s ease';
    this.navWarningTimer = setTimeout(() => {
      this.hideNavigationWarning();
    }, 3000);
  }

  hideNavigationWarning(force = false) {
    if (this.navWarningTimer) {
      clearTimeout(this.navWarningTimer);
      this.navWarningTimer = 0;
    }
    if (!this.navWarningEl) return;
    if (force) {
      this.navWarningEl.remove();
      this.navWarningEl = null;
      return;
    }
    this.navWarningEl.style.opacity = '0';
    setTimeout(() => {
      if (this.navWarningEl && this.navWarningEl.parentNode) {
        this.navWarningEl.parentNode.removeChild(this.navWarningEl);
      }
      this.navWarningEl = null;
    }, 250);
  }

  showCaptureSavedModal(kind) {
    this.constructor.ensureSavedModalStyles();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay capture-modal-overlay';

    const panel = document.createElement('div');
    panel.className = 'capture-modal';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');

    const title = document.createElement('h3');
    title.className = 'capture-modal-title';
    title.id = `capture-modal-title-${Date.now().toString(36)}`;
    title.textContent = `${kind} saved`;

    const description = document.createElement('p');
    description.className = 'capture-modal-description';
    description.id = `capture-modal-description-${Date.now().toString(36)}`;
    description.textContent = 'You can review this capture from the Screen Captures page.';

    panel.setAttribute('aria-labelledby', title.id);
    panel.setAttribute('aria-describedby', description.id);

    const actions = document.createElement('div');
    actions.className = 'capture-modal-actions';

    const viewBtn = document.createElement('a');
    viewBtn.className = 'capture-modal-button primary';
    viewBtn.href = '/screenshots';
    viewBtn.textContent = 'Open screen captures';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'capture-modal-button secondary';
    closeBtn.textContent = 'Close';

    actions.append(viewBtn, closeBtn);
    panel.append(title, description, actions);
    overlay.append(panel);
    document.body.appendChild(overlay);

    const removeModal = (() => {
      let closing = false;
      const finalize = () => {
        overlay.removeEventListener('transitionend', handleTransitionEnd);
        if (overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
      };
      const handleTransitionEnd = (event) => {
        if (event.target === overlay && event.propertyName === 'opacity') {
          finalize();
        }
      };
      return () => {
        if (closing) return;
        closing = true;
        overlay.classList.remove('is-visible');
        overlay.addEventListener('transitionend', handleTransitionEnd);
        setTimeout(finalize, 240);
        document.removeEventListener('keydown', onKeydownEscape, true);
      };
    })();

    const onKeydownEscape = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        removeModal();
      }
    };

    closeBtn.addEventListener('click', removeModal);
    viewBtn.addEventListener('click', () => {
      removeModal();
    });
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) removeModal();
    });
    document.addEventListener('keydown', onKeydownEscape, true);

    requestAnimationFrame(() => {
      overlay.classList.add('is-visible');
      requestAnimationFrame(() => {
        viewBtn.focus();
      });
    });
  }
}

async function screenshot(opts = {}) {
  const modal = new ScreenCaptureModal(null, opts);
  try {
    await modal.open();
  } catch (err) {
    if (err && err.name !== 'AbortError') {
      console.error('Capture canceled', err);
    }
  }
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
if (typeof hotkeys === 'function') {
  hotkeys("ctrl+t,cmd+t,ctrl+n,cmd+n", (e) => {
    let agent = document.body.getAttribute("data-agent")
    if (agent === "electron") {
      window.open(location.href, "_blank", "pinokio")
    } else {
      window.open(location.href, "_blank")
    }
  })
}

// Stable per-browser device identifier
(function initPinokioDeviceId() {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    const KEY = 'pinokio:device-id';
    const gen = () => `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
    const get = () => {
      try {
        let id = localStorage.getItem(KEY);
        if (typeof id !== 'string' || id.length < 8) {
          id = gen();
          localStorage.setItem(KEY, id);
        }
        return id;
      } catch (_) {
        // Fallback when localStorage is unavailable
        if (!window.__pinokioVolatileDeviceId) {
          window.__pinokioVolatileDeviceId = gen();
        }
        return window.__pinokioVolatileDeviceId;
      }
    };
    // Expose helpers
    if (!window.PinokioGetDeviceId) {
      window.PinokioGetDeviceId = get;
    }
    // Convenience alias
    window.PinokioDeviceId = get();
  } catch (_) {
    // ignore
  }
})();

(function initNotificationAudioBridge() {
  if (typeof window === 'undefined') {
    return;
  }
  const shouldDeferToTopListener = (() => {
    const isLikelyMobile = () => {
      try {
        if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') {
          if (navigator.userAgentData.mobile) {
            return true;
          }
        }
      } catch (_) {}
      try {
        const ua = (navigator.userAgent || '').toLowerCase();
        if (ua && /iphone|ipad|ipod|android|mobile/.test(ua)) {
          return true;
        }
      } catch (_) {}
      try {
        if (navigator.maxTouchPoints && navigator.maxTouchPoints > 1) {
          return true;
        }
      } catch (_) {}
      try {
        if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
          return true;
        }
      } catch (_) {}
      return false;
    };
    try {
      const topWindow = window.top;
      const isTop = topWindow === window;
      if (isTop && document.getElementById('layout-root')) {
        const topOwnsAudio = isLikelyMobile();
        try { window.__pinokioTopHandlesNotificationAudio = topOwnsAudio; } catch (_) {}
        return topOwnsAudio;
      }
      if (!isTop && topWindow) {
        if (typeof topWindow.__pinokioTopHandlesNotificationAudio === 'boolean') {
          return topWindow.__pinokioTopHandlesNotificationAudio;
        }
        if (topWindow.__pinokioTopNotifyListener) {
          return true;
        }
      }
    } catch (_) {}
    return false;
  })();
  if (shouldDeferToTopListener) {
    return;
  }
  if (window.__pinokioNotificationAudioInitialized) {
    return;
  }
  window.__pinokioNotificationAudioInitialized = true;

  const CHANNEL_ID = 'kernel.notifications';
  const pendingSounds = [];
  let isPlaying = false;
  let currentSocket = null;
  let reconnectTimeout = null;
  let activeAudio = null;
  const fatalStorageKey = 'pinokio.kernel.fatal';
  const fatalStaleMs = 15 * 60 * 1000;
  let lastFatalPayload = null;
  let fatalOverlayEl = null;
  let fatalStyleInjected = false;
  let pendingFatalRender = null;

  // Lightweight visual indicator to confirm notification receipt (mobile-friendly)
  let notifyIndicatorEl = null;
  let notifyIndicatorStyleInjected = false;
  const ensureNotifyIndicator = () => {
    if (!notifyIndicatorStyleInjected) {
      try {
        const style = document.createElement('style');
        style.textContent = `
.pinokio-notify-indicator{position:fixed;top:12px;right:12px;z-index:2147483647;display:none;align-items:center;gap:8px;padding:8px 10px;border-radius:999px;background:rgba(15,23,42,0.92);color:#fff;font:600 12px/1.2 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,0.35)}
.pinokio-notify-indicator .bell{font-size:14px}
.pinokio-notify-indicator.show{display:inline-flex;animation:pinokioNotifyPop 160ms ease-out, pinokioNotifyFade 1600ms ease-in 700ms forwards}
@keyframes pinokioNotifyPop{from{transform:translateY(-6px) scale(.98);opacity:0}to{transform:translateY(0) scale(1);opacity:1}}
@keyframes pinokioNotifyFade{to{opacity:0;transform:translateY(-4px)}}
@media (max-width: 768px){.pinokio-notify-indicator{top:10px;right:10px;padding:7px 9px;font-size:12px}}
        `;
        document.head.appendChild(style);
        notifyIndicatorStyleInjected = true;
      } catch (_) {}
    }
    if (!notifyIndicatorEl) {
      try {
        const el = document.createElement('div');
        el.className = 'pinokio-notify-indicator';
        const icon = document.createElement('span');
        icon.className = 'bell';
        icon.textContent = '🔔';
        const text = document.createElement('span');
        text.className = 'text';
        text.textContent = 'Notification received';
        el.appendChild(icon);
        el.appendChild(text);
        document.body.appendChild(el);
        notifyIndicatorEl = el;
      } catch (_) {}
    }
  };
  const flashNotifyIndicator = (payload) => {
    try {
      ensureNotifyIndicator();
      if (!notifyIndicatorEl) return;
      const text = notifyIndicatorEl.querySelector('.text');
      if (text) {
        const msg = (payload && typeof payload.message === 'string' && payload.message.trim()) ? payload.message.trim() : 'Notification received';
        // Keep it short on mobile
        text.textContent = msg.length > 80 ? (msg.slice(0, 77) + '…') : msg;
      }
      // retrigger animation
      notifyIndicatorEl.classList.remove('show');
      // force reflow
      void notifyIndicatorEl.offsetWidth;
      notifyIndicatorEl.classList.add('show');
      // Auto-hide handled by CSS animation; keep element for reuse
      window.setTimeout(() => {
        if (notifyIndicatorEl) notifyIndicatorEl.classList.remove('show');
      }, 2600);
    } catch (_) {}
  };

  const runWhenDomReady = (fn) => {
    if (typeof fn !== 'function') {
      return;
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => fn(), { once: true });
    } else {
      fn();
    }
  };

  const ensureFatalOverlay = () => {
    if (!fatalStyleInjected) {
      try {
        const style = document.createElement('style');
        style.textContent = `
.pinokio-fatal-overlay{position:fixed;inset:0;background:rgba(15,23,42,0.94);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:24px;z-index:2147483646;opacity:0;pointer-events:none;transition:opacity .25s ease}
.pinokio-fatal-overlay.show{opacity:1;pointer-events:auto}
.pinokio-fatal-panel{max-width:960px;width:100%;background:#0f172a;color:#f8fafc;border-radius:18px;box-shadow:0 40px 120px rgba(0,0,0,.55);padding:24px;display:flex;flex-direction:column;gap:16px;border:1px solid rgba(148,163,184,.35);font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif}
.pinokio-fatal-header{display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px;align-items:flex-start}
.pinokio-fatal-header h2{margin:0;font-size:20px;line-height:1.3;font-weight:700}
.pinokio-fatal-header small{display:block;margin-top:4px;color:rgba(226,232,240,.85);font-size:13px}
.pinokio-fatal-message{font-size:15px;line-height:1.6;margin:0;color:#cbd5f5}
.pinokio-fatal-stack{background:#020617;color:#f1f5f9;font-family:ui-monospace,SFMono-Regular,Consolas,Menlo,monospace;font-size:13px;line-height:1.45;border-radius:12px;padding:16px;max-height:320px;overflow:auto;border:1px solid rgba(15,118,110,.4)}
.pinokio-fatal-meta{font-size:13px;color:#cbd5f5;display:flex;flex-wrap:wrap;gap:12px}
.pinokio-fatal-actions{display:flex;flex-wrap:wrap;gap:10px}
.pinokio-fatal-actions button{border:none;border-radius:999px;padding:10px 18px;font-weight:600;font-size:14px;cursor:pointer;transition:opacity .2s ease}
.pinokio-fatal-actions button.primary{background:#f97316;color:#0f172a}
.pinokio-fatal-actions button.secondary{background:rgba(148,163,184,.2);color:#e2e8f0}
.pinokio-fatal-actions button:hover{opacity:.9}
.pinokio-fatal-close{background:none;border:none;color:#e2e8f0;font-size:24px;line-height:1;cursor:pointer;padding:2px 6px;border-radius:8px}
.pinokio-fatal-close:hover{background:rgba(148,163,184,.15)}
@media (max-width:720px){.pinokio-fatal-panel{padding:18px}.pinokio-fatal-stack{max-height:220px;font-size:12px}}
        `;
        document.head.appendChild(style);
        fatalStyleInjected = true;
      } catch (err) {
        console.warn('Failed to inject fatal overlay styles:', err);
      }
    }
    if (!fatalOverlayEl) {
      try {
        const wrapper = document.createElement('div');
        wrapper.className = 'pinokio-fatal-overlay';
        wrapper.setAttribute('role', 'alertdialog');
        wrapper.setAttribute('aria-live', 'assertive');
        wrapper.innerHTML = `
  <div class="pinokio-fatal-panel">
    <div class="pinokio-fatal-header">
      <div>
        <h2>Pinokio crashed</h2>
        <small data-field="subtitle"></small>
      </div>
      <button class="pinokio-fatal-close" type="button" aria-label="Dismiss crash message" data-action="fatal-dismiss">×</button>
    </div>
    <p class="pinokio-fatal-message" data-field="message"></p>
    <pre class="pinokio-fatal-stack" data-field="stack"></pre>
    <div class="pinokio-fatal-meta">
      <span data-field="timestamp"></span>
      <span data-field="logPath"></span>
    </div>
    <div class="pinokio-fatal-actions">
      <button type="button" class="secondary" data-action="fatal-copy">Copy stack</button>
      <button type="button" class="secondary" data-action="fatal-dismiss">Dismiss</button>
      <button type="button" class="primary" data-action="fatal-reload">Reload</button>
    </div>
  </div>`;
        document.body.appendChild(wrapper);
        wrapper.addEventListener('click', (event) => {
          const action = (event.target && event.target.getAttribute) ? event.target.getAttribute('data-action') : null;
          if (!action) {
            return;
          }
          if (action === 'fatal-copy') {
            copyFatalDetails();
          } else if (action === 'fatal-dismiss') {
            dismissFatalNotice();
          } else if (action === 'fatal-reload') {
            dismissFatalNotice();
            try {
              window.location.reload();
            } catch (_) {}
          }
        });
        fatalOverlayEl = wrapper;
      } catch (err) {
        console.error('Failed to create fatal overlay:', err);
      }
    }
  };

  const updateFatalOverlayContent = (payload) => {
    if (!fatalOverlayEl || !payload) {
      return;
    }
    try {
      const messageNode = fatalOverlayEl.querySelector('[data-field="message"]');
      if (messageNode) {
        messageNode.textContent = payload.message || 'An unrecoverable error occurred.';
      }
      const stackNode = fatalOverlayEl.querySelector('[data-field="stack"]');
      if (stackNode) {
        stackNode.textContent = payload.stack || 'No stack trace available';
      }
      const subtitleNode = fatalOverlayEl.querySelector('[data-field="subtitle"]');
      if (subtitleNode) {
        const origin = payload.origin ? payload.origin : 'fatal error';
        const parts = [];
        if (payload.version && typeof payload.version === 'object') {
          const pinokiod = payload.version.pinokiod ? `pinokiod ${payload.version.pinokiod}` : null;
          const pinokio = payload.version.pinokio ? `pinokio ${payload.version.pinokio}` : null;
          if (pinokiod || pinokio) {
            parts.push([pinokiod, pinokio].filter(Boolean).join(' • '));
          }
        }
        parts.push(origin);
        subtitleNode.textContent = parts.join(' • ');
      }
      const stampNode = fatalOverlayEl.querySelector('[data-field="timestamp"]');
      if (stampNode) {
        const ts = payload.timestamp ? new Date(payload.timestamp) : new Date();
        stampNode.textContent = `Recorded: ${ts.toLocaleString()}`;
      }
      const logNode = fatalOverlayEl.querySelector('[data-field="logPath"]');
      if (logNode) {
        logNode.textContent = payload.logPath ? `Details saved to ${payload.logPath}` : '';
      }
    } catch (err) {
      console.error('Failed to populate fatal overlay:', err);
    }
  };

  const showFatalOverlay = (payload) => {
    lastFatalPayload = payload;
    const render = (data) => {
      ensureFatalOverlay();
      if (!fatalOverlayEl) {
        return;
      }
      const content = data || payload;
      updateFatalOverlayContent(content);
      fatalOverlayEl.classList.add('show');
    };
    if (document.readyState === 'loading' || !document.body) {
      pendingFatalRender = payload;
      runWhenDomReady(() => {
        if (pendingFatalRender) {
          const queued = pendingFatalRender;
          pendingFatalRender = null;
          render(queued);
        }
      });
    } else {
      render();
    }
  };

  const hideFatalOverlay = () => {
    if (fatalOverlayEl) {
      fatalOverlayEl.classList.remove('show');
    }
  };

  const dismissFatalNotice = () => {
    hideFatalOverlay();
    try {
      if (storageEnabled) {
        localStorage.removeItem(fatalStorageKey);
      }
    } catch (_) {}
  };

  const copyFatalDetails = () => {
    if (!lastFatalPayload) {
      return;
    }
    const lines = [];
    lines.push(lastFatalPayload.title || 'Pinokio crashed');
    lines.push(`When: ${new Date(lastFatalPayload.timestamp || Date.now()).toLocaleString()}`);
    if (lastFatalPayload.origin) {
      lines.push(`Origin: ${lastFatalPayload.origin}`);
    }
    if (lastFatalPayload.logPath) {
      lines.push(`Saved at: ${lastFatalPayload.logPath}`);
    }
    lines.push('');
    lines.push(lastFatalPayload.message || '');
    lines.push('');
    lines.push(lastFatalPayload.stack || '');
    const text = lines.join('\n');
    const fallbackCopy = () => {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch (err) {
        console.warn('Failed to copy crash log:', err);
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(fallbackCopy);
    } else {
      fallbackCopy();
    }
  };

  const sanitizeFatalPayload = (payload) => {
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    const safeTimestamp = typeof payload.timestamp === 'number' ? payload.timestamp : Date.now();
    const sanitized = {
      id: typeof payload.id === 'string' ? payload.id : `fatal-${safeTimestamp}`,
      type: 'kernel.fatal',
      title: typeof payload.title === 'string' ? payload.title : 'Pinokio crashed',
      message: typeof payload.message === 'string' ? payload.message : 'Pinokio encountered a fatal error.',
      stack: typeof payload.stack === 'string' ? payload.stack : '',
      origin: typeof payload.origin === 'string' ? payload.origin : null,
      timestamp: safeTimestamp,
      version: (payload.version && typeof payload.version === 'object') ? payload.version : null,
      logPath: typeof payload.logPath === 'string' ? payload.logPath : null,
      severity: typeof payload.severity === 'string' ? payload.severity : 'fatal',
    };
    return sanitized;
  };

  const persistFatalPayload = (payload) => {
    if (!storageEnabled || !payload) {
      return;
    }
    try {
      localStorage.setItem(fatalStorageKey, JSON.stringify(payload));
    } catch (err) {
      console.warn('Failed to persist fatal payload:', err);
    }
  };

  const parseFatalValue = (value) => {
    if (!value) {
      return null;
    }
    try {
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }
      const sanitized = sanitizeFatalPayload(parsed);
      if (!sanitized) {
        return null;
      }
      if (sanitized.timestamp && (Date.now() - sanitized.timestamp) > fatalStaleMs) {
        return null;
      }
      return sanitized;
    } catch (_) {
      return null;
    }
  };

  const handleFatalPayload = (payload, options) => {
    const sanitized = sanitizeFatalPayload(payload);
    if (!sanitized) {
      return;
    }
    if (!lastFatalPayload || lastFatalPayload.id !== sanitized.id) {
      showFatalOverlay(sanitized);
    }
    if (!options || options.persist !== false) {
      persistFatalPayload(sanitized);
    }
  };

  const leaderStorageKey = 'pinokio.notification.leader';
  const leaderHeartbeatMs = 5000;
  const leaderStaleMs = 15000;
  const tabId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const storageEnabled = (() => {
    try {
      const testKey = '__pinokio_notification_test__';
      localStorage.setItem(testKey, '1');
      localStorage.removeItem(testKey);
      return true;
    } catch (_) {
      return false;
    }
  })();
  let isLeader = false;
  let heartbeatTimer = null;
  let leadershipCheckTimer = null;

  const parseLeaderValue = (value) => {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch (_) {
      return null;
    }
  };

  const writeHeartbeat = () => {
    try {
      localStorage.setItem(leaderStorageKey, JSON.stringify({ id: tabId, ts: Date.now() }));
    } catch (err) {
      console.warn('Notification leader heartbeat failed:', err);
    }
  };

  const clearHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const stopSocket = () => {
    if (currentSocket && typeof currentSocket.close === 'function') {
      try {
        currentSocket.close();
      } catch (_) {
        // ignore
      }
    }
    currentSocket = null;
  };

  const stopAudio = () => {
    pendingSounds.length = 0;
    if (activeAudio) {
      try {
        activeAudio.pause();
        activeAudio.currentTime = 0;
      } catch (_) {
        // ignore
      }
      activeAudio = null;
    }
    isPlaying = false;
  };

  const resignLeadership = () => {
    if (!isLeader) {
      return;
    }
    isLeader = false;
    clearHeartbeat();
    if (reconnectTimeout != null) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    stopSocket();
    stopAudio();
    try {
      const stored = parseLeaderValue(localStorage.getItem(leaderStorageKey));
      if (stored && stored.id === tabId) {
        localStorage.removeItem(leaderStorageKey);
      }
    } catch (_) {
      // ignore
    }
  };

  const startLeadership = () => {
    if (isLeader) {
      return;
    }
    isLeader = true;
    writeHeartbeat();
    if (!heartbeatTimer) {
      heartbeatTimer = setInterval(writeHeartbeat, leaderHeartbeatMs);
    }
    connect();
  };

  const playNextSound = () => {
    if (isPlaying) {
      return;
    }
    const next = pendingSounds.shift();
    if (!next) {
      return;
    }
    isPlaying = true;
    activeAudio = new Audio(next);
    activeAudio.preload = 'auto';
    const cleanup = () => {
      if (!activeAudio) {
        return;
      }
      activeAudio.removeEventListener('ended', handleEnded);
      activeAudio.removeEventListener('error', handleError);
      activeAudio = null;
      isPlaying = false;
      playNextSound();
    };
    const handleEnded = () => cleanup();
    const handleError = (err) => {
      console.error('Notification audio playback failed:', err);
      cleanup();
    };
    activeAudio.addEventListener('ended', handleEnded, { once: true });
    activeAudio.addEventListener('error', handleError, { once: true });
    const playPromise = activeAudio.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch((err) => {
        console.error('Notification audio play() rejected:', err);
        cleanup();
      });
    }
  };

  const isFalseyString = (value) => typeof value === 'string' && ['false', '0', 'no', 'off'].includes(value.trim().toLowerCase());

  const enqueueSound = (url) => {
    if (!url || url === false || isFalseyString(url)) {
      return;
    }
    pendingSounds.push(url);
    playNextSound();
  };

  const handlePacket = (packet) => {
    if (!packet || packet.id !== CHANNEL_ID || packet.type !== 'notification') {
      return;
    }
    const payload = packet.data || {};
    // If targeted to a specific device, ignore only when our id exists and mismatches
    try {
      const targetId = (typeof payload.device_id === 'string' && payload.device_id.trim()) ? payload.device_id.trim() : null;
      if (targetId) {
        const myId = (typeof window.PinokioGetDeviceId === 'function') ? window.PinokioGetDeviceId() : null;
        if (myId && myId !== targetId) {
          return;
        }
      }
    } catch (_) {}
    if (payload && payload.type === 'kernel.fatal') {
      handleFatalPayload(payload);
    }
    // Visual confirmation regardless of audio outcome (useful on mobile)
    flashNotifyIndicator(payload);
    if (typeof payload.sound === 'string' && payload.sound) {
      enqueueSound(payload.sound);
    }
  };

  const attemptLeadership = () => {
    if (isLeader) {
      writeHeartbeat();
      return;
    }
    let current = null;
    try {
      current = parseLeaderValue(localStorage.getItem(leaderStorageKey));
    } catch (_) {
      current = null;
    }
    const now = Date.now();
    const isStale = !current || !current.ts || (now - current.ts) > leaderStaleMs;
    if (isStale || (current && current.id === tabId)) {
      writeHeartbeat();
      const freshlyStored = parseLeaderValue(localStorage.getItem(leaderStorageKey));
      if (freshlyStored && freshlyStored.id === tabId) {
        startLeadership();
      }
    }
  };

  const scheduleReconnect = (delay) => {
    if (!isLeader) {
      return;
    }
    if (reconnectTimeout != null) {
      return;
    }
    reconnectTimeout = setTimeout(() => {
      reconnectTimeout = null;
      connect();
    }, delay);
  };

  const connect = () => {
    if (!isLeader) {
      return;
    }
    const SocketCtor = typeof window.Socket === 'function' ? window.Socket : (typeof Socket === 'function' ? Socket : null);
    if (!SocketCtor) {
      return;
    }
    if (typeof WebSocket === 'undefined') {
      return;
    }
    if (currentSocket && currentSocket.ws && currentSocket.ws.readyState === WebSocket.OPEN) {
      return;
    }
    if (currentSocket && typeof currentSocket.close === 'function') {
      try {
        currentSocket.close();
      } catch (_) {
        // ignore
      }
    }
    const socket = new SocketCtor();
    try {
      const promise = socket.run(
        {
          method: CHANNEL_ID,
          mode: 'listen',
          device_id: (typeof window.PinokioGetDeviceId === 'function') ? window.PinokioGetDeviceId() : undefined,
        },
        handlePacket
      );
      currentSocket = socket;
      promise.then(() => {
        // Attempt to reconnect after a brief delay when the socket closes normally.
        if (currentSocket === socket) {
          currentSocket = null;
          scheduleReconnect(1500);
        }
      }).catch((err) => {
        console.warn('Notification listener socket closed with error:', err);
        if (currentSocket === socket) {
          currentSocket = null;
          scheduleReconnect(2500);
        }
      });
      window.__pinokioNotificationSocket = socket;
    } catch (err) {
      console.error('Failed to establish notification listener socket:', err);
      scheduleReconnect(3000);
    }
  };

  if (!storageEnabled) {
    isLeader = true;
    const start = () => connect();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      connect();
    }
    window.addEventListener('beforeunload', () => {
      stopSocket();
      stopAudio();
    });
    return;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', connect, { once: true });
  } else {
    connect();
  }

  if (!leadershipCheckTimer) {
    leadershipCheckTimer = setInterval(attemptLeadership, leaderHeartbeatMs);
  }

  window.addEventListener('storage', (event) => {
    if (!event || typeof event.key !== 'string') {
      return;
    }
    if (event.key === leaderStorageKey) {
      const data = parseLeaderValue(event.newValue);
      if (data && data.id === tabId) {
        startLeadership();
      } else {
        resignLeadership();
      }
      return;
    }
    if (event.key === fatalStorageKey) {
      const data = parseFatalValue(event.newValue);
      if (data) {
        handleFatalPayload(data, { persist: false });
      } else {
        hideFatalOverlay();
      }
    }
  });

  window.addEventListener('beforeunload', () => {
    if (leadershipCheckTimer) {
      clearInterval(leadershipCheckTimer);
      leadershipCheckTimer = null;
    }
    resignLeadership();
  });

  // Attempt to become leader immediately on load.
  attemptLeadership();
  if (storageEnabled) {
    const storedFatal = parseFatalValue(localStorage.getItem(fatalStorageKey));
    if (storedFatal) {
      handleFatalPayload(storedFatal, { persist: false });
    }
  }
})();

// Mobile "Tap to connect" curtain to prime audio on the top-level page
(function initMobileConnectCurtain() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }
  try {
    if (window.__pinokioConnectCurtainInstalled || window.__pinokioConnectCurtainInstalling) {
      return;
    }
  } catch (_) {}
  try {
    if (window.top && window.top !== window) {
      return; // only top-level
    }
  } catch (_) {
    // cross-origin parent; just bail
    return;
  }
  if (window.__pinokioConnectCurtainInstalled) {
    return;
  }

  const isLikelyMobile = () => {
    const getUserAgent = () => {
      try { return (navigator.userAgent || '').toLowerCase(); } catch (_) { return ''; }
    };

    const ua = getUserAgent();
    const isElectron = (() => {
      try {
        if (ua && ua.includes('electron')) {
          return true;
        }
      } catch (_) {}
      try {
        if (typeof window !== 'undefined' && window.process && window.process.versions && window.process.versions.electron) {
          return true;
        }
      } catch (_) {}
      return false;
    })();

    try {
      if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') {
        if (navigator.userAgentData.mobile) {
          return !isElectron;
        }
      }
    } catch (_) {}

    if (!ua) {
      return false;
    }
    if (isElectron) {
      return false;
    }

    const uaMobile = /iphone|ipad|ipod|android|mobile/.test(ua);
    if (!uaMobile) {
      return false;
    }
    try {
      if (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) {
        return true;
      }
    } catch (_) {}
    try {
      if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
        return true;
      }
    } catch (_) {}
    return uaMobile;
  };

  const createCurtain = () => {
    const style = document.createElement('style');
    style.textContent = `
.pinokio-connect-curtain{position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483646;background:rgba(15,23,42,0.35);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center}
.pinokio-connect-msg{user-select:none;-webkit-user-select:none;color:#fff;background:rgba(15,23,42,0.85);padding:14px 18px;border-radius:12px;font:500 15px/1.35 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;box-shadow:0 16px 40px rgba(0,0,0,.38);text-align:center;max-width:200px}
.pinokio-connect-msg-title{font-weight:600;font-size:16px;margin-bottom:4px}
.pinokio-connect-msg-hint{font-size:13px;opacity:.72}
@media (max-width:768px){.pinokio-connect-msg{font-size:14px;padding:12px 16px}}
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.className = 'pinokio-connect-curtain';
    overlay.setAttribute('role', 'button');
    overlay.setAttribute('aria-label', 'Tap to connect');
    overlay.tabIndex = 0;
    const msg = document.createElement('div');
    msg.className = 'pinokio-connect-msg';
    const msgTitle = document.createElement('div');
    msgTitle.className = 'pinokio-connect-msg-title';
    msgTitle.textContent = 'Tap to connect';
    const msgHint = document.createElement('div');
    msgHint.className = 'pinokio-connect-msg-hint';
    msgHint.textContent = 'To type into the terminal, use the "Input" button.';
    msg.appendChild(msgTitle);
    msg.appendChild(msgHint);
    overlay.appendChild(msg);
    window.__pinokioConnectCurtainInstalled = true;
    return overlay;
  };

  const SOUND_PREF_STORAGE_KEY = 'pinokio:idle-sound';
  const primeAudio = async () => {
    // Determine whether the user picked a custom `/sound/...` clip.
    // Fall back to the built-in chime if no preference exists.
    const preferCustom = (() => {
      try {
        const raw = localStorage.getItem(SOUND_PREF_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const choice = typeof parsed?.choice === 'string' ? parsed.choice.trim() : '';
        if (choice && choice.startsWith('/sound/')) {
          return choice;
        }
      } catch (_) {}
      return null;
    })();

    // Grab or create an Audio element for the chosen asset and prime it.
    const asset = preferCustom || '/chime.mp3';
    let audioEl;
    if (preferCustom) {
      audioEl = window.__pinokioCustomNotificationAudio;
      if (!audioEl || audioEl.__pinokioSrc !== preferCustom) {
        audioEl = new Audio(preferCustom);
        audioEl.preload = 'auto';
        audioEl.loop = false;
        audioEl.__pinokioSrc = preferCustom;
        window.__pinokioCustomNotificationAudio = audioEl;
      }
    } else {
      audioEl = window.__pinokioChimeAudio;
      if (!audioEl) {
        audioEl = new Audio('/chime.mp3');
        audioEl.preload = 'auto';
        audioEl.loop = false;
        audioEl.__pinokioSrc = '/chime.mp3';
        window.__pinokioChimeAudio = audioEl;
      }
    }

    const wasMuted = audioEl.muted;
    audioEl.muted = true;
    audioEl.currentTime = 0;
    try {
      await audioEl.play();
    } finally {
      try { audioEl.pause(); } catch (_) {}
      audioEl.currentTime = 0;
      audioEl.muted = wasMuted;
    }
    try { window.__pinokioAudioArmed = true; } catch (_) {}
    return true;
  };

  const setup = () => {
    let forceParam = false;
    try {
      const usp = new URLSearchParams(window.location.search);
      forceParam = usp.has('connect') || usp.get('connect') === '1';
    } catch (_) {}
    if (!(forceParam || isLikelyMobile())) {
      return;
    }
    if (window.__pinokioConnectCurtainInstalled || window.__pinokioConnectCurtainInstalling) {
      return;
    }
    try { window.__pinokioConnectCurtainInstalling = true; } catch (_) {}
    const overlay = createCurtain();
    let handled = false;
    const onTap = async (e) => {
      if (handled) return;
      handled = true;
      try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
      try { await primeAudio(); } catch (_) {}
      try { overlay.remove(); } catch (_) {}
      try { window.__pinokioConnectCurtainInstalled = true; window.__pinokioConnectCurtainInstalling = false; } catch (_) {}
    };
    overlay.addEventListener('pointerdown', onTap, { once: true, capture: true });
    document.body.appendChild(overlay);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup, { once: true });
  } else {
    setup();
  }
})();
const refreshParent = (e) => {
  let dispatched = false;
  if (typeof window !== 'undefined' && typeof window.PinokioBroadcastMessage === 'function') {
    try {
      dispatched = window.PinokioBroadcastMessage(e, '*', window);
    } catch (_) {
      dispatched = false;
    }
  }
  if (dispatched) {
    return;
  }
  try {
    if (window.parent && window.parent !== window && typeof window.parent.postMessage === 'function') {
      window.parent.postMessage(e, '*');
    }
  } catch (_) {}
}

if (typeof window !== 'undefined' && !window.__pinokioNavigateListenerInstalled) {
  try {
    window.__pinokioNavigateListenerInstalled = true;
  } catch (_) {}
  window.addEventListener('message', (event) => {
    if (!event || !event.data || event.data.e !== 'pinokio:navigate') return;
    try {
      console.info('[pinokio:navigate] received', { origin: event.origin, url: event.data?.url });
    } catch (_) {}
    const rawUrl = typeof event.data.url === 'string' ? event.data.url : '';
    if (!rawUrl) {
      try {
        console.warn('[pinokio:navigate] empty url');
      } catch (_) {}
      return;
    }
    const communityFrame = document.querySelector('iframe.community-frame');
    if (communityFrame) {
      let fromCommunity = false;
      try {
        fromCommunity = event.source === communityFrame.contentWindow;
      } catch (_) {
        fromCommunity = false;
      }
      if (fromCommunity) {
        let communityTarget;
        try {
          const base = communityFrame.getAttribute('src') || window.location.origin;
          communityTarget = new URL(rawUrl, base);
        } catch (_) {
          try {
            console.warn('[pinokio:navigate] invalid url', rawUrl);
          } catch (_) {}
          return;
        }
        communityFrame.src = communityTarget.toString();
        try {
          console.info('[pinokio:navigate] navigated community', communityFrame.src);
        } catch (_) {}
        return;
      }
    }
    const frame = document.activeElement;
    if (!frame || frame.tagName !== 'IFRAME') {
      try {
        console.warn('[pinokio:navigate] no active iframe');
      } catch (_) {}
      return;
    }
    let target;
    try {
      target = new URL(rawUrl, window.location.origin);
    } catch (_) {
      try {
        console.warn('[pinokio:navigate] invalid url', rawUrl);
      } catch (_) {}
      return;
    }
    if (target.origin !== window.location.origin) {
      try {
        console.warn('[pinokio:navigate] blocked origin', target.origin);
      } catch (_) {}
      return;
    }
    frame.src = target.toString();
    try {
      console.info('[pinokio:navigate] navigated', frame.src);
    } catch (_) {}
  });
}
let tippyInstances = [];
const COMPACT_LAYOUT_QUERY = '(max-width: 768px)';
const compactLayoutMedia = window.matchMedia(COMPACT_LAYOUT_QUERY);

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
  const isCompact = compactLayoutMedia.matches;
  const isHeaderElement = instance.reference.closest('header.navheader');
  const isSidebarTab = instance.reference.closest('aside') && instance.reference.classList.contains('tab');
  
  if (isCompact) {
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
  if (typeof initUrlDropdown === 'function' && !window.PinokioUrlDropdown) {
    try {
      initUrlDropdown();
    } catch (error) {
      console.error('Failed to initialize URL dropdown', error);
    }
  }

  let urlDropdownLoader = null;
  let urlDropdownStyleLoader = null;

  const ensureUrlDropdownStyles = () => {
    if (document.querySelector('link[href="/urldropdown.css"]')) {
      return Promise.resolve();
    }
    if (!urlDropdownStyleLoader) {
      urlDropdownStyleLoader = new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/urldropdown.css';
        link.addEventListener('load', () => resolve(), { once: true });
        link.addEventListener('error', reject, { once: true });
        document.head.appendChild(link);
      }).catch((error) => {
        console.error('Failed to load URL dropdown styles', error);
      });
    }
    return urlDropdownStyleLoader || Promise.resolve();
  };

  const ensureUrlDropdown = async () => {
    if (window.PinokioUrlDropdown && typeof window.PinokioUrlDropdown.openSplitModal === 'function') {
      await ensureUrlDropdownStyles();
      return window.PinokioUrlDropdown;
    }

    if (typeof initUrlDropdown === 'function') {
      await ensureUrlDropdownStyles();
      const api = initUrlDropdown();
      if (api && typeof api.openSplitModal === 'function') {
        return api;
      }
      if (window.PinokioUrlDropdown && typeof window.PinokioUrlDropdown.openSplitModal === 'function') {
        return window.PinokioUrlDropdown;
      }
    }

    if (!urlDropdownLoader) {
      urlDropdownLoader = new Promise((resolve, reject) => {
        const existing = document.querySelector('script[src="/urldropdown.js"]');
        if (existing) {
          const waitForLoad = () => ensureUrlDropdownStyles().then(resolve);
          if (existing.dataset.pinokioLoaded === 'true') {
            waitForLoad();
          } else {
            existing.addEventListener('load', waitForLoad, { once: true });
            existing.addEventListener('error', reject, { once: true });
          }
          return;
        }

        ensureUrlDropdownStyles().finally(() => {
          const script = document.createElement('script');
          script.src = '/urldropdown.js';
          script.async = false;
          script.addEventListener('load', () => {
            script.dataset.pinokioLoaded = 'true';
            resolve();
          }, { once: true });
          script.addEventListener('error', reject, { once: true });
          document.head.appendChild(script);
        });
      }).then(() => {
        if (typeof initUrlDropdown === 'function') {
          return initUrlDropdown();
        }
        return null;
      }).catch((error) => {
        console.error('Failed to load URL dropdown script', error);
        return null;
      });
    }

    const api = await urlDropdownLoader;
    if (api && typeof api.openSplitModal === 'function') {
      return api;
    }
    if (window.PinokioUrlDropdown && typeof window.PinokioUrlDropdown.openSplitModal === 'function') {
      return window.PinokioUrlDropdown;
    }
    return null;
  };

  setTabTooltips();
  initTippy();

//  if (window !== window.top) {
//    document.body.removeAttribute("data-agent")
//  }
  
  // Listen for window resize
  window.addEventListener('resize', updateAllTooltips);
  if (typeof compactLayoutMedia.addEventListener === 'function') {
    compactLayoutMedia.addEventListener('change', updateAllTooltips);
  } else if (typeof compactLayoutMedia.addListener === 'function') {
    compactLayoutMedia.addListener(updateAllTooltips);
  }
  
  // Listen for body class changes to refresh tooltip placement
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.attributeName === 'class' && mutation.target === document.body) {
        updateAllTooltips();
      }
    });
  });
  observer.observe(document.body, { attributes: true });
  
  const createFrameHistoryController = () => {
    const sanitizeStack = (input) => {
      if (!Array.isArray(input)) {
        return []
      }
      return input.filter((value) => typeof value === 'string' && value.length > 0)
    }
    const resolveFrameKey = () => {
      try {
        if (typeof window.name === 'string' && window.name.length > 0) {
          return `name:${window.name}`
        }
      } catch (_) {}
      try {
        if (window.frameElement && window.frameElement.id) {
          return `frame:${window.frameElement.id}`
        }
      } catch (_) {}
      return 'top'
    }
    const frameKey = resolveFrameKey()
    const storageKey = `pinokio:frame-history:v1:${frameKey}`
    const MAX_ENTRIES = 64
    let storageFailed = false

    const normalizeState = (value) => {
      const past = sanitizeStack(value && value.past)
      const future = sanitizeStack(value && value.future)
      const trimmedPast = past.length > MAX_ENTRIES ? past.slice(-MAX_ENTRIES) : past
      const trimmedFuture = future.length > MAX_ENTRIES ? future.slice(-MAX_ENTRIES) : future
      return { past: trimmedPast.slice(), future: trimmedFuture.slice() }
    }
    const readState = () => {
      if (storageFailed) {
        return { past: [], future: [] }
      }
      try {
        const raw = sessionStorage.getItem(storageKey)
        if (!raw) {
          return { past: [], future: [] }
        }
        return normalizeState(JSON.parse(raw))
      } catch (_) {
        storageFailed = true
        return { past: [], future: [] }
      }
    }
    const writeState = (state) => {
      if (storageFailed) {
        return false
      }
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(normalizeState(state)))
        return true
      } catch (_) {
        storageFailed = true
        return false
      }
    }

    const ensureCurrentRecorded = () => {
      const state = readState()
      if (storageFailed) {
        return
      }
      const currentUrl = window.location.href
      const last = state.past[state.past.length - 1]
      if (last !== currentUrl) {
        state.past.push(currentUrl)
        if (state.past.length > MAX_ENTRIES) {
          state.past = state.past.slice(-MAX_ENTRIES)
        }
        state.future = []
        if (!writeState(state)) {
          return
        }
      }
    }

    try {
      ensureCurrentRecorded()
    } catch (_) {
      storageFailed = true
    }

    if (storageFailed) {
      return null
    }

    const navigateByDelta = (delta) => {
      if (!Number.isFinite(delta) || delta === 0) {
        return false
      }
      if (storageFailed) {
        return false
      }
      const state = readState()
      if (storageFailed) {
        return false
      }
      if (delta < 0) {
        const available = state.past.length - 1
        if (available <= 0) {
          return true
        }
        let steps = Math.min(-delta, available)
        while (steps > 0) {
          const current = state.past.pop()
          if (typeof current === 'string' && current.length > 0) {
            state.future.push(current)
          }
          steps -= 1
        }
        if (state.future.length > MAX_ENTRIES) {
          state.future = state.future.slice(-MAX_ENTRIES)
        }
        const target = state.past[state.past.length - 1]
        if (!target) {
          return false
        }
        if (!writeState(state)) {
          return false
        }
        try {
          window.location.replace(target)
        } catch (_) {
          window.location.href = target
        }
        return true
      }
      if (delta > 0) {
        if (state.future.length === 0) {
          return true
        }
        let steps = Math.min(delta, state.future.length)
        let target = null
        while (steps > 0) {
          target = state.future.pop() || target
          if (target) {
            state.past.push(target)
          }
          steps -= 1
        }
        if (!target) {
          return false
        }
        if (state.past.length > MAX_ENTRIES) {
          state.past = state.past.slice(-MAX_ENTRIES)
        }
        if (!writeState(state)) {
          return false
        }
        try {
          window.location.replace(target)
        } catch (_) {
          window.location.href = target
        }
        return true
      }
      return false
    }

    return {
      get enabled() {
        return !storageFailed
      },
      go: (delta) => {
        if (storageFailed) {
          return false
        }
        return navigateByDelta(delta)
      }
    }
  }

  const frameHistoryController = createFrameHistoryController()
  const bindHistoryButton = (selector, delta) => {
    const button = document.querySelector(selector)
    if (!button) {
      return
    }
    button.addEventListener("click", (event) => {
      if (frameHistoryController && frameHistoryController.enabled) {
        event.preventDefault()
        event.stopPropagation()
        frameHistoryController.go(delta)
        return
      }
      if (delta < 0) {
        history.back()
      } else if (delta > 0) {
        history.forward()
      }
    })
  }

  if (document.querySelector("#screenshot")) {
    document.querySelector("#screenshot").addEventListener("click", (e) => {
      screenshot()
    })
  }
  bindHistoryButton("#back", -1)
  bindHistoryButton("#forward", 1)
  if (document.querySelector("#refresh-page")) {
    document.querySelector("#refresh-page").addEventListener("click", (e) => {
      try {
        const headerEl = document.querySelector("header.navheader");
        const isMinimized = !!(headerEl && headerEl.classList.contains("minimized"));
        const key = `pinokio:header-restore-once:${location.pathname}`;
        sessionStorage.setItem(key, isMinimized ? "1" : "0");
      } catch (_) {}
      location.reload()
      /*
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
      */
    })
  }
  const requestLayoutSplitViaMessage = ({ direction, targetUrl }) => new Promise((resolve) => {
    if (!direction || !targetUrl) {
      resolve(false);
      return;
    }
    if (!window.parent || window.parent === window) {
      resolve(false);
      return;
    }
    const requestId = `split_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    let settled = false;
    let timer = null;

    const cleanup = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      window.removeEventListener('message', handleResponse);
      if (timer !== null) {
        clearTimeout(timer);
      }
      resolve(result);
    };

    function handleResponse(event) {
      if (!event || !event.data || event.source !== window.parent) {
        return;
      }
      if (event.data.e !== 'layout-split-response' || event.data.requestId !== requestId) {
        return;
      }
      cleanup(Boolean(event.data.ok));
    }

    window.addEventListener('message', handleResponse);
    timer = window.setTimeout(() => cleanup(false), 1500);

    try {
      window.parent.postMessage({
        e: 'layout-split-request',
        requestId,
        direction,
        targetUrl,
      }, '*');
    } catch (_) {
      cleanup(false);
    }
  });
  const handleSplitNavigation = async (anchor) => {
    const href = anchor.getAttribute('href') || '/columns';
    const originUrl = window.location.href;
    const modalTitle = href === '/rows' ? 'Split Into Rows' : 'Split Into Columns';

    const api = await ensureUrlDropdown();
    if (!api) {
      window.location.href = href;
      return;
    }

    let selectedUrl = null;
    try {
      selectedUrl = await api.openSplitModal({
        title: modalTitle,
        description: 'Choose a running process or use the current tab URL for the new pane.',
        confirmLabel: 'Split',
        includeCurrent: true
      });
    } catch (error) {
      console.error('Process picker failed', error);
      selectedUrl = null;
    }

    if (!selectedUrl) {
      return;
    }

    const direction = href === '/rows' ? 'rows' : 'columns';

    let layoutApi = null;
    try {
      layoutApi = window.parent && window.parent.PinokioLayout;
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'SecurityError') {
        console.warn('Unable to access parent layout API', error);
      }
      layoutApi = null;
    }

    const frameId = (() => {
      try {
        return window.frameElement?.dataset?.nodeId || window.name || null;
      } catch (_) {
        return window.name || null;
      }
    })();

    if (layoutApi && typeof layoutApi.split === 'function' && frameId) {
      try {
        const ok = layoutApi.split({
          frameId,
          direction,
          targetUrl: selectedUrl,
        });
        if (ok) {
          layoutApi.ensureSession?.();
          return;
        }
      } catch (error) {
        console.warn('Pinokio layout split failed, falling back to messaging.', error);
      }
    }

    const messageSplitOk = await requestLayoutSplitViaMessage({
      direction,
      targetUrl: selectedUrl,
    });
    if (messageSplitOk) {
      return;
    }

    try {
      const target = new URL(href, window.location.origin);
      target.searchParams.set('origin', originUrl);
      target.searchParams.set('target', selectedUrl);
      window.location.href = target.toString();
    } catch (error) {
      console.error('Failed to navigate with selected split URL', error);
      window.location.href = href;
    }
  };

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const anchor = event.target.closest('a[href="/columns"], a[href="/rows"]');
    if (!anchor) return;
    if (anchor.dataset.pinokioSplit === 'skip') return;

    event.preventDefault();
    event.stopPropagation();
    handleSplitNavigation(anchor).catch((error) => {
      console.error('Split navigation failed', error);
    });
  }, true);

  const closeWindowButton = document.querySelector("#close-window");
  if (closeWindowButton) {
    const isInIframe = (() => {
      try {
        return window.self !== window.top;
      } catch (_) {
        return false;
      }
    })();

    const setCloseWindowVisibility = (shouldShow) => {
      if (shouldShow) {
        closeWindowButton.classList.remove("hidden");
      } else {
        closeWindowButton.classList.add("hidden");
      }
    };

    if (!isInIframe) {
      setCloseWindowVisibility(false);
    } else {
      setCloseWindowVisibility(false);
      const parentOrigin = (() => {
        try {
          return window.parent.location.origin || "*";
        } catch (_) {
          return "*";
        }
      })();

      const onLayoutStateMessage = (event) => {
        if (!event || !event.data || typeof event.data !== "object") {
          return;
        }
        if (event.source !== window.parent) {
          return;
        }
        if (event.data.e === "layout-state") {
          setCloseWindowVisibility(Boolean(event.data.closable));
        }
      };

      window.addEventListener("message", onLayoutStateMessage);

      closeWindowButton.addEventListener("click", () => {
        window.parent.postMessage({
          e: "close"
        }, "*");
//        open_url2(location.href, "_blank")
      });

      try {
        window.parent.postMessage({
          e: "layout-state-request"
        }, parentOrigin);
      } catch (_) {
        window.parent.postMessage({
          e: "layout-state-request"
        }, "*");
      }
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

  const createLauncherState = {
    pendingDefaults: null,
    shouldCleanupQuery: false,
    loaderPromise: null,
  };

  initializeCreateLauncherIntegration();

  function initializeCreateLauncherIntegration() {
    const defaults = parseCreateLauncherDefaults();
    const createTrigger = document.getElementById('create-launcher-button');
    const askTriggers = Array.from(document.querySelectorAll('[data-ask-ai-trigger]'));
    createLauncherDebugLog('initializeCreateLauncherIntegration', {
      defaultsPresent: Boolean(defaults),
      triggerExists: Boolean(createTrigger),
      askTriggerCount: askTriggers.length
    });
    if (!createTrigger && askTriggers.length === 0 && !defaults) {
      createLauncherDebugLog('initializeCreateLauncherIntegration aborted (no trigger/defaults)');
      return;
    }
    if (defaults) {
      createLauncherState.pendingDefaults = defaults;
      createLauncherState.shouldCleanupQuery = true;
    }

    ensureCreateLauncherModule().then((api) => {
      createLauncherDebugLog('ensureCreateLauncherModule resolved', { api: Boolean(api) });
      if (!api) {
        return;
      }
      initCreateLauncherTrigger(api);
      initAskAiTrigger(api);
      warmCreateLauncherModal(api);
      openPendingCreateLauncherModal(api);
    });
  }

  function ensureCreateLauncherModule() {
    if (window.CreateLauncher) {
      createLauncherDebugLog('ensureCreateLauncherModule: window.CreateLauncher already available');
      return Promise.resolve(window.CreateLauncher);
    }
    if (createLauncherState.loaderPromise) {
      createLauncherDebugLog('ensureCreateLauncherModule: loaderPromise already pending');
      return createLauncherState.loaderPromise;
    }

    createLauncherState.loaderPromise = new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = '/create-launcher.js';
      script.async = true;
      script.onload = () => {
        createLauncherDebugLog('create-launcher.js loaded', { hasModule: Boolean(window.CreateLauncher) });
        resolve(window.CreateLauncher || null);
      };
      script.onerror = (error) => {
        console.warn('Failed to load create launcher module', error);
        createLauncherDebugLog('create-launcher.js failed to load', error);
        resolve(null);
      };
      const target = document.head || document.body || document.documentElement;
      createLauncherDebugLog('injecting create-launcher.js <script>', { target: target ? target.nodeName : 'unknown' });
      target.appendChild(script);
    });

    return createLauncherState.loaderPromise;
  }

  function warmCreateLauncherModal(api) {
    if (!api || typeof api.ensureModalReady !== 'function') {
      return;
    }
    const runWarmup = () => {
      try {
        api.ensureModalReady();
      } catch (error) {
        createLauncherDebugLog('ensureModalReady failed', error);
      }
    };
    setTimeout(runWarmup, 0);
  }

  function initCreateLauncherTrigger(api) {
    const trigger = document.getElementById('create-launcher-button');
    if (!trigger) {
      createLauncherDebugLog('initCreateLauncherTrigger: trigger not found');
      return;
    }
    if (trigger.dataset.createLauncherInit === 'true') {
      createLauncherDebugLog('initCreateLauncherTrigger: already initialized');
      return;
    }
    trigger.dataset.createLauncherInit = 'true';
    createLauncherDebugLog('initCreateLauncherTrigger: binding click handler');
    trigger.addEventListener('click', () => {
      createLauncherDebugLog('create-launcher-button clicked');
      guardCreateLauncher(api);
    });
  }

  function initAskAiTrigger(api) {
    const triggers = Array.from(document.querySelectorAll('[data-ask-ai-trigger]'));
    if (triggers.length === 0) {
      createLauncherDebugLog('initAskAiTrigger: trigger not found');
      return;
    }
    triggers.forEach((trigger) => {
      if (trigger.dataset.askAiInit === 'true') {
        return;
      }
      trigger.dataset.askAiInit = 'true';
      createLauncherDebugLog('initAskAiTrigger: binding click handler');
      trigger.addEventListener('click', () => {
        const workspace = deriveWorkspaceForAskAi(trigger);
        const defaults = {
          variant: 'ask',
        };
        if (workspace) {
          defaults.folder = workspace;
          defaults.projectName = workspace;
        }
        guardCreateLauncher(api, defaults);
      });
    });
  }

  function deriveWorkspaceForAskAi(trigger) {
    const direct = (trigger && trigger.dataset && typeof trigger.dataset.workspace === 'string')
      ? trigger.dataset.workspace.trim()
      : '';
    if (direct) {
      return direct;
    }
    const bodyWorkspace = document.body && document.body.dataset && typeof document.body.dataset.workspace === 'string'
      ? document.body.dataset.workspace.trim()
      : '';
    if (bodyWorkspace) {
      return bodyWorkspace;
    }
    const workspaceElement = document.querySelector('[data-workspace]');
    if (workspaceElement) {
      const attr = workspaceElement.getAttribute('data-workspace');
      if (attr && attr.trim()) {
        return attr.trim();
      }
    }
    const pathValue = (window.location && typeof window.location.pathname === 'string')
      ? window.location.pathname
      : '';
    if (!pathValue) {
      return '';
    }
    const patterns = [
      /\/_api\/([^/]+)/i,
      /\/api\/([^/]+)/i,
      /\/p\/([^/]+)/i,
      /\/pinokio\/fileview\/([^/]+)/i,
      /\/pinokio\/terminal\/([^/]+)/i,
      /\/pinokio\/editor\/([^/]+)/i,
    ];
    for (let i = 0; i < patterns.length; i += 1) {
      const match = patterns[i].exec(pathValue);
      if (match && match[1]) {
        return safeDecodeURIComponent(match[1]);
      }
    }
    const segments = pathValue.split('/').filter(Boolean);
    if (segments.length > 0) {
      return safeDecodeURIComponent(segments[segments.length - 1]);
    }
    return '';
  }

  function safeDecodeURIComponent(value) {
    if (typeof value !== 'string') {
      return '';
    }
    try {
      return decodeURIComponent(value);
    } catch (_) {
      return value;
    }
  }

  function openPendingCreateLauncherModal(api) {
    if (!api || !createLauncherState.pendingDefaults) {
      return;
    }
    createLauncherDebugLog('openPendingCreateLauncherModal: running with defaults');
    guardCreateLauncher(api, createLauncherState.pendingDefaults);
    createLauncherState.pendingDefaults = null;
    if (createLauncherState.shouldCleanupQuery) {
      cleanupCreateLauncherParams();
      createLauncherState.shouldCleanupQuery = false;
    }
  }


  function guardCreateLauncher(api, defaults = null) {
    if (!api || typeof api.showModal !== 'function') {
      createLauncherDebugLog('guardCreateLauncher aborted: api unavailable');
      return;
    }
    createLauncherDebugLog('guardCreateLauncher invoked', { defaults: Boolean(defaults) });
    if (defaults) {
      api.showModal(defaults);
    } else {
      api.showModal();
    }
    wait_ready(null, { showLoader: false }).then(({ ready }) => {
      createLauncherDebugLog('guardCreateLauncher wait_ready resolved', { ready });
      if (ready) {
        return;
      }
      if (api && typeof api.hideModal === 'function') {
        api.hideModal();
      }
      const callback = encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
      createLauncherDebugLog('guardCreateLauncher redirecting to /setup/dev', { callback });
      window.location.href = `/setup/dev?callback=${callback}`;
    })
  }

  function parseCreateLauncherDefaults() {
    try {
      const params = new URLSearchParams(window.location.search);
      if (!params.has('create')) {
        return null;
      }

      const defaults = {};
      const templateDefaults = {};

      const promptParam = params.get('prompt');
      if (promptParam) defaults.prompt = promptParam.trim();

      const folderParam = params.get('folder');
      if (folderParam) defaults.folder = folderParam.trim();

      const toolParam = params.get('tool');
      if (toolParam) defaults.tool = toolParam.trim();

      params.forEach((value, key) => {
        if (key.startsWith('template.') || key.startsWith('template_')) {
          const name = key.replace(/^template[._]/, '');
          if (name) {
            templateDefaults[name] = value ? value.trim() : '';
          }
        }
      });

      if (Object.keys(templateDefaults).length > 0) {
        defaults.templateValues = templateDefaults;
      }

      return defaults;
    } catch (error) {
      console.warn('Failed to parse create launcher params', error);
      return null;
    }
  }

  function cleanupCreateLauncherParams() {
    try {
      const url = new URL(window.location.href);
      Array.from(url.searchParams.keys()).forEach((key) => {
        if (
          key === 'create' ||
          key === 'prompt' ||
          key === 'folder' ||
          key === 'tool' ||
          key.startsWith('template.') ||
          key.startsWith('template_')
        ) {
          url.searchParams.delete(key);
        }
      });
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    } catch (error) {
      console.warn('Failed to clean up create launcher params', error);
    }
  }

})
