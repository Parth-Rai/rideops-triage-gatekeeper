# RideOps L1 Triage & Escalation Gatekeeper (v0)

An internal PERN-stack operational triage tool built to cut RideOps' +60% open ticket backlog without adding headcount.

## What It Solves
1. **Clears Stalled Backlog Immediately:** Partitions the 48 open tickets into *Ready to Close (16)*, *Returned Rework (18)*, and *Active L1 Triage (14)*.
2. **Blocks 56.6% Avoidable Escalations:** Intercepts known duplicate bugs (`ENG-4288`, `ENG-4301`, `ENG-4310`, `ENG-4315`), provides self-serve L1 configuration runbooks, and locks the escalation button until category-specific diagnostic fields are filled.
3. **Replaces Speed-Only KPIs with FCR Quality:** Exposes premature closures (29.5% reopen rate) alongside over-escalation outliers (61.6% escalation rate).

## Run Locally with Docker (1 Command)
1. Place `rideops_support_tickets.csv` inside `/data`.
2. Run:
   ```bash
   docker-compose up --build