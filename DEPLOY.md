# 部署到 VPS 指南

## 前置要求

- Node.js >= 18
- pnpm (推荐) 或 npm
- Caddy

## 部署步骤

### 1. 克隆代码

```bash
git clone https://github.com/maddie/proxy-provider-converter.git
cd proxy-provider-converter
```

### 2. 安装依赖

```bash
pnpm install
# 或
npm install
```

### 3. 构建前端

```bash
pnpm build
# 或
npm run build
```

### 4. 启动服务

```bash
pnpm start
# 或
npm start
```

服务将在 `http://localhost:3000` 运行。

### 5. 配置 Caddy

创建或编辑 Caddyfile：

```bash
sudo nano /etc/caddy/Caddyfile
```

添加以下内容（将 `your-domain.com` 替换为你的域名）：

**方式1: 根路径**
```caddyfile
your-domain.com {
    reverse_proxy localhost:3000
}
```

**方式2: 子路径（推荐）**
```caddyfile
your-domain.com {
    handle_path /proxy/* {
        reverse_proxy localhost:3000
    }
}
```

### 6. 重启 Caddy

```bash
sudo systemctl restart caddy
```

## 使用 systemd 管理服务（推荐）

创建 systemd 服务文件：

```bash
sudo nano /etc/systemd/system/proxy-converter.service
```

添加以下内容：

```ini
[Unit]
Description=Proxy Provider Converter
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/path/to/proxy-provider-converter
ExecStart=/usr/bin/node server.mjs
Restart=on-failure
RestartSec=10
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

启用并启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable proxy-converter
sudo systemctl start proxy-converter
```

## 使用示例

**根路径部署**
```
# 使用默认 User-Agent
https://your-domain.com/api/convert?url=https://example.com/sub&target=clash

# 自定义 User-Agent
https://your-domain.com/api/convert?url=https://example.com/sub&target=clash&ua=MyApp/1.0
```

**子路径部署**
```
# 使用默认 User-Agent
https://your-domain.com/proxy/api/convert?url=https://example.com/sub&target=clash

# 自定义 User-Agent
https://your-domain.com/proxy/api/convert?url=https://example.com/sub&target=clash&ua=MyApp/1.0
```

## 环境变量

- `PORT`: 服务端口（默认：3000）
