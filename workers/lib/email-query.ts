import type { DateFilters } from "./inbox";

export interface EmailFilters extends DateFilters {
	query?: string;
	folder?: string;
	thread_id?: string;
	from?: string;
	to?: string;
	subject?: string;
	is_read?: boolean;
	is_starred?: boolean;
	has_attachment?: boolean;
}

// Shared by lists, searches and their counts so pagination uses identical filters.
export function buildEmailConditions(options: EmailFilters, alias = "") {
	const prefix = alias ? alias + "." : "";
	const conditions: string[] = [];
	const params: (string | number)[] = [];
	const param = (value: string | number) => { params.push(value); return "?" + params.length; };
	if (options.query) {
		const p = param("%" + options.query + "%");
		conditions.push("(" + ["subject", "body", "sender", "recipient", "cc", "bcc"].map(c => prefix + c + " LIKE " + p).join(" OR ") + ")");
	}
	if (options.folder) {
		const p = param(options.folder);
		conditions.push(prefix + "folder_id = (SELECT id FROM folders WHERE name = " + p + " OR id = " + p + " LIMIT 1)");
	}
	if (options.thread_id) conditions.push(prefix + "thread_id = " + param(options.thread_id));
	if (options.from) conditions.push(prefix + "sender LIKE " + param("%" + options.from + "%"));
	if (options.to) {
		const p = param("%" + options.to + "%");
		conditions.push("(" + ["recipient", "cc", "bcc"].map(c => prefix + c + " LIKE " + p).join(" OR ") + ")");
	}
	if (options.subject) conditions.push(prefix + "subject LIKE " + param("%" + options.subject + "%"));
	if (options.date_start) conditions.push(prefix + "date >= " + param(options.date_start));
	if (options.date_before) conditions.push(prefix + "date < " + param(options.date_before));
	if (options.date_end) conditions.push(prefix + "date <= " + param(options.date_end));
	if (options.is_read !== undefined) conditions.push(prefix + "read = " + param(options.is_read ? 1 : 0));
	if (options.is_starred !== undefined) conditions.push(prefix + "starred = " + param(options.is_starred ? 1 : 0));
	if (options.has_attachment !== undefined) conditions.push((options.has_attachment ? "" : "NOT ") + "EXISTS (SELECT 1 FROM attachments a WHERE a.email_id = " + (alias ? alias + ".id" : "emails.id") + ")");
	return { conditions, params, where: conditions.length ? "WHERE " + conditions.join(" AND ") : "" };
}
