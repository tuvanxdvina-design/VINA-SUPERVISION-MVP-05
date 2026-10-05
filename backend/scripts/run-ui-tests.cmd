@echo off
REM Chay kiem thu giao dien tren CSDL thu rieng, ghi ket qua ra backend\tests\last-ui-test.txt
REM Cach dung: backend\scripts\run-ui-tests.cmd [ten_csdl_thu] [mau_ten_ca]
REM   Vi du: backend\scripts\run-ui-tests.cmd vina_ui_claude GD-06
setlocal
set DB=%1
if "%DB%"=="" set DB=vina_ui_%RANDOM%
REM CHOT AN TOAN: script nay DROP va TAO LAI CSDL duoc dat ten o day.
REM Chi cho phep ten bat dau bang "vina_ui" de mot lan go nham (vi du vina_supervision)
REM khong the pha CSDL that. Muon ten khac thi doi chot nay mot cach co y thuc.
echo %DB% | findstr /B /I "vina_ui" >nul
if errorlevel 1 (
  echo TU CHOI: ten CSDL thu phai bat dau bang "vina_ui" vi script se XOA va TAO LAI CSDL nay. Nhan duoc: %DB%
  echo TU CHOI: ten CSDL thu phai bat dau bang "vina_ui". Nhan duoc: %DB%> "%~dp0..\tests\last-ui-test.txt"
  endlocal
  exit /b 2
)
set UI_TEST_DB_URL=postgres://postgres:postgres@127.0.0.1:5435/%DB%
for /f "delims=" %%I in ('docker compose -f "%~dp0..\..\docker-compose.yml" ps -q postgres') do set DB_CONTAINER=%%I
if "%DB_CONTAINER%"=="" exit /b 3
cd /d %~dp0..
set OUT=%~dp0..\tests\last-ui-test.txt
set PAT=%~2
echo RUNNING %DATE% %TIME% db=%DB% pattern=%PAT%> "%OUT%"
if "%PAT%"=="" (
  node --test --test-reporter=spec tests/ui/all.test.js >> "%OUT%" 2>&1
) else (
  node --test --test-reporter=spec --test-name-pattern "%PAT%" tests/ui/all.test.js >> "%OUT%" 2>&1
)
echo EXIT %ERRORLEVEL%>> "%OUT%"
docker exec %DB_CONTAINER% psql -U postgres -d postgres -qc "drop database if exists %DB%" >nul 2>&1
echo DONE>> "%OUT%"
endlocal
