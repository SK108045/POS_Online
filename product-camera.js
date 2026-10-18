(() => {
  const compressImageFile = file => new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No image selected.'));
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Could not read image.'));
    reader.onload = event => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not decode image.'));
      img.onload = () => {
        resolve(scaleAndCompressCanvas(img));
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });

  function scaleAndCompressCanvas(source) {
    const MAX = 640;
    let width = source.videoWidth || source.naturalWidth || source.width || 640;
    let height = source.videoHeight || source.naturalHeight || source.height || 480;

    if (width > height && width > MAX) {
      height = Math.round(height * MAX / width);
      width = MAX;
    } else if (height >= width && height > MAX) {
      width = Math.round(width * MAX / height);
      height = MAX;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(source, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.82);
  }

  const previewHtml = src => `<img src="${src}" alt="Product" style="width:100%;height:100%;object-fit:contain;padding:4px;box-sizing:border-box;">`;

  function openLiveCameraModal(onPhotoCaptured) {
    document.getElementById('liveCameraModalOverlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'liveCameraModalOverlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 2000002;
      background: rgba(0, 0, 0, 0.78); backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      padding: 16px; box-sizing: border-box; font-family: inherit;
    `;

    overlay.innerHTML = `
      <div style="
        background: #18181b; color: #f4f4f5; width: 100%; max-width: 480px;
        border-radius: 16px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.6);
        border: 1px solid #27272a; display: flex; flex-direction: column;
      ">
        <div style="
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 18px; border-bottom: 1px solid #27272a; background: #09090b;
        ">
          <div style="display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 15px;">
            <span>📷</span> <span>Product Camera Viewfinder</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button type="button" id="liveCamFlipBtn" style="
              background: #27272a; color: #e4e4e7; border: 1px solid #3f3f46;
              border-radius: 8px; padding: 5px 10px; font-size: 12px; font-weight: 600;
              cursor: pointer; display: flex; align-items: center; gap: 4px;
            " title="Switch between back and front camera">🔄 Flip</button>
            <button type="button" id="liveCamCloseBtn" style="
              background: none; border: none; color: #a1a1aa; font-size: 24px;
              cursor: pointer; line-height: 1; padding: 0 4px;
            ">&times;</button>
          </div>
        </div>

        <div style="padding: 16px; display: flex; flex-direction: column; align-items: center;">
          <div id="liveCamViewport" style="
            position: relative; width: 100%; aspect-ratio: 4 / 3; background: #000;
            border-radius: 12px; overflow: hidden; display: flex; align-items: center; justify-content: center;
          ">
            <video id="liveCamVideo" autoplay playsinline muted style="
              width: 100%; height: 100%; object-fit: cover;
            "></video>
            <div style="
              position: absolute; inset: 16px; border: 2px dashed rgba(255,255,255,0.35);
              border-radius: 8px; pointer-events: none;
            "></div>
            <div id="liveCamStatus" style="
              position: absolute; inset: 0; display: none; flex-direction: column;
              align-items: center; justify-content: center; padding: 20px;
              text-align: center; background: #09090b; color: #f4f4f5; gap: 12px;
            ">
              <span style="font-size: 36px;">⚠️</span>
              <span id="liveCamStatusText" style="font-size: 13px; line-height: 1.5;">Starting camera…</span>
              <button type="button" id="liveCamFallbackPickBtn" style="
                background: #2563eb; color: #fff; border: none; border-radius: 8px;
                padding: 8px 16px; font-size: 13px; font-weight: 600; cursor: pointer;
              ">📁 Upload photo from files</button>
            </div>
          </div>

          <div style="
            display: flex; align-items: center; justify-content: center; gap: 14px;
            margin-top: 18px; width: 100%; flex-wrap: wrap;
          ">
            <input type="file" id="liveCamHiddenFile" accept="image/*" style="display: none;">
            <button type="button" id="liveCamSnapBtn" style="
              background: #2563eb; color: #ffffff; border: none; border-radius: 30px;
              padding: 12px 28px; font-size: 15px; font-weight: 700; cursor: pointer;
              display: inline-flex; align-items: center; gap: 8px;
              box-shadow: 0 4px 14px rgba(37, 99, 235, 0.45); transition: transform 0.1s;
            ">
              <span style="font-size: 18px;">📸</span> Snap Photo
            </button>
            <button type="button" id="liveCamUploadBtn" style="
              background: #27272a; color: #d4d4d8; border: 1px solid #3f3f46;
              border-radius: 30px; padding: 10px 18px; font-size: 13px; font-weight: 600; cursor: pointer;
            ">
              📁 Choose File
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const video = overlay.querySelector('#liveCamVideo');
    const statusBox = overlay.querySelector('#liveCamStatus');
    const statusText = overlay.querySelector('#liveCamStatusText');
    const snapBtn = overlay.querySelector('#liveCamSnapBtn');
    const flipBtn = overlay.querySelector('#liveCamFlipBtn');
    const closeBtn = overlay.querySelector('#liveCamCloseBtn');
    const uploadBtn = overlay.querySelector('#liveCamUploadBtn');
    const fallbackPickBtn = overlay.querySelector('#liveCamFallbackPickBtn');
    const hiddenFileInput = overlay.querySelector('#liveCamHiddenFile');

    let currentFacingMode = 'environment';
    let currentStream = null;

    function stopStream() {
      if (currentStream) {
        currentStream.getTracks().forEach(track => {
          try { track.stop(); } catch (_) {}
        });
        currentStream = null;
      }
      if (video) video.srcObject = null;
    }

    function closeModal() {
      stopStream();
      overlay.remove();
    }

    closeBtn.onclick = closeModal;
    overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };

    async function startCamera(facing = 'environment') {
      stopStream();
      statusBox.style.display = 'none';
      snapBtn.disabled = true;

      if (!navigator?.mediaDevices?.getUserMedia) {
        showError('Camera API is not supported in this browser environment. You can select a photo file directly.');
        return;
      }

      try {
        const constraints = {
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 1280 },
            height: { ideal: 960 }
          },
          audio: false
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        currentStream = stream;
        video.srcObject = stream;
        await video.play();
        snapBtn.disabled = false;
      } catch (err) {
        console.warn('Camera stream error:', err);
        showError(`Could not access camera (${err.message || 'Permission denied'}). You can select a photo file directly.`);
      }
    }

    function showError(msg) {
      statusText.textContent = msg;
      statusBox.style.display = 'flex';
      snapBtn.disabled = true;
    }

    flipBtn.onclick = () => {
      currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
      startCamera(currentFacingMode);
    };

    snapBtn.onclick = () => {
      if (!video || !video.videoWidth) {
        if (typeof toast === 'function') toast('Waiting for camera feed…', 'warning');
        return;
      }
      try {
        const compressed = scaleAndCompressCanvas(video);
        closeModal();
        onPhotoCaptured(compressed);
      } catch (err) {
        if (typeof toast === 'function') toast('Could not capture frame: ' + err.message, 'error');
      }
    };

    const triggerFilePick = () => hiddenFileInput.click();
    uploadBtn.onclick = triggerFilePick;
    fallbackPickBtn.onclick = triggerFilePick;

    hiddenFileInput.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const compressed = await compressImageFile(file);
        closeModal();
        onPhotoCaptured(compressed);
      } catch (err) {
        if (typeof toast === 'function') toast('Could not process image: ' + err.message, 'error');
      }
    };

    startCamera(currentFacingMode);
  }

  function enhanceMainProductModal(modal) {
    if (!modal || modal.dataset.cameraEnhanced === '1') return;
    const upload = modal.querySelector('#imgUpload');
    const preview = modal.querySelector('#imgPreview');
    const base64 = modal.querySelector('#imgBase64');
    const urlInput = modal.querySelector('#imgUrlInput');
    if (!upload || !preview || !base64 || !urlInput) return;

    modal.dataset.cameraEnhanced = '1';
    upload.accept = 'image/*';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary';
    button.id = 'takeProductPhotoBtn';
    button.textContent = '📷 Take Photo';
    button.style.cssText = 'padding:7px 12px;font-size:13px;white-space:nowrap;font-weight:600;';

    upload.insertAdjacentElement('afterend', button);

    button.addEventListener('click', () => {
      openLiveCameraModal(compressed => {
        base64.value = compressed;
        urlInput.value = '';
        preview.innerHTML = previewHtml(compressed);
        if (typeof toast === 'function') toast('Photo captured for this product.', 'success');
      });
    });
  }

  function enhanceAdminProductModal(overlay) {
    if (!overlay || overlay.dataset.cameraEnhanced === '1') return;
    const title = overlay.querySelector('.modal-title');
    const nameInput = overlay.querySelector('#mName');
    const priceInput = overlay.querySelector('#mPrice');
    const grid = overlay.querySelector('.form-grid');
    if (!title || !/product/i.test(title.textContent || '') || !nameInput || !priceInput || !grid) return;

    overlay.dataset.cameraEnhanced = '1';

    let existingImage = '';
    try {
      if (typeof state !== 'undefined' && state?.menu?.items) {
        const current = state.menu.items.find(row => String(row.name || '') === String(nameInput.value || ''));
        existingImage = current?.image_url || '';
      }
    } catch (_) {}
    window.__adminProductPendingImage = existingImage;

    const group = document.createElement('div');
    group.className = 'form-group';
    group.style.gridColumn = '1 / -1';
    group.innerHTML = `
      <label class="form-label">Product Image</label>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <div id="adminProductImagePreview" style="width:68px;height:68px;border-radius:8px;border:1px solid var(--line);background:var(--bg);display:flex;align-items:center;justify-content:center;overflow:hidden;flex:0 0 auto;">
          ${existingImage ? previewHtml(existingImage) : '<span style="font-size:24px;opacity:.55">🖼️</span>'}
        </div>
        <label class="btn btn-ghost btn-sm" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;">
          🖼️ Choose Image
          <input id="adminProductGalleryInput" type="file" accept="image/*" style="display:none">
        </label>
        <button type="button" class="btn btn-ghost btn-sm" id="adminProductCameraBtn">📷 Take Photo</button>
      </div>
      <small style="color:var(--muted);display:block;margin-top:6px;">Open live camera or choose an image file for this product.</small>
    `;
    grid.insertBefore(group, grid.firstElementChild);

    const preview = group.querySelector('#adminProductImagePreview');
    const gallery = group.querySelector('#adminProductGalleryInput');
    const cameraBtn = group.querySelector('#adminProductCameraBtn');

    gallery.addEventListener('change', async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const compressed = await compressImageFile(file);
        window.__adminProductPendingImage = compressed;
        preview.innerHTML = previewHtml(compressed);
        if (typeof toast === 'function') toast('Product image ready.', 'success');
      } catch (err) {
        if (typeof toast === 'function') toast(err.message || 'Could not use image.', 'error');
      } finally {
        gallery.value = '';
      }
    });

    cameraBtn.addEventListener('click', () => {
      openLiveCameraModal(compressed => {
        window.__adminProductPendingImage = compressed;
        preview.innerHTML = previewHtml(compressed);
        if (typeof toast === 'function') toast('Product photo captured!', 'success');
      });
    });
  }

  function scan(root = document) {
    const mainModal = root.querySelector?.('#productModal') || document.querySelector('#productModal');
    if (mainModal) enhanceMainProductModal(mainModal);

    document.querySelectorAll('.modal-overlay').forEach(enhanceAdminProductModal);
  }

  const observer = new MutationObserver(() => scan());
  const start = () => {
    scan();
    observer.observe(document.documentElement, { childList: true, subtree: true });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
