import { createWriteStream } from 'node:fs';
import { access, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import type { Config } from './config.ts';
import type { Email, EmailPage } from './types.ts';

export class InboxAPI {
  private config: Config;
  constructor(config: Config) { this.config = config; }

  url(path: string, params: Record<string, string> = {}): URL {
    const base = this.config.baseURL.replace(/\/+$/, '');
    const url = new URL(base + '/api/v1/mailboxes/' + encodeURIComponent(this.config.mailbox) + path);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url;
  }

  async get(path: string, params: Record<string, string> = {}): Promise<Response> {
    const headers: Record<string, string> = {};
    if (this.config.accessClientId && this.config.accessClientSecret) {
      headers['CF-Access-Client-Id'] = this.config.accessClientId;
      headers['CF-Access-Client-Secret'] = this.config.accessClientSecret;
    }
    let response: Response;
    try {
      response = await fetch(this.url(path, params), { headers, redirect: 'manual', signal: AbortSignal.timeout(60_000) });
    } catch { throw new Error('网络请求失败或超时'); }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new Error('拒绝重定向；请检查 baseURL 和 Access service token 策略');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(response.status === 401 || response.status === 403 ? '认证失败：请检查 Access service token 和策略' : 'API 请求失败（HTTP ' + response.status + '）');
    }
    return response;
  }

  async json<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const response = await this.get(path, params);
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      await response.body?.cancel();
      throw new Error('API 未返回 JSON；可能是 Access 登录页');
    }
    try { return await response.json() as T; } catch { throw new Error('API JSON 响应无效'); }
  }

  detail(id: string): Promise<Email> { return this.json('/emails/' + encodeURIComponent(id)); }

  async list(path: string, params: Record<string, string>): Promise<EmailPage> {
    const data = await this.json<Email[] | EmailPage>(path, params);
    const emails = Array.isArray(data) ? data : data?.emails;
    if (!Array.isArray(emails)) throw new Error('API 邮件列表格式无效');
    return { emails: emails.map(summary), totalCount: Array.isArray(data) ? null : data.totalCount ?? null };
  }
}

export function summary(email: Email): Email {
  return { id: email.id, subject: email.subject ?? null, sender: email.sender ?? null, recipient: email.recipient ?? null,
    date: email.date ?? null, received_at: email.received_at ?? null, read: !!email.read, starred: !!email.starred, snippet: email.snippet ?? null };
}

export function safeFilename(name: string): string {
  const safe = name.replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 180);
  return safe && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe) ? safe : 'attachment';
}

async function rejectExisting(path: string): Promise<void> {
  try { await access(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  throw new Error('目标文件已存在，拒绝覆盖');
}

export async function saveDownload(api: InboxAPI, path: string, target: string, expectedType?: string): Promise<string> {
  target = resolve(target);
  await mkdir(dirname(target), { recursive: true });
  await rejectExisting(target);
  const response = await api.get(path);
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (!response.body) throw new Error('下载响应为空');
  if ((contentType === 'text/html' || contentType === 'application/xhtml+xml') && expectedType !== contentType) {
    await response.body.cancel();
    throw new Error('拒绝保存意外 HTML 响应；可能是 Access 登录页');
  }
  const temporary = join(dirname(target), '.' + randomUUID() + '.part');
  let prefix = Buffer.alloc(0);
  const guard = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      if (prefix.length < 8192) {
        prefix = Buffer.concat([prefix, chunk]).subarray(0, 8192);
        const text = prefix.toString('utf8');
        if (/cloudflare\s+access|\/cdn-cgi\/access\/|access\.cloudflareaccess\.com/i.test(text) && /<html|<!doctype|<form/i.test(text)) {
          callback(new Error('拒绝保存 Access 登录页'));
          return;
        }
      }
      callback(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(response.body as never), guard, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    await rejectExisting(target);
    await rename(temporary, target);
    return target;
  } finally {
    await rm(temporary, { force: true });
  }
}

export function htmlToText(html: string): string {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(?:br\s*\/?|\/p|\/div|\/li|\/h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, entity: string) => {
      if (entity[0] !== '#') return entities[entity.toLowerCase()] ?? all;
      const value = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : all;
    }).replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function bodyText(email: Email): string {
  return email.body_text ?? htmlToText(email.body_html ?? email.body ?? '');
}
