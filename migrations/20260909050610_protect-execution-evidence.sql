-- New projects may have RLS disabled on storage.objects. Private bucket flags
-- alone do not provide tenant isolation for authenticated callers.
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY execution_evidence_server_only ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated USING(bucket <> 'execution-evidence') WITH CHECK(bucket <> 'execution-evidence');
-- Multiple buyers can save identical specs without sharing private rows.
ALTER TABLE public.job_specs DROP CONSTRAINT job_specs_pkey;
ALTER TABLE public.job_specs ADD PRIMARY KEY(owner_id,hash);
CREATE INDEX job_specs_hash_idx ON public.job_specs(hash);
-- Keep original creation times when a chain account is re-projected.
CREATE OR REPLACE FUNCTION public.apply_projection(table_name text,row_data jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE columns_sql text; updates_sql text;
BEGIN
 IF table_name NOT IN ('providers','workers','machines','offers','jobs','bids') THEN RAISE EXCEPTION 'Invalid projection table';END IF;
 SELECT string_agg(format('%I',key),',') INTO columns_sql FROM jsonb_object_keys(row_data) AS key WHERE key<>'id';
 SELECT string_agg(format('%I=EXCLUDED.%I',key,key),',') INTO updates_sql FROM jsonb_object_keys(row_data) AS key WHERE key NOT IN ('id','created_at');
 EXECUTE format('INSERT INTO public.%I (id,%s) SELECT id,%s FROM jsonb_populate_record(NULL::public.%I,$1) ON CONFLICT(id) DO UPDATE SET %s WHERE public.%I.slot <= EXCLUDED.slot',table_name,columns_sql,columns_sql,table_name,updates_sql,table_name) USING row_data;
END $$;
