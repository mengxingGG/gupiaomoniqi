@echo off
chcp 65001 >nul
title 股票模拟器后端服务器

echo ========================================
echo   股票模拟器 2.0 - 后端服务器
echo ========================================
echo.

cd /d "%~dp0"

echo [1/3] 检查 Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js
    pause
    exit /b 1
)
echo [OK] Node.js 已安装

echo.
echo [2/3] 检查依赖...
if not exist "node_modules" (
    echo [INFO] 首次运行，正在安装依赖...
    call npm install
    if errorlevel 1 (
        echo [错误] 依赖安装失败
        pause
        exit /b 1
    )
)
echo [OK] 依赖已就绪

echo.
echo [3/3] 启动服务器...
echo.
echo 服务地址: http://127.0.0.1:3001
echo API 文档: http://127.0.0.1:3001/docs (如启用)
echo.
echo 按 Ctrl+C 停止服务器
echo.

call npm run dev

pause
