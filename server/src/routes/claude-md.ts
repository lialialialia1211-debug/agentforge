import { Router, Request, Response } from 'express';
import { getDb } from '../db/schema.js';

const router = Router();

router.get('/claude-md', (req: Request, res: Response) => {
  try {
    const token = req.query.token as string;
    if (!token) {
      res.status(400).json({ ok: false, error: 'Token required. Use: /api/claude-md?token=YOUR_TOKEN' });
      return;
    }

    const db = getDb();
    const agent = db.prepare('SELECT * FROM agents WHERE token = ?').get(token) as any;
    if (!agent) {
      res.status(404).json({ ok: false, error: 'Invalid token' });
      return;
    }

    const serverUrl = `${req.protocol}://${req.get('host')}`;

    const md = `## CodeMud Integration — ${agent.name} (${agent.class})

> Write code. Get stronger. 你的 Agent「${agent.name}」正在遊戲世界中冒險。

### 自動上報規則

完成以下行為後，靜默背景執行對應的 curl（不阻塞工作流）：

**Git commit 後：**
\`\`\`bash
curl -s -X POST ${serverUrl}/api/dev-event -H "Content-Type: application/json" -H "Authorization: Bearer ${token}" -d '{"event_type":"commit","data":{"message":"COMMIT_MSG_HERE"}}' > /dev/null 2>&1 &
\`\`\`

**Lint 全部通過：**
\`\`\`bash
curl -s -X POST ${serverUrl}/api/dev-event -H "Content-Type: application/json" -H "Authorization: Bearer ${token}" -d '{"event_type":"lint_pass"}' > /dev/null 2>&1 &
\`\`\`

**Test 全部通過：**
\`\`\`bash
curl -s -X POST ${serverUrl}/api/dev-event -H "Content-Type: application/json" -H "Authorization: Bearer ${token}" -d '{"event_type":"test_pass"}' > /dev/null 2>&1 &
\`\`\`

**Build 失敗：**
\`\`\`bash
curl -s -X POST ${serverUrl}/api/dev-event -H "Content-Type: application/json" -H "Authorization: Bearer ${token}" -d '{"event_type":"build_fail"}' > /dev/null 2>&1 &
\`\`\`

**Merge 完成：**
\`\`\`bash
curl -s -X POST ${serverUrl}/api/dev-event -H "Content-Type: application/json" -H "Authorization: Bearer ${token}" -d '{"event_type":"merge"}' > /dev/null 2>&1 &
\`\`\`

上報後僅印一行確認，例如：\`[CodeMud] Commit → +1 skill point\`

### 查看 Agent 狀態
\`\`\`bash
curl -s ${serverUrl}/api/status -H "Authorization: Bearer ${token}"
\`\`\`

### Dashboard
${serverUrl}
`;

    res.type('text/markdown').send(md);
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

export default router;
