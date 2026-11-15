import { existsSync } from "node:fs";

import type { ConfigContext, ExpoConfig } from "expo/config";

// app.json holds the static config; this adds the one value that must not be
// committed: Firebase's google-services.json (Android push, docs/mobile-push.md).
//
//   - EAS cloud builds: store the file as an EAS file variable named
//     GOOGLE_SERVICES_JSON; EAS sets the variable to the file's path.
//   - Local runs: a git-ignored ./google-services.json is picked up if present.
//   - Neither: the field is omitted and everything else builds exactly as
//     before (the app just cannot get an Android push token yet).
export default ({ config }: ConfigContext): ExpoConfig => {
  const googleServicesFile =
    process.env.GOOGLE_SERVICES_JSON ??
    (existsSync("./google-services.json") ? "./google-services.json" : undefined);

  return {
    ...(config as ExpoConfig),
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  };
};
