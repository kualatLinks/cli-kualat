#!/usr/bin/env node
import { UsageError, parseArgs } from './args.js';
import { makeClient, resolveConfig } from './config.js';
import { printError } from './format.js';
import { accountCommand } from './commands/account.js';
import { linksCommand } from './commands/links.js';
import { listenCommand } from './commands/listen.js';
import { tailCommand } from './commands/tail.js';
import { webhooksCommand } from './commands/webhooks.js';
import { CLI_VERSION } from './version.js';

const HELP = `kua.lat command line

Usage: kualat <command> [options]

Commands:
  listen                Receive webhook deliveries live and forward them to localhost
  tail <id>             Follow the delivery log of a webhook subscription
  links create <url>    Shorten a URL
      [--alias --domain --title --password --expiry --description]
  links list            [--limit --page --search --order date|click]
  links get <id>        One link with its click statistics
  links delete <id>     [--yes]
  webhooks list         [--limit --page]
  webhooks create <url> --events link.created,link.clicked [--name --secret]
  webhooks delete <id>  [--yes]
  webhooks test <id>    Deliver a ping and report the endpoint response
  account               Show the account profile

Global flags:
  --api-url URL         API root, e.g. https://kua.lat/api (or KUALAT_API_URL)
  --api-key KEY         API key (or KUALAT_API_KEY)
  --json                Machine-readable output
  --timeout SECONDS     Request timeout, default 30
  --version             Print the version
  --help, -h            This help

listen options:
  --forward-to URL      Where deliveries are POSTed, e.g. http://localhost:3000/hooks
  --url URL             Public URL kua.lat should call (a tunnel address);
                        defaults to http://127.0.0.1:<port>/kualat when the API is local
  --port N              Local receiver port, default 8080
  --events LIST         Comma-separated events, default *
  --webhook-id ID       Reuse an existing subscription instead of creating one

tail options:
  --interval SECONDS    Poll interval, default 2`;

async function route(argv: string[]): Promise<number> {
    const { positionals, flags } = parseArgs(argv);

    if (flags.version === true) {
        console.log(`kualat ${CLI_VERSION}`);
        return 0;
    }

    if (flags.help === true || flags.h === true || positionals[0] === 'help' || positionals.length === 0) {
        console.log(HELP);
        return positionals.length === 0 ? 2 : 0;
    }

    const command = positionals[0];
    const rest = positionals.slice(1);
    const config = resolveConfig(flags);
    const client = makeClient(config);

    switch (command) {
        case 'links':
            await linksCommand(client, rest, flags);
            return 0;
        case 'webhooks':
            await webhooksCommand(client, rest, flags);
            return 0;
        case 'account':
            await accountCommand(client, flags);
            return 0;
        case 'listen':
            // Resolves only on shutdown; listenCommand exits the process itself.
            await listenCommand(client, flags, config);
            return 0;
        case 'tail':
            // Long-running poller; the interval keeps the process alive until
            // the user interrupts it.
            await tailCommand(client, rest, flags);
            return 0;
        default:
            throw new UsageError(`Unknown command "${command}". Run kualat --help for the command list.`);
    }
}

async function main(): Promise<number> {
    try {
        return await route(process.argv.slice(2));
    } catch (error) {
        if (error instanceof UsageError) {
            console.error(`error: ${error.message}`);
            return 2;
        }

        printError(error);
        return 1;
    }
}

main().then((code) => process.exit(code));
