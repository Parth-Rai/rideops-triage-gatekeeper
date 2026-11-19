import React, { useState, useEffect, useCallback } from 'react';

const CATEGORIES = [
  'Roster / booking not syncing',
  'Live tracking / GPS incorrect',
  'Report export failing',
  'Cab delay / no-show complaint',
  'How-to / feature request',
  'Login / access issue',
  'OTP / boarding issue',
  'Billing / invoice discrepancy',
  'Employee address / geocode change',
  'Driver / vehicle compliance docs'
];

const SIMULATOR_PRESETS = [
  {
    label: 'Roster Cutoff Not Syncing (Config Issue)',
    category: 'Roster / booking not syncing',
    description: 'Booking cutoff changed but roster still uses old cutoff'
  },
  {
    label: 'Cancelled Bookings on Tomorrow Roster (Known Bug)',
    category: 'Roster / booking not syncing',
    description: "Cancelled bookings still appearing in tomorrow's roster"
  },
  {
    label: 'Monthly Report Stuck Loading (Known Duplicate)',
    category: 'Report export failing',
    description: 'Monthly trip report download stuck at loading'
  },
  {
    label: 'GPS Wrong / Missing Diagnostics (Escalation Check)',
    category: 'Live tracking / GPS incorrect',
    description: 'Employee app shows cab 3 km away while cab is at gate'
  }
];

export default function App() {
  const [activeTab, setActiveTab] = useState('triage');
  const [overview, setOverview] = useState(null);
  const [openTickets, setOpenTickets] = useState([]);
  const [bucketFilter, setBucketFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [diagnostics, setDiagnostics] = useState({});
  const [overrideKnownIssue, setOverrideKnownIssue] = useState(false);
  const [evalResult, setEvalResult] = useState(null);
  const [agents, setAgents] = useState([]);
  const [toastMsg, setToastMsg] = useState('');

  // Simulator State (Tab 2)
  const [simCategory, setSimCategory] = useState(SIMULATOR_PRESETS[0].category);
  const [simDescription, setSimDescription] = useState(SIMULATOR_PRESETS[0].description);
  const [simDiagnostics, setSimDiagnostics] = useState({});
  const [simOverride, setSimOverride] = useState(false);
  const [simEval, setSimEval] = useState(null);

  const showToast = (msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 4000);
  };

  const fetchAllData = useCallback(async () => {
    const [ovRes, openRes, agRes] = await Promise.all([
      fetch('/api/metrics/overview'),
      fetch(`/api/tickets/open-queue?bucket=${bucketFilter}&search=${encodeURIComponent(searchQuery)}`),
      fetch('/api/agents/quality')
    ]);
    const ovData = await ovRes.json();
    const openData = await openRes.json();
    const agData = await agRes.json();

    setOverview(ovData);
    setOpenTickets(openData.tickets || []);
    setAgents(agData.agents || []);
  }, [bucketFilter, searchQuery]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  // Evaluate selected ticket in Tab 1 whenever ticket, diagnostics, or override changes
  useEffect(() => {
    if (!selectedTicket) {
      setEvalResult(null);
      return;
    }
    fetch('/api/tickets/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: selectedTicket.category,
        description: selectedTicket.description,
        diagnostics,
        override_known_issue: overrideKnownIssue
      })
    })
      .then((r) => r.json())
      .then(setEvalResult);
  }, [selectedTicket, diagnostics, overrideKnownIssue]);

  // Evaluate Simulator in Tab 2
  useEffect(() => {
    fetch('/api/tickets/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: simCategory,
        description: simDescription,
        diagnostics: simDiagnostics,
        override_known_issue: simOverride
      })
    })
      .then((r) => r.json())
      .then(setSimEval);
  }, [simCategory, simDescription, simDiagnostics, simOverride]);

  const handleSelectTicket = (t) => {
    setSelectedTicket(t);
    setDiagnostics({});
    setOverrideKnownIssue(false);
  };

  const handleTicketAction = async (action) => {
    if (!selectedTicket) return;
    const note =
      evalResult?.playbook?.client_reply_template ||
      'Verified resolution via L1 Gatekeeper checklist.';
    const res = await fetch(`/api/tickets/${selectedTicket.ticket_id}/action`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, resolution_note: note, diagnostics })
    });
    if (res.ok) {
      showToast(
        action === 'CLOSE_L1'
          ? `Closed ${selectedTicket.ticket_id} at L1 — Open backlog reduced!`
          : `Escalated ${selectedTicket.ticket_id} with verified diagnostics.`
      );
      setSelectedTicket(null);
      fetchAllData();
    }
  };

  const handleResetDemo = async () => {
    const res = await fetch('/api/admin/reset-demo', { method: 'POST' });
    if (res.ok) {
      setSelectedTicket(null);
      await fetchAllData();
      showToast('Demo reset to exact Sept 30 CSV snapshot (48 open tickets).');
    }
  };

  const summary = overview?.summary;

  return (
    <div>
      {/* Top Navbar */}
      <nav className="navbar navbar-dark bg-dark px-4 py-2 shadow-sm">
        <div className="d-flex align-items-center gap-3">
          <span className="navbar-brand fw-bold mb-0">
            RideOps <span className="text-info">Triage Gatekeeper</span>
          </span>
          <span className="badge bg-secondary">v0 Operational Build</span>
        </div>
        <div className="d-flex align-items-center gap-3">
          {summary && (
            <span className="badge bg-danger fs-6">
              Open Backlog: {summary.current_open_backlog} (Target: &le;25)
            </span>
          )}
          <button className="btn btn-outline-light btn-sm" onClick={handleResetDemo}>
            Reset Demo Data
          </button>
        </div>
      </nav>

      {toastMsg && (
        <div className="alert alert-success rounded-0 mb-0 py-2 text-center fw-semibold">
          {toastMsg}
        </div>
      )}

      <div className="container-fluid px-4 py-3">
        {/* Live KPI Strip */}
        {summary && (
          <div className="row g-3 mb-3">
            <div className="col-md-3">
              <div className="card border-0 shadow-sm h-100">
                <div className="card-body">
                  <div className="text-muted small text-uppercase fw-bold">Current Open Backlog</div>
                  <div className="fs-2 fw-bold text-danger">{summary.current_open_backlog}</div>
                  <div className="small text-muted">
                    {summary.stale_handoffs_to_close} ready to close &bull; {summary.returned_rework_open} bounced back
                  </div>
                </div>
              </div>
            </div>
            <div className="col-md-3">
              <div className="card border-0 shadow-sm h-100">
                <div className="card-body">
                  <div className="text-muted small text-uppercase fw-bold">Avoidable Escalation Rate</div>
                  <div className="fs-2 fw-bold text-warning">
                    {((summary.avoidable_escalations / summary.total_escalated) * 100).toFixed(1)}%
                  </div>
                  <div className="small text-muted">
                    {summary.avoidable_escalations} of {summary.total_escalated} escalations were non-bugs
                  </div>
                </div>
              </div>
            </div>
            <div className="col-md-3">
              <div className="card border-0 shadow-sm h-100">
                <div className="card-body">
                  <div className="text-muted small text-uppercase fw-bold">Median Resolution Time</div>
                  <div className="fs-2 fw-bold text-primary">
                    {summary.median_l1_res_hrs}h <span className="fs-6 text-muted">L1 vs</span>{' '}
                    <span className="text-danger">{summary.median_esc_res_hrs}h</span> <span className="fs-6 text-muted">Esc</span>
                  </div>
                  <div className="small text-muted">Escalations take ~7x longer (777 total handoffs)</div>
                </div>
              </div>
            </div>
            <div className="col-md-3">
              <div className="card border-0 shadow-sm h-100">
                <div className="card-body">
                  <div className="text-muted small text-uppercase fw-bold">Client Satisfaction (CSAT)</div>
                  <div className="fs-2 fw-bold text-success">
                    {summary.csat_l1} <span className="fs-6 text-muted">L1 vs</span>{' '}
                    <span className="text-danger">{summary.csat_esc}</span> <span className="fs-6 text-muted">Esc</span>
                  </div>
                  <div className="small text-muted">Overall Reopen Rate: {summary.reopen_rate}%</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Navigation Tabs */}
        <ul className="nav nav-tabs mb-3">
          <li className="nav-item">
            <button
              className={`nav-link fw-semibold ${activeTab === 'triage' ? 'active' : ''}`}
              onClick={() => setActiveTab('triage')}
            >
              1. L1 Open Backlog Triage ({summary?.current_open_backlog ?? 48})
            </button>
          </li>
          <li className="nav-item">
            <button
              className={`nav-link fw-semibold ${activeTab === 'simulator' ? 'active' : ''}`}
              onClick={() => setActiveTab('simulator')}
            >
              2. Pre-Escalation Gatekeeper Simulator
            </button>
          </li>
          <li className="nav-item">
            <button
              className={`nav-link fw-semibold ${activeTab === 'scorecard' ? 'active' : ''}`}
              onClick={() => setActiveTab('scorecard')}
            >
              3. Ops & Agent Quality Scorecard (Meera / Ritika)
            </button>
          </li>
        </ul>

        {/* TAB 1: L1 OPEN BACKLOG TRIAGE */}
        {activeTab === 'triage' && (
          <div className="row g-3">
            {/* Left Column: Open Queue */}
            <div className="col-lg-6">
              <div className="card border-0 shadow-sm">
                <div className="card-header bg-white py-3">
                  <div className="d-flex flex-wrap gap-2 mb-2">
                    {[
                      { id: 'ALL', label: `All Open (${summary?.current_open_backlog ?? 48})` },
                      { id: 'READY_TO_CLOSE', label: `Ready to Close (${summary?.stale_handoffs_to_close ?? 16})` },
                      { id: 'RETURNED_REWORK', label: `Returned Rework (${summary?.returned_rework_open ?? 18})` },
                      { id: 'ACTIVE_L1_TRIAGE', label: `Active L1 (${summary?.active_l1_open ?? 14})` }
                    ].map((b) => (
                      <button
                        key={b.id}
                        className={`btn btn-sm ${bucketFilter === b.id ? 'btn-dark' : 'btn-outline-secondary'}`}
                        onClick={() => setBucketFilter(b.id)}
                      >
                        {b.label}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    placeholder="Filter by ticket ID, client, agent, or symptom..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <div className="list-group list-group-flush" style={{ maxHeight: '620px', overflowY: 'auto' }}>
                  {openTickets.map((t) => (
                    <button
                      key={t.ticket_id}
                      className={`list-group-item list-group-item-action py-3 ${
                        selectedTicket?.ticket_id === t.ticket_id ? 'active' : ''
                      }`}
                      onClick={() => handleSelectTicket(t)}
                    >
                      <div className="d-flex justify-content-between align-items-center mb-1">
                        <div>
                          <span className="fw-bold me-2">{t.ticket_id}</span>
                          <span
                            className={`badge me-2 ${
                              t.priority === 'P1'
                                ? 'bg-danger'
                                : t.priority === 'P2'
                                ? 'bg-warning text-dark'
                                : 'bg-secondary'
                            }`}
                          >
                            {t.priority}
                          </span>
                          <span className="small fw-semibold">{t.client_name}</span>
                        </div>
                        <span
                          className={`badge ${
                            t.triage_bucket === 'READY_TO_CLOSE'
                              ? 'bg-success'
                              : t.triage_bucket === 'RETURNED_REWORK'
                              ? 'bg-warning text-dark'
                              : 'bg-info text-dark'
                          }`}
                        >
                          {t.triage_bucket.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div className="small mb-1">{t.description}</div>
                      <div className="d-flex justify-content-between small opacity-75">
                        <span>{t.category} &bull; Agent: {t.assigned_agent}</span>
                        <span>
                          Handoffs: {t.eng_handoffs} {t.eng_outcome ? `(${t.eng_outcome})` : ''}
                        </span>
                      </div>
                    </button>
                  ))}
                  {openTickets.length === 0 && (
                    <div className="p-4 text-center text-muted">No open tickets match this filter.</div>
                  )}
                </div>
              </div>
            </div>

            {/* Right Column: Interactive Gatekeeper Workspace */}
            <div className="col-lg-6">
              <div className="card border-0 shadow-sm h-100">
                <div className="card-header bg-white py-3 fw-bold">
                  L1 Gatekeeper & Resolution Drawer
                </div>
                <div className="card-body">
                  {!selectedTicket ? (
                    <div className="text-center text-muted py-5">
                      <h5>Select an open ticket on the left to triage</h5>
                      <p className="small">
                        Tip: Filter by <strong>Ready to Close (16)</strong> to clear stalled engineering handoffs immediately, or pick a <strong>Returned Rework (18)</strong> ticket to run the config & diagnostic gatekeeper.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="d-flex justify-content-between align-items-start mb-2">
                        <div>
                          <h5 className="mb-0">
                            {selectedTicket.ticket_id} — {selectedTicket.client_name}
                          </h5>
                          <div className="small text-muted">
                            Category: <strong>{selectedTicket.category}</strong> &bull; Channel: {selectedTicket.channel} &bull; Tier: {selectedTicket.client_tier}
                          </div>
                        </div>
                        <span className="badge bg-dark">{selectedTicket.status}</span>
                      </div>

                      <div className="p-2 bg-light border rounded mb-3">
                        <strong>Symptom:</strong> {selectedTicket.description}
                        {selectedTicket.eng_outcome && (
                          <div className="mt-1 text-danger small">
                            <strong>Engineering Verdict ({selectedTicket.eng_ticket_id}):</strong>{' '}
                            {selectedTicket.eng_outcome} ({selectedTicket.eng_handoffs} handoffs)
                          </div>
                        )}
                      </div>

                      {evalResult && (
                        <>
                          <div
                            className={`alert ${
                              evalResult.decision === 'ALLOW_ESCALATE'
                                ? 'alert-success'
                                : evalResult.decision === 'BLOCK_DUPLICATE'
                                ? 'alert-info'
                                : 'alert-warning'
                            }`}
                          >
                            <div className="fw-bold">{evalResult.badge}</div>
                            <div className="small">{evalResult.message}</div>
                          </div>

                          {evalResult.playbook && (
                            <div className="card border-primary mb-3">
                              <div className="card-header bg-primary text-white py-2 small fw-bold">
                                {evalResult.playbook.title}
                              </div>
                              <div className="card-body py-2">
                                <ol className="small mb-2 ps-3">
                                  {evalResult.playbook.resolution_steps.map((step, i) => (
                                    <li key={i}>{step}</li>
                                  ))}
                                </ol>
                                <div className="p-2 bg-light rounded small">
                                  <strong>Client Reply Template:</strong>{' '}
                                  <em>"{evalResult.playbook.client_reply_template}"</em>
                                </div>
                              </div>
                            </div>
                          )}

                          <h6 className="fw-bold mt-3">Mandatory Pre-Escalation Diagnostic Checks</h6>
                          <div className="row g-2 mb-3">
                            {evalResult.required_fields.map((field) => (
                              <div className="col-12" key={field}>
                                <label className="form-label small fw-semibold mb-1">{field} *</label>
                                <input
                                  type="text"
                                  className="form-control form-control-sm"
                                  placeholder={`Enter ${field}...`}
                                  value={diagnostics[field] || ''}
                                  onChange={(e) =>
                                    setDiagnostics((prev) => ({ ...prev, [field]: e.target.value }))
                                  }
                                />
                              </div>
                            ))}
                          </div>

                          {(evalResult.decision === 'BLOCK_DUPLICATE' ||
                            evalResult.decision === 'BLOCK_CONFIG') && (
                            <div className="form-check mb-3">
                              <input
                                className="form-check-input"
                                type="checkbox"
                                id="overrideCheck"
                                checked={overrideKnownIssue}
                                onChange={(e) => setOverrideKnownIssue(e.target.checked)}
                              />
                              <label className="form-check-label small" htmlFor="overrideCheck">
                                I executed the runbook / workaround above and confirmed a code fix is still required.
                              </label>
                            </div>
                          )}

                          <div className="d-flex gap-2 mt-3">
                            <button
                              className="btn btn-success flex-grow-1"
                              onClick={() => handleTicketAction('CLOSE_L1')}
                            >
                              Verify & Close Ticket at L1
                            </button>
                            <button
                              className="btn btn-danger"
                              disabled={evalResult.decision !== 'ALLOW_ESCALATE'}
                              onClick={() => handleTicketAction('ESCALATE_VERIFIED')}
                            >
                              Escalate to Engineering
                            </button>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: GATEKEEPER SIMULATOR */}
        {activeTab === 'simulator' && (
          <div className="row g-3">
            <div className="col-md-6">
              <div className="card border-0 shadow-sm">
                <div className="card-header bg-white fw-bold py-3">
                  Simulate Incoming Ticket Intake (Test the Gatekeeper)
                </div>
                <div className="card-body">
                  <div className="mb-3">
                    <label className="form-label small fw-bold">Quick-Load Real Dataset Scenarios:</label>
                    <div className="d-flex flex-wrap gap-2">
                      {SIMULATOR_PRESETS.map((p) => (
                        <button
                          key={p.label}
                          className="btn btn-outline-primary btn-sm"
                          onClick={() => {
                            setSimCategory(p.category);
                            setSimDescription(p.description);
                            setSimDiagnostics({});
                            setSimOverride(false);
                          }}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mb-3">
                    <label className="form-label small fw-bold">Issue Category</label>
                    <select
                      className="form-select"
                      value={simCategory}
                      onChange={(e) => {
                        setSimCategory(e.target.value);
                        setSimDiagnostics({});
                      }}
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="mb-3">
                    <label className="form-label small fw-bold">Client Symptom Description</label>
                    <input
                      type="text"
                      className="form-control"
                      value={simDescription}
                      onChange={(e) => setSimDescription(e.target.value)}
                    />
                  </div>

                  {simEval && (
                    <>
                      <h6 className="fw-bold">Required L1 Diagnostic Inputs</h6>
                      {simEval.required_fields.map((field) => (
                        <div className="mb-2" key={field}>
                          <label className="form-label small mb-1">{field}</label>
                          <input
                            type="text"
                            className="form-control form-control-sm"
                            value={simDiagnostics[field] || ''}
                            onChange={(e) =>
                              setSimDiagnostics((prev) => ({ ...prev, [field]: e.target.value }))
                            }
                          />
                        </div>
                      ))}

                      {(simEval.decision === 'BLOCK_DUPLICATE' ||
                        simEval.decision === 'BLOCK_CONFIG') && (
                        <div className="form-check mt-2">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            id="simOverrideCheck"
                            checked={simOverride}
                            onChange={(e) => setSimOverride(e.target.checked)}
                          />
                          <label className="form-check-label small" htmlFor="simOverrideCheck">
                            Override: Runbook completed, issue persists
                          </label>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="col-md-6">
              {simEval && (
                <div className="card border-0 shadow-sm h-100">
                  <div className="card-header bg-white fw-bold py-3">
                    Gatekeeper Real-Time Intercept Verdict
                  </div>
                  <div className="card-body">
                    <div
                      className={`alert ${
                        simEval.decision === 'ALLOW_ESCALATE'
                          ? 'alert-success'
                          : simEval.decision === 'BLOCK_DUPLICATE'
                          ? 'alert-info'
                          : 'alert-warning'
                      }`}
                    >
                      <h6 className="fw-bold mb-1">{simEval.badge}</h6>
                      <div className="small">{simEval.message}</div>
                      {simEval.historical_duplicates > 0 && (
                        <div className="small mt-1 fw-semibold">
                          Historical Impact: {simEval.historical_duplicates} duplicate escalations matched this pattern in Q3.
                        </div>
                      )}
                    </div>

                    {simEval.playbook && (
                      <div className="border rounded p-3 mb-3 bg-light">
                        <div className="fw-bold text-primary mb-2">{simEval.playbook.title}</div>
                        <ol className="small ps-3 mb-2">
                          {simEval.playbook.resolution_steps.map((s, idx) => (
                            <li key={idx}>{s}</li>
                          ))}
                        </ol>
                        <div className="small text-muted">
                          <strong>Auto-Reply:</strong> "{simEval.playbook.client_reply_template}"
                        </div>
                      </div>
                    )}

                    <button
                      className="btn btn-danger w-100"
                      disabled={simEval.decision !== 'ALLOW_ESCALATE'}
                    >
                      {simEval.decision === 'ALLOW_ESCALATE'
                        ? 'Escalate to Engineering (Unlocked — Clean Handoff)'
                        : 'Escalate to Engineering (Blocked by Gatekeeper)'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: OPS & AGENT QUALITY SCORECARD */}
        {activeTab === 'scorecard' && overview && (
          <div className="row g-3">
            {/* Category Concentration */}
            <div className="col-lg-7">
              <div className="card border-0 shadow-sm">
                <div className="card-header bg-white fw-bold py-3">
                  Escalation Concentration by Category (Top 3 = 78.0% of Escalations)
                </div>
                <div className="table-responsive">
                  <table className="table table-sm table-hover mb-0 align-middle">
                    <thead className="table-light">
                      <tr>
                        <th>Category</th>
                        <th className="text-end">Tickets</th>
                        <th className="text-end">Esc %</th>
                        <th className="text-end">Avoidable Esc</th>
                        <th className="text-end">Open</th>
                        <th className="text-end">CSAT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.categories.map((c, idx) => (
                        <tr key={c.category} className={idx < 3 ? 'table-warning' : ''}>
                          <td className="fw-semibold">{c.category}</td>
                          <td className="text-end">{c.total}</td>
                          <td className="text-end fw-bold">{c.esc_rate}%</td>
                          <td className="text-end text-danger">{c.avoidable_esc}</td>
                          <td className="text-end">{c.still_open}</td>
                          <td className="text-end">{c.avg_csat}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Engineering Outcome Breakdown */}
            <div className="col-lg-5">
              <div className="card border-0 shadow-sm">
                <div className="card-header bg-white fw-bold py-3">
                  Engineering Escalation Outcomes (N = 486)
                </div>
                <div className="table-responsive">
                  <table className="table table-sm mb-0 align-middle">
                    <thead className="table-light">
                      <tr>
                        <th>Outcome</th>
                        <th className="text-end">Count</th>
                        <th className="text-end">Handoffs</th>
                        <th className="text-end">Med Hrs</th>
                        <th className="text-end">CSAT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.outcomes.map((o) => (
                        <tr
                          key={o.eng_outcome}
                          className={o.eng_outcome !== 'Fixed' ? 'table-danger' : ''}
                        >
                          <td className="small fw-semibold">{o.eng_outcome}</td>
                          <td className="text-end">{o.count}</td>
                          <td className="text-end">{o.avg_handoffs}</td>
                          <td className="text-end">{o.median_res_hrs}h</td>
                          <td className="text-end">{o.avg_csat}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Agent Quality Leaderboard */}
            <div className="col-12">
              <div className="card border-0 shadow-sm">
                <div className="card-header bg-white fw-bold py-3">
                  L1 Agent Quality Leaderboard (Exposing Premature Close vs. Over-Escalation)
                </div>
                <div className="table-responsive">
                  <table className="table table-sm table-hover mb-0 align-middle">
                    <thead className="table-light">
                      <tr>
                        <th>Agent</th>
                        <th className="text-end">Assigned</th>
                        <th className="text-end">Med 1st Close</th>
                        <th className="text-end">Reopen Rate</th>
                        <th className="text-end">Escalation %</th>
                        <th className="text-end">Bounce-Backs</th>
                        <th className="text-end">FCR Quality Score</th>
                        <th className="text-end">CSAT</th>
                        <th>Coaching Focus</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agents.map((a) => {
                        const isKaran = a.assigned_agent === 'Karan B';
                        const isRahul = a.assigned_agent === 'Rahul T';
                        return (
                          <tr
                            key={a.assigned_agent}
                            className={isKaran || isRahul ? 'table-warning' : ''}
                          >
                            <td className="fw-bold">{a.assigned_agent}</td>
                            <td className="text-end">{a.total_tickets}</td>
                            <td className="text-end">{a.median_first_close_hrs}h</td>
                            <td className={`text-end fw-bold ${isKaran ? 'text-danger' : ''}`}>
                              {a.reopen_rate}%
                            </td>
                            <td className={`text-end fw-bold ${isRahul ? 'text-danger' : ''}`}>
                              {a.esc_rate}%
                            </td>
                            <td className="text-end">{a.bounce_backs}</td>
                            <td className="text-end fw-bold text-primary">{a.fcr_quality_score}%</td>
                            <td className="text-end">{a.avg_csat}</td>
                            <td className="small">
                              {isKaran && (
                                <span className="badge bg-danger">
                                  Premature Closure Outlier (42% of team reopens)
                                </span>
                              )}
                              {isRahul && (
                                <span className="badge bg-warning text-dark">
                                  Over-Escalation Outlier (43 bounce-backs)
                                </span>
                              )}
                              {!isKaran && !isRahul && (
                                <span className="text-muted">Healthy baseline</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}