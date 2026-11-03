import { KualatClient } from '@kualat/sdk';
import { UsageError, flagNumber, flagString, type FlagValue } from './args.js';

export interface CliConfig {
    baseUrl: string;
    apiKey: string;
    timeout: number;
}

export function resolveConfig(flags: Record<string, FlagValue>): CliConfig {
    const baseUrl = flagString(flags, 'api-url') ?? process.env.KUALAT_API_URL ?? '';
    const apiKey = flagString(flags, 'api-key') ?? process.env.KUALAT_API_KEY ?? '';

    if (baseUrl === '' || apiKey === '') {
        throw new UsageError(
            'API URL and key are required. Pass --api-url and --api-key, or set KUALAT_API_URL and KUALAT_API_KEY.',
        );
    }

    const timeout = flagNumber(flags, 'timeout') ?? 30;

    return { baseUrl, apiKey, timeout };
}

export function makeClient(config: CliConfig): KualatClient {
    return new KualatClient({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        timeout: config.timeout,
        maxRetries: 0,
    });
}
