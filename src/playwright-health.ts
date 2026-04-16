import { chromium } from "playwright";
import { hasConnectedPlaywrightBrowser } from "./runner";

export type PlaywrightHealth = {
  status: "connected" | "available" | "unavailable";
  message: string;
  timestamp: string;
};

export const checkPlaywrightHealth = async (timeoutMs = 3000): Promise<PlaywrightHealth> => {
  const timestamp = new Date().toISOString();

  if (hasConnectedPlaywrightBrowser()) {
    return {
      status: "connected",
      message: "Playwright browser is running",
      timestamp
    };
  }

  try {
    const launched = await Promise.race([
      chromium.launch({ headless: true }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Launch timeout")), timeoutMs))
    ]);

    await launched.close();
    return {
      status: "available",
      message: "Playwright can launch browsers",
      timestamp
    };
  } catch (error) {
    return {
      status: "unavailable",
      message: error instanceof Error ? error.message : "Playwright is not available",
      timestamp
    };
  }
};

