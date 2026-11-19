const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const PLAYBOOKS = [
  {
    category: 'Roster / booking not syncing',
    keyword_pattern: 'cutoff',
    playbook_type: 'CONFIG_RUNBOOK',
    master_eng_id: null,
    title: 'Self-Serve Config Fix: Booking Cutoff Cache Propagation',
    resolution_steps: [
      'Open Client Admin Portal -> Shift Settings -> Cutoff Rules.',
      'Verify if cutoff was edited within 4 hours of shift start (cached roster window).',
      'Click "Force Re-sync Shift Cutoff" and trigger manual roster rebuild.',
      'Confirm updated cutoff timestamp reflects on next-day shift preview before closing.'
    ],
    client_reply_template: 'We refreshed your shift cutoff cache and triggered a manual roster sync. Please verify the updated cutoff window on tomorrow’s roster.',
    required_fields: ['Shift ID & Date', 'Old vs. New Cutoff Timestamp', 'Manual Re-sync Attempted (Yes/No)']
  },
  {
    category: 'Roster / booking not syncing',
    keyword_pattern: 'cancelled bookings',
    playbook_type: 'KNOWN_BUG',
    master_eng_id: 'ENG-4288',
    title: 'Known Engineering Issue (ENG-4288): Cancelled Trips Persisting in T+1 Roster',
    resolution_steps: [
      'Do NOT open a new engineering ticket — link directly to master incident ENG-4288.',
      'Use Admin Override -> Bulk Remove Cancelled Rows for tomorrow’s dispatch.',
      'Notify client transport admin that permanent webhook fix is in staging.'
    ],
    client_reply_template: 'This is a known sync issue (Ref: ENG-4288) currently being patched by engineering. In the meantime, we have manually cleared the cancelled bookings from tomorrow’s roster.',
    required_fields: ['Affected Shift Date', 'List of Cancelled Trip IDs', 'Manual Roster Cleanup Done (Yes/No)']
  },
  {
    category: 'Roster / booking not syncing',
    keyword_pattern: 'ad-hoc booking',
    playbook_type: 'CONFIG_RUNBOOK',
    master_eng_id: null,
    title: 'Self-Serve Config Fix: Ad-Hoc Booking Employee Push Notification & Sync',
    resolution_steps: [
      'Check if employee profile has an active home geocode verified.',
      'Verify ad-hoc booking was created under an active vendor route.',
      'Trigger "Resend Trip Assignment" from Dispatch Console.'
    ],
    client_reply_template: 'We verified the employee geocode and re-pushed the ad-hoc trip assignment to the employee app.',
    required_fields: ['Employee ID', 'Ad-Hoc Booking ID', 'Geocode Verified (Yes/No)']
  },
  {
    category: 'Live tracking / GPS incorrect',
    keyword_pattern: 'tracking link',
    playbook_type: 'CONFIG_RUNBOOK',
    master_eng_id: null,
    title: 'Self-Serve Config Fix: Security Team Public Tracking Token Expiry',
    resolution_steps: [
      'Check Client Security Settings -> Live Link TTL (default expires after 12 hrs).',
      'Regenerate whitelist IP / security dashboard token.',
      'Test live URL in incognito session before replying to client.'
    ],
    client_reply_template: 'Your security dashboard tracking token had expired. We regenerated a fresh live-tracking link and verified active map telemetry.',
    required_fields: ['Trip / Escort ID', 'HTTP Error Code on Link', 'Token Regenerated (Yes/No)']
  },
  {
    category: 'Live tracking / GPS incorrect',
    keyword_pattern: 'frozen',
    playbook_type: 'KNOWN_BUG',
    master_eng_id: 'ENG-4301',
    title: 'Known Engineering Issue (ENG-4301): Driver App Background GPS Throttle (v4.12)',
    resolution_steps: [
      'Check driver app version in Fleet Monitor. If v4.12, link to ENG-4301.',
      'Ask vendor supervisor to prompt driver to toggle GPS/foreground app.',
      'Only escalate if driver is on v4.13+ and telemetry gap exceeds 15 mins.'
    ],
    client_reply_template: 'We identified a background GPS sleep bug affecting driver app v4.12 (Ref: ENG-4301) and refreshed live telemetry for this cab.',
    required_fields: ['Trip ID', 'Driver App Version', 'Last GPS Ping Timestamp']
  },
  {
    category: 'Report export failing',
    keyword_pattern: 'stuck at loading',
    playbook_type: 'KNOWN_BUG',
    master_eng_id: 'ENG-4310',
    title: 'Known Engineering Issue (ENG-4310): Monthly Trip Report Timeout on >5,000 Rows',
    resolution_steps: [
      'Known duplicate cluster (9+ tickets linked to ENG-4310). Do NOT create a new ENG ticket.',
      'Workaround: Split export into two 15-day date ranges or trigger async CSV export.',
      'Attach generated CSV or confirm async email delivery.'
    ],
    client_reply_template: 'Large monthly exports (>5,000 trips) are hitting a known UI timeout (Ref: ENG-4310). We have generated your report in two 15-day batches and attached the files.',
    required_fields: ['Requested Date Range', 'Client Trip Volume', '15-Day Batch Workaround Sent (Yes/No)']
  },
  {
    category: 'Report export failing',
    keyword_pattern: '15 days',
    playbook_type: 'CONFIG_RUNBOOK',
    master_eng_id: null,
    title: 'Self-Serve Config Fix: Synchronous Report Date-Range Limit (>15 Days)',
    resolution_steps: [
      'Synchronous UI exports are capped at 15 days per query.',
      'Enable "Scheduled Async Email Export" under Client Reporting Permissions.',
      'Run export via Async Queue and verify delivery.'
    ],
    client_reply_template: 'Direct browser exports support up to 15 days at a time. We enabled Async Email Reporting on your admin account and sent the full-period report to your inbox.',
    required_fields: ['Start & End Date', 'Report Type (Trip/Billing)', 'Async Export Triggered (Yes/No)']
  },
  {
    category: 'Report export failing',
    keyword_pattern: 'scheduled report',
    playbook_type: 'KNOWN_BUG',
    master_eng_id: 'ENG-4315',
    title: 'Known Engineering Issue (ENG-4315): Cron Mailer Delay on 8 AM Scheduled Reports',
    resolution_steps: [
      'Link to known mailer queue bug ENG-4315.',
      'Verify client email domain is not blocking noreply@rideops.io.',
      'Trigger manual report dispatch from Admin Console.'
    ],
    client_reply_template: 'Our scheduled report mailer experienced a known queue delay (Ref: ENG-4315). We have manually dispatched today’s report to your configured recipients.',
    required_fields: ['Recipient Email List', 'Scheduled Time', 'Manual Dispatch Sent (Yes/No)']
  }
];

function parseTimestamp(val) {
  if (!val || val.trim() === '') return null;
  return val.trim();
}

async function runSeed(pool, forceReset = false) {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(schemaSql);

  if (forceReset) {
    await pool.query('TRUNCATE TABLE tickets, triage_playbooks RESTART IDENTITY;');
  }

  const { rows: countRows } = await pool.query('SELECT COUNT(*)::int AS cnt FROM tickets');
  if (countRows[0].cnt === 0) {
    const csvPath = process.env.CSV_PATH || path.join(__dirname, '..', 'data', 'rideops_support_tickets.csv');
    if (!fs.existsSync(csvPath)) {
      throw new Error(`CSV file not found at ${csvPath}. Place rideops_support_tickets.csv in /data.`);
    }

    const records = [];
    await new Promise((resolve, reject) => {
      fs.createReadStream(csvPath)
        .pipe(csv())
        .on('data', (row) => records.push(row))
        .on('end', resolve)
        .on('error', reject);
    });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const insertText = `
        INSERT INTO tickets (
          ticket_id, created_at, channel, client_id, client_name, client_tier,
          category, priority, description, assigned_agent, first_response_at,
          escalated_to_eng, eng_ticket_id, eng_handoffs, eng_outcome, status,
          first_closed_at, final_closed_at, reopen_count, csat_score
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
        ) ON CONFLICT (ticket_id) DO NOTHING
      `;

      for (const r of records) {
        await client.query(insertText, [
          r.ticket_id,
          parseTimestamp(r.created_at),
          r.channel,
          r.client_id,
          r.client_name,
          r.client_tier,
          r.category,
          r.priority,
          r.description,
          r.assigned_agent,
          parseTimestamp(r.first_response_at),
          r.escalated_to_eng === 'Yes',
          r.eng_ticket_id && r.eng_ticket_id.trim() !== '' ? r.eng_ticket_id.trim() : null,
          parseInt(r.eng_handoffs || '0', 10),
          r.eng_outcome && r.eng_outcome.trim() !== '' ? r.eng_outcome.trim() : null,
          r.status,
          parseTimestamp(r.first_closed_at),
          parseTimestamp(r.final_closed_at),
          parseInt(r.reopen_count || '0', 10),
          r.csat_score && r.csat_score.trim() !== '' ? parseFloat(r.csat_score) : null
        ]);
      }
      await client.query('COMMIT');
      console.log(`Seeded ${records.length} support tickets into PostgreSQL.`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  const { rows: pbCount } = await pool.query('SELECT COUNT(*)::int AS cnt FROM triage_playbooks');
  if (pbCount[0].cnt === 0) {
    for (const pb of PLAYBOOKS) {
      await pool.query(
        `INSERT INTO triage_playbooks
         (category, keyword_pattern, playbook_type, master_eng_id, title, resolution_steps, client_reply_template, required_fields)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb)`,
        [
          pb.category,
          pb.keyword_pattern,
          pb.playbook_type,
          pb.master_eng_id,
          pb.title,
          JSON.stringify(pb.resolution_steps),
          pb.client_reply_template,
          JSON.stringify(pb.required_fields)
        ]
      );
    }
    console.log(`Seeded ${PLAYBOOKS.length} triage playbooks.`);
  }
}

module.exports = { runSeed };