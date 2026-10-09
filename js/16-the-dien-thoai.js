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
