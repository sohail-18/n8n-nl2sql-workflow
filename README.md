## 环境变量配置

项目需要以下环境变量：

| 变量              | 说明                                   |
| ----------------- | ------------------------------------- |
| `MYSQL_HOST`      | MySQL 主机名，例如 `127.0.0.1`          |
| `MYSQL_PORT`      | MySQL 端口，默认 `3306`                 |
| `MYSQL_USER`      | 数据库用户名                            |
| `MYSQL_PASSWORD`  | 数据库密码                              |
| `MYSQL_DATABASE`  | 数据库名称                              |
| `N8N_WEBHOOK_URL` | n8n webhook URL                       |
| `N8N_API_KEY`     | n8n API key 可选                       |

## 本地运行

```bash
git clone git@github.com:Oli51467/n8n-nl2sql-workflow.git
cd n8n-nl2sql-workflow
npm install
cp .env.example .env   # 配置环境变量
npm run start
```

或直接使用环境变量启动：
```bash
MYSQL_HOST=127.0.0.1 MYSQL_USER=root MYSQL_PASSWORD=pass MYSQL_DATABASE=n8n_chat node src/server/index.js
```
