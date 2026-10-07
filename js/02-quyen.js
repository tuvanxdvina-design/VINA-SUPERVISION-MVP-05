function qualityRole(){const u=qualityAuthUser();return roleToken(u?.role_name||u?.roleName||u?.role||db.role)}
function qualityIsManager(){const r=qualityRole();return r==='ADMIN'||r==='DIRECTOR'||r==='GIAM DOC'}
function qualityPermissions(projectId){if(qualityIsManager())return ['VIEW','EDIT','CREATE','DOWNLOAD','APPROVE','DELETE'];const cached=qualityPermissionCache.get(String(projectId||''));const raw=cached?.permissions;return Array.isArray(raw)?raw.map(v=>String(v).toUpperCase()):[]}
function qualityIsLocked(x){const r=roleToken(x?.status);return ['SIGNED','CLOSED','RESOLVED','LOCKED','DA KY','DA DONG','DA KHOA'].some(v=>r===v||r.includes(v))}
async function loadQualityPermissions(force=false){if(typeof apiRequest!=='function'||typeof getAuthToken!=='function'||!getAuthToken()||!navigator.onLine)return;if(!force&&qualityPermissionCache.size)return;try{const map=await apiRequest('/project-members/my-permissions');qualityPermissionCache.clear();Object.entries(map||{}).forEach(([pid,v])=>qualityPermissionCache.set(String(pid),{permissions:Array.isArray(v.permissions)?v.permissions:[],memberId:v.member_id||'',source:v.source||''}));db.myPermissions=map;persistLocal()}catch(error){console.warn('Không tải được quyền theo công trình:',error.message);if(db.myPermissions)Object.entries(db.myPermissions).forEach(([pid,v])=>qualityPermissionCache.set(String(pid),{permissions:v.permissions||[]}))}renderIssues();renderLogs();if(typeof applyInboxNavVisibility==='function')applyInboxNavVisibility();if(typeof applyTrashNavVisibility==='function')applyTrashNavVisibility();if(typeof renderReports==='function')renderReports()}
function canViewDashboard(){
  let user=null;
  try{ user=typeof getAuthUser==='function' ? getAuthUser() : null; }catch(_){}
  const code=String(user?.role_name||user?.roleName||user?.role||'').toUpperCase();
  if(['ADMIN','DIRECTOR','MANAGER'].includes(code)) return true;
  // Tổng quan tiến độ: mọi tài khoản đã đăng nhập đều xem được — máy chủ chỉ trả công trình được phân công
  if(user&&typeof getAuthToken==='function'&&getAuthToken()) return true;
  if(user?.dashboard_access===true || user?.dashboardAccess===true) return true;
  if(Array.isArray(user?.permissions) && user.permissions.some(x=>String(x).toUpperCase()==='DASHBOARD_VIEW')) return true;
  return ['\u0047i\u00e1m \u0111\u1ed1c','Admin'].includes(db.role);
}
function roleToken(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toUpperCase().trim()}
function canManageAssignments(){
  let authRole='';try{authRole=typeof getAuthUser==='function'?(getAuthUser()?.role_name||getAuthUser()?.roleName||getAuthUser()?.role||''):''}catch(_){ }
  const raw=String(db.role||'')+' '+String(authRole||'');const token=roleToken(authRole||db.role);
  return token==='ADMIN'||token==='DIRECTOR'||token==='GIAM DOC'||/ADMIN|DIRECTOR|GI[AÃ]M/.test(raw.toUpperCase());
}
// Sửa công trình (hợp đồng, gói thầu, bảng tiến độ...) theo vai trò TẠI công trình đang xem —
// trước đây xét theo loại tài khoản chung (db.role) nên một người làm nhiều công trình với
// chức danh khác nhau vẫn thấy nút Sửa ở công trình mình chỉ là GS viên. pid mặc định currentProjectId.
function canEditProject(pid){return canManageAssignments()||canApproveIn(pid||currentProjectId)}
function canEditDailyLog(){
  if(canManageAssignments())return true;
  return logProjectsForCreate().length>0||(db.logs||[]).some(l=>canEditLog(l));
}
function canEditLog(log){
  if(!log || log.status==='LOCKED') return false;
  if(isPrivilegedLogEditor()) return true;
  if(log.status!=='DRAFT') return false;
  if(!qualityPermissions(log.projectId).includes('CREATE')) return false;
  if(typeof log.canEdit==='boolean') return log.canEdit;
  const uid=typeof getAuthUser==='function' ? (getAuthUser()?.id||'') : '';
  if(uid && log.createdById) return log.createdById===uid;
  return !log.serverId && db.sync.some(x=>x.type==='daily_log' && x.recordId===log.id && x.operation==='CREATE' && x.status==='PENDING');
}
function isLogLead(pid){return canApproveIn(pid)}
// Mở lại báo cáo ngày (Chờ duyệt/Đã duyệt/Đã khóa) về Nháp — người có quyền Sửa tại công trình
// (mặc định gồm TVGS trưởng) hoặc Admin/Giám đốc, không chỉ riêng Admin/Giám đốc như sửa trực tiếp.
function canReopenLog(log){return !!log&&log.status!=='DRAFT'&&!!log.serverId&&(canManageAssignments()||qualityPermissions(log.projectId).includes('EDIT'))}
// Bản nháp là của riêng người lập: chỉ người lập (hoặc Admin/Giám đốc) gửi duyệt — khớp máy chủ.
function canSubmitLog(l){if(!l?.serverId||l.status!=='DRAFT')return false;if(canManageAssignments())return true;return l.createdById===qualityAuthUserId()&&qualityPermissions(l.projectId).includes('CREATE')}
// Nháp của người khác không hiện (máy chủ đã lọc; lớp này chặn bản cũ còn lưu trên thiết bị).
function canSeeLog(l){return !!l&&(l.status!=='DRAFT'||!l.serverId||!l.createdById||l.createdById===qualityAuthUserId()||canManageAssignments())}
function myPerms(pid){return canManageAssignments()?['VIEW','CREATE','EDIT','DOWNLOAD','APPROVE','DELETE']:qualityPermissions(pid)}
// Quyền Xóa theo công trình: Admin/Giám đốc luôn có; người khác chỉ khi được cấp tùy chỉnh
function canDeleteIn(pid){return myPerms(pid).includes('DELETE')}
function deleteBtn(kind,id,pid,label){return canDeleteIn(pid)&&id?' <button class="danger" onclick="event.stopPropagation();deleteContent(\''+kind+'\',\''+id+'\',\''+esc(String(label||'').replace(/'/g,'’'))+'\')" title="Chuyển vào Thùng rác (khôi phục được)">🗑 Xóa</button>':''}
// Quyền duyệt theo TỪNG CÔNG TRÌNH (Trưởng TVGS tại công trình đó) — không theo loại tài khoản
function canApproveIn(pid){return canManageAssignments()||qualityPermissions(pid).includes('APPROVE')}
// Bản đã "Trình công ty" thì chỉ Giám đốc/Admin quyết định
function docCanDecide(x){return !!x&&canApproveIn(x.projectId)&&(canManageAssignments()||x.status!=='SUBMITTED'||x.lastReview?.action!=='ESCALATE')}
function canCreateDocIn(pid){return myPerms(pid).includes('CREATE')}
function canDownloadIn(pid){return myPerms(pid).includes('DOWNLOAD')}
function canModifyDoc(x){if(!x||x.status==='LOCKED')return false;if(canManageAssignments())return true;if(x.serverId&&x.status&&x.status!=='DRAFT')return false;const p=myPerms(x.projectId);return p.includes('EDIT')||(x.createdById&&x.createdById===qualityAuthUserId()&&p.includes('CREATE'))}

// ============================================================================
// NHÂN SỰ & QUYỀN THEO CÔNG TRÌNH — một nguồn dữ liệu duy nhất
// Máy chủ trả danh sách hợp nhất /project-personnel/project/:id/team
// (mỗi người MỘT dòng; tài khoản liên kết bằng user_id, không ghép theo tên).
// ============================================================================
const PERM_LABELS={VIEW:'Xem',CREATE:'Thêm',EDIT:'Sửa',DOWNLOAD:'Tải xuống / in',APPROVE:'Duyệt',DELETE:'Xóa'};
const PERM_ORDER=['VIEW','CREATE','EDIT','DOWNLOAD','APPROVE','DELETE'];
// Quyền mặc định của TVGS trưởng tại công trình — KHÔNG gồm Xóa (Xóa chỉ cấp bằng Tùy chỉnh)
const LEAD_DEFAULT_PERMS=['VIEW','CREATE','EDIT','DOWNLOAD','APPROVE'];
// Phải khớp backend/src/services/permissionService.js (isLeadTitle / effective)
function isLeadTitle(title){const t=String(title||'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase().replace(/\s+/g,' ').trim();if(!t||/\bpho\b/.test(t))return false;return /\btruong\b/.test(t)&&/(tvgs|giam sat)/.test(t)}
function defaultPermsFor(roleName,title){
 if(['ADMIN','DIRECTOR'].includes(roleName))return PERM_ORDER;
 if(roleName!=='MANAGER'&&String(title||'').trim())return isLeadTitle(title)?LEAD_DEFAULT_PERMS:['VIEW','CREATE','DOWNLOAD'];
 if(roleName==='TVGS_LEAD')return LEAD_DEFAULT_PERMS;
 return ROLE_DEFAULT_PERMS[roleName]||['VIEW'];
}
const ROLE_LABELS={ADMIN:'Admin',DIRECTOR:'Giám đốc',MANAGER:'Quản lý (giúp việc GĐ)',TVGS_LEAD:'Trưởng TVGS',ENGINEER:'TVGS'};
// Phải khớp backend/src/services/permissionService.js
const ROLE_DEFAULT_PERMS={ADMIN:PERM_ORDER,DIRECTOR:PERM_ORDER,MANAGER:['VIEW','DOWNLOAD'],TVGS_LEAD:['VIEW','CREATE','EDIT','DOWNLOAD'],ENGINEER:['VIEW','CREATE','DOWNLOAD']};
function permChips(list,source){
 if(!list||!list.length)return '<span class="muted">—</span>';
 const chips=PERM_ORDER.filter(k=>list.includes(k)).map(k=>'<span class="chip">'+esc(PERM_LABELS[k])+'</span>').join(' ');
 const tag=source==='ROLE_DEFAULT'?' <span class="muted">(mặc định theo chức danh)</span>':source==='GLOBAL_ROLE'?' <span class="muted">(toàn quyền)</span>':'';
 return chips+tag;
}
function defaultsLabel(roleName,title){
 const d=defaultPermsFor(roleName,title);
 const basis=roleName!=='MANAGER'&&String(title||'').trim()?'chức danh "'+title+'"':(ROLE_LABELS[roleName]||roleName||'chưa chọn tài khoản');
 return basis+': '+d.map(k=>PERM_LABELS[k]).join(', ');
}
