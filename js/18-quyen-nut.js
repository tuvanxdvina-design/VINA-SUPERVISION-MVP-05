// Chỉ điều khiển giao diện. Máy chủ vẫn quyết định quyền cho mọi yêu cầu.
const deniedUiActions=new Set();
let uiPermissionRefresh=null,uiPermissionEpoch=0;
function uiActionKey(resource,id,action){return resource+'/'+String(id||'')+'/'+action}
function uiRecord(resource,id){const list=resource==='daily-logs'?db.logs:resource==='documents'?db.docs:resource==='issues'?db.issues:db.projects;return (list||[]).find(x=>x.id===id||x.serverId===id)}
function uiAction(resource,id,action,allowed){const x=uiRecord(resource,id);return {key:uiActionKey(resource,x?.serverId||x?.id||id,action),allowed:!!allowed}}
function uiDocAction(x,action){
 if(!x)return false;
 if(action==='submit')return x.status==='DRAFT'&&canModifyDoc(x);
 if(action==='reopen')return x.status==='LOCKED'&&canApproveIn(x.projectId);
 if(action==='lock')return x.status==='APPROVED'&&canApproveIn(x.projectId);
 if(action==='escalate')return x.status==='SUBMITTED'&&docCanDecide(x)&&!canManageAssignments();
 return ['approve','reject'].includes(action)&&x.status==='SUBMITTED'&&docCanDecide(x);
}
function uiLogAction(x,action){
 if(!x)return false;
 if(action==='submit')return canSubmitLog(x);
 if(action==='confirm')return canSubmitLog(x)&&canApproveIn(x.projectId);
 if(action==='reopen')return canReopenLog(x);
 if(action==='lock')return x.status==='APPROVED'&&canApproveIn(x.projectId);
 return ['approve','reject','escalate'].includes(action)&&x.status==='SUBMITTED'&&canApproveIn(x.projectId)&&(canManageAssignments()||x.lastReview?.action!=='ESCALATE')&&(action!=='escalate'||!canManageAssignments());
}
function uiSelectedProject(ids,fallback=''){for(const id of ids){const value=document.getElementById(id)?.value;if(value)return value}return fallback}
function uiAnyCreate(resource,pid,check){return pid?check(pid)&&!deniedUiActions.has(uiActionKey(resource,pid,'create')):serverProjects().some(p=>check(p.id)&&!deniedUiActions.has(uiActionKey(resource,p.id,'create')))}
// Parse tên hàm và tham số literal của nút do ứng dụng sinh; không eval mã onclick.
function permissionButtonPolicy(button){
 const code=button.getAttribute('onclick')||'';
 const match=code.match(/\b(deleteDocFile|openBiddingPackages|addBiddingPackage|renameBiddingPackage|removeBiddingPackage|addBiddingContractor|renameBiddingContractor|removeBiddingContractor|addBiddingItem|removeBiddingItem|editCurrentProject|openProgressPlan|saveProgressPlan|deleteProgressPlan|openProgressActuals|saveProgressActuals|openProject|saveProject|openLog|saveLog|logAction|logBulk|logBulkLead|reopenLog|openDoc|saveDoc|docWorkflow|openReport|saveReport|reportWorkflow|openIssue|saveQualityDocument|closeIssue|reopenQualityDocument|deleteContent|confirmDeleteContent|submitReviewDecision|openReviewDecision|editCompanyProfile|saveCompanyProfile|deleteCompanyProfile|editCompanyCertificate|saveCompanyCertificate|deleteCompanyCertificate|deleteCompanyCertificateFile|openCompanyAssignment|assignCompanyProfile|openCompanyMerges|decideCompanyMerge|undoCompanyMerge|openTeamMember|saveTeamMember)\s*\(([^)]*)\)/);
 if(!match)return null;
 const fn=match[1],args=[...match[2].matchAll(/'([^']*)'|"([^"]*)"/g)].map(x=>x[1]??x[2]),id=args[0]||'';
 let x;
 if(fn==='deleteDocFile')return uiAction('documents',id,'update',canModifyDoc(uiRecord('documents',id)));
 if(fn.includes('Bidding'))return uiAction('bidding-packages','','manage',canManageAssignments());
 if(fn==='editCurrentProject')return uiAction('projects',currentProjectId,'update',canEditProject(currentProjectId));
 if(['openProgressPlan','saveProgressPlan','deleteProgressPlan'].includes(fn)){const pid=fn==='openProgressPlan'?id:progressEditor?.projectId;return uiAction('projects',pid,fn==='deleteProgressPlan'?'delete':'update',pid&&(fn==='deleteProgressPlan'?canDeleteIn(pid):canEditProject(pid)))}
 if(fn==='openProgressActuals'||fn==='saveProgressActuals')return uiAction('projects',id,'actuals',canUpdateActual(id));
 if(fn==='logBulk'||fn==='logBulkLead'){
  const ids=fn==='logBulk'?args.slice(1):args;
  return uiAction('daily-logs','bulk','update',ids.length&&ids.every(lid=>{const log=uiRecord('daily-logs',lid),action=fn==='logBulk'?id:log?.status==='DRAFT'?'confirm':'approve';return uiLogAction(log,action)&&!deniedUiActions.has(uiAction('daily-logs',lid,action,true).key)}));
 }
 if(fn==='openProject'||fn==='saveProject')return uiAction('projects',id,id?'update':'create',id?canEditProject(id):canManageAssignments());
 if(fn==='openLog'||fn==='saveLog'){
  x=id?uiRecord('daily-logs',id):null;const pid=uiSelectedProject(['lproj','logProject'],currentProjectId);
  if(fn==='saveLog'&&/\btrue\b/.test(match[2])&&x?.serverId){const action=canApproveIn(x.projectId)?'confirm':'submit';return uiAction('daily-logs',id,action,canEditLog(x)&&uiLogAction(x,action))}
  return x?.serverId?uiAction('daily-logs',id,'update',canEditLog(x)):uiAction('daily-logs',x?.projectId||pid,'create',x?canEditLog(x):uiAnyCreate('daily-logs',pid,canCreateLogIn));
 }
 if(fn==='logAction'||fn==='reopenLog'){x=uiRecord('daily-logs',id);const action=fn==='reopenLog'?'reopen':args[1];return uiAction('daily-logs',id,action,uiLogAction(x,action))}
 if(['openDoc','saveDoc','openReport','saveReport'].includes(fn)){
  const report=fn.includes('Report');const recordId=fn==='saveReport'?reportDraft?.docId:id;x=recordId?uiRecord('documents',recordId):null;
  const pid=uiSelectedProject(report?['rpProject','reportProject']:['dproj','docProject'],currentProjectId);
  if(fn==='saveReport'&&/\btrue\b/.test(match[2])&&x)return uiAction('documents',recordId,'submit',uiDocAction(x,'submit'));
  return x?uiAction('documents',recordId,'update',canModifyDoc(x)):uiAction('documents',pid,'create',uiAnyCreate('documents',pid,canCreateDocIn));
 }
 if(fn==='docWorkflow'||fn==='reportWorkflow'){x=uiRecord('documents',id);return uiAction('documents',id,args[1],uiDocAction(x,args[1]))}
 if(fn==='openIssue'||fn==='saveQualityDocument'){x=id?uiRecord('issues',id):null;const pid=uiSelectedProject(['iproj','issueProject'],currentProjectId);return x?uiAction('issues',id,'update',qualityCanEdit(x)):uiAction('issues',pid,'create',uiAnyCreate('issues',pid,qualityCanCreate))}
 if(fn==='closeIssue'||fn==='reopenQualityDocument'){x=uiRecord('issues',id);return uiAction('issues',id,fn==='closeIssue'?'resolve':'reopen',fn==='closeIssue'?qualityCanClose(x):qualityCanReopen(x))}
 if(fn==='deleteContent'||fn==='confirmDeleteContent'){
  if(id==='plan')return uiAction('projects',args[2]||currentProjectId,'delete',canDeleteIn(args[2]||currentProjectId));
  const resource={log:'daily-logs',doc:'documents',issue:'issues'}[id],recordId=args[1];x=uiRecord(resource,recordId);return uiAction(resource,recordId,'delete',x&&canDeleteIn(x.projectId));
 }
 if(fn==='submitReviewDecision'||fn==='openReviewDecision'){
  const resource=id==='documents'?'documents':'daily-logs',recordId=args[1],action=args[2]||'approve';x=reviewDecisionContext?.id===recordId&&reviewDecisionContext.kind===id?reviewDecisionContext.record:uiRecord(resource,recordId);
  if(fn==='openReviewDecision'){const it=[...(inboxData?.to_review||[]),...(inboxData?.monitor||[])].find(v=>v.id===recordId&&v.kind===id);if(it)x={projectId:it.project_id,status:'SUBMITTED',lastReview:it.last_action?{action:it.last_action}:null};}
  return uiAction(resource,recordId,action,resource==='documents'?uiDocAction(x,action):uiLogAction(x,action));
 }
 if(fn==='openTeamMember'||fn==='saveTeamMember')return uiAction('project-personnel',id,'manage',canManageAssignments());
 const pid=fn==='saveCompanyProfile'?id:fn==='saveCompanyCertificate'?(companyCertificateContext?.pid||''):fn==='assignCompanyProfile'?(companyProfileContext?.id||''):id;
 return uiAction('company-personnel',fn.includes('Merge')?'':pid,fn.includes('Merge')?'merge':'manage',canManageAssignments());
}
function applyPermissionButtons(){
 for(const button of document.querySelectorAll('button[onclick]')){
  const policy=permissionButtonPolicy(button);if(!policy)continue;
  const blocked=!policy.allowed||deniedUiActions.has(policy.key);
  if(blocked){button.dataset.permissionHidden='1';button.style.display='none'}
  else if(button.dataset.permissionHidden==='1'){button.style.display='';delete button.dataset.permissionHidden}
 }
}
function permissionRequestKey(path,options={}){
 const parts=path.split('?')[0].split('/').filter(Boolean),resource=parts[0],method=(options.method||'GET').toUpperCase();
 if(resource==='bidding-packages'||resource==='bidding-contractors')return uiActionKey('bidding-packages','','manage');
 if(!['projects','daily-logs','documents','issues','company-personnel','project-personnel','project-members'].includes(resource))return '';
 let body={};try{if(typeof options.body==='string')body=JSON.parse(options.body)}catch(_){}
 if(resource==='company-personnel')return uiActionKey(resource,parts[1]==='merges'||parts[1]==='suggestions'?'':parts[1]||'',parts[1]==='merges'||parts[1]==='suggestions'?'merge':'manage');
 if(resource==='project-personnel'||resource==='project-members')return method==='GET'?'':uiActionKey('project-personnel',parts[1]||'','manage');
 if(method==='GET')return '';
 const id=parts[1]||body.project_id||'',action=method==='DELETE'&&parts[2]!=='files'?'delete':parts.length===1?'create':parts.includes('actuals')?'actuals':parts[2]&&['submit','confirm','approve','reject','lock','reopen','escalate','resolve'].includes(parts[2])?parts[2]:'update';
 return uiActionKey(resource,id,action);
}
function handlePermissionDenied(path,options){
 const key=permissionRequestKey(path,options);if(key)deniedUiActions.add(key);
 uiPermissionEpoch++;applyPermissionButtons();
 let note=document.getElementById('permissionChangedNotice');if(!note){note=document.createElement('div');note.id='permissionChangedNotice';note.className='notice';note.setAttribute('role','status');document.querySelector('main')?.prepend(note)}note.textContent='Quyền của bạn đã thay đổi';
 // Không đóng hộp thoại, không xóa hay thay nội dung bản nhập/hàng đợi.
 if(path!=='/project-members/my-permissions'&&!path.startsWith('/users/')){
  const pending=uiPermissionRefresh;void (pending||Promise.resolve()).then(()=>refreshUiPermissions({force:true}));
 }
}
async function refreshUiPermissions({force=false,clearDenied=false}={}){
 if(typeof apiRequest!=='function'||!getAuthToken()||!navigator.onLine||getAuthUser()?.must_change_password)return false;
 if(uiPermissionRefresh)return uiPermissionRefresh;
 if(!force&&qualityPermissionCache.size)return true;
 const token=getAuthToken(),epoch=uiPermissionEpoch;
 uiPermissionRefresh=(async()=>{
  try{
   const user=await apiRequest('/users/'+encodeURIComponent(getAuthUser().id));
   const map=await apiRequest('/project-members/my-permissions');
   if(token!==getAuthToken()||epoch!==uiPermissionEpoch)return false;
   const auth=JSON.parse(localStorage.getItem(AUTH_KEY)||'null');if(!auth)return false;
   auth.user={...auth.user,...user};localStorage.setItem(AUTH_KEY,JSON.stringify(auth));
   qualityPermissionCache.clear();Object.entries(map||{}).forEach(([pid,v])=>qualityPermissionCache.set(String(pid),{permissions:Array.isArray(v.permissions)?v.permissions:[],memberId:v.member_id||'',source:v.source||''}));
   db.myPermissions=map;if(ROLE_LABELS[user.role_name])db.role=ROLE_LABELS[user.role_name];if(clearDenied)deniedUiActions.clear();persistLocal();
   renderAll();applyPermissionButtons();return true;
  }catch(error){console.warn('Không tải được quyền theo công trình:',error.message);applyPermissionButtons();return false}
 })();
 try{return await uiPermissionRefresh}finally{uiPermissionRefresh=null}
}
function reloadVisiblePermissions(){void refreshUiPermissions({force:true,clearDenied:true})}
window.addEventListener('online',reloadVisiblePermissions);
window.addEventListener('pageshow',reloadVisiblePermissions);
window.addEventListener('load',reloadVisiblePermissions);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')reloadVisiblePermissions()});
document.addEventListener('change',event=>{if(['logProject','docProject','issueProject','reportProject','lproj','dproj','iproj','rpProject','cpProject','teamProject'].includes(event.target.id))reloadVisiblePermissions()});
// Các bảng và hộp thoại nạp bất đồng bộ cũng phải cập nhật nút sau khi quyền đổi.
// Gom mọi thay đổi DOM trong một khung hình thành một lần quét (danh sách dài/đồng bộ nền không quét lặp trên điện thoại yếu).
let permissionButtonsFrame=0;
new MutationObserver(()=>{if(!permissionButtonsFrame)permissionButtonsFrame=requestAnimationFrame(()=>{permissionButtonsFrame=0;applyPermissionButtons()})}).observe(document.body,{childList:true,subtree:true});
