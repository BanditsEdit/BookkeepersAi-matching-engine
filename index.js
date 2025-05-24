const express = require('express');
const path = require('path');
const axios = require('axios');
const { matchTransaction } = require('./matchEngine');
const supabase = require('./lib/supabase');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

/* 🔐 Middleware: Auth from Supabase token */
const authWithSupabase = async (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).send('No token provided.');

  const { data, error } = await supabase
    .from('client_access')
    .select('*')
    .eq('access_token', token)
    .single();

  if (error || !data) return res.status(403).send('Access denied.');

  const now = new Date();

  if (data.status !== 'active') return res.status(403).send('Access revoked.');
  if (data.expires_at && new Date(data.expires_at) < now) {
    await supabase.from('client_access')
      .update({ status: 'expired' })
      .eq('access_token', token);
    return res.status(403).send('Token expired.');
  }

  if (data.reminder_count >= 3) {
    await supabase.from('client_access')
      .update({ status: 'revoked' })
      .eq('access_token', token);
    return res.status(403).send('Access revoked after 3 missed reminders.');
  }

  req.client = data;
  next();
};

/* 🏠 Public Route */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

/* ✅ GET authenticated client */
app.get('/me', authWithSupabase, async (req, res) => {
  res.json({ client_id: req.client.client_id });
});

/* ✅ GET health check */
app.get('/health', (_, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/* 📥 GET pending transactions for review */
app.get('/pending-reviews', authWithSupabase, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('transactions_raw')
      .select('*')
      .eq('status', 'matched')
      .is('approved_at', null)
      .eq('client_id', req.client.client_id);

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Error fetching pending approvals:', err);
    res.status(500).json({ error: 'Could not fetch transactions' });
  }
});

/* 📚 GET audit log */
app.get('/audit-log', authWithSupabase, async (req, res) => {
  const { data, error } = await supabase
    .from('reconciliation_audit_log')
    .select('*')
    .eq('client_id', req.client.client_id)
    .order('reconciled_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Could not load audit log' });
  res.json({ data });
});

/* ⚠️ GET exceptions */
app.get('/exceptions', authWithSupabase, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('exceptions')
      .select('*')
      .eq('client_id', req.client.client_id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching exceptions:', error);
      return res.status(500).json({ error: 'Could not fetch exceptions' });
    }

    res.json({ data });
  } catch (err) {
    console.error('Unexpected error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/* 📜 GET and POST rules */
app.get('/rules', authWithSupabase, async (req, res) => {
  const { data, error } = await supabase
    .from('reconciliation_rules')
    .select('*')
    .eq('client_id', req.client.client_id);

  if (error) return res.status(500).json({ error: 'Could not load rules' });
  res.json({ data });
});

app.post('/rules', authWithSupabase, async (req, res) => {
  const rule = req.body;

  if (!rule.rule_name || !rule.vendor_keyword || !rule.amount_range || !rule.account_code || !rule.vat_code) {
    return res.status(400).json({ message: "Missing required fields." });
  }

  const newRule = {
    ...rule,
    client_id: req.client.client_id,
    is_active: true,
    created_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from('reconciliation_rules')
    .insert([newRule]);

  if (error) {
    console.error('Error inserting rule:', error);
    return res.status(500).json({ message: 'Database insert failed.' });
  }

  res.status(200).json({ message: 'Rule created successfully.' });
});

/* ✏️ UPDATE rule */
app.put('/rules/:id', authWithSupabase, async (req, res) => {
  const ruleId = req.params.id;
  const updates = req.body;

  const { error } = await supabase
    .from('reconciliation_rules')
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq('id', ruleId)
    .eq('client_id', req.client.client_id);

  if (error) {
    console.error('Failed to update rule:', error);
    return res.status(500).json({ message: 'Update failed.' });
  }

  res.json({ message: 'Rule updated successfully.' });
});

/* 🗑 DELETE rule */
app.delete('/rules/:id', authWithSupabase, async (req, res) => {
  const ruleId = req.params.id;

  const { error } = await supabase
    .from('reconciliation_rules')
    .delete()
    .eq('id', ruleId)
    .eq('client_id', req.client.client_id);

  if (error) {
    console.error('Failed to delete rule:', error);
    return res.status(500).json({ message: 'Delete failed.' });
  }

  res.json({ message: 'Rule deleted successfully.' });
});

/* 🤖 Match Engine */
app.post('/match', async (req, res) => {
  try {
    const transaction = req.body;
    const result = await matchTransaction(transaction);
    res.json(result);
  } catch (err) {
    console.error('Matching failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ✅ Manual Approval + Audit Log + Webhook */
app.post('/approve/:id', authWithSupabase, async (req, res) => {
  const transactionId = req.params.id;
  const approvedBy = req.body.approved_by || 'admin@venn.com';

  try {
    const { error: updateError } = await supabase
      .from('transactions_raw')
      .update({
        approved_by: approvedBy,
        approved_at: new Date().toISOString(),
        status: 'reconciled',
        updated_at: new Date().toISOString()
      })
      .eq('id', transactionId)
      .eq('client_id', req.client.client_id);

    if (updateError) {
      return res.status(500).json({ error: 'Failed to approve transaction.' });
    }

    await supabase.from('reconciliation_audit_log').insert([{
      transaction_id: transactionId,
      client_id: req.client.client_id,
      action_type: 'human_approved',
      confidence_score: req.body.confidence_score || null,
      reconciled: true,
      reconciled_at: new Date().toISOString(),
      created_at: new Date().toISOString()
    }]);

    try {
      await axios.post('https://hook.eu2.make.com/ht9piochu6vw2t46suvqumnqsh3os5jp', {
        transaction_id: transactionId,
        client_id: req.client.client_id,
        confidence_score: req.body.confidence_score,
        approved_by: approvedBy,
      });
    } catch (webhookErr) {
      console.error('Webhook to Make failed:', webhookErr.message);
      await supabase.from('webhook_failures').insert([{
        transaction_id: transactionId,
        client_id: req.client.client_id,
        approved_by: approvedBy,
        failure_reason: webhookErr.message,
        attempted_at: new Date().toISOString()
      }]);
    }

    res.json({ message: 'Transaction approved and webhook triggered.' });

  } catch (err) {
    console.error('Approval or webhook failed:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

/* 🔚 404 Fallback */
app.use((req, res) => {
  res.status(404).send('Not Found');
});

/* 🚀 Start Server */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Match Engine live on port ${PORT}`);
});
