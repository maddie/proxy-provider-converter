#!/bin/bash
# 安装脚本 - 将项目部署到 /opt/proxy-provider-converter

set -e

INSTALL_DIR="/opt/proxy-provider-converter"
SERVICE_NAME="proxy-converter"

echo "🚀 开始安装 Proxy Provider Converter..."

# 检查是否为 root 用户
if [ "$EUID" -ne 0 ]; then 
    echo "❌ 请使用 sudo 运行此脚本"
    exit 1
fi

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 未找到 Node.js，请先安装 Node.js >= 18"
    exit 1
fi

# 检查 pnpm
if ! command -v pnpm &> /dev/null; then
    echo "⚠️  未找到 pnpm，将使用 npm"
    PKG_MANAGER="npm"
else
    PKG_MANAGER="pnpm"
fi

# 创建安装目录
echo "📁 创建安装目录: $INSTALL_DIR"
mkdir -p $INSTALL_DIR

# 复制文件
echo "📋 复制文件..."
cp -r ./* $INSTALL_DIR/
cp -r ./.* $INSTALL_DIR/ 2>/dev/null || true

# 安装依赖
echo "📦 安装依赖..."
cd $INSTALL_DIR
$PKG_MANAGER install --production

# 构建前端
echo "🔨 构建前端..."
$PKG_MANAGER run build

# 创建 www-data 用户（如果不存在）
if ! id -u www-data &>/dev/null; then
    echo "👤 创建 www-data 用户..."
    useradd -r -s /bin/false www-data
fi

# 设置权限
echo "🔐 设置权限..."
chown -R www-data:www-data $INSTALL_DIR

# 安装 systemd 服务
echo "⚙️  安装 systemd 服务..."
cp $INSTALL_DIR/proxy-converter.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable $SERVICE_NAME
systemctl start $SERVICE_NAME

echo ""
echo "✅ 安装完成！"
echo ""
echo "📊 服务状态:"
systemctl status $SERVICE_NAME --no-pager
echo ""
echo "📝 常用命令:"
echo "  查看状态: systemctl status $SERVICE_NAME"
echo "  查看日志: journalctl -u $SERVICE_NAME -f"
echo "  重启服务: systemctl restart $SERVICE_NAME"
echo "  停止服务: systemctl stop $SERVICE_NAME"
echo ""
echo "🌐 服务运行在: http://localhost:3000"
echo ""
echo "下一步: 配置 Caddy 反向代理"
echo "  sudo nano /etc/caddy/Caddyfile"
echo "  添加: your-domain.com { reverse_proxy localhost:3000 }"
echo "  sudo systemctl restart caddy"
