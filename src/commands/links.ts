import type { KualatClient } from '@kualat/sdk';
import { flagNumber, flagString, UsageError, type FlagValue } from '../args.js';
import { asJson, printJson, row, truncate } from '../format.js';
import { confirm } from '../prompt.js';

export async function linksCommand(
    client: KualatClient,
    positionals: string[],
    flags: Record<string, FlagValue>,
): Promise<void> {
    const sub = positionals[0] ?? 'list';

    switch (sub) {
        case 'create':
            return createLink(client, positionals[1], flags);
        case 'list':
            return listLinks(client, flags);
        case 'get':
            return getLink(client, positionals[1]);
        case 'delete':
            return deleteLink(client, positionals[1], flags);
        default:
            throw new UsageError(`Unknown links command "${sub}". Use create, list, get, or delete.`);
    }
}

async function createLink(client: KualatClient, url: string | undefined, flags: Record<string, FlagValue>): Promise<void> {
    if (!url) {
        throw new UsageError('Pass the destination URL: kualat links create https://example.com');
    }

    const link = await client.links.create({
        url,
        custom: flagString(flags, 'alias'),
        domain: flagString(flags, 'domain'),
        title: flagString(flags, 'title'),
        password: flagString(flags, 'password'),
        expiry: flagString(flags, 'expiry'),
        description: flagString(flags, 'description'),
    });

    if (asJson(flags)) {
        printJson(link);
        return;
    }

    console.log(`${link.short_url}  (id ${link.id})`);
}

async function listLinks(client: KualatClient, flags: Record<string, FlagValue>): Promise<void> {
    const page = await client.links.list({
        limit: flagNumber(flags, 'limit'),
        page: flagNumber(flags, 'page'),
        search: flagString(flags, 'search'),
        order: flagString(flags, 'order') as 'date' | 'click' | undefined,
    });

    if (asJson(flags)) {
        printJson(page);
        return;
    }

    const widths = [8, 30, 8, 12];
    console.log(row(['ID', 'SHORT URL', 'CLICKS', 'LONG URL'], widths));

    for (const link of page.data) {
        console.log(row([String(link.id), link.short_url, String(link.clicks), truncate(link.long_url, 60)], widths));
    }

    if (page.pagination && page.pagination.total_pages > 1) {
        console.log(`\npage ${page.pagination.current_page}/${page.pagination.total_pages}, ${page.pagination.total} links`);
    }
}

async function getLink(client: KualatClient, rawId: string | undefined): Promise<void> {
    const id = requireId(rawId);
    const link = await client.links.get(id);

    if (!process.stdout.isTTY) {
        printJson(link);
        return;
    }

    console.log(`${link.short_url}  (id ${link.id})`);
    console.log(`destination  ${link.long_url}`);
    console.log(`clicks       ${link.clicks} (${link.unique_clicks} unique)`);
    if (link.expiry) {
        console.log(`expiry       ${link.expiry}`);
    }

    const stats = link.statistics;
    const countries = Object.entries(stats.top_countries).slice(0, 5);

    if (countries.length > 0) {
        console.log('top countries');
        for (const [country, count] of countries) {
            console.log(`  ${country.padEnd(16)} ${count}`);
        }
    }
}

async function deleteLink(client: KualatClient, rawId: string | undefined, flags: Record<string, FlagValue>): Promise<void> {
    const id = requireId(rawId);

    if (!(await confirm(`Delete link ${id} together with its statistics? This cannot be undone.`, flags.yes === true))) {
        return;
    }

    await client.links.delete(id);
    console.log(`link ${id} deleted`);
}

function requireId(raw: string | undefined): number {
    const id = Number(raw);

    if (!Number.isInteger(id) || id <= 0) {
        throw new UsageError('Pass a link id: kualat links get 42');
    }

    return id;
}
