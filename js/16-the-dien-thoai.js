// ============================================================================
// BẢNG → THẺ TRÊN ĐIỆN THOẠI
// Màn hình ≤ 600px: mỗi dòng bảng hiện thành một thẻ (nhãn cột bên trái, giá trị bên phải,
// nút thao tác thành hàng riêng ở đáy thẻ) — không phải cuộn ngang mới thấy nút Sửa/Duyệt.
// Chỉ gắn nhãn data-label cho từng ô + class "mcards"; bố cục do CSS @media trong index.html.
// PC không đổi gì. Mã dựng bảng ở các tệp tính năng giữ nguyên.
// ============================================================================
const MCARD_CONTAINERS=['companyPersonnelTable','logsTable','projectsTable','docsTable','issuesTable','reportsTable','inboxBody','trashBody','auditTable','portfolioBox','pdLogs','pdIssues','pdDocs'];
function cardifyTable(table){
 const headRow=table.querySelector('thead tr')||[...table.rows].find(r=>r.cells.length&&[...r.cells].every(c=>c.tagName==='TH'));
 if(!headRow)return;
 const labels=[];for(const th of headRow.cells){const span=Number(th.colSpan)||1;for(let i=0;i<span;i++)labels.push((th.innerText||th.textContent||'').trim())}
 for(const tr of table.rows){
  if(tr===headRow||tr.parentElement?.tagName==='THEAD'){tr.classList.add('mc-head');continue}
  let col=0;
  for(const td of tr.cells){
   const span=Number(td.colSpan)||1;
   const label=span>1?'':(labels[col]||'');
   td.setAttribute('data-label',label);
   // Gói nội dung ô vào một khối: ô có nhiều phần (chữ + <br> + dòng phụ) không bị flex tách thành nhiều cột.
   if(label&&!(td.childNodes.length===1&&td.firstChild.nodeType===1&&td.firstChild.classList?.contains('mc-v'))){const v=document.createElement('div');v.className='mc-v';while(td.firstChild)v.appendChild(td.firstChild);td.appendChild(v)}
   // Ô trống hoặc chỉ có "—" (chưa có số liệu) ẩn trên thẻ cho gọn. Cột không có tiêu đề nhưng có nút = cột thao tác → hàng nút ở đáy thẻ.
   td.classList.toggle('mc-actions',!label&&!!td.querySelector('button,a'));
   td.classList.toggle('mc-empty',['','—','-'].includes((td.innerText||'').trim())&&!td.querySelector('button,a,input,select,img'));
   col+=span;
  }
 }
 table.classList.add('mcards');
}
function cardifyAll(){
 for(const id of MCARD_CONTAINERS){const box=document.getElementById(id);if(box)box.querySelectorAll('table').forEach(cardifyTable)}
}
(function(){
 let queued=false;
 const run=()=>{queued=false;try{cardifyAll()}catch(e){console.warn('cardify:',e.message)}};
 const schedule=()=>{if(!queued){queued=true;requestAnimationFrame(run)}};
 const obs=new MutationObserver(muts=>{if(muts.some(m=>m.type==='childList'&&!(m.target.closest&&m.target.closest('table.mcards td'))))schedule()});
 const start=()=>{const root=document.querySelector('main')||document.body;obs.observe(root,{childList:true,subtree:true});schedule()};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();

// Điều hướng dưới 900px: dùng lại handler của nút cũ, không đổi nghiệp vụ/quyền.
const MOBILE_PRIMARY_PAGES=['dashboard','projects','reports','issues'];
// Audit hiện chỉ là db.audit cục bộ; chưa có API/quyền đọc máy chủ để xác nhận.
const MOBILE_AUDIT_SERVER_VERIFIED=false;
function mobileNavIcon(page){
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('mobile-nav-icon');svg.setAttribute('aria-hidden','true');
 const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href','#mnav-'+page);svg.appendChild(use);return svg;
}
function mobileMoreAllowed(button){
 const page=button.dataset.page;
 if(MOBILE_PRIMARY_PAGES.includes(page)||button.style.display==='none')return false;
 if(page==='audit')return MOBILE_AUDIT_SERVER_VERIFIED;
 if(page==='settings')return canManageAssignments();
 if(page==='trash')return canSeeTrash();
 if(page==='inbox')return isReviewer();
 return true;
}
function closeMobileMore(restoreFocus=true){
 const menu=document.getElementById('mobileMoreMenu'),button=document.getElementById('mobileMoreButton');
 if(!menu||menu.hidden)return;
 menu.hidden=true;document.getElementById('mobileMoreBackdrop').hidden=true;button.setAttribute('aria-expanded','false');
 if(restoreFocus)button.focus();
}
function updateMobileNavigation(){
 const mobile=matchMedia('(max-width:899px)').matches,active=document.querySelector('main>.page.active')?.id;
 const selected=active==='daily'?'reports':active==='projectDetail'?'projects':active;
 const buttons=[...document.querySelectorAll('aside>nav>button[data-page]')];
 for(const button of buttons){
  const page=button.dataset.page;
  if(!MOBILE_PRIMARY_PAGES.includes(page))continue;
  if(!button.classList.contains('mobile-primary'))button.classList.add('mobile-primary');
  if(!button.querySelector('.mobile-nav-icon'))button.prepend(mobileNavIcon(page));
  if(page==='issues'&&!button.querySelector('.mobile-nav-label')){const label=document.createElement('span');label.className='mobile-nav-label';label.textContent='Vấn đề';button.appendChild(label);}
  // Mở chi tiết công trình vẫn thuộc mục Công trình; PC giữ lựa chọn cũ.
  if(mobile&&button.classList.contains('active')!==(selected===page))button.classList.toggle('active',selected===page);
  button.setAttribute('aria-label',mobile&&page==='issues'?'Vấn đề':button.querySelector('span:not(.mobile-nav-label)')?.textContent||page);
  if(mobile&&selected===page)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
 }
 const more=document.getElementById('mobileMoreButton'),menu=document.getElementById('mobileMoreMenu');if(!more||!menu)return;
 const selectedMore=mobile&&!!selected&&!MOBILE_PRIMARY_PAGES.includes(selected);
 if(more.classList.contains('active')!==selectedMore)more.classList.toggle('active',selectedMore);
 if(!mobile){closeMobileMore(false);return;}
 if(menu.hidden)return;
 const choices=buttons.filter(mobileMoreAllowed),signature=choices.map(b=>b.dataset.page+':'+b.querySelector('span')?.textContent+':'+(b.dataset.page===selected)).join('|');
 const box=document.getElementById('mobileMoreItems');if(box.dataset.signature===signature)return;box.dataset.signature=signature;box.replaceChildren();
 for(const source of choices){
  const button=document.createElement('button');button.type='button';button.dataset.mobileTarget=source.dataset.page;button.appendChild(mobileNavIcon(source.dataset.page));
  const label=document.createElement('span');label.textContent=source.querySelector('span')?.textContent||'';button.appendChild(label);
  if(source.dataset.page===selected){button.classList.add('active');button.setAttribute('aria-current','page');}
  button.onclick=()=>{closeMobileMore(false);source.click();document.querySelector('main>.page.active h2')?.setAttribute('tabindex','-1');document.querySelector('main>.page.active h2')?.focus({preventScroll:true});};box.appendChild(button);
 }
}
function toggleMobileMore(){
 const menu=document.getElementById('mobileMoreMenu');if(!matchMedia('(max-width:899px)').matches||!menu)return;
 if(!menu.hidden)return closeMobileMore();
 menu.hidden=false;document.getElementById('mobileMoreBackdrop').hidden=false;document.getElementById('mobileMoreButton').setAttribute('aria-expanded','true');updateMobileNavigation();(menu.querySelector('button[data-mobile-target]')||menu.querySelector('button'))?.focus();
}
(function(){
 let queued=false;const schedule=()=>{if(!queued){queued=true;requestAnimationFrame(()=>{queued=false;updateMobileNavigation();});}};
 const start=()=>{
  document.getElementById('mobileMoreButton').addEventListener('click',toggleMobileMore);
  document.getElementById('mobileMoreBackdrop').addEventListener('click',()=>closeMobileMore());
  document.getElementById('mobileMoreClose').addEventListener('click',()=>closeMobileMore());
  document.addEventListener('keydown',event=>{
   if(document.getElementById('mobileMoreMenu').hidden)return;
   if(event.key==='Escape'){event.preventDefault();closeMobileMore();}
   if(event.key==='Tab'){
    const focusable=[...document.querySelectorAll('#mobileMoreMenu button')];
    const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
   }
  });
  const observer=new MutationObserver(schedule);observer.observe(document.querySelector('aside>nav'),{childList:true,subtree:true,attributes:true,attributeFilter:['class','style']});
  for(const section of document.querySelectorAll('main>.page'))observer.observe(section,{attributes:true,attributeFilter:['class']});
  matchMedia('(max-width:899px)').addEventListener('change',schedule);schedule();
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
