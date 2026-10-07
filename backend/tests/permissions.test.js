const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDb } = require('./lib/testDb');
const { expect, createUsers, createProjects, record } = require('./lib/roleFixtures');
if (!process.env.PERMISSION_TEST_DB_URL) throw new Error('Cần PERMISSION_TEST_DB_URL trỏ DB vina_reg* riêng');
const db = createTestDb(process.env.PERMISSION_TEST_DB_URL);
const BASE = 'http://127.0.0.1:3112';
const routes = ['daily-logs','documents','issues'];
let server, users, fixture;
test.before(async () => {
  db.setupAll(); server = db.startServer({ port:3112 }); await db.waitHealth(BASE);
  users = await createUsers(BASE, 'test.api');
});
test.beforeEach(async () => { fixture = await createProjects(users); });
test.after(() => { if (server) server.kill(); });
const pathOf = (route,r) => '/' + route + '/' + r.id;
async function submit(route,r,who='ks') { return expect(await users[who].api.post(pathOf(route,r) + '/submit', {}), 200); }
async function unchanged(route,r) {
  const current = expect(await users.admin.api.get(pathOf(route,r)), 200);
  assert.equal(current.row_version,r.row_version); assert.equal(current.status,r.status);
  return current;
}

test('PQ01: kỹ sư A thêm/sửa của mình; không sửa người khác hoặc duyệt (3 phân hệ)', async () => {
  for (const route of routes) {
    const mine = await record(users,fixture,route);
    expect(await users.ks.api.patch(pathOf(route,mine), { name:'Đã sửa', title:'Đã sửa', work_summary:'Đã sửa', expected_row_version:mine.row_version }),200);
    const other = await record(users,fixture,route,'A','gst');
    const denied = await users.ks.api.patch(pathOf(route,other), { name:'Trái quyền',title:'Trái quyền',work_summary:'Trái quyền',expected_row_version:other.row_version });
    assert.ok([403,404].includes(denied.status)); await unchanged(route,other);
    if (route !== 'issues') {
      const submitted = await submit(route,mine);
      expect(await users.ks.api.post(pathOf(route,mine)+'/approve',{}),403);
      await unchanged(route,submitted);
    } else {
      expect(await users.ks.api.post(pathOf(route,other)+'/reopen',{expected_row_version:other.row_version}),403);
    }
  }
});
test('PQ02: ENGINEER là GST ở B được duyệt; quyền không lan sang A/C', async () => {
  const map = expect(await users.ks.api.get('/project-members/my-permissions'),200);
  assert.ok(map[fixture.projects.B.id].permissions.includes('APPROVE'));
  assert.ok(!map[fixture.projects.A.id].permissions.includes('APPROVE')); assert.equal(map[fixture.projects.C.id],undefined);
  for (const route of ['daily-logs','documents']) {
    const r = await record(users,fixture,route,'B','gst'); await submit(route,r,'gst');
    assert.equal(expect(await users.ks.api.post(pathOf(route,r)+'/approve',{}),200).status,'APPROVED');
  }
  const issue = await record(users,fixture,'issues','B','gst');
  expect(await users.ks.api.patch(pathOf('issues',issue),{title:'GST sửa được',expected_row_version:issue.row_version}),200);
  expect(await users.ks.api.post(pathOf('issues',issue)+'/assign',{assigned_to:users.gst.id}),200);
});
test('PQ03: không phân công C bị chặn danh sách, ID, tệp và ghi (3 phân hệ)', async () => {
  const list = expect(await users.ks.api.get('/projects'),200);
  assert.ok(!list.some(p=>p.id===fixture.projects.C.id));
  expect(await users.ks.api.get('/projects/'+fixture.projects.C.id),403);
  for (const route of routes) {
    const r = await record(users,fixture,route,'C','admin'), p=pathOf(route,r);
    expect(await users.ks.api.get('/'+route+'?project_id='+fixture.projects.C.id),403);
    expect(await users.ks.api.get(p),403);
    expect(await users.ks.api.patch(p,{expected_row_version:r.row_version}),403);
    expect(await users.ks.api.get(p+'/files/00000000-0000-4000-8000-000000000001'),403);
    expect(await users.ks.api.del(p,{reason:'Thử trái quyền'}),403); await unchanged(route,r);
  }
});
test('PQ04: GST A trả lại có lý do, duyệt, khóa; chất lượng đóng/mở lại riêng', async () => {
  for (const route of ['daily-logs','documents']) {
    const r=await record(users,fixture,route); const p=pathOf(route,r); const sent=await submit(route,r);
    expect(await users.gst.api.post(p+'/reject',{}),400); await unchanged(route,sent);
    assert.equal(expect(await users.gst.api.post(p+'/reject',{comment:'Bổ sung khối lượng'}),200).status,'DRAFT');
    await submit(route,r); expect(await users.gst.api.post(p+'/approve',{}),200);
    assert.equal(expect(await users.gst.api.post(p+'/lock',{}),200).status,'LOCKED');
  }
  const issue=await record(users,fixture,'issues'); const p=pathOf('issues',issue);
  const closed=expect(await users.gst.api.post(p+'/resolve',{expected_row_version:issue.row_version}),200);
  assert.equal(closed.status,'RESOLVED');
  assert.equal(expect(await users.gst.api.post(p+'/reopen',{expected_row_version:closed.row_version}),200).status,'OPEN');
});
test('PQ05: tài khoản TVGS_LEAD là Kỹ sư/Phó ở B/C không được duyệt', async () => {
  for (const ct of ['B','C']) for (const route of ['daily-logs','documents']) {
    const r=await record(users,fixture,route,ct,'gst'); const sent=await submit(route,r,'gst');
    for (const action of ['approve','reject','lock']) expect(await users.gst.api.post(pathOf(route,r)+'/'+action,{comment:'Lý do thử'}),403);
    await unchanged(route,sent);
  }
  const issue=await record(users,fixture,'issues','B','ks');
  expect(await users.gst.api.post(pathOf('issues',issue)+'/assign',{assigned_to:users.ks.id}),403);
  await unchanged('issues',issue);
});
test('PQ06: nháp báo cáo riêng; GST không đọc ID/ảnh/tệp cho tới khi gửi', async () => {
  const r=await record(users,fixture,'daily-logs'), p=pathOf('daily-logs',r);
  assert.equal(expect(await users.ks.api.get(p),200).can_edit,true);
  assert.ok(!expect(await users.gst.api.get('/daily-logs?project_id='+r.project_id),200).some(x=>x.id===r.id));
  for (const path of [p,p+'/attachments',p+'/files',p+'/files/00000000-0000-4000-8000-000000000001']) expect(await users.gst.api.get(path),404);
  await submit('daily-logs',r); expect(await users.gst.api.get(p),200);
});
test('PQ07: trình công ty chặn GST quyết định; Giám đốc duyệt được', async () => {
  for (const route of ['daily-logs','documents']) {
    const r=await record(users,fixture,route), p=pathOf(route,r); await submit(route,r);
    expect(await users.gst.api.post(p+'/escalate',{comment:'Cần công ty quyết định'}),200);
    const before=expect(await users.admin.api.get(p),200);
    assert.equal(before.last_review.action,'ESCALATE');
    for (const action of ['approve','reject']) expect(await users.gst.api.post(p+'/'+action,{comment:'Không được tự quyết'}),409);
    await unchanged(route,before); expect(await users.gd.api.post(p+'/approve',{}),200);
  }
});
test('PQ08: MANAGER A chỉ xem/tải; không thêm/sửa/duyệt/xóa', async () => {
  for (const route of routes) {
    const r=await record(users,fixture,route), p=pathOf(route,r);
    expect(await users.ks.api.upload(p+'/files?name=thu.txt',Buffer.from('Dữ liệu thử quyền')),201);
    if(route!=='issues') await submit(route,r);
    expect(await users.ql.api.get(p),200);
    const files=expect(await users.admin.api.get(route==='documents'?p:p+'/files'),200);
    const file=(route==='documents'?files.files:files)[0];
    assert.equal(expect(await users.ql.api.get(p+'/files/'+file.id),200).toString(),'Dữ liệu thử quyền');
    expect(await users.ql.api.post('/'+route,{project_id:r.project_id,name:'Cấm',title:'Cấm'}),403);
    expect(await users.ql.api.patch(p,{name:'Cấm',title:'Cấm',expected_row_version:r.row_version}),403);
    expect(await users.ql.api.del(p,{reason:'Thử trái quyền'}),403);
    if(route!=='issues') expect(await users.ql.api.post(p+'/approve',{}),403);
  }
  expect(await users.ql.api.get('/projects/'+fixture.projects.B.id),403);
});
test('PQ09: Giám đốc thấy tất cả, xóa vào thùng rác, không trình công ty', async () => {
  const list=expect(await users.gd.api.get('/projects'),200);
  for(const p of Object.values(fixture.projects)) assert.ok(list.some(x=>x.id===p.id));
  for(const route of routes){
    const r=await record(users,fixture,route), p=pathOf(route,r);
    if(route!=='issues'){await submit(route,r);expect(await users.gd.api.post(p+'/escalate',{comment:'Không cần trình'}),400);}
    const deleted=expect(await users.gd.api.del(p,{reason:'Dữ liệu thử cần xóa'}),200);
    assert.ok(deleted.recycle_id); assert.ok(expect(await users.gd.api.get('/recycle-bin'),200).some(x=>x.id===deleted.recycle_id));
  }
});
test('PQ10: chỉ Admin xóa vĩnh viễn; Giám đốc không purge được', async () => {
  const r=await record(users,fixture,'documents');
  const trash=expect(await users.admin.api.del(pathOf('documents',r),{reason:'Xóa thử quyền'}),200);
  expect(await users.gd.api.del('/recycle-bin/'+trash.recycle_id),403);
  expect(await users.ks.api.del('/recycle-bin/'+trash.recycle_id),403);
  expect(await users.admin.api.del('/recycle-bin/'+trash.recycle_id),200);
});
test('PQ11: bỏ phân công chặn ngay token đang dùng, không thay dữ liệu', async () => {
  const saved=[];for(const route of routes)saved.push([route,await record(users,fixture,route)]);
  expect(await users.admin.api.del('/project-members/'+fixture.members.A.ks.id),200);
  for(const [route,r] of saved){const p=pathOf(route,r);
    expect(await users.ks.api.patch(p,{expected_row_version:r.row_version,name:'Cấm',title:'Cấm'}),403);
    expect(await users.ks.api.get(p),403); expect(await users.ks.api.upload(p+'/files?name=cam.txt',Buffer.from('cấm')),403);
    await unchanged(route,r);
  }
});
test('PQ12: hết hạn hôm qua hoặc chưa đến ngày bắt đầu đều mất quyền', async () => {
  const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
  expect(await users.admin.api.put('/project-members/'+fixture.members.A.ks.id,{end_date:yesterday}),200);
  expect(await users.ks.api.get('/projects/'+fixture.projects.A.id),403);
  db.psql(`UPDATE project_members SET start_date=CURRENT_DATE+1 WHERE id='${fixture.members.B.ks.id}'`);
  expect(await users.ks.api.get('/projects/'+fixture.projects.B.id),403);
  const map=expect(await users.ks.api.get('/project-members/my-permissions'),200);
  assert.equal(map[fixture.projects.A.id],undefined);assert.equal(map[fixture.projects.B.id],undefined);
});
test('PQ13: quyền DELETE tùy chỉnh chỉ ở A, không ở B, không cấp purge', async () => {
  expect(await users.gd.api.put('/project-members/'+fixture.members.A.ks.id,{access_permissions:['VIEW','CREATE','DOWNLOAD','DELETE']}),200);
  for(const route of routes){
    const a=await record(users,fixture,route), b=await record(users,fixture,route,'B','ks');
    const trash=expect(await users.ks.api.del(pathOf(route,a),{reason:'Xóa theo tùy chỉnh'}),200);
    expect(await users.ks.api.del(pathOf(route,b),{reason:'Không được xóa B'}),403);await unchanged(route,b);
    expect(await users.ks.api.del('/recycle-bin/'+trash.recycle_id),403);
  }
});
test('PQ14: tùy chỉnh [] chặn VIEW thật, kể cả danh sách công trình và báo cáo', async () => {
  const saved=[];for(const route of routes)saved.push([route,await record(users,fixture,route)]);
  expect(await users.admin.api.put('/project-members/'+fixture.members.A.ks.id,{access_permissions:[]}),200);
  assert.ok(!expect(await users.ks.api.get('/projects'),200).some(p=>p.id===fixture.projects.A.id));
  for(const [route,r] of saved){
    expect(await users.ks.api.get('/'+route+'?project_id='+r.project_id),403);
    expect(await users.ks.api.get(pathOf(route,r)),403);
    expect(await users.ks.api.patch(pathOf(route,r),{expected_row_version:r.row_version}),403);
    await unchanged(route,r);
  }
  expect(await users.ks.api.get('/reports/health/'+fixture.projects.A.id),403);
  expect(await users.ks.api.get('/project-personnel/project/'+fixture.projects.A.id+'/team'),403);
});
test('PQ15: VIEW không DOWNLOAD không lấy được tệp ba phân hệ, công trình, chứng chỉ', async () => {
  const files=[];
  for(const route of routes){const r=await record(users,fixture,route);
    const file=expect(await users.ks.api.upload(pathOf(route,r)+'/files?name=thu.txt',Buffer.from('Tệp bảo vệ')),201);
    files.push([pathOf(route,r),file.id]);
  }
  const p='/projects/'+fixture.projects.A.id;
  const pf=expect(await users.admin.api.upload(p+'/files?name=hop-dong.txt',Buffer.from('Hợp đồng thử')),201);
  files.push([p,pf.id]);
  const personnel='/project-personnel/'+fixture.members.A.ks.personnel_id;
  const certificate=expect(await users.admin.api.upload(personnel+'/files?name=cc.txt',Buffer.from('Chứng chỉ thử')),201);
  files.push([personnel,certificate.id]);
  expect(await users.admin.api.put('/project-members/'+fixture.members.A.ks.id,{access_permissions:['VIEW']}),200);
  for(const [p,id] of files){expect(await users.ks.api.get(p+'/files/'+id),403);expect(await users.admin.api.get(p+'/files/'+id),200);}
  expect(await users.ks.api.get('/projects/'+fixture.projects.A.id),200);
});
test('PQ16: tùy chỉnh bỏ APPROVE thay mặc định GST; khôi phục null trả mặc định', async () => {
  expect(await users.admin.api.put('/project-members/'+fixture.members.A.gst.id,{access_permissions:['VIEW','CREATE','DOWNLOAD']}),200);
  for(const route of ['daily-logs','documents']){const r=await record(users,fixture,route);await submit(route,r);
    expect(await users.gst.api.post(pathOf(route,r)+'/approve',{}),403);
  }
  expect(await users.admin.api.put('/project-members/'+fixture.members.A.gst.id,{access_permissions:null}),200);
  const map=expect(await users.gst.api.get('/project-members/my-permissions'),200);
  assert.ok(map[fixture.projects.A.id].permissions.includes('APPROVE'));
});
test('PQ17: kỹ sư không tự đổi chức danh/quyền hoặc phân công mình', async () => {
  const m=fixture.members.A.ks;
  expect(await users.ks.api.put('/project-members/'+m.id,{assignment_title:'Giám sát trưởng',access_permissions:['APPROVE']}),403);
  expect(await users.ks.api.put('/project-personnel/'+m.personnel_id,{assignment_title:'Giám sát trưởng'}),403);
  expect(await users.ks.api.post('/project-members',{project_id:fixture.projects.C.id,user_id:users.ks.id,assignment_title:'Giám sát trưởng'}),403);
  const map=expect(await users.ks.api.get('/project-members/my-permissions'),200);
  assert.ok(!map[fixture.projects.A.id].permissions.includes('APPROVE'));
});
test('PQ18: ưu tiên chức danh nhân sự; Phó không duyệt; ADMIN/DIRECTOR toàn quyền', async () => {
  db.psql(`UPDATE project_members SET assignment_title='Giám sát trưởng' WHERE id='${fixture.members.A.ks.id}'`);
  const map=expect(await users.ks.api.get('/project-members/my-permissions'),200);
  assert.ok(!map[fixture.projects.A.id].permissions.includes('APPROVE'),'Nhân sự Kỹ sư phải thắng chức danh phân công');
  const gst=expect(await users.gst.api.get('/project-members/my-permissions'),200);
  assert.ok(!gst[fixture.projects.C.id].permissions.includes('APPROVE'));
  expect(await users.admin.api.put('/project-members/'+fixture.members.A.ql.id,{access_permissions:['EDIT']}),200);
  const ql=expect(await users.ql.api.get('/project-members/my-permissions'),200);
  assert.deepEqual(ql[fixture.projects.A.id].permissions,['VIEW','CREATE','EDIT']);
});
test('PQ19: LOCKED chặn sửa/thêm tệp ngay cả Admin/Giám đốc; mở lại có dấu vết rồi sửa', async () => {
  for(const route of ['daily-logs','documents']){
    const r=await record(users,fixture,route), p=pathOf(route,r);await submit(route,r);
    expect(await users.gst.api.post(p+'/approve',{}),200);const locked=expect(await users.gst.api.post(p+'/lock',{}),200);
    for(const who of ['admin','gd','gst','ks']){
      const denied=await users[who].api.patch(p,{name:'Ghi đè khóa',work_summary:'Ghi đè khóa',expected_row_version:locked.row_version});
      assert.ok([403,409].includes(denied.status));
      const upload=await users[who].api.upload(p+'/files?name=cam.txt',Buffer.from('Không được lưu'));
      assert.ok([403,409].includes(upload.status));
    }
    await unchanged(route,locked);
    if(route==='daily-logs')assert.equal(expect(await users.admin.api.get(p),200).can_edit,false);
    expect(await users.gst.api.post(p+'/reopen',{reason:'Mở lại để sửa có kiểm soát'}),200);
    const reopened=expect(await users.ks.api.get(p),200);assert.equal(reopened.status,'DRAFT');
    expect(await users.ks.api.patch(p,{name:'Sửa sau mở lại',work_summary:'Sửa sau mở lại',expected_row_version:reopened.row_version}),200);
  }
});
test('PQ20: hộp việc không lộ báo cáo/hồ sơ của công trình đã thu hồi VIEW', async () => {
  for(const route of ['daily-logs','documents']){
    const r=await record(users,fixture,route), p=pathOf(route,r);await submit(route,r);
    expect(await users.gst.api.post(p+'/reject',{comment:'Cần bổ sung thử quyền'}),200);
  }
  const before=expect(await users.ks.api.get('/reviews/inbox'),200);
  assert.ok(before.returned.some(r=>r.project_id===fixture.projects.A.id));
  expect(await users.admin.api.put('/project-members/'+fixture.members.A.ks.id,{access_permissions:[]}),200);
  const after=expect(await users.ks.api.get('/reviews/inbox'),200);
  assert.ok(!after.returned.some(r=>r.project_id===fixture.projects.A.id));
  assert.ok(!after.approved.some(r=>r.project_id===fixture.projects.A.id));
});
test('PQ21: lưu quyền/chức danh khi không có gói thầu không lỗi UUID; bỏ qua trường giữ gói cũ', async () => {
  const p='/project-personnel/'+fixture.members.A.gst.personnel_id;
  expect(await users.admin.api.put(p,{assignment_title:'Giám sát trưởng',bidding_package_id:null}),200);
  const pkg=expect(await users.admin.api.post('/bidding-packages',{project_id:fixture.projects.A.id,name:'Gói thầu thử'}),201);
  const selected=expect(await users.admin.api.put(p,{bidding_package_id:pkg.id}),200);
  assert.equal(selected.bidding_package_id,pkg.id);
  const unchangedPackage=expect(await users.admin.api.put(p,{certificate:'Chứng chỉ cập nhật'}),200);
  assert.equal(unchangedPackage.bidding_package_id,pkg.id);
});
