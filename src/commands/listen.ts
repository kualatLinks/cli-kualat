import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { verifyDelivery } from '@kualat/webhooks';
import type { KualatClient } from '@kualat/sdk';
import { flagList, flagNumber, flagString, UsageError, type FlagValue } from '../args.js';
import { resolveConfig } from '../config.js';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

// The delivery signature travels in these headers; the rest is not needed
// downstream and forwarding them would leak infrastructure details.
const FORWARDED_HEADERS = ['webhook-id', 'webhook-timestamp', 'webhook-signature', 'x-kualat-event', 'content-type'];

export async function listenCommand(
    client: KualatClient,
    flags: Record<string, FlagValue>,
    config: ReturnType<typeof resolveConfig>,
): Promise<void> {
    const forwardTo = flagString(flags, 'forward-to');

    if (!forwardTo) {
        throw new UsageError('--forward-to is required, e.g. --forward-to http://localhost:3000/hooks');
    }

    new URL(forwardTo);

    const port = flagNumber(flags, 'port') ?? 8080;
    const events = flagList(flags, 'events') ?? ['*'];
    const existingId = flagNumber(flags, 'webhook-id');
    const publicUrl = flagString(flags, 'url') ?? autoPublicUrl(config.baseUrl, port);

    let subscriptionId: number;
    let secret: string | undefined;

    if (existingId !== undefined) {
        const webhook = await client.webhooks.get(existingId);
        subscriptionId = webhook.id;
        secret = webhook.secret;

        if (!webhook.active) {
            console.error('warning: this subscription is inactive; activate it or drop --webhook-id to create a fresh one');
        }
    } else {
        const created = await client.webhooks.create({ url: publicUrl, events, name: 'cli: listen' });
        subscriptionId = created.id;
        secret = created.secret;
    }

    const server = createServer((request, response) => {
        void handleDelivery(request, response, forwardTo, secret);
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
    });

    console.log(`Receiving on  http://127.0.0.1:${port}`);
    console.log(`kua.lat calls ${publicUrl}`);
    console.log(`Forwarding to ${forwardTo}`);
    console.log(
        secret
            ? `Subscription  ${subscriptionId} (signatures verified)`
            : `Subscription  ${subscriptionId} (no secret returned, signatures are NOT verified)`,
    );
    console.log('Press Ctrl+C to stop; the subscription is removed on exit.');

    let stopping = false;

    // listenCommand resolves only after shutdown, so the process stays up
    // until the subscription is removed; main() then exits cleanly.
    let shutdown: () => void = () => {};
    const stopped = new Promise<void>((resolve) => {
        shutdown = resolve;
    });

    const stop = (): void => {
        if (stopping) {
            return;
        }
        stopping = true;

        void (async () => {
            if (existingId === undefined) {
                try {
                    await client.webhooks.delete(subscriptionId);
                    console.log(`\nsubscription ${subscriptionId} removed`);
                } catch (error) {
                    console.error(`\nwarning: could not remove subscription ${subscriptionId}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }

            server.close(() => shutdown());

            // A held connection (a hung forward target) must not block shutdown.
            setTimeout(shutdown, 1500).unref();
        })();
    };

    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);

    // Piped stdin closes when the parent process dies: shut down with it so
    // `kualat listen | ...` and CI harnesses never leak a subscription.
    // Reading must start explicitly; a bare 'end' listener never fires.
    if (process.stdin.readable) {
        process.stdin.resume();
        process.stdin.on('end', stop);
    }

    await stopped;
}

async function handleDelivery(
    request: IncomingMessage,
    response: ServerResponse,
    forwardTo: string,
    secret: string | undefined,
): Promise<void> {
    const started = Date.now();

    const fail = (status: number, message: string): void => {
        console.log(`✗ ${message} (${Date.now() - started}ms)`);
        response.statusCode = status;
        response.end();
    };

    if (request.method !== 'POST') {
        response.statusCode = 405;
        response.end();
        return;
    }

    const chunks: Buffer[] = [];

    for await (const chunk of request) {
        chunks.push(chunk as Buffer);
    }

    const body = Buffer.concat(chunks);
    const deliveryId = headerOf(request, 'webhook-id');

    if (secret !== undefined && !verifyDelivery({ secret, headers: request.headers, payload: body })) {
        fail(401, `delivery ${deliveryId || '(no id)'} failed the signature check`);
        return;
    }

    const headers: Record<string, string> = {};

    for (const name of FORWARDED_HEADERS) {
        const value = request.headers[name];

        if (typeof value === 'string') {
            headers[name] = value;
        }
    }

    let status: number;

    try {
        const forwarded = await fetch(forwardTo, {
            method: 'POST',
            headers,
            body,
            signal: AbortSignal.timeout(15_000),
        });
        status = forwarded.status;
    } catch (error) {
        fail(502, `delivery ${deliveryId || '(no id)'} could not be forwarded: ${error instanceof Error ? error.message : String(error)}`);
        return;
    }

    const event = headerOf(request, 'x-kualat-event') || '(unknown event)';
    console.log(`→ ${event.padEnd(14)} ${deliveryId.padEnd(26)} ${status} (${Date.now() - started}ms)`);

    response.statusCode = status;
    response.end();
}

function headerOf(request: IncomingMessage, name: string): string {
    const value = request.headers[name];
    return typeof value === 'string' ? value : '';
}

function autoPublicUrl(baseUrl: string, port: number): string {
    const { hostname } = new URL(`${baseUrl}/`);

    if (LOOPBACK_HOSTS.has(hostname)) {
        return `http://127.0.0.1:${port}/kualat`;
    }

    throw new UsageError(
        `kua.lat (${hostname}) cannot reach this machine. Expose the receiver with a tunnel, e.g.:\n\n` +
            `  cloudflared tunnel --url http://localhost:${port}\n\n` +
            `then pass the address: kualat listen --url https://<tunnel-host> --forward-to http://localhost:3000/hooks\n\n` +
            `On a self-hosted installation you can instead set WEBHOOKS_ALLOW_PRIVATE_TARGETS=1 to allow loopback receivers.`,
    );
}
