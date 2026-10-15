import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
// AutoUnpackNativesPlugin entfernt

const config: ForgeConfig = {
  packagerConfig: {
    name: 'fvtt-gateway',
    executableName: 'fvtt-gateway',
    appVersion: '2.3.0',
    asar: true,
  },
  rebuildConfig: {},
  makers: [
    new MakerZIP({}),
    new MakerDeb({ options: { productName: 'FoundryVTT Client', categories: ['Game'] } }),
    new MakerRpm({ options: { productName: 'FoundryVTT Client' } }),
    { name: 'electron-forge-maker-appimage', platforms: ['linux'], config: {} },
  ],
  plugins: [
    // AutoUnpackNativesPlugin entfernt
    new VitePlugin({
      build: [
        { entry: 'src/main.ts',    config: 'vite.main.config.ts' },
        { entry: 'src/preload.ts',          config: 'vite.preload.config.ts' },
        { entry: 'src/preload-foundry.ts',  config: 'vite.preload.config.ts' },
        { entry: 'src/preload-splitter.ts', config: 'vite.preload.config.ts' },
      ],
      renderer: [
        { name: 'main_window', config: 'vite.renderer.config.ts' },
      ],
    }),
  ],
};

export default config;
