import { requireOptionalNativeModule } from "expo";

type PosterModule = { recognize(uri: string): Promise<string> };
const native = requireOptionalNativeModule<PosterModule>("OneLedgerPoster");

export const canReadPoster = native !== null;

// The native module reads and deletes the temporary camera file, including
// on recognition failure. Photos and OCR text are never sent to the API.
export async function recognizePoster(uri: string): Promise<string> {
  if (!native) throw new Error("Poster recognition requires a native build.");
  return native.recognize(uri);
}
