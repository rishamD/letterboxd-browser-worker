import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let browserContext;

export async function initBrowser() {
    const userDataDir = path.join(__dirname, "../../user_data");

    console.log("Starting browser with proxy configuration...");

    browserContext = await chromium.launchPersistentContext(userDataDir, {
        headless: true,
        userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        proxy: {
            server: process.env.PROXY_URL,
            username: process.env.PROXY_USER,
            password: process.env.PROXY_PASS,
        },
        viewport: { width: 1280, height: 720 },
        extraHTTPHeaders: {
            "sec-ch-ua":
                '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "upgrade-insecure-requests": "1",
            "accept-language": "en-US,en;q=0.9",
        },
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-blink-features=AutomationControlled",
            "--disable-gpu",
            "--single-process",
        ],
    });

    console.log("✅ Browser Context Initialized");
}

export async function scrapeWithBrowser(username) {
    const page = await browserContext.newPage();

    // Block fonts, images, media to speed things up
    await page.route("**/*", (route) => {
        const type = route.request().resourceType();
        if (type === "font" || type === "image" || type === "media") {
            route.abort();
        } else {
            route.continue();
        }
    });

    try {
        const targetUrl = `https://letterboxd.com/${username}/films/`;
        console.log(`Navigating to: ${targetUrl}`);

        const response = await page.goto(targetUrl, {
            waitUntil: "domcontentloaded",
            timeout: 60000,
        });

        if (response.status() === 403) {
            throw new Error("Cloudflare blocked the request (403)");
        }

        await page.waitForSelector(
            '[data-component-class="LazyPoster"]',
            { timeout: 15000 }
        );

        const films = await page.evaluate(() => {
            const results = [];
            const posters = document.querySelectorAll(
                '[data-component-class="LazyPoster"]'
            );

            posters.forEach((poster) => {
                const slug = poster.getAttribute("data-item-slug");
                let rating = null;

                const viewingData = poster.nextElementSibling;
                if (
                    viewingData &&
                    viewingData.classList.contains("poster-viewingdata")
                ) {
                    const ratingSpan = viewingData.querySelector(".rating");
                    if (ratingSpan) {
                        const ratedClass = Array.from(
                            ratingSpan.classList
                        ).find((c) => c.includes("rated-"));
                        if (ratedClass) {
                            const scoreMatch = ratedClass.match(/\d+/);
                            if (scoreMatch) {
                                rating = parseInt(scoreMatch[0], 10) / 2;
                            }
                        }
                    }
                }

                if (slug) results.push({ slug, rating });
            });

            return results;
        });

        await page.close();
        return films;
    } catch (err) {
        await page
            .screenshot({
                path: "error_debug.png",
                animations: "disabled",
                timeout: 5000,
            })
            .catch(() => {});
        await page.close();
        throw err;
    }
}