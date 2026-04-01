async function scrapeWithBrowser(context, user) {
    const page = await context.newPage();
    
    // 1. SPEED OPTIMIZATION: Block fonts and images to prevent timeouts
    await page.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (type === 'font' || type === 'image' || type === 'media') {
            route.abort();
        } else {
            route.continue();
        }
    });

    try {
        const targetUrl = `https://letterboxd.com/${user}/films/`;
        console.log(`Navigating to: ${targetUrl}`);

        // 2. Navigate with 60s timeout
        const response = await page.goto(targetUrl, { 
            waitUntil: 'domcontentloaded', 
            timeout: 60000 
        });

        // Check for Cloudflare/Block
        if (response.status() === 403) {
            throw new Error("Cloudflare Blocked the request (403)");
        }

        // 3. Wait for the LazyPoster components to appear
        await page.waitForSelector('[data-component-class="LazyPoster"]', { timeout: 15000 });

        // 4. Extraction Logic
        const filmData = await page.evaluate(() => {
            const results = [];
            const posters = document.querySelectorAll('[data-component-class="LazyPoster"]');
            
            posters.forEach(poster => {
                const slug = poster.getAttribute('data-item-slug');
                let rating = null;
                
                // Jump to the sibling metadata for the rating
                const viewingData = poster.nextElementSibling;
                if (viewingData && viewingData.classList.contains('poster-viewingdata')) {
                    const ratingSpan = viewingData.querySelector('.rating');
                    if (ratingSpan) {
                        const ratedClass = Array.from(ratingSpan.classList).find(c => c.includes('rated-'));
                        if (ratedClass) {
                            const scoreMatch = ratedClass.match(/\d+/);
                            if (scoreMatch) {
                                rating = parseInt(scoreMatch[0], 10) / 2;
                            }
                        }
                    }
                }
                if (slug) results.push({ slug, rating });
            });
            return results;
        });

        await page.close();
        return { user, films: filmData };

    } catch (err) {
        // FAST DEBUG SCREENSHOT: Doesn't wait for fonts
        await page.screenshot({ path: 'error_debug.png', animations: 'disabled', timeout: 5000 }).catch(() => {});
        await page.close();
        throw err;
    }
}

module.exports = { scrapeWithBrowser };