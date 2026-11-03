import { KualatValidationError, KualatNetworkError } from '@kualat/sdk';

export function asJson(flags: Record<string, unknown>): boolean {
    return flags.json === true;
}

export function printJson(value: unknown): void {
    console.log(JSON.stringify(value, null, 2));
}

export function printError(error: unknown): void {
    if (error instanceof KualatValidationError) {
        console.error(`error: ${error.message}`);
        for (const [field, messages] of Object.entries(error.fieldErrors)) {
            for (const message of messages) {
                console.error(`  ${field}: ${message}`);
            }
        }
        return;
    }

    if (error instanceof KualatNetworkError) {
        console.error(`error: ${error.message}`);
        return;
    }

    console.error(error instanceof Error ? `error: ${error.message}` : `error: ${String(error)}`);
}

/** Fixed-width columns; long values are truncated so tables stay readable. */
export function row(columns: string[], widths: number[]): string {
    return columns
        .map((value, index) => (index === columns.length - 1 ? value : value.padEnd(widths[index])))
        .join('  ');
}

export function truncate(value: string, max: number): string {
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
