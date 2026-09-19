(() => {
  function buildSearchTerms(query) {
    const q = String(query || '').trim();
    if (!q) return [];
    const terms = [q];
    let cleaned = q
      .replace(/\b\d+(?:\.\d+)?\s*(mg|ml|g|kg|l|s|m|cm|mm|oz|cl|tin|pkt|btl|bag|can|pie|plate|pcs|inch)\b/gi, '')
      .replace(/\b\d+\b/g, '')
      .replace(/[-–—/()[\],.]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned && cleaned.toLowerCase() !== q.toLowerCase()) terms.push(cleaned);

    const stop = new Set(['with','for','and','the','pcs','ltd','pack','bottle','box','inch','white']);
    const words = cleaned.split(/\s+/).filter(w => w.length >= 3 && !stop.has(w.toLowerCase()));
    const add = text => { if (text && !terms.some(t => t.toLowerCase() === text.toLowerCase())) terms.push(text); };
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
        headers: { 'Accept': 'application/json', 'User-Agent': 'OraforgePOS/1.0' },
      });
      if (Number(response.status || 200) >= 400) throw new Error(`Image provider failed (${response.status})`);
      return typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
    }
    const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!response.ok) throw new Error(`Image provider failed (${response.status})`);
    return response.json();
  }

  async function improvedSearch(query, limit = 6) {
    const q = String(query || '').trim();
    if (!q) return { images: [], results: [] };
    if (!navigator.onLine) throw new Error('Image search needs an internet connection.');

    const wanted = Math.max(1, Math.min(Number(limit || 6), 12));
    const terms = buildSearchTerms(q);
    const results = [];
    const seen = new Set();
    const push = image => {
      const url = image?.url || image?.full || image?.thumbnail || image?.thumb;
      const thumb = image?.thumbnail || image?.thumb || url;
      if (!url || seen.has(url)) return;
      const lower = url.toLowerCase();
      if (['.svg','.pdf','.tif','.tiff','.ogg','.ogv','.webm'].some(ext => lower.includes(ext))) return;
      seen.add(url);
      results.push({
        thumb,
        full: url,
        thumbnail: thumb,
        url,
        title: image.title || q,
        source: image.source || 'Web',
      });
    };

    for (const term of terms) {
      if (results.length >= wanted) break;
      try {
        const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(term)}&page_size=10`;
        const data = await requestJSON(url);
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
        console.warn('Openverse search failed', err);
      }

      if (results.length < wanted) {
        try {
          const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(term)}&gsrnamespace=6&gsrlimit=10&prop=imageinfo&iiprop=url|thumburl&iiurlwidth=500&format=json&origin=*`;
          const data = await requestJSON(url);
          const pages = data?.query?.pages || {};
          for (const page of Object.values(pages)) {
            const info = page?.imageinfo?.[0] || {};
            push({
              thumbnail: info.thumburl || info.url,
              url: info.url || info.thumburl,
              title: String(page?.title || term).replace(/^File:/, ''),
              source: 'Wikimedia',
            });
            if (results.length >= wanted) break;
          }
        } catch (err) {
          console.warn('Wikimedia search failed', err);
        }
      }
    }

    if (results.length < wanted) {
      for (const term of terms.slice(0, 3)) {
        try {
          const url = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(term)}&gsrlimit=6&prop=pageimages&pithumbsize=500&format=json&origin=*`;
          const data = await requestJSON(url);
          const pages = data?.query?.pages || {};
          for (const page of Object.values(pages)) {
            const thumb = page?.thumbnail?.source;
            if (thumb) push({ thumbnail: thumb, url: thumb, title: page.title || term, source: 'Wikipedia' });
            if (results.length >= wanted) break;
          }
        } catch (err) {
          console.warn('Wikipedia image fallback failed', err);
        }
        if (results.length >= wanted) break;
      }
    }

    if (!results.length) throw new Error(`No usable product image found for “${q}”. Try a simpler product name.`);
    return { images: results.slice(0, wanted), results: results.slice(0, wanted) };
  }

  if (typeof searchOnlineProductImages === 'function') {
    searchOnlineProductImages = improvedSearch;
  } else {
    window.searchOnlineProductImages = improvedSearch;
  }
  window.OraforgeImageSearch = { buildSearchTerms, search: improvedSearch };
})();
