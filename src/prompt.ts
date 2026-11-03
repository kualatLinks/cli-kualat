import { createInterface } from 'node:readline/promises';

export async function confirm(message: string, skip: boolean): Promise<boolean> {
    if (skip) {
        return true;
    }

    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const answer = (await rl.question(`${message} [y/N] `)).trim().toLowerCase();
    rl.close();

    return answer === 'y' || answer === 'yes';
}
