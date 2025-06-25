const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const fetch = require('node-fetch');
const path = require('path');
require('dotenv').config();

// 导入提示词配置
const prompts = require('./prompts');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(express.json());
app.use(express.static('public'));

// 初始化数据库
const db = new sqlite3.Database('./chat.db');
db.run(`
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);
db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER,
    role TEXT,
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations (id)
  )
`);

// 对话API配置
const CHAT_API_CONFIG = {
  endpoint: process.env.CHAT_API_ENDPOINT || process.env.API_ENDPOINT || 'https://api.openai.com/v1/chat/completions',
  apiKey: process.env.CHAT_API_KEY || process.env.API_KEY,
  model: process.env.CHAT_MODEL || process.env.MODEL || 'gpt-3.5-turbo',
  temperature: process.env.CHAT_TEMPERATURE !== undefined ? parseFloat(process.env.CHAT_TEMPERATURE) : 
               (process.env.TEMPERATURE !== undefined ? parseFloat(process.env.TEMPERATURE) : 0.7),
  systemPrompt: process.env.CHAT_SYSTEM_PROMPT || prompts.chatSystemPrompt,
  contextWindow: parseInt(process.env.CHAT_CONTEXT_WINDOW) || parseInt(process.env.CONTEXT_WINDOW) || 10
};

// 命名API配置
const NAMING_API_CONFIG = {
  endpoint: process.env.NAMING_API_ENDPOINT || process.env.CHAT_API_ENDPOINT || process.env.API_ENDPOINT || 'https://api.openai.com/v1/chat/completions',
  apiKey: process.env.NAMING_API_KEY || process.env.CHAT_API_KEY || process.env.API_KEY,
  model: process.env.NAMING_MODEL || process.env.CHAT_MODEL || process.env.MODEL || 'gpt-3.5-turbo',
  temperature: process.env.NAMING_TEMPERATURE !== undefined ? parseFloat(process.env.NAMING_TEMPERATURE) : 0.3,
  maxTokens: parseInt(process.env.NAMING_MAX_TOKENS) || 50,
  systemPrompt: process.env.NAMING_SYSTEM_PROMPT || prompts.namingSystemPrompt
};

// 自动生成对话标题
async function generateConversationTitle(conversationId) {
  try {
    console.log(`开始为对话 ${conversationId} 生成标题...`);
    
    // 获取对话的前两条消息（用户问题和AI回答）
    const messages = await new Promise((resolve, reject) => {
      db.all(`SELECT role, content FROM messages 
              WHERE conversation_id = ? 
              ORDER BY created_at 
              LIMIT 2`, [conversationId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    if (messages.length < 2) {
      console.log(`对话 ${conversationId} 消息数量不足，跳过标题生成`);
      return;
    }

    const userMessage = messages.find(m => m.role === 'user')?.content;
    const assistantMessage = messages.find(m => m.role === 'assistant')?.content;

    if (!userMessage) {
      console.log(`对话 ${conversationId} 缺少用户消息，跳过标题生成`);
      return;
    }

    console.log(`对话 ${conversationId} 准备调用命名API...`);
    console.log(`用户消息: ${userMessage.substring(0, 50)}...`);
    console.log(`助手消息: ${assistantMessage?.substring(0, 50)}...`);

    // 调用命名API - 先尝试非流式响应
    const response = await fetch(NAMING_API_CONFIG.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${NAMING_API_CONFIG.apiKey}`
      },
      body: JSON.stringify({
        model: NAMING_API_CONFIG.model,
        messages: [
          { role: 'system', content: NAMING_API_CONFIG.systemPrompt },
          { role: 'user', content: `用户：${userMessage}\n助手：${assistantMessage?.substring(0, 100)}...` }
        ],
        temperature: NAMING_API_CONFIG.temperature,
        max_tokens: NAMING_API_CONFIG.maxTokens,
        stream: false  // 改为非流式响应，更稳定
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`命名API调用失败 (${response.status}):`, errorText);
      return;
    }

    const result = await response.json();
    console.log('命名API响应:', result);
    
    const title = result.choices?.[0]?.message?.content?.trim();
    
    if (title) {
      const cleanTitle = title.replace(/[""]/g, '').trim();
      if (cleanTitle && cleanTitle !== '新对话') {
        // 更新对话标题
        db.run('UPDATE conversations SET title = ? WHERE id = ?', [cleanTitle, conversationId], (err) => {
          if (err) {
            console.error(`更新标题失败 (对话 ${conversationId}):`, err);
          } else {
            console.log(`✅ 对话 ${conversationId} 标题已更新为: ${cleanTitle}`);
          }
        });
      } else {
        console.log(`对话 ${conversationId} 生成的标题为空或无效，跳过更新`);
      }
    } else {
      console.log(`对话 ${conversationId} 未能从API响应中提取标题`);
    }
  } catch (error) {
    console.error(`生成标题失败 (对话 ${conversationId}):`, error.message);
    console.error('详细错误:', error);
  }
}

// 获取所有对话
app.get('/api/conversations', (req, res) => {
  db.all('SELECT * FROM conversations ORDER BY updated_at DESC', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 获取单个对话信息
app.get('/api/conversations/:id', (req, res) => {
  const { id } = req.params;
  db.get('SELECT * FROM conversations WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Conversation not found' });
    res.json(row);
  });
});

// 创建新对话
app.post('/api/conversations', (req, res) => {
  const { title = 'New Chat' } = req.body;
  db.run('INSERT INTO conversations (title) VALUES (?)', [title], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, title });
  });
});

// 获取对话消息
app.get('/api/conversations/:id/messages', (req, res) => {
  const { id } = req.params;
  db.all('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at', [id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 发送消息
app.post('/api/conversations/:id/messages', async (req, res) => {
  const { id } = req.params;
  const { content } = req.body;
  
  // 保存用户消息
  db.run('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)', 
    [id, 'user', content], async function(err) {
    if (err) return res.status(500).json({ error: err.message });
    
    // 获取上下文消息
    db.all(`SELECT role, content FROM messages 
            WHERE conversation_id = ? 
            ORDER BY created_at DESC 
              LIMIT ?`, [id, CHAT_API_CONFIG.contextWindow], async (err, messages) => {
      if (err) return res.status(500).json({ error: err.message });
      
      // 反转消息顺序（从旧到新）
      messages.reverse();
      
      // 构建请求
      const apiMessages = [
          { role: 'system', content: CHAT_API_CONFIG.systemPrompt },
        ...messages
      ];
      
      try {
          // 调用AI API（流式）
          const response = await fetch(CHAT_API_CONFIG.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
              'Authorization': `Bearer ${CHAT_API_CONFIG.apiKey}`
          },
          body: JSON.stringify({
              model: CHAT_API_CONFIG.model,
            messages: apiMessages,
              temperature: CHAT_API_CONFIG.temperature,
              stream: true
          })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || 'API request failed');
        }
        
          // 设置流式响应头
          res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Transfer-Encoding': 'chunked',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          });
          
          let fullMessage = '';
          const reader = response.body;
          
          // 处理流式数据
          for await (const chunk of reader) {
            const lines = chunk.toString().split('\n');
            
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                
                if (data === '[DONE]') {
                  // 流式结束，保存完整消息
        db.run('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)', 
                    [id, 'assistant', fullMessage], function(err) {
                    if (err) {
                      console.error('保存消息失败:', err);
                      return;
                    }
          
          // 更新对话时间
          db.run('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
          
                    // 检查是否需要自动生成标题（第一轮对话完成后）
                    db.get('SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?', [id], (err, row) => {
                      if (!err && row.count === 2) {
                        // 这是第一轮对话（用户消息 + 助手回复），触发自动命名
                        setTimeout(() => generateConversationTitle(id), 1000);
                      }
          });
        });
                  
                  res.write('data: [DONE]\n\n');
                  res.end();
                  return;
                }
                
                try {
                  const parsed = JSON.parse(data);
                  const delta = parsed.choices?.[0]?.delta?.content;
                  
                  if (delta) {
                    fullMessage += delta;
                    // 发送流式数据到前端
                    res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
                  }
                } catch (parseError) {
                  // 忽略解析错误，继续处理下一行
                  continue;
                }
              }
            }
          }
      } catch (error) {
          if (!res.headersSent) {
        res.status(500).json({ error: error.message });
          } else {
            res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
            res.end();
          }
      }
    });
  });
});

// 手动生成对话标题
app.post('/api/conversations/:id/generate-title', async (req, res) => {
  const { id } = req.params;
  
  try {
    await generateConversationTitle(id);
    res.json({ success: true, message: '标题生成请求已发送' });
  } catch (error) {
    console.error('手动生成标题失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 删除对话
app.delete('/api/conversations/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM messages WHERE conversation_id = ?', [id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    db.run('DELETE FROM conversations WHERE id = ?', [id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
  });
});

// 启动服务器
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
  console.log(`\n=== 对话API配置 ===`);
  console.log(`端点: ${CHAT_API_CONFIG.endpoint}`);
  console.log(`模型: ${CHAT_API_CONFIG.model}`);
  console.log(`温度: ${CHAT_API_CONFIG.temperature}`);
  console.log(`系统提示: ${CHAT_API_CONFIG.systemPrompt}`);
  console.log(`上下文窗口: ${CHAT_API_CONFIG.contextWindow}`);
  
  console.log(`\n=== 命名API配置 ===`);
  console.log(`端点: ${NAMING_API_CONFIG.endpoint}`);
  console.log(`模型: ${NAMING_API_CONFIG.model}`);
  console.log(`温度: ${NAMING_API_CONFIG.temperature}`);
  console.log(`最大Token: ${NAMING_API_CONFIG.maxTokens}`);
  console.log('');
});