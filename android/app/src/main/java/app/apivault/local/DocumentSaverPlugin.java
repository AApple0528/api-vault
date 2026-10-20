package app.apivault.local;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;

/** A user-selected document destination, independent of the Share plugin. */
@CapacitorPlugin(name = "DocumentSaver")
public class DocumentSaverPlugin extends Plugin {
    private final AtomicBoolean saving = new AtomicBoolean(false);

    @PluginMethod
    public void save(PluginCall call) {
        String filename = call.getString("filename");
        String mime = call.getString("mime", "").split(";")[0];
        if (filename == null || filename.contains("/") || filename.contains("\\") ||
            call.getString("content") == null ||
            !(mime.equals("application/json") && filename.endsWith(".json") ||
              mime.equals("text/markdown") && filename.endsWith(".md"))) {
            call.reject("Invalid export document", "INVALID_DOCUMENT");
            return;
        }
        if (!saving.compareAndSet(false, true)) {
            call.reject("A document save is already in progress", "SAVE_BUSY");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime);
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        getActivity().runOnUiThread(() -> {
            try {
                // No NEW_TASK, CLEAR_TASK, or share fallback. The system picker
                // owns naming/collision handling; no storage permission needed.
                startActivityForResult(call, intent, "documentCreated");
            } catch (Exception error) {
                saving.set(false);
                call.reject("Could not open the document picker", "PICKER_FAILED", error);
            }
        });
    }

    @ActivityCallback
    private void documentCreated(PluginCall call, ActivityResult result) {
        if (call == null) {
            saving.set(false);
            return;
        }
        if (result.getResultCode() == Activity.RESULT_CANCELED) {
            saving.set(false);
            JSObject response = new JSObject();
            response.put("cancelled", true);
            call.resolve(response);
            return;
        }
        Intent data = result.getData();
        Uri uri = data == null ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null ||
            !"content".equals(uri.getScheme())) {
            saving.set(false);
            call.reject("The document provider returned no writable document", "NO_DOCUMENT");
            return;
        }
        execute(() -> {
            try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                if (output == null) throw new IOException("No output stream");
                output.write(call.getString("content", "").getBytes(StandardCharsets.UTF_8));
                output.flush();
            } catch (Exception error) {
                saving.set(false);
                call.reject("Could not write the selected document", "WRITE_FAILED", error);
                return;
            }
            saving.set(false);
            JSObject response = new JSObject();
            response.put("cancelled", false);
            call.resolve(response);
        });
    }
}
