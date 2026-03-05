/**
 * Browser core - generic connection and auth helpers.
 * Ticketing-system-specific automation lives in skills/.
 */
export { connectChrome, getIncognitoContext, getDefaultContext, CDP_URL, CHROME_USER_DATA, CHROME_EXE } from "./connection";
export { waitForSSOLogin, handleOrgModal, navigateWithAuth } from "./auth";
