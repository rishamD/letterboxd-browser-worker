const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

chromium.use(StealthPlugin());

const UA_LIST = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
];

async function scrapeFilms(user) {
  // Parse rotating residential proxy
  const proxyRaw = process.env.PROXY_LIST.split(',')[0];
  const proxyUrl = new URL(proxyRaw);

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
      '--disable-dev-shm-usage', // Critical for small RAM
      '--disable-gpu',
      '--js-flags="--max-old-space-size=512"' // Limit memory usage
    ]
  });

  try {
    const context = await browser.newContext({
      userAgent: UA_LIST[Math.floor(Math.random() * UA_LIST.length)],
      viewport: { width: 1280, height: 720 }
    });

    const page = await context.newPage();

    // Block unnecessary resources to save bandwidth/RAM
    await page.route('**/*', route => {
      const type = route.request().resourceType();
      if (['image', 'font', 'media'].includes(type)) return route.abort();
      route.continue();
    });

    // Strategy: Human-like navigation
    await page.goto('https://letterboxd.com/', { waitUntil: 'networkidle', timeout: 60000 });
    await new Promise(r => setTimeout(r, Math.random() * 2000 + 1000));

    await page.goto(`https://letterboxd.com/${user}/films/`, { waitUntil: 'networkidle', timeout: 60000 });
    
    // Extract data (using your existing logic)
    const slugs = await page.$$eval('li.poster-container img', imgs => imgs.map(img => img.alt));

    return slugs;
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeFilms };