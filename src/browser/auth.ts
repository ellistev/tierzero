/**
 * Authentication helpers for SSO and org modals.
 * Handles the waiting-for-human-login pattern used across
 * both ServiceNow and DRIVE admin pages.
 */

import type { Page } from "playwright";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Wait for the user to complete SSO login on a page.
 * Polls the URL to detect when login is complete.
 */
export async function waitForSSOLogin(
  page: Page,
  options: {
    /** Domain that indicates successful login */
    expectedDomain: string;
    /** URL substrings that indicate we're on a login page */
    loginIndicators?: string[];
    /** Callback when waiting starts */
    onWaiting?: () => void;
    /** Callback when login detected */
    onLoggedIn?: () => void;
    /** Poll interval in ms (default 5000) */
    pollInterval?: number;
  }
): Promise<boolean> {
  const pollInterval = options.pollInterval ?? 5000;
  const loginIndicators = options.loginIndicators ?? [
    "login", "auth", "adfs", "microsoftonline", "sso",
  ];

  const currentUrl = page.url();
  const isOnLoginPage =
    !currentUrl.includes(options.expectedDomain) ||
    loginIndicators.some((ind) => currentUrl.includes(ind));

  if (!isOnLoginPage) return true; // Already logged in

  options.onWaiting?.();

  while (true) {
    await sleep(pollInterval);
    try {
      const url = page.url();
      const loggedIn =
        url.includes(options.expectedDomain) &&
        !loginIndicators.some((ind) => url.includes(ind));

      if (loggedIn) {
        options.onLoggedIn?.();
        await sleep(2000); // Let the page settle
        return true;
      }
    } catch {
      // Page may navigate during SSO flow -- expected
    }
  }
}

/**
 * Handle the SGI org modal that appears on DRIVE admin pages.
 * Clicks "SGI Head Office" then "Change/Confirm Organization",
 * then re-navigates to the target URL.
 */
export async function handleOrgModal(page: Page, targetUrl: string): Promise<void> {
  const headOfficeBtn = page
    .locator("button")
    .filter({ hasText: "SGI Head Office" })
    .first();

  try {
    await headOfficeBtn.waitFor({ state: "visible", timeout: 5000 });
    await headOfficeBtn.click();
    await sleep(1500);

    const confirmBtn = page
      .locator("button")
      .filter({ hasText: /Change Organization|Confirm Organization/i })
      .first();
    await confirmBtn.click();
    await sleep(2000);

    // Modal causes redirect -- re-navigate
    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    await sleep(3000);
  } catch {
    // No modal appeared -- that's fine
  }
}

/**
 * Navigate to a DRIVE admin URL, handling SSO login and org modal.
 */
export async function navigateWithAuth(
  page: Page,
  url: string,
  options?: {
    onWaiting?: () => void;
    onLoggedIn?: () => void;
    onModalHandled?: () => void;
  }
): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await sleep(3000);

  // Check for SSO redirect
  await waitForSSOLogin(page, {
    expectedDomain: "drive.sgicloud.ca",
    onWaiting: options?.onWaiting ?? (() => {}),
    onLoggedIn: async () => {
      options?.onLoggedIn?.();
      // Re-navigate after login
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await sleep(3000);
    },
  });

  // Handle org modal
  await handleOrgModal(page, url);
  options?.onModalHandled?.();
}

function sleep2(ms: number) { return new Promise(r => setTimeout(r, ms)); }
