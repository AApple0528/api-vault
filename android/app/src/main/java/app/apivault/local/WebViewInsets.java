package app.apivault.local;

import android.app.Activity;
import android.content.pm.ApplicationInfo;
import android.os.Build;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

/** Project-owned replacement for Capacitor 7.4.3's system-bar-only margins. */
final class WebViewInsets {
    private static final String TAG = "ApiVaultInsets";

    static void install(Activity activity, WebView webView) {
        // Capacitor's previous "auto" mode also did nothing on these versions.
        // Leave decor fitting and the manifest's adjustResize untouched.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) return;

        // One owner of resizing: keep the parent at full window size and shrink
        // only the WebView using insets. adjustResize/pan must not also move it.
        WindowCompat.setDecorFitsSystemWindows(activity.getWindow(), false);
        int mode = activity.getWindow().getAttributes().softInputMode;
        activity.getWindow().setSoftInputMode(
            (mode & ~WindowManager.LayoutParams.SOFT_INPUT_MASK_ADJUST) |
            WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING
        );

        boolean debug = (activity.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebViewInsets handler = new WebViewInsets(webView, debug);
        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, insets) -> handler.apply(insets));
        if (debug) {
            webView.addOnLayoutChangeListener((view, l, t, r, b, oldL, oldT, oldR, oldB) -> {
                if (l != oldL || t != oldT || r != oldR || b != oldB) handler.scheduleSample();
            });
            Log.d(TAG, "installed sdk=" + Build.VERSION.SDK_INT +
                " decorFits=false softInput=adjustNothing; dimensions: native=px web=CSSpx");
        }
        // The WebView may not yet be attached during Activity.onCreate.
        webView.post(() -> ViewCompat.requestApplyInsets(webView));
    }

    private final WebView webView;
    private final boolean debug;
    private Insets safeInsets = Insets.NONE;
    private Insets imeInsets = Insets.NONE;
    private boolean imeVisible;
    private int sequence;
    private final Runnable sample = this::sampleViewport;

    private WebViewInsets(WebView webView, boolean debug) {
        this.webView = webView;
        this.debug = debug;
    }

    private WindowInsetsCompat apply(WindowInsetsCompat insets) {
        Insets safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
        Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
        boolean visible = insets.isVisible(WindowInsetsCompat.Type.ime());
        // Insets share the same window origin: union (max), never sum. This
        // also preserves cutouts/side navigation bars in landscape orientation.
        Insets margins = Insets.max(safe, ime);
        ViewGroup.MarginLayoutParams params = (ViewGroup.MarginLayoutParams) webView.getLayoutParams();
        boolean changed = params.leftMargin != margins.left || params.topMargin != margins.top ||
            params.rightMargin != margins.right || params.bottomMargin != margins.bottom;
        boolean insetsChanged = sequence == 0 || !safe.equals(safeInsets) ||
            !ime.equals(imeInsets) || visible != imeVisible;

        safeInsets = safe;
        imeInsets = ime;
        imeVisible = visible;
        if (insetsChanged) {
            sequence++;
            if (debug) Log.d(TAG, "insets seq=" + sequence + " imeVisible=" + visible +
                " safe=" + safe + " ime=" + ime + " margins=" + margins +
                " webViewBefore=" + webView.getHeight() + " parent=" + parentHeight());
        }
        if (changed) {
            params.setMargins(margins.left, margins.top, margins.right, margins.bottom);
            webView.setLayoutParams(params);
        }
        if (debug && (changed || insetsChanged)) scheduleSample();

        // Native margins have accounted for ALL these insets. Do not also let
        // WebView apply IME resizing or CSS safe-area padding for the same area.
        return WindowInsetsCompat.CONSUMED;
    }

    private int parentHeight() {
        return webView.getParent() instanceof View ? ((View) webView.getParent()).getHeight() : -1;
    }

    private void scheduleSample() {
        // Diagnostic only; never alters layout, focus, scroll or page state.
        webView.removeCallbacks(sample);
        webView.postDelayed(sample, 350);
    }

    private void sampleViewport() {
        if (!webView.isAttachedToWindow()) return;
        int sampleSequence = sequence;
        ViewGroup.MarginLayoutParams params = (ViewGroup.MarginLayoutParams) webView.getLayoutParams();
        String nativeMetrics = "viewport seq=" + sampleSequence + " imeVisible=" + imeVisible +
            " safe=" + safeInsets + " ime=" + imeInsets + " parent=" + parentHeight() +
            " webView=" + webView.getWidth() + "x" + webView.getHeight() +
            " margins=" + params.leftMargin + "," + params.topMargin + "," + params.rightMargin + "," + params.bottomMargin +
            " density=" + webView.getResources().getDisplayMetrics().density;
        // Only numeric viewport/rect dimensions and known modal IDs are read.
        // Never read input values, titles, URLs, notes or stored records.
        webView.evaluateJavascript(
            "(function(){var v=window.visualViewport,a=document.activeElement;" +
            "var m=['site-modal','group-modal'].map(function(id){return document.getElementById(id)})" +
            ".find(function(e){return e&&!e.classList.contains('hidden')});" +
            "function rect(e){if(!e)return null;var r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height}}" +
            "return {innerHeight:window.innerHeight,clientHeight:document.documentElement.clientHeight," +
            "visualHeight:v?v.height:null,visualTop:v?v.offsetTop:null,scale:v?v.scale:null,dpr:window.devicePixelRatio," +
            "modal:m?m.id:null,panel:rect(m?m.querySelector('.app-modal-panel'):null)," +
            "focusRect:rect(m&&m.contains(a)?a:null)}})()",
            result -> {
                // Do not label an async result with a superseded keyboard state.
                if (sampleSequence == sequence) Log.d(TAG, nativeMetrics + " web=" + result);
            }
        );
    }
}
