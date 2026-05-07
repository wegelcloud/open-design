import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = join(packageRoot, 'dist', 'cli.js');

describe('research CLI', () => {
  it('preserves query values equal to the search subcommand', async () => {
    let requestBody: unknown = null;
    const server = createServer((req, res) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        requestBody = JSON.parse(body);
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            query: 'search',
            summary: 'ok',
            sources: [],
            provider: 'tavily',
            depth: 'shallow',
            fetchedAt: 1,
          }),
        );
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('missing server address');
      const { stdout, stderr } = await execFileAsync(process.execPath, [
        cliPath,
        'research',
        'search',
        '--query',
        'search',
        '--daemon-url',
        `http://127.0.0.1:${address.port}`,
      ]);

      expect(stderr).toBe('');
      expect(requestBody).toMatchObject({ query: 'search' });
      expect(JSON.parse(stdout)).toMatchObject({ query: 'search', provider: 'tavily' });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
