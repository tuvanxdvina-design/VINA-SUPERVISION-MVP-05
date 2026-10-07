const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');
const script = path.resolve(__dirname, '../scripts/jwt-key.js');
function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'vina-jwt-test-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const files = {};
  for (const version of ['03', '04', '05']) {
    const dir = path.join(base, 'VINA-SUPERVISION-MVP-' + version, 'backend');
    fs.mkdirSync(dir, { recursive: true });
    files[version] = path.join(dir, '.env');
    fs.writeFileSync(files[version], 'DB_NAME=fixture_' + version + '\r\nJWT_SECRET="fixture-value-' + version + '" # comment\r\nPORT=3004\r\n');
  }
  return { files, root: path.dirname(path.dirname(files['05'])) };
}
function invoke(f, command, extra = [], overrides = {}) {
  const env = { ...process.env };
  delete env.JWT_SECRET;
  Object.assign(env, overrides);
  const child = spawnSync(process.execPath, [script, command, '--root', f.root, ...extra], { env, encoding: 'utf8' });
  return { exit: child.status, out: child.stdout, err: child.stderr, data: JSON.parse(child.status ? child.stderr : child.stdout) };
}
test('JWT check compares parsed keys without exposing secrets or writing files', t => {
  const f = fixture(t);
  fs.writeFileSync(f.files['03'], fs.readFileSync(f.files['05']));
  const before = fs.readFileSync(f.files['05']);
  const r = invoke(f, 'check');
  assert.equal(r.exit, 0);assert.equal(r.data.mvp05EqualsMvp03, true);assert.equal(r.data.mvp05EqualsMvp04, false);
  assert.equal(r.data.backupExists, false);
  assert.doesNotMatch(r.out + r.err, /fixture-value-/);
  assert.deepEqual(fs.readFileSync(f.files['05']), before);
});
test('JWT rotate requires operator confirmation and refuses environment overrides', t => {
  const f = fixture(t), before = fs.readFileSync(f.files['05']);
  assert.equal(invoke(f, 'rotate').data.code, 'OPERATOR_OFFLINE_CONFIRMATION_REQUIRED');
  const blocked = invoke(f, 'rotate', ['--offline-cleared'], { JWT_SECRET: 'fixture-process-override' });
  assert.equal(blocked.data.code, 'PROCESS_JWT_OVERRIDE_PRESENT');
  assert.deepEqual(fs.readFileSync(f.files['05']), before);assert.equal(fs.existsSync(f.files['05'] + '.bak'), false);
});
test('JWT rotate changes only MVP05, preserves bytes in backup and emits no secret', t => {
  const f = fixture(t), before = Object.fromEntries(Object.entries(f.files).map(([v, file]) => [v, fs.readFileSync(file)]));
  const r = invoke(f, 'rotate', ['--offline-cleared']);
  assert.equal(r.exit, 0);assert.equal(r.data.status, 'KEY_UPDATED_RESTART_REQUIRED');
  assert.equal(r.data.mvp05EqualsMvp03, false);assert.equal(r.data.mvp05EqualsMvp04, false);assert.equal(r.data.differentFromBackup, true);
  const text = fs.readFileSync(f.files['05'], 'utf8'), secret = dotenv.parse(text).JWT_SECRET;
  assert.match(secret, /^[a-f0-9]{96}$/);assert.ok(!r.out.includes(secret));
  assert.doesNotMatch(r.out + r.err, /fixture-value-/);
  assert.deepEqual(fs.readFileSync(f.files['05'] + '.bak'), before['05']);
  for (const v of ['03', '04']) assert.deepEqual(fs.readFileSync(f.files[v]), before[v]);
  assert.ok(text.startsWith('DB_NAME=fixture_05\r\n'));assert.ok(text.endsWith('\r\nPORT=3004\r\n'));
});
test('JWT rotate refuses duplicate keys, missing references and existing backup', t => {
  const f = fixture(t), before = fs.readFileSync(f.files['05']);
  fs.appendFileSync(f.files['05'], 'JWT_SECRET=fixture-duplicate\n');
  assert.equal(invoke(f, 'rotate', ['--offline-cleared']).data.code, 'DUPLICATE_JWT_SECRET');
  fs.writeFileSync(f.files['05'], before);fs.unlinkSync(f.files['03']);
  assert.equal(invoke(f, 'rotate', ['--offline-cleared']).data.code, 'ALL_THREE_KEYS_REQUIRED');
  fs.writeFileSync(f.files['03'], before);fs.writeFileSync(f.files['05'] + '.bak', 'keep-previous-backup');
  assert.equal(invoke(f, 'rotate', ['--offline-cleared']).data.code, 'BACKUP_ALREADY_EXISTS');
  assert.deepEqual(fs.readFileSync(f.files['05']), before);
  assert.equal(fs.readFileSync(f.files['05'] + '.bak', 'utf8'), 'keep-previous-backup');
});
test('JWT rotation preserves UTF8 BOM and refuses a root outside MVP05', t => {
  const f = fixture(t);
  fs.writeFileSync(f.files['05'], '\uFEFFJWT_SECRET=fixture-bom\r\nPORT=3004\r\n');
  assert.equal(invoke(f, 'rotate', ['--offline-cleared']).exit, 0);
  assert.ok(fs.readFileSync(f.files['05'], 'utf8').startsWith('\uFEFFJWT_SECRET='));
  const rejected = invoke({ root: path.dirname(path.dirname(f.files['04'])) }, 'rotate', ['--offline-cleared']);
  assert.equal(rejected.data.code, 'ROOT_MUST_BE_MVP05');
});
