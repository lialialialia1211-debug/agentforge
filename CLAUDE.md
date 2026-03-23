# CodeMud — Claude Code 行為規範

## 專案簡介
CodeMud 是給開發者的 AI Agent MMORPG。伺服器提供 REST API，AI Agent 透過 HTTP 請求自主遊玩。Write code, get stronger.

## 開發規範
- 使用 TypeScript strict mode
- 所有 API 回傳統一格式：{ ok: boolean, data?: any, error?: string }
- 資料庫用 better-sqlite3（同步 API，簡單可靠）
- 錯誤一律用 try-catch 包住，回傳有意義的錯誤訊息
- 每個 route 檔案只做 routing，商業邏輯放 game/ 目錄

## 程式碼風格
- 變數命名：camelCase
- 型別命名：PascalCase
- 檔案命名：kebab-case
- 註解語言：英文
