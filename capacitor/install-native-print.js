const fs=require('fs');
const path=require('path');
const target=path.join(__dirname,'android/app/src/main/java/com/oraforge/pos');
fs.copyFileSync(path.join(__dirname,'native/ReceiptPrinterPlugin.java'),path.join(target,'ReceiptPrinterPlugin.java'));
const main=path.join(target,'MainActivity.java');
let text=fs.readFileSync(main,'utf8');
if (!text.includes('registerPlugin(ReceiptPrinterPlugin.class)')) {
 if (text.includes('void onCreate(')) throw new Error('MainActivity has a custom onCreate; register ReceiptPrinterPlugin explicitly.');
 text=text.replace('extends BridgeActivity {',`extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(ReceiptPrinterPlugin.class);
        super.onCreate(savedInstanceState);
    }
`);
 fs.writeFileSync(main,text);
}
console.log('Android receipt printing registered.');
