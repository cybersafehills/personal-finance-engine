import ExpoModulesCore
import ImageIO
import Vision

public class OneLedgerPosterModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OneLedgerPoster")

    AsyncFunction("recognize") { (uri: String) throws -> String in
      guard let url = URL(string: uri), url.isFileURL else {
        throw NSError(domain: "OneLedgerPoster", code: 1)
      }
      let path = url.resolvingSymlinksInPath().path
      let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        .resolvingSymlinksInPath().path + "/"
      guard path.hasPrefix(cache) else {
        throw NSError(domain: "OneLedgerPoster", code: 2)
      }
      defer { try? FileManager.default.removeItem(at: url) }

      let source = CGImageSourceCreateWithURL(url as CFURL, nil)
      let properties = source.flatMap { CGImageSourceCopyPropertiesAtIndex($0, 0, nil) } as? [CFString: Any]
      let orientation = CGImagePropertyOrientation(rawValue: (properties?[kCGImagePropertyOrientation] as? UInt32) ?? 1) ?? .up
      let request = VNRecognizeTextRequest()
      request.recognitionLevel = .accurate
      request.usesLanguageCorrection = false // Never spell-correct a payment identifier.
      try VNImageRequestHandler(url: url, orientation: orientation).perform([request])
      return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
    }
  }
}
