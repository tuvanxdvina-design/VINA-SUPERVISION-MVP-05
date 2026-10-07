# Đổi JWT riêng cho MVP-05

Ngày lập: 07/10/2026. Trạng thái: quy trình đã được đối chiếu với mã; **chưa thực hiện đổi khóa trên Windows trong phiên cloud này**. Không chứa hoặc ghi nhận khóa thật.

## Điều kiện bắt đầu

Người vận hành thông báo lịch ngoài giờ nộp báo cáo và xác nhận từng người đã đồng bộ hoặc xuất giữ bản nháp/tệp còn chờ trên mọi trình duyệt/thiết bị. Không xóa localStorage/IndexedDB để đăng nhập lại. Đổi JWT làm token cũ hết hiệu lực; mật khẩu tài khoản không thay đổi. Bản nháp không bị JWT tự xóa, nhưng phải nghiệm thu việc gửi lại sau đăng nhập mới.

Chỉ thao tác MVP-05 ở `D:\Setup\QLGS-HeThong\ChatGPT\VINA-SUPERVISION-MVP-05`; không sửa MVP-03/MVP-04, không truy cập Samsung_T5. Ghi nhận /health và build trước thay đổi. Cần có bản sao lưu DB/tệp còn giữ; việc này không tạo migration.

## So sánh khóa mà không lộ giá trị

Không chạy `findstr JWT_SECRET`, không dùng lệnh sinh khóa có console.log trong phiên agent ghi transcript. Không gửi .env, .env.bak, hash hay giá trị khóa vào AI, bộ nhớ plugin, chat, email, GitHub hoặc ảnh chụp.

Agent Windows/người vận hành dùng script cục bộ đọc ba `.env` và phân tích bằng thư viện dotenv đã có trong backend. Chỉ xuất: có/thiếu khóa; MVP-05 bằng/khác MVP-03; MVP-05 bằng/khác MVP-04. Không ghi nội dung tệp hoặc giá trị vào log. Script không được sửa hai bản tham chiếu.

Công cụ đi kèm chạy từ thư mục MVP-05, chỉ trả trạng thái/boolean, không in hash:

```powershell
node .\backend\scripts\jwt-key.js check
```

Nếu đứng ở nơi khác, truyền `--root "D:\Setup\QLGS-HeThong\ChatGPT\VINA-SUPERVISION-MVP-05"`. Công cụ chỉ nhận thư mục gốc có tên MVP-05 và đọc MVP-03/MVP-04 ở cùng thư mục cha; không dò các ổ đĩa khác.

Kiểm tra **sự có mặt**, không in giá trị, của JWT_SECRET trong biến môi trường tiến trình/User/Machine. dotenv mặc định không ghi đè biến đã tồn tại; nếu có override, dừng để xác định nguồn và điều chỉnh riêng cấu hình MVP-05. Không xóa biến chung của Windows khi chưa biết MVP-03/MVP-04 có sử dụng hay không.

## Sinh và thay khóa

Thực hiện sau khi điều kiện đồng bộ đã được người vận hành xác nhận. Nếu `backend\.env.bak` đã tồn tại, giữ nguyên và đối chiếu nguồn gốc; không ghi đè bản dự phòng cũ.

Tạo bản sao `.env` với quyền truy cập chỉ dành cho người vận hành. Một script cục bộ sinh 48 byte ngẫu nhiên bằng crypto/RandomNumberGenerator, chuyển thành 96 ký tự hex và thay **duy nhất** dòng JWT_SECRET trong `.env`, giữ các cấu hình khác. Script từ chối nếu thiếu hoặc có nhiều dòng JWT_SECRET; không in khóa, nội dung .env hoặc lỗi chứa bí mật. Nếu ghi tệp thất bại, giữ nguyên bản dự phòng, không tiếp tục khởi động bằng cấu hình chưa xác định.

So sánh lại bằng script chỉ xuất boolean: khóa mới khác khóa dự phòng và khác hai bản tham chiếu. Không đưa bước đọc/ghi bí mật cho mô hình xử lý; mô hình chỉ xem mã script và trạng thái đã che bí mật.

Sau khi người vận hành đã xác nhận điều kiện đồng bộ, thực hiện một lần:

```powershell
node .\backend\scripts\jwt-key.js rotate --offline-cleared
```

`--offline-cleared` là xác nhận của người vận hành, không phải công cụ tự kiểm tra hàng đợi trên mọi thiết bị. Công cụ từ chối khóa thiếu/trùng, biến JWT_SECRET ghi đè trong tiến trình hoặc .env.bak đã tồn tại; giữ bản dự phòng độc quyền, ghi thay thế qua tệp tạm cùng thư mục và không sửa hai bản tham chiếu. Nó không tự restart, xóa backup hoặc chuyển tệp mật khẩu. Mã lỗi `LOCAL_IO_FAILED` yêu cầu kiểm tra quyền/tệp cục bộ mà không in bí mật; nếu lỗi sau khi tạo backup thì giữ backup và xác định trạng thái .env trước khi thử lại. Quyền mode Unix không bảo đảm ACL Windows; bảo vệ thư mục .env/bản dự phòng bằng quyền Windows phù hợp.

## Restart đúng backend

Mã `start-dev.ps1` chỉ tự restart backend đang chạy khi build khác. Đổi `.env` không đổi build, nên chạy lại `run.bat` đơn thuần có thể giữ backend dùng khóa cũ.

Xác định PID từ `runtime-logs\backend.pid`, đối chiếu tiến trình node đang nghe cổng 3004 và nguồn chạy của MVP-05. Dừng riêng tiến trình đã xác định; nếu PID không khớp hoặc không xác định được chủ sở hữu thì dừng quy trình để chẩn đoán, không kill theo tên tiến trình. Giữ PostgreSQL/volume và backend MVP-03/MVP-04.

Khi cổng 3004 đã trống, chạy `run.bat` tại MVP-05 và đọc toàn bộ kết quả. Launcher có thể kiểm tra migration hiện có; không sửa/chạy migration mới vì đổi JWT.

## Kiểm tra bắt buộc

1. /health có status OK, database connected, đúng build, danh sách migrations_pending tồn tại và rỗng, security_warnings tồn tại và rỗng. Nếu HTTP lỗi thì không đếm các trường của biến null.
2. Token của phiên cũ không còn được phép gọi API được bảo vệ; không in token vào kết quả. Đăng nhập lại thành công bằng hai tài khoản đang hoạt động.
3. Không còn dải cảnh báo JWT trên trang đăng nhập. Lưu/mở lại một nháp trong công trình thử riêng, không sửa dữ liệu báo cáo thật.
4. Nếu có bản nháp ngoại tuyến đã xuất giữ trước thay đổi, đăng nhập lại rồi kiểm tra trạng thái đồng bộ/tệp; không ép ghi đè bản xung đột bằng phiên bản mới.
5. Script so sánh chỉ xuất MVP-05 khác MVP-03/MVP-04; cấu hình và hoạt động hai bản tham chiếu không bị thay đổi. Kiểm tra đăng nhập tại chúng bằng người vận hành; không gửi mật khẩu cho AI.

`security_warnings: []` hiện chỉ kiểm tra cảnh báo mẫu/độ dài JWT trong app.js, không tự chứng minh khóa duy nhất, mức ngẫu nhiên hoặc token cũ đã bị vô hiệu hóa.

## Dọn bí mật và xử lý lỗi

Chuyển riêng các tệp `Token eyJ….txt` và `Pas user.xlsx` nếu chúng tồn tại ra khỏi repository vào nơi được người vận hành chọn, có quyền truy cập phù hợp, không thuộc Samsung_T5. Không mở nội dung, không ghi đè tệp cùng tên ở nơi cất, không xóa các bản sao chưa xác minh. Hai tệp này được gitignore nhưng vẫn là dữ liệu nhạy cảm trên đĩa.

Chỉ xóa `.env.bak` sau khi mọi bước kiểm tra bắt buộc đạt và kết quả đã được ghi nhận theo yêu cầu dọn dẹp của người dùng. Xóa bản sao lưu tạm này không đồng nghĩa bảo đảm xóa an toàn trên SSD hoặc mọi bản sao lịch sử.

Nếu đăng nhập lỗi: trước tiên lưu lỗi đã che thông tin và xác định có phải lỗi JWT hay tài khoản/DB. Nếu cần khôi phục, dừng đúng backend MVP-05, khôi phục .env từ .env.bak rồi khởi động lại thực sự và kiểm tra. Việc dùng lại khóa cũ có thể làm token cũ chưa hết hạn được chấp nhận lại; không gọi rollback là biện pháp bảo mật tốt hơn. Nếu khóa cũ đã bị lộ, ưu tiên sửa cấu hình với khóa mới, không phục hồi khóa đã lộ.

## Phân công AI và bằng chứng

Tuân thủ bảng định tuyến trong AGENTS.md: script xử lý bí mật, Codex xem mã và lỗi đã che bí mật, GitHub Actions chạy kiểm thử khi có sửa mã. Claude/OpenCode/claude-mem không được nhận nội dung bí mật để tổng hợp hoặc lưu trí nhớ. Không cài thêm plugin hoặc gọi thêm chatbot chỉ để sinh/so sánh khóa.

Ghi ngày/giờ, build, trạng thái chuẩn bị/đổi/restart/kiểm tra/dọn, kết quả boolean và vị trí bản dự phòng theo chính sách vận hành; không ghi khóa/token/mật khẩu. Quy định ở cloud chỉ có hiệu lực cho phiên đọc tệp này; muốn áp dụng ở Windows cần đưa tài liệu và AGENTS.md vào checkout tương ứng. Không báo hoàn tất thao tác máy Windows từ kết quả kiểm tra cloud.
