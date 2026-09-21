package com.oraforge.pos;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ReceiptPrinter")
public class ReceiptPrinterPlugin extends Plugin {
    @PluginMethod
    public void print(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                PrintManager manager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                if (manager == null) { call.reject("Android printing service is unavailable"); return; }
                String name = call.getString("name", "POS Receipt");
                manager.print(name, getBridge().getWebView().createPrintDocumentAdapter(name),
                    new PrintAttributes.Builder().build());
                call.resolve();
            } catch (Exception error) { call.reject("Could not open Android print dialog", error); }
        });
    }
}
