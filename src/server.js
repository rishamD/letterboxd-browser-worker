const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { scrapeWithBrowser } = require('./scraper');

// Use stealth to bypass bot detection
chromium.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 8081;

app.use(cors());

let browser = null;

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        browser: browser ? 'connected' : 'initializing' 
    });
});

async function initBrowser() {
    try {
        console.log("Launching persistent browser...");
        const proxyRaw = process.env.PROXY_LIST;
        if (!proxyRaw) {
            console.error("ERROR: PROXY_LIST environment variable is not set!");
            process.exit(1);
        }

        const proxyUrl = new URL(proxyRaw);

        browser = await chromium.launch({
            // SET TO FALSE TO SEE THE WINDOW ON YOUR LAPTOP
            headless: true, 
            proxy: {
                server: `${proxyUrl.protocol}//${proxyUrl.host}`,
                username: proxyUrl.username,
                password: proxyUrl.password
            },
            extraHTTPHeaders: {
                'sec-ch-ua': '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'upgrade-insecure-requests': '1',
                'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'accept-language': 'en-US,en;q=0.9',
            },
            args: [
                '--no-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--use-fake-ui-for-media-stream',
                '--window-size=1920,1080'
            ]
        });
        console.log("Browser ready.");
    } catch (err) {
        console.error("Browser Launch Failed:", err.message);
        setTimeout(initBrowser, 5000); // Retry after 5s
    }
}

app.get('/browser', async (req, res) => {
    const user = req.query.user;
    if (!user) return res.status(400).json({ error: 'missing ?user=' });

    if (!browser) {
        return res.status(503).json({ error: 'Browser warming up...' });
    }

    try {
        const slugs = await scrapeWithBrowser(browser, user);
        return res.json({ user, latest50: slugs });
    } catch (e) {
        console.error("Request Error:", e.message);
        return res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Worker online on http://localhost:${PORT}`);
    initBrowser();
});