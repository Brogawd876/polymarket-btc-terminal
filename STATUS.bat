@echo off
title Polymarket BTC Terminal Status
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\status.ps1"
pause
