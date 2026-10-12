package com.rjotko.bela;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONObject;

/**
 * Today on the home screen: calories against the goal, habits done, and the
 * two things you open the app for — starting the day's session and logging a
 * meal. Drawn from the figures the app last handed over (BelaWidgetPlugin);
 * a tap opens the app straight onto that action.
 */
public class BelaWidget extends AppWidgetProvider {

    static final String EXTRA_GO = "bela_go";

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, build(ctx));
    }

    static void refreshAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, BelaWidget.class));
        for (int id : ids) mgr.updateAppWidget(id, build(ctx));
    }

    private static PendingIntent open(Context ctx, String go, int code) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (go != null) i.putExtra(EXTRA_GO, go);
        return PendingIntent.getActivity(ctx, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static RemoteViews build(Context ctx) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_today);
        JSONObject d;
        try {
            d = new JSONObject(ctx.getSharedPreferences(BelaWidgetPlugin.PREFS, Context.MODE_PRIVATE)
                    .getString(BelaWidgetPlugin.KEY, "{}"));
        } catch (Exception e) {
            d = new JSONObject();
        }
        int kcal = d.optInt("kcal", 0), goal = d.optInt("kcalGoal", 0);
        boolean kcalDone = d.optBoolean("kcalDone", false);
        int hDone = d.optInt("habitsDone", 0), hTotal = d.optInt("habitsTotal", 0);

        v.setTextViewText(R.id.w_date, d.optString("date", ""));
        v.setTextViewText(R.id.w_kcal, String.format(java.util.Locale.getDefault(), "%,d", kcal));
        v.setTextViewText(R.id.w_kcal_goal, goal > 0 ? String.format(java.util.Locale.getDefault(), " / %,d kcal", goal) : " kcal");
        int kp = goal > 0 ? Math.min(100, Math.round(kcal * 100f / goal)) : 0;
        v.setProgressBar(R.id.w_kcal_bar, 100, kp, false);
        v.setProgressBar(R.id.w_kcal_bar_done, 100, kp, false);
        v.setViewVisibility(R.id.w_kcal_bar, kcalDone ? View.GONE : View.VISIBLE);
        v.setViewVisibility(R.id.w_kcal_bar_done, kcalDone ? View.VISIBLE : View.GONE);

        v.setTextViewText(R.id.w_habits, hDone + "");
        v.setTextViewText(R.id.w_habits_total, " / " + hTotal);
        int hp = hTotal > 0 ? Math.round(hDone * 100f / hTotal) : 0;
        boolean allDone = hTotal > 0 && hDone >= hTotal;
        v.setProgressBar(R.id.w_habits_bar, 100, hp, false);
        v.setProgressBar(R.id.w_habits_bar_done, 100, hp, false);
        v.setViewVisibility(R.id.w_habits_bar, allDone ? View.GONE : View.VISIBLE);
        v.setViewVisibility(R.id.w_habits_bar_done, allDone ? View.VISIBLE : View.GONE);

        v.setTextViewText(R.id.w_start, d.optString("start", "Start workout"));

        v.setOnClickPendingIntent(R.id.w_root, open(ctx, null, 1));
        v.setOnClickPendingIntent(R.id.w_start, open(ctx, "workout", 2));
        v.setOnClickPendingIntent(R.id.w_meal, open(ctx, "meal", 3));
        v.setOnClickPendingIntent(R.id.w_habits_box, open(ctx, "habits", 4));
        v.setOnClickPendingIntent(R.id.w_kcal_box, open(ctx, "nutrition", 5));
        return v;
    }
}
