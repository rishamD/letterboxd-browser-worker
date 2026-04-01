require('dotenv').config();
const express = require('express');
const { chromium } = require('playwright');
const path = require('path');
const { scrapeWithBrowser } = require('./scraper');

const app = express();

// Use the PORT from environment variables, or default to 8081
const PORT = process.env.PORT || 8081;

let browserContext;

async function initBrowser() {
    const userDataDir = path.join(__dirname, '../user_data');
    
    console.log("Starting browser with proxy configuration...");

    // Launching persistent context
    // It pulls PROXY_URL, PROXY_USER, and PROXY_PASS from the system environment
    browserContext = await chromium.launchPersistentContext(userDataDir, {
        headless: true,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        proxy: {
            server: process.env.PROXY_URL,
            username: process.env.PROXY_USER,
            password: process.env.PROXY_PASS
        },
        viewport: { width: 1280, height: 720 },
        extraHTTPHeaders: {
            'sec-ch-ua': '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'upgrade-insecure-requests': '1',
            'accept-language': 'en-US,en;q=0.9',
        },
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--disable-gpu',
            '--single-process' 
        ]
    });
    console.log("✅ Browser Context Initialized");
}

app.get('/browser', async (req, res) => {
    const user = req.query.user;
    if (!user) return res.status(400).json({ error: "Missing user parameter" });

    try {
        const data = await scrapeWithBrowser(browserContext, user);
        res.json(data);
    } catch (err) {
        console.error("Request Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

initBrowser().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error("Failed to initialize browser:", err);
    process.exit(1);
});