import type { JWTPayload } from "jose";

export type ServiceTokenMailboxes = Record<string, string[]>;
export interface AccessVariables {
	// null means a verified browser identity (or local development) has unrestricted access.
	allowedMailboxes?: string[] | null;
}

export function normalizeMailboxId(value: string): string {
	return value.trim().toLowerCase();
}

/** Resolve only verified JWT claims. Client-supplied identity headers are never used. */
export function resolveMailboxAccess(payload: JWTPayload, mapping?: ServiceTokenMailboxes): { allowedMailboxes: string[] | null } | null {
	if (payload.common_name !== undefined) {
		const clientId = payload.common_name;
		if (typeof clientId !== "string" || !clientId || !mapping || !Object.hasOwn(mapping, clientId)) return null;
		const addresses = mapping[clientId];
		if (!Array.isArray(addresses) || !addresses.every(a => typeof a === "string" && /^[^\s@]+@[^\s@]+$/.test(a.trim()))) return null;
		return { allowedMailboxes: [...new Set(addresses.map(normalizeMailboxId))] };
	}
	if (typeof payload.email === "string" && /^[^\s@]+@[^\s@]+$/.test(payload.email.trim())) {
		return { allowedMailboxes: null };
	}
	return null;
}

export function canAccessMailbox(allowed: string[] | null | undefined, mailboxId: string): boolean {
	return allowed == null || allowed.includes(normalizeMailboxId(mailboxId));
}
