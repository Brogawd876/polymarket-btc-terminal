@echo off
setlocal
title Polymarket BTC Terminal (Development)
cd /d "%~dp0"
echo Starting backend and extension development processes...
echo Press Ctrl+C in this window to stop development mode.
echo.
call pnpm.cmd run dev
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" echo Development mode ended with exit code %EXIT_CODE%.
pause
exit /b %EXIT_CODE%
