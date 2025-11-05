## 本地运行

```bash
git clone <repo>
cd n8n-webui
npm install
cp .env.example .env   # 如果还没有 .env
node src/server/index.js
```

## 环境变量

服务器会自动从根目录的 `.env` 加载配置。除现有的 n8n 配置外，新增了以下必填变量用于连接 MySQL，所有会话数据会按浏览器生成的 `clientId` 进行隔离，避免不同设备之间互相看到历史记录：

| 变量              | 说明                                   |
| ----------------- | -------------------------------------- |
| `MYSQL_HOST`      | MySQL 主机名，例如 `127.0.0.1`         |
| `MYSQL_PORT`      | MySQL 端口，默认 `3306`                |
| `MYSQL_USER`      | 数据库用户名                           |
| `MYSQL_PASSWORD`  | 数据库密码（可为空字符串）             |
| `MYSQL_DATABASE`  | 用于存储会话数据的数据库名称           |

示例 `.env` 片段：

```
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=n8n
MYSQL_PASSWORD=secret
MYSQL_DATABASE=n8n_chat

N8N_WEBHOOK_URL=http://localhost:5678/webhook/your-flow
N8N_API_KEY=xxx
```

服务器启动时会自动初始化以下表：

- `sessions`：记录会话元数据。
- `messages`：存储消息正文、表格/图表 JSON 数据以及时间戳。

## 启动指令

```bash
MYSQL_HOST=127.0.0.1 MYSQL_USER=root MYSQL_PASSWORD=pass MYSQL_DATABASE=n8n_chat node src/server/index.js
```

或在 `.env` 中写好再直接运行 `npm run start`。
