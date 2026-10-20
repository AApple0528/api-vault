import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.apivault.local',
  appName: 'API Vault',
  webDir: 'dist',
  bundledWebRuntime: false,
  // Apply system-bar/cutout margins once, on Android versions enforcing E2E.
  // Consumed native insets must not be added again as CSS safe-area padding.
  android: { adjustMarginsForEdgeToEdge: 'auto' },
  plugins: {
    CapacitorHttp: { enabled: false }
  }
};

export default config;
