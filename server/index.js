require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { runSeed } = require('./seed');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
});

const CATEGORY_DEFAULT_FIELDS = {
  'Roster / booking not syncing': ['Shift ID & Date', 'Client Cutoff Timestamp', 'Roster Sync Log Checked (Yes/No)'],
  'Live tracking / GPS incorrect': ['Trip ID', 'Driver App Version', 'Last GPS Ping Timestamp'],
  'Report export failing': ['Report Type', 'Date Range Requested', 'Export Format (CSV/Excel)'],
  'OTP / boarding issue': ['Trip ID', 'Employee Phone / ID', 'SMS Gateway Status'],
  'Billing / invoice discrepancy': ['Invoice ID', 'Disputed Trip IDs', 'Rate Card Version'],
  'Cab delay / no-show complaint': ['Trip ID', 'Scheduled vs Actual Arrival', 'Vendor / Driver ID'],
  'Employee address / geocode change': ['Employee ID', 'New Lat/Long Verified', 'Next Shift Date'],
  'Login / access issue': ['User Email / ID', 'Auth Method (SSO/Password)', 'Error Screenshot Attached'],
  'Driver / vehicle compliance docs': ['Vehicle / Driver ID', 'Document Type', 'Expiry Date'],
  'How-to / feature request': ['Admin Role', 'Help Center Article Shared', 'Confirmed Feature Gap']
};

// 1. Executive & Weekly Overview Metrics
app.get('/api/metrics/overview', async (req, res) => {
  try {
    const summaryQuery = await pool.query(`
      SELECT
        COUNT(*)::int AS total_tickets,
        COUNT(*) FILTER (WHERE status != 'Closed')::int AS current_open_backlog,
        COUNT(*) FILTER (WHERE status != 'Closed' AND escalated_to_eng = TRUE AND eng_outcome IN ('Fixed','Duplicate of known issue','Not reproducible','Not a bug - how-to'))::int AS stale_handoffs_to_close,
        COUNT(*) FILTER (WHERE status != 'Closed' AND eng_outcome IN ('Insufficient info - returned to L1','Config issue - returned to L1'))::int AS returned_rework_open,
        COUNT(*) FILTER (WHERE status != 'Closed' AND escalated_to_eng = FALSE)::int AS active_l1_open,
        COUNT(*) FILTER (WHERE escalated_to_eng = TRUE)::int AS total_escalated,
        COUNT(*) FILTER (WHERE eng_outcome IN ('Insufficient info - returned to L1','Config issue - returned to L1','Duplicate of known issue','Not a bug - how-to','Not reproducible'))::int AS avoidable_escalations,
        COALESCE(SUM(eng_handoffs), 0)::int AS total_handoffs,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (final_closed_at - created_at))/3600.0) FILTER (WHERE escalated_to_eng = FALSE AND final_closed_at IS NOT NULL)::numeric, 1) AS median_l1_res_hrs,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (final_closed_at - created_at))/3600.0) FILTER (WHERE escalated_to_eng = TRUE AND final_closed_at IS NOT NULL)::numeric, 1) AS median_esc_res_hrs,
        ROUND(AVG(csat_score) FILTER (WHERE escalated_to_eng = FALSE)::numeric, 2) AS csat_l1,
        ROUND(AVG(csat_score) FILTER (WHERE escalated_to_eng = TRUE)::numeric, 2) AS csat_esc,
        ROUND((COUNT(*) FILTER (WHERE reopen_count > 0)::numeric / NULLIF(COUNT(*),0) * 100), 1) AS reopen_rate
      FROM tickets;
    `);

    const monthlyQuery = await pool.query(`
      SELECT
        TO_CHAR(created_at, 'YYYY-MM') AS month,
        COUNT(*)::int AS inflow,
        COUNT(*) FILTER (WHERE escalated_to_eng = TRUE)::int AS escalated,
        ROUND((COUNT(*) FILTER (WHERE escalated_to_eng = TRUE)::numeric / COUNT(*) * 100), 1) AS esc_rate,
        ROUND((COUNT(*) FILTER (WHERE reopen_count > 0)::numeric / COUNT(*) * 100), 1) AS reopen_rate,
        ROUND(AVG(csat_score)::numeric, 2) AS avg_csat
      FROM tickets
      GROUP BY 1
      ORDER BY 1;
    `);

    const categoryQuery = await pool.query(`
      SELECT
        category,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE escalated_to_eng = TRUE)::int AS escalated,
        ROUND((COUNT(*) FILTER (WHERE escalated_to_eng = TRUE)::numeric / COUNT(*) * 100), 1) AS esc_rate,
        COUNT(*) FILTER (WHERE eng_outcome IN ('Insufficient info - returned to L1','Config issue - returned to L1','Duplicate of known issue','Not a bug - how-to','Not reproducible'))::int AS avoidable_esc,
        COUNT(*) FILTER (WHERE status != 'Closed')::int AS still_open,
        ROUND(AVG(csat_score)::numeric, 2) AS avg_csat
      FROM tickets
      GROUP BY category
      ORDER BY escalated DESC;
    `);

    const outcomesQuery = await pool.query(`
      SELECT
        eng_outcome,
        COUNT(*)::int AS count,
        ROUND(AVG(eng_handoffs)::numeric, 2) AS avg_handoffs,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (final_closed_at - created_at))/3600.0) FILTER (WHERE final_closed_at IS NOT NULL)::numeric, 1) AS median_res_hrs,
        ROUND(AVG(csat_score)::numeric, 2) AS avg_csat
      FROM tickets
      WHERE escalated_to_eng = TRUE
      GROUP BY eng_outcome
      ORDER BY count DESC;
    `);

    res.json({
      summary: summaryQuery.rows[0],
      monthly: monthlyQuery.rows,
      categories: categoryQuery.rows,
      outcomes: outcomesQuery.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load overview metrics' });
  }
});

// 2. Open Backlog Queue (48 Open Tickets partitioned into 3 operational buckets)
app.get('/api/tickets/open-queue', async (req, res) => {
  try {
    const { bucket, search } = req.query;
    const { rows } = await pool.query(`
      SELECT
        *,
        CASE
          WHEN escalated_to_eng = TRUE AND eng_outcome IN ('Fixed','Duplicate of known issue','Not reproducible','Not a bug - how-to') THEN 'READY_TO_CLOSE'
          WHEN eng_outcome IN ('Insufficient info - returned to L1','Config issue - returned to L1') THEN 'RETURNED_REWORK'
          ELSE 'ACTIVE_L1_TRIAGE'
        END AS triage_bucket,
        ROUND(EXTRACT(EPOCH FROM (TIMESTAMP '2026-09-30 23:59:59' - created_at))/3600.0, 1) AS age_hrs_at_pull
      FROM tickets
      WHERE status != 'Closed'
      ORDER BY
        CASE priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END,
        created_at ASC;
    `);

    let filtered = rows;
    if (bucket && bucket !== 'ALL') {
      filtered = filtered.filter((t) => t.triage_bucket === bucket);
    }
    if (search && search.trim() !== '') {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (t) =>
          t.ticket_id.toLowerCase().includes(q) ||
          t.client_name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.assigned_agent.toLowerCase().includes(q)
      );
    }

    res.json({ tickets: filtered, total_open: rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load open ticket queue' });
  }
});

// 3. Pre-Escalation Gatekeeper Evaluation Engine
app.post('/api/tickets/evaluate', async (req, res) => {
  try {
    const { category, description, diagnostics = {}, override_known_issue = false } = req.body;
    const descLower = (description || '').toLowerCase();

    const { rows: playbooks } = await pool.query(
      'SELECT * FROM triage_playbooks WHERE category = $1',
      [category]
    );

    const matchedPlaybook = playbooks.find((pb) =>
      descLower.includes(pb.keyword_pattern.toLowerCase())
    );

    // Count historical duplicates for similar descriptions
    const keyword = descLower.split(' ').slice(0, 3).join(' ');
    const { rows: dupHist } = await pool.query(
      `SELECT COUNT(*)::int AS dup_count, MAX(eng_ticket_id) AS sample_eng_id
       FROM tickets
       WHERE category = $1
         AND eng_outcome = 'Duplicate of known issue'
         AND LOWER(description) LIKE $2`,
      [category, `%${keyword}%`]
    );

    const requiredFields = matchedPlaybook
      ? matchedPlaybook.required_fields
      : CATEGORY_DEFAULT_FIELDS[category] || ['Trip / Shift ID', 'Client Reproduction Steps'];

    const missingFields = requiredFields.filter(
      (field) => !diagnostics[field] || String(diagnostics[field]).trim() === ''
    );

    // Decision Gate 1: Known Engineering Bug / Duplicate Intercept
    if (!override_known_issue && matchedPlaybook && matchedPlaybook.playbook_type === 'KNOWN_BUG') {
      return res.json({
        decision: 'BLOCK_DUPLICATE',
        badge: 'Duplicate Blocked — Link Master Bug',
        playbook: matchedPlaybook,
        historical_duplicates: dupHist[0]?.dup_count || 0,
        required_fields: requiredFields,
        missing_fields: missingFields,
        message: `Matches active engineering bug ${matchedPlaybook.master_eng_id}. Do NOT file a new engineering ticket.`
      });
    }

    // Decision Gate 2: Self-Serve L1 Config Runbook Intercept
    if (!override_known_issue && matchedPlaybook && matchedPlaybook.playbook_type === 'CONFIG_RUNBOOK') {
      return res.json({
        decision: 'BLOCK_CONFIG',
        badge: 'L1 Config Fix Available — No Escalation Needed',
        playbook: matchedPlaybook,
        historical_duplicates: dupHist[0]?.dup_count || 0,
        required_fields: requiredFields,
        missing_fields: missingFields,
        message: '84 tickets like this were bounced back as Config Issues. Follow the L1 runbook below to resolve directly.'
      });
    }

    // Decision Gate 3: Mandatory Diagnostic Pre-Check Enforcement
    if (missingFields.length > 0) {
      return res.json({
        decision: 'BLOCK_MISSING_INFO',
        badge: 'Escalation Locked — Missing Diagnostics',
        playbook: matchedPlaybook || null,
        historical_duplicates: dupHist[0]?.dup_count || 0,
        required_fields: requiredFields,
        missing_fields: missingFields,
        message: `Complete ${missingFields.length} mandatory diagnostic check(s) before escalating so Engineering doesn't bounce this back.`
      });
    }

    // Decision Gate 4: Approved Clean Escalation
    return res.json({
      decision: 'ALLOW_ESCALATE',
      badge: 'Verified — Ready for Clean Engineering Handoff',
      playbook: matchedPlaybook || null,
      historical_duplicates: dupHist[0]?.dup_count || 0,
      required_fields: requiredFields,
      missing_fields: [],
      message: 'All pre-escalation diagnostics verified. Ready to dispatch clean payload to Engineering.'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gatekeeper evaluation failed' });
  }
});

// 4. Resolve / Close or Validated Escalation Mutation
app.patch('/api/tickets/:id/action', async (req, res) => {
  try {
    const { id } = req.params;
    const { action, resolution_note, diagnostics } = req.body;

    if (action === 'CLOSE_L1') {
      const { rows } = await pool.query(
        `UPDATE tickets
         SET status = 'Closed',
             first_closed_at = COALESCE(first_closed_at, NOW()),
             final_closed_at = NOW(),
             gatekeeper_notes = COALESCE(gatekeeper_notes, '{}'::jsonb) || $2::jsonb
         WHERE ticket_id = $1
         RETURNING *`,
        [id, JSON.stringify({ closed_via_gatekeeper: true, resolution_note, diagnostics })]
      );
      return res.json({ ticket: rows[0] });
    }

    if (action === 'ESCALATE_VERIFIED') {
      const newEngId = `ENG-${Math.floor(4400 + Math.random() * 500)}`;
      const { rows } = await pool.query(
        `UPDATE tickets
         SET escalated_to_eng = TRUE,
             eng_ticket_id = COALESCE(eng_ticket_id, $2),
             eng_handoffs = eng_handoffs + 1,
             status = 'Open - with Engineering',
             gatekeeper_notes = COALESCE(gatekeeper_notes, '{}'::jsonb) || $3::jsonb
         WHERE ticket_id = $1
         RETURNING *`,
        [id, newEngId, JSON.stringify({ verified_escalation: true, diagnostics })]
      );
      return res.json({ ticket: rows[0] });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update ticket' });
  }
});

// 5. Agent Quality Leaderboard (Exposes Reopen vs Escalation Outliers)
app.get('/api/agents/quality', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        assigned_agent,
        COUNT(*)::int AS total_tickets,
        ROUND((COUNT(*) FILTER (WHERE escalated_to_eng = TRUE)::numeric / COUNT(*) * 100), 1) AS esc_rate,
        COUNT(*) FILTER (WHERE eng_outcome IN ('Insufficient info - returned to L1','Config issue - returned to L1'))::int AS bounce_backs,
        ROUND((COUNT(*) FILTER (WHERE reopen_count > 0)::numeric / COUNT(*) * 100), 1) AS reopen_rate,
        ROUND(((COUNT(*) FILTER (WHERE status = 'Closed' AND reopen_count = 0))::numeric / COUNT(*) * 100), 1) AS fcr_quality_score,
        COUNT(*) FILTER (WHERE status != 'Closed')::int AS open_backlog,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_closed_at - created_at))/3600.0) FILTER (WHERE first_closed_at IS NOT NULL)::numeric, 1) AS median_first_close_hrs,
        ROUND(AVG(csat_score)::numeric, 2) AS avg_csat
      FROM tickets
      GROUP BY assigned_agent
      ORDER BY fcr_quality_score DESC;
    `);
    res.json({ agents: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch agent quality metrics' });
  }
});

// 6. Demo Reset Endpoint (Restores exact Sept 30 CSV snapshot before live walkthrough)
app.post('/api/admin/reset-demo', async (req, res) => {
  try {
    await runSeed(pool, true);
    res.json({ ok: true, message: 'Database reset to exact 1,444-ticket September 30 snapshot.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Serve built React frontend in production / Docker
const clientBuildPath = path.join(__dirname, 'public');
app.use(express.static(clientBuildPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(clientBuildPath, 'index.html'));
});

const PORT = process.env.PORT || 5000;
runSeed(pool, false)
  .then(() => {
    app.listen(PORT, () => console.log(`RideOps Gatekeeper running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('Startup seed failed:', err);
    process.exit(1);
  });