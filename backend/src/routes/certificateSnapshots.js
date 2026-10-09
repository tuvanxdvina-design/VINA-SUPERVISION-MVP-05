// Mounted behind each record's existing project access/privacy checks.
const express=require('express');
const pool=require('../utils/db');
const permissions=require('../services/permissionService');
const store=require('../services/fileStore');
const {sendStoredFile}=require('../utils/fileSafety');
module.exports=entity=>{
 const router=express.Router({mergeParams:true});
 router.get('/',async(req,res)=>{try{res.json((await pool.query('SELECT id,captured_at,captured_by,snapshot FROM certificate_submission_snapshots WHERE entity_type=$1 AND entity_id=$2 ORDER BY captured_at DESC',[entity,req.params.id])).rows)}catch(e){res.status(500).json({error:'Không tải được bản chụp chứng chỉ'})}});
 router.get('/:sid/files/:fid',permissions.requirePermission('DOWNLOAD'),async(req,res)=>{
  if(![req.params.sid,req.params.fid].every(x=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x)))return res.status(400).json({error:'Mã bản chụp không hợp lệ'});
  try{const row=(await pool.query('SELECT snapshot FROM certificate_submission_snapshots WHERE entity_type=$1 AND entity_id=$2 AND id=$3',[entity,req.params.id,req.params.sid])).rows[0];
   const f=row?.snapshot?.personnel?.flatMap(p=>p.certificates||[]).flatMap(c=>c.files||[]).find(f=>f.id===req.params.fid);
   if(!f)return res.status(404).json({error:'Không tìm thấy scan trong bản chụp'});
   sendStoredFile(res,{name:f.file_name,type:f.file_type,buffer:await store.get(f.storage_key)},req.query.download);
  }catch(e){res.status(500).json({error:'Không đọc được scan chứng chỉ'})}
 });return router;
};
