import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Config {
  baseURL: string;
  mailbox: string;
  accessClientId?: string;
  accessClientSecret?: string;
}

export async function loadConfig(overrides: { baseURL?: string; mailbox?: string; config?: string }, env: NodeJS.ProcessEnv = process.env): Promise<Config> {
  const path = overrides.config ?? env.INBOX_CONFIG ?? join(homedir(), '.config', 'cf-agent-inbox', 'config.json');
  let file: Partial<Config> = {};
  try {
    const info = await stat(path);
    if ((info.mode & 0o777) !== 0o600 || (process.getuid && info.uid !== process.getuid())) throw new Error('配置文件必须由当前用户持有且权限为 0600');
    file = JSON.parse(await readFile(path, 'utf8'));
    if (!file || typeof file !== 'object' || Array.isArray(file)) throw new Error('配置文件必须为 JSON 对象');
    for (const key of ['baseURL', 'mailbox', 'accessClientId', 'accessClientSecret'] as const) {
      if (file[key] !== undefined && typeof file[key] !== 'string') throw new Error('配置字段必须为字符串');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || overrides.config || env.INBOX_CONFIG) {
      if (error instanceof SyntaxError) throw new Error('配置文件不是有效 JSON');
      throw error;
    }
  }
  const config: Config = {
    baseURL: overrides.baseURL ?? env.INBOX_URL ?? env.INBOX_BASE_URL ?? file.baseURL ?? '',
    mailbox: overrides.mailbox ?? env.INBOX_MAILBOX ?? file.mailbox ?? '',
    accessClientId: env.CF_ACCESS_CLIENT_ID ?? file.accessClientId,
    accessClientSecret: env.CF_ACCESS_CLIENT_SECRET ?? file.accessClientSecret,
  };
  if (!config.baseURL || !config.mailbox) throw new Error('请配置 baseURL/mailbox 或 INBOX_URL/INBOX_MAILBOX');
  let url: URL;
  try { url = new URL(config.baseURL); } catch { throw new Error('baseURL 无效'); }
  if (url.username || url.password || url.search || url.hash) throw new Error('baseURL 不得包含凭据、查询或片段');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('baseURL 必须使用 HTTPS（本机 mock 可用 HTTP）');
  if (!!config.accessClientId !== !!config.accessClientSecret) throw new Error('Access service ID 与 secret 必须成对配置');
  return config;
}
