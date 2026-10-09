const pool=require('../utils/db');
const store=require('./fileStore');
const {randomUUID}=require('crypto');
const TODAY="(NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date";
const fail=(status,message,code,details)=>Object.assign(new Error(message),{status,code,details});
async function audit(db,type,id,action,before,after,actor){
 await db.query('INSERT INTO audit_logs(entity_type,entity_id,action,old_values,new_values,performed_by,performed_at) VALUES($1,$2,$3,$4,$5,$6,NOW())',[type,id,action,before,after,actor]);
}
async function transaction(fn){const db=await pool.connect();try{await db.query('BEGIN');const result=await fn(db);await db.query('COMMIT');return result}catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}}
async function profile(db,id,active=true){const row=(await db.query('SELECT * FROM company_personnel WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!row||(active&&(row.deleted_at||row.merged_into)))throw fail(404,'Không tìm thấy hồ sơ nhân sự');return row}
const certKeys=['certificate_type','certificate_number','grade','field','issued_on','expires_on','issuer'];
function validateCertificate(data){
 for(const key of certKeys)if(data[key]!==undefined&&data[key]!==null&&String(data[key]).length>({certificate_type:120,grade:80}[key]||255))throw fail(400,'Thông tin chứng chỉ quá dài');
 for(const key of ['issued_on','expires_on'])if(data[key]&&!/^\d{4}-\d{2}-\d{2}$/.test(data[key]))throw fail(400,'Ngày chứng chỉ phải có dạng năm-tháng-ngày');
}
async function expired(db,id){return(await db.query(`SELECT id,certificate_type,certificate_number,expires_on FROM personnel_certificates WHERE personnel_id=$1 AND deleted_at IS NULL AND expires_on<${TODAY} ORDER BY id`,[id])).rows}
async function acknowledge(db,id,data,actor,projectId){
 await profile(db,id);const rows=await expired(db,id);if(!rows.length)return;
 if(data.expired_certificates_ack!==true)throw fail(409,'Nhân sự có chứng chỉ hết hạn. Cần xác nhận “Tôi đã biết” trước khi phân công.','EXPIRED_CERTIFICATES',{certificates:rows});
 await audit(db,'company_personnel',id,'ACK_EXPIRED_CERTIFICATES',null,{project_id:projectId,certificates:rows,acknowledgement:'Tôi đã biết'},actor);
}
async function certificates(db,id){return(await db.query(`SELECT c.*,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',f.id,'file_name',f.file_name,'file_type',f.file_type,'file_size',f.file_size)) FROM personnel_certificate_files f WHERE f.certificate_id=c.id AND f.deleted_at IS NULL),'[]'::jsonb) files,
 CASE WHEN expires_on<${TODAY} THEN 'EXPIRED' WHEN expires_on<=${TODAY}+30 THEN 'EXPIRING' ELSE 'VALID' END expiry_status
 FROM personnel_certificates c WHERE personnel_id=$1 AND c.deleted_at IS NULL ORDER BY c.created_at,c.id`,[id])).rows}
async function get(id){const p=(await pool.query('SELECT * FROM company_personnel WHERE id=$1 AND deleted_at IS NULL AND merged_into IS NULL',[id])).rows[0];if(!p)throw fail(404,'Không tìm thấy hồ sơ nhân sự');return{...p,certificates:await certificates(pool,id)}}
async function list(){return(await pool.query(`SELECT cp.*,u.username,(SELECT COUNT(*)::int FROM personnel_certificates c WHERE c.personnel_id=cp.id AND c.deleted_at IS NULL) certificate_count
 FROM company_personnel cp LEFT JOIN users u ON u.id=cp.user_id WHERE cp.deleted_at IS NULL AND cp.merged_into IS NULL ORDER BY cp.full_name,cp.id`)).rows}
async function save(id,data,actor){
 return transaction(async db=>{const old=id?await profile(db,id):null;const name=String(data.full_name??old?.full_name??'').normalize('NFC').replace(/\s+/g,' ').trim();if(!name||name.length>255)throw fail(400,'Họ tên bắt buộc, tối đa 255 ký tự');
 const uid=data.user_id===undefined?old?.user_id:data.user_id||null;
 if(uid&&!(await db.query('SELECT id FROM users WHERE id=$1',[uid])).rows.length)throw fail(400,'Tài khoản không tồn tại');
 if(old&&uid!==old.user_id&&(await db.query("SELECT id FROM project_personnel WHERE personnel_profile_id=$1 AND status='ACTIVE' LIMIT 1",[id])).rows.length)throw fail(409,'Hãy rút phân công trước khi đổi tài khoản liên kết');
 const row=id?(await db.query('UPDATE company_personnel SET full_name=$1,user_id=$2,notes=$3,updated_at=NOW() WHERE id=$4 RETURNING *',[name,uid,String(data.notes??old.notes??'').slice(0,10000),id])).rows[0]:
 (await db.query('INSERT INTO company_personnel(full_name,user_id,notes) VALUES($1,$2,$3) RETURNING *',[name,uid,String(data.notes||'').slice(0,10000)])).rows[0];
 await audit(db,'company_personnel',row.id,id?'UPDATE':'CREATE',old,row,actor);return row});
}
async function remove(id,actor){return transaction(async db=>{const old=await profile(db,id);if((await db.query("SELECT id FROM project_personnel WHERE personnel_profile_id=$1 AND status='ACTIVE' LIMIT 1",[id])).rows.length)throw fail(409,'Hãy rút nhân sự khỏi công trình trước khi xóa hồ sơ');await db.query('UPDATE company_personnel SET deleted_at=NOW(),updated_at=NOW() WHERE id=$1',[id]);await audit(db,'company_personnel',id,'DELETE',old,null,actor);return{ok:true}})}
async function certificateOwner(db,cid){const c=(await db.query('SELECT * FROM personnel_certificates WHERE id=$1 AND deleted_at IS NULL',[cid])).rows[0];if(!c)throw fail(404,'Không tìm thấy chứng chỉ');await profile(db,c.personnel_id);return c}
async function saveCertificate(pid,cid,data,actor){validateCertificate(data);return transaction(async db=>{
 const p=await profile(db,pid);const old=cid?await certificateOwner(db,cid):null;if(old&&old.personnel_id!==p.id)throw fail(404,'Chứng chỉ không thuộc hồ sơ');
 const values=certKeys.map(k=>data[k]===undefined?old?.[k]??null:data[k]||null);if(!String(values[0]||'').trim())throw fail(400,'Cần nhập loại chứng chỉ');
 const row=cid?(await db.query('UPDATE personnel_certificates SET certificate_type=$1,certificate_number=$2,grade=$3,field=$4,issued_on=$5,expires_on=$6,issuer=$7,updated_at=NOW() WHERE id=$8 RETURNING *',[...values,cid])).rows[0]:
 (await db.query('INSERT INTO personnel_certificates(certificate_type,certificate_number,grade,field,issued_on,expires_on,issuer,personnel_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[...values,pid])).rows[0];
 await audit(db,'personnel_certificates',row.id,cid?'UPDATE':'CREATE',old,row,actor);return row});}
async function removeCertificate(cid,actor){return transaction(async db=>{const old=await certificateOwner(db,cid);await db.query('UPDATE personnel_certificates SET deleted_at=NOW(),updated_at=NOW() WHERE id=$1',[cid]);await audit(db,'personnel_certificates',cid,'DELETE',old,null,actor);return{ok:true}})}
async function addFile(cid,name,type,bytes,actor){return transaction(async db=>{await certificateOwner(db,cid);const blob=await store.put(bytes);const row=(await db.query(`INSERT INTO personnel_certificate_files(certificate_id,file_name,file_type,file_size,sha256,storage_key,uploaded_by)
 VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(certificate_id,sha256) DO UPDATE SET deleted_at=NULL,file_name=EXCLUDED.file_name RETURNING id,file_name,file_type,file_size,(xmax=0) created`,[cid,name,type,bytes.length,blob.sha256,blob.storageKey,actor])).rows[0];await audit(db,'personnel_certificate_files',row.id,'UPLOAD',null,{certificate_id:cid,name,size:bytes.length},actor);return row})}
async function getFile(cid,fid){const f=(await pool.query(`SELECT f.* FROM personnel_certificate_files f JOIN personnel_certificates c ON c.id=f.certificate_id JOIN company_personnel cp ON cp.id=c.personnel_id WHERE f.id=$1 AND f.certificate_id=$2 AND f.deleted_at IS NULL AND c.deleted_at IS NULL AND cp.deleted_at IS NULL AND cp.merged_into IS NULL`,[fid,cid])).rows[0];if(!f)throw fail(404,'Không tìm thấy tệp');return{name:f.file_name,type:f.file_type,buffer:await store.get(f.storage_key)}}
async function removeFile(cid,fid,actor){return transaction(async db=>{await certificateOwner(db,cid);const old=(await db.query('UPDATE personnel_certificate_files SET deleted_at=NOW() WHERE id=$1 AND certificate_id=$2 AND deleted_at IS NULL RETURNING id,file_name',[fid,cid])).rows[0];if(!old)throw fail(404,'Không tìm thấy tệp');await audit(db,'personnel_certificate_files',fid,'DELETE',old,null,actor);return{ok:true}})}
async function summary(){return(await pool.query(`SELECT COUNT(*) FILTER(WHERE c.expires_on<${TODAY})::int expired,
 COUNT(*) FILTER(WHERE c.expires_on>=${TODAY} AND c.expires_on<=${TODAY}+30)::int expiring
 FROM personnel_certificates c JOIN company_personnel p ON p.id=c.personnel_id WHERE c.deleted_at IS NULL AND p.deleted_at IS NULL AND p.merged_into IS NULL`)).rows[0]}
async function suggestions(){return(await pool.query(`SELECT a.id source_id,b.id target_id,a.full_name source_name,b.full_name target_name,
 CASE WHEN EXISTS(SELECT 1 FROM personnel_certificates ca JOIN personnel_certificates cb ON lower(trim(ca.certificate_number))=lower(trim(cb.certificate_number)) WHERE ca.personnel_id=a.id AND cb.personnel_id=b.id AND ca.deleted_at IS NULL AND cb.deleted_at IS NULL AND NULLIF(trim(ca.certificate_number),'') IS NOT NULL)
 THEN 'Trùng tên + trùng số chứng chỉ' ELSE 'Chỉ trùng tên — Cần kiểm tra kỹ' END reason
 FROM company_personnel a JOIN company_personnel b ON a.id<b.id AND lower(trim(a.full_name))=lower(trim(b.full_name))
 WHERE a.deleted_at IS NULL AND b.deleted_at IS NULL AND a.merged_into IS NULL AND b.merged_into IS NULL
 AND NOT EXISTS(SELECT 1 FROM personnel_merge_decisions d WHERE LEAST(d.source_id,d.target_id)=a.id AND GREATEST(d.source_id,d.target_id)=b.id AND d.status IN ('REJECTED','MERGED')) ORDER BY a.full_name,a.id,b.id`)).rows}
async function decide(data,actor){
 if(data.source_id===data.target_id)throw fail(400,'Cần hai hồ sơ khác nhau');if(!['MERGED','REJECTED'].includes(data.action))throw fail(400,'Quyết định không hợp lệ');if(data.action==='MERGED'&&data.confirm!==true)throw fail(400,'Cần xác nhận gộp hồ sơ');
 return transaction(async db=>{
  await db.query('SELECT id FROM company_personnel WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[[data.source_id,data.target_id]]);
  const source=await profile(db,data.source_id),target=await profile(db,data.target_id);
  if(source.full_name.trim().toLowerCase()!==target.full_name.trim().toLowerCase())throw fail(400,'Hai hồ sơ không thuộc gợi ý cùng tên');
  const common=(await db.query("SELECT 1 FROM personnel_certificates a JOIN personnel_certificates b ON lower(trim(a.certificate_number))=lower(trim(b.certificate_number)) WHERE a.personnel_id=$1 AND b.personnel_id=$2 AND a.deleted_at IS NULL AND b.deleted_at IS NULL AND NULLIF(trim(a.certificate_number),'') IS NOT NULL LIMIT 1",[source.id,target.id])).rows.length;
  const reason=common?'Trùng tên + trùng số chứng chỉ':'Chỉ trùng tên — Cần kiểm tra kỹ';
  const decisionId=randomUUID();const before={source,target,personnel:(await db.query('SELECT id,personnel_profile_id,full_name FROM project_personnel WHERE personnel_profile_id=$1',[source.id])).rows,certificates:(await db.query('SELECT id,personnel_id FROM personnel_certificates WHERE personnel_id=$1',[source.id])).rows};
  if(data.action==='MERGED'){
   if(source.user_id&&target.user_id&&source.user_id!==target.user_id)throw fail(409,'Hai hồ sơ có tài khoản khác nhau; cần kiểm tra danh tính, không thể gộp');
   const clash=(await db.query(`SELECT DISTINCT p.project_code FROM project_personnel s JOIN project_personnel t ON t.project_id=s.project_id AND t.personnel_profile_id=$2 AND t.status='ACTIVE' JOIN projects p ON p.id=s.project_id WHERE s.personnel_profile_id=$1 AND s.status='ACTIVE'`,[source.id,target.id])).rows.map(r=>r.project_code);
   if(clash.length)throw fail(409,'Hai hồ sơ cùng được phân công ở công trình '+clash.join(', ')+'; hãy rút một bên khỏi công trình trước khi gộp');
   if(source.user_id&&!target.user_id){await db.query('UPDATE company_personnel SET user_id=NULL WHERE id=$1',[source.id]);await db.query('UPDATE company_personnel SET user_id=$1 WHERE id=$2',[source.user_id,target.id])}
   await db.query('UPDATE personnel_certificates SET personnel_id=$1 WHERE personnel_id=$2',[target.id,source.id]);
   await db.query('UPDATE project_personnel SET personnel_profile_id=$1,full_name=$3 WHERE personnel_profile_id=$2',[target.id,source.id,target.full_name]);
   await db.query('UPDATE company_personnel SET merged_into=$1,updated_at=NOW() WHERE id=$2',[target.id,source.id]);
  }
  const row=(await db.query('INSERT INTO personnel_merge_decisions(id,source_id,target_id,reason,status,before_data,decided_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[decisionId,source.id,target.id,reason,data.action,before,actor])).rows[0];
  await audit(db,'personnel_merge_decisions',row.id,data.action==='MERGED'?'MERGE':'REJECT_MERGE',before,{source_id:source.id,target_id:target.id},actor);return row;
 });
}
async function undo(id,actor){return transaction(async db=>{
 const d=(await db.query('SELECT * FROM personnel_merge_decisions WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!d||d.status!=='MERGED')throw fail(409,'Lần gộp không còn ở trạng thái có thể tách');
 const b=d.before_data;await db.query('SELECT id FROM company_personnel WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[[d.source_id,d.target_id]]);const source=await profile(db,d.source_id,false),target=await profile(db,d.target_id);
 if(source.merged_into!==target.id)throw fail(409,'Hồ sơ đã đổi liên kết gộp');
 const ppIds=b.personnel.map(x=>x.id),certIds=b.certificates.map(x=>x.id);
 if((await db.query('SELECT id FROM project_personnel WHERE id=ANY($1::uuid[]) AND personnel_profile_id<>$2',[ppIds,target.id])).rows.length||(await db.query('SELECT id FROM personnel_certificates WHERE id=ANY($1::uuid[]) AND personnel_id<>$2',[certIds,target.id])).rows.length)throw fail(409,'Dữ liệu đã được gộp tiếp; hãy tách lần gộp sau trước');
 if(b.source.user_id&&!b.target.user_id){if(target.user_id!==b.source.user_id)throw fail(409,'Liên kết tài khoản đã thay đổi');await db.query('UPDATE company_personnel SET user_id=NULL WHERE id=$1',[target.id]);await db.query('UPDATE company_personnel SET user_id=$1 WHERE id=$2',[b.source.user_id,source.id])}
 await db.query('UPDATE company_personnel SET merged_into=NULL,updated_at=NOW() WHERE id=$1',[source.id]);
 await db.query('UPDATE personnel_certificates SET personnel_id=$1 WHERE id=ANY($2::uuid[])',[source.id,certIds]);
 for(const pp of b.personnel)await db.query('UPDATE project_personnel SET personnel_profile_id=$1,full_name=$2 WHERE id=$3',[source.id,pp.full_name,pp.id]);
 const row=(await db.query("UPDATE personnel_merge_decisions SET status='UNDONE',undone_by=$1,undone_at=NOW() WHERE id=$2 RETURNING *",[actor,id])).rows[0];await audit(db,'personnel_merge_decisions',id,'UNDO_MERGE',d,{source_id:source.id,target_id:target.id},actor);return row;
})}
module.exports={get,list,save,remove,saveCertificate,removeCertificate,addFile,getFile,removeFile,summary,suggestions,decide,undo,acknowledge,certificates,audit,transaction,fail};
