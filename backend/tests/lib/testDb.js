// Dựng CSDL thử và khởi động backend cho các bộ kiểm thử (regression + giao diện).
// Tách ra từ regression.test.js để hai bộ dùng chung một cách dựng dữ liệu.
// Dùng psql cài trên Windows nếu có; nếu không thì dùng PostgreSQL trong Docker của dự án.
const { execFileSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..', '..');
let containerId = '';

function dockerContainer() {
  if (!containerId) {
    containerId = execFileSync('docker', ['compose', 'ps', '-q', 'postgres'], { cwd: ROOT, encoding: 'utf8' }).trim();
    if (!containerId) throw new Error('Khong tim thay container PostgreSQL cua du an hien tai');
  }
  return containerId;
}

function hasNativePsql() {
  try { execFileSync('psql', ['--version'], { stdio: 'ignore' }); return true; } catch (_) { return false; }
}
const nativePsql = hasNativePsql();
const dbFromUrl = (url) => new URL(url).pathname.slice(1);
const dbUserFromUrl = (url) => decodeURIComponent(new URL(url).username);

function createTestDb(dbUrl) {
  const u = new URL(dbUrl);
  const dbName = u.pathname.slice(1);
  if (!/^vina_(reg|ui)[a-z0-9_]*$/.test(dbName)) throw new Error('Chỉ cho phép CSDL thử riêng vina_reg* hoặc vina_ui*');
  const adminUrl = new URL(dbUrl); adminUrl.pathname = '/postgres';

  function psql(sql, url = dbUrl) {
    if (nativePsql) return execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-qtA', '-c', sql], { encoding: 'utf8' }).trim();
    return execFileSync('docker', ['exec', dockerContainer(), 'psql', '-U', dbUserFromUrl(url), '-d', dbFromUrl(url), '-v', 'ON_ERROR_STOP=1', '-qtA', '-c', sql], { encoding: 'utf8' }).trim();
  }

  function psqlFile(file) {
    if (nativePsql) { execFileSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-q', '-f', file], { stdio: 'pipe' }); return; }
    // Tên riêng theo CSDL + tiến trình: hai bộ kiểm thử chạy song song (giao diện + regression)
    // dùng chung /tmp của container, dùng tên chung thì bộ này xoá tệp lúc bộ kia đang nạp.
    const remote = '/tmp/vina-test-' + dbName + '-' + process.pid + '-' + path.basename(file);
    execFileSync('docker', ['cp', file, dockerContainer() + ':' + remote], { stdio: 'pipe' });
    try { execFileSync('docker', ['exec', dockerContainer(), 'psql', '-U', dbUserFromUrl(dbUrl), '-d', dbName, '-v', 'ON_ERROR_STOP=1', '-q', '-f', remote], { stdio: 'pipe' }); }
    finally { try { execFileSync('docker', ['exec', dockerContainer(), 'rm', '-f', remote], { stdio: 'ignore' }); } catch (_) {} }
  }

  function resetDatabase() {
    if (nativePsql) {
      psql('DROP DATABASE IF EXISTS ' + dbName, adminUrl.href);
      psql('CREATE DATABASE ' + dbName, adminUrl.href);
      return;
    }
    execFileSync('docker', ['exec', dockerContainer(), 'dropdb', '-U', 'postgres', '--if-exists', dbName], { stdio: 'pipe' });
    execFileSync('docker', ['exec', dockerContainer(), 'createdb', '-U', 'postgres', '-O', dbUserFromUrl(dbUrl), dbName], { stdio: 'pipe' });
  }

  function migrationFiles() {
    return fs.readdirSync(path.join(ROOT, 'migrations')).filter(f => /^\d{8}_.+\.sql$/.test(f)).sort();
  }

  // Dữ liệu lỗi giống thực tế (nhân sự trùng tên NFD/khoảng trắng, nhật ký không có ca,
  // mã ca MORNING, phân công Admin tự sinh) để migration được kiểm trên dữ liệu bẩn.
  function seedRealisticMess() {
    const nfd = 'Nguyễn Thành B'.normalize('NFD');
    psql(`
    INSERT INTO users (username,email,password_hash,full_name,role_id) SELECT 'admin','a@x','demo_hash','Admin',id FROM roles WHERE name='ADMIN';
    INSERT INTO users (username,email,password_hash,full_name,role_id) SELECT 'thanhb','b@x','demo_hash','Nguyễn Thành B',id FROM roles WHERE name='ENGINEER';
    INSERT INTO project_members(project_id,user_id,role_id,assigned_by) SELECT p.id,u.id,u.role_id,u.id FROM projects p,users u WHERE p.contract_no='001' AND u.username='admin';
    INSERT INTO project_members(project_id,user_id,role_id) SELECT p.id,u.id,u.role_id FROM projects p,users u WHERE p.contract_no='001' AND u.username='thanhb';
    INSERT INTO project_personnel(project_id,full_name,assignment_title,certificate,updated_at) SELECT id,'${nfd}','TVGS trưởng','CC-1',NOW()-interval '1 day' FROM projects WHERE contract_no='001';
    INSERT INTO project_personnel(project_id,full_name,assignment_title) SELECT id,'Nguyễn  Thành B','GS viên' FROM projects WHERE contract_no='001';
    INSERT INTO project_personnel(project_id,full_name,assignment_title) SELECT id,'Trần Văn C','GS hiện trường' FROM projects WHERE contract_no='001';
    INSERT INTO daily_logs(project_id,log_date,shift,work_summary,created_by) SELECT p.id,'2026-09-18','MORNING','seed',u.id FROM projects p,users u WHERE p.contract_no='001' AND u.username='hung';
    INSERT INTO daily_logs(project_id,log_date,work_summary,created_by) SELECT p.id,'2026-09-21','a',u.id FROM projects p,users u WHERE p.contract_no='001' AND u.username='hung';
    INSERT INTO daily_logs(project_id,log_date,work_summary,created_by) SELECT p.id,'2026-09-21','b',u.id FROM projects p,users u WHERE p.contract_no='001' AND u.username='son';
    INSERT INTO documents(project_id,type,auto_code,name,created_by) SELECT p.id,'BB','BB-001-001','seed',u.id FROM projects p,users u WHERE p.contract_no='001' AND u.username='hung';
    `);
  }

  // Dựng CSDL từ schema gốc + migration CŨ, nạp dữ liệu lỗi, rồi chạy migration MỚI (như migrate-db.ps1).
  function setupAll() {
    resetDatabase();
    psql('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    psqlFile(path.join(ROOT, 'schema-VINA-PROD-01.sql'));
    const all = migrationFiles();
    for (const f of all.filter(f => f < '20260926')) psqlFile(path.join(ROOT, 'migrations', f));
    psql(`CREATE TABLE IF NOT EXISTS project_member_access (project_member_id uuid PRIMARY KEY REFERENCES project_members(id) ON DELETE CASCADE, access_permissions jsonb NOT NULL DEFAULT '["VIEW"]'::jsonb, work_scope text, updated_at timestamptz NOT NULL DEFAULT NOW())`);
    seedRealisticMess();
    for (const f of all.filter(f => f >= '20260926')) psqlFile(path.join(ROOT, 'migrations', f));
    // Mirror migrate-db.ps1: /health must report the same applied files in isolated tests.
    psql('CREATE TABLE IF NOT EXISTS schema_migrations(file_name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT NOW())');
    psql('INSERT INTO schema_migrations(file_name) VALUES '+all.map(f=>"('"+f+"')").join(',')+' ON CONFLICT DO NOTHING');
  }

  function startServer({ port }) {
    return spawn(process.execPath, ['server.js'], {
      cwd: path.join(ROOT, 'backend'),
      env: {
        ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'development',
        JWT_SECRET: require('crypto').randomBytes(48).toString('hex'),
        DB_HOST: u.hostname, DB_PORT: u.port || '5432',
        DB_USER: decodeURIComponent(u.username), DB_PASSWORD: decodeURIComponent(u.password), DB_NAME: dbName
      },
      stdio: 'ignore'
    });
  }

  async function waitHealth(baseUrl, tries = 40) {
    for (let i = 0; i < tries; i++) {
      try { if ((await fetch(baseUrl + '/health')).ok) return; } catch (_) {}
      await new Promise(r => setTimeout(r, 250));
    }
    throw new Error('Backend không phản hồi /health ở ' + baseUrl + ' — xem backend/runtime.stderr.log');
  }

  return { dbName, psql, psqlFile, setupAll, startServer, waitHealth, ROOT };
}

module.exports = { createTestDb };
