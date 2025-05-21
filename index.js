const express = require('express');
const path = require('path');
const axios = require('axios');
const { matchTransaction } = require('./matchEngine');
const supabase = require('./lib/supabase');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json()); // for JSON body parsing

// ✅ Supabase token-based auth middleware
const authWithSupabase = async (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) {
    return res.status(401).send('No token provided.');
  }

  const { data, error } = await supabase
    .from('client_access')
    .select('*')
    .eq('access_token', token)
    .single();

  if (error || !data || data.status !== 'active') {
    return res.status(403).send('Access denied.');
  }

  req.client = data;
  next();
};

// 🏠 Public login page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ✅ Secure endpoints

app.get('/pending-reviews', authWithSupabase, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('transactions_raw')
      .select('*')
      .eq('status', 'matched')
      .is('approved_at', null);

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Error fetching pending approvals:', err);
    res.status(500).json({ error: 'Could not fetch transactions' });
  }
});

app.get('/audit-log', authWithSupabase, async (req, res) => {
  const { data, error } = await supabase
    .from('reconciliation_audit_log')
    .select('*')
    .order('reconciled_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Could not load audit log' });
  res.json({ data });
});

app.get('/rules', authWithSupabase, async (req, res) => {
  const { data, error } = await supabase
    .from('reconciliation_rules')
    .select('*');

  if (error) return res.status(500).json({ error: 'Could not load rules' });
  res.json({ data });
});

// 🔁 Match Engine
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

// ✅ Approve + Log + Webhook
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
      })
      .eq('id', transactionId);

    if (updateError) {
      return res.status(500).json({ error: 'Failed to approve transaction.' });
    }

    await supabase.from('reconciliation_audit_log').insert([{
      transaction_id: transactionId,
      client_id: req.body.client_id || null,
      action_type: 'human_approved',
      confidence_score: req.body.confidence_score || null,
      reconciled: true,
      reconciled_at: new Date().toISOString(),
    }]);

    try {
      await axios.post('https://hook.eu2.make.com/ht9piochu6vw2t46suvqumnqsh3os5jp', {
        transaction_id: transactionId,
        client_id: req.body.client_id,
        confidence_score: req.body.confidence_score,
        approved_by: approvedBy,
      });
    } catch (webhookErr) {
      console.error('Webhook to Make failed:', webhookErr.message);
      await supabase.from('webhook_failures').insert([{
        transaction_id: transactionId,
        client_id: req.body.client_id,
        approved_by: approvedBy,
        failure_reason: webhookErr.message,
        attempted_at: new Date().toISOString(),
      }]);
    }

    res.json({ message: 'Transaction approved and webhook triggered.' });

  } catch (err) {
    console.error('Approval or webhook failed:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ✅ 404 fallback
app.use((req, res) => {
  res.status(404).send('Not Found');
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Match Engine live on port ${PORT}`);
});
