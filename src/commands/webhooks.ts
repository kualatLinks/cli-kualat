import type { KualatClient } from '@kualat/sdk';
import { flagList, flagNumber, flagString, UsageError, type FlagValue } from '../args.js';
import { asJson, printJson, row, truncate } from '../format.js';
import { confirm } from '../prompt.js';

export async function webhooksCommand(
    client: KualatClient,
    positionals: string[],
    flags: Record<string, FlagValue>,
): Promise<void> {
    const sub = positionals[0] ?? 'list';

    switch (sub) {
        case 'list':
            return listWebhooks(client, flags);
        case 'create':
            return createWebhook(client, positionals[1], flags);
        case 'delete':
            return deleteWebhook(client, positionals[1], flags);
        case 'test':
            return testWebhook(client, positionals[1], flags);
        default:
            throw new UsageError(`Unknown webhooks command "${sub}". Use list, create, delete, or test.`);
    }
}

async function listWebhooks(client: KualatClient, flags: Record<string, FlagValue>): Promise<void> {
    const page = await client.webhooks.list({
        limit: flagNumber(flags, 'limit'),
        page: flagNumber(flags, 'page'),
    });

    if (asJson(flags)) {
        printJson(page);
        return;
    }

    const widths = [6, 12, 7, 24];
    console.log(row(['ID', 'EVENTS', 'ACTIVE', 'URL'], widths));

    for (const webhook of page.data) {
        console.log(
            row(
                [String(webhook.id), webhook.events.join(','), webhook.active ? 'yes' : 'no', truncate(webhook.url, 48)],
                widths,
            ),
        );
    }
}

async function createWebhook(
    client: KualatClient,
    url: string | undefined,
    flags: Record<string, FlagValue>,
): Promise<void> {
    if (!url) {
        throw new UsageError('Pass the endpoint URL: kualat webhooks create https://example.com/hook');
    }

    const events = flagList(flags, 'events');

    if (!events || events.length === 0) {
        throw new UsageError('--events is required, e.g. --events link.created,link.clicked (or * for everything).');
    }

    const webhook = await client.webhooks.create({
        url,
        events,
        name: flagString(flags, 'name'),
        secret: flagString(flags, 'secret'),
    });

    if (asJson(flags)) {
        printJson(webhook);
        return;
    }

    console.log(`subscription ${webhook.id} created for ${webhook.url}`);
    console.log(`events       ${webhook.events.join(', ')}`);
    console.log(`secret       ${webhook.secret ?? '(the API did not return one)'}`);
}

async function deleteWebhook(client: KualatClient, rawId: string | undefined, flags: Record<string, FlagValue>): Promise<void> {
    const id = requireId(rawId);

    if (!(await confirm(`Delete subscription ${id} and its delivery log?`, flags.yes === true))) {
        return;
    }

    await client.webhooks.delete(id);
    console.log(`subscription ${id} deleted`);
}

async function testWebhook(client: KualatClient, rawId: string | undefined, flags: Record<string, FlagValue>): Promise<void> {
    const id = requireId(rawId);
    const result = await client.webhooks.test(id);

    if (asJson(flags)) {
        printJson(result);
        return;
    }

    const delivery = result.delivery;

    if (!delivery) {
        console.log('no delivery record was returned; check the endpoint and try again');
        return;
    }

    console.log(`event         ${delivery.event}`);
    console.log(`status        ${delivery.status}`);
    console.log(`response code ${delivery.response_code}`);
    console.log(`duration      ${delivery.duration}ms`);

    if (delivery.error) {
        console.log(`error         ${delivery.error}`);
    }
}

function requireId(raw: string | undefined): number {
    const id = Number(raw);

    if (!Number.isInteger(id) || id <= 0) {
        throw new UsageError('Pass a subscription id: kualat webhooks test 3');
    }

    return id;
}
