import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.apivault.local',
  appName: 'API Vault',
  webDir: 'dist',
  bundledWebRuntime: false,
  // MainActivity owns system-bar/cutout/IME insets on Android 15+.
  // Android <=14 keeps platform adjustResize. Do not enable a second owner.
  android: { adjustMarginsForEdgeToEdge: 'disable' },
  plugins: {
    CapacitorHttp: { enabled: false }
  }
};

export default config;
