const express=require('express');
const auth=require('../middleware/auth');
const rbac=require('../middleware/rbac');
const service=require('../services/companyPersonnelService');
const {sendStoredFile}=require('../utils/fileSafety');
const pool=require('../utils/db');
const router=express.Router();router.use(auth.verifyToken);
const edit=rbac.checkRole(['ADMIN','DIRECTOR']);
// Hồ sơ nhân sự công ty (đọc lẫn ghi) chỉ dành cho Admin/Giám đốc. Tài khoản khác xem nhân sự,
// chứng chỉ và scan của công trình mình qua /project-personnel (kiểm quyền công trình + DOWNLOAD).
router.use(edit);
const validId=(req,res,next)=>{for(const value of Object.values(req.params))if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))return res.status(400).json({error:'Mã hồ sơ không hợp lệ'});next()};
const run=fn=>async(req,res)=>{try{await fn(req,res)}catch(e){if(e.status)return res.status(e.status).json({error:e.message,code:e.code,details:e.details});if(['23505','23503','23514','22007','22008','22P02','22001','P2001'].includes(e.code))return res.status(e.code==='23505'?409:400).json({error:e.code==='23505'?'Tài khoản đã có hồ sơ nhân sự':'Dữ liệu hoặc ngày chứng chỉ không hợp lệ'});console.error('company-personnel:',e.message);res.status(500).json({error:'Không xử lý được hồ sơ nhân sự'})}};
router.get('/summary',run(async(req,res)=>res.json(await service.summary())));
router.get('/suggestions',edit,run(async(req,res)=>res.json(await service.suggestions())));
router.get('/merges',edit,run(async(req,res)=>res.json((await pool.query('SELECT d.id,d.source_id,d.target_id,d.status,d.reason,d.decided_by,d.decided_at,d.undone_by,d.undone_at,u.full_name decided_by_name FROM personnel_merge_decisions d LEFT JOIN users u ON u.id=d.decided_by ORDER BY d.decided_at DESC')).rows)));
router.post('/merges',edit,run(async(req,res)=>res.status(201).json(await service.decide(req.body,req.user.userId))));
router.post('/merges/:id/undo',edit,validId,run(async(req,res)=>res.json(await service.undo(req.params.id,req.user.userId))));
router.get('/',run(async(req,res)=>res.json(await service.list())));
router.post('/',edit,run(async(req,res)=>res.status(201).json(await service.save(null,req.body,req.user.userId))));
router.get('/:id',validId,run(async(req,res)=>res.json(await service.get(req.params.id))));
router.put('/:id',edit,validId,run(async(req,res)=>res.json(await service.save(req.params.id,req.body,req.user.userId))));
router.delete('/:id',edit,validId,run(async(req,res)=>res.json(await service.remove(req.params.id,req.user.userId))));
router.post('/:id/certificates',edit,validId,run(async(req,res)=>res.status(201).json(await service.saveCertificate(req.params.id,null,req.body,req.user.userId))));
router.put('/:id/certificates/:cid',edit,validId,run(async(req,res)=>res.json(await service.saveCertificate(req.params.id,req.params.cid,req.body,req.user.userId))));
router.delete('/:id/certificates/:cid',edit,validId,run(async(req,res)=>{await service.get(req.params.id);const c=(await pool.query('SELECT id FROM personnel_certificates WHERE id=$1 AND personnel_id=$2',[req.params.cid,req.params.id])).rows[0];if(!c)return res.status(404).json({error:'Chứng chỉ không thuộc hồ sơ'});res.json(await service.removeCertificate(req.params.cid,req.user.userId))}));
router.get('/:id/certificates/:cid/files/:fid',validId,run(async(req,res)=>{const p=await service.get(req.params.id);if(!p.certificates.some(c=>c.id===req.params.cid))return res.status(404).json({error:'Chứng chỉ không thuộc hồ sơ'});sendStoredFile(res,await service.getFile(req.params.cid,req.params.fid),req.query.download)}));
const raw=express.raw({type:()=>true,limit:15*1024*1024});
router.post('/:id/certificates/:cid/files',edit,validId,raw,run(async(req,res)=>{
 const p=await service.get(req.params.id);if(!p.certificates.some(c=>c.id===req.params.cid))return res.status(404).json({error:'Chứng chỉ không thuộc hồ sơ'});
 if(!Buffer.isBuffer(req.body)||!req.body.length)return res.status(400).json({error:'Tệp scan rỗng'});
 const path=require('path');res.status(201).json(await service.addFile(req.params.cid,path.basename(String(req.query.name||'chung-chi')).slice(0,255),String(req.headers['content-type']||'application/octet-stream').slice(0,120),req.body,req.user.userId));
}));
router.delete('/:id/certificates/:cid/files/:fid',edit,validId,run(async(req,res)=>{const p=await service.get(req.params.id);if(!p.certificates.some(c=>c.id===req.params.cid))return res.status(404).json({error:'Chứng chỉ không thuộc hồ sơ'});res.json(await service.removeFile(req.params.cid,req.params.fid,req.user.userId))}));
router.use((err,req,res,next)=>{if(err.type==='entity.too.large')return res.status(413).json({error:'Scan tối đa 15 MB'});next(err)});
module.exports=router;
