const CAPTURE_MIN_SIZE = 32;

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
      pointer-events:auto;
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
    this.floatingControls = controls;
    this.floatingStatus = status;
  }

  removeFloatingControls() {
    if (this.floatingControls && this.floatingControls.parentNode) {
      this.floatingControls.parentNode.removeChild(this.floatingControls);
    }
    this.floatingControls = null;
    this.floatingStatus = null;
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
hotkeys("ctrl+t,cmd+t,ctrl+n,cmd+n", (e) => {
  open_url2(location.href, "_blank")
//  window.open("/", "_blank", "self")
})
const refreshParent = (e) => {
//  if (window.parent === window.top) {
    window.parent.postMessage(e, "*")
//  }
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

  if (window !== window.top) {
    document.body.removeAttribute("data-agent")
  }
  
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

    const layoutApi = window.parent && window.parent.PinokioLayout;
    const frameId = window.frameElement?.dataset?.nodeId || window.name || null;

    if (layoutApi && typeof layoutApi.split === 'function' && frameId) {
      try {
        const ok = layoutApi.split({
          frameId,
          direction: href === '/rows' ? 'rows' : 'columns',
          targetUrl: selectedUrl,
        });
        if (ok) {
          layoutApi.ensureSession?.();
          return;
        }
      } catch (error) {
        console.warn('Pinokio layout split failed, falling back to navigation.', error);
      }
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
        const isCompact = compactLayoutMedia.matches;
        
        if (isCompact) {
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
        const isCompact = compactLayoutMedia.matches;
        
        if (isCompact) {
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

  let pendingCreateLauncherDefaults = null;
  let shouldCleanupCreateLauncherQuery = false;

  initCreateLauncherFlow();
  handleCreateLauncherQueryParams();

  function openPendingCreateLauncherModal() {
    if (!pendingCreateLauncherDefaults) return;
    showCreateLauncherModal(pendingCreateLauncherDefaults);
    pendingCreateLauncherDefaults = null;

    if (!shouldCleanupCreateLauncherQuery) return;
    shouldCleanupCreateLauncherQuery = false;

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
      console.warn('Failed to update history for create launcher params', error);
    }
  }

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

    // If we already captured query params that request the modal, open it now that the
    // trigger has been initialised and the modal can be constructed.
    requestAnimationFrame(openPendingCreateLauncherModal);
  }

  function ensureCreateLauncherModal() {
    if (createLauncherModalInstance) {
      return createLauncherModalInstance;
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay create-launcher-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'create-launcher-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const header = document.createElement('div');
    header.className = 'create-launcher-modal-header';

    const iconWrapper = document.createElement('div');
    iconWrapper.className = 'create-launcher-modal-icon';

    const headerIcon = document.createElement('i');
    //headerIcon.className = 'fa-solid fa-magnifying-glass';
    headerIcon.className = 'fa-solid fa-wand-magic-sparkles'
    iconWrapper.appendChild(headerIcon);

    const headingStack = document.createElement('div');
    headingStack.className = 'create-launcher-modal-headings';

    const title = document.createElement('h3');
    title.id = 'create-launcher-modal-title';
    title.textContent = 'Create';

    const description = document.createElement('p');
    description.className = 'create-launcher-modal-description';
    description.id = 'create-launcher-modal-description';
    description.textContent = 'Create a reusable and shareable launcher for any task or any app'

    modal.setAttribute('aria-labelledby', title.id);
    modal.setAttribute('aria-describedby', description.id);

    headingStack.appendChild(title);
    headingStack.appendChild(description);
    header.appendChild(iconWrapper);
    header.appendChild(headingStack);

    const promptLabel = document.createElement('label');
    promptLabel.className = 'create-launcher-modal-label';
    promptLabel.textContent = 'What do you want to do?';

    const promptTextarea = document.createElement('textarea');
    promptTextarea.className = 'create-launcher-modal-textarea';
    promptTextarea.placeholder = 'Examples: "a 1-click launcher for ComfyUI", "I want to change file format", "I want to clone a website to run locally", etc. (Leave empty to decide later)';
    promptLabel.appendChild(promptTextarea);

    const templateWrapper = document.createElement('div');
    templateWrapper.className = 'create-launcher-modal-template';
    templateWrapper.style.display = 'none';

    const templateTitle = document.createElement('div');
    templateTitle.className = 'create-launcher-modal-template-title';
    templateTitle.textContent = 'Template variables';

    const templateDescription = document.createElement('p');
    templateDescription.className = 'create-launcher-modal-template-description';
    templateDescription.textContent = 'Fill in each variable below before creating your launcher.';

    const templateFields = document.createElement('div');
    templateFields.className = 'create-launcher-modal-template-fields';

    templateWrapper.appendChild(templateTitle);
    templateWrapper.appendChild(templateDescription);
    templateWrapper.appendChild(templateFields);

    const folderLabel = document.createElement('label');
    folderLabel.className = 'create-launcher-modal-label';
    folderLabel.textContent = 'name';

    const folderInput = document.createElement('input');
    folderInput.type = 'text';
    folderInput.placeholder = 'example: my-launcher';
    folderInput.className = 'create-launcher-modal-input';
    folderLabel.appendChild(folderInput);


    const toolWrapper = document.createElement('div');
    toolWrapper.className = 'create-launcher-modal-tools';

    const toolTitle = document.createElement('div');
    toolTitle.className = 'create-launcher-modal-tools-title';
    toolTitle.textContent = 'Choose AI tool';

    const toolOptions = document.createElement('div');
    toolOptions.className = 'create-launcher-modal-tools-options';

    const tools = [
      { value: 'claude', label: 'Claude Code', iconSrc: '/asset/plugin/code/claude/claude.png', defaultChecked: true },
      { value: 'codex', label: 'OpenAI Codex', iconSrc: '/asset/plugin/code/codex/openai.webp', defaultChecked: false },
      { value: 'gemini', label: 'Google Gemini CLI', iconSrc: '/asset/plugin/code/gemini/gemini.jpeg', defaultChecked: false }
    ];

    const toolEntries = [];

    tools.forEach(({ value, label, iconSrc, defaultChecked }) => {
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
      if (iconSrc) {
        const icon = document.createElement('img');
        icon.className = 'create-launcher-modal-tool-icon';
        icon.src = iconSrc;
        icon.alt = `${label} icon`;
        icon.onerror = () => { icon.style.display='none'; }
        option.appendChild(icon);
      }
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
    advancedLink.textContent = 'Or, try advanced options';

    const bookmarkletLink = document.createElement('a');
    bookmarkletLink.className = 'create-launcher-modal-advanced secondary';
    bookmarkletLink.href = '/bookmarklet';
    bookmarkletLink.target = '_blank';
    bookmarkletLink.setAttribute("features", "browser")
    bookmarkletLink.rel = 'noopener';
    bookmarkletLink.textContent = 'Add 1-click bookmarklet';

    const linkRow = document.createElement('div');
    linkRow.className = 'create-launcher-modal-links';
    linkRow.appendChild(advancedLink);
    linkRow.appendChild(bookmarkletLink);

    modal.appendChild(header);
    modal.appendChild(promptLabel);
    modal.appendChild(templateWrapper);
    modal.appendChild(folderLabel);
    modal.appendChild(toolWrapper);
    modal.appendChild(error);
    modal.appendChild(actions);
    modal.appendChild(linkRow);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    let folderEditedByUser = false;
    let templateValues = new Map();

    function syncTemplateFields(promptText, defaults = {}) {
      const variableNames = extractTemplateVariableNames(promptText);
      const previousValues = templateValues;
      const newValues = new Map();

      variableNames.forEach((name) => {
        if (Object.prototype.hasOwnProperty.call(defaults, name) && defaults[name] !== undefined) {
          newValues.set(name, defaults[name]);
        } else if (previousValues.has(name)) {
          newValues.set(name, previousValues.get(name));
        } else {
          newValues.set(name, '');
        }
      });

      templateValues = newValues;
      templateFields.innerHTML = '';

      if (variableNames.length === 0) {
        templateWrapper.style.display = 'none';
        return;
      }

      templateWrapper.style.display = 'flex';

      variableNames.forEach((name) => {
        const field = document.createElement('label');
        field.className = 'create-launcher-modal-template-field';

        const labelText = document.createElement('span');
        labelText.className = 'create-launcher-modal-template-field-label';
        labelText.textContent = name;

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'create-launcher-modal-template-input';
        input.placeholder = `Enter ${name}`;
        input.value = templateValues.get(name) || '';
        input.dataset.templateInput = name;
        input.addEventListener('input', () => {
          templateValues.set(name, input.value);
        });

        field.appendChild(labelText);
        field.appendChild(input);
        templateFields.appendChild(field);
      });
    }

    folderInput.addEventListener('input', () => {
      folderEditedByUser = true;
    });

    promptTextarea.addEventListener('input', () => {
      syncTemplateFields(promptTextarea.value);
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

    bookmarkletLink.addEventListener('click', () => {
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
      },
      syncTemplateFields,
      getTemplateValues() {
        return new Map(templateValues);
      },
      templateFields,
      markFolderEdited() {
        folderEditedByUser = true;
      }
    };

    updateToolSelections(toolEntries);

    return createLauncherModalInstance;
  }

  async function showCreateLauncherModal(defaults = {}) {

    let response = await fetch("/bundle/dev").then((res) => {
      return res.json()
    })
    if (response.available) {
    } else {
      location.href = "/setup/dev?callback=/"
      return
    }

    const modal = ensureCreateLauncherModal();

    modal.error.textContent = '';
    modal.resetFolderTracking();
    const { prompt = '', folder = '', tool = '' } = defaults;

    modal.promptTextarea.value = prompt;
    if (folder) {
      modal.folderInput.value = folder;
      if (typeof modal.markFolderEdited === 'function') {
        modal.markFolderEdited();
      }
    } else if (prompt) {
      modal.folderInput.value = generateFolderSuggestion(prompt);
    } else {
      modal.folderInput.value = '';
    }

    const matchingToolEntry = modal.toolEntries.find((entry) => entry.input.value === tool);
    modal.toolEntries.forEach((entry, index) => {
      entry.input.checked = matchingToolEntry ? entry === matchingToolEntry : index === 0;
    });
    updateToolSelections(modal.toolEntries);

    modal.syncTemplateFields(modal.promptTextarea.value, defaults.templateValues || {});

    requestAnimationFrame(() => {
      modal.overlay.classList.add('is-visible');
      requestAnimationFrame(() => {
        modal.folderInput.select();
        modal.promptTextarea.focus();
      });
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
    createLauncherModalInstance.overlay.classList.remove('is-visible');
    if (createLauncherKeydownHandler) {
      document.removeEventListener('keydown', createLauncherKeydownHandler, true);
      createLauncherKeydownHandler = null;
    }
  }

  function submitCreateLauncherModal() {
    const modal = ensureCreateLauncherModal();
    modal.error.textContent = '';

    const folderName = modal.folderInput.value.trim();
    const rawPrompt = modal.promptTextarea.value;
    const templateValues = modal.getTemplateValues ? modal.getTemplateValues() : new Map();
    const selectedTool = modal.toolEntries.find((entry) => entry.input.checked)?.input.value || 'claude';

    if (!folderName) {
      modal.error.textContent = 'Please enter a folder name.';
      modal.folderInput.focus();
      return;
    }

    if (folderName.includes(' ')) {
      modal.error.textContent = 'Folder names cannot contain spaces.';
      modal.folderInput.focus();
      return;
    }

    let finalPrompt = rawPrompt;
    if (templateValues.size > 0) {
      const missingVariables = [];
      templateValues.forEach((value, name) => {
        if (!value || value.trim() === '') {
          missingVariables.push(name);
        }
      });

      if (missingVariables.length > 0) {
        modal.error.textContent = `Please fill in values for: ${missingVariables.join(', ')}`;
        const targetInput = modal.templateFields?.querySelector(`[data-template-input="${missingVariables[0]}"]`);
        if (targetInput) {
          targetInput.focus();
        } else {
          modal.promptTextarea.focus();
        }
        return;
      }

      finalPrompt = applyTemplateValues(rawPrompt, templateValues);
    }

    const prompt = finalPrompt.trim();

    const url = `/pro?name=${encodeURIComponent(folderName)}&message=${encodeURIComponent(prompt)}&tool=${encodeURIComponent(selectedTool)}`;
    hideCreateLauncherModal();
    window.location.href = url;
  }

  function handleCreateLauncherQueryParams() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('create')) return;

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

    pendingCreateLauncherDefaults = defaults;
    shouldCleanupCreateLauncherQuery = true;

    requestAnimationFrame(openPendingCreateLauncherModal);
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

  function extractTemplateVariableNames(template) {
    const regex = /{{\s*([a-zA-Z0-9_][a-zA-Z0-9_\-.]*)\s*}}/g;
    const names = new Set();
    if (!template) return [];
    let match;
    while ((match = regex.exec(template)) !== null) {
      names.add(match[1]);
    }
    return Array.from(names);
  }

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function applyTemplateValues(template, values) {
    if (!template) return '';
    let result = template;
    values.forEach((value, name) => {
      const pattern = new RegExp(`{{\\s*${escapeRegExp(name)}\\s*}}`, 'g');
      result = result.replace(pattern, value);
    });
    return result;
  }
})
