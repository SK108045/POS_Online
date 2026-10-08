const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
function setup() {
  const records = new Map(), storage = new Map();
  const window = { OraforgeDBReady: Promise.resolve(), OraforgeDB: {
    async get(k, fallback) { return records.has(k) ? structuredClone(records.get(k)) : fallback; },
    async set(k, v) { records.set(k, structuredClone(v)); }
  }};
  const localStorage = {getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k)};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../www/shop-registry.js'), 'utf8'), {window, localStorage, crypto: webcrypto, TextEncoder, console});
  return window.OraforgeShops;
}
test('changed PIN invalidates old PIN; inactive staff cannot log in; new staff can authenticate', async () => {
  const shops = setup();
  const shop = await shops.register({shop_name:'Test Shop',owner_name:'Test Owner',username:'owner',password:'OriginalPass!',confirm_password:'OriginalPass!',pin:'654321',business_type:'retail'});
  assert.equal(await shops.verifyStaffPin(shop.id,'654321'),true);
  await shops.saveUser(shop.id,{id:1,password:'7777'});
  assert.equal(await shops.verifyStaffPin(shop.id,'654321'),false);
  assert.equal(await shops.verifyStaffPin(shop.id,'7777'),true);
  await shops.saveUser(shop.id,{id:1,active:0});
  assert.equal(await shops.verifyStaffPin(shop.id,'7777'),false);
  await shops.saveUser(shop.id,{id:1,active:1});
  assert.equal(await shops.verifyStaffPin(shop.id,'7777'),true);
  await shops.saveUser(shop.id,{username:'cashier2',full_name:'Second Cashier',role:'cashier',password:'8888'});
  assert.equal((await shops.authenticateStaff(shop.id,'8888')).username,'cashier2');
  await assert.rejects(shops.saveUser(shop.id,{username:'cashier3',full_name:'Third Cashier',password:'8888'}));
  await assert.rejects(shops.saveUser(shop.id,{id:1,password:'abc'}));
  assert.equal(await shops.verifyStaffPin(shop.id,'7777'),true);
});
test('owner credential edits are used for login and blank passwords preserve existing credentials', async () => {
  const shops = setup();
  const shop = await shops.register({shop_name:'Test Shop',owner_name:'Test Owner',username:'owner',password:'OriginalPass!',confirm_password:'OriginalPass!',pin:'1234',business_type:'retail'});
  await shops.saveUser(shop.id,{id:2,username:'newowner',password:'ChangedPass!'});
  assert.equal(await shops.verifyOwner(shop.id,'owner','OriginalPass!'),false);
  assert.equal(await shops.verifyOwner(shop.id,'newowner','ChangedPass!'),true);
  await shops.saveUser(shop.id,{id:2,full_name:'Updated Owner',password:''});
  assert.equal(await shops.verifyOwner(shop.id,'newowner','ChangedPass!'),true);
  await assert.rejects(shops.saveUser(shop.id,{id:2,active:0}));
});
