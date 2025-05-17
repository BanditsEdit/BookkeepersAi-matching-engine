function calculateConfidence(transaction, invoice) {
  let score = 0;

  if (Math.abs(transaction.amount - invoice.amount) < 0.01) score += 40;

  if (
    transaction.description?.toLowerCase().includes(invoice.vendor.toLowerCase())
  ) score += 30;

  const txDate = new Date(transaction.date);
  const invDate = new Date(invoice.date);
  const daysDiff = Math.abs((txDate - invDate) / (1000 * 60 * 60 * 24));
  if (daysDiff <= 5) score += 30;

  return score;
}

function matchTransaction(transaction, invoices, rules = []) {
  // Check rules first
  for (let rule of rules) {
    if (
      transaction.description?.toLowerCase().includes(rule.vendor_keyword.toLowerCase()) &&
      transaction.amount >= rule.amount_range.min &&
      transaction.amount <= rule.amount_range.max
    ) {
      return {
        matchType: "rule",
        ruleUsed: rule.rule_name,
        confidence: 100,
        outcome: "auto_reconcile",
        account_code: rule.account_code,
        vat_code: rule.vat_code
      };
    }
  }

  // Check invoices if no rule matched
  let bestMatch = null;
  let bestScore = 0;

  for (let invoice of invoices) {
    const score = calculateConfidence(transaction, invoice);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = invoice;
    }
  }

  return {
    matchType: "invoice",
    matchedInvoiceId: bestMatch?.id || null,
    confidence: bestScore,
    outcome: bestScore > 90 ? "auto_reconcile" : "manual_review"
  };
}

module.exports = { matchTransaction };
