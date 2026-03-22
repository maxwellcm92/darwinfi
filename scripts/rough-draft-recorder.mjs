import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { join, dirname } from "path";

const WORK_DIR = process.argv[2];
const DAPP_URL = "https://corduroycloud.com/darwinfi/";
const VP = { width: 1920, height: 1080 };

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function recordScene(browser, name, url, scrollSteps) {
    const videoDir = join(WORK_DIR, `vid-${name}`);
    mkdirSync(videoDir, { recursive: true });

    const context = await browser.newContext({
        viewport: VP,
        recordVideo: { dir: videoDir, size: VP },
        colorScheme: "dark",
    });
    const page = await context.newPage();

    await page.goto(url, { waitUntil: "load", timeout: 30000 });
    await sleep(3000);

    for (const [y, waitMs] of scrollSteps) {
        await page.evaluate((scrollY) => {
            window.scrollTo({ top: scrollY, behavior: "smooth" });
        }, y);
        await sleep(waitMs);
    }

    const videoPath = await page.video().path();
    await context.close();
    console.log(`  ${name}: ${videoPath}`);
    return videoPath;
}

(async () => {
    const browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    try {
        // Scene: Dashboard (~12s) - hero, scroll through vault stats
        await recordScene(browser, "dashboard", DAPP_URL, [
            [0, 3000],      // stay at top, show hero
            [400, 3000],    // scroll to vault stats
            [800, 3000],    // scroll further
        ]);

        // Scene: Instinct (~12s) - predictions and signals
        await recordScene(browser, "instinct", `${DAPP_URL}advanced?tab=instinct`, [
            [0, 3000],      // show predictions header
            [400, 3000],    // scroll through signals
            [800, 3000],    // more content
        ]);
    } finally {
        await browser.close();
    }
    console.log("  Recordings complete.");
})();
