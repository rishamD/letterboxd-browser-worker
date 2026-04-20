import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import path from "path";
import { fileURLToPath } from "url";

chromium.use(stealth());

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let browser;
let browserContext;

const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
];

export async function initBrowser() {
    console.log("Starting browser with proxy configuration...");

    browser = await chromium.launch({
        headless: true,
        proxy: {
            server: process.env.PROXY_URL,
            username: process.env.PROXY_USER,
            password: process.env.PROXY_PASS,
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

    browserContext = await browser.newContext({
        userAgent: userAgents[Math.floor(Math.random() * userAgents.length)],
        viewport: { width: 1280, height: 720 },
        extraHTTPHeaders: {
            "sec-ch-ua":
                '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "upgrade-insecure-requests": "1",
            "accept-language": "en-US,en;q=0.9",
        },
    });

    console.log("✅ Browser Context Initialized");
}

export async function closeBrowser() {
    await browserContext?.close();
    await browser?.close();
    browserContext = undefined;
    browser = undefined;
}

export async function checkIp() {
    const page = await browserContext.newPage();
    await page.goto("https://api.ipify.org?format=json", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
    });
    const body = await page.textContent("body");
    await page.close();
    console.log("Browser IP:", body);
}

function extractFilmsFromPage(posters) {
    const results = [];

    posters.forEach((poster) => {
    const slug = poster.getAttribute("data-item-slug");
    const title = poster.getAttribute("data-item-full-display-name");
    let rating = null;

    const viewingData = poster.nextElementSibling;
    if (
        viewingData &&
        viewingData.classList.contains("poster-viewingdata")
    ) {
        const ratingSpan = viewingData.querySelector(".rating");
        if (ratingSpan) {
            const ratedClass = Array.from(ratingSpan.classList).find(
                (c) => c.includes("rated-")
            );
            if (ratedClass) {
                const scoreMatch = ratedClass.match(/\d+/);
                if (scoreMatch) {
                    rating = parseInt(scoreMatch[0], 10) / 2;
                }
            }
        }
    }

    if (slug) {
        results.push({ slug, title, rating });
    }
    });

    return results;
}

/**
 * Scrapes a single page and returns films found on it.
 * Page 1 also returns the total page count from the paginator.
 */
export async function scrapePage(username, page = 1) {
    const pageObj = await browserContext.newPage();

    await pageObj.route("**/*", (route) => {
        const type = route.request().resourceType();
        if (type === "font" || type === "image" || type === "media") {
            route.abort();
        } else {
            route.continue();
        }
    });

    const targetUrl =
        `https://letterboxd.com/${username}/films/page/${page}/`;

    console.log(`Navigating to: ${targetUrl}`);

    try {
        await pageObj.waitForTimeout(Math.random() * 2000 + 1000);

        const res = await pageObj.goto(targetUrl, {
            waitUntil: "domcontentloaded",
            timeout: 60000,
        });

        if (!res) throw new Error("No response from page");
        if (res.status() === 404) throw new Error("Page not found (404)");
        if (res.status() === 403)
            throw new Error("Cloudflare blocked the request (403)");

        await pageObj.waitForSelector(
            '[data-component-class="LazyPoster"]',
            { timeout: 15000 }
        );

        const { films, totalPages } = await pageObj.evaluate(
            ({ isFirstPage }) => {
                const posters = document.querySelectorAll(
                    '[data-component-class="LazyPoster"]'
                );

                // Reuse extraction logic in browser context
                const results = [];
                posters.forEach((poster) => {
                    const slug = poster.getAttribute("data-item-slug");
                    const filmId = poster.getAttribute("data-film-id");
                    const displayName = poster.getAttribute(
                        "data-item-full-display-name"
                    );
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

                    if (slug) {
                        results.push({ slug, filmId, displayName, rating });
                    }
                });

                // Extract total pages from paginator on page 1
                let totalPages = 1;
                if (isFirstPage) {
                    const lastPageLink = document.querySelector(
                        ".paginate-pages a.last-page, .pagination a[href*='/page/']:last-of-type"
                    );
                    if (lastPageLink) {
                        const match =
                            lastPageLink.href.match(/\/page\/(\d+)\//);
                        if (match) {
                            totalPages = parseInt(match[1], 10);
                        }
                    } else {
                        // Fallback: find highest page number in paginator
                        const allPageLinks = document.querySelectorAll(
                            ".paginate-pages a"
                        );
                        let max = 1;
                        allPageLinks.forEach((a) => {
                            const m = a.href.match(/\/page\/(\d+)\//);
                            if (m) max = Math.max(max, parseInt(m[1], 10));
                        });
                        totalPages = max;
                    }
                }

                return { films: results, totalPages };
            },
            { isFirstPage: page === 1 }
        );

        await pageObj.close();
        return { films, totalPages };
    } catch (err) {
        await pageObj
            .screenshot({
                path: `error_debug_page${page}.png`,
                animations: "disabled",
                timeout: 5000,
            })
            .catch(() => {});
        await pageObj.close().catch(() => {});
        throw err;
    }
}