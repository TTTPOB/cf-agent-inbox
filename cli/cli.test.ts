import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { timeRange } from './time.ts';
import { InboxAPI, bodyText, safeFilename, saveDownload } from './api.ts';
import { loadConfig } from './config.ts';

const entry = fileURLToPath(new URL('./main.ts', import.meta.url));
async function mock(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  return { url: 'http://127.0.0.1:' + address.port, close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
async function cli(url: string, args: string[]) {
  const env = { ...process.env, HOME: fileURLToPath(new URL('./.mock-home', import.meta.url)), INBOX_URL: url, INBOX_MAILBOX: 'reader@example.com', CF_ACCESS_CLIENT_ID: 'test-service-id', CF_ACCESS_CLIENT_SECRET: 'test-secret', INBOX_CONFIG: undefined, INBOX_BASE_URL: undefined };
  const child = spawn(process.execPath, [entry, ...args], { env });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (chunk) => stdout += chunk);
  child.stderr.on('data', (chunk) => stderr += chunk);
  const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
  return { code, stdout, stderr };
}
function json(res: ServerResponse, data: unknown) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(data)); }

test('时间边界：本地日期、ISO偏移、since、互斥与非法日期', () => {
  const old = process.env.TZ;
  process.env.TZ = 'Asia/Shanghai';
  try {
    assert.deepEqual(timeRange({ after: '2026-04-01', before: '2026-04-02' }), { date_start: '2026-03-31T16:00:00.000Z', date_before: '2026-04-01T16:00:00.000Z' });
    assert.deepEqual(timeRange({ after: '2026-04-01T10:00:00+08:00' }), { date_start: '2026-04-01T02:00:00.000Z' });
    const now = new Date('2026-04-02T04:00:00Z');
    assert.deepEqual(timeRange({ today: true }, now), { date_start: '2026-04-01T16:00:00.000Z', date_before: '2026-04-02T16:00:00.000Z' });
    assert.deepEqual(timeRange({ yesterday: true }, now), { date_start: '2026-03-31T16:00:00.000Z', date_before: '2026-04-01T16:00:00.000Z' });
    assert.deepEqual(timeRange({ since: '24h' }, now), { date_start: '2026-04-01T04:00:00.000Z', date_before: now.toISOString() });
    assert.equal(timeRange({ since: '7d' }, now).date_start, '2026-03-26T04:00:00.000Z');
    for (const value of [{ today: true, yesterday: true }, { since: '7d', after: '2026-01-01' }, { after: '2026-02-30' }, { after: '2026-01-02', before: '2026-01-02' }, { since: '0h' }, { after: 'tomorrow' }]) assert.throws(() => timeRange(value));
  } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; }
});

test('夏令时按本地日历，不硬编码24小时', () => {
  const old = process.env.TZ; process.env.TZ = 'America/New_York';
  try {
    const range = timeRange({ today: true }, new Date('2026-03-08T16:00:00Z'));
    assert.equal(range.date_start, '2026-03-08T05:00:00.000Z');
    assert.equal(range.date_before, '2026-03-09T04:00:00.000Z');
  } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; }
});

test('list/search URL、Service Auth与稳定JSON，列表不含正文', async () => {
  const requests: URL[] = [];
  const server = await mock((req, res) => {
    requests.push(new URL(req.url!, 'http://localhost'));
    assert.equal(req.headers['cf-access-client-id'], 'test-service-id');
    assert.equal(req.headers['cf-access-client-secret'], 'test-secret');
    const emails = [{ id: 'm1', sender: 'sender@example.com', subject: '测试', body: 'private body', body_text: 'private body' }];
    json(res, requests.length === 1 ? emails : { emails, totalCount: 12 });
  });
  try {
    const list = await cli(server.url, ['list', '--after', '2026-04-01T00:00:00Z', '--before', '2026-04-02T00:00:00Z', '--page', '2', '--limit', '3', '--json']);
    assert.equal(list.code, 0); assert.equal(list.stderr, '');
    const data = JSON.parse(list.stdout); assert.equal(data.totalCount, null); assert.equal(data.emails.length, 1);
    assert(!list.stdout.includes('private body')); assert(!('body' in data.emails[0]));
    assert.equal(requests[0].pathname, '/api/v1/mailboxes/reader%40example.com/emails');
    assert.equal(requests[0].searchParams.get('folder'), 'Inbox');
    assert.equal(requests[0].searchParams.get('date_start'), '2026-04-01T00:00:00.000Z');
    assert.equal(requests[0].searchParams.get('date_before'), '2026-04-02T00:00:00.000Z');
    assert.equal(requests[0].searchParams.get('page'), '2'); assert.equal(requests[0].searchParams.get('limit'), '3');
    const search = await cli(server.url, ['search', 'literal from:word', '--from', 'sender@example.com', '--has-attachment', '--after', '2026-04-01T00:00:00Z', '--before', '2026-04-02T00:00:00Z', '--json']);
    assert.equal(search.code, 0); assert.equal(JSON.parse(search.stdout).totalCount, 12);
    assert.equal(requests[1].pathname.endsWith('/search'), true);
    assert.equal(requests[1].searchParams.get('query'), 'literal from:word');
    assert.equal(requests[1].searchParams.get('from'), 'sender@example.com');
    assert.equal(requests[1].searchParams.get('has_attachment'), 'true');
    assert.equal(requests[1].searchParams.get('date_before'), '2026-04-02T00:00:00.000Z');
    assert(!requests[1].searchParams.has('folder'));
  } finally { await server.close(); }
});

test('详情纯文本优先、HTML fallback 与附件列表来源', async () => {
  assert.equal(bodyText({ id: 'm', body_text: '', body_html: '<p>ignored</p>' }), '');
  assert.equal(bodyText({ id: 'm', body_html: '<style>bad</style><p>Hello &amp; &#x4e2d;</p><script>bad</script>' }), 'Hello & 中');
  const server = await mock((_req, res) => json(res, { id: 'm', body_html: '<p>hello</p>', attachments: [{ id: 'a', filename: 'one.txt', mimetype: 'text/plain', size: 3 }] }));
  try {
    const show = await cli(server.url, ['show', 'm', '--json']); assert.equal(JSON.parse(show.stdout).body_text, 'hello');
    const attachments = await cli(server.url, ['attachments', 'm', '--json']); assert.equal(JSON.parse(attachments.stdout).attachments[0].id, 'a');
    const doctor = await cli(server.url, ['doctor', '--json']); const identity = JSON.parse(doctor.stdout);
    assert.equal(identity.ok, true); assert.equal(identity.baseURL, server.url); assert.equal(identity.mailbox, 'reader@example.com');
    assert(!doctor.stdout.includes('test-secret'));
    const overridden = await cli(server.url, ['doctor', '--mailbox', 'other@example.com', '--json']);
    assert.equal(JSON.parse(overridden.stdout).mailbox, 'other@example.com');
  } finally { await server.close(); }
});

test('下载流式完成、重名拒绝、中断清理、文件名净化', async () => {
  const dir = await mkdtemp(join(fileURLToPath(new URL('.', import.meta.url)), '.test-'));
  const server = await mock((req, res) => {
    res.setHeader('content-type', 'application/octet-stream');
    if (req.url?.endsWith('/broken')) { res.setHeader('content-length', '100000'); res.write('partial'); setImmediate(() => res.destroy()); }
    else res.end('complete');
  });
  try {
    const api = new InboxAPI({ baseURL: server.url, mailbox: 'reader@example.com' });
    const target = join(dir, 'file');
    await saveDownload(api, '/good', target); assert.equal(await readFile(target, 'utf8'), 'complete');
    await assert.rejects(saveDownload(api, '/good', target), /拒绝覆盖/);
    assert.equal(await readFile(target, 'utf8'), 'complete');
    await assert.rejects(saveDownload(api, '/broken', join(dir, 'broken')));
    assert.deepEqual(await readdir(dir), ['file']);
    assert.equal(safeFilename('../../x\\y\u0000.txt'), '_.._x_y_.txt');
    assert.equal(safeFilename('..'), 'attachment');
  } finally { await server.close(); await rm(dir, { recursive: true, force: true }); }
});

test('export原始EML、download --all、重复净化名拒绝', async () => {
  const dir = await mkdtemp(join(fileURLToPath(new URL('.', import.meta.url)), '.test-'));
  let collision = false;
  const server = await mock((req, res) => {
    if (req.url?.endsWith('/raw')) { res.setHeader('content-type', 'message/rfc822'); res.end('From: sender@example.com\r\n\r\noriginal'); }
    else if (req.url?.includes('/attachments/')) { res.setHeader('content-type', 'text/plain'); res.end('one'); }
    else json(res, { id: 'm', attachments: [{ id: 'a', filename: 'one.txt', mimetype: 'text/plain', size: 3 }, ...(collision ? [{ id: 'b', filename: 'one.txt', mimetype: 'text/plain', size: 3 }] : [])] });
  });
  try {
    const exported = await cli(server.url, ['export', 'm', '--dir', dir, '--json']); assert.equal(exported.code, 0);
    assert.equal(await readFile(join(dir, 'm.eml'), 'utf8'), 'From: sender@example.com\r\n\r\noriginal');
    const download = await cli(server.url, ['download', 'm', '--all', '--dir', dir, '--json']); assert.equal(download.code, 0);
    assert.equal(JSON.parse(download.stdout).files.length, 1);
    collision = true;
    const duplicate = await cli(server.url, ['download', 'm', '--all', '--dir', dir, '--json']); assert.equal(duplicate.code, 1); assert.match(duplicate.stderr, /重名/); assert.equal(duplicate.stdout, '');
  } finally { await server.close(); await rm(dir, { recursive: true, force: true }); }
});

test('认证失败与HTML登录页不泄漏secret、拒绝跨源重定向', async () => {
  const dir = await mkdtemp(join(fileURLToPath(new URL('.', import.meta.url)), '.test-'));
  let mode = 'auth'; let reached = false;
  const destination = await mock((_req, res) => { reached = true; res.end('bad'); });
  const server = await mock((_req, res) => {
    if (mode === 'auth') { res.statusCode = 403; res.end('test-secret'); }
    else if (mode === 'redirect') { res.statusCode = 302; res.setHeader('location', destination.url); res.end(); }
    else { res.setHeader('content-type', mode === 'sniff' ? 'application/octet-stream' : 'text/html'); res.end('<html><form>Cloudflare Access /cdn-cgi/access/login test-secret</form></html>'); }
  });
  try {
    const denied = await cli(server.url, ['list', '--json']); assert.equal(denied.code, 1); assert.equal(denied.stdout, ''); assert.match(denied.stderr, /认证失败/); assert(!denied.stderr.includes('test-secret'));
    const api = new InboxAPI({ baseURL: server.url, mailbox: 'reader@example.com', accessClientId: 'test-id', accessClientSecret: 'test-secret' });
    mode = 'redirect'; await assert.rejects(saveDownload(api, '/raw', join(dir, 'redirect')), /拒绝重定向/); assert.equal(reached, false);
    mode = 'html'; await assert.rejects(saveDownload(api, '/raw', join(dir, 'html')), /HTML/);
    const htmlJSON = await cli(server.url, ['list', '--json']); assert.equal(htmlJSON.code, 1); assert.equal(htmlJSON.stdout, ''); assert(!htmlJSON.stderr.includes('test-secret'));
    mode = 'sniff'; await assert.rejects(saveDownload(api, '/raw', join(dir, 'sniff')), /Access 登录页/);
    assert.deepEqual(await readdir(dir), []);
  } finally { await server.close(); await destination.close(); await rm(dir, { recursive: true, force: true }); }
});

test('0600配置、环境覆盖、凭据成对及参数冲突', async () => {
  const dir = await mkdtemp(join(fileURLToPath(new URL('.', import.meta.url)), '.test-'));
  const path = join(dir, 'config.json');
  try {
    await writeFile(path, JSON.stringify({ baseURL: 'https://inbox.example.com', mailbox: 'reader@example.com', accessClientId: 'id', accessClientSecret: 'placeholder' }), { mode: 0o600 });
    const config = await loadConfig({ config: path }, { INBOX_URL: 'https://override.example.com' }); assert.equal(config.baseURL, 'https://override.example.com');
    await chmod(path, 0o644); await assert.rejects(loadConfig({ config: path }, {}), /0600/);
    await chmod(path, 0o600);
    await assert.rejects(loadConfig({ config: path }, { INBOX_URL: 'https://inbox.example.com', INBOX_MAILBOX: 'reader@example.com', CF_ACCESS_CLIENT_ID: 'id', CF_ACCESS_CLIENT_SECRET: '' }), /成对/);
    for (const args of [['list', '--today', '--since', '7d'], ['list', '--after', '2026-01-01', '--after', '2026-01-02'], ['send'], ['download', 'm', '--all', 'a']]) {
      const result = await cli('http://127.0.0.1:1', args); assert.equal(result.code, 1); assert.equal(result.stdout, '');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
