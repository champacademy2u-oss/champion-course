import { handleEmailUnsubscribeRequest } from '../lib/email-campaign-api.js';

export default async function handler(req, res) {
  return handleEmailUnsubscribeRequest(req, res);
}
