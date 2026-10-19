import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run } from './main.ts';

const entry = fileURLToPath(new URL('./main.ts', import.meta.url));
const commands = ['doctor', 'list', 'search', 'show', 'attachments', 'download', 'export', 'help'];
const topics = ['config', 'time', 'json'];

test('全部命令与专题帮助离线运行，不加载配置或触发 fetch', async () => {
  const fetch = globalThis.fetch;
  const config = process.env.INBOX_CONFIG;
  process.env.INBOX_CONFIG = fileURLToPath(new URL('./.missing-offline-config.json', import.meta.url));
  globalThis.fetch = async () => { throw new Error('帮助不应触发网络'); };
  try {
    const text = async (args: string[]) => {
      const outputs: string[] = [];
      await run(args, (line) => outputs.push(line));
      assert.equal(outputs.length, 1);
      assert(outputs[0].length > 100);
      return outputs[0];
    };
    const global = await text(['--help']);
    assert.equal(await text(['help']), global);
    assert.equal(await text([]), global);
    assert.match(global, /inbox help config/);
    for (const command of commands) {
      const named = await text(['help', command]);
      assert.equal(await text([command, '--help']), named);
      assert.equal(await text([command, '-h']), named);
      assert.match(named, new RegExp('inbox ' + command));
      assert.match(named, /示例/);
    }
    for (const topic of topics) assert.match(await text(['help', topic]), /示例|例如|JSON/);
    assert.equal(await text(['search', '--help', '--json']), await text(['help', 'search']));
  } finally {
    globalThis.fetch = fetch;
    if (config === undefined) delete process.env.INBOX_CONFIG; else process.env.INBOX_CONFIG = config;
  }
});

test('帮助覆盖时间、分页、JSON、下载及 Service Auth 实际语义', async () => {
  const text = async (topic: string) => { let value = ''; await run(['help', topic], (output) => value = output); return value; };
  for (const topic of ['list', 'search']) {
    const page = await text(topic);
    for (const option of ['--after', '--before', '--since', '--today', '--yesterday', '--page', '--limit', '--json', '--base-url', '--mailbox', '--config']) assert(page.includes(option));
    assert.match(page, /收件时间/); assert.match(page, /本地时区/); assert.match(page, /start, end/);
    assert.match(page, /date_start（含）\/date_before（不含）/); assert.match(page, /不自动翻页/); assert.match(page, /totalCount/);
  }
  const search = await text('search');
  for (const option of ['--query', '--from', '--to', '--subject', '--has-attachment']) assert(search.includes(option));
  assert.match(search, /不实现 Gmail DSL/);
  const download = await text('download');
  for (const phrase of ['--all', '--output', '--dir', '重名', '部分成功', '保留', '清理', '非 0', '拒绝覆盖', 'rename']) assert(download.includes(phrase));
  assert.match(await text('export'), /RFC822/);
  const config = await text('config');
  for (const phrase of ['INBOX_URL', 'INBOX_MAILBOX', 'CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET', '0600', '成对', 'Service Auth', 'example.com']) assert(config.includes(phrase));
  assert.match(await text('json'), /stderr/);
});

test('帮助进程无需认证，未知主题与多余主题非零且不泄漏参数', () => {
  const env = { PATH: process.env.PATH, HOME: fileURLToPath(new URL('./.offline-home', import.meta.url)), INBOX_CONFIG: fileURLToPath(new URL('./.missing-offline-config.json', import.meta.url)) };
  for (const args of [['--help'], ['help'], ['help', 'search'], ['search', '--help'], ['help', 'config']]) {
    const result = spawnSync(process.execPath, [entry, ...args], { env, encoding: 'utf8' });
    assert.equal(result.status, 0); assert.equal(result.stderr, ''); assert(result.stdout.length > 100);
  }
  for (const args of [['help', 'unknown-placeholder'], ['unknown-placeholder', '--help'], ['help', 'list', 'search']]) {
    const result = spawnSync(process.execPath, [entry, ...args], { env, encoding: 'utf8' });
    assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.match(result.stderr, /错误/); assert(!result.stderr.includes('unknown-placeholder'));
  }
});

test('可安装 skill 具有标准目录与 frontmatter，仅引导 CLI 帮助', async () => {
  const content = await readFile(new URL('../skills/cf-agent-inbox/SKILL.md', import.meta.url), 'utf8');
  assert.match(content, /^---\nname: cf-agent-inbox\ndescription: .+\n---\n/);
  assert.match(content, /inbox --help/);
  assert.match(content, /inbox help <命令>/);
  assert(!content.includes('--after')); assert(!content.includes('--before')); assert(!content.includes('--has-attachment'));
});
