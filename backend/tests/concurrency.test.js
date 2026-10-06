// CSDL riêng; request thô giữ đúng phiên bản A/B (không dùng helper tự tải phiên bản).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDb } = require('./lib/testDb');
if (!process.env.CONFLICT_TEST_DB_URL) throw new Error('Cần CONFLICT_TEST_DB_URL trỏ CSDL vina_reg* riêng');
const db = createTestDb(process.env.CONFLICT_TEST_DB_URL);
const BASE = 'http://127.0.0.1:3111';
let server, projectId;
const tokens = {};
async function request(method, path, body, who = 'admin') {
  const response = await fetch(BASE + '/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(tokens[who] ? { Authorization: 'Bearer ' + tokens[who] } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
test.before(async () => {
  db.setupAll();server = db.startServer({ port: 3111 });await db.waitHealth(BASE);
  for (const who of ['admin', 'duong']) {
    const login = await request('POST', '/auth/login', { username: who, password: 'demo' }, who);
    assert.equal(login.status, 200);tokens[who] = login.body.token;
  }
  projectId = (await request('GET', '/projects')).body.find(p => p.contract_no === '001').id;
});
test.after(() => { if (server) server.kill(); });

const targets = [
  { route: 'projects', field: 'name', create: () => ({ project_code: 'OCC-P', contract_no: 'OCC-P', name: 'Công trình gốc' }) },
  { route: 'daily-logs', field: 'work_summary', create: () => ({ project_id: projectId, log_date: '2026-10-06', shift: 'OCC', work_summary: 'Công việc gốc' }) },
  { route: 'documents', field: 'name', create: () => ({ project_id: projectId, type: 'HS', name: 'Hồ sơ gốc', doc_group: 'LEGAL', details: { marker: 'MVP05' } }) },
  { route: 'issues', field: 'title', create: () => ({ project_id: projectId, issue_code: 'OCC-I', title: 'Chất lượng gốc', details: { recipients: [{ name: 'Giữ chức năng MVP05' }] } }) }
];
for (const target of targets) {
  test(`OCC ${target.route}: A lưu, B cũ bị từ chối; CAS đồng thời chỉ một người thắng`, async () => {
    const created = await request('POST', '/' + target.route, target.create());assert.equal(created.status, 201);
    const path = '/' + target.route + '/' + created.body.id;
    const required = target.route === 'projects' ? { contract_no: created.body.contract_no } : {};
    const version = created.body.row_version;assert.ok(Number.isSafeInteger(version));
    const a = await request('PATCH', path, { ...required, [target.field]: 'Bản A', expected_row_version: version }, 'duong');
    assert.equal(a.status, 200);assert.equal(a.body.row_version, version + 1);
    const stale = await request('PATCH', path, { ...required, [target.field]: 'Bản B cũ', expected_row_version: version, ...(target.route === 'documents' ? { type: 'BB', details: { stale: true } } : {}) });
    assert.equal(stale.status, 409);assert.equal(stale.body.code, 'EDIT_CONFLICT');
    const current = (await request('GET', path)).body;
    assert.equal(current[target.field], 'Bản A');assert.equal(current.row_version, a.body.row_version);
    if (target.route === 'documents') { assert.equal(current.type, 'HS');assert.deepEqual(current.details, { marker: 'MVP05' }); }
    if (target.route === 'issues') assert.equal(current.details.recipients[0].name, 'Giữ chức năng MVP05');
    for (const invalid of [undefined, null, 0, -1, '1', 1.5]) {
      const rejected = await request('PATCH', path, { ...required, [target.field]: 'Không được ghi', expected_row_version: invalid });
      assert.equal(rejected.status, 409);assert.equal(rejected.body.code, 'ROW_VERSION_REQUIRED');
    }
    const parallel = await Promise.all(['A đồng thời', 'B đồng thời'].map((value, i) => request('PATCH', path, { ...required, [target.field]: value, expected_row_version: current.row_version }, i ? 'admin' : 'duong')));
    assert.deepEqual(parallel.map(x => x.status).sort(), [200, 409]);
    const winner = parallel.find(x => x.status === 200).body;
    const final = (await request('GET', path)).body;
    assert.equal(final[target.field], winner[target.field]);assert.equal(final.row_version, current.row_version + 1);
  });
}
test('OCC đổi trạng thái làm bản sửa cũ hết hiệu lực; migration chạy lại giữ phiên bản', async () => {
  const created = await request('POST', '/documents', { project_id: projectId, type: 'HS', name: 'Quy trình OCC' });
  assert.equal(created.status, 201);
  const path = '/documents/' + created.body.id;
  assert.equal((await request('POST', path + '/submit', {})).status, 200);
  const stale = await request('PATCH', path, { name: 'Bản trước gửi', expected_row_version: created.body.row_version });
  assert.equal(stale.status, 409);assert.equal(stale.body.code, 'EDIT_CONFLICT');
  const before = (await request('GET', path)).body;
  db.psqlFile(require('node:path').join(db.ROOT, 'migrations/20261005_09_optimistic_concurrency.sql'));
  const after = (await request('GET', path)).body;
  assert.equal(after.row_version, before.row_version);assert.equal(after.status, 'SUBMITTED');
});
