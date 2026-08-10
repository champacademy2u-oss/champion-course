import { handleEmailCampaignRequest } from '../lib/email-campaign-api.js';
import handleEmailTrackingRequest from './email-track.js';
import handleEmailUnsubscribeRequest from './unsubscribe.js';

export default async function handler(req, res) {
  const pathname = new URL(req.url, 'https://local').pathname;
  if (pathname.endsWith('/unsubscribe')) return handleEmailUnsubscribeRequest(req, res);
  if (pathname.endsWith('/email-track')) return handleEmailTrackingRequest(req, res);
  return handleEmailCampaignRequest(req, res);
}
