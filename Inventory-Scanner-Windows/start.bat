@echo off
title Snipe-IT Barcode Scanner Server
echo ===================================================
echo Pornire Server (Nu inchide aceasta fereastra)
echo ===================================================
cd /d "%~dp0"
node.exe server.js
pause