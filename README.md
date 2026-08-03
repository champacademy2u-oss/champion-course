# Lead Center

一个轻量的 Facebook Lead CSV 导入和 1/3/7 天 follow-up 系统。

## 怎么使用

1. 打开 `http://localhost:4174`，或者直接打开 `index.html`。
2. 在 Facebook Ads Manager / Lead Center 导出 Lead Form CSV。
3. 点击右上角上传按钮，选择 CSV。
4. 系统只会读取 CSV 里的 `full_name / phone_number / email / job_title` 四个栏位，其他 CSV 栏位不会读取也不会保存。
5. 同名客户会自动 merge 成一条记录，空的电话/email/工作会用重复资料补上。
6. Dashboard 会显示今天需要 follow-up 的客户。
7. 点击 `WhatsApp` 会打开 WhatsApp 发送预设文案。
8. 点击 `Email` 会打开你的 email app 并带入标题和内容。
9. 在 Leads 页面点击 `Bulk WhatsApp`，会用同一段 WhatsApp 文案打开所有有电话的客户聊天。
10. 在 Leads 页面点击 `Bulk Email`，会用 BCC 把同一封 email 发给所有有 email 的客户。
11. 跟进完成后点击 `Done`，系统会进入下一次 Day 3 或 Day 7 follow-up。

## 测试

你可以先上传 `sample-facebook-leads.csv` 测试流程。

## Facebook Lead Form 自动同步到 Google Drive

我已经加了一个独立后端：`server.js`。

它会接收 Meta Lead Ads Webhook，有新名单时用 `leadgen_id` 拉完整资料，然后自动追加到 Google Drive 里的 CSV 文件。

快速启动：

```bash
cp .env.example .env
npm install
npm start
```

详细设置看 `FACEBOOK_TO_GOOGLE_DRIVE_SETUP.md`。

## CSV 格式

CSV 只会读取这四个表头：

```csv
full_name,phone_number,email,job_title
Ali Tan,+60123456789,ali@example.com,Business Owner
```

大小写不限，例如 `Full_Name`, `PHONE_NUMBER`, `Email`, `job_title` 也可以。系统不会读取 `campaign_name`, `created_time`, `form_id` 等其他栏位。Facebook 导出的 UTF-16 / tab-separated CSV 也可以直接导入。

## 目前版本

这个版本的数据存在浏览器 `localStorage`，适合单人本机使用。CSV 里的其他栏位不会被保存。真正自动发送 WhatsApp / Email 需要之后接：

- Meta WhatsApp Cloud API
- Email provider, for example SendGrid, Mailgun, Gmail API, or SMTP
- Database, for example Supabase, Firebase, Airtable, or MySQL
- Scheduler / automation worker

## Vercel + Firebase 视频后台

这个仓库现在也包含一个可部署到 Vercel 的安全视频后台：

- `/admin`：管理员登录、上传视频、复制观看链接、查看观看记录。
- `/watch/:id`：观众输入姓名、电话和观看密码后观看视频。
- `api/`：Vercel Serverless Functions，负责管理员验证、视频资料、观看记录、短期签名播放链接。
- `public/`：云端后台和观看页。
- `firebase-rules/storage.rules`：Firebase Storage 安全规则范本。

部署需要在 Vercel 设置环境变量，参考 `.env.vercel.example`。视频文件由浏览器直传 Firebase Storage，避免触碰 Vercel Function 4.5MB request body 限制；Vercel API 只负责验证和记录。
