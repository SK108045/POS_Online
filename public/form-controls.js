/* Shared, accessible filtering for native product/category selects. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OraforgeFormControls = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  let sequence = 0;
  const normalize = value => String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  function searchableSelect(select, choices, label = 'options') {
    if (select.dataset.searchable === 'true') return;
    select.dataset.searchable = 'true';
    const document = select.ownerDocument;
    const rows = choices || Array.from(select.options).filter(option => option.value).map(option => ({value:option.value,label:option.textContent}));
    const indexed = rows.map(row => ({value:String(row.value),label:String(row.label),search:normalize(row.value+' '+row.label)}));
    let selected = select.dataset.selected ?? select.value;
    const placeholder = Array.from(select.options).find(option => !option.value)?.textContent || 'Select the correct value';
    const input = document.createElement('input');
    input.type = 'search'; input.className = 'field select-search';
    input.placeholder = 'Search '+label+'…'; input.setAttribute('aria-label','Search '+label);
    input.autocomplete = 'off';
    select.id ||= 'searchable-select-'+(++sequence);
    select.setAttribute('aria-label','Select '+label);
    input.setAttribute('aria-controls',select.id);
    const status = document.createElement('small'); status.className = 'select-search-status';
    status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
    select.before(input); select.after(status);
    function render() {
      const words = normalize(input.value).trim().split(/\s+/).filter(Boolean);
      const matches = indexed.filter(row => words.every(word => row.search.includes(word)));
      const visible = matches.slice(0,150);
      const keep = indexed.find(row => row.value === selected);
      if (keep && !visible.some(row => row.value === selected)) visible.unshift(keep);
      const options = document.createDocumentFragment();
      const blank = document.createElement('option'); blank.value=''; blank.textContent=placeholder; options.append(blank);
      for (const row of visible) {
        const option = document.createElement('option'); option.value=row.value; option.textContent=row.value+' - '+row.label; options.append(option);
      }
      select.replaceChildren(options); select.value=selected;
      status.textContent = matches.length > 150 ? 'Showing 150 of '+matches.length+' matches. Keep typing to narrow the list.'
        : matches.length ? matches.length+' match'+(matches.length===1?'':'es') : 'No matches. Try another name or code.';
    }
    input.addEventListener('input',render);
    input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();select.focus();}});
    select.addEventListener('change',()=>{selected=select.value;});
    render();
    return input;
  }
  return {searchableSelect};
});
