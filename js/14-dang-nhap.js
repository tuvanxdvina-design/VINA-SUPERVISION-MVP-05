function qualityAuthUser(){try{return typeof getAuthUser==='function'?getAuthUser():null}catch(_){return null}}
function qualityAuthUserId(){return String(qualityAuthUser()?.id||'')}
async function unassignedAuthorsHtml(pid){
 if(!canManageAssignments()||!apiOnline())return '';
 try{
  const list=await apiRequest('/project-personnel/project/'+encodeURIComponent(pid)+'/unassigned-authors');
  if(!Array.isArray(list)||!list.length)return '';
  return '<div class="notice" style="margin-top:12px"><b>Đã lập báo cáo ngày/văn bản tại công trình nhưng hiện chưa được phân công</b> (không xem được công trình này):<table style="margin-top:6px"><tbody>'+list.map(u=>'<tr><td><b>'+esc(u.username)+'</b> · '+esc(ROLE_LABELS[u.role_name]||u.role_name)+'</td><td>'+u.record_count+' bản ghi, gần nhất '+progressDate(u.last_at)+'</td><td><button onclick="quickAssign(\''+pid+'\',\''+u.user_id+'\')">Phân công vào công trình</button></td></tr>').join('')+'</tbody></table></div>';
 }catch(_){return ''}
}
function openChangePassword(){
 openModal('Đổi mật khẩu','<div class="row"><div class="full"><label>Mật khẩu hiện tại</label><input id="cpOld" type="password" autocomplete="current-password"></div><div><label>Mật khẩu mới (≥ 8 ký tự)</label><input id="cpNew" type="password" autocomplete="new-password"></div><div><label>Nhập lại mật khẩu mới</label><input id="cpNew2" type="password" autocomplete="new-password"></div><div class="full"><button class="primary" onclick="saveChangePassword()">Đổi mật khẩu</button><div id="cpMsg" class="muted"></div></div></div>');
}
async function saveChangePassword(){
 const o=document.getElementById('cpOld').value,n=document.getElementById('cpNew').value,n2=document.getElementById('cpNew2').value;const m=document.getElementById('cpMsg');
 if(n.length<8){m.textContent='Mật khẩu mới tối thiểu 8 ký tự.';return}if(n!==n2){m.textContent='Hai lần nhập không khớp.';return}
 try{await apiRequest('/auth/change-password',{method:'POST',body:JSON.stringify({old_password:o,new_password:n})});alert('Đã đổi mật khẩu. Hãy đăng nhập lại bằng mật khẩu mới.');if(typeof clearAuthSession==='function')clearAuthSession();location.reload()}
 catch(error){m.textContent=error.message}
}
const APP_BUILD='2026-10-08.1-mvp05';
async function checkServerMigrations(){
 if(!apiOnline())return;
 try{const base=API_BASE.replace(/\/api$/,'');const h=await (await fetch(base+'/health',{cache:'no-store'})).json();
  window.serverHealth=h;
  if(h.build!==APP_BUILD){const main=document.querySelector('main');if(main&&!document.getElementById('buildBanner'))main.insertAdjacentHTML('afterbegin','<div id="buildBanner" class="notice" style="margin-bottom:12px;background:#fef3f2;border-color:#fecdca"><b>Máy chủ đang chạy phiên bản khác giao diện</b> (máy chủ: '+esc(h.build||'cũ, chưa có mã phiên bản')+' · giao diện: '+APP_BUILD+'). Các chức năng mới (hồ sơ trên máy chủ, nhân sự, tiến độ) sẽ lỗi. '+(canManageAssignments()?'Trên máy chủ: đóng cửa sổ/tiến trình backend rồi chạy lại <code>.\\run.bat</code> (bản mới tự khởi động lại khi lệch phiên bản).':'Hãy báo quản trị khởi động lại máy chủ.')+'</div>')}
  if(!canManageAssignments())return;
  if((h.security_warnings||[]).includes('JWT_SECRET_DEFAULT')){const main=document.querySelector('main');if(main&&!document.getElementById('secretBanner'))main.insertAdjacentHTML('afterbegin','<div id="secretBanner" class="notice" style="margin-bottom:12px;background:#fef3f2;border-color:#fecdca"><b>Khóa bảo mật đăng nhập đang là chuỗi mẫu.</b> Ai biết chuỗi này có thể giả mạo tài khoản Admin. Trên máy chủ: sửa <code>JWT_SECRET</code> trong <code>backend\\.env</code> thành chuỗi ngẫu nhiên ≥ 32 ký tự rồi chạy lại <code>.\\run.bat</code> (mọi người đăng nhập lại).</div>')}
  if(Array.isArray(h.migrations_pending)&&h.migrations_pending.length){const main=document.querySelector('main');if(main&&!document.getElementById('migrationBanner'))main.insertAdjacentHTML('afterbegin','<div id="migrationBanner" class="notice" style="margin-bottom:12px;background:#fef3f2;border-color:#fecdca"><b>Cơ sở dữ liệu chưa cập nhật cấu trúc</b> ('+h.migrations_pending.length+' bản: '+esc(h.migrations_pending.join(', '))+'). Một số chức năng (nhân sự, hồ sơ, tiến độ) sẽ lỗi. Trên máy chủ chạy: <code>powershell -ExecutionPolicy Bypass -File .\\migrate-db.ps1</code> rồi khởi động lại.</div>')}}
 catch(_){}
}

// ---- Bắt đổi mật khẩu ban đầu ----
window.forcePasswordChange=function(){
 if(window.__forcePw)return;
 openChangePassword();
 document.getElementById('mtitle').textContent='Đổi mật khẩu ban đầu';
 document.getElementById('mbody').insertAdjacentHTML('afterbegin','<div class="notice" style="margin-bottom:10px">Tài khoản đang dùng <b>mật khẩu ban đầu/mật khẩu tạm</b> do quản trị cấp. Hãy đặt mật khẩu mới của riêng bạn để tiếp tục. (Mật khẩu hiện tại = mật khẩu trên phiếu tài khoản.)</div>');
 document.getElementById('mbody').insertAdjacentHTML('beforeend','<p style="margin-top:10px"><button type="button" onclick="window.__forcePw=false;vinaLogout()">Đăng xuất</button></p>');
 const x=document.querySelector('#modal .modalbox > div button');if(x)x.style.display='none';
 window.__forcePw=true;
};
