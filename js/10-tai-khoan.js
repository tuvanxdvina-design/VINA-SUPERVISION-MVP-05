function accountCell(r,pid){
 if(!canManageAssignments()&&!r.is_me)return r.account_status==='LINKED'?'<span class="muted">Có tài khoản</span>':'<span class="muted">—</span>';
 if(r.account_status==='PENDING_SYNC')return '<span class="chip warn">Chờ đồng bộ</span>';
 if(r.account_status==='LINKED')return esc(r.username)+' <span class="muted">· '+esc(ROLE_LABELS[r.role_name]||r.role_name)+'</span>'+(r.account_name&&cleanPersonName(r.account_name).toLocaleLowerCase('vi')!==cleanPersonName(r.full_name).toLocaleLowerCase('vi')?' <button type="button" class="chip danger" style="border:0;cursor:pointer" title="Họ tên của tài khoản là '+esc(r.account_name)+', khác tên nhân sự. Bấm để sửa." onclick="event.stopPropagation();openAccountFix(\''+encodeURIComponent(r.key)+'\',\''+esc(pid||'')+'\')">⚠ Tài khoản mang tên '+esc(r.account_name)+' — bấm để sửa</button>':'');
 if(r.account_status==='LINKED_NO_ACCESS')return esc(r.username||'')+' <span class="chip warn">Đã thu hồi quyền</span>';
 return '<span class="muted">Không có tài khoản</span>';
}
function usernameSuggestions(name){
 const parts=String(name||'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase().replace(/[^a-z0-9 ]/g,' ').trim().split(/\s+/).filter(Boolean);
 if(!parts.length)return [];
 const last=parts[parts.length-1],first=parts[0],mid=parts.slice(1,-1);
 const out=[suggestUsername(name),parts.join(''),parts.join('.'),mid.concat(last).join('')+(parts.length>1?'.'+first[0]:''),last+first];
 return [...new Set(out.filter(u=>u&&u.length>=3).map(u=>u.slice(0,50)))].slice(0,5);
}
let usernameTimer=null;
function checkUsernameInput(input,exceptId){
 const hint=input.parentElement.querySelector('#tmUserHint,#tmRenameHint');const v=String(input.value||'').trim().toLowerCase();
 if(!hint)return;hint.dataset.taken='';
 if(!USERNAME_RE.test(v)){hint.style.color='#b42318';hint.textContent=v?USERNAME_RULE:'';return}
 hint.style.color='';hint.textContent='Đang kiểm tra...';clearTimeout(usernameTimer);
 usernameTimer=setTimeout(async()=>{try{const r=await apiRequest('/users/username-available?username='+encodeURIComponent(v)+(exceptId?'&except='+encodeURIComponent(exceptId):''));if(input.value.trim().toLowerCase()!==v)return;hint.dataset.taken=r.available?'':'1';hint.style.color=r.available?'#067647':'#b42318';hint.textContent=r.available?'✔ Dùng được':'✖ '+(r.reason||'Đã có người dùng')}catch(_){hint.textContent=''}},350);
}
function showRenameUsername(userId,current,encodedKey,pid){
 const box=document.getElementById('tmRenameBox');if(!box)return;
 const r=(teamRowsByProject[pid]||[]).find(x=>x.key===decodeURIComponent(encodedKey));
 const mismatch=r&&r.account_name&&cleanPersonName(r.account_name).toLocaleLowerCase('vi')!==cleanPersonName(r.full_name).toLocaleLowerCase('vi');
 box.innerHTML='<div class="row" style="align-items:end"><div><label>Tên đăng nhập mới</label><input id="tmRenameInput" maxlength="50" autocomplete="off" value="'+esc(current)+'" oninput="checkUsernameInput(this,\''+esc(userId)+'\')"><div id="tmRenameHint" class="muted" style="font-size:12px;margin-top:4px">Mật khẩu giữ nguyên; người dùng đăng nhập bằng tên mới.</div>'
  +(mismatch?'<label class="inline"><input type="checkbox" id="tmRenameSyncName" checked> Đồng thời đổi họ tên tài khoản "'+esc(r.account_name)+'" → "'+esc(r.full_name)+'"</label>':'')+'</div><div><button type="button" class="primary" onclick="saveRenameUsername(\''+esc(userId)+'\',\''+encodedKey+'\',\''+pid+'\')">Lưu tên đăng nhập</button> <button type="button" onclick="document.getElementById(\'tmRenameBox\').innerHTML=\'\'">Hủy</button></div></div>';
 document.getElementById('tmRenameInput').focus();
}
async function saveRenameUsername(userId,encodedKey,pid){
 const input=document.getElementById('tmRenameInput');const hint=document.getElementById('tmRenameHint');const v=String(input?.value||'').trim().toLowerCase();
 if(!USERNAME_RE.test(v)){hint.style.color='#b42318';hint.textContent=USERNAME_RULE;return}
 const r=(teamRowsByProject[pid]||[]).find(x=>x.key===decodeURIComponent(encodedKey));
 const body={username:v};if(document.getElementById('tmRenameSyncName')?.checked&&r?.full_name){body.full_name=r.full_name;body.keep_history_name=true}
 try{const u=await apiRequest('/users/'+encodeURIComponent(userId),{method:'PATCH',body:JSON.stringify(body)});
  const a=assignmentUsers.find(x=>x.id===userId);if(a)a.username=u.username;audit('RENAME_USERNAME','users',userId,u.username);save();
  await refreshTeamViews(pid);openTeamMember(encodedKey,pid);alert('Đã đổi tên đăng nhập thành "'+u.username+'". Báo cho người dùng đăng nhập bằng tên mới.')}
 catch(error){hint.style.color='#b42318';hint.textContent=error.message}
}
// Tài khoản đúng là của nhân sự này nhưng họ tên tài khoản còn tên cũ → đồng bộ họ tên tài khoản theo hồ sơ nhân sự
// Họ tên tài khoản khác tên nhân sự → cửa sổ sửa riêng (mở từ nhãn ⚠ trên bảng hoặc trong cửa sổ nhân sự)
async function openAccountFix(encodedKey,pid){
 const r=(teamRowsByProject[pid]||[]).find(x=>x.key===decodeURIComponent(encodedKey));if(!r||!r.user_id)return;
 let u={daily_logs:0,documents:0,issues:0};try{u=await apiRequest('/users/'+encodeURIComponent(r.user_id)+'/usage')}catch(_){}
 const n=(u.daily_logs||0)+(u.documents||0)+(u.issues||0);
 const recs=[u.daily_logs?u.daily_logs+' báo cáo ngày'+(u.first_log?' ('+progressDate(u.first_log)+' – '+progressDate(u.last_log)+')':''):'',u.documents?u.documents+' hồ sơ/báo cáo':'',u.issues?u.issues+' văn bản chất lượng':''].filter(Boolean).join(', ');
 openModal('Tài khoản '+r.username+' mang họ tên khác nhân sự',
  '<div class="review-note reject">Nhân sự: <b>'+esc(r.full_name)+'</b> · Tài khoản: <b>'+esc(r.username)+'</b> đang mang họ tên <b>'+esc(r.account_name)+'</b>.<br><span class="muted">Đổi <i>tên đăng nhập</i> không đổi <i>họ tên của tài khoản</i> — cảnh báo so sánh họ tên.</span></div>'
  +'<div class="card"><h4 style="margin-top:0">① Tài khoản này nay là của '+esc(r.full_name)+'</h4><p>Đổi họ tên tài khoản từ "'+esc(r.account_name)+'" thành "<b>'+esc(r.full_name)+'</b>".</p>'
  +(n?'<label class="inline"><input type="checkbox" id="afKeep" checked> Giữ tên người lập "<b>'+esc(r.account_name)+'</b>" trên '+esc(recs)+' đã lập trước đây bằng tài khoản này</label><p class="muted" style="font-size:12px;margin:2px 0 8px 26px">Nên giữ: các bản đó do '+esc(r.account_name)+' lập. Bỏ chọn chỉ khi chúng thực ra do '+esc(r.full_name)+' lập.</p>':'<p class="muted">Tài khoản chưa lập báo cáo ngày/hồ sơ nào — không ảnh hưởng lịch sử.</p>')
  +'<button class="primary" onclick="confirmAccountOwner(\''+esc(r.user_id)+'\',\''+encodedKey+'\',\''+esc(pid)+'\')">Đúng người — đổi họ tên tài khoản</button></div>'
  +'<div class="card" style="margin-top:10px"><h4 style="margin-top:0">② Gắn nhầm tài khoản</h4><p>Thu hồi quyền của tài khoản '+esc(r.username)+' tại công trình (vẫn giữ '+esc(r.full_name)+' trong danh sách), rồi tạo tài khoản mới cho '+esc(r.full_name)+'.</p>'
  +(r.personnel_id?'<button class="danger" onclick="closeModal();unlinkTeamAccount(\''+encodedKey+'\',\''+esc(pid)+'\')">Thu hồi quyền truy cập</button>':'')+'</div>');
}
async function confirmAccountOwner(userId,encodedKey,pid){
 const r=(teamRowsByProject[pid]||[]).find(x=>x.key===decodeURIComponent(encodedKey));if(!r)return;
 const keep=document.getElementById('afKeep')?.checked!==false;
 try{const u=await apiRequest('/users/'+encodeURIComponent(userId),{method:'PATCH',body:JSON.stringify({full_name:r.full_name,keep_history_name:keep})});
  const a=assignmentUsers.find(x=>x.id===userId);if(a)a.full_name=r.full_name;audit('CONFIRM_ACCOUNT_OWNER','users',userId,r.username+' → '+r.full_name+(u.history_name_kept_on?' (giữ tên cũ trên '+u.history_name_kept_on+' bản ghi)':''));save();
  closeModal();await refreshTeamViews(pid);
  alert('Đã đổi họ tên tài khoản '+r.username+' thành "'+r.full_name+'".'+(u.history_name_kept_on?'\n'+u.history_name_kept_on+' bản ghi cũ vẫn ghi người lập là "'+r.account_name+'".':''))}
 catch(error){alert('Không cập nhật được: '+error.message)}
}
function suggestUsername(name){const parts=String(name||'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase().replace(/[^a-z0-9 ]/g,' ').trim().split(/\s+/).filter(Boolean);if(!parts.length)return '';const last=parts.pop();return (last+(parts.length?'.'+parts.map(x=>x[0]).join(''):'')).slice(0,50)}
function onTeamAccountChange(){
 const type=document.getElementById('tmAccType')?.value||'';const modeWrap=document.getElementById('tmAccModeWrap');const detail=document.getElementById('tmAccDetail');const box=document.getElementById('tmPermWrap');
 if(!modeWrap||!detail||!box)return;
 if(!type){modeWrap.innerHTML='';detail.innerHTML='<p class="muted">Nhân sự không có tài khoản vẫn nằm trong danh sách tổ TVGS nhưng không đăng nhập được.</p>';box.innerHTML='';return}
 const prev=document.getElementById('tmPrevUser')?.value||'';
 const projectId=document.getElementById('tmProjectId')?.value||'';
 // Một tài khoản được phân công ở nhiều công trình; chỉ chặn gắn trùng trong công trình đang sửa.
 const linked=new Set((teamRowsByProject[projectId]||[]).filter(x=>x.account_status==='LINKED'&&x.user_id!==prev).map(x=>x.user_id));
 const existing=assignmentUsers.filter(u=>u.role_name===type&&u.is_active!==false);
 // Người chưa có tài khoản → mặc định TẠO MỚI. Trước đây mặc định "Dùng tài khoản có sẵn" và chọn sẵn
 // tài khoản đầu danh sách (của người khác) → bấm Lưu là gắn nhầm tài khoản.
 const mode=document.querySelector('input[name="tmAccMode"]:checked')?.value||(prev&&existing.some(u=>u.id===prev)?'EXISTING':'NEW');
 const personName=cleanPersonName(document.getElementById('tmName')?.value||'').toLocaleLowerCase('vi');
 const nameMatch=existing.find(u=>!linked.has(u.id)&&personName&&cleanPersonName(u.full_name||'').toLocaleLowerCase('vi')===personName);
 const selId=prev||nameMatch?.id||'';
 modeWrap.innerHTML='<label>Cách gán</label><label class="inline"><input type="radio" name="tmAccMode" value="NEW"'+(mode==='NEW'?' checked':'')+' onchange="onTeamAccountChange()"> Tạo tài khoản mới</label><label class="inline"><input type="radio" name="tmAccMode" value="EXISTING"'+(mode==='EXISTING'?' checked':'')+(existing.length?'':' disabled')+' onchange="onTeamAccountChange()"> Dùng tài khoản có sẵn ('+existing.length+')</label>';
 if(mode==='EXISTING'){
  detail.innerHTML='<label>Tài khoản '+esc(ROLE_LABELS[type])+'</label><select id="tmAccount"><option value="">— Chọn tài khoản —</option>'+existing.map(u=>'<option value="'+u.id+'"'+(u.id===selId?' selected':'')+(linked.has(u.id)&&u.id!==prev?' disabled':'')+'>'+esc(u.username)+(u.full_name?' — '+esc(u.full_name):'')+(linked.has(u.id)?' (đã gán người khác)':'')+'</option>').join('')+'</select>'
   +(nameMatch||prev?'':'<p class="muted">Không có tài khoản nào trùng họ tên người này. Kiểm tra kỹ trước khi gán, hoặc chọn "Tạo tài khoản mới".</p>');
 }else{
  const name=document.getElementById('tmName')?.value||'';
  const oldUser=document.getElementById('tmNewUsername')?.value,oldPw=document.getElementById('tmNewPassword')?.value;
  detail.innerHTML='<div class="row"><div><label>Tên đăng nhập (tự đặt)</label><input id="tmNewUsername" maxlength="50" autocomplete="off" value="'+esc(oldUser||suggestUsername(name))+'" placeholder="vd. thanhb, b.nt, 0912345678, ten@congty.vn" oninput="checkUsernameInput(this)">'
   +'<div id="tmUserHint" class="muted" style="font-size:12px;margin-top:4px"></div><div style="margin-top:4px">'+usernameSuggestions(name).map(u=>'<button type="button" class="chip" style="border:0;cursor:pointer;margin:2px" onclick="const i=document.getElementById(\'tmNewUsername\');i.value=\''+esc(u)+'\';checkUsernameInput(i)">'+esc(u)+'</button>').join('')+'</div></div>'
   +'<div><label>Mật khẩu ban đầu (≥ 8 ký tự)</label><div style="display:flex;gap:6px"><input id="tmNewPassword" type="text" autocomplete="off" maxlength="72" value="'+esc(oldPw||randomPassword())+'"><button type="button" title="Tạo mật khẩu ngẫu nhiên khác" onclick="document.getElementById(\'tmNewPassword\').value=randomPassword()">↻</button></div></div></div>'
   +'<p class="muted">Sau khi lưu, hệ thống hiện <b>phiếu tài khoản</b> để in/sao chép gửi người dùng. Lần đăng nhập đầu tiên người dùng <b>bắt buộc đổi mật khẩu</b>.</p>';
 }
 box.innerHTML=permEditorHtml(null,type);
}
function randomPassword(len=10){
 const chars='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
 let s='';for(const n of crypto.getRandomValues(new Uint32Array(len)))s+=chars[n%chars.length];
 return /\d/.test(s)?s:s.slice(0,-1)+'7';
}
function slipText(s){return 'VINA-SUPERVISION — Tài khoản đăng nhập\nHọ tên: '+s.fullName+'\n'+(s.project?'Công trình: '+s.project+(s.title?' ('+s.title+')':'')+'\n':'')+'Loại tài khoản: '+(s.role||'')+'\nĐịa chỉ: '+location.origin+'/\nTên đăng nhập: '+s.username+'\nMật khẩu '+(s.reset?'mới (tạm)':'ban đầu')+': '+s.password+'\nLần đăng nhập đầu tiên hệ thống yêu cầu đổi mật khẩu.'}
function showAccountSlip(s){
 lastSlip=s;
 openModal(s.reset?'Đã đặt lại mật khẩu':'Đã tạo tài khoản đăng nhập','<div class="cred-slip"><b>VINA-SUPERVISION — Tài khoản đăng nhập</b><br>Họ tên: <b>'+esc(s.fullName)+'</b><br>'+(s.project?'Công trình: '+esc(s.project)+(s.title?' ('+esc(s.title)+')':'')+'<br>':'')+'Loại tài khoản: '+esc(s.role||'')+'<br>Địa chỉ: <code>'+esc(location.origin)+'/</code><br>Tên đăng nhập: <code>'+esc(s.username)+'</code><br>Mật khẩu '+(s.reset?'mới (tạm)':'ban đầu')+': <code>'+esc(s.password)+'</code><br><span class="muted">Lần đăng nhập đầu tiên hệ thống yêu cầu đổi mật khẩu.</span></div>'
  +'<div class="toolbar"><button class="primary" onclick="copyAccountSlip()">Sao chép</button><button onclick="printAccountSlip()">In phiếu</button><button onclick="closeModal()">Đóng</button></div><p id="slipMsg" class="muted">Mật khẩu chỉ hiện một lần (máy chủ không lưu dạng đọc được). Nếu người dùng quên, dùng "Đặt lại mật khẩu" trong cửa sổ nhân sự.</p>');
}
async function resetTeamPassword(userId,encodedKey,pid){
 const r=(teamRowsByProject[pid]||[]).find(x=>x.key===decodeURIComponent(encodedKey));if(!r||!userId)return;
 if(!confirm('Đặt lại mật khẩu cho tài khoản '+r.username+' ('+r.full_name+')?\nMật khẩu cũ hết hiệu lực ngay; người dùng phải đăng nhập bằng mật khẩu tạm rồi đổi mật khẩu mới.'))return;
 const pw=randomPassword();
 try{await apiRequest('/users/'+encodeURIComponent(userId)+'/password',{method:'POST',body:JSON.stringify({password:pw})});audit('RESET_PASSWORD','users',userId,r.username);save();
  showAccountSlip({fullName:r.full_name,username:r.username,password:pw,role:ROLE_LABELS[r.role_name]||r.role_name,project:(db.projects||[]).find(x=>x.id===pid)?.name||'',title:r.assignment_title,reset:true})}
 catch(error){alert('Không đặt lại được mật khẩu: '+error.message)}
}
