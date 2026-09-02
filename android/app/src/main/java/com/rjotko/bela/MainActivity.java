package com.rjotko.bela;

import android.os.Bundle;

import androidx.core.splashscreen.SplashScreen;

import com.getcapacitor.BridgeActivity;

/**
 * The launch screen is the only place the mark is drawn, and it is held open
 * for a beat after the activity starts.
 *
 * Without the hold it goes away the moment the WebView paints its first frame,
 * which is before the window has told the page how tall the status and
 * navigation bars are, and before home has sized itself to what is left. Those
 * two arriving late is what made the screen jump: you saw the app, then you saw
 * it move. Holding the launch screen puts that settling behind the logo, so the
 * first thing you see is the finished screen.
 *
 * It is a fixed hold rather than a handshake with the page on purpose: nothing
 * the web layer can get wrong is able to leave you looking at a logo forever.
 */
public class MainActivity extends BridgeActivity {

    /** Long enough for the insets to land and home to fit itself, short enough
     *  not to feel like waiting. */
    private static final long HOLD_MS = 950;

    private long startedAt;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        SplashScreen splash = SplashScreen.installSplashScreen(this);
        startedAt = System.currentTimeMillis();
        splash.setKeepOnScreenCondition(
                () -> System.currentTimeMillis() - startedAt < HOLD_MS);
        super.onCreate(savedInstanceState);
    }
}
