const UA_LIST = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
];

async function scrapeWithBrowser(browser, user) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
  });
  
  const page = await context.newPage();

  try {
    // 🔥 NEW: Block heavy assets to prevent timeouts
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'font', 'stylesheet', 'media'].includes(type)) {
        return route.abort();
      }
      route.continue();
    });

    // Use 'domcontentloaded' instead of 'networkidle' (much faster)
    await page.goto(`https://letterboxd.com/${user}/films/`, { 
      waitUntil: 'domcontentloaded', 
      timeout: 60000 // Increased to 60s for residential proxy lag
    });

    // Wait specifically for the list element, not the whole page
    await page.waitForSelector('.poster-list', { timeout: 10000 });

    const slugs = await page.$$eval('li.poster-container .poster', elements => {
      return elements.map(el => el.getAttribute('data-film-slug')).filter(s => s);
    });

    return slugs;
  } finally {
    await context.close();
  }
}

module.exports = { scrapeWithBrowser };