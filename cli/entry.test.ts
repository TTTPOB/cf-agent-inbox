import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('符号链接入口仍可执行', async () => {
  const dir = await mkdtemp(join(fileURLToPath(new URL('.', import.meta.url)), '.test-'));
  try {
    const link = join(dir, 'inbox');
    await symlink(fileURLToPath(new URL('./main.ts', import.meta.url)), link);
    const result = spawnSync(process.execPath, [link, '--help'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /只读收件 CLI/);
    assert.equal(result.stderr, '');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
