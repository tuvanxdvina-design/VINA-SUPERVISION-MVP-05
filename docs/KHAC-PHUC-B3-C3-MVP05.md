# Khắc phục B3/C3 — MVP-05

Build: `2026-10-07.2-mvp05`. Bản sửa cục bộ trên nền SHA `2036501494f6875d669a66e6db85c1076a17a112`; chưa có commit/PR mới hoặc kết quả CI cho bản sửa này.

## B3 — nội dung cửa sổ duyệt

Khi mở **Xem xét**, giao diện tải chi tiết hiện tại từ API trước khi hiện các nút quyết định. Không dùng bản cũ trong `db.logs`/`db.docs` để thay nội dung cần duyệt. Tải lỗi, bản không còn SUBMITTED, hoặc đã trình công ty mà người gọi không phải cấp công ty: không mở nút quyết định. Phản hồi đến muộn không mở lại cửa sổ đã đóng hoặc thay cửa sổ khác.

Báo cáo ngày hiện nội dung, số tệp/ảnh và cho xem tệp/ảnh bằng dữ liệu vừa tải. Hồ sơ/báo cáo có thể mở toàn văn bằng bản vừa tải; màn hình toàn văn này chỉ xem, không sửa/xóa hoặc quyết định bằng bản nháp cục bộ. Không ghi đè nháp/hàng đợi khi tải chi tiết để duyệt. Lỗi tải ảnh được hiển thị là lỗi tải, không bị đổi thành thông báo “chưa có ảnh”.

## C3 — tài khoản ở nhiều công trình

Trình chọn tài khoản dùng ID công trình đang sửa để kiểm tra tài khoản đã liên kết. Một tài khoản ENGINEER có thể là Kỹ sư tại A và TVGS trưởng tại B; quyền vẫn theo từng phân công. Gắn trùng tài khoản trong cùng công trình vẫn bị chặn. Giữ mặc định tạo mới cho nhân sự chưa liên kết để tránh tự chọn nhầm tài khoản của người khác.

## Kiểm thử và nghiệm thu

`backend/tests/ui/cases/15-review-and-multi-project.js` bổ sung sáu ca Chrome: đọc nội dung/tệp/ảnh báo cáo qua hộp duyệt khi chưa có bản đầy đủ trên máy; lỗi 403/500; đóng cửa sổ trước phản hồi; hồ sơ và bảo toàn nháp; gán cùng tài khoản qua giao diện ở công trình thứ hai, kiểm tra quyền A/B và bấm duyệt thật.

Lượt riêng: **6/6 đạt**, không bỏ qua, DB thử `vina_ui_b3c3_retry_20261007`. Bằng chứng `runtime-logs/b3c3-targeted-pass.txt`. Toàn bộ hồi quy và triển khai: xem biên bản `runtime-logs/NGHIEM-THU-MVP05-20261007.md` để lấy kết quả cuối; không suy ra đã đạt từ việc khởi chạy.

Sau cập nhật, giữ/xuất bản nhập chưa đồng bộ trước khi tải lại tab. Dùng hai phiên Chrome/Edge trên dữ liệu thử:

1. **B3:** Kỹ sư tạo báo cáo có nội dung riêng và ảnh/tệp rồi gửi. GST mở phiên mới, vào thẳng Việc cần duyệt, bấm Xem xét. Nội dung phải đầy đủ; Xem tệp/ảnh phải mở đúng tệp và ảnh. Thử mất mạng/lỗi tải: không được phê duyệt khi chưa tải nội dung. Chỉ duyệt báo cáo thử sau khi kiểm tra.
2. **C3:** Admin mở nhân sự A đã có tài khoản Kỹ sư, sau đó ở B chọn Thêm nhân sự → loại tài khoản ENGINEER → Dùng tài khoản có sẵn → chọn đúng tài khoản đó → chức danh TVGS trưởng → Lưu. Đăng nhập tài khoản: không duyệt tại A, được duyệt tại B. Không tạo thêm tài khoản chỉ để gán sang B.

Không thay JWT, không thêm migration, không sửa MVP-03/MVP-04 hoặc Docker volume. Chưa chốt toàn bộ nghiệm thu thủ công từ kết quả tự động trên DB thử.

Kết quả cuối trên Windows 08/10: toàn bộ Chrome 68/68 đạt; sau triển khai chạy lại sáu ca B3/C3 6/6 đạt. Build .2 đã chạy trên 3004/8083; health/API đọc dữ liệu và tệp đạt. Nghiệm thu bằng tay trên phiên vận hành vẫn chưa chạy lại.
