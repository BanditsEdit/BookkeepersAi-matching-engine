const express = require('express');
const { matchTransaction } = require('./matchEngine');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const path = require('path');
app.use(express.static(path.join(__dirname, 'public')));

const axios = require('axios'); // add at the top of your file

const auth = require('basic-auth'); // For login protection

const adminAuth = (req, res, next) => {
  const user = auth(req);
  if (!user || user.name !== 'venn' || user.pass !== 'securepass123') {
    res.set('WWW-Authenticate', 'Basic realm="Secure Area"');
    return res.status(401).send('Authentication required.');
  }
  next();
};

app.get('/pending-reviews', adminAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('transactions_raw')
      .select('*')
      .eq('status', 'matched')
      .is('approved_at', null);

    if (error) {
      console.error('Error fetching pending approvals:', error);
      return res.status(500).json({ error: 'Could not fetch transactions' });
    }

    res.json(data);
  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

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
app.get('/', adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/approve/:id', async (req, res) => {
  const transactionId = req.params.id;
  const approvedBy = req.body.approved_by || 'admin@venn.com';

  try {
    // ✅ Update Supabase: transactions_raw
    const { error: updateError } = await supabase
      .from('transactions_raw')
      .update({
        approved_by: approvedBy,
        approved_at: new Date().toISOString(),
        status: 'reconciled'
      })
      .eq('id', transactionId);

    if (updateError) {
      return res.status(500).json({ error: 'Failed to approve transaction.' });
    }

    // ✅ Insert into audit log
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
        approved_by: approvedBy
      });
    } catch (webhookErr) {
      console.error('Webhook to Make failed:', webhookErr.message);

      // ✅ Log failure in Supabase
      await supabase.from('webhook_failures').insert([{
        transaction_id: transactionId,
        client_id: req.body.client_id,
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

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Match Engine live on port ${PORT}`);
});

