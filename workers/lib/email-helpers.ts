// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** List mailboxes from private R2 metadata, including every listing page. */
export async function listMailboxes(bucket: R2Bucket): Promise<{ id: string; email: string }[]> {
	const result: { id: string; email: string }[] = [];
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix: "mailboxes/", cursor });
		for (const obj of page.objects) {
			if (!obj.key.endsWith(".json")) continue;
			const id = obj.key.slice("mailboxes/".length, -".json".length);
			result.push({ id, email: id });
		}
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return result;
}
