#!/bin/bash
# 数据库备份脚本 - 滚动备份（固定数量循环覆盖）
DB_PATH="/root/your_workspace_path/gupiaomoniqi-prod/股票模拟器2.0/server/data/stock_simulator.db"
BACKUP_DIR="/root/your_workspace_path/gupiaomoniqi-prod/股票模拟器2.0/server/data/backups"
MAX_BACKUPS=5  # 保留最近5个备份

mkdir -p "$BACKUP_DIR"

if [ -f "$DB_PATH" ]; then
  # 获取现有备份数量
  COUNT=$(ls -1 "$BACKUP_DIR"/*.db 2>/dev/null | wc -l)
  
  if [ "$COUNT" -ge "$MAX_BACKUPS" ]; then
    # 删除最旧的备份
    OLDEST=$(ls -1t "$BACKUP_DIR"/*.db | tail -1)
    rm -f "$OLDEST"
  fi
  
  # 创建新备份
  DATE=$(date +%Y%m%d_%H%M%S)
  cp "$DB_PATH" "$BACKUP_DIR/stock_simulator_$DATE.db"
  echo "Backup created: stock_simulator_$DATE.db (total: $((COUNT < MAX_BACKUPS ? COUNT + 1 : MAX_BACKUPS)))"
fi
