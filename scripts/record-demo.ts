#!/usr/bin/env npx ts-node
/**
 * DarwinFi Demo Screen Recorder
 * Uses Playwright to capture 5 scenes from the dapp at 1920x1080.
 * Each scene is saved as a separate .webm file.
 *
 * Scene 0 (Maxwell's intro) is recorded separately by Maxwell.
 * This script records scenes 1-5 (Darwin narration scenes).
 */

import { chromium, Browser, BrowserContext, Page } from "playwright";
import * as path from "path";
import * as fs from "fs";

const DAPP_URL = "https://corduroycloud.com/darwinfi/";
const BASESCAN_V4 =
  "https://basescan.org/address/0x4a55DEEC24C6b5c1aa6301b43b4D9680c10491d7";
const OUTPUT_DIR = path.join(__dirname, "..", "demo-output", "recordings");
const VIEWPORT = { width: 1920, height: 1080 };

// Scene timing (milliseconds)
const SCENE_CONFIG = {
  dashboard: { duration: 30_000, description: "Landing page + hero + TVL + Golden Rule" },
  vault: { duration: 35_000, description: "Deposit card + share price + vault info" },
  instinct: { duration: 40_000, description: "Advanced > Instinct predictions + signals" },
  tournament: { duration: 40_000, description: "Advanced > Tournament + Evolution tabs" },
  closing: { duration: 20_000, description: "BaseScan V4 vault + dapp hero" },
};

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createRecordingContext(
  browser: Browser,
  sceneName: string
): Promise<{ context: BrowserContext; page: Page }> {
  const videoDir = path.join(OUTPUT_DIR, sceneName);
  fs.mkdirSync(videoDir, { recursive: true });

  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: {
      dir: videoDir,
      size: VIEWPORT,
    },
    colorScheme: "dark",
  });

  const page = await context.newPage();
  return { context, page };
}

/**
 * Scene 1: Dashboard
 * Navigate to /, scroll through vault stats, share price, TVL
 */
async function recordDashboard(browser: Browser): Promise<void> {
  console.log("\n--- Scene 1: Dashboard ---");
  const { context, page } = await createRecordingContext(browser, "dashboard");

  await page.goto(DAPP_URL, { waitUntil: "load", timeout: 30_000 });
  await sleep(5000); // Let page fully render

  // Start at top -- show hero section
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  await sleep(5000);

  // Scroll down to reveal vault stats, TVL, share price
  await page.evaluate(() => {
    window.scrollTo({ top: 400, behavior: "smooth" });
  });
  await sleep(8000);

  // Continue scrolling to show more dashboard content
  await page.evaluate(() => {
    window.scrollTo({ top: 800, behavior: "smooth" });
  });
  await sleep(7000);

  // Scroll back to top for clean transition
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  await sleep(5000);

  await context.close();
  console.log("  Dashboard recorded.");
}

/**
 * Scene 2: Vault
 * Stay on Dashboard, scroll to deposit card area and vault info
 */
async function recordVault(browser: Browser): Promise<void> {
  console.log("\n--- Scene 2: Vault ---");
  const { context, page } = await createRecordingContext(browser, "vault");

  await page.goto(DAPP_URL, { waitUntil: "load", timeout: 30_000 });
  await sleep(3000);

  // Scroll to deposit/vault section
  await page.evaluate(() => {
    window.scrollTo({ top: 300, behavior: "smooth" });
  });
  await sleep(5000);

  // Look for deposit card or vault info section and scroll into view
  const depositSection = await page.$('[class*="deposit"], [class*="vault"], [data-testid="deposit"]');
  if (depositSection) {
    await depositSection.scrollIntoViewIfNeeded();
    await sleep(3000);
  }

  // Scroll through vault information
  await page.evaluate(() => {
    window.scrollTo({ top: 600, behavior: "smooth" });
  });
  await sleep(8000);

  // Show share price area
  await page.evaluate(() => {
    window.scrollTo({ top: 900, behavior: "smooth" });
  });
  await sleep(7000);

  // Scroll back
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  await sleep(5000);

  await context.close();
  console.log("  Vault recorded.");
}

/**
 * Scene 3: Instinct (Live Trading)
 * Navigate to /advanced?tab=instinct, show predictions and signals
 */
async function recordInstinct(browser: Browser): Promise<void> {
  console.log("\n--- Scene 3: Instinct (Live Trading) ---");
  const { context, page } = await createRecordingContext(browser, "instinct");

  // Navigate directly to Advanced > Instinct tab
  await page.goto(`${DAPP_URL}advanced?tab=instinct`, {
    waitUntil: "load",
    timeout: 30_000,
  });
  await sleep(5000);

  // Show the predictions and confidence scores
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  await sleep(5000);

  // Scroll through instinct signals
  await page.evaluate(() => {
    window.scrollTo({ top: 400, behavior: "smooth" });
  });
  await sleep(8000);

  // Scroll further to show sentiment/calibration data
  await page.evaluate(() => {
    window.scrollTo({ top: 800, behavior: "smooth" });
  });
  await sleep(8000);

  // Scroll through trade history
  await page.evaluate(() => {
    window.scrollTo({ top: 1200, behavior: "smooth" });
  });
  await sleep(8000);

  // Back to top
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  await sleep(4000);

  await context.close();
  console.log("  Instinct recorded.");
}

/**
 * Scene 4: Tournament + Evolution
 * Navigate to /advanced?tab=tournament, scroll leaderboard,
 * then click "Evolution" tab, show evolution panel + audit
 */
async function recordTournament(browser: Browser): Promise<void> {
  console.log("\n--- Scene 4: Tournament & Evolution ---");
  const { context, page } = await createRecordingContext(browser, "tournament");

  // Navigate to Advanced > Tournament tab
  await page.goto(`${DAPP_URL}advanced?tab=tournament`, {
    waitUntil: "load",
    timeout: 30_000,
  });
  await sleep(5000);

  // Show the tournament leaderboard
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  await sleep(5000);

  // Scroll through the 16-strategy leaderboard
  await page.evaluate(() => {
    window.scrollTo({ top: 400, behavior: "smooth" });
  });
  await sleep(6000);

  await page.evaluate(() => {
    window.scrollTo({ top: 800, behavior: "smooth" });
  });
  await sleep(6000);

  // Now click on Evolution tab
  const evolutionTab = await page.$(
    'button:has-text("Evolution"), a:has-text("Evolution"), [data-tab="evolution"]'
  );
  if (evolutionTab) {
    await evolutionTab.click();
    await sleep(5000);
  } else {
    // Try navigating directly
    await page.goto(`${DAPP_URL}advanced?tab=evolution`, {
      waitUntil: "load",
      timeout: 30_000,
    });
    await sleep(5000);
  }

  // Show evolution panel + audit data
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  await sleep(5000);

  await page.evaluate(() => {
    window.scrollTo({ top: 400, behavior: "smooth" });
  });
  await sleep(6000);

  await context.close();
  console.log("  Tournament & Evolution recorded.");
}

/**
 * Scene 5: Closing
 * Go to BaseScan V4 vault page, then back to DApp hero
 */
async function recordClosing(browser: Browser): Promise<void> {
  console.log("\n--- Scene 5: Closing ---");
  const { context, page } = await createRecordingContext(browser, "closing");

  // Show BaseScan contract page for V4 vault
  await page.goto(BASESCAN_V4, { waitUntil: "load", timeout: 30_000 });
  await sleep(8000);

  // Navigate back to dapp hero shot
  await page.goto(DAPP_URL, { waitUntil: "load", timeout: 30_000 });
  await sleep(8000);

  // Final hero shot at top
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  await sleep(4000);

  await context.close();
  console.log("  Closing recorded.");
}

async function main(): Promise<void> {
  console.log("DarwinFi Demo Screen Recorder");
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log(`Viewport: ${VIEWPORT.width}x${VIEWPORT.height}\n`);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    await recordDashboard(browser);
    await recordVault(browser);
    await recordInstinct(browser);
    await recordTournament(browser);
    await recordClosing(browser);

    // Collect all video files
    console.log("\n=== Recording Complete ===");
    console.log("Video files:");
    for (const scene of Object.keys(SCENE_CONFIG)) {
      const sceneDir = path.join(OUTPUT_DIR, scene);
      if (fs.existsSync(sceneDir)) {
        const files = fs.readdirSync(sceneDir).filter((f) => f.endsWith(".webm"));
        for (const file of files) {
          const fullPath = path.join(sceneDir, file);
          const sizeKB = fs.statSync(fullPath).size / 1024;
          // Rename to scene name for easier compositing
          const destPath = path.join(OUTPUT_DIR, `${scene}.webm`);
          fs.renameSync(fullPath, destPath);
          console.log(`  ${scene}.webm (${sizeKB.toFixed(1)} KB)`);
        }
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`\nAll recordings saved to: ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error("Recording failed:", err);
  process.exit(1);
});
