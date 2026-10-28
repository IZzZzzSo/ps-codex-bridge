import { readFile, mkdir } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(root, '.tooling/node_modules/@adobe/uxp-devtools-cli/src/uxp.js');
const settingsPath = '/Library/Application Support/Adobe/UXP/Developer/settings.json';
const wait = process.argv.includes('--wait');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function enabled() {
  try { return JSON.parse(await readFile(settingsPath, 'utf8')).developer === true; } catch { return false; }
}
let ownsService = false, service;
async function command(args) {
  const result = await exec(process.execPath, [cli, ...args], { cwd: root, timeout: 20000, maxBuffer: 1024 * 1024 });
  if (/command failed|failed\.|error:/i.test(result.stdout + result.stderr)) throw new Error(result.stdout + result.stderr);
  return result.stdout;
}
async function main() {
  if (!await enabled()) {
    if (!wait) throw new Error('Adobe 开发模式尚未启用，请先运行“启用Adobe开发模式.command”，亲自完成 Adobe 条款与管理员确认。');
    console.log('等待 Adobe 官方授权完成（最多 3 分钟）…');
    const until = Date.now() + 180000;
    while (!await enabled()) {
      if (Date.now() > until) throw new Error('仍未收到开发模式授权。授权后运行 npm run dev 即可继续，不会修改你的 Photoshop 作品。');
      await delay(2000);
    }
  }
  await mkdir(path.join(root, 'runtime'), { recursive: true, mode: 0o700 });
  try { console.log(await command(['apps', 'list'])); }
  catch {
    // The enabled() guard above prevents Adobe's service command from silently
    // enabling development mode or accepting terms on the user's behalf.
    service = spawn(process.execPath, [cli, 'service', 'start'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    ownsService = true;
    service.stdout.on('data', data => process.stdout.write(data)); service.stderr.on('data', data => process.stderr.write(data));
    service.on('error', error => console.error(error.message));
    let connected = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      await delay(1500);
      try { console.log(await command(['apps', 'list'])); connected = true; break; } catch (e) { if (attempt === 2) throw e; }
    }
    if (!connected) throw new Error('未找到 Photoshop，请保持 Photoshop 打开后重试。');
  }
  console.log(await command(['plugin', 'load', '--manifest', path.join(root, 'plugin/manifest.json'), '--apps', 'PS']));
  console.log('插件已加载。打开 PS“增效工具 → PS ↔ Codex 图像桥”。此窗口保持打开，Ctrl+C 结束开发连接。');
  // Keep a successful user-owned development session alive even when another
  // developer service was already running.
  await new Promise(resolve => {
    const stop = () => { if (ownsService) service.kill('SIGTERM'); resolve(); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    if (ownsService) service.once('exit', resolve);
  });
}
main().catch(error => { if (ownsService) service.kill('SIGTERM'); console.error(error.message); process.exitCode = 1; });
