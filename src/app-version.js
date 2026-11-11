import packageInfo from '../package.json' with { type: 'json' };

export const APP_VERSION = String(packageInfo.version);
export const APP_VERSION_LABEL = `v${APP_VERSION}`;
export const ANDROID_VERSION_CODE = Number(packageInfo.androidVersionCode);
