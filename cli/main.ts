#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { InboxAPI, bodyText, safeFilename, saveDownload } from './api.ts';
import { loadConfig } from './config.ts';
import { timeRange } from './time.ts';
import { helpText } from './help.ts';

function clean(value: unknown): string {
  return String(value ?? '').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '').replace(/\r/g, '');
}
function cell(value: unknown): string { return clean(value).replace(/\n|\t/g, ' '); }

export async function run(args: string[], output: (value: string) => void = (value) => process.stdout.write(value + '\n')): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({ args, allowPositionals: true, tokens: true, options: {
      help: { type: 'boolean', short: 'h' }, json: { type: 'boolean' },
      config: { type: 'string' }, 'base-url': { type: 'string' }, mailbox: { type: 'string' },
      after: { type: 'string' }, before: { type: 'string' }, since: { type: 'string' }, today: { type: 'boolean' }, yesterday: { type: 'boolean' },
      page: { type: 'string' }, limit: { type: 'string' }, query: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, subject: { type: 'string' }, 'has-attachment': { type: 'boolean' },
      all: { type: 'boolean' }, output: { type: 'string' }, dir: { type: 'string' },
    } });
  } catch { throw new Error('参数无效，请运行 --help；secret 只允许通过环境变量或 0600 配置提供'); }
  const { values, positionals, tokens } = parsed;
  const seen = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== 'option') continue;
    if (seen.has(token.name)) throw new Error('同一选项不能重复');
    seen.add(token.name);
  }
  const [command, id, attachmentId, ...extra] = positionals;
  if (command === 'help') {
    if (attachmentId || extra.length) throw new Error('help 只接受一个命令或专题');
    output(helpText(id ?? (values.help ? 'help' : undefined)));
    return;
  }
  if (values.help) { output(helpText(command)); return; }
  if (!command) { output(helpText()); return; }
  const commands = ['doctor', 'list', 'search', 'show', 'attachments', 'download', 'export'];
  if (!commands.includes(command)) throw new Error('未知命令，请运行 --help');
  const allowed = new Set(['config', 'base-url', 'mailbox', 'json']);
  if (command === 'list' || command === 'search') for (const key of ['after', 'before', 'since', 'today', 'yesterday', 'page', 'limit']) allowed.add(key);
  if (command === 'search') for (const key of ['query', 'from', 'to', 'subject', 'has-attachment']) allowed.add(key);
  if (command === 'download' || command === 'export') for (const key of ['output', 'dir']) allowed.add(key);
  if (command === 'download') allowed.add('all');
  if ([...seen].some((key) => !allowed.has(key))) throw new Error('该命令不支持指定选项');
  if (extra.length || (['doctor', 'list'].includes(command) && id) || (command !== 'download' && attachmentId)) throw new Error('位置参数过多');
  if (['show', 'attachments', 'download', 'export'].includes(command) && !id) throw new Error('必须指定邮件 ID');
  if (command === 'search' && id && values.query !== undefined) throw new Error('关键词位置参数与 --query 不能同时使用');
  if (values.output && values.dir) throw new Error('--output 与 --dir 不能同时使用');
  const params: Record<string, string> = {};
  if (command === 'list' || command === 'search') {
    Object.assign(params, timeRange(values));
    for (const [key, fallback] of [['page', '1'], ['limit', '20']] as const) {
      const value = values[key] ?? fallback;
      if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('--page/--limit 必须为正整数');
      params[key] = value;
    }
  }
  if (command === 'download' && (!!values.all === !!attachmentId)) throw new Error('download 必须指定附件 ID 或 --all，且二者互斥');
  if (command === 'download' && values.all && values.output) throw new Error('--all 请使用 --dir，不能指定 --output');
  const config = await loadConfig({ config: values.config, baseURL: values['base-url'], mailbox: values.mailbox });
  const api = new InboxAPI(config);
  const emit = (data: unknown, text: string) => output(values.json ? JSON.stringify(data) : text);
  if (command === 'doctor') {
    await api.json('');
    const result = { ok: true, node: process.versions.node, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, authenticated: !!config.accessClientId };
    emit(result, '连接正常；时区：' + result.timezone + '；Access service token：' + (result.authenticated ? '已配置' : '未配置（仅本地开发适用）'));
    return;
  }
  if (command === 'list' || command === 'search') {
    if (command === 'list') params.folder = 'Inbox';
    else {
      for (const key of ['from', 'to', 'subject'] as const) if (values[key] !== undefined) params[key] = values[key];
      if (values.query !== undefined || id) params.query = values.query ?? id;
      if (values['has-attachment']) params.has_attachment = 'true';
    }
    const page = await api.list(command === 'list' ? '/emails' : '/search', params);
    emit(page, ['ID\t收件时间\t发件人\t主题', ...page.emails.map((email) => [email.id, email.received_at ?? email.date, email.sender, email.subject].map(cell).join('\t'))].join('\n'));
    return;
  }
  const emailPath = '/emails/' + encodeURIComponent(id!);
  if (command === 'export') {
    const path = await saveDownload(api, emailPath + '/raw', values.output ?? join(values.dir ?? '.', safeFilename(id!) + '.eml'), 'message/rfc822');
    emit({ files: [path] }, '已保存：' + path);
    return;
  }
  const email = await api.detail(id!);
  if (command === 'show') {
    const text = bodyText(email);
    emit({ ...email, body_text: text }, ['主题：' + cell(email.subject), '发件人：' + cell(email.sender), '收件时间：' + cell(email.received_at ?? email.date), '', clean(text)].join('\n'));
    return;
  }
  const attachments = email.attachments ?? [];
  if (command === 'attachments') {
    emit({ attachments }, ['ID\t文件名\t类型\t字节', ...attachments.map((att) => [att.id, att.filename, att.mimetype, att.size].map(cell).join('\t'))].join('\n'));
    return;
  }
  const selected = values.all ? attachments : attachments.filter((att) => att.id === attachmentId);
  if (!values.all && !selected.length) throw new Error('邮件中找不到该附件');
  const names = selected.map((att) => safeFilename(att.filename));
  if (new Set(names).size !== names.length) throw new Error('附件净化后文件名重名，请逐个指定 --output 下载');
  const files: string[] = [];
  for (const [index, att] of selected.entries()) {
    files.push(await saveDownload(api, emailPath + '/attachments/' + encodeURIComponent(att.id), values.output ?? join(values.dir ?? '.', names[index]), att.mimetype?.toLowerCase()));
  }
  emit({ files }, files.length ? files.map((path) => '已保存：' + path).join('\n') : '没有附件');
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  run(process.argv.slice(2)).catch((error: unknown) => {
    // Never print remote response bodies, headers, stack traces or config contents.
    const message = error instanceof Error ? error.message : '操作失败';
    process.stderr.write('错误：' + clean(message) + '\n');
    process.exitCode = 1;
  });
}
