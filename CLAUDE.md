# VINA-SUPERVISION MVP-04 — project guide for Claude

Bản này là **bản sao riêng của MVP-03** (fork ngày 09/10/2026) để sửa lỗi mà không đụng vào MVP-03 đang chạy thật qua Tailscale. Cổng và tên CSDL đã đổi khác MVP-03 để chạy song song không tranh nhau: backend `3003` (MVP-03 là `3002`), giao diện `8082` (MVP-03 `8081`), PostgreSQL cổng máy `5434` (MVP-03 `5433`), DB `vina_supervision_mvp04` (MVP-03 `vina_supervision`). Xem `README.md` của MVP-03 nếu cần đối chiếu bản gốc.

**Bắt đầu phiên mới ở đây: đọc `SESSION-HANDOFF-20261012.md` trước tiên** (không cần đọc lại lịch sử hội thoại cũ) — có đủ: việc đã xong, việc chưa xong, tài khoản thử. **Dùng `http://localhost:3003/` để kiểm thử, không dùng 8082** — 3003 phục vụ trực tiếp từ thư mục gốc (luôn mới, không qua `web-public`/không bị cache); 8082 (python server + `web-public/`) từng có lỗi chép tệp + bị trình duyệt cache dai dẳng (xem SESSION-HANDOFF mục "web-public").

Construction-supervision (TVGS) management app for a Vietnamese consulting firm. UI text is Vietnamese; the user writes Vietnamese — answer in Vietnamese, direct, with pushback.
**Do not re-read whole files.** Use this guide + `docs/CODEMAP.md`, then Grep for the function you need and Read only that range.

- Nút theo quyền (10/10/2026): `js/18-quyen-nut.js` cập nhật nút khi online/pageshow/visible/đổi công trình và HTTP 403; giữ modal, bản nhập và tệp chờ. `canManageAssignments` chỉ nhận `role_name` ADMIN/DIRECTOR; sửa công trình dùng `canEditProject(pid)`, không dùng `canEdit` cũ. Bảng đối chiếu API và file trước/sau: `docs/NUT-THEO-QUYEN-MVP05.md`; ca Chrome `17-permission-buttons.js`. Không đổi quyền máy chủ.
- Thanh điện thoại (build ứng viên 2026-10-10.2): dưới 900px chỉ 5 mục, Thêm gọi nút nav gốc; SVG nội tuyến index.html, logic trong `js/16-the-dien-thoai.js`. Thiết lập/Thùng rác theo quyền cũ; Audit chỉ là nhật ký trên thiết bị, chưa có API đọc nên ẩn trên điện thoại, không suy quyền máy chủ. Ca `18-mobile-navigation.js`, ảnh/log và giới hạn: `docs/THANH-DUOI-DIEN-THOAI-MVP05.md`. PC giữ bố cục cũ; không chạy launcher khi chỉ kiểm thử mã.

## Stack & layout
- Backend: Node 24 + Express 5 + PostgreSQL 14 (container lấy động bằng `docker compose ps -q postgres`, cổng máy `5434`, DB `vina_supervision_mvp04`, app user `vina_user`). Entry `backend/server.js` → `backend/src/app.js`.
  - `src/routes/*.js` (HTTP, auth/permission checks) → `src/services/*.js` (SQL). No ORM; raw `pool.query`.
  - `src/utils/db.js` (DATE type returned as 'YYYY-MM-DD' string), `src/utils/fileSafety.js` (serve uploads safely).
- Frontend: `index.html` (HTML + CSS + các thẻ `<script src>`, không còn JS nội tuyến) + **`js/01-core.js` … `js/14-dang-nhap.js`** (mỗi tệp một tính năng, ≤30 KB) + 7 tệp keo `js/*glue*|00-khoi-dong|03-font-fix` (mã chạy ngay lúc nạp — **vị trí trong thứ tự nạp là quan trọng**) + `api.js` (fetch wrapper, API→local mappers) + `sw.js`. Bảng "hàm nào ở tệp nào": `docs/CODEMAP.md`. **Mã mới đặt vào tệp tính năng tương ứng.** Thêm tệp `js/` mới → phải có cả thẻ `<script src>` trong `index.html` và tên trong `SHELL_FILES` của `sw.js` (`check-frontend.js` báo nếu thiếu). Served by backend at `/` (port 3003) and copied to `web-public/` by `run.bat` (port 8082). **Edit root files only**, never `web-public/`.
- Local state in `localStorage` (`db` object: projects, logs, docs, issues, sync queue); server is source of truth.
- Migrations: `migrations/YYYYMMDD_name.sql`, each wrapped in BEGIN/COMMIT, idempotent (`IF NOT EXISTS`). Applied by `migrate-db.ps1` as `postgres` (run.bat does it automatically with backup). Recorded in `schema_migrations`. Latest: `20261014_bidding_packages.sql` (check `migrations/` for anything newer — this list grows every feature).
- Base schema `schema-VINA-PROD-01.sql` is OLD; real schema = schema + all migrations.

## Every change checklist
1. Bump build in **3 places**: `backend/src/build.js` BUILD, `js/14-dang-nhap.js` `const APP_BUILD=`, `sw.js` SHELL_CACHE. (run.bat restarts backend when build differs; UI shows red banner if mismatched.)
2. New DB column/table → new migration file (never edit an applied one).
3. Add/adjust tests in `backend/tests/regression.test.js` (node:test, isolated DB, API on port 3101). Use dates relative to today (`vnToday()`, `shift()` helpers).
4. Run tests (see Testing). Syntax-check index.html inline scripts.
5. Append a short section to `CAP-NHAT-20260926.md` (user-facing changelog, Vietnamese) and `KET-QUA-KIEM-THU-20260926.md` (test results).
6. Tell the user to run `.\run.bat` + Ctrl+F5.

## Testing (shell output in this environment is unreliable → always write to a file, then Read/Grep it)
- **Nghiệm thu bằng MỘT lệnh**: `backend\scripts\kiem-tra-tat-ca.cmd` → chạy cú pháp giao diện + regression + giao diện (tuần tự) rồi ghi tóm tắt 3 dòng vào `backend\tests\last-summary.txt`. Đọc một tệp đó là biết đủ (~2 phút). Tên CSDL thử mặc định có phần ngẫu nhiên nên hai lượt chạy không tranh nhau.
- Di chuyển mã giữa các tệp `js/` → `node backend\scripts\check-split.js <commit-trước-khi-di-chuyển>` (thêm `--bytes` khi tách nguyên văn) để chứng minh không mất/không sửa đơn vị mã; `node --test backend/tests/jsUnits.test.js` kiểm chính bộ tách.
- Regression: `backend\scripts\run-regression.cmd [dbname]` → results in `backend\tests\last-regression.txt` (Grep `ℹ pass|ℹ fail|✖`). Takes ~2 min; poll the file. Use a unique db name (another tool may use `vina_regression`).
- Giao diện: `backend\scripts\run-ui-tests.cmd [dbname] [mẫu tên ca]` → `backend\tests\last-ui-test.txt` (playwright-core + Chrome của máy, cổng 3103, CSDL `vina_ui_claude`; ảnh lỗi ở `backend/tests/ui-artifacts/`). **Sửa `index.html`/`api.js` → chạy bộ này.** Mẫu tên ca là regex, không dùng dấu `|` (dùng `GD-0[67]`). Số ca và chi tiết selector đổi liên tục — xem danh sách hiện hành ở `docs/CODEMAP.md`, đừng tin số ca ghi cứng ở đây.
- Syntax: `node backend\scripts\check-frontend.js` (inline scripts + api.js + sw.js + build id match); `node --check <file>` for backend files.
- Launch long commands detached (`Start-Process cmd.exe -ArgumentList '/c', ... -WindowStyle Hidden`) and redirect to a file; the PowerShell tool gets killed on long sleeps — poll with Grep / short waits.
- UI check: start a 2nd backend on port 3102 pointed at the test DB (env PORT/DB_NAME/NODE_ENV=development, seed users log in with password `demo`), open in browser pane, drive via `javascript_exec`. Screenshots time out in this pane — inspect DOM text instead. Never type passwords into forms; fetch `/api/auth/login` from JS with test fixture creds.
- Real DB: **read-only** queries only; lấy đúng container của repo bằng `docker compose ps -q postgres` trước khi truy vấn. Never write to it; never restart the user's backend (port 3003).

## Domain rules (decided with the user — do not re-litigate)
- Legal basis: Nghị định **207/2026/NĐ-CP** (effective 01/07/2026) replaced 06/2021.
- Roles (global): ADMIN, DIRECTOR (= "quản trị", company level, all projects), MANAGER, TVGS_LEAD, ENGINEER.
- **Per-project permissions** (`permissionService.js`): VIEW, CREATE, EDIT, DOWNLOAD, APPROVE, DELETE. Admin/Director = all. Others: custom list per assignment (`project_member_access`) or default by **title at that project**: title "TVGS trưởng"-like (`isLeadTitle`) → VIEW/CREATE/EDIT/DOWNLOAD/APPROVE; other titles → VIEW/CREATE/DOWNLOAD; MANAGER → VIEW/DOWNLOAD. DELETE never by default. Frontend mirror: `defaultPermsFor`, `LEAD_DEFAULT_PERMS` in index.html — keep in sync.
- One person may work on many projects with different titles. Title source: `project_personnel.assignment_title` (preferred) else `project_members.assignment_title`.
- **Báo cáo ngày nháp là của riêng người lập** (người dùng chốt 04/10/2026): chỉ người lập thấy/sửa/gửi bản DRAFT; TVGS trưởng và thành viên khác chỉ thấy từ khi đã gửi (SUBMITTED trở đi). Admin/Giám đốc thấy hết. Áp ở máy chủ (`getDailyLogsByProject`, middleware `/:id` trong `routes/dailyLogs.js`, `transition`, `reportService.compile`) và giao diện (`canSeeLog`, `canSubmitLog`, đồng bộ bỏ bản máy chủ không còn trả về). TVGS trưởng: nút "Duyệt tất cả" = Xác nhận nháp của mình + Duyệt bản thành viên đã gửi. Cảnh báo "thiếu báo cáo ngày" (`portfolioService`) chỉ tính bản đã gửi trở đi — ngày chỉ có nháp vẫn là thiếu (chốt 04/10).
- Approval workflow (reports, documents, daily logs): DRAFT→SUBMITTED→APPROVED→LOCKED. Lead (APPROVE at project) decides: approve / reject (comment required) / **escalate to company** (comment required; then only Admin/Director decide). Notes in `review_notes`. Inbox `/api/reviews/inbox`; "Việc cần duyệt" nav only for users with APPROVE somewhere or Admin/Director.
- "Nhật ký" đã đổi tên hiển thị thành **"Báo cáo ngày"** (01/10/2026, theo NĐ 207/2026 — không còn bắt buộc lập nhật ký riêng). Cơ chế/bảng `daily_logs`/hàm `openLog` giữ nguyên, chỉ đổi chữ hiển thị — xem `CAP-NHAT-20260926.md` Đợt 24. Mục nav "Báo cáo ngày" + "Báo cáo" đã gộp thành một mục **"Báo cáo"** có 2 tab con (Đợt 26).
- **Gói thầu** (tùy chọn): một công trình có thể có nhiều gói thầu, mỗi gói nhiều nhà thầu, mỗi nhà thầu một số hạng mục (`bidding_packages`/`bidding_package_contractors`, migration `20261014_bidding_packages.sql`). Khi đã khai báo, phân công nhân sự bắt buộc chọn gói; lập báo cáo ngày dùng dropdown xếp tầng theo gói đã gán.
- `canEditProject(pid)` (sửa công trình/bảng tiến độ) xét theo quyền Duyệt **tại đúng công trình đang xem** (`canApproveIn(pid)`), không theo loại tài khoản chung — một người làm nhiều công trình với chức danh khác nhau sẽ thấy nút Sửa đúng/sai theo từng công trình, không bị lẫn (Đợt 26).
- Non-DRAFT documents/logs: only Admin/Director can edit (UPDATE_LOCKED audited).
- Delete = **recycle bin** (`recycleService.js`, table `deleted_records`, JSONB snapshot of row + children), reason required, restore possible; purge only ADMIN (keeps trace row).
- New accounts / admin password reset → `must_change_password` (server blocks all but change-password). Usernames are admin-chosen (`USERNAME_RE`), login is case-insensitive.
- Account full_name vs personnel name mismatch → warning chip; "Đúng người" can freeze old author name on past records (`author_name` columns on daily_logs/documents/issues; queries use `COALESCE(x.author_name, u.full_name)`).
- Portfolio/alerts: `portfolioService.js` (THRESHOLDS object; EVM SPI, overdue items, stale actuals, missing logs Mon–Sat, approval aging, overdue issues, missing weekly/monthly report). Members see only assigned projects (`projectService.getAllProjects`).
- Reports: `reportService.compile` snapshots data into the document `details.snapshot` at save; progress compared as-of min(period end, today); weekly/monthly editor can write actuals to the schedule.
- File uploads are stored in PostgreSQL bytea (documents, daily_log_files) and on disk `backend/uploads` (photos). Serve only via `sendStoredFile` (inline only PDF/PNG/JPEG/WebP/GIF) — stored XSS was fixed this way.

## Conventions
- Frontend: always `esc()` user data in HTML strings; inline onclick args pass ids only. Vietnamese labels. Functions are long one-liners — edit with exact-string Edit, re-grep after edits.
- Backend errors: `httpError(status, msg)` pattern; routes return Vietnamese `{error}` messages; 409 for state conflicts.
- Audit: `req.audit(entity, id, action, before, after, userId)` on every write.
- Time: Vietnam = UTC+7 (`todayVN()` helpers); DATE columns are strings.

## Working agreements (user decisions 2026-09-28)
- Primarily Claude Code edits this folder; a Codex plugin (`plugins/vicoad/`) is kept for occasional Codex CLI use too (user's choice, 01/10/2026) — if a file changed unexpectedly, say so instead of silently overwriting rather than assuming it's stray.
- One feature per session; keep this file and `docs/CODEMAP.md` updated when adding files/functions/rules (that is what makes new sessions cheap).
- Model: Sonnet for routine edits; Opus for permission/workflow design, migrations on real data, security, large refactors.
- Git (local only, no remote): `C:\Program Files\Git\cmd\git.exe` (may not be on PATH in the tool shell — use full path). Repo initialized 2026-09-28, first commit `a1546c1` = build 2026-10-06.1. `core.autocrlf=false`. Start a session with `git log --oneline -n 10` + `git status --short` to see what changed since last time (incl. user's own edits); use `git diff` instead of re-reading files. **Commit after each verified change** (message in Vietnamese: what + why + build id). Before committing, confirm no secret is staged (`.env`, `Token*.txt`, `Pas user.xlsx`, backups, uploads are ignored).
- Bộ kiểm thử giao diện: 16 ca + 2 ca chống xanh giả (`backend/tests/ui/`, xong 28/09/2026) — lưới an toàn của mọi thay đổi giao diện.
- Đợt tách `index.html` đã xong (29/09/2026): 14 tệp tính năng + 7 tệp keo trong `js/`, chứng minh bằng `check-split.js` (khớp tập đơn vị mã) và 17/17 ca giao diện.
- Next planned big task: chưa chốt — xem mục "Việc lớn người dùng vừa yêu cầu" trong `SESSION-HANDOFF-20261012.md` (giao diện theo vai trò tại từng công trình cần hỏi thêm; bộ tình huống kiểm thử đầy đủ mọi vai trò).

## Known issues / hazards
- `JWT_SECRET` in `backend/.env` — status not re-verified for MVP-04 specifically this round; check before assuming it's a real random value. `Token eyJ….txt` and `Pas user.xlsx` in root contain secrets — do not open, do not publish, never commit.
- `web-public/` is a generated copy (synced by `run.bat`/`start-dev.ps1`) — never edit directly.
- Real data quirk: account `nthanhb` (formerly `hung`) and `dvhung` (email khanh@) — see `CAP-NHAT` Đợt 11.
- `packaging/` (installer cho máy cố định/di động, dùng để triển khai thử thực địa) và `plugins/vicoad/` (bộ skill cho Codex CLI, tài liệu thuần — không chạy code/DB) tồn tại có chủ đích trong repo, không phải rác.
