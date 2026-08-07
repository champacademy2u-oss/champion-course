import { handleEmailCampaignRequest } from '../lib/email-campaign-api.js';

export default async function handler(req, res) {
  return handleEmailCampaignRequest(req, res);
}
