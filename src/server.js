const express = require('express');
const cors    = require('cors');
const { scrapeFilms } = require('./scraper');
const health  = require('./health');

const app  = express();
const PORT = process.env.PORT || 8081;

app.use(cors());
app.get('/browser', async (req, res) => {
  const user = req.query.user;
  if (!user) return res.status(400).json({ error: 'missing ?user=' });
  try {
    const slugs = await scrapeFilms(user);
    return res.json({ user, latest50: slugs });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
});

app.get('/health', health);

app.listen(PORT, '0.0.0.0', () => console.log(`Browser worker on ${PORT}`));