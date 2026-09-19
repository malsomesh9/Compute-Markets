-- Keep server-owned tables explicitly closed to browser roles. These tables
-- previously relied on PostgreSQL's secure no-policy default; explicit deny
-- policies make that intent auditable without granting any client access.
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'workers',
    'jobs',
    'bids',
    'receipts',
    'verifications',
    'chain_events',
    'indexer_cursors',
    'heartbeat_nonces',
    'hardware_reports',
    'agent_policies',
    'scheduler_leases',
    'redundant_job_groups',
    'redundant_job_replicas',
    'verification_challenges',
    'service_deployments',
    'distributed_jobs'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY client_deny ON public.%I AS RESTRICTIVE FOR ALL TO anon,authenticated USING (false) WITH CHECK (false)',
      table_name
    );
  END LOOP;
END $$;

-- Index every application foreign-key column used by deletes and joins.
CREATE INDEX service_deployments_owner_id_idx
  ON public.service_deployments(owner_id);
CREATE INDEX hardware_reports_machine_id_idx
  ON public.hardware_reports(machine_id);
CREATE INDEX bids_provider_id_idx
  ON public.bids(provider_id);
CREATE INDEX saved_offers_offer_id_idx
  ON public.saved_offers(offer_id);
CREATE INDEX redundant_job_groups_owner_id_idx
  ON public.redundant_job_groups(owner_id);
