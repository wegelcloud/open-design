// @ts-nocheck
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createCommandInvocation } from '@open-design/platform';

const execFileP = promisify(execFile);

export function execAgentFile(command, args, options = {}) {
  const invocation = createCommandInvocation({
    command,
    args,
    env: options.env,
  });
  return execFileP(invocation.command, invocation.args, {
    ...options,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
  });
}
