const UA_LIST = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
];

async function scrapeWithBrowser(browser, user) {
  // Create a fresh context/tab for this specific request
  const context = await browser.newContext({
    userAgent: UA_LIST[0]
  });
  
  const page = await context.newPage();

  try {
    // Speed optimization: Block images/css to load faster
    await page.route('**/*', route => {
      const type = route.request().resourceType();
      if (['image', 'font', 'media'].includes(type)) return route.abort();
      route.continue();
    });

    await page.goto(`https://letterboxd.com/${user}/films/`, { 
      waitUntil: 'domcontentloaded', // Faster than 'networkidle'
      timeout: 30000 
    });

    await page.waitForSelector('li.poster-container', { timeout: 5000 });

    const slugs = await page.$$eval('li.poster-container .poster', elements => {
      return elements.map(el => el.getAttribute('data-film-slug')).filter(s => s);
    });

    return slugs;
  } finally {
    // ONLY close the tab/context, not the browser!
    await context.close();
  }
}

module.exports = { scrapeWithBrowser };