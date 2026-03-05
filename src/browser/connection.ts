/**
 * Chrome CDP connection management.
 * Connects to an existing Chrome instance or launches one.
 */

import { chromium, type Browser } from "playwright";

export const CDP_URL = "http://localhost:18792";
export const CHROME_USER_DATA = "C:\\Users\\steve\\.openclaw\\browser\\chrome\\user-data";
export const CHROME_EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

export interface ConnectionOptions {
  cdpUrl?: string;
  userDataDir?: string;
  chromeExe?: string;
  /** If true, don't attempt to launch Chrome on connection failure */
  noLaunch?: boolean;
}

/**
 * Connect to Chrome via CDP. If not running, launches it.
 * Returns a Playwright Browser handle.
 */
export async function connectChrome(opts: ConnectionOptions = {}): Promise<Browser> {
  const cdpUrl = opts.cdpUrl ?? CDP_URL;
  const userDataDir = opts.userDataDir ?? CHROME_USER_DATA;
  const chromeExe = opts.chromeExe ?? CHROME_EXE;

  try {
    const browser = await chromium.connectOverCDP(cdpUrl);
    return browser;
  } catch (err) {
    if (opts.noLaunch) {
      throw new Error(`Chrome not available on ${cdpUrl} and noLaunch=true`);
    }

    const { execSync } = await import("child_process");
    execSync(
      `start "" "${chromeExe}" --remote-debugging-port=18792 --remote-debugging-address=127.0.0.1 "--user-data-dir=${userDataDir}"`,
      { shell: "cmd.exe" }
    );

    // Wait for Chrome to start
    await new Promise((r) => setTimeout(r, 5000));

    try {
      return await chromium.connectOverCDP(cdpUrl);
    } catch (retryErr) {
      throw new Error(
        `Cannot connect to Chrome on ${cdpUrl} after launch attempt. ` +
        `Try: openclaw browser start profile=chrome`
      );
    }
  }
}

/**
 * Get or create an incognito context on a browser.
 * Incognito is needed for ServiceNow SSO isolation.
 */
export async function getIncognitoContext(browser: Browser) {
  return browser.newContext();
}

/**
 * Get the default (non-incognito) context.
 * Used for DRIVE admin pages that share the regular Chrome auth.
 */
export function getDefaultContext(browser: Browser) {
  const contexts = browser.contexts();
  return contexts.length > 0 ? contexts[0] : null;
}
