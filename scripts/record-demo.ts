#!/usr/bin/env npx ts-node
/**
 * DarwinFi Demo Screen Recorder
 * Uses Playwright to capture 5 scenes from the dapp at 1920x1080.
 * Each scene is saved as a separate .webm file.
 */

import { chromium, Browser, BrowserContext, Page } from "playwright";
import * as path from "path";
import * as fs from "fs";

const DAPP_URL = "https://corduroycloud.com/darwinfi/";
const OUTPUT_DIR = path.join(__dirname, "..", "demo-output", "recordings");
const VIEWPORT = { width: 1920, height: 1080 };

// Scene timing (milliseconds)
const SCENE_CONFIG = {
  intro: { duration: 25_000, description: "Landing page + hero + TVL" },
  vault: { duration: 40_000, description: "Deposit UI + share balance" },
  trading: { duration: 50_000, description: "Instinct signals + trade feed" },
  tournament: { duration: 50_000, description: "Tournament + Evolution tabs" },
  outro: { duration: 25_000, description: "BaseScan + dapp URL visible" },
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

async function recordIntro(browser: Browser): Promise<void> {
  console.log("\n--- Scene 1: Intro ---");
  const { context, page } = await createRecordingContext(browser, "intro");

  await page.goto(DAPP_URL, { waitUntil: "networkidle", timeout: 30_000 });
  await sleep(3000); // Let WebGL shader render

  // Scroll slowly to reveal TVL, share price, vault info
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  await sleep(5000);

  // Scroll down to show vault stats
  await page.evaluate(() => {
    window.scrollTo({ top: 400, behavior: "smooth" });
  });
  await sleep(8000);

  // Scroll back to top
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  await sleep(5000);

  await context.close();
  console.log("  Intro recorded.");
}

async function recordVault(browser: Browser): Promise<void> {
  console.log("\n--- Scene 2: Vault ---");
  const { context, page } = await createRecordingContext(browser, "vault");

  await page.goto(DAPP_URL, { waitUntil: "networkidle", timeout: 30_000 });
  await sleep(2000);

  // Navigate to Portfolio tab if it exists
  const portfolioLink = await page.$('a[href*="portfolio"], button:has-text("Portfolio")');
  if (portfolioLink) {
    await portfolioLink.click();
    await sleep(3000);
  }

  // Show the deposit card area
  const depositSection = await page.$('text=Deposit, [class*="deposit"], [data-testid="deposit"]');
  if (depositSection) {
    await depositSection.scrollIntoViewIfNeeded();
    await sleep(3000);
  }

  // Scroll through vault information
  await page.evaluate(() => {
    window.scrollTo({ top: 300, behavior: "smooth" });
  });
  await sleep(5000);

  await page.evaluate(() => {
    window.scrollTo({ top: 600, behavior: "smooth" });
  });
  await sleep(5000);

  // Scroll back
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  await sleep(5000);

  await context.close();
  console.log("  Vault recorded.");
}

async function recordTrading(browser: Browser): Promise<void> {
  console.log("\n--- Scene 3: Trading ---");
  const { context, page } = await createRecordingContext(browser, "trading");

  await page.goto(DAPP_URL, { waitUntil: "networkidle", timeout: 30_000 });
  await sleep(2000);

  // Navigate to Instinct tab
  const instinctLink = await page.$('a[href*="instinct"], button:has-text("Instinct")');
  if (instinctLink) {
    await instinctLink.click();
    await sleep(5000);
  }

  // Show the signals and predictions
  await page.evaluate(() => {
    window.scrollTo({ top: 400, behavior: "smooth" });
  });
  await sleep(8000);

  // Scroll through trade history
  await page.evaluate(() => {
    window.scrollTo({ top: 800, behavior: "smooth" });
  });
  await sleep(8000);

  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  await sleep(5000);

  await context.close();
  console.log("  Trading recorded.");
}

async function recordTournament(browser: Browser): Promise<void> {
  console.log("\n--- Scene 4: Tournament & Evolution ---");
  const { context, page } = await createRecordingContext(browser, "tournament");

  await page.goto(DAPP_URL, { waitUntil: "networkidle", timeout: 30_000 });
  await sleep(2000);

  // Navigate to Tournament tab
  const tournamentLink = await page.$('a[href*="tournament"], button:has-text("Tournament")');
  if (tournamentLink) {
    await tournamentLink.click();
    await sleep(5000);
  }

  // Scroll through standings
  await page.evaluate(() => {
    window.scrollTo({ top: 400, behavior: "smooth" });
  });
  await sleep(8000);

  // Look for Advanced or Evolution sub-tab
  const advancedLink = await page.$('a[href*="advanced"], button:has-text("Advanced")');
  if (advancedLink) {
    await advancedLink.click();
    await sleep(5000);
  }

  // Scroll through evolution data
  await page.evaluate(() => {
    window.scrollTo({ top: 600, behavior: "smooth" });
  });
  await sleep(8000);

  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  await sleep(5000);

  await context.close();
  console.log("  Tournament recorded.");
}

async function recordOutro(browser: Browser): Promise<void> {
  console.log("\n--- Scene 5: Outro ---");
  const { context, page } = await createRecordingContext(browser, "outro");

  // Show BaseScan contract page
  await page.goto(
    "https://basescan.org/address/0xb01aD1140d7acA150BF56D7516Bd44eE64970FE3",
    { waitUntil: "load", timeout: 30_000 }
  );
  await sleep(8000);

  // Navigate back to dapp (URL visible in browser)
  await page.goto(DAPP_URL, { waitUntil: "networkidle", timeout: 30_000 });
  await sleep(8000);

  // Final hero shot
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  await sleep(5000);

  await context.close();
  console.log("  Outro recorded.");
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
    await recordIntro(browser);
    await recordVault(browser);
    await recordTrading(browser);
    await recordTournament(browser);
    await recordOutro(browser);

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
