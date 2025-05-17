const express = require("express");
const bodyParser = require("body-parser");
const { matchTransaction } = require("./matchEngine");

const app = express();
app.use(bodyParser.json());

app.post("/match", (req, res) => {
  const { transaction, invoices, rules } = req.body;

  if (!transaction || !invoices) {
    return res.status(400).json({ error: "Missing transaction or invoices" });
  }

  const result = matchTransaction(transaction, invoices, rules || []);
  res.json(result);
});

const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => {
  res.send("Replit matching engine is live.");
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Matching engine running on port ${PORT}`);
});

