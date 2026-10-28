#!/bin/zsh
set -eu
cd -- "${0:A:h}"
if ! command -v node >/dev/null 2>&1; then
  for candidate in /usr/local/bin/node /opt/homebrew/bin/node; do
    if [[ -x "$candidate" ]]; then
      export PATH="${candidate:h}:$PATH"
      break
    fi
  done
fi
if ! command -v node >/dev/null 2>&1; then
  print '未找到 Node.js。请安装 Node.js 20 或更新的 LTS 版本后重试。'
  read '?按回车退出。'
  exit 1
fi
node bridge/server.mjs
