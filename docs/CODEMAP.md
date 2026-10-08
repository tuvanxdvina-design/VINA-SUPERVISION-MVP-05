# CODEMAP — where things are (read this instead of whole files)

## MVP-05 build 2026-10-07.2 — B3/C3
- `js/11-duyet.js`: `openReviewDecision` tải chi tiết API trước quyết định; `reviewDecisionContext` giữ bản chỉ xem riêng, `showReviewLogFiles`/`showReviewPhotos`/`viewReviewDocument` xem tệp và toàn văn khi không có bản cục bộ. `reviewDecisionLoad` bỏ phản hồi đến muộn.
- `js/01-core.js`: `showLogFiles`/`showLogPhotos` nhận bản đã tải để mở tệp/ảnh từ hộp duyệt. `js/06-ho-so.js`/`07-bao-cao.js`: `viewDoc`/`viewReport` nhận bản chỉ xem riêng, không ghi đè nháp.
- `js/09-nhan-su.js` ghi `tmProjectId`; `js/10-tai-khoan.js` chỉ loại tài khoản đã liên kết trong công trình đang sửa, cho phép phân công nhiều công trình.
- `backend/tests/ui/cases/15-review-and-multi-project.js`: sáu ca GD-B3/GD-C3; mô tả và thao tác nghiệm thu: `docs/KHAC-PHUC-B3-C3-MVP05.md`.

Line numbers drift; locate with `Grep "function <name>" index.html -n`, then Read ~30 lines around it.

## Backend (backend/src)
| Feature | Route file | Service file | Tables |
|---|---|---|---|
| Auth, login lockout, must-change-password | routes/auth.js, middleware/auth.js | services/userService.js | users |
| Users/accounts (create, rename, reset pw, usage, freeze author) | routes/users.js | services/userService.js | users |
| Per-project permissions | — | services/permissionService.js (ALL, effective, isLeadTitle, forUser, allForUser, approverProjectIds, canApprove, requirePermission) | project_members, project_member_access, project_personnel |
| Project access guard | middleware/projectAccess.js (query/body/projectParam/record) | — | project_members |
| Projects + progress plans (Excel parse, actuals) | routes/projectRoutes.js | services/projectService.js, projectProgressService.js, scheduleParser.js, xlsxReader.js | projects, project_progress_plans, project_schedule_items, project_schedule_actuals |
| Personnel/team, link accounts | routes/projectPersonnel.js, routes/projectMembers.js | services/projectPersonnelService.js, projectMemberService.js | project_personnel, project_members |
| Daily logs (workflow, files, photos, bulk, delete) | routes/dailyLogs.js | services/dailyLogService.js, attachmentService.js | daily_logs, daily_log_files, attachments |
| Documents & reports (workflow, files, delete) | routes/documents.js | services/documentService.js | documents, document_files, document_sequences |
| Quality issues | routes/issues.js | services/issueService.js | issues |
| Review notes, inbox, escalate | routes/reviews.js (+ workflow in dailyLogs/documents) | services/reviewService.js | review_notes |
| Report compile, portfolio, health/alerts | routes/reports.js | services/reportService.js, portfolioService.js (THRESHOLDS) | (reads all) |
| Recycle bin | routes/recycleBin.js | services/recycleService.js (SPEC per entity) | deleted_records |
| Safe file serving | — | utils/fileSafety.js | — |

App wiring & health (build, pending migrations, security warnings): `src/app.js`. Build id: `src/build.js`.

## Frontend — `index.html` + `js/*.js`

`index.html` chỉ còn HTML + CSS + các thẻ `<script src>`. **Thứ tự nạp = thứ tự các thẻ ở cuối `index.html`**; tiền tố số trong tên tệp cho biết vị trí. Mã mới đặt vào **tệp tính năng tương ứng** (không còn khối `<script>` nội tuyến nào).

| Tệp `js/` | KB | Nội dung |
|---|---|---|
| `01-core.js` | 30 | `db`, `save`, `persistLocal`, `queueSync`, `audit`, `esc`, `fmt`, `todayIso`, `openModal`/`closeModal`, `goPage`, `renderAll`, `updateNet`, `statusBadge` + `STATUS_LABELS` (mã trạng thái thô → chữ Việt) và các hàm dùng chung khác |
| `02-quyen.js` | 8 | Bản sao quyền phía client: `myPerms`, `canApproveIn`, `canDeleteIn`, `deleteBtn`, `docCanDecide`, `canModifyDoc`, `canManageAssignments`, `defaultPermsFor`, `LEAD_DEFAULT_PERMS`, `isLeadTitle`, `PERM_LABELS`, `roleToken` |
| `03-cong-trinh.js` | 17 | `renderProjects`, `projectRows`, `openProject`, `saveProject`, `openProjectDetail`, `renderProjectDetail`, `serverProjects` |
| `04-tien-do.js` | 29 | Bảng tiến độ: `loadProjectProgressPlans`, `renderProjectProgress`, `sCurveSvg`, `openProgressPlan`, `saveProgressPlan`, `openProgressActuals`, `ITEM_STATUS`, `statusChip` |
| `05-nhat-ky.js` | 12 | `renderLogs`, `logActionsHtml`, `logAction`, `logBulk`, `canSeeLog` (ở `02-quyen.js`: nháp người khác không hiện), `logBulkLead` (ở `01-core.js`: TVGS trưởng Xác nhận nháp của mình + Duyệt bản thành viên đã gửi), `openLog`, `saveLog`, `showLogFiles`/`showLogPhotos`, `exportDailyLog`, `LOG_STATUS`, `SHIFT_OPTIONS` |
| `06-ho-so.js` | 17 | `renderDocs`, `viewDoc`, `openDoc`, `saveDoc`, `docWorkflow`, `docFileLinks`, `openServerFile`, `DOC_STATUS`, `DOC_TYPES` |
| `07-bao-cao.js` | 20 | `renderReports`, `openReport`, `compileReport`, `renderReportEditor`, `saveReport`, `reportBodyHtml`, `collectReportActuals`, `viewReport`, `printReport`, `periodInputsHtml` |
| `08-chat-luong.js` | 24 | `renderIssues`, `openIssue`, `saveQualityDocument`, `viewIssue`, `printQualityDocument`, `qualityLetterhead` |
| `09-nhan-su.js` | 27 | `loadProjectTeamDirectory`, `fetchTeam`, `teamTableHtml`, `openTeamMember`, `saveTeamMember`, `permEditorHtml`/`readPermEditor`/`refreshPermDefaults`, `TITLE_OPTIONS`, `loadSettingsTeam`/`loadSettingsProjects` |
| `10-tai-khoan.js` | 15 | Tài khoản của nhân sự: `accountCell`, `onTeamAccountChange`, `usernameSuggestions`, `showRenameUsername`, `openAccountFix`, `confirmAccountOwner`, `resetTeamPassword`, `showAccountSlip`, `randomPassword` |
| `11-duyet.js` | 14 | `openReviewDecision`, `submitReviewDecision`, `reviewBlockHtml`, `returnedChip`, `loadReviewHistory`, `loadInbox`, `renderInbox`, `updateInboxBadge`, `isReviewer`, `REVIEW_ACTION` |
| `12-thung-rac.js` | 7 | `deleteContent`, `confirmDeleteContent`, `loadTrash`, `renderTrash`, `restoreTrash`, `purgeTrash`, `DELETE_API` |
| `13-tong-quan.js` | 11 | `loadPortfolio`, `renderPortfolio`, `loadProjectHealth`, `goAlertTarget`, `alertItemHtml`, `healthChip`, `pctBar`, `SEV_LABEL`, `renderDashboard` |
| `14-dang-nhap.js` | 5 | Đăng nhập/đăng xuất, `openChangePassword`, `forcePasswordChange`, `checkServerMigrations`, `APP_BUILD` |
| `16-the-dien-thoai.js` | 3 | Bảng → thẻ trên điện thoại: `cardifyTable`/`cardifyAll`, danh sách khung `MCARD_CONTAINERS` (thêm id khung bảng mới vào đây), MutationObserver tự chạy lại; CSS `table.mcards` trong `index.html` (@media ≤600px). Nạp cuối cùng. |
| `00-khoi-dong.js`, `02-glue-sau-api.js`, `03-font-fix.js`, `05-glue-cuoi.js`, `glue-1-core.js`, `glue-4-tinh-nang-2.js`, `glue-6-tinh-nang-3.js` | 1–4 mỗi tệp | **Tệp keo**: các câu lệnh chạy ngay lúc nạp (gắn sự kiện nav, `renderAll()`, `applyInboxNavVisibility()`, đăng ký service worker, `window.addEventListener('load'…)`). Vị trí của chúng trong thứ tự nạp là **quan trọng** — đừng gộp vào tệp tính năng. |

Thêm tệp `js/` mới thì phải có **cả** thẻ `<script src>` trong `index.html` **và** tên trong `SHELL_FILES` của `sw.js`; `node backend\scripts\check-frontend.js` sẽ báo nếu thiếu. Khi di chuyển mã giữa các tệp, chạy `node backend\scripts\check-split.js <commit-trước-khi-di-chuyển>` để chứng minh không mất/không sửa đơn vị mã nào.

## Nhóm hàm (chi tiết theo nghiệp vụ)
- **Core/state**: `db` object, `persistLocal`, `save`, `queueSync`, `mergeProjectsFromServer`, `audit`, `esc`, `fmt`, `progressDate`, `todayIso`, `openModal`/`closeModal`, `goPage`, `renderAll`, nav click binding (`nav button` onclick ~ after `updateNet`).
- **Permissions (client mirror)**: `qualityPermissions`, `loadQualityPermissions` (GET /project-members/my-permissions), `myPerms`, `canApproveIn`, `canDeleteIn`, `deleteBtn`, `docCanDecide`, `canCreateDocIn`, `canModifyDoc`, `canManageAssignments` (Admin/Director), `canEditProject`, `isLogLead(pid)`.
- **Dashboard/portfolio/alerts**: `loadPortfolio`, `renderPortfolio`, `loadProjectHealth` (#pdHealth), `goAlertTarget`, `healthChip`, `pctBar`; legacy `renderDashboard` (local stats, inside <details>).
- **Projects**: `renderProjects`, `projectRows`, `openProject`, `saveProject`, `openProjectDetail`, `renderProjectDetail`.
- **Progress schedule**: `loadProjectProgressPlans`, `renderProjectProgress`, `sCurveSvg`, `openProgressPlan` (editor), `saveProgressPlan`, `deleteProgressPlan`, `openProgressActuals`, `saveProgressActuals`, `ITEM_STATUS`.
- **Daily logs**: `renderLogs`, `logActionsHtml`, `logAction` (→ `openReviewDecision` for approve/reject), `logBulk`, `openLog`, `saveLog`, `showLogFiles`, `showLogPhotos`, `exportDailyLog`; server sync `syncDailyLogsFromApi` (+ api.js `syncDailyLogs*`).
- **Quality issues**: `renderIssues`, `openIssue`, `saveQualityDocument`, `viewIssue`, `printQualityDocument`, `qualityLetterhead`.
- **Documents**: `renderDocs`, `viewDoc`, `openDoc`, `saveDoc`, `docWorkflow`, `docFileLinks`, `openServerFile`/`safeFileBlob`, `syncDocumentsFromApi`, legacy local docs `syncLegacyLocalDocs`.
- **Reports**: `renderReports`, `openReport`, `compileReport`, `renderReportEditor`, `saveReport` (writes manual actuals first), `reportBodyHtml` (+ `reportItemsTableHtml`, `reportAlertsHtml`), `reportProgressInputHtml`, `collectReportActuals`, `viewReport`, `printReport`.
- **Personnel/accounts**: `loadProjectTeamDirectory`, `fetchTeam`, `teamTableHtml`, `accountCell` (mismatch chip), `openTeamMember` (modal), `onTeamAccountChange`, `permEditorHtml`/`readPermEditor`/`refreshPermDefaults`, `defaultPermsFor`, `saveTeamMember`, `usernameSuggestions`/`checkUsernameInput`, `showRenameUsername`/`saveRenameUsername`, `openAccountFix`/`confirmAccountOwner`, `resetTeamPassword`, `showAccountSlip`, settings page `loadSettingsProjects`/`loadSettingsTeam`. Thêm mới (01/10): `onTeamNameInput` + `window.__tmNameSuggestions` (gợi ý tên nhân sự đã có ở công trình khác, nạp từ `GET /api/project-personnel/search` → `projectPersonnelService.searchNames()`); `loadPersonnelFiles`/`deletePersonnelFile`/`uploadPersonnelCertificate` (nhiều tệp chứng chỉ, xóa từng tệp qua `DELETE /api/project-personnel/:id/files/:fileId` → `service.removeFile()`).
- **Review/inbox**: `openReviewDecision`, `submitReviewDecision`, `reviewBlockHtml`, `returnedChip`, `loadReviewHistory`, `loadInbox`, `renderInbox`, `updateInboxBadge`, `isReviewer`, `applyInboxNavVisibility`.
- **Recycle bin**: `deleteContent`, `confirmDeleteContent`, `loadTrash`, `renderTrash`, `restoreTrash`, `purgeTrash`, `applyTrashNavVisibility`.
- **Auth UI**: login `vinaDoLogin`, `openChangePassword`, `forcePasswordChange`, `checkServerMigrations` (build/migration/secret banners, `APP_BUILD`).

Newer features live in the LAST `<script>` block (after the font-fix MutationObserver script). Put new feature code there; hook into older code with small edits.

## api.js
`apiRequest` (401 → logout; 403 MUST_CHANGE_PASSWORD → forcePasswordChange), mappers `mapProjectFromApi`, `mapDailyLogFromApi` (lastReview, fileCount…), `mapDocumentFromApi`, sync of offline queue.

## Tests
`backend/tests/lib/testDb.js` — `createTestDb(dbUrl)` → `{ psql, psqlFile, setupAll, startServer({port}), waitHealth(base), dbName, ROOT }`. Dựng CSDL thử (schema gốc + migration cũ + dữ liệu lỗi giống thực tế + migration mới) và chạy backend. Dùng chung cho regression và bộ giao diện — sửa ở đây là sửa cho cả hai.

`backend/tests/ui/` — kiểm thử giao diện bằng `playwright-core` (Chrome cài trên máy, `channel:'chrome'`), backend cổng **3103**, CSDL `vina_ui_claude`. Một tiến trình: `all.test.js` gọi `test.before(startApp)` rồi `require` từng module trong `cases/`. Helper `ui/helpers.js`: `uiTest(name, fn)` (context mới mỗi ca, chặn service worker, tự nhận `alert`/`confirm` vào `page.__dialogs`, chụp ảnh + văn bản trang vào `backend/tests/ui-artifacts/` khi lỗi), `loginViaApi` (nạp phiên bằng `addInitScript` **trước** khi trang chạy script — gọi lại để đổi tài khoản), `loginViaForm`, `openPage`, `navVisible`, `apiAs(token)`, `tokenOf(who)`, `projectIdByContract(token, '001')`.
Chạy: `backend\scripts\run-ui-tests.cmd [db] [mẫu tên ca]` → `backend\tests\last-ui-test.txt`. Mẫu tên ca là regex, **không dùng dấu `|`** (qua PowerShell/cmd sẽ vỡ) — dùng `GD-0[67]`.
Các ca: GD-01 đăng nhập · GD-02 buộc đổi mật khẩu ban đầu · GD-03 nav theo vai trò · GD-04 phạm vi công trình · GD-05 tổng quan + bấm cảnh báo · GD-06 lập/gửi nhật ký · GD-07 duyệt qua "Việc cần duyệt" · GD-08 trả lại cần ý kiến · GD-09 khóa sửa sau duyệt · GD-10 luồng hồ sơ + mã tự sinh · GD-11 quyền mặc định theo chức danh · GD-12/GD-12b thùng rác · HZ-01/HZ-02 chống "xanh giả" (trạng thái sạch, hộp thoại được xử lý).
Selector hay dùng: `#loginScreen/#loginUsername/#loginPassword/#loginButton/#loginError`; `nav button[data-page="…"]` (inbox/trash mặc định `display:none` → luôn dùng `isVisible()`, không dùng `count()`); `#modal.show`/`#mtitle`/`#mbody`; nhật ký `#newLogButton`, `#logsTable`, modal `#lproj #ldate #lshift #lwork`; hồ sơ `#docsTable`, `+ Tạo hồ sơ`, `#dname`, `#docSaveBtn`, nút luồng nằm trong modal **Xem**; duyệt `#rvComment` + `.primary` = Phê duyệt, `.danger` = Yêu cầu chỉnh sửa; xóa `#delReason` + `.danger` + `#delMsg`; nhân sự `#tmTitle` (select), `.tmPerm`, `#tmDefaultsText` (chỉ hiện với người đã liên kết tài khoản); thùng rác `#trashBody`, nút "Khôi phục"/"Xóa vĩnh viễn".
**01/10 (bản 2026-10-14.3):** nav không còn nút riêng `data-page="daily"` — "Báo cáo ngày" đã gộp vào trang `#reports` (nút nav chung `data-page="reports"`), chuyển qua lại bằng 2 nút `.report-hub-tab[data-tab="daily"|"reports"]` trong trang. `openPage(page,'daily')`/`navVisible(page,'daily')` ở `helpers.js` đã tự chuyển hướng qua nút "reports" + tab, các ca gọi `openPage(page,'daily')` không cần sửa gì thêm.

`backend/scripts/ui-ctx.js` — in ~240 ký tự quanh một chuỗi trong `index.html` (đọc markup thật mà không mở cả file 270 KB): `node backend/scripts/ui-ctx.js "goAlertTarget(" "#delReason"`.

`backend/tests/regression.test.js` — one file, ordered tests sharing state (`P` = project ids by contract_no '001','002','003'; tokens: admin, thanhb (engineer, GS viên @001), hung (lead @001), son, tuan (unassigned), duong (director)). Append new tests at the end.
`backend/tests/smoke-test.js` — against the live server (read-only unless --write).
# Việc 5 — màn hình đối chiếu bản nhập

`js/01-core.js`: `showConflictDrafts`, `compareConflictDraft`, `draftComparisonRows`, `retryPendingDraft`, `editRejectedDraft`, `draftIsNew`, `discardConflictDraft`. Bảng hai bản chỉ đọc; mã EDIT_CONFLICT tách khỏi từ chối dữ liệu; retry chỉ PENDING, không tự lấy row_version mới. `js/13-tong-quan.js` dẫn trực tiếp màn hình; `backend/tests/ui/cases/13-edit-conflicts.js` có thêm GD-V5. Chi tiết trước/sau: `docs/VIEC5-BAN-NHAP-DOI-CHIEU.md`.
