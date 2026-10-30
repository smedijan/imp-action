const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { extraArguments, diffBase, validateBase, releaseTag, assetName, verifyChecksum, executeImp } = require('../src/imp');

const event = {
  repository: { default_branch: 'trunk' },
  pull_request: { base: { sha: 'pr-base' } },
  merge_group: { base_sha: 'queue-base' },
};

test('default branch runs fully; other branches compare to default branch', () => {
  assert.equal(diffBase('auto', 'push', event, 'refs/heads/trunk'), '');
  assert.equal(diffBase('auto', 'push', event, 'refs/heads/feature'), 'refs/remotes/origin/trunk');
  assert.equal(diffBase('auto', 'workflow_dispatch', event, 'refs/heads/trunk'), '');
});

test('PR and merge queue select event base commits', () => {
  for (const name of ['pull_request', 'pull_request_target']) {
    assert.equal(diffBase('auto', name, event, 'refs/pull/1/merge'), 'pr-base');
  }
  assert.equal(diffBase('auto', 'merge_group', event, 'refs/heads/gh-readonly-queue/trunk/x'), 'queue-base');
});

test('explicit diff modes do not need event metadata', () => {
  assert.equal(diffBase('off'), '');
  assert.equal(diffBase('HEAD~1'), 'HEAD~1');
});

test('missing metadata fails clearly', () => {
  assert.throws(() => diffBase('auto', 'push', {}, ''), /Cannot detect default branch/);
  assert.throws(() => diffBase('auto', 'pull_request', {}, ''), /Missing PR/);
  assert.throws(() => diffBase('auto', 'merge_group', {}, ''), /Missing merge-group/);
});

test('arguments preserve spaces, commas and shell metacharacters', () => {
  assert.deepEqual(extraArguments('--output=a b.json\r\n\n--exclude-files=a{1,2}\n$(touch /tmp/never)'),
    ['--output=a b.json', '--exclude-files=a{1,2}', '$(touch /tmp/never)']);
  assert.deepEqual(extraArguments(), []);
  for (const arg of ['--diff', '--diff=main', '-Dmain', '-D', '--dif=main', '--']) {
    assert.throws(() => extraArguments(arg));
  }
});

test('version resolution validates both explicit and API-provided tags', async () => {
  assert.equal(await releaseTag('0.8.0'), 'v0.8.0');
  assert.equal(await releaseTag('v0.8.0'), 'v0.8.0');
  assert.equal(await releaseTag('latest', async () => ({ ok: true, json: async () => ({ tag_name: 'v0.8.0' }) })), 'v0.8.0');
  await assert.rejects(releaseTag('../../evil'), /version must/);
  await assert.rejects(releaseTag('latest', async () => ({ ok: false, status: 403 })), /HTTP 403/);
  await assert.rejects(releaseTag('latest', async () => ({ ok: true, json: async () => ({ tag_name: '../evil' }) })), /version must/);
});

test('assets match release naming on supported platforms', () => {
  for (const [system, arch, suffix] of [
    ['linux', 'x64', 'linux_amd64'], ['darwin', 'arm64', 'darwin_arm64'], ['win32', 'x64', 'windows_amd64'],
  ]) assert.equal(assetName('v0.8.0', system, arch), `imp_0.8.0_${suffix}.tar.gz`);
  assert.throws(() => assetName('v0.8.0', 'unknown', 'x64'), /Unsupported/);
});

test('checksum must match the exact asset', () => {
  const data = Buffer.from('binary');
  const checksum = createHash('sha256').update(data).digest('hex');
  verifyChecksum(data, `${checksum}  imp.tar.gz\n`, 'imp.tar.gz');
  assert.throws(() => verifyChecksum(Buffer.from('corrupt'), `${checksum}  imp.tar.gz`, 'imp.tar.gz'), /Checksum/);
  assert.throws(() => verifyChecksum(data, `${checksum}  other.tar.gz`, 'imp.tar.gz'), /Checksum/);
});

test('missing history fails with checkout guidance; off needs no git', () => {
  validateBase('', () => { throw new Error('should not run'); });
  assert.throws(() => validateBase('-option'), /must not start/);
  assert.throws(() => validateBase('missing', () => ({ status: 1 })), /fetch-depth: 0/);
});

test('execution preserves literal arguments, clears configured diff, and propagates exit status', () => {
  const status = executeImp('/tmp/imp', ['--output=a b.json'], '', (binary, args, options) => {
    assert.equal(binary, '/tmp/imp');
    assert.deepEqual(args, ['run', '--output=a b.json', '--diff=']);
    assert.deepEqual(options, { stdio: 'inherit' });
    return { status: 3 };
  });
  assert.equal(status, 3);
  assert.throws(() => executeImp('imp', [], '', () => ({ error: new Error('spawn failed') })), /spawn failed/);
  assert.throws(() => executeImp('imp', [], '', () => ({ signal: 'SIGTERM' })), /SIGTERM/);
});

test('real Git history supports both PR-head and synthetic-merge checkouts', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'imp-action-test-'));
  const git = args => spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
  const checked = args => {
    const result = git(args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    checked(['init']);
    checked(['config', 'user.email', 'test@example.com']);
    checked(['config', 'user.name', 'Test']);
    checked(['commit', '--allow-empty', '-m', 'base']);
    const base = checked(['rev-parse', 'HEAD']);
    checked(['checkout', '-b', 'feature']);
    checked(['commit', '--allow-empty', '-m', 'feature']);
    validateBase(base, git);
    checked(['checkout', '-b', 'integration', base]);
    checked(['commit', '--allow-empty', '-m', 'advance base']);
    checked(['merge', '--no-ff', 'feature', '-m', 'synthetic merge']);
    validateBase(base, git);
    assert.throws(() => validateBase('missing', git), /fetch-depth/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
