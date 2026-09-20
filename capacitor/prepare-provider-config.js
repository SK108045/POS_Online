const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
function read(names) {
  for (const name of names) {
    const file = path.join(root, name);
    if (fs.existsSync(file)) {
      const value = fs.readFileSync(file, 'utf8').trim();
      if (value) return value;
    }
  }
  throw new Error('Missing provider credential: ' + names.join(' or '));
}
const config = {
  paystack: read(['paystack.txt']),
  sms: read(['api.txt', 'capacitor/live_api.txt']),
  username: 'sk10'
};
fs.writeFileSync(path.join(__dirname, 'src/provider-config.json'), JSON.stringify(config));
console.log('Native provider configuration prepared.');
