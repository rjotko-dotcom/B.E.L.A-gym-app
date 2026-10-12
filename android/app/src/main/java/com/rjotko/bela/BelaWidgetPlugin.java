package com.rjotko.bela;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The bridge between the app and its home-screen widget.
 *
 * update() — the page hands over today's figures as JSON; they are kept in
 * the widget's own preferences and the widget is redrawn from them. Nothing
 * else of the app's data ever leaves the WebView.
 *
 * takeLaunch() — when a widget button opened the app, what it asked for
 * ("workout", "meal", "habits"), handed over once and then forgotten.
 */
@CapacitorPlugin(name = "BelaWidget")
public class BelaWidgetPlugin extends Plugin {

    static final String PREFS = "bela_widget";
    static final String KEY = "data";
    static volatile String pendingGo = null;

    @PluginMethod
    public void update(PluginCall call) {
        String data = call.getString("data", "{}");
        Context ctx = getContext();
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY, data).apply();
        BelaWidget.refreshAll(ctx);
        call.resolve();
    }

    @PluginMethod
    public void takeLaunch(PluginCall call) {
        JSObject out = new JSObject();
        out.put("go", pendingGo);
        pendingGo = null;
        call.resolve(out);
    }
}
