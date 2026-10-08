# Cloudflare (無料・24時間アクセス)

Cloudflare Workers + D1 + Groq API。GPUサーバー不要。Workersはリクエスト時に起動するためPCの常時起動は不要。

1. CloudflareとGroqの無料アカウントを作る。
2. `npx wrangler login`、`npx wrangler d1 create managpt` を実行。表示された database_id を wrangler.jsonc に設定。
3. `npx wrangler d1 execute managpt --remote --file=cloudflare/schema.sql`
4. `npx wrangler secret put GROQ_API_KEY` でGroqキーを登録。
5. `npx wrangler secret put MANAGPT_ACCESS_TOKEN` で長いランダムな本人専用パスワードを登録。
6. `npx wrangler deploy`。表示された workers.dev URLをiPhoneで開き、アクセス用トークンを入力。

APIキーはGitHubにコミットしない。アクセス用トークンはiPhoneのセッションストレージに保存される。無料推論枠の上限では応答に失敗する。これは単一ユーザー向けの簡易認証であり、共有端末では使わないこと。

注: Workerのコードは /api を処理し、静的アセットはCloudflareが配信する。GitHub Actionsはデプロイせずテストのみ。既存のPython版も引き続き利用可能。
