export interface DateFilters {
	date_start?: string;
	date_before?: string;
	date_end?: string;
}

export function parsePagination(query: Record<string, string | undefined>) {
	const positiveInteger = (key: string, fallback: number) => {
		if (query[key] === undefined) return fallback;
		if (!/^[1-9]\d*$/.test(query[key]!)) throw new RangeError(key + " must be a positive integer");
		const n = Number(query[key]);
		if (!Number.isSafeInteger(n)) throw new RangeError(key + " must be a safe integer");
		return n;
	};
	const page = positiveInteger("page", 1);
	const limit = Math.min(positiveInteger("limit", 25), 100);
	if (!Number.isSafeInteger((page - 1) * limit)) throw new RangeError("Pagination offset is too large");
	return { page, limit };
}

export function parseDateFilters(query: DateFilters): DateFilters {
	const result: DateFilters = {};
	for (const key of ["date_start", "date_before", "date_end"] as const) {
		const value = query[key];
		if (value === undefined) continue;
		// Preserve the legacy date-only upper-bound comparison for date_end.
		if (key === "date_end" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))) {
			result[key] = value;
			continue;
		}
		// Require an ISO timestamp with a timezone, then normalize for lexical SQL comparison.
		if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
			throw new RangeError(key + " must be an ISO timestamp with timezone");
		}
		result[key] = new Date(value).toISOString();
	}
	return result;
}

export function rawEmailKey(mailboxId: string, emailId: string) {
	return `raw/${encodeURIComponent(mailboxId)}/${emailId}.eml`;
}
