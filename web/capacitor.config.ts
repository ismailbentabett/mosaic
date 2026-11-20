import type { CapacitorConfig } from '@capacitor/cli';

// The Android app bundles the demo build (in-app mock backend), so it runs fully offline.
const config: CapacitorConfig = {
  appId: 'io.github.ismailbentabett.mosaic',
  appName: 'Mosaic',
  webDir: 'dist-native',
  server: { androidScheme: 'https', cleartext: false },
  android: { allowMixedContent: false },
};

export default config;
