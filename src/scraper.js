const { chromium } = require('playwright-extra');
const stealth = require('playwright-extra-stealth');
stealth(chromium);

const UA_LIST = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15'
];

function pickProxy() {
  const list = process.env.PROXY_LIST.split(',');
  return list[Math.floor(Math.random() * list.length)];
}

async function scrapeFilms(user) {
  const proxy = pickProxy();
  const browser = await chromium.launch({
    headless: true,
    args: [
      `--proxy-server=${proxy}`,
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });

  const context = await browser.newContext({
    userAgent: UA_LIST[Math.floor(Math.random() * UA_LIST.length)],
    viewport: { width: 1366, height: 768 },
    locale: 'en-US',
    timezoneId: 'America/Winnipeg'
  });

  const page = await context.newPage();
  await page.route('**/*', route => {
    const url = route.request().url();
    if (['google-analytics','googletagmanager','fonts.gstatic'].some(s=>url.includes(s))) return route.abort();
    route.continue();
  });

  // warm-up
  await page.goto('https://letterboxd.com/', { waitUntil: 'networkidle' });
  await page.goto(`https://letterboxd.com/${user}/reviews/`, { waitUntil: 'networkidle' });
  // target
  await page.goto(`https://letterboxd.com/${user}/films/`, { waitUntil: 'networkidle' });
  // force first ajax load
  await page.keyboard.press('PageDown');
  await page.waitForResponse(r => r.url().includes('/ajax/poster') && r.status() === 200, { timeout: 15000 });

  const slugs = await page.$$eval('li.poster-container div', nodes =>
    nodes.map(n => n.getAttribute('data-film-slug')).filter(Boolean)
  );

  await browser.close();
  return slugs.slice(0, 50);
}

module.exports = { scrapeFilms };