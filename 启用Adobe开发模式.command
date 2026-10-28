#!/bin/zsh
set -eu
cd -- "${0:A:h}"
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
print '此窗口运行 Adobe 官方开发工具。请自行阅读 Adobe 条款并决定是否继续。'
print '继续后，macOS 可能要求管理员确认；密码只输入到系统窗口中。'
node scripts/setup-tooling.mjs
node scripts/enable-adobe.mjs
print '\nAdobe 开发模式操作已结束。请保留 Photoshop 打开。'
node scripts/dev.mjs
read '?按回车关闭窗口。'
