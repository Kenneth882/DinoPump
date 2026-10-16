# Use Supabase Pro and Render in US East for the recruiter demo

Accepted as the hosting plan on October 16, 2026; deployment validation pending.

The user selected Supabase Pro in North Virginia and two paid Render services
in Virginia for an unattended recruiter demo, accepting a USD 39/month base
estimate in place of the initial USD 10/month preference. Managed operations
and avoiding inactivity pauses justify the higher cost; Supabase supplies
PostgreSQL while the existing authoritative Node service, Socket.IO, guest
sessions, and multiplayer rules remain intact.

The game must use a stable database session (direct or session pooling), because
transaction pooling breaks its session-level ownership lock. These hosting
choices are a validation candidate, not deployment approval or capacity evidence;
the [hosting and validation plan](../hosting-validation.md) records initial
tiers, budget exclusions, harness reuse, and remaining #21/#22 gates.
