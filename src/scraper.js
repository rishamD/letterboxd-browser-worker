import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";

chromium.use(stealth());

let browser;
let browserContext;

const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
];

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
        ],
    });

    browserContext = await browser.newContext({
        userAgent: userAgents[Math.floor(Math.random() * userAgents.length)],
        viewport: { width: 1280, height: 720 },
    });
}

export async function closeBrowser() {
    await browserContext?.close();
    await browser?.close();
}

export async function scrapePage(username, page = 1) {
    const pageObj = await browserContext.newPage();

    // Block non-essential resources to speed up page load
    await pageObj.route("**/*", (route) => {
        const type = route.request().resourceType();
        if (["font", "image", "media", "stylesheet", "other"].includes(type)) {
            route.abort();
        } else {
            route.continue();
        }
    });

    const targetUrl = `https://letterboxd.com/${username}/films/page/${page}/`;

    try {
        // Human-like delay
        await new Promise(r => setTimeout(r, Math.random() * 1500 + 500));

        const res = await pageObj.goto(targetUrl, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
        });

        if (!res || res.status() !== 200) throw new Error(`Status ${res?.status()}`);

        await pageObj.waitForSelector('[data-component-class="LazyPoster"]', { timeout: 15000 });

        const data = await pageObj.evaluate(({ isFirstPage }) => {
            const results = [];
            const posters = document.querySelectorAll('[data-component-class="LazyPoster"]');

            posters.forEach((poster) => {
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