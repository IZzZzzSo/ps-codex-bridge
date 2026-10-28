import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
for (const folder of ['bridge', 'plugin', 'scripts', 'tests']) {
  for (const file of readdirSync(path.join(root, folder))) if (/\.(m?js)$/.test(file)) execFileSync(process.execPath, ['--check', path.join(root, folder, file)], { stdio: 'inherit' });
}
const manifest = JSON.parse(readFileSync(path.join(root, 'plugin/manifest.json'), 'utf8'));
if (manifest.manifestVersion !== 5 || manifest.host.app !== 'PS' || manifest.host.data.apiVersion !== 2) throw new Error('Manifest 格式不符合预期。');
if (manifest.requiredPermissions.network.domains.some(domain => !/^http:\/\/(127\.0\.0\.1|localhost):17321$/.test(domain))) throw new Error('网络权限范围不正确。');
console.log('JavaScript 语法与插件清单检查通过。');
