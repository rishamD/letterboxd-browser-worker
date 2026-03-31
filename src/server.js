const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { scrapeWithBrowser } = require('./scraper');

chromium.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 8081;

app.use(cors());

let browser = null; // Initialize as null

// 1. Health check works immediately
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    browser: browser ? 'connected' : 'initializing' 
  });
});

// 2. Browser initialization logic
async function initBrowser() {
  try {
    console.log("Launching persistent browser...");
    const proxyRaw = process.env.PROXY_LIST;
    if (!proxyRaw) throw new Error("PROXY_LIST missing");

    const proxyUrl = new URL(proxyRaw);
    
    browser = await chromium.launch({
      headless: true,
      proxy: {
        server: `${proxyUrl.protocol}//${proxyUrl.host}`,
        username: proxyUrl.username,
        password: proxyUrl.password
      },
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    console.log("Browser ready.");
  } catch (err) {
    console.error("Browser Launch Failed:", err.message);
    // Retry logic: try to launch again in 10 seconds if it fails
    setTimeout(initBrowser, 10000);
  }
}

app.get('/browser', async (req, res) => {
  const user = req.query.user;
  if (!user) return res.status(400).json({ error: 'missing ?user=' });
  
  // Safety check if browser isn't ready yet
  if (!browser) {
    return res.status(503).json({ error: 'Browser is still warming up, try again in a few seconds.' });
  }
  
  try {
    const slugs = await scrapeWithBrowser(browser, user);
    return res.json({ user, latest50: slugs });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
});

// Start the server FIRST
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Worker online on ${PORT}`);
  // Then start the browser in the background
  initBrowser();
});