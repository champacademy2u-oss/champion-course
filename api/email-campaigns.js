import { handleEmailCampaignRequest, handleEmailUnsubscribeRequest } from '../lib/email-campaign-api.js';

export default async function handler(req, res) {
  if (new URL(req.url, 'https://local').pathname.endsWith('/unsubscribe')) {
    return handleEmailUnsubscribeRequest(req, res);
  }
  return handleEmailCampaignRequest(req, res);
}
