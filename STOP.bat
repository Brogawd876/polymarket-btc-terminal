@echo off
title Stop Polymarket BTC Terminal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop.ps1"
pause
