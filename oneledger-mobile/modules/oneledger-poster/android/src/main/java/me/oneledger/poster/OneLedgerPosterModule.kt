package me.oneledger.poster

import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class OneLedgerPosterModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("OneLedgerPoster")

    AsyncFunction("recognize") { uri: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("ERR_POSTER", "Camera context unavailable", null)
        return@AsyncFunction
      }
      // Only consume a camera cache file; never arbitrary paths or remote URLs.
      val parsed = Uri.parse(uri)
      val file = if (parsed.scheme == "file") parsed.path?.let { File(it).canonicalFile } else null
      val cache = context.cacheDir.canonicalFile
      if (file == null || !file.path.startsWith(cache.path + File.separator)) {
        promise.reject("ERR_POSTER", "Expected a temporary camera photo", null)
        return@AsyncFunction
      }
      val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
      try {
        val image = InputImage.fromFilePath(context, parsed)
        recognizer.process(image)
          .addOnCompleteListener { task ->
            recognizer.close()
            file.delete()
            if (task.isSuccessful) promise.resolve(task.result.text)
            else promise.reject("ERR_POSTER", "Could not read poster", task.exception)
          }
      } catch (error: Exception) {
        recognizer.close()
        file.delete()
        promise.reject("ERR_POSTER", "Could not read poster", error)
      }
    }
  }
}
