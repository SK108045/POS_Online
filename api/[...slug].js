/**
 * Catch-all Vercel Serverless Function Route
 * Forwards all /api/* requests to the unified API handler in ./index.js
 */
const handler = require('./index.js');

module.exports = async (req, res) => {
  return handler(req, res);
};
