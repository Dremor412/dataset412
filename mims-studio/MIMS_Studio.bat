@echo off
cd /d "%~dp0"
python MIMS_Studio.py
if errorlevel 1 pause
