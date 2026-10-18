module.exports = async (req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Oraforge-Etims');
  if (req.method === 'OPTIONS') {
    return res.end();
  }
  return res.end(JSON.stringify({
    ready: true,
    vat_supported: true,
    discount_supported: true,
    requirements: [],
    missing: [],
    adjustments: {}
  }));
};
