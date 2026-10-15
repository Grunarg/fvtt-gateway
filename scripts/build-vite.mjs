// Baut nur die Vite-Bundles nach .vite/ (Main, Preloads, Renderer) – mit exakt der
// Konfiguration aus forge.config.ts, aber ohne Forge-Packaging. electron-builder packt
// anschließend direkt .vite/; das Forge-Packaging (das im postPackage-Hook hängt) ist unnötig.

import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'vite';

const require = createRequire(import.meta.url);
const findConfig = require('@electron-forge/core/dist/util/forge-config').default;

const projectDir = path.resolve(import.meta.dirname, '..');
const forgeConfig = await findConfig(projectDir);
const vitePlugin = forgeConfig.plugins.find(p => p?.name === 'vite');
if (!vitePlugin) throw new Error('Kein Vite-Plugin in forge.config.ts gefunden');

vitePlugin.isProd = true;
vitePlugin.setDirectories(projectDir);
const generator = vitePlugin.configGenerator;

await fs.rm(path.join(projectDir, '.vite'), { recursive: true, force: true });

const configs = [...await generator.getBuildConfigs(), ...await generator.getRendererConfig()];
for (const config of configs) {
  await build({ configFile: false, logLevel: 'warn', ...config });
}
console.log(`✔ ${configs.length} Vite-Bundles nach .vite/ gebaut`);
