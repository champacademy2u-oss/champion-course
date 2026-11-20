import { handleEmailCampaignRequest } from '../lib/email-campaign-api.js';
import handleEmailTrackingRequest from './email-track.js';
import handleEmailUnsubscribeRequest from './unsubscribe.js';
import handleEmailImageRequest from './email-image.js';
import handleChampLibraryRequest from './champ-library.js';
import handleCustomerReceiptsRequest from './customer-receipts.js';

export default async function handler(req, res) {
  const pathname = new URL(req.url, 'https://local').pathname;
  if (pathname.endsWith('/customer-receipts')) return handleCustomerReceiptsRequest(req, res);
  if (pathname.endsWith('/champ-library')) return handleChampLibraryRequest(req, res);
  if (pathname.endsWith('/unsubscribe')) return handleEmailUnsubscribeRequest(req, res);
  if (pathname.endsWith('/email-track')) return handleEmailTrackingRequest(req, res);
  if (pathname.endsWith('/email-image')) return handleEmailImageRequest(req, res);
  return handleEmailCampaignRequest(req, res);
}
