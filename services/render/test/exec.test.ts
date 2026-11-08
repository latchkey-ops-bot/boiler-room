import { describe, expect, it } from 'vitest';
import type { Naive } from '../src/naive/client.ts';
import { CommandFailed, runCommand } from '../src/naive/exec.ts';

type Frame =
  | { stdout: string }
  | { stderr: string }
  | { exit: { exit_code: number | null; timed_out?: boolean } };

/** A Naive client whose one command streams these frames and then ends. */
const streaming = (frames: Frame[]) =>
  ({
    computers: {
      execStream: async function* () {
        for (const frame of frames) yield frame;
      },
    },
  }) as unknown as Naive;

describe('runCommand', () => {
  it('reports the exit status the stream ends with', async () => {
    const result = await runCommand(
      streaming([{ stdout: 'ok\n' }, { exit: { exit_code: 0 } }]),
      'cmp_1',
      'true',
    );
    expect(result).toMatchObject({ stdout: 'ok\n', exitCode: 0, exited: true, timedOut: false });
  });

  it('says so when the stream ends without an exit frame, and fails it when checked', async () => {
    const lost = [{ stdout: '{"type":"done","seconds":4,"bytes":10}\n' }];
    const result = await runCommand(streaming(lost), 'cmp_1', 'node worker.ts', { check: false });
    expect(result).toMatchObject({ exitCode: -1, exited: false });
    await expect(runCommand(streaming(lost), 'cmp_1', 'node worker.ts')).rejects.toThrow(
      CommandFailed,
    );
  });

  it('fails a command that exits non-zero or times out', async () => {
    await expect(
      runCommand(streaming([{ exit: { exit_code: 2 } }]), 'cmp_1', 'false'),
    ).rejects.toThrow(/exited with 2/);
    await expect(
      runCommand(streaming([{ exit: { exit_code: null, timed_out: true } }]), 'cmp_1', 'sleep'),
    ).rejects.toThrow(/timed out/);
  });
});
