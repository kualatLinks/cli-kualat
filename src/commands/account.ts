import type { KualatClient } from '@kualat/sdk';
import type { FlagValue } from '../args.js';
import { asJson, printJson } from '../format.js';

export async function accountCommand(client: KualatClient, flags: Record<string, FlagValue>): Promise<void> {
    const account = await client.account.get();

    if (asJson(flags)) {
        printJson(account);
        return;
    }

    console.log(`${account.username} <${account.email}>`);
    console.log(`role         ${account.role}`);
    console.log(`plan         ${account.plan.id}${account.plan.expires_at ? ` (expires ${account.plan.expires_at})` : ''}`);
    console.log(`registered   ${account.registered_at}`);
}
