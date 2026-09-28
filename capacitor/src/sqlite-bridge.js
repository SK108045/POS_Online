import { createNativeProviders } from './native-providers';
import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';

class IndexedFallback {
  constructor(){ this.dbp = null; }
  open(){
    if (this.dbp) return this.dbp;
    this.dbp = new Promise((resolve,reject)=>{
      const req=indexedDB.open('oraforge_pos_fallback',1);
      req.onupgradeneeded=()=>{ const db=req.result; if(!db.objectStoreNames.contains('kv')) db.createObjectStore('kv'); };
      req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
    });
    return this.dbp;
  }
  async get(key,fallback){ const db=await this.open(); return new Promise((resolve,reject)=>{ const tx=db.transaction('kv','readonly'); const r=tx.objectStore('kv').get(key); r.onsuccess=()=>resolve(r.result===undefined?fallback:r.result); r.onerror=()=>reject(r.error); }); }
  async set(key,value){ const db=await this.open(); return new Promise((resolve,reject)=>{ const tx=db.transaction('kv','readwrite'); tx.objectStore('kv').put(value,key); tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error); }); }
}

class OraforgeDB {
  constructor(){ this.sqlite=null; this.db=null; this.fallback=new IndexedFallback(); this.native=false; }
  async init(){
    this.native = ['android','ios'].includes(Capacitor.getPlatform());
    if (!this.native) return this;
    try {
      this.sqlite = new SQLiteConnection(CapacitorSQLite);
      try { this.db = await this.sqlite.createConnection('oraforge_pos', false, 'no-encryption', 1, false); }
      catch (_) { this.db = await this.sqlite.retrieveConnection('oraforge_pos', false); }
      await this.db.open();
      await this.db.execute('CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);');
    } catch (err) {
      console.error('Native SQLite unavailable; using IndexedDB fallback', err);
      this.native = false; this.db = null;
    }
    return this;
  }
  async exportRecords(){
    if (this.native && this.db) {
      const result = await this.db.query('SELECT key, value FROM kv_store;');
      return (result.values || []).map(row => [row.key, JSON.parse(row.value)]);
    }
    const db = await this.fallback.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readonly'), rows = [];
      const request = tx.objectStore('kv').openCursor();
      request.onsuccess = () => { const cursor = request.result; if(cursor){ rows.push([cursor.key, cursor.value]); cursor.continue(); } };
      tx.oncomplete = () => resolve(rows); tx.onerror = () => reject(tx.error);
    });
  }
  async replaceRecords(rows){
    if (this.native && this.db) {
      await this.db.executeSet([{statement:'DELETE FROM kv_store;', values:[]}, ...rows.map(([key,value]) => ({statement:'INSERT INTO kv_store(key,value) VALUES (?,?);', values:[key,JSON.stringify(value)]}))], true);
      return;
    }
    const db = await this.fallback.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv','readwrite'), store = tx.objectStore('kv');
      store.clear(); rows.forEach(([key,value]) => store.put(value,key));
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Restore cancelled'));
    });
  }
  async get(key,fallback){
    if (!this.native || !this.db) return this.fallback.get(key,fallback);
    const r = await this.db.query('SELECT value FROM kv_store WHERE key = ? LIMIT 1;', [key]);
    if (!r.values || !r.values.length) return fallback;
    try { return JSON.parse(r.values[0].value); } catch (_) { return fallback; }
  }
  async set(key,value){
    if (!this.native || !this.db) return this.fallback.set(key,value);
    await this.db.run('INSERT OR REPLACE INTO kv_store(key,value) VALUES (?,?);', [key, JSON.stringify(value)]);
  }
}

window.OraforgeDB = new OraforgeDB();
window.OraforgeDBReady = window.OraforgeDB.init();


window.OraforgeNative = Capacitor.isNativePlatform();
window.OraforgeHttp = {
  async request({ url, method = 'GET', headers = {}, data = null, params = null, connectTimeout = 10000, readTimeout = 15000 }) {
    const options = { url, method, headers, connectTimeout, readTimeout };
    if (data !== null && data !== undefined) options.data = data;
    if (params) options.params = params;
    const response = await CapacitorHttp.request(options);
    if (response.status < 200 || response.status >= 300) {
      let message = `Network request failed (${response.status})`;
      const payload = response.data;
      if (payload && typeof payload === 'object') message = payload.error || payload.errorMessage || payload.message || message;
      else if (typeof payload === 'string' && payload.trim()) message = payload.slice(0, 180);
      const error = new Error(message);
      error.status = response.status;
      error.data = payload;
      throw error;
    }
    return response;
  }
};

window.OraforgeProviders = createNativeProviders(window.OraforgeHttp);

window.OraforgePrinter = registerPlugin("ReceiptPrinter");
