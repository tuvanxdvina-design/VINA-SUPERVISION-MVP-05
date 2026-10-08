// ============================================================================
// Tổng quan tiến độ nhiều công trình + CẢNH BÁO TỰ ĐỘNG
//
// Quy tắc tham khảo các phần mềm quản lý dự án xây dựng phổ biến:
//  - Oracle Primavera P6 / MS Project / chuẩn EVM (PMI): chỉ số tiến độ SPI = % thực tế / % kế hoạch,
//    chênh lệch tiến độ (SV), hạng mục trễ hạn, dự báo ngày hoàn thành theo SPI.
//  - Procore / Autodesk Construction Cloud: kiểm tra nhật ký hằng ngày đầy đủ (Daily Log compliance),
//    kế hoạch 2–3 tuần tới (look-ahead), việc quá hạn.
//  - Oracle Aconex / PlanRadar / Fieldwire: hồ sơ chờ duyệt quá hạn, vấn đề (NCR) quá hạn xử lý.
//  - Bảng điều khiển danh mục dự án: đèn Xanh / Vàng / Đỏ theo cảnh báo nặng nhất.
// Ngưỡng đặt ở THRESHOLDS (có thể chỉnh theo thực tế công ty).
// ============================================================================
const pool = require('../utils/db');
const progressService = require('./projectProgressService');
const { isLeadTitle } = require('./permissionService');

const THRESHOLDS = {
  spiWarn: 0.95, spiCrit: 0.85,          // SPI < 0.95 cảnh báo, < 0.85 nghiêm trọng (chỉ xét khi kế hoạch ≥ 5%)
  varianceWarn: -5, varianceCrit: -10,   // chênh lệch thực tế − kế hoạch (điểm %)
  staleWarnDays: 7, staleCritDays: 14,   // số ngày chưa cập nhật % thực tế
  logWindowDays: 7, logMissWarn: 2, logMissCrit: 4, // ngày (Thứ Hai–Thứ Bảy) thiếu nhật ký trong 7 ngày qua
  approvalWarnDays: 2, approvalCritDays: 5,          // bản chờ duyệt quá số ngày
  lookaheadDays: 14,                     // hạng mục sắp bắt đầu trong 14 ngày tới
  endSoonDays: 30, endSoonMinActual: 90  // còn ≤ 30 ngày tới hạn hợp đồng mà thực tế < 90%
};

const DAY = 86400000;
const iso = d => d.toISOString().slice(0, 10);
const todayVN = () => iso(new Date(Date.now() + 7 * 3600000));
const addDays = (s, n) => iso(new Date(new Date(s + 'T00:00:00Z').getTime() + n * DAY));
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / DAY);
const plain = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toUpperCase();
const isDone = p => Number(p.progress) >= 100 || /(COMPLETED|DONE|CLOSED|HOAN THANH|BAN GIAO|NGHIEM THU XONG)/.test(plain(p.status));
const isPaused = p => /(PAUSED|SUSPENDED|TAM DUNG|TAM NGUNG)/.test(plain(p.status));
const fmtVN = s => s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '';

function alert(severity, code, title, detail, target) { return { severity, code, title, detail, target: target || 'project' }; }

// Tình trạng một công trình tại ngày asOf (mặc định hôm nay, giờ Việt Nam)
async function projectHealth(project, asOfText) {
  const today = todayVN();
  const asOf = asOfText && asOfText < today ? asOfText : today;
  const live = asOf === today;
  const alerts = [];
  const out = { id: project.id, code: project.project_code || project.contract_no, name: project.name, status: project.status,
    progress: Number(project.progress || 0), as_of: asOf, plan: null, logs: null, approvals: null, issues: null, reports: null };

  if (isDone(project)) { out.health = 'DONE'; out.alerts = []; return out; }
  if (isPaused(project)) { out.health = 'PAUSED'; out.alerts = [alert('INFO', 'PAUSED', 'Công trình đang tạm dừng', 'Không đánh giá tiến độ khi tạm dừng.')]; return out; }

  // ---- 1. Tiến độ theo bảng tiến độ hiện hành ----
  const cur = (await pool.query(`SELECT id, TO_CHAR(revised_end_date,'YYYY-MM-DD') AS revised_end FROM project_progress_plans
    WHERE project_id = $1 AND is_current ORDER BY created_at DESC LIMIT 1`, [project.id])).rows[0];
  const contractEnd = cur?.revised_end || (project.end_date ? String(project.end_date).slice(0, 10) : null);
  // Đã khởi công? Theo ngày khởi công; không có thì theo bảng tiến độ (bên dưới); không có cả hai thì theo việc đã có nhật ký
  let started = project.start_date ? String(project.start_date).slice(0, 10) <= asOf
    : !!(await pool.query('SELECT 1 FROM daily_logs WHERE project_id = $1 AND log_date <= $2 LIMIT 1', [project.id, asOf])).rows[0];
  if (!cur) {
    alerts.push(alert('WARNING', 'NO_PLAN', 'Chưa có bảng tiến độ', 'Tải lên bảng tiến độ (Excel) để hệ thống so sánh kế hoạch – thực tế và cảnh báo chậm tiến độ.', 'progress'));
  } else {
    const d = await progressService.detail(project.id, cur.id, asOf);
    const s = d.summary;
    const lastActual = (await pool.query(`SELECT TO_CHAR(MAX(a.report_date),'YYYY-MM-DD') AS d FROM project_schedule_actuals a
      JOIN project_schedule_items i ON i.id = a.item_id WHERE i.plan_id = $1 AND a.report_date <= $2`, [cur.id, asOf])).rows[0]?.d || null;
    const items = d.items || [];
    const overdue = items.filter(i => i.status === 'QUA_HAN');
    const late = items.filter(i => i.status === 'CHAM');
    const lookahead = items.filter(i => i.start_date > asOf && i.start_date <= addDays(asOf, THRESHOLDS.lookaheadDays));
    if (s.mode === 'ITEMS' && s.start_date) started = s.start_date <= asOf;
    // Dự báo ngày hoàn thành theo SPI (EVM): thời gian dự kiến = thời gian kế hoạch / SPI
    let forecastEnd = null;
    if (s.mode === 'ITEMS' && s.spi && s.spi > 0 && s.planned_percent >= 5 && s.actual_percent < 100) {
      const dur = daysBetween(s.start_date, s.end_date) + 1;
      forecastEnd = addDays(s.start_date, Math.ceil(dur / s.spi) - 1);
    }
    out.plan = { id: cur.id, name: d.plan.plan_name, mode: s.mode, planned: s.planned_percent, actual: s.actual_percent,
      variance: s.variance, spi: s.spi ?? null, start: s.start_date || null, end: s.end_date || null, contract_end: contractEnd,
      forecast_end: forecastEnd, last_actual_date: lastActual, item_count: items.length, late_items: late.length,
      overdue_items: overdue.length, lookahead_items: lookahead.length,
      top_late: overdue.concat(late).sort((a, b) => a.variance - b.variance).slice(0, 5).map(i => ({ name: i.name, planned: i.planned_percent, actual: i.actual_percent, end_date: i.end_date, status: i.status })) };

    if (s.mode !== 'ITEMS') {
      alerts.push(alert('INFO', 'PLAN_NO_ITEMS', 'Bảng tiến độ chưa có hạng mục', 'Số liệu tiến độ đang là tỷ lệ nhập tay, không kiểm chứng được. Nhập hạng mục (Excel) để so sánh chính xác.', 'progress'));
    } else if (started) {
      const spiBad = s.planned_percent >= 5 && s.spi !== null;
      if ((spiBad && s.spi < THRESHOLDS.spiCrit) || s.variance <= THRESHOLDS.varianceCrit) {
        alerts.push(alert('CRITICAL', 'SCHEDULE_BEHIND', 'Chậm tiến độ nghiêm trọng', `Kế hoạch ${s.planned_percent}% – thực tế ${s.actual_percent}% (lệch ${s.variance} điểm${spiBad ? ', SPI ' + s.spi : ''}).`, 'progress'));
      } else if ((spiBad && s.spi < THRESHOLDS.spiWarn) || s.variance <= THRESHOLDS.varianceWarn) {
        alerts.push(alert('WARNING', 'SCHEDULE_BEHIND', 'Chậm tiến độ', `Kế hoạch ${s.planned_percent}% – thực tế ${s.actual_percent}% (lệch ${s.variance} điểm${spiBad ? ', SPI ' + s.spi : ''}).`, 'progress'));
      }
      if (overdue.length) alerts.push(alert('CRITICAL', 'ITEMS_OVERDUE', `${overdue.length} hạng mục quá hạn chưa hoàn thành`, overdue.slice(0, 3).map(i => `${i.name} (hạn ${fmtVN(i.end_date)}, đạt ${i.actual_percent}%)`).join('; '), 'progress'));
      if (late.length) alerts.push(alert('WARNING', 'ITEMS_LATE', `${late.length} hạng mục chậm so với kế hoạch`, late.slice(0, 3).map(i => `${i.name} (KH ${i.planned_percent}% / TT ${i.actual_percent}%)`).join('; '), 'progress'));
      if (forecastEnd && contractEnd && forecastEnd > contractEnd) {
        alerts.push(alert('CRITICAL', 'FORECAST_LATE', 'Dự báo hoàn thành trễ hạn hợp đồng', `Theo tốc độ hiện tại (SPI ${s.spi}) dự kiến xong ${fmtVN(forecastEnd)}, hạn ${fmtVN(contractEnd)} (trễ ${daysBetween(contractEnd, forecastEnd)} ngày).`, 'progress'));
      }
      const staleDays = lastActual ? daysBetween(lastActual, asOf) : null;
      if (staleDays === null) alerts.push(alert('WARNING', 'PROGRESS_STALE', 'Chưa cập nhật % thực tế lần nào', 'Cập nhật thực tế theo hạng mục (hoặc trong báo cáo tuần) để so sánh với kế hoạch.', 'progress'));
      else if (staleDays > THRESHOLDS.staleCritDays) alerts.push(alert('CRITICAL', 'PROGRESS_STALE', `${staleDays} ngày chưa cập nhật tiến độ thực tế`, `Lần cập nhật gần nhất ${fmtVN(lastActual)}.`, 'progress'));
      else if (staleDays > THRESHOLDS.staleWarnDays) alerts.push(alert('WARNING', 'PROGRESS_STALE', `${staleDays} ngày chưa cập nhật tiến độ thực tế`, `Lần cập nhật gần nhất ${fmtVN(lastActual)}.`, 'progress'));
      if (lookahead.length) alerts.push(alert('INFO', 'LOOKAHEAD', `${lookahead.length} hạng mục bắt đầu trong ${THRESHOLDS.lookaheadDays} ngày tới`, lookahead.slice(0, 4).map(i => `${i.name} (${fmtVN(i.start_date)})`).join('; '), 'progress'));
    }
    if (contractEnd && s.actual_percent < THRESHOLDS.endSoonMinActual) {
      const left = daysBetween(asOf, contractEnd);
      if (left < 0) alerts.push(alert('CRITICAL', 'CONTRACT_OVERDUE', 'Đã quá hạn hợp đồng', `Hạn ${fmtVN(contractEnd)} (quá ${-left} ngày), thực tế mới ${s.actual_percent}%.`, 'progress'));
      else if (left <= THRESHOLDS.endSoonDays) alerts.push(alert('WARNING', 'CONTRACT_END_SOON', `Còn ${left} ngày tới hạn hợp đồng`, `Thực tế ${s.actual_percent}% (< ${THRESHOLDS.endSoonMinActual}%).`, 'progress'));
    }
  }

  // ---- 2. Nhật ký hằng ngày (Thứ Hai–Thứ Bảy trong 7 ngày trước ngày asOf) ----
  const from = addDays(asOf, -THRESHOLDS.logWindowDays), to = addDays(asOf, -1);
  // Chỉ tính báo cáo đã gửi trở đi: bản nháp chỉ người lập thấy, chưa gửi thì vẫn là "thiếu" (người dùng chốt 04/10).
  const logDays = new Set((await pool.query(`SELECT DISTINCT TO_CHAR(log_date,'YYYY-MM-DD') AS d FROM daily_logs
    WHERE project_id = $1 AND log_date BETWEEN $2 AND $3 AND status <> 'DRAFT'`, [project.id, from, to])).rows.map(r => r.d));
  const lastLog = (await pool.query(`SELECT TO_CHAR(MAX(log_date),'YYYY-MM-DD') AS d FROM daily_logs WHERE project_id = $1 AND log_date <= $2 AND status <> 'DRAFT'`, [project.id, asOf])).rows[0]?.d || null;
  const projectStart = project.start_date ? String(project.start_date).slice(0, 10) : (out.plan?.start || null);
  const missing = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (new Date(d + 'T00:00:00Z').getUTCDay() === 0) continue; // Chủ nhật
    if (projectStart && d < projectStart) continue;
    if (!logDays.has(d)) missing.push(d);
  }
  out.logs = { last_date: lastLog, missing_days: started ? missing : [] };
  if (started && missing.length >= THRESHOLDS.logMissWarn) {
    alerts.push(alert(missing.length >= THRESHOLDS.logMissCrit ? 'CRITICAL' : 'WARNING', 'LOGS_MISSING', `${missing.length} ngày thiếu báo cáo ngày trong ${THRESHOLDS.logWindowDays} ngày qua`, 'Ngày: ' + missing.map(fmtVN).join(', ') + (lastLog ? ` · báo cáo ngày gần nhất ${fmtVN(lastLog)}` : ' · chưa có báo cáo ngày nào'), 'daily'));
  }

  // ---- 3. Chờ duyệt quá hạn (chỉ đánh giá theo thời điểm hiện tại) ----
  if (live) {
    const pend = (await pool.query(`
      SELECT COUNT(*)::int AS n, MIN(submitted_at) AS oldest FROM (
        SELECT submitted_at FROM documents WHERE project_id = $1 AND status = 'SUBMITTED'
        UNION ALL SELECT submitted_at FROM daily_logs WHERE project_id = $1 AND status = 'SUBMITTED') x`, [project.id])).rows[0];
    const oldestDays = pend.oldest ? Math.floor((Date.now() - new Date(pend.oldest).getTime()) / DAY) : 0;
    out.approvals = { pending: pend.n, oldest_days: oldestDays };
    if (pend.n && oldestDays > THRESHOLDS.approvalWarnDays) {
      alerts.push(alert(oldestDays > THRESHOLDS.approvalCritDays ? 'CRITICAL' : 'WARNING', 'APPROVAL_AGING', `${pend.n} bản chờ duyệt, lâu nhất ${oldestDays} ngày`, 'Báo cáo/hồ sơ/báo cáo ngày đã gửi nhưng Trưởng TVGS chưa xử lý.', 'inbox'));
    }
  }

  // ---- 4. Vấn đề chất lượng quá hạn xử lý ----
  const iss = (await pool.query(`
    SELECT COUNT(*) FILTER (WHERE open)::int AS open, COUNT(*) FILTER (WHERE open AND due_date IS NOT NULL AND due_date < $2)::int AS overdue
    FROM (SELECT due_date, (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <= $2
            AND (resolved_at IS NULL OR (resolved_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date > $2)
            AND upper(COALESCE(status,'')) NOT IN ('CLOSED','SIGNED','ISSUED') AS open
          FROM issues WHERE project_id = $1) x`, [project.id, asOf])).rows[0];
  out.issues = iss;
  if (iss.overdue) alerts.push(alert('CRITICAL', 'ISSUES_OVERDUE', `${iss.overdue} vấn đề chất lượng quá hạn xử lý`, `Đang mở ${iss.open} vấn đề.`, 'issues'));

  // ---- 6. Mỗi công trình phải có một TVGS trưởng (theo chức danh tại công trình) ----
  if (live) {
    const titles = (await pool.query(`SELECT assignment_title FROM project_personnel WHERE project_id = $1 AND status = 'ACTIVE'
      UNION ALL SELECT assignment_title FROM project_members WHERE project_id = $1 AND status = 'ACTIVE'`, [project.id])).rows;
    if (!titles.some(r => isLeadTitle(r.assignment_title))) {
      alerts.push(alert('WARNING', 'NO_LEAD', 'Chưa có TVGS trưởng', 'Bản gửi duyệt sẽ chuyển về Giám đốc/Admin. Phân công TVGS trưởng ở trang Nhân sự.', 'people'));
    }
  }

  // ---- 5. Báo cáo định kỳ chưa lập (tuần trước sau Thứ Ba; tháng trước sau ngày 5) ----
  if (started) {
    const dow = (new Date(asOf + 'T00:00:00Z').getUTCDay() + 6) % 7; // Thứ Hai = 0
    const lastMon = addDays(asOf, -dow - 7);
    const [y, m] = asOf.split('-').map(Number);
    const lastMonthStart = iso(new Date(Date.UTC(y, m - 2, 1)));
    const rep = (await pool.query(`SELECT details->>'reportType' AS t, details->>'from' AS f FROM documents
      WHERE project_id = $1 AND doc_group = 'REPORT' AND details->>'reportType' IN ('WEEKLY','MONTHLY')`, [project.id])).rows;
    const hasWeek = rep.some(r => r.t === 'WEEKLY' && r.f === lastMon);
    const hasMonth = rep.some(r => r.t === 'MONTHLY' && String(r.f || '').slice(0, 7) === lastMonthStart.slice(0, 7));
    out.reports = { last_week_from: lastMon, weekly_done: hasWeek, last_month: lastMonthStart.slice(0, 7), monthly_done: hasMonth };
    const needWeek = dow >= 2 && (!projectStart || addDays(lastMon, 6) >= projectStart);
    const needMonth = Number(asOf.slice(8, 10)) > 5 && (!projectStart || addDays(asOf.slice(0, 8) + '01', -1) >= projectStart);
    if (needWeek && !hasWeek) alerts.push(alert('WARNING', 'WEEKLY_REPORT_MISSING', 'Chưa lập báo cáo tuần trước', `Tuần ${fmtVN(lastMon)} – ${fmtVN(addDays(lastMon, 6))}.`, 'reports'));
    if (needMonth && !hasMonth) alerts.push(alert('WARNING', 'MONTHLY_REPORT_MISSING', 'Chưa lập báo cáo tháng trước', `Tháng ${lastMonthStart.slice(5, 7)}/${lastMonthStart.slice(0, 4)}.`, 'reports'));
  }

  const order = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  alerts.sort((a, b) => order[a.severity] - order[b.severity]);
  out.alerts = alerts;
  out.health = alerts.some(a => a.severity === 'CRITICAL') ? 'RED' : alerts.some(a => a.severity === 'WARNING') ? 'AMBER' : 'GREEN';
  return out;
}

// Danh mục công trình người dùng được xem (Admin/Giám đốc: tất cả; người khác: công trình được phân công)
async function portfolio(projects) {
  const rows = [];
  for (const p of projects) {
    try { rows.push(await projectHealth(p)); }
    catch (e) { rows.push({ id: p.id, code: p.project_code || p.contract_no, name: p.name, health: 'UNKNOWN', alerts: [alert('WARNING', 'ERROR', 'Không tính được tình trạng', e.message)] }); }
  }
  const rank = { RED: 0, AMBER: 1, UNKNOWN: 2, GREEN: 3, PAUSED: 4, DONE: 5 };
  rows.sort((a, b) => (rank[a.health] ?? 9) - (rank[b.health] ?? 9) || String(a.code).localeCompare(String(b.code)));
  const count = h => rows.filter(r => r.health === h).length;
  const all = rows.flatMap(r => r.alerts || []);
  return {
    as_of: todayVN(), thresholds: THRESHOLDS, projects: rows,
    summary: { projects: rows.length, red: count('RED'), amber: count('AMBER'), green: count('GREEN'), done: count('DONE'), paused: count('PAUSED'),
      critical: all.filter(a => a.severity === 'CRITICAL').length, warning: all.filter(a => a.severity === 'WARNING').length }
  };
}

module.exports = { THRESHOLDS, projectHealth, portfolio, todayVN };
