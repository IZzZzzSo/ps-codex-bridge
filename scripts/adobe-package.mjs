// Adobe's package implementation supports offline packaging. Calling package()
// performs its packaging validations, without pretending the PS host validated it.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(path.join(root, '.tooling', 'package.json'));
const packagePath = path.join(path.dirname(require.resolve('@adobe/uxp-devtools-core/package.json')), 'src/core/client/plugin/actions/PluginPackageCommand.js');
const PackageCommand = require(packagePath);
globalThis.UxpLogger = console;
await mkdir(path.join(root, 'dist'), { recursive: true });
const command = new PackageCommand(null, { manifest: path.join(root, 'plugin/manifest.json'), packageDir: path.join(root, 'dist'), apps: ['PS'] });
const results = await command.package();
console.log(command.consolidateResult(command.getFailCount(results), results.length));
console.log('由 Adobe 官方打包实现生成；当前未通过 Photoshop 连接进行严格清单验证。');
