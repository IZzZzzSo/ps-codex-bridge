export function destination(value) {
  if (value == null) return { mode: 'new', projectPath: '' };
  if (!value || typeof value !== 'object' || !['new', 'existing'].includes(value.mode)) throw new Error('请选择有效的对话目标。');
  if (value.mode === 'existing') {
    const input = String(value.thread || '').trim();
    if (input.includes('...') || input.includes('…')) throw new Error('对话链接含省略号，内容不完整。请在目标 Codex 对话复制完整链接，不能使用缩略显示的地址。');
    const match = /^(?:codex:\/\/threads\/)?([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.exec(input);
    if (!match) throw new Error('请粘贴 codex://threads/ 开头的本地对话链接或完整对话 ID。');
    return { mode: 'existing', thread: match[1].toLowerCase() };
  }
  const projectPath = String(value.projectPath || '').trim();
  if (projectPath && (!projectPath.startsWith('/') || /[\x00-\x1f]/.test(projectPath) || projectPath.length > 4096)) throw new Error('项目工作目录必须是本机绝对路径。');
  return { mode: 'new', projectPath };
}
