import type { KualatClient } from '@kualat/sdk';
import { flagNumber, UsageError, type FlagValue } from '../args.js';
import { asJson, printJson } from '../format.js';

export async function tailCommand(
    client: KualatClient,
    positionals: string[],
    flags: Record<string, FlagValue>,
): Promise<void> {
    const id = Number(positionals[0]);

    if (!Number.isInteger(id) || id <= 0) {
        throw new UsageError('Pass a subscription id: kualat tail 3');
    }

    const intervalSeconds = flagNumber(flags, 'interval') ?? 2;

    const webhook = await client.webhooks.get(id);
    console.log(`Tailing deliveries of subscription ${id} (${webhook.url}) — Ctrl+C to stop.`);

    let lastSeen = 0;

    const poll = async (): Promise<void> => {
        let page;

        try {
            page = await client.webhooks.deliveries(id, { limit: 50, page: 1 });
        } catch (error) {
            console.error(`warning: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }

        const fresh = page.data.filter((delivery) => delivery.id > lastSeen).sort((a, b) => a.id - b.id);

        for (const delivery of fresh) {
            lastSeen = delivery.id;

            if (asJson(flags)) {
                printJson(delivery);
                continue;
            }

            const parts = [
                `#${delivery.id}`,
                delivery.event.padEnd(14),
                delivery.status.padEnd(10),
                `${delivery.response_code}`,
                `${delivery.duration}ms`,
            ];

            if (delivery.error) {
                parts.push(delivery.error);
            }

            console.log(parts.join('  '));
        }
    };

    await poll();

    // Tail runs until interrupted: the interval keeps the event loop busy and
    // shutdown waits for the user's Ctrl+C.
    let shutdown: () => void = () => {};
    const stopped = new Promise<void>((resolve) => {
        shutdown = resolve;
    });

    const timer = setInterval(() => void poll(), intervalSeconds * 1000);
    const stop = (): void => {
        clearInterval(timer);
        shutdown();
    };

    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);

    await stopped;
}
