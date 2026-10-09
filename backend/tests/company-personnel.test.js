const test=require('node:test'),assert=require('node:assert/strict'),path=require('path');
const {createTestDb}=require('./lib/testDb');
const {createUsers,createProjects,expect}=require('./lib/roleFixtures');
const DB_URL=process.env.COMPANY_PERSONNEL_TEST_DB_URL;
if(!DB_URL)throw Error('COMPANY_PERSONNEL_TEST_DB_URL required: separate vina_reg* database');
const db=createTestDb(DB_URL),BASE='http://127.0.0.1:3115';
let server,users,fixture,admin,gd;
const migration=async()=>{db.psqlFile(path.join(db.ROOT,'migrations/20261009_company_personnel.sql'));await new Promise(resolve=>setTimeout(resolve,30))};
const sql=q=>db.psql(q);
test.before(async()=>{db.setupAll();server=db.startServer({port:3115});await db.waitHealth(BASE);users=await createUsers(BASE,'hoso');fixture=await createProjects(users);admin=users.admin.api;gd=users.gd.api});
test.after(()=>server?.kill());
async function person(name,uid=null){return expect(await admin.post('/company-personnel',{full_name:name,user_id:uid}),201)}
async function cert(p,number,extra={}){return expect(await admin.post('/company-personnel/'+p.id+'/certificates',{certificate_type:'Giám sát xây dựng',certificate_number:number,grade:'I',field:'Dân dụng',issued_on:'2020-01-01',issuer:'Sở xây dựng',...extra}),201)}
async function scan(p,c,label){return expect(await admin.upload(`/company-personnel/${p.id}/certificates/${c.id}/files?name=${label}.pdf`,Buffer.from('%PDF-1.7 '+label),'application/pdf'),201)}
async function assign(p,ct='A',extra={},api=admin){return api.post('/project-personnel',{project_id:fixture.projects[ct].id,personnel_profile_id:p.id,user_id:p.user_id,full_name:p.full_name,assignment_title:'Kỹ sư',company_assignment:true,...extra})}
test('Hồ sơ/cert/file: ADMIN và DIRECTOR sửa; GST/KS/QL chỉ xem, gọi trực tiếp bị chặn',async()=>{
 const p=await person('Hồ sơ phân quyền'),c=await cert(p,'QUYEN-1'),f=await scan(p,c,'scan-quyen');
 for(const who of ['gst','ks','ql']){const a=users[who].api;
  expect(await a.get('/company-personnel'),200);expect(await a.get('/company-personnel/'+p.id),200);
  for(const [method,url,body] of [['post','/company-personnel',{full_name:'Cấm'}],['put','/company-personnel/'+p.id,{full_name:'Cấm'}],['del','/company-personnel/'+p.id],['post',`/company-personnel/${p.id}/certificates`,{certificate_type:'Cấm'}],['put',`/company-personnel/${p.id}/certificates/${c.id}`,{issuer:'Cấm'}],['del',`/company-personnel/${p.id}/certificates/${c.id}`],['del',`/company-personnel/${p.id}/certificates/${c.id}/files/${f.id}`],['post','/company-personnel/merges',{}],['post','/company-personnel/merges/'+p.id+'/undo',{}]])expect(await a[method](url,body),403);
  expect(await a.upload(`/company-personnel/${p.id}/certificates/${c.id}/files?name=no.pdf`,Buffer.from('no'),'application/pdf'),403);
  expect(await a.get('/company-personnel/suggestions'),403);expect(await a.get('/company-personnel/merges'),403);
  const bytes=expect(await a.get(`/company-personnel/${p.id}/certificates/${c.id}/files/${f.id}`),200);assert.equal(bytes.toString(),'%PDF-1.7 scan-quyen');
 }
 expect(await gd.put('/company-personnel/'+p.id,{notes:'Giám đốc sửa'}),200);expect(await gd.put(`/company-personnel/${p.id}/certificates/${c.id}`,{issuer:'Nơi cấp mới'}),200);
 expect(await gd.del(`/company-personnel/${p.id}/certificates/${c.id}/files/${f.id}`),200);expect(await gd.del(`/company-personnel/${p.id}/certificates/${c.id}`),200);expect(await gd.del('/company-personnel/'+p.id),200);
});
test('Phân công chứng chỉ hết hạn: 409 trước xác nhận; Tôi đã biết + nhật ký nguyên tử; cùng hồ sơ ở hai CT',async()=>{
 const p=await person('Người có chứng chỉ hết hạn'),c=await cert(p,'HET-HAN',{expires_on:'2021-01-01'});
 const r=await assign(p,'A',{},gd);assert.equal(r.status,409);assert.equal(r.body.code,'EXPIRED_CERTIFICATES');assert.equal(sql(`SELECT count(*) FROM project_personnel WHERE personnel_profile_id='${p.id}'`),'0');
 expect(await assign(p,'A',{expired_certificates_ack:true},gd),201);expect(await assign(p,'B',{expired_certificates_ack:true},gd),201);
 const audits=JSON.parse(sql(`SELECT json_agg(row_to_json(t)) FROM (SELECT performed_by,performed_at,new_values FROM audit_logs WHERE entity_id='${p.id}' AND action='ACK_EXPIRED_CERTIFICATES')t`));assert.equal(audits.length,2);assert.ok(audits.every(x=>x.performed_by===users.gd.id&&x.performed_at&&x.new_values.certificates[0].id===c.id));
 assert.equal(sql(`SELECT count(*) FROM project_personnel WHERE personnel_profile_id='${p.id}' AND certificate IS NOT NULL`),'0');
 const a=expect(await admin.get(`/project-personnel/project/${fixture.projects.A.id}/team`),200).find(x=>x.personnel_profile_id===p.id),b=expect(await admin.get(`/project-personnel/project/${fixture.projects.B.id}/team`),200).find(x=>x.personnel_profile_id===p.id);assert.equal(a.certificates[0].id,b.certificates[0].id);
 expect(await users.ks.api.post('/project-personnel',{project_id:fixture.projects.A.id,full_name:p.full_name,assignment_title:'Kỹ sư',personnel_profile_id:p.id,expired_certificates_ack:true}),403);
 const linked=expect(await admin.get('/company-personnel'),200).find(x=>x.user_id===users.ks.id);await cert(linked,'LINK-EXPIRED',{expires_on:'2021-01-01'});
 const member=await gd.post('/project-members',{project_id:fixture.projects.C.id,user_id:users.ks.id,assignment_title:'Kỹ sư'});assert.equal(member.status,409);assert.equal(member.body.code,'EXPIRED_CERTIFICATES');expect(await gd.post('/project-members',{project_id:fixture.projects.C.id,user_id:users.ks.id,assignment_title:'Kỹ sư',expired_certificates_ack:true}),201);
});
test('Tổng quan: hết hạn, hôm nay và ranh giới 30/31 ngày',async()=>{
 const before=expect(await admin.get('/company-personnel/summary'),200),p=await person('Ranh giới hạn chứng chỉ');const dates=sql("SELECT (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date||','||((NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date+30)||','||((NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date+31)").split(',');
 await cert(p,'TODAY',{expires_on:dates[0]});await cert(p,'30',{expires_on:dates[1]});await cert(p,'31',{expires_on:dates[2]});const after=expect(await admin.get('/company-personnel/summary'),200);assert.equal(after.expired,before.expired);assert.equal(after.expiring,before.expiring+2);
});
test('Gợi ý cùng tên+số: không tự gộp; xác nhận giữ đủ file; tách lại đúng liên kết + audit; rerun không đảo quyết định',async()=>{
 const a=await person('Người thử gộp'),b=await person('Người thử gộp'),ca=await cert(a,'GOP-1'),cb=await cert(b,'GOP-1');const fa=await scan(a,ca,'scan-A'),fb=await scan(b,cb,'scan-B');const pa=expect(await assign(a,'A'),201),pb=expect(await assign(b,'B'),201);
 const pairs=expect(await gd.get('/company-personnel/suggestions'),200);assert.ok(pairs.some(x=>[x.source_id,x.target_id].includes(a.id)&&[x.source_id,x.target_id].includes(b.id)&&x.reason==='Trùng tên + trùng số chứng chỉ'));
 expect(await gd.post('/company-personnel/merges',{source_id:a.id,target_id:b.id,action:'MERGED'}),400);
 const d=expect(await gd.post('/company-personnel/merges',{source_id:a.id,target_id:b.id,action:'MERGED',confirm:true}),201);assert.equal(d.reason,'Trùng tên + trùng số chứng chỉ');assert.equal(d.decided_by,users.gd.id);assert.ok(d.decided_at);
 expect(await admin.get('/company-personnel/'+a.id),404);const merged=expect(await admin.get('/company-personnel/'+b.id),200);assert.equal(merged.certificates.length,2);assert.deepEqual(new Set(merged.certificates.flatMap(c=>c.files.map(f=>f.id))),new Set([fa.id,fb.id]));assert.equal(sql(`SELECT personnel_profile_id FROM project_personnel WHERE id='${pa.id}'`),b.id);
 await migration();expect(await admin.get('/company-personnel/'+a.id),404);
 expect(await gd.post('/company-personnel/merges/'+d.id+'/undo',{}),200);const restored=expect(await admin.get('/company-personnel/'+a.id),200);assert.equal(restored.certificates[0].id,ca.id);assert.equal(restored.certificates[0].files[0].id,fa.id);assert.equal(sql(`SELECT personnel_profile_id FROM project_personnel WHERE id='${pa.id}'`),a.id);assert.equal(sql(`SELECT personnel_profile_id FROM project_personnel WHERE id='${pb.id}'`),b.id);expect(await admin.get(`/company-personnel/${a.id}/certificates/${ca.id}/files/${fa.id}`),200);
 assert.equal(sql(`SELECT count(*) FROM audit_logs WHERE entity_id='${d.id}' AND performed_by='${users.gd.id}' AND action IN ('MERGE','UNDO_MERGE') AND performed_at IS NOT NULL`),'2');expect(await gd.post('/company-personnel/merges/'+d.id+'/undo',{}),409);
});
test('Gộp bị chặn khi hai hồ sơ cùng ở một công trình; DB chặn phân công trùng hồ sơ',async()=>{
 const a=await person('Trùng công trình'),b=await person('Trùng công trình');expect(await assign(a,'C'),201);expect(await assign(b,'C'),201);
 const r=await gd.post('/company-personnel/merges',{source_id:a.id,target_id:b.id,action:'MERGED',confirm:true});assert.equal(r.status,409);assert.match(r.body.error,/rút một bên/);
 assert.equal(sql(`SELECT count(*) FROM project_personnel WHERE personnel_profile_id='${a.id}' AND status='ACTIVE'`),'1');expect(await admin.get('/company-personnel/'+a.id),200);
 assert.throws(()=>sql(`INSERT INTO project_personnel(project_id,full_name,assignment_title,personnel_profile_id,status) VALUES('${fixture.projects.C.id}','Trùng công trình','Kỹ sư','${b.id}','ACTIVE')`));
});
test('Chỉ trùng tên/khác số: Cần kiểm tra kỹ; Không gộp giữ hai người và không gợi ý lại',async()=>{
 const a=await person('Tên giống cần kiểm tra'),b=await person('Tên giống cần kiểm tra');await cert(a,'KHAC-A');await cert(b,'KHAC-B');const pair=expect(await gd.get('/company-personnel/suggestions'),200).find(x=>[x.source_id,x.target_id].includes(a.id)&&[x.source_id,x.target_id].includes(b.id));assert.match(pair.reason,/Cần kiểm tra kỹ/);
 expect(await gd.post('/company-personnel/merges',{source_id:a.id,target_id:b.id,action:'REJECTED'}),201);expect(await admin.get('/company-personnel/'+a.id),200);expect(await admin.get('/company-personnel/'+b.id),200);assert.ok(!expect(await admin.get('/company-personnel/suggestions'),200).some(x=>[x.source_id,x.target_id].includes(a.id)&&[x.source_id,x.target_id].includes(b.id)));
});
test('Migration: chỉ cùng user_id tự ghép, tên+số còn hai hồ sơ; chạy lại nhiều lần giữ số lượng',async()=>{
 sql('ALTER TABLE project_personnel DISABLE TRIGGER company_personnel_project_link');
 try{sql(`INSERT INTO project_personnel(project_id,user_id,full_name,assignment_title,certificate) VALUES ('${fixture.projects.A.id}','${users.gd.id}','Di trú cùng tài khoản','Kỹ sư','DI-TRU'),('${fixture.projects.B.id}','${users.gd.id}','Di trú cùng tài khoản','Kỹ sư','DI-TRU'),('${fixture.projects.A.id}',NULL,'Di trú không tài khoản','Kỹ sư','SAME-NUM'),('${fixture.projects.B.id}',NULL,'Di trú không tài khoản','Kỹ sư','SAME-NUM')`)}finally{sql('ALTER TABLE project_personnel ENABLE TRIGGER company_personnel_project_link')}
 const legacy=JSON.parse(sql("SELECT json_agg(row_to_json(t)) FROM (SELECT id,project_id FROM project_personnel WHERE full_name='Di trú không tài khoản' ORDER BY id)t"));
 for(const [i,pp] of legacy.entries()){const bytes=Buffer.from('%PDF-1.7 legacy-'+i),blob=await require('../src/services/fileStore').put(bytes);sql(`INSERT INTO project_personnel_files(personnel_id,project_id,file_name,file_type,file_size,sha256,storage_key,uploaded_by) VALUES('${pp.id}','${pp.project_id}','legacy-${i}.pdf','application/pdf',${bytes.length},'${blob.sha256}','${blob.storageKey}','${users.admin.id}')`)}
 await migration();assert.equal(sql(`SELECT count(DISTINCT personnel_profile_id) FROM project_personnel WHERE user_id='${users.gd.id}'`),'1');assert.equal(sql("SELECT count(DISTINCT personnel_profile_id) FROM project_personnel WHERE full_name='Di trú không tài khoản'"),'2');const counts=sql('SELECT (SELECT count(*) FROM company_personnel)||\',\'||(SELECT count(*) FROM personnel_certificates)||\',\'||(SELECT count(*) FROM personnel_imports)');await migration();await migration();assert.equal(sql('SELECT (SELECT count(*) FROM company_personnel)||\',\'||(SELECT count(*) FROM personnel_certificates)||\',\'||(SELECT count(*) FROM personnel_imports)'),counts);
 for(const [i,pp] of legacy.entries()){const pid=sql(`SELECT personnel_profile_id FROM project_personnel WHERE id='${pp.id}'`),p=expect(await admin.get('/company-personnel/'+pid),200),c=p.certificates[0];assert.equal(c.files.length,1);assert.equal(expect(await admin.get(`/company-personnel/${pid}/certificates/${c.id}/files/${c.files[0].id}`),200).toString(),'%PDF-1.7 legacy-'+i)}
});
test('Bản chụp báo cáo và biên bản: bất biến sau sửa/xóa chứng chỉ; scan vẫn đọc; row_version chỉ tăng một',async()=>{
 const p=await person('Bản chụp gửi duyệt'),c=await cert(p,'SNAP-OLD',{expires_on:'2030-01-01'}),f=await scan(p,c,'scan-snapshot');expect(await assign(p,'A'),201);
 for(const route of ['daily-logs','documents','issues']){
  const body=route==='daily-logs'?{project_id:fixture.projects.A.id,log_date:'2026-10-09',shift:'SNAP',work_summary:'Snapshot'}:route==='documents'?{project_id:fixture.projects.A.id,type:'BB',name:'Biên bản snapshot'}:{project_id:fixture.projects.A.id,title:'Biên bản hiện trường snapshot',details:{documentType:'MINUTES'}};
  const r=expect(await admin.post('/'+route,body),201);expect(await admin.post('/'+route+'/'+r.id+(route==='issues'?'/resolve':'/submit'),route==='issues'?{expected_row_version:r.row_version,resolution_note:'Đóng biên bản'}:{}),200);const submitted=expect(await admin.get('/'+route+'/'+r.id),200),s=submitted.personnel_certificate_snapshot;assert.ok(s?.snapshot_id);assert.equal(Number(submitted.row_version),Number(r.row_version)+1);assert.equal(s.captured_by,users.admin.id);const captured=s.personnel.find(x=>x.profile_id===p.id).certificates.find(x=>x.id===c.id);assert.equal(captured.certificate_number,'SNAP-OLD');assert.equal(captured.files[0].id,f.id);
  expect(await admin.put(`/company-personnel/${p.id}/certificates/${c.id}`,{certificate_number:'SNAP-NEW'}),200);const again=expect(await admin.get('/'+route+'/'+r.id),200);assert.deepEqual(again.personnel_certificate_snapshot,s);
  const bytes=expect(await admin.get(`/${route}/${r.id}/certificate-snapshots/${s.snapshot_id}/files/${f.id}`),200);assert.equal(bytes.toString(),'%PDF-1.7 scan-snapshot');
  expect(await admin.put(`/company-personnel/${p.id}/certificates/${c.id}`,{certificate_number:'SNAP-OLD'}),200);
 }
 expect(await admin.del(`/company-personnel/${p.id}/certificates/${c.id}/files/${f.id}`),200);expect(await admin.del(`/company-personnel/${p.id}/certificates/${c.id}`),200);
 const ids=JSON.parse(sql(`SELECT json_agg(row_to_json(t)) FROM (SELECT entity_type,entity_id,id FROM certificate_submission_snapshots WHERE snapshot @> '{"personnel":[{"profile_id":"${p.id}"}]}')t`));for(const x of ids)expect(await admin.get(`/${x.entity_type==='daily_logs'?'daily-logs':x.entity_type}/${x.entity_id}/certificate-snapshots/${x.id}/files/${f.id}`),200);
 expect(await admin.put('/project-members/'+fixture.members.A.ks.id,{access_permissions:['VIEW']}),200);
 for(const x of ids)expect(await users.ks.api.get(`/${x.entity_type==='daily_logs'?'daily-logs':x.entity_type}/${x.entity_id}/certificate-snapshots/${x.id}/files/${f.id}`),403);
});
test('Danh tính: cùng user_id duy nhất, hai tài khoản khác nhau không gộp dù cùng tên',async()=>{
 const a=await person('Hai tài khoản khác nhau',users.admin.id),b=await person('Hai tài khoản khác nhau',users.ql.id);
 expect(await admin.post('/company-personnel',{full_name:'Trùng tài khoản',user_id:users.admin.id}),409);
 expect(await gd.post('/company-personnel/merges',{source_id:a.id,target_id:b.id,action:'MERGED',confirm:true}),409);
 expect(await admin.get('/company-personnel/'+a.id),200);expect(await admin.get('/company-personnel/'+b.id),200);
 const profiles=expect(await admin.get('/company-personnel'),200);assert.equal(profiles.filter(p=>p.user_id===users.admin.id).length,1);
});
test('Audit cảnh báo bắt buộc: lỗi ghi nhật ký hủy phân công trong cùng giao dịch',async()=>{
 const p=await person('Kiểm tra audit nguyên tử');await cert(p,'AUDIT-EXPIRED',{expires_on:'2021-01-01'});
 sql(`CREATE OR REPLACE FUNCTION personnel_test_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='ACK_EXPIRED_CERTIFICATES' AND NEW.entity_id='${p.id}'::uuid THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER personnel_test_audit_fail BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION personnel_test_audit_fail()`);
 try{expect(await assign(p,'A',{expired_certificates_ack:true},gd),500);assert.equal(sql(`SELECT count(*) FROM project_personnel WHERE personnel_profile_id='${p.id}'`),'0');assert.equal(sql(`SELECT count(*) FROM audit_logs WHERE entity_id='${p.id}' AND action='ACK_EXPIRED_CERTIFICATES'`),'0')}finally{sql('DROP TRIGGER personnel_test_audit_fail ON audit_logs; DROP FUNCTION personnel_test_audit_fail()')}
});
test('Xóa công trình không xóa hồ sơ công ty hoặc scan',async()=>{
 const p=await person('Hồ sơ giữ sau xóa CT'),c=await cert(p,'KEEP'),f=await scan(p,c,'scan-keep');const project=expect(await admin.post('/projects',{name:'CT xóa thử',contract_no:'DELETE-PERSONNEL'}),201);expect(await admin.post('/project-personnel',{project_id:project.id,full_name:p.full_name,personnel_profile_id:p.id,assignment_title:'Kỹ sư'}),201);
 sql(`DELETE FROM projects WHERE id='${project.id}'`);expect(await admin.get('/company-personnel/'+p.id),200);assert.equal(expect(await admin.get(`/company-personnel/${p.id}/certificates/${c.id}/files/${f.id}`),200).toString(),'%PDF-1.7 scan-keep');
});
