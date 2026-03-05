export { connectChrome, getIncognitoContext, getDefaultContext } from "./connection";
export { waitForSSOLogin, handleOrgModal, navigateWithAuth } from "./auth";
export {
  openServiceNow,
  listTickets,
  readTicketDetail,
  downloadAttachment,
  postComment,
  SERVICENOW_BASE,
  DRIVE_ALERTS_LIST_URL,
  type ScrapedTicketSummary,
  type ScrapedTicketDetail,
  type ServiceNowSession,
} from "./servicenow-scraper";
export {
  checkAclQueue,
  pollAclCompletion,
  searchStream,
  expandEventRow,
  findQuoteId,
  appendCorrectionAndBind,
  submitPaymentRepair,
  lookupPlate,
  ACL_QUEUE_URL,
  DATA_EXPLORER_URL,
  PAYMENT_REPAIR_URL,
  type AclFailurePattern,
  type PlateLookupResult,
} from "./drive-admin";
