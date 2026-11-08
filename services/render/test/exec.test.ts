import { describe, expect, it } from 'vitest';
import type { Naive } from '../src/naive/client.ts';
import { CommandFailed, outputOf, runCommand } from '../src/naive/exec.ts';

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

  it('treats an exit frame with no real exit code as an unknown status', async () => {
    // Seen live: chunks that printed `done` with their bytes, then an exit frame with code -1.
    for (const code of [-1, null]) {
      const frames = [
        { stdout: '{"type":"done","seconds":8.7,"bytes":3567488}\n' },
        { exit: { exit_code: code, timed_out: false } },
      ];
      const result = await runCommand(streaming(frames), 'cmp_1', 'node worker.ts', {
        check: false,
      });
      expect(result).toMatchObject({ exitCode: -1, exited: false, timedOut: false });
      await expect(runCommand(streaming(frames), 'cmp_1', 'node worker.ts')).rejects.toThrow(
        CommandFailed,
      );
    }
  });

  it('keeps what a command printed before its stream broke', async () => {
    const client = {
      computers: {
        execStream: async function* () {
          yield { stderr: 'TYPE_CARD_LAYOUT at scene "a", text "b": too long.\n' };
          throw new Error('ended without an exit frame');
        },
      },
    } as unknown as Naive;
    const error = await runCommand(client, 'cmp_1', 'node worker.ts').catch((cause) => cause);
    expect(outputOf(error)).toEqual({
      stdout: '',
      stderr: 'TYPE_CARD_LAYOUT at scene "a", text "b": too long.\n',
    });
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
