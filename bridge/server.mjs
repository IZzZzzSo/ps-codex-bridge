import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Store, DEFAULT_RUNTIME } from './store.mjs';

const JSON_LIMIT = 110 * 1024 * 1024, IMAGE_LIMIT = 32 * 1024 * 1024;
async function readBody(req, limit) {
  const chunks = []; let length = 0;
  for await (const part of req) {
    length += part.length;
    if (length > limit) { const e = new Error('上传内容过大。'); e.status = 413; throw e; }
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}
function authorized(req, token) {
  const a = Buffer.from(req.headers.authorization || ''), b = Buffer.from('Bearer ' + token);
  return a.length === b.length && timingSafeEqual(a, b);
}
function send(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}
export async function createServer({ runtime = DEFAULT_RUNTIME, port = 17321 } = {}) {
  const store = new Store(runtime); await store.init(port);
  const server = http.createServer(async (req, res) => {
    try {
      // Bind to loopback and reject DNS rebinding. No browser CORS permission is granted.
      const expectedHost = `127.0.0.1:${server.address().port}`;
      if (req.headers.host !== expectedHost && req.headers.host !== `localhost:${server.address().port}`) return send(res, 403, { error: '只接受本机连接。' });
      const url = new URL(req.url, `http://${expectedHost}`);
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { service: 'ps-codex-bridge', version: '0.1.0' });
      if (!authorized(req, store.config.token)) return send(res, 401, { error: '配对码不正确，请在插件中重新连接。' });
      if (req.method === 'GET' && url.pathname === '/v1/jobs') return send(res, 200, { jobs: await store.list() });
      if (req.method === 'POST' && url.pathname === '/v1/jobs') {
        const job = await store.create(JSON.parse((await readBody(req, JSON_LIMIT)).toString('utf8')));
        return send(res, 201, { job, desktopLink: store.desktopLink(job) });
      }
      const match = /^\/v1\/jobs\/([a-f0-9-]{36})(?:\/(desktop|result|pixels|queue|claim|complete|fail))?$/.exec(url.pathname);
      if (!match) return send(res, 404, { error: '接口不存在。' });
      const [, id, action] = match;
      if (req.method === 'GET') {
        const job = await store.get(id);
        if (!action) return send(res, 200, { job });
        if (action === 'desktop') return send(res, 200, { desktopLink: store.desktopLink(job) });
        if (action === 'pixels') {
          if (!job.revision || !['ready', 'queued', 'applying', 'applied'].includes(job.state)) throw new Error('结果尚未就绪。');
          const pixels = await readFile(path.join(store.dir(id), `result-${job.revision}.rgba`));
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Length': pixels.length, 'X-Content-Type-Options': 'nosniff' });
          return res.end(pixels);
        }
      }
      if (req.method === 'POST' && action === 'result') {
        const bytes = await readBody(req, IMAGE_LIMIT);
        const job = await store.prepare(id, bytes); return send(res, 200, { job });
      }
      if (req.method === 'POST' && ['queue', 'claim', 'complete', 'fail'].includes(action)) {
        const body = JSON.parse((await readBody(req, 8192)).toString('utf8'));
        return send(res, 200, { job: await store.transition(id, action, body) });
      }
      send(res, 404, { error: '接口不存在。' });
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      const status = error.status || (error.code === 'ENOENT' ? 404 : error instanceof SyntaxError ? 400 : 409);
      const message = error.code === 'ENOENT' ? '任务或结果文件不存在。' : error.message;
      send(res, status, { error: message });
    }
  });
  server.requestTimeout = 120000;
  server.headersTimeout = 15000;
  return { server, store };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { server, store } = await createServer();
  server.on('error', e => {
    console.error(e.code === 'EADDRINUSE' ? '端口 17321 已在使用。请检查是否已启动图像桥。' : e.message); process.exitCode = 1;
  });
  server.listen(17321, '127.0.0.1', () => {
    console.log('\nPS ↔ Codex 图像桥 0.1\n');
    console.log('本机地址：http://127.0.0.1:17321');
    console.log('配对码：' + store.config.token);
    console.log('任务目录：' + store.runtime);
    console.log('\n将配对码粘贴到 PS 插件中。使用期间保持此窗口打开。按 Ctrl+C 停止。\n');
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
