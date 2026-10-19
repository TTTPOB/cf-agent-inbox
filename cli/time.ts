export interface TimeOptions {
  after?: string; before?: string; since?: string; today?: boolean; yesterday?: boolean;
}

function timestamp(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value);
  if (!match || (!/^\d{4}-\d{2}-\d{2}$/.test(value) && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value))) {
    throw new Error('时间须为 YYYY-MM-DD 或 ISO 时间戳');
  }
  const [, y, m, d] = match;
  const calendar = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (calendar.getUTCFullYear() !== Number(y) || calendar.getUTCMonth() !== Number(m) - 1 || calendar.getUTCDate() !== Number(d)) throw new Error('日期不存在');
  const date = value.length === 10 ? new Date(Number(y), Number(m) - 1, Number(d)) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('时间无效');
  return date;
}

export function timeRange(options: TimeOptions, now = new Date()): Record<string, string> {
  const shortcuts = [options.since !== undefined, !!options.today, !!options.yesterday].filter(Boolean).length;
  if (shortcuts > 1 || (shortcuts && (options.after !== undefined || options.before !== undefined))) throw new Error('--since/--today/--yesterday 互斥，且不能与 --after/--before 混用');
  let start: Date | undefined;
  let end: Date | undefined;
  if (options.after !== undefined) start = timestamp(options.after);
  if (options.before !== undefined) end = timestamp(options.before);
  if (options.since !== undefined) {
    const match = /^([1-9]\d*)(h|d)$/.exec(options.since);
    if (!match) throw new Error('--since 须为正整数 h/d，例如 24h、7d');
    start = new Date(now.getTime() - Number(match[1]) * (match[2] === 'h' ? 3600000 : 86400000));
    end = now;
    if (!Number.isFinite(start.getTime())) throw new Error('--since 超出时间范围');
  }
  if (options.today || options.yesterday) {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (options.yesterday ? 1 : 0));
    end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  }
  if (start && end && start >= end) throw new Error('时间区间必须 start < end');
  return { ...(start ? { date_start: start.toISOString() } : {}), ...(end ? { date_before: end.toISOString() } : {}) };
}
