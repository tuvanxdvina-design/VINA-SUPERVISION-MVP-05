// ============================================================================
// KIỂM TRA NHANH HỆ THỐNG ĐANG CHẠY (smoke test) — VINA-SUPERVISION
// Chạy trên máy chủ, tại thư mục backend:
//   node tests\smoke-test.js admin            (hỏi mật khẩu; chỉ ĐỌC dữ liệu)
//   node tests\smoke-test.js admin --write    (thêm bước GHI THỬ: tạo hồ sơ kiểm tra, tải tệp,
//                                              tải về đối chiếu, rồi XÓA hồ sơ đó — cần Admin/Giám đốc)
// Tùy chọn: --url http://127.0.0.1:3004   (mặc định)
// Kết quả: bảng ĐẠT/LỖI từng mục; mã thoát 0 = tất cả đạt.
// ============================================================================
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const args = process.argv.slice(2);
const username = args.find(a => !a.startsWith('--'));
const WRITE = args.includes('--write');
const urlArg = args.indexOf('--url');
const BASE = (urlArg >= 0 ? args[urlArg + 1] : 'http://127.0.0.1:3004').replace(/\/$/, '');
if (!username) { console.log('Cách dùng: node tests/smoke-test.js <tên đăng nhập> [--write] [--url http://127.0.0.1:3004]'); process.exit(2); }

const results = [];
let token = '';
function record(name, ok, detail = '') { results.push({ name, ok, detail }); console.log(`${ok ? 'ĐẠT ' : 'LỖI '} ${name}${detail ? ' — ' + detail : ''}`); }
async function api(p, opts = {}) {
  const res = await fetch(BASE + '/api' + p, { ...opts, headers: { ...(opts.body && !(opts.body instanceof Buffer) ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(opts.headers || {}) } });
  const type = res.headers.get('content-type') || '';
  const body = type.includes('json') ? await res.json().catch(() => null) : Buffer.from(await res.arrayBuffer());
  return { status: res.status, body };
}
async function step(name, fn) {
  try { const detail = await fn(); record(name, true, detail || ''); return true; }
  catch (e) { record(name, false, e.message); return false; }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }
function askPassword() {
  if (process.env.SMOKE_PASSWORD) return Promise.resolve(process.env.SMOKE_PASSWORD);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => rl.question(`Mật khẩu của ${username}: `, a => { rl.close(); r(a); }));
}

(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const build = (fs.readFileSync(path.join(root, 'backend', 'src', 'build.js'), 'utf8').match(/BUILD:\s*'([^']+)'/) || [])[1];
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const htmlBuild = (html.match(/const APP_BUILD='([^']+)'/) || [])[1];
  console.log(`VINA-SUPERVISION — kiểm tra ${BASE} (mã nguồn ${build})\n`);

  await step('Giao diện và máy chủ cùng phiên bản mã nguồn', () => { expect(htmlBuild === build, `index.html=${htmlBuild}, build.js=${build}`); return build; });
  for (const f of ['web-public/index.html', 'web-public/api.js']) {
    if (fs.existsSync(path.join(root, f))) await step(`Bản sao ${f} khớp bản gốc`, () => {
      expect(fs.readFileSync(path.join(root, f), 'utf8') === fs.readFileSync(path.join(root, path.basename(f)), 'utf8'), 'khác bản gốc — chạy lại run.bat để chép');
    });
  }
  let health;
  const up = await step('Máy chủ phản hồi /health', async () => {
    const r = await fetch(BASE + '/health'); health = await r.json();
    expect(health.status === 'OK' && health.database === 'connected', JSON.stringify(health));
    return 'CSDL đã kết nối';
  });
  if (!up) return finish();
  await step('Máy chủ đang chạy đúng phiên bản (đã khởi động lại sau cập nhật)', () => { expect(health.build === build, `máy chủ đang chạy "${health.build || 'bản cũ không có mã phiên bản'}", mã nguồn là "${build}" → tắt node và chạy lại run.bat`); return health.build; });
  await step('Không còn migration CSDL chưa chạy', () => { expect(Array.isArray(health.migrations_pending), 'máy chủ bản cũ không báo trạng thái migration'); expect(!health.migrations_pending.length, 'chưa chạy: ' + health.migrations_pending.join(', ') + ' → chạy migrate-db.ps1'); });

  const pw = await askPassword();
  const ok = await step('Đăng nhập', async () => {
    const r = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password: pw }) });
    expect(r.status === 200 && r.body?.token, r.body?.error || 'HTTP ' + r.status);
    token = r.body.token; return `${r.body.user.full_name} (${r.body.user.role_name})`;
  });
  if (!ok) return finish();

  let projects = [];
  await step('Danh sách công trình', async () => { const r = await api('/projects'); expect(r.status === 200, 'HTTP ' + r.status); projects = r.body; return projects.length + ' công trình'; });
  await step('Quyền của tài khoản theo công trình', async () => { const r = await api('/project-members/my-permissions'); expect(r.status === 200, r.body?.error || 'HTTP ' + r.status); return Object.keys(r.body).length + ' công trình có quyền'; });
  for (const p of projects.slice(0, 5)) {
    const label = `[${p.project_code || p.contract_no}] ${p.name}`;
    await step(`${label}: danh sách nhân sự`, async () => { const r = await api(`/project-personnel/project/${p.id}/team`); expect(r.status === 200, r.body?.error || 'HTTP ' + r.status); return r.body.length + ' người'; });
    await step(`${label}: hồ sơ trên máy chủ`, async () => { const r = await api(`/documents?project_id=${p.id}`); expect(r.status === 200, r.body?.error || 'HTTP ' + r.status); expect(r.body.every(d => Array.isArray(d.files)), 'máy chủ chưa trả danh sách tệp (mã cũ)'); return r.body.length + ' hồ sơ, ' + r.body.reduce((n, d) => n + d.files.length, 0) + ' tệp'; });
    await step(`${label}: bảng tiến độ`, async () => { const r = await api(`/projects/${p.id}/progress-plans`); expect(r.status === 200, r.body?.error || 'HTTP ' + r.status); return r.body.length + ' bảng'; });
    await step(`${label}: nhật ký`, async () => { const r = await api(`/daily-logs?project_id=${p.id}`); expect(r.status === 200, r.body?.error || 'HTTP ' + r.status); return r.body.length + ' nhật ký'; });
  }
  if (projects[0]) {
    await step('Đọc tệp mẫu Excel bảng tiến độ', async () => {
      const file = path.join(root, 'assets', 'mau-bang-tien-do.xlsx');
      const data = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + fs.readFileSync(file).toString('base64');
      const r = await api(`/projects/${projects[0].id}/progress-plans/parse`, { method: 'POST', body: JSON.stringify({ file: { name: 'mau.xlsx', data } }) });
      expect(r.status === 200 && r.body.ok, r.body?.error || 'HTTP ' + r.status);
      return r.body.items.filter(i => i.include).length + ' hạng mục hợp lệ';
    });
  }

  if (WRITE && projects[0]) {
    const p = projects[0]; let doc;
    const bytes = Buffer.from('%PDF-1.4\n% VINA smoke test ' + new Date().toISOString() + '\n%%EOF\n');
    await step('GHI THỬ: tạo hồ sơ kiểm tra (mã do máy chủ cấp)', async () => {
      const r = await api('/documents', { method: 'POST', body: JSON.stringify({ project_id: p.id, doc_group: 'LEGAL', type: 'KHAC', name: '[KIỂM TRA TỰ ĐỘNG] xóa được', details: {} }) });
      expect(r.status === 201, r.body?.error || 'HTTP ' + r.status); doc = r.body; return doc.auto_code;
    });
    if (doc) {
      let fileId;
      await step('GHI THỬ: tải tệp lên hồ sơ', async () => {
        const r = await api(`/documents/${doc.id}/files?category=${encodeURIComponent('Kiểm tra')}&name=${encodeURIComponent('kiem-tra.pdf')}`, { method: 'POST', body: bytes, headers: { 'Content-Type': 'application/pdf' } });
        expect(r.status === 201 || r.status === 200, r.body?.error || 'HTTP ' + r.status); fileId = r.body.id; return bytes.length + ' byte';
      });
      await step('GHI THỬ: tải tệp về, nội dung trùng khớp từng byte', async () => {
        const r = await api(`/documents/${doc.id}/files/${fileId}`); expect(r.status === 200, 'HTTP ' + r.status);
        expect(Buffer.compare(r.body, bytes) === 0, 'nội dung khác'); return 'khớp';
      });
      await step('GHI THỬ: hồ sơ hiện trong danh sách chung', async () => {
        const r = await api(`/documents?project_id=${p.id}`); const found = r.body.find(d => d.id === doc.id);
        expect(found && found.files.length === 1, 'không thấy hồ sơ/tệp trong danh sách'); return found.auto_code;
      });
      await step('GHI THỬ: xóa hồ sơ kiểm tra', async () => {
        const r = await api(`/documents/${doc.id}`, { method: 'DELETE', body: JSON.stringify({ reason: 'Kiểm tra tự động (smoke test)' }) });
        expect(r.status === 200, r.body?.error || 'HTTP ' + r.status + ' (cần quyền Xóa; hãy xóa tay hồ sơ ' + doc.auto_code + ')');
        // Hồ sơ vào Thùng rác; Admin xóa vĩnh viễn luôn bản thử (Giám đốc không có quyền này → để lại trong Thùng rác)
        if (r.body?.recycle_id) { const purge = await api(`/recycle-bin/${r.body.recycle_id}`, { method: 'DELETE' }); return purge.status === 200 ? 'đã xóa vĩnh viễn bản thử' : 'bản thử nằm trong Thùng rác'; }
      });
    }
  }
  finish();
})().catch(e => { record('Lỗi không mong đợi', false, e.message); finish(); });

function finish() {
  const bad = results.filter(r => !r.ok);
  console.log(`\nKẾT QUẢ: ${results.length - bad.length}/${results.length} mục đạt.`);
  if (bad.length) console.log('Cần xử lý:\n' + bad.map(b => ' - ' + b.name + ': ' + b.detail).join('\n'));
  process.exit(bad.length ? 1 : 0);
}
