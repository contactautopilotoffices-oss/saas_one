@echo off
cd /d "%~dp0"
echo Starting saas_one on http://localhost:3005 ...
call npm run dev -- -p 3005
pause
