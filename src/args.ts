export type FlagValue = string | boolean;

export interface ParsedArgs {
    positionals: string[];
    flags: Record<string, FlagValue>;
}

/** Usage error: the command line itself is wrong, not the API call. */
export class UsageError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UsageError';
    }
}

export function parseArgs(argv: string[]): ParsedArgs {
    const positionals: string[] = [];
    const flags: Record<string, FlagValue> = {};

    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];

        if (!token.startsWith('--')) {
            positionals.push(token);
            continue;
        }

        const eq = token.indexOf('=');

        if (eq > 2) {
            flags[token.slice(2, eq)] = token.slice(eq + 1);
            continue;
        }

        const name = token.slice(2);
        const next = argv[i + 1];

        if (next !== undefined && !next.startsWith('--')) {
            flags[name] = next;
            i++;
        } else {
            flags[name] = true;
        }
    }

    return { positionals, flags };
}

export function flagString(flags: Record<string, FlagValue>, ...names: string[]): string | undefined {
    for (const name of names) {
        const value = flags[name];
        if (typeof value === 'string' && value !== '') {
            return value;
        }
    }

    return undefined;
}

export function flagNumber(flags: Record<string, FlagValue>, name: string): number | undefined {
    const value = flagString(flags, name);

    if (value === undefined) {
        return undefined;
    }

    const parsed = Number(value);

    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new UsageError(`--${name} must be a non-negative number, got "${value}".`);
    }

    return parsed;
}

export function flagList(flags: Record<string, FlagValue>, name: string): string[] | undefined {
    const value = flagString(flags, name);

    if (value === undefined) {
        return undefined;
    }

    return value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== '');
}
