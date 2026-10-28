// Preserve Adobe's own interactive terms confirmation and administrator dialog.
// Stage its shell helper in /private/tmp: elevated shells may not be permitted
// to read scripts inside macOS-protected Documents folders.
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(path.join(root, '.tooling/package.json'));
const helper = require('@adobe/uxp-devtools-helper');
const cliRoot = path.dirname(require.resolve('@adobe/uxp-devtools-cli/package.json'));
const { enableCommand } = require(path.join(cliRoot, 'src/cli/commands/devtools/DevToolsCmds.js'));
globalThis.UxpLogger = { log: console.log, verbose: console.log };
const folder = await mkdtemp('/private/tmp/ps-codex-adobe-');
try {
  await enableCommand.handler.call({ app: { server: {
    enableDevTools: () => helper.enableDevTools({ controlled: true, scriptsFolder: folder })
  } } });
} finally { await rm(folder, { recursive: true, force: true }); }
