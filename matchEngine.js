const supabase = require('./lib/supabase');

// Fetch all active rules for the client
async function fetchRulesForClient(clientId) {
  const { data, error } = await supabase
    .from('reconciliation_rules')
    .select('*')
    .eq('client_id', clientId)
    .eq('is_active', true);

  if (error) {
    console.error('Supabase rule fetch error:', error);
    return [];
  }

  return data;
}

// Matching logic based on rule and transaction
function calculateConfidence(transaction, rule) {
  const amount = transaction.amount;
  const description = transaction.description.toLowerCase();
  const keyword = rule.vendor_keyword?.toLowerCase() || '';
  const min = rule.amount_range?.min ?? 0;
  const max = rule.amount_range?.max ?? 999999;

  const amountMatch = amount >= min && amount <= max;
  const descMatch = description.includes(keyword);

  let confidence = 0;
  if (amountMatch) confidence += 50;
  if (descMatch) confidence += 50;

  return confidence;
}

// Main match function
async function matchTransaction(transaction) {
  const rules = await fetchRulesForClient(transaction.client_id);

  for (let rule of rules) {
    const confidence = calculateConfidence(transaction, rule);

    if (confidence >= 90) {
      return {
        matchType: 'rule',
        ruleUsed: rule.rule_name || rule.id,
        confidence,
        outcome: 'auto_reconcile',
        accountCode: rule.account_code,
        vatCode: rule.vat_code,
        matched: true
      };
    }
  }

  return {
    matchType: 'none',
    confidence: 0,
    outcome: 'manual_review',
    matched: false
  };
}

module.exports = { matchTransaction };
