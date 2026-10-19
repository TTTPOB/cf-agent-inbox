// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { ServiceTokenMailboxes } from "./lib/access";

export interface Env extends Omit<Cloudflare.Env, "SERVICE_TOKEN_MAILBOXES"> {
	SERVICE_TOKEN_MAILBOXES?: ServiceTokenMailboxes;
	POLICY_AUD: string;
	TEAM_DOMAIN: string;
}
