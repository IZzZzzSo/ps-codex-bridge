import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_RUNTIME, JOB_ID } from './store.mjs';

async function main() {
  const [command, id, file] = process.argv.slice(2);
  if (!['list', 'prepare', 'queue', 'status'].includes(command) || (command !== 'list' && !JOB_ID.test(id || '')) || (command === 'prepare' && !file)) {
    throw new Error('用法：node bridge/cli.mjs list | status <任务编号> | prepare <任务编号> <结果文件> | queue <任务编号>');
  }
  const config = JSON.parse(await readFile(path.join(DEFAULT_RUNTIME, 'connection.json'), 'utf8'));
  async function request(endpoint, options = {}) {
    const response = await fetch(`http://127.0.0.1:${config.port}${endpoint}`, { ...options, headers: { Authorization: `Bearer ${config.token}`, ...options.headers }, signal: AbortSignal.timeout(90000) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
  }
  let result;
  if (command === 'list') result = await request('/v1/jobs');
  else if (command === 'status') result = await request(`/v1/jobs/${id}`);
  else if (command === 'prepare') {
    const bytes = await readFile(path.resolve(file));
    if (bytes.length > 32 * 1024 * 1024) throw new Error('结果文件不能超过 32 MB。');
    result = await request(`/v1/jobs/${id}/result`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
  } else {
    const { job } = await request(`/v1/jobs/${id}`);
    result = await request(`/v1/jobs/${id}/queue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: job.revision }) });
  }
  console.log(JSON.stringify(result, null, 2));
  if (command === 'prepare') console.log('结果已登记。可在 PS 面板点击“回传 PS”，或按用户要求运行 queue。');
  if (command === 'queue') console.log('已发出回传请求。保持 PS 插件面板打开；state=applied 才表示已写入 PS。');
}
main().catch(error => { console.error(error.cause?.code === 'ECONNREFUSED' ? '桥接程序未启动，请先双击“启动图像桥.command”。' : error.message); process.exitCode = 1; });
