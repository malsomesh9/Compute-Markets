CREATE TABLE public.scheduler_leases (
 lease text PRIMARY KEY,
 owner_id uuid NOT NULL,
 fencing_token bigint NOT NULL DEFAULT 1 CHECK(fencing_token>0),
 expires_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.scheduler_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.scheduler_leases FROM anon,authenticated;

CREATE FUNCTION public.claim_scheduler_lease(p_lease text,p_owner uuid,p_ttl_seconds integer)
RETURNS SETOF public.scheduler_leases LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF length(p_lease) NOT BETWEEN 1 AND 100 OR p_ttl_seconds NOT BETWEEN 3 AND 300 THEN
  RAISE EXCEPTION 'Invalid scheduler lease';
 END IF;
 RETURN QUERY
 INSERT INTO public.scheduler_leases(lease,owner_id,expires_at)
 VALUES(p_lease,p_owner,clock_timestamp()+make_interval(secs=>p_ttl_seconds))
 ON CONFLICT(lease) DO UPDATE SET
  owner_id=EXCLUDED.owner_id,
  fencing_token=CASE WHEN public.scheduler_leases.owner_id=EXCLUDED.owner_id
   THEN public.scheduler_leases.fencing_token
   ELSE public.scheduler_leases.fencing_token+1 END,
  expires_at=EXCLUDED.expires_at,
  updated_at=clock_timestamp()
 WHERE public.scheduler_leases.owner_id=EXCLUDED.owner_id
    OR public.scheduler_leases.expires_at<clock_timestamp()
 RETURNING *;
END $$;

CREATE FUNCTION public.release_scheduler_lease(p_lease text,p_owner uuid,p_fencing_token bigint)
RETURNS boolean LANGUAGE sql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 WITH deleted AS (
  DELETE FROM public.scheduler_leases
  WHERE lease=p_lease AND owner_id=p_owner AND fencing_token=p_fencing_token
  RETURNING 1
 ) SELECT EXISTS(SELECT 1 FROM deleted)
$$;

REVOKE ALL ON FUNCTION public.claim_scheduler_lease(text,uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.release_scheduler_lease(text,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_scheduler_lease(text,uuid,integer) TO project_admin;
GRANT EXECUTE ON FUNCTION public.release_scheduler_lease(text,uuid,bigint) TO project_admin;

CREATE TABLE public.redundant_job_groups (
 id uuid PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES auth.users(id),
 buyer text NOT NULL,
 spec_hash text NOT NULL CHECK(spec_hash ~ '^[0-9a-f]{64}$'),
 required_matches smallint NOT NULL CHECK(required_matches BETWEEN 2 AND 3),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','RUNNING','PASSED','DISPUTED','FAILED','CANCELLED')),
 consensus_result_hash text CHECK(consensus_result_hash IS NULL OR consensus_result_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.redundant_job_replicas (
 group_id uuid NOT NULL REFERENCES public.redundant_job_groups(id) ON DELETE CASCADE,
 job_id text NOT NULL UNIQUE,
 ordinal smallint NOT NULL CHECK(ordinal BETWEEN 0 AND 4),
 provider_id text,
 machine_id text,
 result_hash text CHECK(result_hash IS NULL OR result_hash ~ '^[0-9a-f]{64}$'),
 verify1_passed boolean,
 PRIMARY KEY(group_id,ordinal)
);
CREATE UNIQUE INDEX redundant_provider_once_per_group
 ON public.redundant_job_replicas(group_id,provider_id) WHERE provider_id IS NOT NULL;

CREATE TABLE public.verification_challenges (
 id uuid PRIMARY KEY,
 job_id text NOT NULL UNIQUE,
 machine_id text NOT NULL,
 worker text NOT NULL,
 challenge jsonb NOT NULL CHECK(pg_column_size(challenge)<32768),
 expected_result_hash text NOT NULL CHECK(expected_result_hash ~ '^[0-9a-f]{64}$'),
 response jsonb,
 response_signature text,
 passed boolean,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.service_deployments (
 job_id text PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES auth.users(id),
 provider_id text,
 endpoint_url text,
 endpoint_token_hash text CHECK(endpoint_token_hash IS NULL OR endpoint_token_hash ~ '^[0-9a-f]{64}$'),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','STARTING','READY','STOPPING','STOPPED','FAILED')),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.distributed_jobs (
 job_id text PRIMARY KEY,
 ray_submission_id text NOT NULL UNIQUE,
 cluster_id text NOT NULL,
 worker_count integer NOT NULL CHECK(worker_count BETWEEN 1 AND 128),
 gpus_per_worker integer NOT NULL CHECK(gpus_per_worker BETWEEN 0 AND 16),
 state text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['redundant_job_groups','redundant_job_replicas','verification_challenges','service_deployments','distributed_jobs'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',t);
 END LOOP;
END $$;
