// ============================================================================
// KIỂM THỬ HỒI QUY (dành cho người phát triển) — chạy trên CSDL THỬ RIÊNG, không đụng dữ liệu thật.
// Yêu cầu: PostgreSQL truy cập được bằng psql; biến môi trường TEST_DB_URL, ví dụ
//   TEST_DB_URL=postgres://vina_user:vina_password_123@127.0.0.1:5435/vina_regression
// Chạy (tại backend): node --test tests/regression.test.js
// Kịch bản: dựng CSDL từ schema gốc + migration CŨ, nạp dữ liệu lỗi giống thực tế
// (nhân sự trùng tên NFD/khoảng trắng, nhật ký không có ca, mã ca MORNING, phân công Admin tự sinh),
// chạy toàn bộ migration mới, khởi động API trên cổng 3101 rồi kiểm tra từng quy tắc nghiệp vụ.
// ============================================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { createTestDb } = require('./lib/testDb');

const DB_URL = process.env.TEST_DB_URL;
const PORT = 3101;
const BASE = `http://127.0.0.1:${PORT}`;
if (!DB_URL) { console.log('Bỏ qua: chưa đặt TEST_DB_URL'); process.exit(0); }
const db = createTestDb(DB_URL);
const psql = db.psql;
const psqlFile = db.psqlFile;
const ROOT = db.ROOT;

let server; const tokens = {}; let P = {};
async function api(method, p, body, who = 'admin', headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const res = await fetch(BASE + '/api' + p, { method, headers: { ...(body && !isBuf ? { 'Content-Type': 'application/json' } : {}), ...(tokens[who] ? { Authorization: 'Bearer ' + tokens[who] } : {}), ...headers }, body: body ? (isBuf ? body : JSON.stringify(body)) : undefined });
  const t = res.headers.get('content-type') || '';
  return { status: res.status, body: t.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
}

test.before(async () => {
  db.setupAll();
  server = db.startServer({ port: PORT });
  await db.waitHealth(BASE);
  for (const who of ['admin', 'thanhb', 'hung', 'son', 'tuan', 'duong']) {
    const r = await api('POST', '/auth/login', { username: who, password: 'demo' }, null);
    assert.equal(r.status, 200, 'Khong dang nhap duoc ' + who + ': ' + JSON.stringify(r.body));
    tokens[who] = r.body.token;
  }
  const projectResponse = await api('GET', '/projects');
  assert.equal(projectResponse.status, 200, 'Khong tai duoc cong trinh: ' + JSON.stringify(projectResponse.body));
  const projects = projectResponse.body;
  assert.ok(Array.isArray(projects), 'Danh sach cong trinh phai la mang');
  P = Object.fromEntries(projects.map(p => [p.contract_no, p.id]));
});
test.after(() => { if (server) server.kill(); });

test('health: đúng phiên bản, không còn migration chờ', async () => {
  const h = await (await fetch(BASE + '/health')).json();
  const build = fs.readFileSync(path.join(ROOT, 'backend/src/build.js'), 'utf8').match(/BUILD:\s*'([^']+)'/)[1];
  assert.equal(h.build, build);
  // APP_BUILD nằm trong index.html (trước khi tách) hoặc trong một tệp js/ (sau khi tách).
  const jsDir = path.join(ROOT, 'js');
  const nguonGiaoDien = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
    + (fs.existsSync(jsDir) ? fs.readdirSync(jsDir).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(jsDir, f), 'utf8')).join('\n') : '');
  const appBuild = (nguonGiaoDien.match(/const APP_BUILD='([^']+)'/) || [])[1];
  assert.equal(appBuild, build, 'APP_BUILD của giao diện phải khớp build.js');
});

test('migration: gộp nhân sự trùng NFD/khoảng trắng, liên kết tài khoản, giữ bản cập nhật mới nhất', async () => {
  const team = (await api('GET', `/project-personnel/project/${P['001']}/team`)).body;
  const b = team.filter(r => r.full_name.normalize('NFC').toLowerCase() === 'nguyễn thành b');
  assert.equal(b.length, 1, 'Nguyễn Thành B chỉ được xuất hiện 1 lần');
  assert.equal(b[0].account_status, 'LINKED');
  assert.equal(b[0].username, 'thanhb');
  assert.equal(b[0].assignment_title, 'GS viên', 'giữ chức danh của bản cập nhật gần nhất');
  assert.equal(b[0].certificate, 'CC-1', 'gộp chứng chỉ từ bản bị gộp');
  assert.ok(!team.some(r => r.username === 'admin'), 'Admin không còn hiện là nhân sự');
});

test('migration: nhật ký cũ được gán ca, MORNING → CA1, không trùng', () => {
  const rows = psql(`SELECT log_date||':'||shift FROM daily_logs ORDER BY log_date, shift`).split('\n');
  assert.ok(rows.includes('2026-09-18:CA1'));
  assert.ok(rows.includes('2026-09-21:CA1') && rows.includes('2026-09-21:CA2'));
  assert.equal(psql(`SELECT is_nullable FROM information_schema.columns WHERE table_name='daily_logs' AND column_name='shift'`), 'NO');
});

test('nhân sự: thêm trùng tên (khác dấu/hoa thường) không tạo dòng mới', async () => {
  const before = (await api('GET', `/project-personnel/project/${P['001']}/team`)).body.length;
  const r = await api('POST', '/project-personnel', { project_id: P['001'], full_name: '  trần  văn c '.normalize('NFD'), assignment_title: 'GS viên' });
  assert.equal(r.status, 200);
  const after = (await api('GET', `/project-personnel/project/${P['001']}/team`)).body;
  assert.equal(after.length, before);
  assert.ok(after.some(x => x.full_name === 'Trần Văn C'), 'giữ nguyên cách viết họ tên đã có');
});

test('phân quyền: bỏ quyền Thêm → không lập được nhật ký; mặc định vai trò → lập được', async () => {
  const members = (await api('GET', `/project-members/project/${P['001']}`)).body;
  const m = members.find(x => x.username === 'thanhb');
  let r = await api('PUT', `/project-members/${m.id}`, { access_permissions: ['VIEW'] });
  assert.deepEqual(r.body.access_permissions, ['VIEW']);
  r = await api('POST', '/daily-logs', { project_id: P['001'], log_date: '2026-10-01', shift: 'CA1', work_summary: 'x' }, 'thanhb');
  assert.equal(r.status, 403);
  await api('PUT', `/project-members/${m.id}`, { access_permissions: null });
  r = await api('POST', '/daily-logs', { project_id: P['001'], log_date: '2026-10-01', shift: 'CA1', work_summary: 'x' }, 'thanhb');
  assert.equal(r.status, 201);
});

test('phân quyền: Sửa bao gồm Thêm', async () => {
  const m = (await api('GET', `/project-members/project/${P['001']}`)).body.find(x => x.username === 'thanhb');
  const r = await api('PUT', `/project-members/${m.id}`, { access_permissions: ['VIEW', 'EDIT'] });
  assert.ok(r.body.access_permissions.includes('CREATE'));
  await api('PUT', `/project-members/${m.id}`, { access_permissions: null });
});

test('nhật ký: nhiều ca/ngày, trùng ca bị từ chối 409', async () => {
  const d = '2026-10-02';
  assert.equal((await api('POST', '/daily-logs', { project_id: P['001'], log_date: d, shift: 'CA1', work_summary: '1' }, 'thanhb')).status, 201);
  assert.equal((await api('POST', '/daily-logs', { project_id: P['001'], log_date: d, shift: 'CA2', work_summary: '2' }, 'thanhb')).status, 201);
  assert.equal((await api('POST', '/daily-logs', { project_id: P['001'], log_date: d, shift: 'CA1', work_summary: '3' }, 'thanhb')).status, 409);
});

test('phân công vào công trình chưa có trên máy chủ → 404 rõ ràng (không lỗi 500)', async () => {
  const users = (await api('GET', '/users')).body;
  const r = await api('POST', '/project-members', { project_id: '11111111-1111-4111-8111-111111111111', user_id: users.find(x => x.username === 'son').id, assignment_title: 'x' });
  assert.equal(r.status, 404);
});

test('tiến độ: tính kế hoạch/thực tế theo tỷ trọng giá trị khớp tính tay', async () => {
  const items = [
    { code: '1', name: 'A', weight: 100, start_date: '2026-10-01', end_date: '2026-10-10' },
    { code: '2', name: 'B', weight: 300, start_date: '2026-10-06', end_date: '2026-10-15' }
  ];
  const c = await api('POST', `/projects/${P['002']}/progress-plans`, { plan_name: 'T', report_date: '2026-09-30', weight_basis: 'VALUE', items });
  assert.equal(c.status, 201);
  const id = c.body.plan.id;
  let d = (await api('GET', `/projects/${P['002']}/progress-plans/${id}?as_of=2026-10-08`)).body;
  // A: 8/10 = 80%, B: 3/10 = 30% → (100*0.8 + 300*0.3)/400 = 42.5%
  assert.equal(d.summary.planned_percent, 42.5);
  const ids = d.items.map(i => i.id);
  await api('POST', `/projects/${P['002']}/progress-plans/${id}/actuals`, { report_date: '2026-10-08', rows: [{ item_id: ids[0], actual_percent: 100 }, { item_id: ids[1], actual_percent: 10 }] });
  d = (await api('GET', `/projects/${P['002']}/progress-plans/${id}?as_of=2026-10-08`)).body;
  // (100*1 + 300*0.1)/400 = 32.5%
  assert.equal(d.summary.actual_percent, 32.5);
  assert.equal(d.items[1].status, 'CHAM');
  // Sửa tên hạng mục phải GIỮ số liệu thực tế
  await api('PATCH', `/projects/${P['002']}/progress-plans/${id}`, { items: d.items.map(i => ({ id: i.id, code: i.code, name: i.name + ' (sửa)', weight: i.weight, start_date: i.start_date, end_date: i.end_date })) });
  d = (await api('GET', `/projects/${P['002']}/progress-plans/${id}?as_of=2026-10-08`)).body;
  assert.equal(d.summary.actual_percent, 32.5, 'sửa bảng không được mất số liệu thực tế');
  assert.equal(d.plan.report_date, '2026-09-30', 'ngày không bị lệch múi giờ');
});

test('tiến độ: đọc Excel mẫu, loại dòng nhóm/tổng', async () => {
  const data = 'data:x;base64,' + fs.readFileSync(path.join(ROOT, 'assets/mau-bang-tien-do.xlsx')).toString('base64');
  const r = await api('POST', `/projects/${P['001']}/progress-plans/parse`, { file: { name: 'm.xlsx', data } });
  assert.equal(r.body.items.filter(i => i.include).length, 7);
  assert.equal(r.body.items.filter(i => i.is_group).length, 3);
});

test('hồ sơ: admin tạo + tải tệp → nhân viên thấy và tải về đúng nội dung', async () => {
  const doc = (await api('POST', '/documents', { project_id: P['001'], doc_group: 'LEGAL', type: 'BB', name: 'Hồ sơ A' })).body;
  assert.equal(doc.auto_code, 'BB-001-002', 'bộ đếm mã phải nối tiếp mã đã có');
  const bytes = Buffer.from('%PDF-1.4 test');
  const f = await api('POST', `/documents/${doc.id}/files?category=QD&name=${encodeURIComponent('quyết định.pdf')}`, bytes, 'admin', { 'Content-Type': 'application/pdf' });
  assert.equal(f.status, 201);
  const list = (await api('GET', `/documents?project_id=${P['001']}`, null, 'thanhb')).body;
  const seen = list.find(d => d.id === doc.id);
  assert.ok(seen && seen.files[0].file_name === 'quyết định.pdf');
  const dl = await api('GET', `/documents/${doc.id}/files/${f.body.id}`, null, 'thanhb');
  assert.equal(Buffer.compare(dl.body, bytes), 0);
  const again = await api('POST', `/documents/${doc.id}/files?name=x.pdf`, bytes, 'admin', { 'Content-Type': 'application/pdf' });
  assert.equal(again.status, 200, 'tải lại cùng tệp không tạo bản trùng');
});

test('hồ sơ: người không được phân công không xem được; tệp > 15MB bị từ chối', async () => {
  const doc = (await api('GET', `/documents?project_id=${P['001']}`)).body[0];
  const r = await api('GET', `/documents?project_id=${P['001']}`, null, 'tuan');
  assert.equal(r.status, 403);
  const big = Buffer.alloc(15 * 1024 * 1024 + 10);
  const b = await api('POST', `/documents/${doc.id}/files?name=big.bin`, big, 'admin', { 'Content-Type': 'application/octet-stream' });
  assert.equal(b.status, 413);
});

test('công trình: hợp đồng lưu ở kho tệp tập trung, tải lại đúng và không tạo bản trùng', async () => {
  const bytes = Buffer.from('%PDF-1.4 hop dong tvgs');
  const path = `/projects/${P['001']}/files?category=TVGS_CONTRACT&name=${encodeURIComponent('hợp đồng TVGS.pdf')}`;
  const first = await api('POST', path, bytes, 'admin', { 'Content-Type': 'application/pdf' });
  assert.equal(first.status, 201);
  const projects = (await api('GET', '/projects')).body;
  const project = projects.find(p => p.id === P['001']);
  assert.ok(project.files.some(f => f.id === first.body.id && f.category === 'TVGS_CONTRACT'));
  const download = await api('GET', `/projects/${P['001']}/files/${first.body.id}`, null, 'thanhb');
  assert.equal(Buffer.compare(download.body, bytes), 0);
  assert.equal((await api('POST', path, bytes, 'admin', { 'Content-Type': 'application/pdf' })).status, 200);
  assert.equal((await api('GET', `/projects/${P['001']}/files/${first.body.id}`, null, 'tuan')).status, 403);
});

test('tài khoản: tạo tài khoản mới đăng nhập được; Giám đốc không tạo được Admin; đổi mật khẩu', async () => {
  const c = await api('POST', '/users', { username: 'test.ql', full_name: 'Quản lý thử', password: 'matkhau123', role_name: 'MANAGER' });
  assert.equal(c.status, 201);
  let l = await api('POST', '/auth/login', { username: 'test.ql', password: 'matkhau123' }, null);
  assert.ok(l.body.token);
  tokens.ql = l.body.token;
  assert.equal((await api('POST', '/users', { username: 'x.admin', full_name: 'X', password: 'matkhau123', role_name: 'ADMIN' }, 'duong')).status, 403);
  assert.equal((await api('POST', '/auth/change-password', { old_password: 'matkhau123', new_password: 'moi12345' }, 'ql')).status, 200);
  l = await api('POST', '/auth/login', { username: 'test.ql', password: 'moi12345' }, null);
  assert.ok(l.body.token); tokens.ql = l.body.token;
});

test('vai trò Quản lý: chỉ thấy công trình được giao, mặc định Xem+Tải, không lập được nhật ký', async () => {
  assert.equal((await api('GET', '/projects', null, 'ql')).body.length, 0);
  const users = (await api('GET', '/users')).body;
  await api('POST', '/project-members', { project_id: P['001'], user_id: users.find(x => x.username === 'test.ql').id });
  const projects = (await api('GET', '/projects', null, 'ql')).body;
  assert.deepEqual(projects.map(p => p.contract_no), ['001']);
  const perms = (await api('GET', '/project-members/my-permissions', null, 'ql')).body;
  assert.deepEqual(perms[P['001']].permissions, ['VIEW', 'DOWNLOAD']);
  assert.equal((await api('POST', '/daily-logs', { project_id: P['001'], log_date: '2026-10-03', shift: 'CA1', work_summary: 'x' }, 'ql')).status, 403);
  const team = (await api('GET', `/project-personnel/project/${P['001']}/team`)).body;
  assert.ok(team.some(r => r.username === 'test.ql' && !r.personnel_id), 'Quản lý không bị đưa vào danh sách nhân sự tổ TVGS');
});

test('nhật ký: quy trình Nháp → Gửi duyệt → Duyệt → Khóa, đúng người đúng quyền', async () => {
  const c = await api('POST', '/daily-logs', { project_id: P['001'], log_date: '2026-10-05', shift: 'CA1', work_summary: 'Đổ bê tông', weather: 'Nắng', worker_count: 12 }, 'thanhb');
  assert.equal(c.status, 201); const id = c.body.id;
  assert.equal((await api('POST', `/daily-logs/${id}/approve`, null, 'thanhb')).status, 403, 'TVGS không được tự duyệt');
  assert.equal((await api('POST', `/daily-logs/${id}/approve`, null, 'hung')).status, 404, 'chưa gửi duyệt: TVGS trưởng không thấy bản nháp nên không duyệt được');
  assert.equal((await api('POST', `/daily-logs/${id}/approve`)).status, 409, 'Admin thấy nháp nhưng chưa gửi duyệt thì không duyệt được');
  assert.equal((await api('POST', `/daily-logs/${id}/submit`, null, 'thanhb')).body.status, 'SUBMITTED');
  assert.equal((await api('PATCH', `/daily-logs/${id}`, { work_summary: 'sửa' }, 'thanhb')).status, 409, 'đã gửi duyệt thì người lập không sửa được');
  assert.equal((await api('POST', `/daily-logs/${id}/reject`, { comment: 'Bổ sung khối lượng bê tông' }, 'hung')).body.status, 'DRAFT');
  await api('POST', `/daily-logs/${id}/submit`, null, 'thanhb');
  assert.equal((await api('POST', `/daily-logs/${id}/approve`, null, 'hung')).body.status, 'APPROVED');
  assert.equal((await api('POST', `/daily-logs/${id}/lock`, null, 'hung')).body.status, 'LOCKED');
});

test('nhật ký: gửi duyệt hàng loạt báo đúng từng bản thành công/thất bại', async () => {
  const a = (await api('POST', '/daily-logs', { project_id: P['001'], log_date: '2026-10-06', shift: 'CA1', work_summary: 'x' }, 'thanhb')).body.id;
  const b = (await api('POST', '/daily-logs', { project_id: P['001'], log_date: '2026-10-06', shift: 'CA2', work_summary: 'y' }, 'thanhb')).body.id;
  await api('POST', `/daily-logs/${b}/submit`, null, 'thanhb');
  const r = (await api('POST', '/daily-logs/bulk', { action: 'submit', ids: [a, b] }, 'thanhb')).body;
  assert.equal(r.done.length, 1); assert.equal(r.failed.length, 1);
  const ap = (await api('POST', '/daily-logs/bulk', { action: 'approve', ids: [a, b] }, 'hung')).body;
  assert.equal(ap.done.length, 2);
});

test('nhật ký: tài liệu kèm theo lên máy chủ, tải về đúng', async () => {
  const id = (await api('POST', '/daily-logs', { project_id: P['001'], log_date: '2026-10-07', shift: 'CA1', work_summary: 'x' }, 'thanhb')).body.id;
  const bytes = Buffer.from('bien ban nghiem thu');
  const f = await api('POST', `/daily-logs/${id}/files?name=${encodeURIComponent('biên bản.pdf')}`, bytes, 'thanhb', { 'Content-Type': 'application/pdf' });
  assert.equal(f.status, 201);
  const dl = await api('GET', `/daily-logs/${id}/files/${f.body.id}`, null, 'thanhb');
  assert.equal(Buffer.compare(dl.body, bytes), 0);
  assert.equal((await api('GET', `/daily-logs/${id}/files/${f.body.id}`, null, 'hung')).status, 404, 'tệp của bản nháp chỉ người lập tải được');
  await api('POST', `/daily-logs/${id}/submit`, null, 'thanhb');
  assert.equal(Buffer.compare((await api('GET', `/daily-logs/${id}/files/${f.body.id}`, null, 'hung')).body, bytes), 0, 'gửi rồi thì TVGS trưởng tải được');
});

test('nhật ký: ảnh nhị phân tối ưu được lưu tập trung và đọc lại', async () => {
  const id = (await api('POST', '/daily-logs', { project_id: P['001'], log_date: '2026-11-01', shift: 'CA1', work_summary: 'Ảnh hiện trường' }, 'thanhb')).body.id;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const file = await api('POST', `/daily-logs/${id}/attachments-binary?name=${encodeURIComponent('hiện trường.png')}`, png, 'thanhb', { 'Content-Type': 'image/png' });
  assert.equal(file.status, 201);
  assert.equal((await api('GET', `/daily-logs/${id}/attachments`, null, 'hung')).status, 404, 'ảnh của bản nháp chỉ người lập xem được');
  await api('POST', `/daily-logs/${id}/submit`, null, 'thanhb');
  const list = (await api('GET', `/daily-logs/${id}/attachments`, null, 'hung')).body;
  assert.ok(list.some(x => x.id === file.body.id));
  const content = (await api('GET', `/daily-logs/${id}/attachments/${file.body.id}`, null, 'hung')).body;
  assert.ok(content.data_url.startsWith('data:image/png;base64,'));
});

test('nhân sự: nhân viên chỉ thấy quyền truy cập của chính mình', async () => {
  const team = (await api('GET', `/project-personnel/project/${P['001']}/team`, null, 'thanhb')).body;
  const me = team.find(r => r.is_me);
  assert.ok(me && me.access_permissions.length > 0);
  assert.ok(team.filter(r => !r.is_me).every(r => r.access_permissions.length === 0 && !r.username && !r.work_scope));
  const adminView = (await api('GET', `/project-personnel/project/${P['001']}/team`)).body;
  assert.ok(adminView.filter(r => r.account_status === 'LINKED').every(r => r.access_permissions.length > 0));
});

test('báo cáo: kỳ tuần/tháng/ngày/hoàn thành và số liệu tổng hợp khớp dữ liệu', async () => {
  const w = (await api('GET', `/reports/compile?project_id=${P['001']}&type=WEEKLY&from=2026-10-08`)).body;
  assert.deepEqual(w.period, { from: '2026-10-05', to: '2026-10-11' });
  // tuần 05–11/10: 1 (05) + 2 (06) + 1 (07) = 4 nhật ký trên 3 ngày
  assert.equal(w.stats.log_count, 4); assert.equal(w.stats.days_with_logs, 3);
  const m = (await api('GET', `/reports/compile?project_id=${P['001']}&type=MONTHLY&from=2026-09`)).body;
  assert.deepEqual(m.period, { from: '2026-09-01', to: '2026-09-30' });
  const d = (await api('GET', `/reports/compile?project_id=${P['001']}&type=DAILY&from=2026-10-05`)).body;
  assert.equal(d.logs.length, 1); assert.equal(d.logs[0].weather, 'Nắng'); assert.equal(d.stats.workers_avg, 12);
  const f = (await api('GET', `/reports/compile?project_id=${P['001']}&type=FINAL&to=2026-10-31`)).body;
  assert.equal(f.period.to, '2026-10-31'); assert.ok(f.stats.log_count >= 9);
  assert.equal((await api('GET', `/reports/compile?project_id=${P['001']}&type=WEEKLY`)).status, 400);
  assert.equal((await api('GET', `/reports/compile?project_id=${P['001']}&type=WEEKLY&from=2026-10-08`, null, 'tuan')).status, 403, 'không được phân công thì không lập báo cáo');
  // Lưu báo cáo → gửi duyệt → Trưởng TVGS duyệt
  const doc = await api('POST', '/documents', { project_id: P['001'], doc_group: 'REPORT', type: 'BC', name: 'Báo cáo tuần', details: { reportType: 'WEEKLY', from: w.period.from, to: w.period.to, snapshot: w, sections: { quality: 'Đạt' } } }, 'thanhb');
  assert.equal(doc.status, 201); assert.match(doc.body.auto_code, /^BC-001-\d{3}$/);
  assert.equal((await api('POST', `/documents/${doc.body.id}/submit`, null, 'thanhb')).status, 200);
  assert.equal((await api('POST', `/documents/${doc.body.id}/approve`, null, 'hung')).status, 200);
  const back = (await api('GET', `/documents/${doc.body.id}`, null, 'hung')).body;
  assert.equal(back.status, 'APPROVED'); assert.equal(back.details.snapshot.stats.log_count, 4, 'số liệu báo cáo được chốt');
});

// ---- Đợt 6 (28/09): vá bảo mật và nghiệp vụ ----

test('bảo mật: tệp tải lên kiểu HTML/SVG không được phát lại để chạy trên trình duyệt', async () => {
  const doc = (await api('POST', '/documents', { project_id: P['001'], doc_group: 'LEGAL', type: 'HS', name: 'Thử XSS' }, 'thanhb')).body;
  const html = Buffer.from('<script>alert(localStorage.vina_supervision_auth)</script>');
  const f = await api('POST', `/documents/${doc.id}/files?name=hop-dong.pdf`, html, 'thanhb', { 'Content-Type': 'text/html' });
  assert.equal(f.status, 201);
  const res = await fetch(`${BASE}/api/documents/${doc.id}/files/${f.body.id}`, { headers: { Authorization: 'Bearer ' + tokens.admin } });
  assert.equal(res.headers.get('content-type'), 'application/octet-stream');
  assert.match(res.headers.get('content-disposition'), /^attachment/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const log = (await api('POST', '/daily-logs', { project_id: P['001'], log_date: '2026-10-09', shift: 'CA1', work_summary: 'x' }, 'thanhb')).body;
  const svg = await api('POST', `/daily-logs/${log.id}/files?name=a.svg`, Buffer.from('<svg onload="alert(1)"/>'), 'thanhb', { 'Content-Type': 'image/svg+xml' });
  const r2 = await fetch(`${BASE}/api/daily-logs/${log.id}/files/${svg.body.id}`, { headers: { Authorization: 'Bearer ' + tokens.admin } });
  assert.equal(r2.headers.get('content-type'), 'application/octet-stream');
  const pdf = await fetch(`${BASE}/api/daily-logs/${log.id}/files/${(await api('POST', `/daily-logs/${log.id}/files?name=b.pdf`, Buffer.from('%PDF-1.4'), 'thanhb', { 'Content-Type': 'application/pdf' })).body.id}`, { headers: { Authorization: 'Bearer ' + tokens.admin } });
  assert.equal(pdf.headers.get('content-type'), 'application/pdf', 'PDF vẫn xem trực tiếp được');
});

test('bảo mật: đăng nhập sai liên tục bị tạm khóa (429)', async () => {
  let last;
  for (let i = 0; i < 9; i++) last = await api('POST', '/auth/login', { username: 'khong.ton.tai', password: 'sai-' + i }, null);
  assert.equal(last.status, 429);
  assert.equal((await api('POST', '/auth/login', { username: 'thanhb', password: 'demo' }, null)).status, 200, 'không khóa lây sang tài khoản khác');
});

test('bảo mật: tệp Excel "bom nén" bị từ chối, máy chủ không treo', async () => {
  const zlib = require('zlib');
  const name = Buffer.from('xl/worksheets/sheet1.xml');
  const raw = Buffer.alloc(70 * 1024 * 1024, 0x20);
  const comp = zlib.deflateRawSync(raw);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(name.length, 28);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(46 + name.length, 12); eocd.writeUInt32LE(30 + name.length + comp.length, 16);
  const zip = Buffer.concat([local, name, comp, cd, name, eocd]);
  const r = await api('POST', `/projects/${P['001']}/progress-plans/parse`, { file: { name: 'bom.xlsx', data: zip.toString('base64') } });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /quá lớn/);
  assert.equal((await fetch(BASE + '/health')).status, 200);
});

test('công trình: sửa một phần không xóa các trường không gửi lên', async () => {
  const cur = (await api('GET', `/projects/${P['002']}`)).body;
  let r = await api('PATCH', `/projects/${P['002']}`, { name: cur.name, contract_no: cur.contract_no, owner_name: 'Ban QLDA thử', address: 'Số 1 đường A', progress: 37 });
  assert.equal(r.status, 200);
  r = await api('PATCH', `/projects/${P['002']}`, { name: cur.name + ' (sửa)', contract_no: cur.contract_no });
  assert.equal(r.status, 200);
  assert.equal(r.body.owner_name, 'Ban QLDA thử');
  assert.equal(r.body.address, 'Số 1 đường A');
  assert.equal(Number(r.body.progress), 37, 'tiến độ không bị đưa về 0');
  await api('PATCH', `/projects/${P['002']}`, { name: cur.name, contract_no: cur.contract_no });
});

test('hồ sơ: đã gửi duyệt thì người lập không sửa/không thêm tệp được; Trả lại thì sửa được', async () => {
  const doc = (await api('POST', '/documents', { project_id: P['001'], doc_group: 'LEGAL', type: 'BB', name: 'Biên bản nghiệm thu' }, 'thanhb')).body;
  assert.equal((await api('POST', `/documents/${doc.id}/submit`, null, 'thanhb')).status, 200);
  assert.equal((await api('PATCH', `/documents/${doc.id}`, { name: 'đổi sau khi gửi' }, 'thanhb')).status, 403);
  assert.equal((await api('POST', `/documents/${doc.id}/files?name=x.pdf`, Buffer.from('%PDF'), 'thanhb', { 'Content-Type': 'application/pdf' })).status, 403);
  assert.equal((await api('POST', `/documents/${doc.id}/reject`, { comment: 'Thiếu chữ ký nhà thầu' }, 'hung')).status, 200);
  assert.equal((await api('PATCH', `/documents/${doc.id}`, { name: 'sửa sau khi trả lại' }, 'thanhb')).status, 200);
});

test('vấn đề: Admin giao việc được; không giao cho người ngoài công trình', async () => {
  const users = (await api('GET', '/users')).body;
  const id = (u) => users.find(x => x.username === u).id;
  const issue = (await api('POST', '/issues', { project_id: P['001'], title: 'Nứt dầm tầng 2', severity: 'HIGH' }, 'thanhb')).body;
  assert.equal((await api('POST', `/issues/${issue.id}/assign`, { assigned_to: id('tuan') })).status, 400);
  const ok = await api('POST', `/issues/${issue.id}/assign`, { assigned_to: id('thanhb') });
  assert.equal(ok.status, 200); assert.equal(ok.body.assigned_to, id('thanhb'));
});

test('báo cáo: "còn tồn cuối kỳ" tính theo ngày cuối kỳ, không theo trạng thái hiện tại', async () => {
  const issue = (await api('POST', '/issues', { project_id: P['002'], title: 'Thiếu biên bản lấy mẫu', severity: 'LOW' })).body;
  await api('POST', `/issues/${issue.id}/resolve`, { resolution_note: 'đã bổ sung' });
  const base = (await api('GET', `/reports/compile?project_id=${P['002']}&type=WEEKLY&from=2026-10-08`)).body.issues.open_total;
  // Phát sinh 01/10, đóng 20/10 → cuối tuần 11/10 vẫn còn tồn
  psql(`UPDATE issues SET created_at='2026-10-01 09:00+07', resolved_at='2026-10-20 09:00+07' WHERE id='${issue.id}'`);
  const w = (await api('GET', `/reports/compile?project_id=${P['002']}&type=WEEKLY&from=2026-10-08`)).body;
  assert.equal(w.issues.open_total, base + 1);
  psql(`UPDATE issues SET resolved_at='2026-10-09 09:00+07' WHERE id='${issue.id}'`);
  assert.equal((await api('GET', `/reports/compile?project_id=${P['002']}&type=WEEKLY&from=2026-10-08`)).body.issues.open_total, base);
});

// ---- Đợt 7 (01/10): tài khoản cho nhân sự + duyệt có ý kiến + việc cần duyệt ----

test('tài khoản nhân sự: tạo từ trang Nhân sự → bắt đổi mật khẩu lần đầu mới dùng được', async () => {
  const add = await api('POST', '/project-personnel', { project_id: P['001'], full_name: 'Lê Văn Mới', assignment_title: 'GS viên' });
  assert.equal(add.status, 201);
  const u = await api('POST', '/users', { username: 'le.moi', full_name: 'Lê Văn Mới', password: 'TamThoi123', role_name: 'ENGINEER' });
  assert.equal(u.status, 201); assert.equal(u.body.must_change_password, true);
  assert.equal((await api('POST', `/project-personnel/${add.body.id}/link-account`, { user_id: u.body.id })).status, 200);
  let l = await api('POST', '/auth/login', { username: 'le.moi', password: 'TamThoi123' }, null);
  assert.equal(l.status, 200); assert.equal(l.body.user.must_change_password, true);
  tokens.moi = l.body.token;
  const blocked = await api('GET', '/projects', null, 'moi');
  assert.equal(blocked.status, 403); assert.equal(blocked.body.code, 'MUST_CHANGE_PASSWORD');
  assert.equal((await api('POST', '/auth/change-password', { old_password: 'TamThoi123', new_password: 'TamThoi123' }, 'moi')).status, 400, 'mật khẩu mới phải khác');
  assert.equal((await api('POST', '/auth/change-password', { old_password: 'TamThoi123', new_password: 'CuaRieng456' }, 'moi')).status, 200);
  l = await api('POST', '/auth/login', { username: 'le.moi', password: 'CuaRieng456' }, null);
  assert.equal(l.body.user.must_change_password, false); tokens.moi = l.body.token;
  const projects = (await api('GET', '/projects', null, 'moi')).body;
  assert.deepEqual(projects.map(p => p.contract_no), ['001'], 'thấy đúng công trình được phân công');
  // Admin đặt lại mật khẩu → lại phải đổi
  await api('POST', `/users/${u.body.id}/password`, { password: 'MatKhauTam9' });
  l = await api('POST', '/auth/login', { username: 'le.moi', password: 'MatKhauTam9' }, null);
  assert.equal(l.body.user.must_change_password, true);
});

test('duyệt báo cáo: thành viên gửi → Trưởng TVGS thấy trong "Chờ tôi duyệt" → yêu cầu chỉnh sửa có nội dung → người lập thấy lý do → sửa, gửi lại → phê duyệt', async () => {
  const w = (await api('GET', `/reports/compile?project_id=${P['001']}&type=WEEKLY&from=2026-10-15`)).body;
  const doc = (await api('POST', '/documents', { project_id: P['001'], doc_group: 'REPORT', type: 'BC', name: 'Báo cáo tuần 12–18/10', details: { reportType: 'WEEKLY', from: w.period.from, to: w.period.to, snapshot: w, sections: {} } }, 'thanhb')).body;
  assert.equal((await api('POST', `/documents/${doc.id}/submit`, { comment: 'Kính gửi anh Hùng' }, 'thanhb')).status, 200);
  let inbox = (await api('GET', '/reviews/inbox', null, 'hung')).body;
  assert.ok(inbox.to_review.some(x => x.kind === 'documents' && x.id === doc.id && x.created_by_name === 'Nguyễn Thành B'), 'Trưởng TVGS nhận được báo cáo chờ duyệt');
  assert.equal((await api('GET', '/reviews/inbox', null, 'thanhb')).body.to_review.length, 0, 'kỹ sư không có mục chờ duyệt');
  const noReason = await api('POST', `/documents/${doc.id}/reject`, { comment: ' ' }, 'hung');
  assert.equal(noReason.status, 400, 'trả lại phải ghi nội dung');
  assert.equal((await api('POST', `/documents/${doc.id}/reject`, { comment: 'Mục III thiếu đánh giá tiến độ hạng mục móng' }, 'hung')).status, 200);
  inbox = (await api('GET', '/reviews/inbox', null, 'thanhb')).body;
  const ret = inbox.returned.find(x => x.id === doc.id);
  assert.ok(ret, 'người lập thấy bản bị trả lại');
  assert.equal(ret.comment, 'Mục III thiếu đánh giá tiến độ hạng mục móng'); assert.ok(ret.reviewer_name);
  const listed = (await api('GET', `/documents?project_id=${P['001']}`, null, 'thanhb')).body.find(x => x.id === doc.id);
  assert.equal(listed.status, 'DRAFT'); assert.equal(listed.last_review.action, 'REJECT');
  assert.equal((await api('PATCH', `/documents/${doc.id}`, { details: { ...doc.details, sections: { schedule: 'Móng chậm 3 ngày' } } }, 'thanhb')).status, 200);
  await api('POST', `/documents/${doc.id}/submit`, null, 'thanhb');
  assert.equal((await api('GET', '/reviews/inbox', null, 'thanhb')).body.returned.some(x => x.id === doc.id), false, 'gửi lại thì hết trạng thái bị trả lại');
  assert.equal((await api('POST', `/documents/${doc.id}/approve`, { comment: 'Đạt' }, 'hung')).status, 200);
  inbox = (await api('GET', '/reviews/inbox', null, 'thanhb')).body;
  assert.ok(inbox.approved.some(x => x.id === doc.id && x.comment === 'Đạt'));
  assert.ok(!(await api('GET', '/reviews/inbox', null, 'hung')).body.to_review.some(x => x.id === doc.id));
  const hist = (await api('GET', `/reviews/documents/${doc.id}`, null, 'thanhb')).body;
  assert.deepEqual(hist.map(h => h.action), ['APPROVE', 'SUBMIT', 'REJECT', 'SUBMIT']);
  assert.equal((await api('GET', `/reviews/documents/${doc.id}`, null, 'tuan')).status, 403, 'người ngoài công trình không xem được lịch sử');
});

test('duyệt nhật ký: trả lại bắt buộc có nội dung, người lập thấy lý do trong danh sách', async () => {
  const id = (await api('POST', '/daily-logs', { project_id: P['001'], log_date: '2026-10-16', shift: 'CA1', work_summary: 'Lắp dựng cốp pha' }, 'thanhb')).body.id;
  await api('POST', `/daily-logs/${id}/submit`, null, 'thanhb');
  assert.ok((await api('GET', '/reviews/inbox', null, 'hung')).body.to_review.some(x => x.kind === 'daily_logs' && x.id === id));
  assert.equal((await api('POST', `/daily-logs/${id}/reject`, {}, 'hung')).status, 400);
  const bulk = (await api('POST', '/daily-logs/bulk', { action: 'reject', ids: [id] }, 'hung')).body;
  assert.equal(bulk.done.length, 0, 'trả lại hàng loạt cũng phải có nội dung');
  assert.equal((await api('POST', `/daily-logs/${id}/reject`, { comment: 'Ghi rõ số lượng công nhân' }, 'hung')).status, 200);
  const log = (await api('GET', `/daily-logs?project_id=${P['001']}`, null, 'thanhb')).body.find(x => x.id === id);
  assert.equal(log.status, 'DRAFT'); assert.equal(log.last_review.comment, 'Ghi rõ số lượng công nhân');
  assert.ok((await api('GET', '/reviews/inbox', null, 'thanhb')).body.returned.some(x => x.kind === 'daily_logs' && x.id === id));
});

// ---- Đợt 8 (02/10): quyền duyệt theo chức danh TẠI TỪNG CÔNG TRÌNH, trình công ty, tên đăng nhập tùy chọn ----

test('quyền duyệt theo công trình: cùng một người là TVGS trưởng ở công trình này, GS viên ở công trình khác', async () => {
  const users = (await api('GET', '/users')).body;
  const tb = users.find(x => x.username === 'thanhb');
  assert.equal((await api('GET', '/reviews/inbox', null, 'thanhb')).body.can_review, false, 'GS viên: không có mục Việc cần duyệt');
  const a = await api('POST', '/project-members', { project_id: P['002'], user_id: tb.id, assignment_title: 'TVGS trưởng' });
  assert.equal(a.status, 201);
  const perms = (await api('GET', '/project-members/my-permissions', null, 'thanhb')).body;
  assert.ok(perms[P['002']].permissions.includes('APPROVE'), 'TVGS trưởng tại công trình 002 → có quyền Duyệt');
  assert.ok(!perms[P['001']].permissions.includes('APPROVE'), 'GS viên tại công trình 001 → không có quyền Duyệt');
  // Nhật ký chờ duyệt ở cả 2 công trình
  const l2 = (await api('POST', '/daily-logs', { project_id: P['002'], log_date: '2026-10-21', shift: 'CA1', work_summary: 'Thi công móng' })).body.id;
  await api('POST', `/daily-logs/${l2}/submit`);
  const l1 = (await api('POST', '/daily-logs', { project_id: P['001'], log_date: '2026-10-21', shift: 'CA1', work_summary: 'Xây tường' })).body.id;
  await api('POST', `/daily-logs/${l1}/submit`);
  const inbox = (await api('GET', '/reviews/inbox', null, 'thanhb')).body;
  assert.equal(inbox.can_review, true);
  assert.ok(inbox.to_review.some(x => x.id === l2)); assert.ok(!inbox.to_review.some(x => x.id === l1), 'không thấy việc của công trình mình không làm trưởng');
  assert.equal((await api('POST', `/daily-logs/${l1}/approve`, {}, 'thanhb')).status, 403);
  assert.equal((await api('POST', `/daily-logs/${l2}/approve`, { comment: 'Đạt' }, 'thanhb')).status, 200);
  // Tùy chỉnh bỏ quyền Duyệt → mất quyền dù chức danh là TVGS trưởng
  const m = (await api('GET', `/project-members/project/${P['002']}`)).body.find(x => x.username === 'thanhb');
  await api('PUT', `/project-members/${m.id}`, { access_permissions: ['VIEW', 'CREATE', 'EDIT'] });
  assert.equal((await api('GET', '/reviews/inbox', null, 'thanhb')).body.can_review, false);
  await api('PUT', `/project-members/${m.id}`, { access_permissions: null });
});

test('trình công ty: Trưởng TVGS trình việc vượt thẩm quyền → Giám đốc/Admin nhận và quyết định; Trưởng TVGS không tự duyệt bản đã trình', async () => {
  const doc = (await api('POST', '/documents', { project_id: P['002'], doc_group: 'LEGAL', type: 'BB', name: 'Đề xuất thay đổi thiết kế móng' })).body;
  await api('POST', `/documents/${doc.id}/submit`);
  assert.equal((await api('POST', `/documents/${doc.id}/escalate`, { comment: '' }, 'thanhb')).status, 400, 'phải ghi nội dung trình');
  assert.equal((await api('POST', `/documents/${doc.id}/escalate`, { comment: 'Thay đổi thiết kế làm tăng chi phí, vượt thẩm quyền' }, 'thanhb')).status, 200);
  assert.equal((await api('POST', `/documents/${doc.id}/approve`, {}, 'thanhb')).status, 409, 'đã trình thì chờ công ty');
  let lead = (await api('GET', '/reviews/inbox', null, 'thanhb')).body;
  assert.ok(lead.escalated.some(x => x.id === doc.id)); assert.ok(!lead.to_review.some(x => x.id === doc.id));
  const company = (await api('GET', '/reviews/inbox')).body;
  const it = company.to_review.find(x => x.id === doc.id);
  assert.ok(it && it.reason === 'ESCALATED' && it.last_comment.includes('vượt thẩm quyền'), 'Admin nhận việc trình kèm nội dung');
  assert.ok(company.monitor.every(x => x.last_action !== 'ESCALATE'));
  assert.equal((await api('POST', `/documents/${doc.id}/escalate`, { comment: 'x x x' })).status, 400, 'Admin không cần trình');
  assert.equal((await api('POST', `/documents/${doc.id}/approve`, { comment: 'Đồng ý' })).status, 200);
  lead = (await api('GET', '/reviews/inbox', null, 'thanhb')).body;
  assert.ok(!lead.escalated.some(x => x.id === doc.id));
  // Nhật ký cũng trình được
  const lg = (await api('POST', '/daily-logs', { project_id: P['002'], log_date: '2026-10-22', shift: 'CA1', work_summary: 'Sự cố sạt lở hố móng' })).body.id;
  await api('POST', `/daily-logs/${lg}/submit`);
  assert.equal((await api('POST', `/daily-logs/${lg}/escalate`, { comment: 'Sự cố cần công ty xử lý' }, 'thanhb')).status, 200);
  assert.equal((await api('POST', `/daily-logs/${lg}/reject`, { comment: 'abc' }, 'thanhb')).status, 409);
  assert.ok((await api('GET', '/reviews/inbox')).body.to_review.some(x => x.id === lg && x.reason === 'ESCALATED'));
});

test('tên đăng nhập tự đặt: kiểm tra trùng, đổi tên, đăng nhập không phân biệt hoa/thường', async () => {
  assert.equal((await api('GET', '/users/username-available?username=thanhb')).body.available, false);
  assert.equal((await api('GET', '/users/username-available?username=THANHB')).body.available, false, 'trùng không phân biệt hoa/thường');
  assert.equal((await api('GET', '/users/username-available?username=0912345678')).body.available, true, 'dùng số điện thoại được');
  assert.equal((await api('GET', '/users/username-available?username=.abc')).body.available, false);
  assert.equal((await api('GET', '/users/username-available?username=x', null, 'thanhb')).status, 403, 'nhân viên không dò được tên đăng nhập');
  const c = await api('POST', '/users', { username: 'Ky.Su@Vina.vn', full_name: 'Kỹ sư Email', password: 'TamThoi123', role_name: 'ENGINEER' });
  assert.equal(c.status, 201); assert.equal(c.body.username, 'ky.su@vina.vn');
  assert.equal((await api('POST', '/users', { username: 'THANHB', full_name: 'Trùng', password: 'TamThoi123', role_name: 'ENGINEER' })).status, 409);
  const tb = (await api('GET', '/users')).body.find(x => x.username === 'thanhb');
  const r = await api('PATCH', `/users/${tb.id}`, { username: 'Thanh.B.Moi' });
  assert.equal(r.status, 200); assert.equal(r.body.username, 'thanh.b.moi');
  assert.equal((await api('PATCH', `/users/${tb.id}`, { username: 'hung' })).status, 409);
  const l = await api('POST', '/auth/login', { username: 'THANH.B.MOI', password: 'demo' }, null);
  assert.equal(l.status, 200, 'đăng nhập bằng tên mới, không phân biệt hoa/thường');
  await api('PATCH', `/users/${tb.id}`, { username: 'thanhb' });
});

test('dữ liệu cũ: TVGS trưởng có quyền tùy chỉnh lưu trước khi có ô "Duyệt" → migration 20261003 bổ sung Duyệt; đồng bộ họ tên tài khoản', async () => {
  const m = (await api('GET', `/project-members/project/${P['002']}`)).body.find(x => x.username === 'thanhb');
  await api('PUT', `/project-members/${m.id}`, { access_permissions: ['VIEW', 'CREATE', 'EDIT', 'DOWNLOAD'] });
  assert.equal((await api('GET', '/reviews/inbox', null, 'thanhb')).body.can_review, false, 'như dữ liệu thật: TVGS trưởng bị coi như GS viên');
  // GS viên có quyền tùy chỉnh thì KHÔNG được cấp thêm
  const g = (await api('GET', `/project-members/project/${P['001']}`)).body.find(x => x.username === 'thanhb');
  await api('PUT', `/project-members/${g.id}`, { access_permissions: ['VIEW', 'DOWNLOAD'] });
  psqlFile(path.join(ROOT, 'migrations', '20261003_approve_for_lead_custom.sql'));
  const perms = (await api('GET', '/project-members/my-permissions', null, 'thanhb')).body;
  assert.deepEqual(perms[P['002']].permissions, ['VIEW', 'CREATE', 'EDIT', 'DOWNLOAD', 'APPROVE']);
  assert.equal(perms[P['002']].source, 'CUSTOM', 'vẫn là tùy chỉnh, chỉ thêm Duyệt');
  assert.deepEqual(perms[P['001']].permissions, ['VIEW', 'DOWNLOAD'], 'GS viên giữ nguyên');
  assert.equal((await api('GET', '/reviews/inbox', null, 'thanhb')).body.can_review, true);
  await api('PUT', `/project-members/${m.id}`, { access_permissions: null });
  await api('PUT', `/project-members/${g.id}`, { access_permissions: null });
  // Đồng bộ họ tên tài khoản (cảnh báo "Tài khoản của ...?" hết khi họ tên khớp nhân sự)
  const son = (await api('GET', '/users')).body.find(x => x.username === 'son');
  const r = await api('PATCH', `/users/${son.id}`, { username: 'son.moi', full_name: '  Nguyễn   Văn Sơn ' });
  assert.equal(r.status, 200); assert.equal(r.body.username, 'son.moi'); assert.equal(r.body.full_name, 'Nguyễn Văn Sơn');
  await api('PATCH', `/users/${son.id}`, { username: 'son', full_name: son.full_name });
});

// ---- Đợt 10 (04/10): tổng quan tiến độ nhiều công trình + cảnh báo tự động + báo cáo so sánh với bảng tiến độ ----
const vnToday = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const shift = (s, n) => new Date(new Date(s + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);

test('tổng quan: Admin thấy mọi công trình, thành viên chỉ thấy công trình được phân công', async () => {
  const all = (await api('GET', '/reports/portfolio')).body;
  const mine = (await api('GET', '/reports/portfolio', null, 'thanhb')).body;
  const none = (await api('GET', '/reports/portfolio', null, 'tuan')).body;
  const allProjects = (await api('GET', '/projects')).body.length;
  assert.equal(all.projects.length, allProjects);
  const assigned = (await api('GET', '/projects', null, 'thanhb')).body.map(p => p.id).sort();
  assert.deepEqual(mine.projects.map(p => p.id).sort(), assigned);
  assert.ok(mine.projects.length < all.projects.length || allProjects === assigned.length);
  assert.equal(none.projects.length, (await api('GET', '/projects', null, 'tuan')).body.length);
  assert.ok(['RED', 'AMBER', 'GREEN', 'DONE', 'PAUSED'].includes(all.projects[0].health));
  const other = all.projects.find(p => !assigned.includes(p.id));
  if (other) assert.equal((await api('GET', `/reports/health/${other.id}`, null, 'thanhb')).status, 403, 'không xem được công trình không được giao');
});

test('cảnh báo: hạng mục quá hạn, chậm tiến độ, chưa cập nhật thực tế → Đỏ; cập nhật đủ → hết cảnh báo tiến độ', async () => {
  const t = vnToday();
  const items = [
    { code: '1', name: 'Đào móng', weight: 100, start_date: shift(t, -30), end_date: shift(t, -20) },
    { code: '2', name: 'Bê tông móng', weight: 100, start_date: shift(t, -10), end_date: shift(t, 9) },
    { code: '3', name: 'Xây tường', weight: 100, start_date: shift(t, 5), end_date: shift(t, 30) }
  ];
  const c = await api('POST', `/projects/${P['001']}/progress-plans`, { plan_name: 'Tiến độ thi công đợt 2', report_date: shift(t, -31), weight_basis: 'VALUE', items });
  assert.equal(c.status, 201);
  let h = (await api('GET', `/reports/health/${P['001']}`)).body;
  const codes = h.alerts.map(a => a.code);
  assert.equal(h.health, 'RED');
  for (const code of ['ITEMS_OVERDUE', 'SCHEDULE_BEHIND', 'PROGRESS_STALE', 'LOOKAHEAD']) assert.ok(codes.includes(code), 'thiếu cảnh báo ' + code + ': ' + codes.join(','));
  assert.equal(h.alerts.find(a => a.code === 'ITEMS_OVERDUE').severity, 'CRITICAL');
  // Cập nhật thực tế đúng kế hoạch → hết cảnh báo tiến độ
  const d = (await api('GET', `/projects/${P['001']}/progress-plans/${c.body.plan.id}?as_of=${t}`)).body;
  const rows = d.items.map(i => ({ item_id: i.id, actual_percent: i.status === 'QUA_HAN' ? 100 : i.planned_percent }));
  assert.equal((await api('POST', `/projects/${P['001']}/progress-plans/${c.body.plan.id}/actuals`, { report_date: t, rows })).status, 200);
  h = (await api('GET', `/reports/health/${P['001']}`)).body;
  const after = h.alerts.map(a => a.code);
  for (const code of ['ITEMS_OVERDUE', 'SCHEDULE_BEHIND', 'PROGRESS_STALE', 'FORECAST_LATE']) assert.ok(!after.includes(code), 'còn cảnh báo ' + code);
  assert.equal(h.plan.last_actual_date, t);
  assert.ok(Math.abs(h.plan.variance) < 0.01);
});

test('báo cáo tuần: so sánh hạng mục trong kỳ với bảng tiến độ, có id để nhập thực tế, có cảnh báo; không so với kế hoạch tương lai', async () => {
  const t = vnToday();
  const w = (await api('GET', `/reports/compile?project_id=${P['001']}&type=WEEKLY&from=${t}`)).body;
  assert.equal(w.progress.plan_name, 'Tiến độ thi công đợt 2');
  assert.ok(w.progress.as_of <= t, 'so sánh tối đa đến hôm nay');
  assert.ok(w.progress.plan_id);
  const inPeriod = w.progress.items.filter(i => i.in_period);
  assert.ok(inPeriod.length >= 1 && inPeriod.every(i => i.id && i.start_date && i.end_date));
  assert.ok(Array.isArray(w.alerts));
  // Nhập tay trong báo cáo: ghi thực tế vào bảng tiến độ rồi tổng hợp lại → báo cáo phản ánh số mới
  const item = w.progress.items.find(i => i.name === 'Bê tông móng');
  await api('POST', `/projects/${P['001']}/progress-plans/${w.progress.plan_id}/actuals`, { report_date: w.progress.as_of, rows: [{ item_id: item.id, actual_percent: 5 }] }, 'thanhb');
  const w2 = (await api('GET', `/reports/compile?project_id=${P['001']}&type=WEEKLY&from=${t}`)).body;
  assert.equal(w2.progress.items.find(i => i.id === item.id).actual, 5);
  assert.ok(w2.alerts.some(a => a.code === 'SCHEDULE_BEHIND' || a.code === 'ITEMS_LATE'), 'nhập thấp hơn kế hoạch → có cảnh báo chậm');
});

test('chuyển tài khoản cho người khác: đổi họ tên tài khoản nhưng giữ tên người lập trên bản ghi cũ', async () => {
  const tb = (await api('GET', '/users')).body.find(x => x.username === 'thanhb');
  const usage = (await api('GET', `/users/${tb.id}/usage`)).body;
  assert.ok(usage.daily_logs > 0, 'thanhb đã lập nhật ký');
  assert.equal((await api('GET', `/users/${tb.id}/usage`, null, 'thanhb')).status, 403);
  const r = await api('PATCH', `/users/${tb.id}`, { full_name: 'Người Nhận Tài Khoản', keep_history_name: true });
  assert.equal(r.status, 200); assert.ok(r.body.history_name_kept_on >= usage.daily_logs);
  const logs = (await api('GET', `/daily-logs?project_id=${P['001']}`)).body.filter(l => l.created_by === tb.id);
  assert.ok(logs.length && logs.every(l => l.created_by_name === 'Nguyễn Thành B'), 'bản ghi cũ vẫn ghi người lập cũ');
  const fresh = (await api('POST', '/daily-logs', { project_id: P['001'], log_date: shift(vnToday(), 40), shift: 'CA3', work_summary: 'mới' }, 'thanhb')).body;
  assert.equal((await api('GET', `/daily-logs?project_id=${P['001']}`)).body.find(l => l.id === fresh.id).created_by_name, 'Người Nhận Tài Khoản', 'bản ghi mới mang họ tên mới');
  assert.equal((await api('GET', `/users/${tb.id}/usage`)).body.daily_logs, 1, 'chỉ còn bản mới chưa chốt tên');
  await api('PATCH', `/users/${tb.id}`, { full_name: 'Nguyễn Thành B' });
});

// ---- Đợt 12 (06/10): quyền Xóa (chỉ quản trị hoặc được cấp) + Thùng rác ----
test('xóa: người lập, Trưởng TVGS không xóa được; Admin xóa phải có lý do → Thùng rác → khôi phục đủ tệp đính kèm', async () => {
  const d = shift(vnToday(), 50);
  const log = (await api('POST', '/daily-logs', { project_id: P['001'], log_date: d, shift: 'CA1', work_summary: 'Nhật ký sẽ bị xóa' }, 'thanhb')).body;
  assert.equal((await api('POST', `/daily-logs/${log.id}/files?name=bb.pdf`, Buffer.from('%PDF-1.4 bien ban'), 'thanhb', { 'Content-Type': 'application/pdf' })).status, 201);
  assert.equal((await api('DELETE', `/daily-logs/${log.id}`, { reason: 'thử xóa' }, 'thanhb')).status, 403, 'người lập (kể cả bản nháp) không có quyền Xóa');
  assert.equal((await api('DELETE', `/daily-logs/${log.id}`, { reason: 'thử xóa' }, 'hung')).status, 404, 'Trưởng TVGS không thấy (nên không xóa được) bản nháp của thành viên');
  assert.equal((await api('DELETE', `/daily-logs/${log.id}`, {})).status, 400, 'phải ghi lý do');
  const del = await api('DELETE', `/daily-logs/${log.id}`, { reason: 'Lập trùng ca' });
  assert.equal(del.status, 200); assert.ok(del.body.recycle_id);
  assert.ok(!(await api('GET', `/daily-logs?project_id=${P['001']}`)).body.some(l => l.id === log.id), 'không còn trong danh sách');
  const bin = (await api('GET', '/recycle-bin')).body.find(r => r.id === del.body.recycle_id);
  assert.equal(bin.reason, 'Lập trùng ca'); assert.equal(bin.child_count, 1); assert.equal(bin.deleted_by_name, 'Admin');
  assert.equal((await api('GET', '/recycle-bin', null, 'thanhb')).status, 403, 'không có quyền Xóa ở đâu → không xem Thùng rác');
  assert.equal((await api('POST', `/recycle-bin/${del.body.recycle_id}/restore`)).status, 200);
  const back = (await api('GET', `/daily-logs?project_id=${P['001']}`)).body.find(l => l.id === log.id);
  assert.ok(back && back.file_count === 1 && back.work_summary === 'Nhật ký sẽ bị xóa', 'khôi phục đủ nội dung và tệp');
  const files = (await api('GET', `/daily-logs/${log.id}/files`)).body;
  const dl = await api('GET', `/daily-logs/${log.id}/files/${files[0].id}`);
  assert.equal(dl.body.toString(), '%PDF-1.4 bien ban', 'nội dung tệp nguyên vẹn');
  assert.equal((await api('POST', `/recycle-bin/${del.body.recycle_id}/restore`)).status, 409, 'không khôi phục 2 lần');
  // Trùng ngày/ca khi khôi phục → báo rõ, không lỗi 500
  const del2 = (await api('DELETE', `/daily-logs/${log.id}`, { reason: 'xóa lần 2' })).body;
  await api('POST', '/daily-logs', { project_id: P['001'], log_date: d, shift: 'CA1', work_summary: 'bản lập lại' }, 'thanhb');
  const conflict = await api('POST', `/recycle-bin/${del2.recycle_id}/restore`);
  assert.equal(conflict.status, 409); assert.match(conflict.body.error, /trùng/);
});

test('xóa: cấp quyền Xóa cho nhân viên tại 1 công trình; chỉ Admin xóa vĩnh viễn; bảng tiến độ và văn bản chất lượng khôi phục đủ số liệu', async () => {
  const m = (await api('GET', `/project-members/project/${P['001']}`)).body.find(x => x.username === 'thanhb');
  await api('PUT', `/project-members/${m.id}`, { access_permissions: ['VIEW', 'CREATE', 'DOWNLOAD', 'DELETE'] });
  const doc = (await api('POST', '/documents', { project_id: P['001'], doc_group: 'LEGAL', type: 'HS', name: 'Hồ sơ nhập nhầm' }, 'thanhb')).body;
  const del = await api('DELETE', `/documents/${doc.id}`, { reason: 'Nhập nhầm công trình' }, 'thanhb');
  assert.equal(del.status, 200, 'được cấp quyền Xóa thì xóa được');
  const mine = (await api('GET', '/recycle-bin', null, 'thanhb')).body;
  assert.ok(mine.length && mine.every(r => r.project_id === P['001']), 'chỉ thấy thùng rác công trình mình có quyền Xóa');
  assert.equal((await api('DELETE', `/recycle-bin/${del.body.recycle_id}`, null, 'thanhb')).status, 403, 'nhân viên không xóa vĩnh viễn');
  assert.equal((await api('DELETE', `/recycle-bin/${del.body.recycle_id}`)).status, 200, 'Admin xóa vĩnh viễn');
  assert.equal((await api('POST', `/recycle-bin/${del.body.recycle_id}/restore`)).status, 409, 'đã xóa vĩnh viễn thì không khôi phục');
  const trace = (await api('GET', '/recycle-bin')).body.find(r => r.id === del.body.recycle_id);
  assert.ok(trace.purged_at && trace.reason === 'Nhập nhầm công trình', 'vẫn giữ dòng vết');
  await api('PUT', `/project-members/${m.id}`, { access_permissions: null });
  assert.ok(!(await api('GET', '/project-members/my-permissions', null, 'thanhb')).body[P['001']].permissions.includes('DELETE'), 'mặc định không có Xóa');
  // Bảng tiến độ (kèm hạng mục + số liệu thực tế)
  const plan = (await api('GET', `/projects/${P['001']}/progress-plans`)).body.find(x => x.is_current);
  const before = (await api('GET', `/projects/${P['001']}/progress-plans/${plan.id}?as_of=${vnToday()}`)).body.summary;
  assert.equal((await api('DELETE', `/projects/${P['001']}/progress-plans/${plan.id}`, { reason: 'x' })).status, 400);
  const dp = await api('DELETE', `/projects/${P['001']}/progress-plans/${plan.id}`, { reason: 'Tải nhầm tệp' });
  assert.equal(dp.status, 200);
  assert.equal((await api('POST', `/recycle-bin/${dp.body.recycle_id}/restore`)).status, 200);
  const after = (await api('GET', `/projects/${P['001']}/progress-plans/${plan.id}?as_of=${vnToday()}`)).body;
  assert.equal(after.summary.actual_percent, before.actual_percent, 'khôi phục đủ số liệu thực tế');
  assert.ok((await api('GET', `/projects/${P['001']}/progress-plans`)).body.find(x => x.id === plan.id).is_current);
  // Văn bản chất lượng
  const iss = (await api('POST', '/issues', { project_id: P['001'], title: 'Biên bản lập nhầm', severity: 'LOW' }, 'thanhb')).body;
  const di = await api('DELETE', `/issues/${iss.id}`, { reason: 'Lập nhầm' });
  assert.equal(di.status, 200);
  assert.equal((await api('GET', `/issues?project_id=${P['001']}`)).body.some(x => x.id === iss.id), false);
  await api('POST', `/recycle-bin/${di.body.recycle_id}/restore`);
  assert.ok((await api('GET', `/issues?project_id=${P['001']}`)).body.some(x => x.id === iss.id));
});


test('đăng nhập sai: thông báo bằng tiếng Việt, hai trường hợp giống nhau để không lộ tài khoản', async () => {
  const c = await api('POST', '/users', { username: 'tv.thongbao', full_name: 'Thử thông báo', password: 'TamThoi123', role_name: 'ENGINEER' });
  assert.ok([200, 201].includes(c.status), 'tạo tài khoản thử: ' + JSON.stringify(c.body));
  const saiMatKhau = await api('POST', '/auth/login', { username: 'tv.thongbao', password: 'sai-mat-khau' }, null);
  const khongCoNguoi = await api('POST', '/auth/login', { username: 'khong.co.nguoi.nay.2', password: 'sai-mat-khau' }, null);
  assert.equal(saiMatKhau.status, 401);
  assert.equal(khongCoNguoi.status, 401);
  assert.match(String(saiMatKhau.body.error), /Tên đăng nhập hoặc mật khẩu/, 'thông báo phải bằng tiếng Việt: ' + saiMatKhau.body.error);
  assert.equal(khongCoNguoi.body.error, saiMatKhau.body.error, 'sai mật khẩu và không có tài khoản phải cùng thông báo');
});
test('van ban chat luong: luu tap trung day du chi tiet bieu mau trong issues.details', async () => {
  const details = {
    documentType: 'MINUTES',
    sourceType: 'Bien ban hien truong',
    reference: 'BBHT-001',
    projectName: 'Cong trinh A',
    packageName: 'Goi thau 1',
    documentDate: '2026-10-12',
    startTime: '2026-10-12T08:00',
    endTime: '2026-10-12T09:30',
    conclusion: 'Dat yeu cau, tiep tuc theo doi',
    participants: [{ group: 'TVGS', name: 'Nguyen Thanh B', role: 'GS vien' }],
    signatures: { tvgs: 'Nguyen Thanh B' }
  };
  const created = await api('POST', '/issues', {
    project_id: P['001'], issue_code: 'BBHT-001', title: 'Kiem tra cot tang 1',
    description: 'Kiem tra kich thuoc va cot thep', severity: 'LOW', due_date: '2026-10-15',
    source_type: 'Bien ban hien truong', details
  }, 'thanhb');
  assert.equal(created.status, 201);
  const fetched = (await api('GET', `/issues?project_id=${P['001']}`)).body.find(x => x.id === created.body.id);
  assert.equal(fetched.details.reference, 'BBHT-001');
  assert.equal(fetched.details.participants[0].name, 'Nguyen Thanh B');
  assert.equal(fetched.details.signatures.tvgs, 'Nguyen Thanh B');
  const updated = await api('PATCH', `/issues/${created.body.id}`, {
    details: { ...fetched.details, conclusion: 'Can bo sung anh hien truong' }
  }, 'thanhb');
  assert.equal(updated.status, 200);
  assert.equal((await api('GET', `/issues/${created.body.id}`)).body.details.conclusion, 'Can bo sung anh hien truong');
});

test('sửa công trình/bảng tiến độ: xét quyền Duyệt TẠI công trình, không theo loại tài khoản chung', async () => {
  // son (ENGINEER) là "TVGS trưởng" tại 003 → được sửa 003; hung (TVGS_LEAD) chỉ là "GS viên" tại 002 → không được sửa 002.
  const setTitle = (user, contract, title) => psql(`UPDATE project_members pm SET assignment_title=${title === null ? 'NULL' : `'${title}'`} FROM users u, projects p WHERE pm.user_id=u.id AND pm.project_id=p.id AND u.username='${user}' AND p.contract_no='${contract}'`);
  const before = { son: psql(`SELECT COALESCE(pm.assignment_title,'') FROM project_members pm JOIN users u ON u.id=pm.user_id JOIN projects p ON p.id=pm.project_id WHERE u.username='son' AND p.contract_no='003'`),
    hung: psql(`SELECT COALESCE(pm.assignment_title,'') FROM project_members pm JOIN users u ON u.id=pm.user_id JOIN projects p ON p.id=pm.project_id WHERE u.username='hung' AND p.contract_no='002'`) };
  try {
    setTitle('son', '003', 'TVGS trưởng');
    setTitle('hung', '002', 'GS viên');
    const p3 = (await api('GET', `/projects/${P['003']}`)).body; const p2 = (await api('GET', `/projects/${P['002']}`)).body;
    let r = await api('PATCH', `/projects/${P['003']}`, { name: p3.name, contract_no: p3.contract_no }, 'son');
    assert.equal(r.status, 200, 'TVGS trưởng tại công trình phải sửa được công trình đó: ' + JSON.stringify(r.body));
    r = await api('PATCH', `/projects/${P['002']}`, { name: p2.name + ' (lén sửa)', contract_no: p2.contract_no }, 'hung');
    assert.equal(r.status, 403, 'tài khoản loại TVGS_LEAD nhưng chỉ là GS viên tại công trình thì không được sửa');
    assert.match(r.body.error, /Duyệt/, 'thông báo lỗi tiếng Việt nêu rõ thiếu quyền Duyệt');
    r = await api('PATCH', `/projects/${P['003']}`, { name: p3.name, contract_no: p3.contract_no }, 'tuan');
    assert.equal(r.status, 403, 'GS viên thường không sửa được công trình');
    r = await api('PATCH', `/projects/${P['002']}`, { name: p2.name, contract_no: p2.contract_no }, 'duong');
    assert.equal(r.status, 200, 'Giám đốc vẫn sửa được mọi công trình');
  } finally {
    setTitle('son', '003', before.son || null);
    setTitle('hung', '002', before.hung || null);
  }
});

test('báo cáo ngày: bản nháp chỉ người lập thấy và sửa; TVGS trưởng chỉ thấy khi đã gửi; Giám đốc thấy hết', async () => {
  const r = await api('POST', '/daily-logs', { project_id: P['001'], log_date: '2026-07-07', shift: 'CA1', work_summary: 'NHAP-RIENG thanh vien' }, 'thanhb');
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.id;
  const inList = async who => (await api('GET', `/daily-logs?project_id=${P['001']}`, null, who)).body.some(x => x.id === id);
  assert.equal(await inList('thanhb'), true, 'người lập thấy nháp của mình');
  assert.equal(await inList('hung'), false, 'TVGS trưởng không thấy nháp của thành viên');
  assert.equal(await inList('son'), false, 'thành viên khác không thấy');
  assert.equal(await inList('duong'), true, 'Giám đốc thấy hết');
  assert.equal((await api('GET', `/daily-logs/${id}`, null, 'hung')).status, 404, 'xem trực tiếp theo id cũng bị chặn');
  assert.equal((await api('GET', `/daily-logs/${id}/files`, null, 'hung')).status, 404, 'tệp kèm nháp bị chặn');
  assert.equal((await api('PATCH', `/daily-logs/${id}`, { work_summary: 'trưởng sửa lén' }, 'hung')).status, 404, 'TVGS trưởng không sửa được nháp thành viên');
  assert.equal((await api('POST', `/daily-logs/${id}/submit`, {}, 'hung')).status, 404, 'TVGS trưởng không gửi duyệt hộ được');
  const bulk = (await api('POST', '/daily-logs/bulk', { action: 'submit', ids: [id] }, 'hung')).body;
  assert.equal(bulk.done.length, 0, 'gửi duyệt hàng loạt cũng không gom được nháp người khác');
  const comp = (await api('GET', `/reports/compile?project_id=${P['001']}&type=DAILY&from=2026-07-07`, null, 'hung')).body;
  assert.ok(!JSON.stringify(comp).includes('NHAP-RIENG'), 'báo cáo tổng hợp không gom nháp người khác');
  assert.equal((await api('PATCH', `/daily-logs/${id}`, { work_summary: 'NHAP-RIENG đã sửa' }, 'thanhb')).status, 200, 'người lập vẫn sửa được');
  assert.equal((await api('POST', `/daily-logs/${id}/submit`, {}, 'thanhb')).status, 200);
  assert.equal(await inList('hung'), true, 'gửi rồi thì TVGS trưởng thấy');
  assert.equal((await api('GET', `/daily-logs/${id}`, null, 'hung')).status, 200);
});

test('cảnh báo thiếu báo cáo ngày: ngày chỉ có bản nháp vẫn tính là thiếu, gửi duyệt rồi mới hết thiếu', async () => {
  const before = (await api('GET', `/reports/health/${P['001']}`)).body;
  const d = (before.logs?.missing_days || [])[0];
  assert.ok(d, 'cần ít nhất một ngày đang thiếu báo cáo để thử: ' + JSON.stringify(before.logs));
  const r = await api('POST', '/daily-logs', { project_id: P['001'], log_date: d, shift: 'CA3', work_summary: 'nháp chưa gửi' }, 'thanhb');
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const draftOnly = (await api('GET', `/reports/health/${P['001']}`)).body;
  assert.ok(draftOnly.logs.missing_days.includes(d), 'chỉ có nháp thì vẫn là thiếu');
  assert.equal((await api('POST', `/daily-logs/${r.body.id}/submit`, null, 'thanhb')).status, 200);
  const submitted = (await api('GET', `/reports/health/${P['001']}`)).body;
  assert.ok(!submitted.logs.missing_days.includes(d), 'đã gửi duyệt thì hết thiếu');
});
