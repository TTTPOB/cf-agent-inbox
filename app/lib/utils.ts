// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Shared utility functions used across the frontend.
 *
 * Date formatting has been consolidated into `shared/dates.ts`.
 * Re-export for backwards compatibility with existing imports.
 */
import type { Attachment, Email } from "~/types";

export {
	formatListDate,
	formatDetailDate,
	formatShortDate,
} from "shared/dates";

/**
 * Format a byte count as a human-readable file size.
 */
export function formatBytes(bytes: number, decimals = 1): string {
	if (bytes === 0) return "0 B";
	const k = 1024;
	const dm = decimals < 0 ? 0 : decimals;
	const sizes = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${Number.parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Strip all HTML tags from a string.
 */
export function stripHtml(html: string): string {
	return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(text: string): string {
	return text
		.replace(/&#(\d+);/g, (_match: string, code: string) =>
			String.fromCharCode(Number(code)),
		)
		.replace(/&#x([0-9a-f]+);/gi, (_match: string, hex: string) =>
			String.fromCharCode(Number.parseInt(hex, 16)),
		)
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&apos;/g, "'")
		.replace(/&nbsp;/g, " ");
}

export function getSnippetText(
	snippet?: string | null,
	maxLength = 100,
): string {
	if (!snippet) return "";

	const clean = decodeHtmlEntities(
		snippet
			.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
			.replace(/<style[^>]*>[\s\S]*/gi, "")
			.replace(/<[^>]*>/g, " ")
			.replace(/<[^>]*$/g, ""),
	)
		.replace(/\s+/g, " ")
		.trim();

	if (!clean) return "";
	return clean.length > maxLength ? `${clean.slice(0, maxLength)}...` : clean;
}

/**
 * Escape all five OWASP-recommended HTML special characters in plain text.
 * Safe for use in both text content and attribute contexts.
 */
export function escapeHtml(text: string): string {
	if (!text) return "";
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/** Prefer explicit MIME parts; keep legacy HTML bodies readable. */
export function getEmailBodyHtml(email: Pick<Email, "body" | "body_text" | "body_html">): string {
 if (email.body_html) return email.body_html;
 if (email.body_text != null) return `<pre style="white-space: pre-wrap">${escapeHtml(email.body_text)}</pre>`;
 return email.body || "";
}

/**
 * Rewrite CID references in email HTML to API URLs for inline images.
 * Replaces `src="cid:image001@example.com"` with the attachment API endpoint.
 */
export function rewriteInlineImages(
	body: string,
	mailboxId: string,
	emailId: string,
	attachments?: { id: string; content_id?: string | null; disposition?: string | null }[],
): string {
	if (!body || !attachments?.length) return body;
	let result = body;
	for (const att of attachments) {
		if (att.content_id) {
			const url = getAttachmentUrl(mailboxId, emailId, att.id);
			// Strip angle brackets from content_id if present
			const cid = att.content_id.startsWith("<")
				? att.content_id.slice(1, -1)
				: att.content_id;
			result = result.replace(new RegExp(`cid:${cid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "gi"), url);
		}
	}
	return result;
}

export function getNonInlineAttachments(attachments?: Attachment[]): Attachment[] {
	return attachments?.filter((attachment) => attachment.disposition !== "inline") ?? [];
}

export function getAttachmentUrl(
	mailboxId: string,
	emailId: string,
	attachmentId: string,
): string {
	return `/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/emails/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

export function downloadFile(url: string, filename: string) {
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.target = "_blank";
	link.rel = "noopener noreferrer";
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
}
