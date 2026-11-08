/**
 * What goes into the base snapshot every film computer is forked from, as shell scripts. Pure
 * functions, so a test can read them; `build-snapshot.ts` runs them on a builder computer.
 *
 * Two checkouts of the public repo, cloned over https so no GitHub credential goes near a computer:
 *
 * - `$HOME/boiler-room` at the crew commit, with its dependencies, for the film command and the
 *   renderer. The Remotion browser is fetched here.
 * - `$HOME/film-runner-src` at the runner commit, with `$HOME/film-runner` linked to its
 *   `services/film-runner`. The runner needs no dependencies: Node 24 runs its TypeScript.
 *
 * Once the film command is on `dev`, both commits can be the same one.
 */

/**
 * Remotion's Chrome libraries for Ubuntu 24.04 and the fallback fonts, as the render service
 * installs them (`services/render/src/naive/base.ts`), plus what the runner itself uses.
 */
export const APT_PACKAGES = [
  'libnss3',
  'libdbus-1-3',
  'libatk1.0-0',
  'libasound2t64',
  'libxrandr2',
  'libxkbcommon-dev',
  'libxfixes3',
  'libxcomposite1',
  'libxdamage1',
  'libgbm-dev',
  'libcups2',
  'libcairo2',
  'libpango-1.0-0',
  'libatk-bridge2.0-0',
  'fonts-liberation',
  'fonts-noto-core',
  'fonts-noto-cjk',
  'git',
  'util-linux',
  'procps',
  'ca-certificates',
];

export const PNPM_VERSION = '10.30.3';
export const SWAPFILE = '/swapfile';
export const SWAP_GB = 4;

export interface RecipeInput {
  repoUrl: string;
  /** The crew commit: the film command and the renderer. */
  filmCommit: string;
  /** This package's commit. */
  runnerCommit: string;
  /** `film`, or `standin` until the film command has the contract. `auto` picks by the checkout. */
  adapter: 'film' | 'standin' | 'auto';
}

const sha = /^[0-9a-f]{40}$/;

export function checkInput(input: RecipeInput) {
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(\.git)?$/.test(input.repoUrl)) {
    throw new Error(`The repo URL must be a public https GitHub URL: ${input.repoUrl}`);
  }
  if (!sha.test(input.filmCommit) || !sha.test(input.runnerCommit)) {
    throw new Error('Both commits must be full 40-character SHAs.');
  }
}

/**
 * The setup, run detached on the builder (it outlasts one exec) and polled. A ticker keeps the log
 * moving so a poll can tell it is alive.
 */
export function setupScript(input: RecipeInput): string {
  checkInput(input);
  return `set -euo pipefail
( while true; do echo "setup: working"; sleep 20; done ) &
ticker=$!
trap 'kill $ticker 2>/dev/null || true' EXIT
export DEBIAN_FRONTEND=noninteractive
echo "setup: packages"
sudo -E apt-get update -qq
sudo -E apt-get install -y -qq --no-install-recommends ${APT_PACKAGES.join(' ')} > /dev/null

echo "setup: swap"
if [ ! -f ${SWAPFILE} ]; then
  sudo fallocate -l ${SWAP_GB}G ${SWAPFILE} || sudo dd if=/dev/zero of=${SWAPFILE} bs=1M count=${SWAP_GB * 1024} status=none
  sudo chmod 600 ${SWAPFILE}
  sudo mkswap ${SWAPFILE} > /dev/null
fi
grep -q '^${SWAPFILE} ' /etc/fstab || echo '${SWAPFILE} none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
sudo swapon ${SWAPFILE} 2>/dev/null || true

echo "setup: pnpm ${PNPM_VERSION}"
if ! pnpm --version 2>/dev/null | grep -qx '${PNPM_VERSION}'; then
  sudo npm install -g --no-audit --no-fund --loglevel=error pnpm@${PNPM_VERSION}
fi
pnpm --version

echo "setup: the crew checkout at ${input.filmCommit}"
rm -rf "$HOME/boiler-room"
git clone --quiet ${input.repoUrl} "$HOME/boiler-room"
git -C "$HOME/boiler-room" checkout --quiet --detach ${input.filmCommit}

echo "setup: the runner checkout at ${input.runnerCommit}"
rm -rf "$HOME/film-runner-src" "$HOME/film-runner"
git clone --quiet ${input.repoUrl} "$HOME/film-runner-src"
git -C "$HOME/film-runner-src" checkout --quiet --detach ${input.runnerCommit}
ln -s "$HOME/film-runner-src/services/film-runner" "$HOME/film-runner"

echo "setup: dependencies"
cd "$HOME/boiler-room"
filters="--filter @boiler-room/render..."
if [ -d agents ]; then filters="$filters --filter @boiler-room/agents..."; fi
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 CI=1 pnpm install --frozen-lockfile $filters

echo "setup: the Remotion browser"
cd "$HOME/boiler-room/services/render"
node -e "import('@remotion/renderer').then((r) => r.ensureBrowser())"

echo "setup: the runner's config"
adapter='${input.adapter}'
if [ "$adapter" = auto ]; then
  if node -e "process.exit(require('$HOME/boiler-room/package.json').scripts?.film ? 0 : 1)"; then adapter=film; else adapter=standin; fi
fi
cat > "$HOME/.film-runner.json" <<CONFIG
{
  "adapter": "$adapter",
  "runnerCommit": "${input.runnerCommit}",
  "filmCommit": "${input.filmCommit}",
  "filmDir": "$HOME/boiler-room",
  "swapfile": "${SWAPFILE}",
  "envFile": "$HOME/.boiler-room.env"
}
CONFIG
echo "setup: adapter $adapter"
echo "setup: done"
`;
}

/** `swapon` as sudo resolves it, so the one sudoers rule matches what the runner runs. */
const SWAPON = '$(PATH=/usr/sbin:/sbin:/usr/bin:/bin command -v swapon)';

/**
 * The ready check, one exec on the builder and again on a fork: swap is there, the renderer loads
 * and its browser launches, and the runner's self-test passes. With the `film` adapter, the film
 * command itself answers `--help` with the runner's contract (`--phase`), run as the runner runs
 * it. On a fork (`sudoLocked`) it also checks that `sudo` grants nothing but `swapon <swapfile>`.
 * Prints `READY` last when all pass.
 */
export function readyCheck({
  allowRunDir = false,
  sudoLocked = false,
}: {
  allowRunDir?: boolean;
  sudoLocked?: boolean;
} = {}): string {
  const sudoCheck = sudoLocked
    ? `sudo -k
if sudo -n true 2>/dev/null; then echo "sudo: still open"; exit 1; fi
sudo -n -l "${SWAPON}" ${SWAPFILE} > /dev/null
echo "sudo: swapon only"
`
    : '';
  return `set -euo pipefail
sudo -n swapon ${SWAPFILE} 2>/dev/null || true
swapon --show=NAME --noheadings | grep -qx '${SWAPFILE}'
echo "swap: on"
${sudoCheck}cd "$HOME/boiler-room/services/render"
node -e "import('@remotion/renderer').then(async (r) => { await r.ensureBrowser(); const b = await r.openBrowser('chrome'); await b.close({ silent: true }); console.log('browser: launches') })"
cd "$HOME/film-runner"
node src/main.ts --self-test${allowRunDir ? ' --allow-run-dir' : ''}
if grep -q '"adapter": "film"' "$HOME/.film-runner.json"; then
  cd "$HOME/boiler-room"
  help="$(CI=1 pnpm run --silent film --help)"
  grep -qF -- '--phase script|render|all' <<<"$help"
  echo "film command: --help answers with --phase"
fi
echo READY
`;
}

/**
 * The last step on the builder: the film user keeps one sudo rule, \`swapon <swapfile>\` (the
 * runner turns swap on at every start), and loses every other grant: the files in sudoers.d, any
 * NOPASSWD line in /etc/sudoers, and the sudo, admin and wheel groups. The film command drives
 * agents on content from a customer's URL, so it must not run as root. Each file is checked with
 * \`visudo\` before it is installed.
 */
export const LOCK_SUDO_SCRIPT = `set -euo pipefail
user="$(id -un)"
swapon_bin="${SWAPON}"
rule="$(mktemp)"
main="$(mktemp)"
echo "$user ALL=(root) NOPASSWD: $swapon_bin ${SWAPFILE}" > "$rule"
sudo cat /etc/sudoers > "$main"
sed -i -E 's/^([^#].*NOPASSWD.*)$/# br-film: \\1/' "$main"
sudo visudo -cqf "$rule"
sudo visudo -cqf "$main"
for file in /etc/sudoers.d/*; do
  if [ -f "$file" ] && [ "$file" != /etc/sudoers.d/README ]; then echo "sudo: removing $(basename "$file")"; fi
done
# One root shell for every change, since the grant it runs under may be one of the files it removes.
sudo sh -euc '
  install -m 0440 -o root -g root "$2" /etc/sudoers.d/zz-br-film
  find /etc/sudoers.d -mindepth 1 ! -name zz-br-film ! -name README -delete
  for group in sudo admin wheel; do
    if id -nG "$3" | tr " " "\\n" | grep -qx "$group"; then gpasswd -d "$3" "$group" > /dev/null; fi
  done
  install -m 0440 -o root -g root "$1" /etc/sudoers
  visudo -cq
' sh "$main" "$rule" "$user"
rm -f "$rule" "$main"
sudo -k
if sudo -n true 2>/dev/null; then echo "sudo: still open"; exit 1; fi
sudo -n -l "$swapon_bin" ${SWAPFILE} > /dev/null
echo "sudo: narrowed to $swapon_bin ${SWAPFILE}"
`;

/** Leaves the builder clean for the snapshot: no run dir, no build files, no shell history. */
export const CLEAN_SCRIPT = `rm -rf "$HOME/br-run" "$HOME/br-build" "$HOME/.bash_history" "$HOME/.npm/_logs"
sudo rm -rf /root/.bash_history
sync
echo cleaned`;
