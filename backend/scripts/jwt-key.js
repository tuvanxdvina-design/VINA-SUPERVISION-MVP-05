// Local maintenance only. Never print secret values or hashes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dotenv = require('dotenv');

function fail(code) { throw Object.assign(new Error(code), { safeCode: code }); }
function readKey(file) {
  if (!fs.existsSync(file)) return { state: 'MISSING' };
  if (!fs.lstatSync(file).isFile()) fail('ENV_NOT_REGULAR_FILE');
  const bytes = fs.readFileSync(file), text = bytes.toString('utf8');
  const lines = [...text.matchAll(/^[\t \uFEFF]*(?:export[\t ]+)?JWT_SECRET[\t ]*=.*$/gm)];
  if (lines.length > 1) fail('DUPLICATE_JWT_SECRET');
  const secret = dotenv.parse(text).JWT_SECRET;
  if (secret && (lines.length !== 1 || /[\r\n]/.test(secret))) fail('UNSUPPORTED_JWT_LINE');
  return { state: secret ? 'PRESENT' : 'MISSING', secret, text, bytes, lines };
}
function run(argv) {
  const command = argv.shift();
  let root = path.resolve(__dirname, '../..'), offlineCleared = false;
  while (argv.length) {
    const arg = argv.shift();
    if (arg === '--root' && argv[0] && !argv[0].startsWith('--')) root = path.resolve(argv.shift());
    else if (arg === '--offline-cleared') offlineCleared = true;
    else fail('UNKNOWN_ARGUMENT');
  }
  if (!['check', 'rotate'].includes(command)) fail('USE_CHECK_OR_ROTATE');
  if (path.basename(root).toUpperCase() !== 'VINA-SUPERVISION-MVP-05') fail('ROOT_MUST_BE_MVP05');
  const envFile = path.join(root, 'backend/.env'), backup = envFile + '.bak';
  const parent = path.dirname(root);
  const keys = {
    mvp05: readKey(envFile),
    mvp03: readKey(path.join(parent, 'VINA-SUPERVISION-MVP-03/backend/.env')),
    mvp04: readKey(path.join(parent, 'VINA-SUPERVISION-MVP-04/backend/.env'))
  };
  const override = Object.hasOwn(process.env, 'JWT_SECRET');
  const result = () => ({
    status: 'CHECKED',
    keys: Object.fromEntries(Object.entries(keys).map(([name, k]) => [name, k.state])),
    mvp05EqualsMvp03: keys.mvp05.secret && keys.mvp03.secret ? keys.mvp05.secret === keys.mvp03.secret : null,
    mvp05EqualsMvp04: keys.mvp05.secret && keys.mvp04.secret ? keys.mvp05.secret === keys.mvp04.secret : null,
    processJwtOverridePresent: override,
    backupExists: fs.existsSync(backup)
  });
  if (command === 'check') return result();
  if (!offlineCleared) fail('OPERATOR_OFFLINE_CONFIRMATION_REQUIRED');
  if (override) fail('PROCESS_JWT_OVERRIDE_PRESENT');
  if (Object.values(keys).some(k => k.state !== 'PRESENT')) fail('ALL_THREE_KEYS_REQUIRED');
  if (fs.existsSync(backup)) fail('BACKUP_ALREADY_EXISTS');

  let secret;
  do { secret = crypto.randomBytes(48).toString('hex'); }
  while (Object.values(keys).some(k => k.secret === secret));
  const original = keys.mvp05;
  const match = original.lines[0];
  const replacement = (match[0].startsWith('\uFEFF') ? '\uFEFF' : '') + 'JWT_SECRET=' + secret + (match[0].endsWith('\r') ? '\r' : '');
  const updated = original.text.slice(0, match.index) + replacement + original.text.slice(match.index + match[0].length);
  // Exclusive backup and same-directory rename: refuse to overwrite a prior backup.
  const mode = fs.statSync(envFile).mode & 0o777;
  const backupFd = fs.openSync(backup, 'wx', 0o600);
  try { fs.writeFileSync(backupFd, original.bytes); } finally { fs.closeSync(backupFd); }
  const temp = envFile + '.jwt-' + crypto.randomBytes(8).toString('hex') + '.tmp';
  try {
    fs.writeFileSync(temp, updated, { flag: 'wx', mode });
    fs.renameSync(temp, envFile);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
  keys.mvp05 = readKey(envFile);
  if (keys.mvp05.secret !== secret) fail('WRITE_VERIFICATION_FAILED_KEEP_BACKUP');
  return { ...result(), status: 'KEY_UPDATED_RESTART_REQUIRED', differentFromBackup: secret !== original.secret };
}
try {
  console.log(JSON.stringify(run(process.argv.slice(2)), null, 2));
} catch (error) {
  // Error messages from parsers/filesystem could expose inputs; return a code only.
  console.error(JSON.stringify({ status: 'FAILED', code: error.safeCode || 'LOCAL_IO_FAILED' }));
  process.exitCode = 1;
}
