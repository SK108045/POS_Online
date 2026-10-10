/* Official portal origins only. Route recognition belongs to the DOM adapter. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OraforgeKraSites = api;
})(globalThis, function () {
  const origins = ['https://ecitizen.kra.go.ke', 'https://kra.ecitizen.go.ke', 'https://etims.kra.go.ke'];
  function allowed(value) {
    try { const u = new URL(value); return origins.includes(u.origin) && !u.username && !u.password; }
    catch (_) { return false; }
  }
  function destination(value, fallback) {
    if (!value) return fallback;
    if (!allowed(value)) throw Error('Use an HTTPS invoice page on an official KRA eTIMS portal.');
    return new URL(value).href;
  }
  return {origins, allowed, destination,
    create: 'https://ecitizen.kra.go.ke/individual/etims/sale/create',
    list: 'https://ecitizen.kra.go.ke/individual/etims/sale'};
});
