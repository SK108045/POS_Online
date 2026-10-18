module.exports = async (req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Oraforge-Etims');
  if (req.method === 'OPTIONS') {
    return res.end();
  }
  return res.end(JSON.stringify({
    app: 'oraforge-etims-helper',
    version: 2,
    platform: 'cloud-bridge',
    build: '20261018.1',
    runtime_mode: 'cloud_supabase',
    elevated: true,
    cloud_connected: true,
    worker_ready: true,
    vat_supported: true
  }));
};
