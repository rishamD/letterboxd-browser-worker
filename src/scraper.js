async function scrapeWithBrowser(browser, user) {
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    try {
        const targetUrl = `https://letterboxd.com/${user}/films/`;
        
        // 1. Navigation
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // 2. Wait for the React component to "hydrate"
        await page.waitForSelector('[data-component-class="LazyPoster"]', { 
            state: 'attached', 
            timeout: 30000 
        });

        // 3. Precise Extraction Logic
        const filmData = await page.evaluate(() => {
            const results = [];
            // We look for all the LazyPoster containers
            const posters = document.querySelectorAll('[data-component-class="LazyPoster"]');
            
            posters.forEach(poster => {
                // Get the slug from the data attribute you found
                const slug = poster.getAttribute('data-item-slug');
                
                if (slug) {
                    let rating = null;
                    
                    // The rating is in the NEXT sibling element <p class="poster-viewingdata">
                    const viewingData = poster.nextElementSibling;
                    if (viewingData && viewingData.classList.contains('poster-viewingdata')) {
                        const ratingSpan = viewingData.querySelector('.rating');
                        if (ratingSpan) {
                            // Look for the "rated-X" class specifically
                            const classList = Array.from(ratingSpan.classList);
                            const ratedClass = classList.find(c => c.includes('rated-'));
                            
                            if (ratedClass) {
                                // Extract the digits (e.g., "9" from "rated-9")
                                const scoreMatch = ratedClass.match(/\d+/);
                                if (scoreMatch) {
                                    rating = parseInt(scoreMatch[0], 10) / 2;
                                }
                            }
                        }
                    }
                    results.push({ slug, rating });
                }
            });
            return results;
        });

        return filmData;

    } catch (err) {
        // Log the error and take a screenshot for your laptop debugging
        console.error("Scrape Error:", err.message);
        await page.screenshot({ path: 'rating_debug.png' });
        throw err;
    } finally {
        await context.close();
    }
}
module.exports = { scrapeWithBrowser };