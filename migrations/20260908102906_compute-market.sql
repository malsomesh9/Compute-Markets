CREATE TABLE public.providers (
 id text PRIMARY KEY, authority text NOT NULL UNIQUE, name text NOT NULL DEFAULT 'Independent provider',
 metadata_hash text NOT NULL, active boolean NOT NULL DEFAULT true, completed bigint NOT NULL DEFAULT 0 CHECK(completed>=0), failed bigint NOT NULL DEFAULT 0 CHECK(failed>=0), slot bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.workers (id text PRIMARY KEY, provider_id text NOT NULL REFERENCES public.providers(id), worker text NOT NULL, active boolean NOT NULL, expires_at bigint NOT NULL, slot bigint NOT NULL DEFAULT 0, UNIQUE(provider_id,worker));
CREATE TABLE public.machines (
 id text PRIMARY KEY, provider_id text NOT NULL REFERENCES public.providers(id), worker text NOT NULL, hardware_hash text NOT NULL,
 gpu_model text NOT NULL DEFAULT 'Undisclosed', gpu_count integer NOT NULL CHECK(gpu_count BETWEEN 1 AND 16), vram_mb integer NOT NULL CHECK(vram_mb>0), region text NOT NULL DEFAULT 'Undisclosed',
 trust_level text NOT NULL DEFAULT 'CLAIMED' CHECK(trust_level IN ('CLAIMED','BENCHMARKED')), active boolean NOT NULL, busy boolean NOT NULL DEFAULT false,
 completed bigint NOT NULL DEFAULT 0, failed bigint NOT NULL DEFAULT 0, slot bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.offers (id text PRIMARY KEY,machine_id text NOT NULL REFERENCES public.machines(id),rate_base_units_per_second numeric(20,0) NOT NULL CHECK(rate_base_units_per_second>0),min_seconds integer NOT NULL,max_seconds integer NOT NULL,expires_at bigint NOT NULL,active boolean NOT NULL,slot bigint NOT NULL DEFAULT 0);
CREATE TABLE public.jobs (
 id text PRIMARY KEY,buyer text NOT NULL,spec_hash text NOT NULL,mint text NOT NULL,state text NOT NULL CHECK(state IN ('CREATED','FUNDED','OPEN','MATCHED','ASSIGNED','STARTING','RUNNING','RESULT_SUBMITTED','VERIFYING','COMPLETED','CANCELLED','EXPIRED','FAILED','DISPUTED','REFUNDED')),
 budget numeric(20,0) NOT NULL,deposit numeric(20,0) NOT NULL DEFAULT 0,price numeric(20,0) NOT NULL DEFAULT 0,provider_id text,machine_id text,worker text,receipt_hash text,
 provider_paid numeric(20,0) NOT NULL DEFAULT 0,fee_paid numeric(20,0) NOT NULL DEFAULT 0,refunded numeric(20,0) NOT NULL DEFAULT 0,settled boolean NOT NULL DEFAULT false,
 deadline bigint NOT NULL,timeout_seconds integer NOT NULL,verification_policy text NOT NULL,slot bigint NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(NOT settled OR provider_paid+fee_paid+refunded=deposit)
);
CREATE TABLE public.job_specs (hash text PRIMARY KEY,owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),spec jsonb NOT NULL CHECK(pg_column_size(spec)<32768),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.bids (id text PRIMARY KEY,job_id text NOT NULL REFERENCES public.jobs(id),provider_id text NOT NULL REFERENCES public.providers(id),machine_id text NOT NULL REFERENCES public.machines(id),worker text NOT NULL,price numeric(20,0) NOT NULL CHECK(price>0),estimated_start bigint NOT NULL,expires_at bigint NOT NULL,active boolean NOT NULL,slot bigint NOT NULL DEFAULT 0,UNIQUE(job_id,provider_id));
CREATE TABLE public.receipts (job_id text PRIMARY KEY REFERENCES public.jobs(id),receipt_hash text NOT NULL UNIQUE,envelope jsonb NOT NULL CHECK(pg_column_size(envelope)<32768),owner_id uuid REFERENCES auth.users(id),storage_key text NOT NULL,storage_url text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.verifications (job_id text PRIMARY KEY REFERENCES public.jobs(id),receipt_hash text NOT NULL,verifier text NOT NULL,passed boolean NOT NULL,assurance text NOT NULL,failures jsonb NOT NULL DEFAULT '[]',tx_signature text,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.chain_events (signature text PRIMARY KEY,slot bigint NOT NULL,processed boolean NOT NULL DEFAULT false,error text,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.indexer_cursors (id text PRIMARY KEY,signature text,slot bigint NOT NULL DEFAULT 0,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.heartbeats (machine_id text PRIMARY KEY REFERENCES public.machines(id),worker text NOT NULL,timestamp bigint NOT NULL,available_gpu_count integer NOT NULL CHECK(available_gpu_count>=0),load numeric NOT NULL CHECK(load BETWEEN 0 AND 1),nonce uuid NOT NULL UNIQUE,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.heartbeat_nonces (nonce uuid PRIMARY KEY,worker text NOT NULL,expires_at timestamptz NOT NULL);
CREATE TABLE public.hardware_reports (hash text PRIMARY KEY,machine_id text NOT NULL REFERENCES public.machines(id),report jsonb NOT NULL CHECK(pg_column_size(report)<32768),signature text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.saved_offers (owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),offer_id text NOT NULL REFERENCES public.offers(id),PRIMARY KEY(owner_id,offer_id));
CREATE INDEX ON public.workers(provider_id);CREATE INDEX ON public.machines(provider_id);CREATE INDEX ON public.offers(machine_id);CREATE INDEX ON public.jobs(buyer);CREATE INDEX ON public.jobs(state);CREATE INDEX ON public.bids(job_id);CREATE INDEX ON public.bids(machine_id);CREATE INDEX ON public.job_specs(owner_id);CREATE INDEX ON public.receipts(owner_id);CREATE INDEX ON public.chain_events(processed,slot);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['providers','workers','machines','offers','jobs','bids','receipts','verifications','chain_events','indexer_cursors','heartbeats','heartbeat_nonces','hardware_reports','job_specs','saved_offers'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['providers','machines','offers','heartbeats'] LOOP
  EXECUTE format('GRANT SELECT ON public.%I TO anon,authenticated',t);
  EXECUTE format('CREATE POLICY public_read ON public.%I FOR SELECT TO anon,authenticated USING (true)',t);
 END LOOP;
END $$;
GRANT SELECT,INSERT,DELETE ON public.saved_offers TO authenticated;
CREATE POLICY saved_owner ON public.saved_offers FOR ALL TO authenticated USING(owner_id=(SELECT auth.uid())) WITH CHECK(owner_id=(SELECT auth.uid()));
GRANT SELECT,INSERT ON public.job_specs TO authenticated;
CREATE POLICY specs_read ON public.job_specs FOR SELECT TO authenticated USING(owner_id=(SELECT auth.uid()));
CREATE POLICY specs_insert ON public.job_specs FOR INSERT TO authenticated WITH CHECK(owner_id=(SELECT auth.uid()));
-- Chain projections are exclusively indexer-maintained. Private job/spec/receipt access is through authenticated API with wallet proof.
CREATE FUNCTION public.apply_projection(table_name text,row_data jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE columns_sql text; updates_sql text;
BEGIN
 IF table_name NOT IN ('providers','workers','machines','offers','jobs','bids') THEN RAISE EXCEPTION 'Invalid projection table';END IF;
 SELECT string_agg(format('%I',key),','),string_agg(format('%I=EXCLUDED.%I',key,key),',') INTO columns_sql,updates_sql FROM jsonb_object_keys(row_data) AS key WHERE key<>'id';
 EXECUTE format('INSERT INTO public.%I (id,%s) SELECT id,%s FROM jsonb_populate_record(NULL::public.%I,$1) ON CONFLICT(id) DO UPDATE SET %s WHERE public.%I.slot <= EXCLUDED.slot',table_name,columns_sql,columns_sql,table_name,updates_sql,table_name) USING row_data;
END $$;
REVOKE ALL ON FUNCTION public.apply_projection(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_projection(text,jsonb) TO project_admin;
CREATE FUNCTION public.record_heartbeat(p_machine text,p_worker text,p_time bigint,p_available integer,p_load numeric,p_nonce uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 INSERT INTO public.heartbeat_nonces(nonce,worker,expires_at) VALUES(p_nonce,p_worker,now()+interval '2 minutes');
 INSERT INTO public.heartbeats(machine_id,worker,timestamp,available_gpu_count,load,nonce) VALUES(p_machine,p_worker,p_time,p_available,p_load,p_nonce)
 ON CONFLICT(machine_id) DO UPDATE SET worker=EXCLUDED.worker,timestamp=EXCLUDED.timestamp,available_gpu_count=EXCLUDED.available_gpu_count,load=EXCLUDED.load,nonce=EXCLUDED.nonce,updated_at=now() WHERE public.heartbeats.timestamp<EXCLUDED.timestamp;
 DELETE FROM public.heartbeat_nonces WHERE expires_at<now();
END $$;
REVOKE ALL ON FUNCTION public.record_heartbeat(text,text,bigint,integer,numeric,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_heartbeat(text,text,bigint,integer,numeric,uuid) TO project_admin;
