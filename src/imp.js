const { createHash } = require('node:crypto');
const { readFile, rm } = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const tools = require('@actions/tool-cache');

const repository = 'https://github.com/smedijan/go-imp';

function extraArguments(value = '') {
  const args = value.split(/\r?\n/).filter(arg => arg !== '');
  for (const arg of args) {
    // Cobra accepts abbreviated long flags too. Reserve all prefixes of --diff.
    const flag = arg.split('=')[0];
    if (arg.startsWith('-D') || (flag.startsWith('--') && '--diff'.startsWith(flag))) {
      throw new Error('Use the diff input instead of passing --diff/-D in args');
    }
    // Positionals and -- could prevent the managed diff flag being parsed.
    if (arg === '--') throw new Error('Do not pass -- in args');
  }
  return args;
}

function diffBase(mode, eventName, event, ref) {
  if (mode === 'off') return '';
  if (mode !== 'auto') return mode;
  if (eventName === 'pull_request' || eventName === 'pull_request_target') {
    if (!event.pull_request?.base?.sha) throw new Error('Missing PR base commit');
    return event.pull_request.base.sha;
  }
  if (eventName === 'merge_group') {
    if (!event.merge_group?.base_sha) throw new Error('Missing merge-group base commit');
    return event.merge_group.base_sha;
  }
  const branch = event.repository?.default_branch;
  if (!branch) throw new Error('Cannot detect default branch; set diff to off or an explicit Git ref');
  return ref === `refs/heads/${branch}` ? '' : `refs/remotes/origin/${branch}`;
}

function validateBase(base, git = args => spawnSync('git', args, { encoding: 'utf8' })) {
  if (!base) return;
  if (base.startsWith('-')) throw new Error('Diff ref must not start with -');
  for (const args of [
    ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`],
    ['merge-base', 'HEAD', base],
  ]) {
    const result = git(args);
    if (result.error || result.status !== 0) {
      throw new Error(`Diff base '${base}' is unavailable or has no merge-base; use actions/checkout with fetch-depth: 0`);
    }
  }
}

async function releaseTag(version, request = fetch) {
  if (version === 'latest') {
    // The public redirect avoids the unauthenticated REST API rate limit shared
    // by hosted runners, without requiring a token or an additional input.
    const response = await request(`${repository}/releases/latest`, {
      method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) throw new Error(`Release lookup failed: HTTP ${response.status}`);
    const url = new URL(response.url);
    if (url.origin !== 'https://github.com' || !url.pathname.startsWith('/smedijan/go-imp/releases/tag/')) {
      throw new Error('Unexpected release redirect');
    }
    version = decodeURIComponent(url.pathname.slice('/smedijan/go-imp/releases/tag/'.length));
  }
  if (typeof version !== 'string' || !/^v?\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)) {
    throw new Error('version must be latest or a release version, e.g. v0.8.0');
  }
  return `v${version.replace(/^v/, '')}`;
}

function assetName(tag, platform = process.platform, arch = process.arch) {
  const systems = { linux: 'linux', darwin: 'darwin', win32: 'windows' };
  const arches = { x64: 'amd64', arm64: 'arm64', ia32: '386' };
  if (!systems[platform] || !arches[arch]) throw new Error(`Unsupported runner: ${platform}/${arch}`);
  return `imp_${tag.slice(1)}_${systems[platform]}_${arches[arch]}.tar.gz`;
}

function verifyChecksum(archive, checksums, asset) {
  const expected = checksums.split(/\r?\n/).map(line => line.trim().split(/\s+/))
    .find(parts => parts.length === 2 && parts[1] === asset)?.[0];
  const actual = createHash('sha256').update(archive).digest('hex');
  if (!expected || actual !== expected.toLowerCase()) throw new Error(`Checksum verification failed for ${asset}`);
}

async function install(tag, platform = process.platform, arch = process.arch) {
  const asset = assetName(tag, platform, arch);
  const base = `${repository}/releases/download/${tag}`;
  let checksums, archive, directory;
  try {
    checksums = await tools.downloadTool(`${base}/checksums.txt`);
    archive = await tools.downloadTool(`${base}/${asset}`);
    verifyChecksum(await readFile(archive), await readFile(checksums, 'utf8'), asset);
    directory = await tools.extractTar(archive);
    return { binary: path.join(directory, platform === 'win32' ? 'imp.exe' : 'imp'), directory };
  } catch (error) {
    if (directory) await rm(directory, { recursive: true, force: true });
    throw error;
  } finally {
    await Promise.all([checksums, archive].filter(Boolean).map(file => rm(file, { force: true })));
  }
}

function gitEnvironment(env = process.env) {
  // imp parses Git's CombinedOutput: line-ending warnings on stderr otherwise
  // corrupt the patch on Windows. Disable only this warning, only for the child;
  // retain the user's line-ending conversion and on-disk Git configuration.
  const count = Number(env.GIT_CONFIG_COUNT || 0);
  return {
    ...env,
    GIT_CONFIG_COUNT: String(count + 1),
    [`GIT_CONFIG_KEY_${count}`]: 'core.safecrlf',
    [`GIT_CONFIG_VALUE_${count}`]: 'false',
  };
}

function executeImp(binary, args, base, spawn = spawnSync) {
  // Empty diff explicitly disables a diff configured in .imp.yaml or the environment.
  const result = spawn(binary, ['run', ...args, `--diff=${base}`], { stdio: 'inherit', env: gitEnvironment() });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`imp terminated by ${result.signal}`);
  return result.status;
}

async function run(inputs, env = process.env) {
  const args = extraArguments(inputs.args);
  const mode = inputs.diff || 'auto';
  const event = mode === 'auto' ? JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8')) : {};
  const base = diffBase(mode, env.GITHUB_EVENT_NAME, event, env.GITHUB_REF);
  validateBase(base);
  const tag = await releaseTag(inputs.version || 'latest');
  const { binary, directory } = await install(tag);
  try {
    console.log(`Running imp ${tag} (diff: ${base || 'off'})`);
    return executeImp(binary, args, base);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

module.exports = { extraArguments, diffBase, validateBase, releaseTag, assetName, verifyChecksum, install, gitEnvironment, executeImp, run };
