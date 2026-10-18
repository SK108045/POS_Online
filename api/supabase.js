/**
 * Supabase client and offline/preview fallback provider for Oraforge POS on Vercel.
 */
const fs = require('fs');
const path = require('path');
let createClient = null;
try {
  createClient = require('@supabase/supabase-js').createClient;
} catch (_) {
  // Will be installed during Vercel deployment build step via package.json
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const SUPABASE_SCHEMA = process.env.SUPABASE_SCHEMA || 'pos';

const isConfigured = Boolean(createClient && SUPABASE_URL && SUPABASE_KEY && SUPABASE_URL.startsWith('http'));

let client = null;
if (isConfigured && createClient) {
  try {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      db: { schema: SUPABASE_SCHEMA },
      auth: { persistSession: false }
    });
  } catch (err) {
    console.error('[Supabase] Failed to initialize client:', err.message);
  }
}

// In-memory / file fallback for preview mode when credentials are not yet entered
let fallbackCatalog = null;
function getFallbackCatalog() {
  if (fallbackCatalog) return fallbackCatalog;
  try {
    const filePath = path.join(process.cwd(), 'capacitor', 'www', 'buildmart_catalog.json');
    if (fs.existsSync(filePath)) {
      fallbackCatalog = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return fallbackCatalog;
    }
  } catch (e) {
    console.warn('[Fallback] Could not load buildmart_catalog.json:', e.message);
  }
  return {
    shop_name: 'BuildMart Hardware',
    business_type: 'hardware',
    categories: [
      { id: 1, name: 'Plumbing', sort_order: 0 },
      { id: 2, name: 'Electrical', sort_order: 1 },
      { id: 3, name: 'Tools', sort_order: 2 },
      { id: 4, name: 'Building Materials', sort_order: 3 },
      { id: 5, name: 'Paint & Finishes', sort_order: 4 },
      { id: 6, name: 'Fasteners', sort_order: 5 },
      { id: 7, name: 'Safety', sort_order: 6 }
    ],
    items: [],
    suppliers: [],
    orders: []
  };
}

module.exports = {
  isConfigured,
  client,
  SUPABASE_URL,
  SUPABASE_SCHEMA,
  getFallbackCatalog
};
