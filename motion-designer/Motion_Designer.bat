@echo off
cd /d "%~dp0"
python Motion_Designer.py
if errorlevel 1 pause
