import { access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tooling = path.join(root, '.tooling');
const native = path.join(tooling, 'node_modules/@adobe/uxp-devtools-helper/build/Release/node-napi.node');
try { await access(native); console.log('Adobe 项目内开发工具已就绪。'); }
catch {
  console.log('正在安装 Adobe 官方开发工具到本项目（不全局安装）…');
  execFileSync('npm', ['install', '--prefix', tooling, '--ignore-scripts', '--no-audit', '--no-fund', '@adobe/uxp-devtools-cli@1.2.0', 'tar@7'], { cwd: root, stdio: 'inherit' });
  execFileSync(process.execPath, [path.join(tooling, 'node_modules/@adobe/uxp-devtools-helper/scripts/devtools_setup.js')], { cwd: root, stdio: 'inherit' });
}
