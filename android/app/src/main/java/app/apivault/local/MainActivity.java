package app.apivault.local;

import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.os.Bundle;
import android.util.Log;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DocumentSaverPlugin.class);
        super.onCreate(savedInstanceState);
        traceTask("create");
    }

    // Debug-only task/lifecycle evidence for intermittent OEM / external-app
    // return behavior. No exported data, URLs or intent extras are logged.
    private void traceTask(String event) {
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            Log.d("ApiVaultTask", event + " task=" + getTaskId() +
                " root=" + isTaskRoot() + " finishing=" + isFinishing() +
                " configChange=" + isChangingConfigurations());
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        traceTask("resume");
    }

    @Override
    public void onStop() {
        super.onStop();
        traceTask("stop");
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        traceTask("newIntent");
    }
}
