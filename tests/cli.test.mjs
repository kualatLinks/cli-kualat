import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import { parseArgs } from '../dist/args.js';
import { signDelivery } from '../../webhooks-kualat/dist/index.js';

const CLI = ['dist/cli.js'];

function startServer(handler) {
    return new Promise((resolve) => {
        const server = createServer(handler);
        server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
    });
}

function runCli(args, env = undefined) {
    const child = spawn(process.execPath, [...CLI, ...args], { stdio: ['pipe', 'pipe', 'pipe'], env: env ? { ...process.env, ...env } : process.env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    const closed = new Promise((resolve) => child.on('close', (code) => resolve(code)));
    return { child, stdout: () => stdout, stderr: () => stderr, closed, waitFor };
}

function waitFor(child, pattern, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout waiting for ${pattern}`)), timeoutMs);
        const onData = (chunk) => {
            if (pattern.test(String(chunk))) {
                clearTimeout(timer);
                child.stdout.off('data', onData);
                resolve();
            }
        };
        child.stdout.on('data', onData);
    });
}

test('parseArgs reads --flag value, --flag=value, booleans, and positionals', () => {
    const parsed = parseArgs(['links', 'create', 'https://example.com', '--alias=abc', '--json', '--limit', '5']);

    assert.deepEqual(parsed.positionals, ['links', 'create', 'https://example.com']);
    assert.equal(parsed.flags.alias, 'abc');
    assert.equal(parsed.flags.json, true);
    assert.equal(parsed.flags.limit, '5');
});

test('parseArgs keeps consecutive flags boolean', () => {
    const parsed = parseArgs(['listen', '--json', '--yes']);

    assert.deepEqual(parsed.positionals, ['listen']);
    assert.deepEqual(parsed.flags, { json: true, yes: true });
});

test('--version prints the version', async () => {
    const cli = runCli(['--version']);
    const code = await cli.closed;

    assert.equal(code, 0);
    assert.match(cli.stdout(), /^kualat 0\.1\.0/);
});

test('a missing command prints help with usage exit code', async () => {
    const cli = runCli([]);
    const code = await cli.closed;

    assert.equal(code, 2);
    assert.match(cli.stdout(), /Usage: kualat/);
});

test('a missing API key is a usage error', async () => {
    const cli = runCli(['account'], { ...process.env, KUALAT_API_URL: '', KUALAT_API_KEY: '' });
    const code = await cli.closed;

    assert.equal(code, 2);
    assert.match(cli.stderr(), /API URL and key are required/);
});

test('links list renders the table from the API envelope', async () => {
    const seen = [];
    const { server, port } = await startServer((req, res) => {
        seen.push({ url: req.url, authorization: req.headers.authorization });
        res.setHeader('Content-Type', 'application/json');
        res.end(
            JSON.stringify({
                data: [
                    { id: 7, alias: 'aB3xY9', short_url: 'https://kua.lat/aB3xY9', long_url: 'https://example.com/very/long/path/that/should/truncate', clicks: 12, unique_clicks: 9, domain: null, campaign_id: null, collection_ids: [], created_at: '2026-11-03 10:00:00', title: null, description: null },
                ],
                meta: { pagination: { current_page: 1, per_page: 15, total: 1, total_pages: 1, links: { prev: null, next: null } } },
            }),
        );
    });

    try {
        const cli = runCli(['links', 'list', '--api-url', `http://127.0.0.1:${port}/api`, '--api-key', 'key_test', '--json']);
        const code = await cli.closed;

        assert.equal(code, 0);
        const payload = JSON.parse(cli.stdout());
        assert.equal(payload.data[0].id, 7);
        assert.equal(seen[0].authorization, 'Bearer key_test');
        // Pagination params are optional; the server applies its defaults.
        assert.equal(seen[0].url, '/api/links');
    } finally {
        server.close();
    }
});

test('usage errors exit with code 2', async () => {
    const { server, port } = await startServer(() => {});
    try {
        const cli = runCli(['links', 'create', '--api-url', `http://127.0.0.1:${port}/api`, '--api-key', 'k']);
        const code = await cli.closed;

        assert.equal(code, 2);
        assert.match(cli.stderr(), /Pass the destination URL/);
    } finally {
        server.close();
    }
});

test('listen receives a signed delivery, forwards it, and cleans up on stdin close', async () => {
    const SECRET = 'whsec_MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
    const apiCalls = [];
    const received = [];

    const { server: apiServer, port: apiPort } = await startServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => (body += String(chunk)));
        req.on('end', () => {
            apiCalls.push({ method: req.method, url: req.url, body });

            if (req.method === 'POST' && req.url === '/api/webhooks') {
                res.setHeader('Content-Type', 'application/json');
                res.end(
                    JSON.stringify({
                        data: { id: 9, name: 'cli: listen', url: 'http://127.0.0.1:9911/kualat', events: ['*'], active: true, failures: 0, last_status: '', last_response_code: 0, last_triggered_at: null, created_at: '2026-11-03 10:00:00', secret: SECRET },
                    }),
                );
                return;
            }

            if (req.method === 'DELETE' && req.url === '/api/webhooks/9') {
                res.statusCode = 204;
                res.end();
                return;
            }

            res.statusCode = 404;
            res.end('{}');
        });
    });

    const { server: receiver, port: receiverPort } = await startServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
            received.push({ body, headers: req.headers });
            res.statusCode = 200;
            res.end('ok');
        });
    });

    try {
        const cli = runCli([
            'listen',
            '--api-url', `http://127.0.0.1:${apiPort}/api`,
            '--api-key', 'key_test',
            '--forward-to', `http://127.0.0.1:${receiverPort}/hooks`,
            '--port', '9911',
        ]);

        try {
            await waitFor(cli.child, /Receiving on/);
            assert.match(cli.stdout(), /http:\/\/127\.0\.0\.1:9911\/kualat/);

            const body = JSON.stringify({ event: 'link.clicked', delivery: 'dlv_test', data: { id: 1 } });
            const id = 'dlv_testdelivery12345678';
            const timestamp = String(Math.floor(Date.now() / 1000));
            const signature = signDelivery({ secret: SECRET, id, timestamp, payload: body });

            const delivered = await fetch('http://127.0.0.1:9911/kualat', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'webhook-id': id,
                    'webhook-timestamp': timestamp,
                    'webhook-signature': signature,
                    'x-kualat-event': 'link.clicked',
                },
                body,
            });

            assert.equal(delivered.status, 200);
            await new Promise((resolve) => setTimeout(resolve, 200));

            assert.match(cli.stdout(), /link\.clicked/);
            assert.equal(received.length, 1);
            assert.equal(received[0].body, body);
            assert.equal(received[0].headers['webhook-id'], id);
            assert.equal(received[0].headers['x-kualat-event'], 'link.clicked');

            // Closing stdin is the cross-platform "parent is done" signal.
            cli.child.stdin.end();
            const code = await cli.closed;

            assert.equal(code, 0);
            assert.ok(apiCalls.some((call) => call.method === 'DELETE' && call.url === '/api/webhooks/9'), 'subscription must be removed on exit');
        } finally {
            if (cli.child.exitCode === null) {
                cli.child.kill('SIGKILL');
            }
        }
    } finally {
        apiServer.close();
        receiver.close();
    }
});

test('listen rejects a delivery with a broken signature', async () => {
    const SECRET = 'whsec_MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
    const received = [];

    const { server: apiServer, port: apiPort } = await startServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ data: { id: 10, secret: SECRET, active: true, url: '', events: ['*'], name: '', failures: 0, last_status: '', last_response_code: 0, last_triggered_at: null, created_at: '' } }));
    });

    const { server: receiver, port: receiverPort } = await startServer((req, res) => {
        received.push(true);
        res.end('ok');
    });

    try {
        const cli = runCli([
            'listen', '--webhook-id', '10',
            '--api-url', `http://127.0.0.1:${apiPort}/api`,
            '--api-key', 'key_test',
            '--forward-to', `http://127.0.0.1:${receiverPort}/hooks`,
            '--port', '9914',
        ]);

        await waitFor(cli.child, /Receiving on/);

        const body = '{"event":"link.clicked"}';
        const response = await fetch('http://127.0.0.1:9914/kualat', {
            method: 'POST',
            headers: { 'webhook-id': 'dlv_x', 'webhook-timestamp': String(Math.floor(Date.now() / 1000)), 'webhook-signature': 'v1,bad signature', 'content-type': 'application/json' },
            body,
        });

        assert.equal(response.status, 401);
        assert.equal(received.length, 0);
        assert.match(cli.stdout(), /failed the signature check/);

        cli.child.kill('SIGKILL');
        await cli.closed;
    } finally {
        apiServer.close();
        receiver.close();
    }
});

test('listen without a reachable target explains the tunnel option', async () => {
    const cli = runCli(['listen', '--api-url', 'https://kua.lat/api', '--api-key', 'k', '--forward-to', 'http://localhost:3000/hook']);
    const code = await cli.closed;

    assert.equal(code, 2);
    assert.match(cli.stderr(), /cloudflared tunnel/);
    assert.match(cli.stderr(), /WEBHOOKS_ALLOW_PRIVATE_TARGETS/);
});

test('tail prints fresh deliveries as they arrive', async () => {
    let tick = 0;
    const { server, port } = await startServer((req, res) => {
        const rows = tick++ === 0 ? [] : [
            { id: 3, event: 'link.clicked', status: 'delivered', response_code: 200, duration: 84, attempt: 1, error: null, created_at: '2026-11-03 10:00:01' },
        ];
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ data: rows, meta: { pagination: { current_page: 1, per_page: 50, total: rows.length, total_pages: 1, links: { prev: null, next: null } } } }));
    });

    try {
        const cli = runCli([
            'tail', '5', '--interval', '1',
            '--api-url', `http://127.0.0.1:${port}/api`,
            '--api-key', 'key_test',
        ]);

        await waitFor(cli.child, /#3/);
        assert.match(cli.stdout(), /Tailing deliveries of subscription 5/);
        assert.match(cli.stdout(), /link\.clicked/);

        cli.child.kill('SIGKILL');
        await cli.closed;
    } finally {
        server.close();
    }
});
