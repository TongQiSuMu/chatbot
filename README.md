# Simple AI Chat

极简的AI聊天机器人，支持OpenAI兼容API（如DeepSeek）。

## 功能特点

- ✅ 支持OpenAI兼容接口
- ✅ 可配置温度、系统提示词、上下文窗口
- ✅ 本地SQLite数据库存储
- ✅ 简洁的Web界面
- ✅ 聊天记录管理
- ✅ 局域网访问支持

## 快速开始

1. **安装依赖**
```bash
npm install
```

2. **配置环境变量**
```bash
cp .env.example .env
# 编辑 .env 文件，填入你的API配置
```

3. **启动服务器**
```bash
npm start
# 或使用开发模式（自动重启）
npm run dev
```

4. **访问聊天界面**
- 本机访问：http://localhost:3000
- 局域网访问：http://[你的IP]:3000

## 配置说明

在 `.env` 文件中配置：

- `API_ENDPOINT`: API端点地址
- `API_KEY`: API密钥
- `MODEL`: 模型名称
- `TEMPERATURE`: 温度参数（0-2，控制回复的随机性）
- `SYSTEM_PROMPT`: 系统提示词
- `CONTEXT_WINDOW`: 上下文窗口（包含的历史消息数）
- `PORT`: 服务器端口

## DeepSeek 配置示例

```env
API_ENDPOINT=https://api.deepseek.com/v1/chat/completions
API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
MODEL=deepseek-chat
```

## 其他兼容API

- OpenAI: `https://api.openai.com/v1/chat/completions`
- Azure OpenAI: 根据你的部署配置
- 其他兼容接口：参考对应文档

## 技术栈

- Express.js - Web服务器
- SQLite3 - 本地数据库
- 原生HTML/CSS/JS - 前端界面
- node-fetch - API调用

## 注意事项

- 数据存储在本地 `chat.db` 文件中
- 默认监听所有网络接口（0.0.0.0）
- 建议在受信任的局域网环境中使用