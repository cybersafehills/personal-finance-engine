import * as Crypto from "expo-crypto";

/** A fresh random UUID for an operation or a device-created record. */
export function getNewId(): string {
  return Crypto.randomUUID();
}
