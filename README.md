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
9. 在 Leads 页面先勾选客户，再点击 `Bulk WhatsApp (Selected)`。系统会先显示脱敏名单预览、自动把马来西亚本地 `01...` 号码转换为 `601...`、排除无效与重复号码，并在确认客户已同意接收信息后每批最多打开 10 个 WhatsApp 聊天。系统只填入文案，不会自动按发送。
10. 在 Leads 页面点击 `Create Email Campaign`，会把目前筛选的客户带入 Mailbox；系统不会再用无法追踪个人结果的 BCC。
11. 跟进完成后点击 `Done`，系统会进入下一次 Day 3 或 Day 7 follow-up。
12. 左侧 `Zoom` 页面可以保存每场活动的名称、日期时间、Zoom 报名链接，以及 WhatsApp / Email 通知内容。
13. `Preview Courses` 的自动课程组展开后，可单笔 `DELETE`，也可勾选多位 Lead、使用 `Select all` 和 `DELETE SELECTED` 批量删除；确认后会同步删除 Firestore 记录，云端失败时不会从页面移除。

## Zoom 报名与双渠道通知

- 公开报名页：`zoom.html`。客户只填写姓名、国际区号手机号码和 Email。
- 管理后台：主系统左侧 `Zoom`。管理员可以建立草稿、发布／关闭活动、查看报名与重新发送。
- 云端接口：`functions/` 内的 Firebase HTTPS Functions。公开接口不会返回 Zoom 链接。
- 自动通知：报名后立即发送，并由排程在开课前 24 小时和 1 小时提醒。
- WhatsApp 使用 Meta 核准模板；Email 使用 Resend。真正发送前需要先完成账号和域名审核。

上线前的 Firebase 设置：

1. 在 Firebase Authentication 启用 Anonymous 与 Google 登录。Anonymous 只用于首次进入；管理员应在 Mailbox 把现有已授权身份绑定到 Google 账号。
2. 在 `functions/` 安装依赖，并依照 `functions/.env.example` 设置非敏感参数。
3. 把管理员浏览器的 Firebase UID 设为 Functions 的 `ZOOM_ADMIN_UIDS`；页面不会显示登录或验证步骤，服务器会在后台静默确认权限。
4. 使用 Firebase Secret Manager 设置 `WHATSAPP_ACCESS_TOKEN`、`WHATSAPP_PHONE_NUMBER_ID` 与 `RESEND_API_KEY`。
5. 在 `config.js` 填入 Firebase App Check 的 reCAPTCHA site key，并把 `APP_CHECK_ENFORCED` 改为 `true`。
6. 部署 Functions 与 `firestore.rules` 后，先用测试活动、测试号码及测试邮箱验证，再发布真实活动。
7. Google Cloud 的预算只能发出告警；系统另以 `DAILY_SEND_LIMIT` 限制每日自动发送次数。

管理员身份绑定 Google 后，同一个 Google 账号在电脑 Chrome 与手机会取得同一 Firebase UID，因此不需要逐一授权浏览器。尚未绑定 Google 的旧浏览器身份，在清除资料或更换设备后仍会失效。

首次启用跨设备管理员登录：

1. 在 Firebase Console 的 Authentication → Sign-in method 启用 Google provider。
2. 用原本已获授权的 Chrome 打开 Mailbox，点击“使用 Google 管理员账号登录”。系统会把现有获授权 UID 绑定到该 Google 账号，不会移动 Leads、Campaign 或报告。
3. 手机打开同一网页，点击相同按钮并选择同一个 Google 账号。系统会取得同一 UID 与权限。
4. 不要在共用手机或电脑保持管理员账号登录；使用完毕可从 Mailbox 退出。

Meta 的两个核准模板都需要依序设置 5 个正文变量：客户姓名、活动名称、日期、时间、Zoom 链接。模板名称分别由 `WHATSAPP_TEMPLATE_CONFIRMATION` 与 `WHATSAPP_TEMPLATE_REMINDER` 指定。

Facebook 留言关键词使用 `ZOOM`。人工私讯链接范例：

`zoom.html?utm_source=facebook&utm_medium=comment&utm_campaign=zoom&keyword=ZOOM`

## 可追踪 Email Campaign

左侧 `Mailbox` 现在是站内 Campaign 中心，并保留一个次要的 Gmail 快捷入口。每位客户会收到独立 Email，系统通过 Resend Email ID 与已签名 webhook 显示：已发送、已送达、已开启（估算）、CTA 已点击、未点击、退信、失败、投诉与退订。

安全寄送流程固定为：

1. 从 Leads、Preview Leads 或 Landing Leads 勾选客户；Ebook Leads 目前没有 Email，因此不会出现。
2. 填写 Campaign 名称、标题、预览文字、正文、CTA 按钮和 HTTPS 链接并保存草稿。
3. 先寄到固定的管理员测试邮箱。
4. 审核有效、重复、无效、未同意及永久排除人数。
5. 确认客户已同意接收 Email，再由管理员点击最终发送。
6. 系统每批处理 25 人；关闭页面不会遗失进度，重新打开 Campaign 可继续。
7. 已完成的 Campaign 会保持邮件内容只读以保护历史记录；每天有新报名者时，点击记录旁或查看页内的「追加新收件人」。系统会保留原报告，只把相同 Email 排入尚未寄过的新收件人，并自动排除已经寄过的人。

没有自有域名时，可暂时把 `EMAIL_FROM` 设为 `Champion Academy <onboarding@resend.dev>`，但系统只允许寄到管理员测试邮箱的测试邮件；不会允许开始真实名单寄送。正式上线前必须先在 Resend 完成自有寄件域名的 SPF/DKIM 验证，把 `EMAIL_FROM` 改为 `Champion Academy <updates@已验证域名>`，并在域名设置启用 Open Tracking 与 Click Tracking。Webhook URL 是：

`https://champion-course-video-room.vercel.app/api/email-webhook`

Webhook 订阅 `email.sent`、`email.delivered`、`email.opened`、`email.clicked`、`email.bounced`、`email.failed`、`email.complained` 与 `email.suppressed`。开启数据会受图片拦截和隐私代理影响，CTA 点击才是主要指标。

Vercel 环境变量参考 `.env.vercel.example`，至少需要：

- `CRM_ADMIN_UIDS`：允许使用 Email Campaign 的 Firebase UID；
- `CRM_ADMIN_EMAILS`：允许跨设备登录的已验证 Google 管理员邮箱；服务器同时验证 `email_verified` 与 Google 登录提供者；
- `RESEND_API_KEY` 与 `RESEND_WEBHOOK_SECRET`；
- `EMAIL_FROM`：例如 `Champion Academy <updates@已验证域名>`；
- `EMAIL_REPLY_TO`：客户点击回复时收到邮件的官方邮箱，可使用 Gmail；
- `EMAIL_TEST_RECIPIENT`：管理员控制的测试邮箱；
- `EMAIL_UNSUBSCRIBE_SECRET`：长随机值，只能保存在 Vercel；
- `EMAIL_DAILY_SEND_LIMIT`：不得高于 Resend 账户的每日额度；
- `EMAIL_ALLOWED_ORIGINS` 与 `PUBLIC_API_BASE_URL`。

Email Campaign、收件人快照、Webhook、退订与发送上限资料都由 Vercel Firebase Admin SDK 存取，Firestore 浏览器规则明确拒绝直接访问。不要把 Resend Key、Webhook Secret、退订 Secret 或客户名单贴进聊天、写入前端或提交 Git。

正式客户寄送前，只使用管理员控制的测试邮箱完成一次送达、开启、CTA 点击和退订测试；部署或真实群发都需要负责人最后明确批准。

### 使用 Gmail API 寄送

如果 EMAIL_PROVIDER=gmail，系统会通过管理员授权的 Gmail 账号逐封寄送，不再调用 Resend。需要在 Google Cloud 启用 Gmail API，建立 OAuth 2.0 Client，并以 gmail.send scope 取得 offline refresh token。服务器端需要设置：

- GMAIL_SENDER_EMAIL：实际寄件 Gmail；
- GMAIL_CLIENT_ID、GMAIL_CLIENT_SECRET 与 GMAIL_REFRESH_TOKEN：只保存在 Vercel；
- EMAIL_TRACKING_SECRET：签署开启像素及 CTA 跳转链接；
- 其余 Campaign、管理员、退订和每日上限变量继续沿用。

Gmail API 只确认 Gmail 已接受发送请求，不提供可靠的收件服务器送达回执。系统自行记录开启（估算）、CTA 点击、未点击和退订；不会在追踪入口保存 IP 或 User-Agent。个人 Gmail 有每日和反垃圾限制，不应把此功能当作大批量营销发送平台。

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

## Vercel + Firestore + Cloudflare R2 视频后台

这个仓库现在也包含一个可部署到 Vercel 的安全视频后台：

- `/admin`：管理员登录、上传视频、首帧预览、编辑视频名称、复制观看链接、查看观看记录。
- `/watch/:id`：观众输入姓名、电话和观看密码后观看视频。
- `api/`：Vercel Serverless Functions，负责管理员验证、视频资料、观看记录、短期签名上传和播放链接。
- `public/`：云端后台和观看页。
- Firestore：保存视频资料、观看密码、期限和观看记录。
- Cloudflare R2：保存实际视频文件，并通过短期签名链接上传与播放。

部署需要在 Vercel 设置环境变量，参考 `.env.vercel.example`。R2 Bucket 必须允许 `https://champion-course-video-room.vercel.app` 使用 `PUT`、`GET` 和 `HEAD`，并允许 `Content-Type` 请求头。如果 `ADMIN_LOGIN_DISABLED=true`，后台会公开访问；正式对客户开放前建议改回 `false` 并设置强管理员密码。视频文件通过 Vercel API 产生的短期 signed URL 由浏览器直传 Cloudflare R2，避免触碰 Vercel Function request body 限制；Vercel API 只负责验证、签名和记录。
