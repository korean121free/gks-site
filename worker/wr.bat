@echo off
rem =====================================================================
rem  GKS wrangler runner  (ASCII only - do not add Korean text here)
rem
rem  Reads .cf-token in this folder (korean121free / GKS account)
rem  and runs wrangler with that token only.
rem  The GHM wrangler login is never touched.
rem
rem  Usage:  wr.bat whoami
rem          wr.bat d1 create gks-class-log
rem          wr.bat deploy
rem =====================================================================
setlocal
cd /d "%~dp0"

if not exist ".cf-token" goto notoken

for /f "usebackq delims=" %%T in (`powershell -NoProfile -Command "((Get-Content -Raw -LiteralPath '.cf-token') -replace '\s','').TrimStart([char]0xFEFF)"`) do set "CLOUDFLARE_API_TOKEN=%%T"

if "%CLOUDFLARE_API_TOKEN%"=="" goto emptytoken

npx wrangler %*
exit /b %errorlevel%

:notoken
echo.
echo [!] worker\.cf-token not found.
echo.
exit /b 1

:emptytoken
echo.
echo [!] .cf-token is empty.
echo.
exit /b 1
