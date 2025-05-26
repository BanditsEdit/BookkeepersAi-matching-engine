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
  const amount = parseFloat(transaction.amount);
  const description = transaction.description?.toLowerCase() || '';
  const keyword = rule.vendor_keyword?.toLowerCase() || '';

  const min = parseFloat(rule.amount_range?.min ?? 0);
  const max = parseFloat(rule.amount_range?.max ?? 999999);

  const amountMatch = amount >= min && amount <= max;
  const descMatch = description.includes(keyword);

  console.log('🧠 MATCH CHECK →', {
    amount,
    min,
    max,
    description,
    keyword,
    amountMatch,
    descMatch
  });

  let confidence = 0;
  if (amountMatch) confidence += 50;
  if (descMatch) confidence += 50;

  return confidence;
}


// Main match function
async function matchTransaction(transaction, rulesFromPayload = []) {
  const rules = rulesFromPayload.length > 0
    ? rulesFromPayload
    : await fetchRulesForClient(transaction.client_id);
  console.log("📦 Payload rule sample:", rulesFromPayload[0]);


  console.log(rules === transaction.rules ? "📦 Using Make.com-supplied rules" : "🗄️ Using Supabase rules");
  console.log("📋 Rules loaded:", rules.map(r => r.rule_name || r.id));


  for (let rule of rules) {
    const confidence = calculateConfidence(transaction, rule);
    console.log(`🧠 Rule match attempt: ${rule.rule_name} → Confidence: ${confidence}`);
    console.log("🧾 Matching with rule:", rule);

    if (!rule.account_code || !rule.vat_code) {
      console.warn('⚠️ Rule is missing account_code or vat_code:', rule);
    }



    if (confidence >= 50) {
      // 🛡️ Guard against missing IDs
      if (!transaction?.id || !transaction?.client_id) {
        console.error("❌ Missing transaction.id or client_id. Skipping update.");
        return {
          matchType: 'rule',
          ruleUsed: rule.rule_name,
          confidence,
          outcome: 'auto_reconcile',
          account_code: rule.account_code,
          vat_code: rule.vat_code,
          matched: true
        };
      }
      
      const result = {
        matchType: 'rule',
        ruleId: rule.id?.length === 36 ? rule.id : null,
        ruleUsed: rule.rule_name,
        confidence,
        outcome: 'auto_reconcile',
        account_code: rule.account_code,
        vat_code: rule.vat_code,
        matched: true
      };

      // Log audit + update
      await logMatchAudit(transaction.client_id, transaction.id, result);
      await updateTransactionStatus(transaction.id, result);

      return result;
    }
  }

  const fallback = {
    matchType: 'none',
    confidence: 0,
    outcome: 'manual_review',
    matched: false

  };

  await logMatchAudit(transaction.client_id, transaction.id, fallback);
  await updateTransactionStatus(transaction.id, fallback);
  await createException(transaction, fallback);


  return fallback;
}

module.exports = { matchTransaction };

async function logMatchAudit(clientId, transactionId, result) {
  const { error } = await supabase
    .from('reconciliation_audit_log')
    .insert([{
      client_id: clientId,
      transaction_id: transactionId,
      action_type: result.matched ? 'auto_match' : 'manual_review',
      rule_used: result.ruleUsed || null,
      confidence_score: result.confidence,
      reconciled: result.outcome === 'auto_reconcile',
      reconciled_at: result.outcome === 'auto_reconcile' ? new Date().toISOString() : null
    }]);

  if (error) console.error('Failed to log audit:', error);
}

async function updateTransactionStatus(transactionId, result) {
  const updateFields = {
    status: result.outcome === 'auto_reconcile' ? 'matched' : 'manual_review',
    matched_invoice_id: result.ruleUsed || null,
    account_code: result.accountCode || null,
    vat_code: result.vatCode || null
  };

  const { error } = await supabase
    .from('transactions_raw')
    .update(updateFields)
    .eq('id', transactionId);

  if (error) {
    console.error('Failed to update transaction:', error);
  }
}

async function createException(transaction, result) {
  const { error } = await supabase
    .from('exceptions')
    .insert([{
      transaction_id: transaction.id,
      client_id: transaction.client_id,
      reason: 'Low confidence match',
      confidence_score: result.confidence,
      is_resolved: false,
      created_at: new Date().toISOString()
    }]);

  if (error) console.error('Failed to create exception:', error);
}
