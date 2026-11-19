CREATE TABLE IF NOT EXISTS tickets (
    ticket_id VARCHAR(12) PRIMARY KEY,
    created_at TIMESTAMP NOT NULL,
    channel VARCHAR(20) NOT NULL,
    client_id VARCHAR(10) NOT NULL,
    client_name VARCHAR(50) NOT NULL,
    client_tier VARCHAR(15) NOT NULL,
    category VARCHAR(45) NOT NULL,
    priority VARCHAR(5) NOT NULL,
    description TEXT NOT NULL,
    assigned_agent VARCHAR(25) NOT NULL,
    first_response_at TIMESTAMP NULL,
    escalated_to_eng BOOLEAN NOT NULL DEFAULT FALSE,
    eng_ticket_id VARCHAR(12) NULL,
    eng_handoffs INT NOT NULL DEFAULT 0,
    eng_outcome VARCHAR(45) NULL,
    status VARCHAR(30) NOT NULL,
    first_closed_at TIMESTAMP NULL,
    final_closed_at TIMESTAMP NULL,
    reopen_count INT NOT NULL DEFAULT 0,
    csat_score NUMERIC(2,1) NULL,
    gatekeeper_notes JSONB NULL
);

CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_category ON tickets(category);
CREATE INDEX IF NOT EXISTS idx_tickets_agent ON tickets(assigned_agent);
CREATE INDEX IF NOT EXISTS idx_tickets_created ON tickets(created_at);

CREATE TABLE IF NOT EXISTS triage_playbooks (
    id SERIAL PRIMARY KEY,
    category VARCHAR(45) NOT NULL,
    keyword_pattern VARCHAR(100) NOT NULL,
    playbook_type VARCHAR(20) NOT NULL, -- 'KNOWN_BUG' or 'CONFIG_RUNBOOK'
    master_eng_id VARCHAR(12) NULL,
    title VARCHAR(120) NOT NULL,
    resolution_steps JSONB NOT NULL,
    client_reply_template TEXT NOT NULL,
    required_fields JSONB NOT NULL
);