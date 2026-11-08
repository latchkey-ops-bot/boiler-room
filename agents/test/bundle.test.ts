import { describe, expect, it } from 'vitest';
import { bundleTool } from '../src/researcher/bundle.ts';

/** The private hosts a build allows, as esbuild compiled them in. */
const allowed = (code: string) =>
  /var define_BR_ALLOW_PRIVATE_HOSTS_default = (\[[^\]]*\]);/.exec(code)?.[1];

describe('bundleTool', () => {
  it('builds the production tool with no private host allowed', async () => {
    expect(allowed((await bundleTool()).code)).toBe('[]');
  });

  it('compiles a private host into a separate build only when asked, with its own digest', async () => {
    const [plain, test] = await Promise.all([
      bundleTool(),
      bundleTool({ allowPrivateHosts: ['127.0.0.1.nip.io'] }),
    ]);
    expect(allowed(test.code)).toBe('["127.0.0.1.nip.io"]');
    expect(test.sha256).not.toBe(plain.sha256);
  });
});
