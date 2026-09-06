package me.oneledger.companion.scan

import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage

/**
 * CameraX analyzer that reports the raw value of the first QR code it sees.
 * QR-only (ignores 1-D barcodes). Fires [onQr] at most once — the caller stops
 * the camera on the first hit. Uses `ImageProxy.toBitmap()` (stable since
 * CameraX 1.3) so no experimental opt-in is needed.
 */
class QrAnalyzer(private val onQr: (String) -> Unit) : ImageAnalysis.Analyzer {

    private val scanner = BarcodeScanning.getClient(
        BarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
            .build(),
    )

    @Volatile
    private var done = false

    override fun analyze(imageProxy: ImageProxy) {
        if (done) {
            imageProxy.close()
            return
        }
        val bitmap = runCatching { imageProxy.toBitmap() }.getOrNull()
        if (bitmap == null) {
            imageProxy.close()
            return
        }
        val input = InputImage.fromBitmap(bitmap, imageProxy.imageInfo.rotationDegrees)
        scanner.process(input)
            .addOnSuccessListener { barcodes ->
                val value = barcodes.firstOrNull()?.rawValue
                if (!value.isNullOrBlank() && !done) {
                    done = true
                    onQr(value)
                }
            }
            .addOnCompleteListener { imageProxy.close() }
    }
}
