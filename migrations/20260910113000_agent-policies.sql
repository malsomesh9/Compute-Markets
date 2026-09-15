CREATE TABLE public.agent_policies (
 id text PRIMARY KEY,
 owner_wallet text NOT NULL,
 agent text NOT NULL,
 mint text NOT NULL,
 daily_spend_limit numeric(20,0) NOT NULL CHECK(daily_spend_limit>0),
 single_job_limit numeric(20,0) NOT NULL CHECK(single_job_limit>0 AND single_job_limit<=daily_spend_limit),
 max_runtime_seconds integer NOT NULL CHECK(max_runtime_seconds BETWEEN 1 AND 86400),
 required_verification smallint NOT NULL CHECK(required_verification BETWEEN 0 AND 1),
 allowed_specs_root text NOT NULL CHECK(allowed_specs_root ~ '^[0-9a-f]{64}$'),
 expires_at bigint NOT NULL,
 day_index bigint NOT NULL,
 daily_spent numeric(20,0) NOT NULL DEFAULT 0 CHECK(daily_spent>=0),
 active boolean NOT NULL DEFAULT true,
 slot bigint NOT NULL DEFAULT 0,
 UNIQUE(owner_wallet,agent)
);

ALTER TABLE public.agent_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_policies FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.apply_projection(table_name text,row_data jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE columns_sql text; updates_sql text;
BEGIN
 IF table_name NOT IN ('providers','provider_stakes','agent_policies','workers','machines','offers','jobs','bids') THEN
  RAISE EXCEPTION 'Invalid projection table';
 END IF;
 SELECT string_agg(format('%I',key),',') INTO columns_sql
  FROM jsonb_object_keys(row_data) AS key WHERE key<>'id';
 SELECT string_agg(format('%I=EXCLUDED.%I',key,key),',') INTO updates_sql
  FROM jsonb_object_keys(row_data) AS key WHERE key NOT IN ('id','created_at');
 EXECUTE format(
  'INSERT INTO public.%I (id,%s) SELECT id,%s FROM jsonb_populate_record(NULL::public.%I,$1) ON CONFLICT(id) DO UPDATE SET %s WHERE public.%I.slot <= EXCLUDED.slot',
  table_name,columns_sql,columns_sql,table_name,updates_sql,table_name
 ) USING row_data;
END $$;

REVOKE ALL ON FUNCTION public.apply_projection(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_projection(text,jsonb) TO project_admin;
