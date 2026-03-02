#!/bin/bash

# 股票模拟器 2.0 - 后端服务器启动脚本

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================"
echo "  股票模拟器 2.0 - 后端服务器"
echo "========================================"
echo ""

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 检查 Node.js
echo -n "[1/3] 检查 Node.js... "
if command -v node &> /dev/null; then
    echo -e "${GREEN}OK${NC}"
    node --version
else
    echo -e "${RED}错误${NC}"
    echo "未检测到 Node.js，请先安装 Node.js"
    exit 1
fi

echo ""

# 检查依赖
echo -n "[2/3] 检查依赖... "
if [ -d "node_modules" ]; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${YELLOW}首次运行，正在安装依赖...${NC}"
    npm install
    if [ $? -ne 0 ]; then
        echo -e "${RED}错误: 依赖安装失败${NC}"
        exit 1
    fi
fi

echo ""
echo "[3/3] 启动服务器..."
echo ""
echo "服务地址: http://127.0.0.1:3001"
echo "按 Ctrl+C 停止服务器"
echo ""

# 启动服务器
exec npm run dev
