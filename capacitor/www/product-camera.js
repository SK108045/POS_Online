(() => {
  const compressImageFile = file => new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No image selected.'));
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Could not read image.'));
    reader.onload = event => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not decode image.'));
      img.onload = () => {
        const MAX = 640;
        let width = img.width;
        let height = img.height;
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
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.78));
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });

  const previewHtml = src => `<img src="${src}" alt="Product" style="width:100%;height:100%;object-fit:contain;padding:4px;box-sizing:border-box;">`;

  function enhanceMainProductModal(modal) {
    if (!modal || modal.dataset.cameraEnhanced === '1') return;
    const upload = modal.querySelector('#imgUpload');
    const preview = modal.querySelector('#imgPreview');
    const base64 = modal.querySelector('#imgBase64');
    const urlInput = modal.querySelector('#imgUrlInput');
    if (!upload || !preview || !base64 || !urlInput) return;

    modal.dataset.cameraEnhanced = '1';
    upload.accept = 'image/*';

    const cameraInput = document.createElement('input');
    cameraInput.type = 'file';
    cameraInput.accept = 'image/*';
    cameraInput.capture = 'environment';
    cameraInput.id = 'imgCameraCapture';
    cameraInput.style.display = 'none';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary';
    button.id = 'takeProductPhotoBtn';
    button.textContent = '📷 Take Photo';
    button.style.cssText = 'padding:7px 12px;font-size:13px;white-space:nowrap;';

    upload.insertAdjacentElement('afterend', cameraInput);
    cameraInput.insertAdjacentElement('afterend', button);

    button.addEventListener('click', () => cameraInput.click());
    cameraInput.addEventListener('change', async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        button.disabled = true;
        button.textContent = 'Processing…';
        const compressed = await compressImageFile(file);
        base64.value = compressed;
        urlInput.value = '';
        preview.innerHTML = previewHtml(compressed);
        if (typeof toast === 'function') toast('Photo captured for this product.', 'success');
      } catch (err) {
        if (typeof toast === 'function') toast(err.message || 'Could not use photo.', 'error');
      } finally {
        button.disabled = false;
        button.textContent = '📷 Take Photo';
        cameraInput.value = '';
      }
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
        <input id="adminProductCameraInput" type="file" accept="image/*" capture="environment" style="display:none">
      </div>
      <small style="color:var(--muted);display:block;margin-top:6px;">Choose an existing image or take a photo with the phone camera.</small>
    `;
    grid.insertBefore(group, grid.firstElementChild);

    const preview = group.querySelector('#adminProductImagePreview');
    const gallery = group.querySelector('#adminProductGalleryInput');
    const camera = group.querySelector('#adminProductCameraInput');
    const cameraBtn = group.querySelector('#adminProductCameraBtn');

    const process = async (file, sourceButton = null) => {
      if (!file) return;
      try {
        if (sourceButton) sourceButton.disabled = true;
        const compressed = await compressImageFile(file);
        window.__adminProductPendingImage = compressed;
        preview.innerHTML = previewHtml(compressed);
        if (typeof toast === 'function') toast('Product image ready.', 'success');
      } catch (err) {
        if (typeof toast === 'function') toast(err.message || 'Could not use image.', 'error');
      } finally {
        if (sourceButton) sourceButton.disabled = false;
        gallery.value = '';
        camera.value = '';
      }
    };

    gallery.addEventListener('change', event => process(event.target.files?.[0]));
    cameraBtn.addEventListener('click', () => camera.click());
    camera.addEventListener('change', event => process(event.target.files?.[0], cameraBtn));
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
