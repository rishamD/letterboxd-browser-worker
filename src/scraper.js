import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";

chromium.use(stealth());

let browser;
let browserContext; // Persists across successful jobs

const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
];

// Helper to create a fresh context
async function createNewContext() {
    if (browserContext) await browserContext.close();
    browserContext = await browser.newContext({
        userAgent: userAgents[Math.floor(Math.random() * userAgents.length)],
        viewport: { width: 1280, height: 720 },
    });
    console.log("♻️ New Browser Context Created");
}

export async function initBrowser() {
    console.log("🚀 Initializing Browser for EC2 Instance...");
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
            "--disable-gpu",
            "--single-process",
            "--disable-blink-features=AutomationControlled",
        ],
    });
    await createNewContext();
}

export async function scrapePage(username, page = 1) {
    const pageObj = await browserContext.newPage();

    await pageObj.route("**/*", (route) => {
    const url = route.request().url();
    const type = route.request().resourceType();

    // 1. Block by Resource Type (Most effective)
    if (["font", "image", "media", "stylesheet", "other"].includes(type)) {
        return route.abort();
    }

    // 2. Block by Domain (Stop the hidden JS scripts that eat bandwidth)
    const blockList = [
        "google-analytics",
        "googletagmanager",
        "doubleclick",
        "amazon-adsystem",
        "intergient",
        "playwire",
        "btloader",
        "privacymanager",
        "googlesyndication",
        "creativecdn",
        "casalemedia",
        "rtbhouse"
    ];

    if (blockList.some(domain => url.includes(domain))) {
        return route.abort();
    }

    route.continue();
    });

    const targetUrl = `https://letterboxd.com/${username}/films/page/${page}/`;

    try {
        await new Promise(r => setTimeout(r, Math.random() * 1500 + 1000));

        const res = await pageObj.goto(targetUrl, {
            waitUntil: "networkidle",
            timeout: 60000,
        });

        if (res && res.status() === 403) {
            // Fetch the IP used for this blocked request to verify rotation
            let usedIp = "Unknown";
            try {
                const ipCheck = await pageObj.goto("https://api.ipify.org", { timeout: 5000 });
                usedIp = await ipCheck.text();
            } catch (e) {
                usedIp = "Failed to fetch IP during block";
            }

            console.error(`🚨 403 Forbidden at IP: ${usedIp}`);
            
            // Purge the current context so the next attempt starts fresh
            await createNewContext();
            throw new Error("403_BLOCKED");
        }

        if (!res || res.status() !== 200) throw new Error(`Status ${res?.status()}`);

        await pageObj.waitForSelector('[data-component-class="LazyPoster"]', { timeout: 15000 });

        const data = await pageObj.evaluate(({ isFirstPage }) => {
            const results = [];
            document.querySelectorAll('[data-component-class="LazyPoster"]').forEach((poster) => {
                const slug = poster.getAttribute("data-item-slug");
                const filmId = poster.getAttribute("data-film-id");
                const displayName = poster.getAttribute("data-item-full-display-name");
                let rating = null;

                const viewingData = poster.nextElementSibling;
                if (viewingData?.classList.contains("poster-viewingdata")) {
                    const ratingSpan = viewingData.querySelector(".rating");
                    if (ratingSpan) {
                        const ratedClass = [...ratingSpan.classList].find(c => c.includes("rated-"));
                        if (ratedClass) {
                            const score = ratedClass.match(/\d+/);
                            if (score) rating = parseInt(score[0], 10) / 2;
                        }
                    }
                }
                if (slug) results.push({ slug, filmId, displayName, rating });
            });

            let totalPages = 1;
            if (isFirstPage) {
                const lastLink = document.querySelector(".paginate-pages li:last-child a") || 
                                 document.querySelector(".paginate-pages a:last-of-type");
                if (lastLink) {
                    const match = lastLink.href.match(/\/page\/(\d+)\//);
                    if (match) totalPages = parseInt(match[1], 10);
                }
            }
            return { films: results, totalPages };
        }, { isFirstPage: page === 1 });

        await pageObj.close();
        return data;
    } catch (err) {
        await pageObj.close().catch(() => {});
        throw err;
    }
}