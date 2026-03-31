const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Apply the stealth plugin to hide the bot fingerprint
chromium.use(StealthPlugin());

const UA_LIST = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
];

async function scrapeFilms(user) {
  // Pull the proxy from the environment variable set in the EC2 script
  const proxyRaw = process.env.PROXY_LIST;
  if (!proxyRaw) {
    throw new Error("PROXY_LIST environment variable is missing.");
  }

  const proxyUrl = new URL(proxyRaw.split(',')[0]);

  const browser = await chromium.launch({
    headless: true,
    proxy: {
      server: `${proxyUrl.protocol}//${proxyUrl.host}`,
      username: proxyUrl.username,
      password: proxyUrl.password
    },
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', // Saves RAM on t2.micro
      '--disable-blink-features=AutomationControlled'
    ]
  });

  try {
    const context = await browser.newContext({
      userAgent: UA_LIST[Math.floor(Math.random() * UA_LIST.length)],
      viewport: { width: 1280, height: 720 }
    });

    const page = await context.newPage();

    // Human-like behavior: Visit homepage first
    await page.goto('https://letterboxd.com/', { waitUntil: 'networkidle', timeout: 60000 });
    await new Promise(r => setTimeout(r, Math.random() * 2000 + 1000));

    // Target page
    await page.goto(`https://letterboxd.com/${user}/films/`, { waitUntil: 'networkidle', timeout: 60000 });
    
    // Extract film slugs
    const slugs = await page.$$eval('li.poster-container img', imgs => imgs.map(img => img.alt));

    return slugs;
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeFilms };