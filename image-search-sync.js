(() => {
  function buildSearchTerms(query) {
    const q = String(query || '').trim();
    if (!q) return [];
    const terms = [q];
    let cleaned = q
      .replace(/\b\d+(?:\.\d+)?\s*(mg|ml|g|kg|l|cm|mm|oz|cl|tin|pkt|btl|bag|can|pie|plate|pcs|inch)\b/gi, '')
      .replace(/\b\d+\b/g, '')
      .replace(/[-–—/()[\],.]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned && cleaned.toLowerCase() !== q.toLowerCase()) terms.push(cleaned);

    const stop = new Set(['with','for','and','the','pcs','ltd','pack','bottle','box','inch','white','fresh']);
    const words = cleaned.split(/\s+/).filter(w => w.length >= 3 && !stop.has(w.toLowerCase()));
    const add = text => {
      if (text && !terms.some(t => t.toLowerCase() === text.toLowerCase())) terms.push(text);
    };
    if (words.length >= 2) add(words.slice(-2).join(' '));
    if (words.length >= 2) add(words.slice(0, 2).join(' '));
    if (words.length) add(words[words.length - 1]);
    if (words.length) add(words[0]);
    return terms;
  }

  async function requestJSON(url) {
    if (window.OraforgeHttp?.request) {
      const response = await window.OraforgeHttp.request({
        url,
        method: 'GET',
        headers: { Accept: 'application/json' },
        connectTimeout: 10000,
        readTimeout: 15000,
      });
      return typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
    }
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Image provider failed (${response.status})`);
    return response.json();
  }

  async function improvedSearch(query, limit = 8) {
    const q = String(query || '').trim();
    if (!q) return { images: [], results: [] };
    if (!navigator.onLine) throw new Error('Image search needs an internet connection.');

    const wanted = Math.max(1, Math.min(Number(limit || 8), 12));
    const terms = buildSearchTerms(q);
    const results = [];
    const seen = new Set();

    const push = image => {
      const full = image?.url || image?.full || image?.thumbnail || image?.thumb;
      const thumb = image?.thumbnail || image?.thumb || full;
      if (!full || seen.has(full)) return;
      const lower = full.toLowerCase();
      if (['.svg','.pdf','.tif','.tiff','.ogg','.ogv','.webm'].some(ext => lower.includes(ext))) return;
      seen.add(full);
      results.push({ thumb, full, thumbnail: thumb, url: full, title: image.title || q, source: image.source || 'Web' });
    };

    for (const term of terms) {
      if (results.length >= wanted) break;
      try {
        const data = await requestJSON(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(term)}&page_size=12`);
        for (const item of data?.results || []) {
          push({
            thumbnail: item.thumbnail || item.url,
            url: item.url || item.thumbnail,
            title: item.title || term,
            source: 'Openverse',
          });
          if (results.length >= wanted) break;
        }
      } catch (err) {
        console.warn('Openverse image search failed:', err);
      }

      if (results.length < wanted) {
        try {
          const data = await requestJSON(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(term)}&gsrnamespace=6&gsrlimit=12&prop=imageinfo&iiprop=url|thumburl&iiurlwidth=500&format=json&origin=*`);
          for (const page of Object.values(data?.query?.pages || {})) {
            const info = page?.imageinfo?.[0] || {};
            push({
              thumbnail: info.thumburl || info.url,
              url: info.url || info.thumburl,
              title: String(page?.title || term).replace(/^File:/, ''),
              source: 'Wikimedia Commons',
            });
            if (results.length >= wanted) break;
          }
        } catch (err) {
          console.warn('Wikimedia Commons image search failed:', err);
        }
      }
    }

    if (results.length < wanted) {
      for (const term of terms.slice(0, 4)) {
        try {
          const data = await requestJSON(`https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(term)}&gsrlimit=8&prop=pageimages&pithumbsize=600&format=json&origin=*`);
          for (const page of Object.values(data?.query?.pages || {})) {
            const thumb = page?.thumbnail?.source;
            if (thumb) push({ thumbnail: thumb, url: thumb, title: page.title || term, source: 'Wikipedia' });
            if (results.length >= wanted) break;
          }
        } catch (err) {
          console.warn('Wikipedia image search failed:', err);
        }
        if (results.length >= wanted) break;
      }
    }

    return { images: results.slice(0, wanted), results: results.slice(0, wanted), terms };
  }

  searchOnlineProductImages = improvedSearch;

  showImageSearchModal = function(initialQuery, onSelect) {
    document.querySelector('#imageSearchOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'imageSearchOverlay';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box" style="max-width:720px;max-height:90vh;">
        <div class="modal-head">
          <div>
            <h3 style="margin:0">🔎 Search Product Images</h3>
            <div style="font-size:12px;color:var(--muted);margin-top:5px">Searches Openverse, Wikimedia Commons and Wikipedia. Product sizes and packaging words are simplified automatically.</div>
          </div>
          <button type="button" class="modal-close" id="imageSearchClose">×</button>
        </div>
        <div style="padding:18px 24px;display:flex;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--line)">
          <input id="imageSearchQuery" class="field" style="flex:1;min-width:220px" value="${String(initialQuery || '').replace(/"/g, '&quot;')}" placeholder="e.g. sliced white bread">
          <button type="button" class="primary" id="imageSearchButton" style="padding:10px 20px">Search</button>
        </div>
        <div id="imageSearchStatus" style="padding:10px 24px 0;color:var(--muted);font-size:12px"></div>
        <div id="imageSearchResults" style="padding:18px 24px 24px;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;min-height:220px"></div>
      </div>`;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('#imageSearchQuery');
    const button = overlay.querySelector('#imageSearchButton');
    const status = overlay.querySelector('#imageSearchStatus');
    const results = overlay.querySelector('#imageSearchResults');
    const close = () => overlay.remove();
    overlay.querySelector('#imageSearchClose').onclick = close;
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    const run = async () => {
      const q = input.value.trim();
      if (!q) return;
      button.disabled = true;
      button.textContent = 'Searching…';
      status.textContent = 'Trying several search terms and image providers…';
      results.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:48px 10px;color:var(--muted)">Searching for product photos…</div>';
      try {
        const data = await improvedSearch(q, 8);
        const images = data.images || [];
        if (!images.length) {
          status.textContent = `Tried: ${(data.terms || []).join(' · ')}`;
          results.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:48px 10px;color:var(--muted)">📷<br><br>No usable image found.<br><small>Try a shorter name such as “bread”, “milk”, “cement” or a brand name.</small></div>`;
          return;
        }
        status.textContent = `${images.length} result${images.length === 1 ? '' : 's'} found · tap one to use it`;
        results.innerHTML = images.map((img, index) => `
          <button type="button" data-image-index="${index}" style="background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px;text-align:left;color:var(--ink);overflow:hidden">
            <div style="height:120px;background:var(--bg);border-radius:7px;display:grid;place-items:center;overflow:hidden">
              <img src="${img.thumbnail || img.url}" alt="" style="width:100%;height:100%;object-fit:contain" loading="lazy">
            </div>
            <div style="font-size:12px;font-weight:700;margin-top:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${String(img.title || q).replace(/</g,'&lt;')}</div>
            <div style="font-size:10px;color:var(--muted);margin-top:3px">${img.source || 'Web'}</div>
          </button>`).join('');
        results.querySelectorAll('[data-image-index]').forEach(card => {
          card.onclick = () => {
            const img = images[Number(card.dataset.imageIndex)];
            onSelect(img.url || img.full || img.thumbnail);
            toast('Product image selected.', 'success');
            close();
          };
        });
      } catch (err) {
        status.textContent = '';
        results.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:48px 10px;color:var(--danger)">Image search failed: ${String(err.message || err)}</div>`;
      } finally {
        button.disabled = false;
        button.textContent = 'Search';
      }
    };

    button.onclick = run;
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
    setTimeout(() => { input.focus(); input.select(); }, 50);
    if (String(initialQuery || '').trim()) run();
  };

  window.OraforgeImageSearch = { buildSearchTerms, search: improvedSearch };
})();
