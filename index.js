const express = require('express');
const path = require('path');
const axios = require('axios');
const { matchTransaction } = require('./matchEngine');
const supabase = require('./lib/supabase');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ✅ Supabase token-based auth middleware
const authWithSupabase = async (req, res, next) => {
  const token = req.headers['authorization'];
  console.log('🔐 Incoming token:', token);

  if (!token) {
    console.warn('🚫 No token provided');
    return res.status(401).send('No token provided.');
}

  const { data, error } = await supabase
    .from('client_access')
    .select('*')
    .eq('access_token', token)
    .single();

  if (error || !data) {
    console.error('❌ Auth failed - token not found or error:', error);
    return res.status(403).send('Access denied.');
  }
  const now = new Date();
   console.log('🔍 Client access data:', data);

  if (data.status !== 'active') {
    console.warn('⚠️ Token status not active:', data.status);
    return res.status(403).send('Access revoked.');
  }

  if (data.expires_at && new Date(data.expires_at) < now) {
    console.warn('⏳ Token expired at', data.expires_at);
    await supabase
      .from('client_access')
      .update({ status: 'expired' })
      .eq('access_token', token);
    return res.status(403).send('Token expired.');
  }

  if (data.reminder_count >= 3) {
    await supabase
      .from('client_access')
      .update({ status: 'revoked' })
      .eq('access_token', token);
    return res.status(403).send('Access revoked after 3 missed reminders.');
  }

  req.client = data;
  next();
};

// ✅ Get current client details from token
app.get('/me', authWithSupabase, async (req, res) => {
  try {
    console.log("✅ /me accessed with client:", req.client);
    const client = req.client;
    res.json({ client_id: client.client_id, email: client.email || null });
  } catch (err) {
    console.error('Failed to return client info:', err);
    res.status(500).json({ error: 'Failed to fetch client info' });
  }
});

// 🏠 Public login page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ✅ Per-client filtered routes
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

app.get('/audit-log', authWithSupabase, async (req, res) => {
  const { data, error } = await supabase
    .from('reconciliation_audit_log')
    .select('*')
    .eq('client_id', req.client.client_id)
    .order('reconciled_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Could not load audit log' });
  res.json({ data });
});

app.get('/exceptions', authWithSupabase, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('exceptions')
      .select('*')
      .eq('client_id', req.client.client_id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching exceptions:', error);
      console.log("✅ Client data on /exceptions route:", req.client);

      return res.status(500).json({ error: 'Could not fetch exceptions' });
    }

    res.json({ data });
  } catch (err) {
    console.error('Unexpected error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

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

  // Validate required fields
  if (!rule.rule_name || !rule.vendor_keyword || !rule.amount_range || !rule.account_code || !rule.vat_code) {
    return res.status(400).json({ message: "Missing required fields." });
  }

  // Add client ID from authenticated user
  const newRule = {
    ...rule,
    client_id: req.client.client_id,
    is_active: true
  };

  // Insert rule into Supabase
  const { error } = await supabase
    .from('reconciliation_rules')
    .insert([newRule]);

  if (error) {
    console.error('Error inserting rule:', error);
    return res.status(500).json({ message: 'Database insert failed.' });
  }

  res.status(200).json({ message: 'Rule created successfully.' });
});

app.put('/rules/:id', authWithSupabase, async (req, res) => {
  const ruleId = req.params.id;
  const updates = req.body;

  const { error } = await supabase
    .from('reconciliation_rules')
    .update(updates)
    .eq('id', ruleId)
    .eq('client_id', req.client.client_id); // Prevent cross-client edits

  if (error) {
    console.error('Failed to update rule:', error);
    return res.status(500).json({ message: 'Update failed.' });
  }

  res.json({ message: 'Rule updated successfully.' });
});

// 🔁 Match Engine
app.post('/match', async (req, res) => {
  try {
    const transaction = req.body;
    const result = await matchTransaction(req.body.transaction, req.body.rules || []);
  } catch (err) {
    console.error('Matching failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ Delete rule
app.delete('/rules/:id', authWithSupabase, async (req, res) => {
  const ruleId = req.params.id;

  const { error } = await supabase
    .from('reconciliation_rules')
    .delete()
    .eq('id', ruleId)
    .eq('client_id', req.client.client_id); // Security: only delete own rules

  if (error) {
    console.error('Failed to delete rule:', error);
    return res.status(500).json({ message: 'Delete failed.' });
  }

  res.json({ message: 'Rule deleted successfully.' });
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
      .eq('id', transactionId)
      .eq('client_id', req.client.client_id); // 👈 prevent cross-client approvals

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
        attempted_at: new Date().toISOString(),
      }]);
    }

    res.json({ message: 'Transaction approved and webhook triggered.' });

  } catch (err) {
    console.error('Approval or webhook failed:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ✅ Create new client
app.post('/bookkeeper-clients', authWithSupabase, async (req, res) => {
  const { name, email, company } = req.body;

  if (!name || !email || !company) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const bookkeeperId = req.client.client_id;

  let duplicate = false;

  try {
    // 1. Get permission links (safe even if table is empty)
    const { data: permissionLinks, error: linkError } = await supabase
      .from('bookkeeper_clients_permissions')
      .select('bookkeeper_clients_id')
      .eq('client_id', bookkeeperId);

    if (linkError) throw linkError;

    const clientIds = (permissionLinks || []).map(p => p.bookkeeper_clients_id);

    if (clientIds.length > 0) {
      // 2. Lookup clients by ID (safe even if clientIds is empty)
      const { data: clients, error: clientFetchError } = await supabase
        .from('bookkeeper_clients')
        .select('email, id')
        .in('id', clientIds);

      if (clientFetchError) throw clientFetchError;

      // 3. Check for duplicate by email
      duplicate = (clients || []).some(c => c.email === email);
    }
  } catch (error) {
    console.error('❌ Error during duplicate check:', error);
    return res.status(500).json({ error: 'Duplicate check failed.' });
  }

  if (duplicate) {
    return res.status(409).json({ error: 'A client with this email already exists.' });
  }

  try {
    // 4. Insert into bookkeeper_clients
    const { data: insertedClient, error: clientError } = await supabase
      .from('bookkeeper_clients')
      .insert([{
        name,
        email,
        company,
        created_at: new Date().toISOString()
      }])
      .select();

    if (clientError || !insertedClient || !insertedClient[0]) {
      console.error('❌ Supabase client insert error:', clientError);
      return res.status(500).json({ error: 'Could not insert client.' });
    }

    const newClientId = insertedClient[0].id;

    // 5. Insert permission link
    const { error: permissionError } = await supabase
      .from('bookkeeper_clients_permissions')
      .insert([{
        client_id: bookkeeperId,
        bookkeeper_clients_id: newClientId
      }]);

    if (permissionError) {
      console.error('⚠️ Permission insert failed:', permissionError);
      return res.status(500).json({ error: 'Client saved, but permission could not be created.' });
    }

    res.status(201).json({ message: 'Client added successfully', data: insertedClient[0] });

  } catch (err) {
    console.error('❌ Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// Fallback
app.use((req, res) => {
  res.status(404).send('Not Found');
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Match Engine live on port ${PORT}`);
});
