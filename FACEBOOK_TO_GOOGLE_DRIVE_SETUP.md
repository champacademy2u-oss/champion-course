# Facebook Lead Form 自动同步到 Google Drive CSV

这个服务会接收 Meta Lead Ads Webhook，当 Facebook Lead Form 有新名单时，自动把资料追加到 Google Drive 的 CSV 文件。

## 你需要准备

1. 一个 Meta Developer App，并开启 Webhooks / Lead Ads。
2. 一个长期 Page Access Token。
3. 一个 Google Cloud service account。
4. Google Drive 里一个资料夹，并把该资料夹分享给 service account email。

## Meta 权限

读取 Lead Ads 通常需要：

- `leads_retrieval`
- `pages_show_list`
- `pages_read_engagement`
- `pages_manage_metadata`
- `pages_manage_ads`
- 如需广告层级字段，再加 `ads_management`

注意：Lead Form 是挂在 Facebook Page 上，Webhook 也是订阅 Page 的 `leadgen` 事件。你的“业务资产组合所有广告账户”如果共用多个 Page，需要把这些 Page 都安装/订阅到同一个 Meta App。

## Google Drive 设置

1. 在 Google Cloud 创建 service account。
2. 下载 JSON key，保存成 `google-service-account.json`。
3. 到 Google Drive 创建一个 folder。
4. 把 folder 分享给 service account 的 email。
5. 从 folder URL 复制 folder id。

## 本机/服务器设置

复制环境变量：

```bash
cp .env.example .env
```

填入：

- `META_VERIFY_TOKEN`: 自己设一个随机字串，之后 Meta webhook 验证会用到。
- `META_APP_SECRET`: Meta App Secret。
- `META_PAGE_ACCESS_TOKEN`: 长期 Page Access Token，适合只有一个 Facebook Page。
- `META_PAGE_ID`: 单个 Page 时，用来批量订阅 webhook。
- `META_PAGE_ACCESS_TOKENS`: 多个 Page 时使用 JSON，例如 `{"1234567890":"page-token-1","9876543210":"page-token-2"}`。
- `GOOGLE_DRIVE_FOLDER_ID`: Google Drive folder id。
- `GOOGLE_DRIVE_CSV_NAME`: 例如 `facebook-leads.csv`。
- `GOOGLE_SERVICE_ACCOUNT_FILE`: service account JSON 文件路径。

安装并启动：

```bash
npm install
npm run check:config
npm start
```

如果你已经填好 Page tokens，可以订阅所有 Page 的 Lead Form webhook：

```bash
npm run meta:subscribe-pages
```

默认服务会跑在：

```text
http://localhost:4175
```

Webhook endpoint：

```text
https://你的公开域名/webhook
```

本机测试时可以用 ngrok / Cloudflare Tunnel 把 `localhost:4175` 暴露成 HTTPS。

## CSV 栏位

自动生成的 CSV 会包含：

```csv
leadgen_id,created_time,full_name,phone_number,email,job_title,page_id,form_id,ad_id,adgroup_id,campaign_id,raw_fields_json
```

服务会用 `leadgen_id` 去重；同一个 lead 重复推送时不会重复追加。

## 和现有 Lead Center 的关系

现有网页工具仍然可以手动导入 CSV。这个自动化服务只负责把 Facebook 新名单同步到 Google Drive CSV；你之后也可以从 Google Drive 下载 CSV，再导入现有 Lead Center。
