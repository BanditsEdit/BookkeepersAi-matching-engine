const express = require('express');
const { matchTransaction } = require('./matchEngine');

const app = express();
app.use(express.json());

// ✅ This is your dynamic POST route
app.post('/match', async (req, res) => {
  try {
    const transaction = req.body;

    // 🔁 Await the match engine's result
    const result = await matchTransaction(transaction);

    // ✅ Return the result to Make.com
    res.json(result);
  } catch (err) {
    console.error('Matching failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Optional test route
app.get('/', (req, res) => {
  res.send('Venn Matching Engine is running.');
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Match Engine live on port ${PORT}`);
});
