CREATE TABLE public.provider_stakes (
 id text PRIMARY KEY,
 provider_id text NOT NULL UNIQUE REFERENCES public.providers(id),
 mint text NOT NULL,
 deposited numeric(20,0) NOT NULL DEFAULT 0 CHECK(deposited>=0),
 pending_withdrawal numeric(20,0) NOT NULL DEFAULT 0 CHECK(pending_withdrawal>=0 AND pending_withdrawal<=deposited),
 unlock_at bigint NOT NULL DEFAULT 0,
 total_slashed numeric(20,0) NOT NULL DEFAULT 0 CHECK(total_slashed>=0),
 slot bigint NOT NULL DEFAULT 0
);

ALTER TABLE public.provider_stakes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.provider_stakes FROM anon, authenticated;
GRANT SELECT ON public.provider_stakes TO anon, authenticated;
CREATE POLICY public_read ON public.provider_stakes
 FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION public.apply_projection(table_name text,row_data jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE columns_sql text; updates_sql text;
BEGIN
 IF table_name NOT IN ('providers','provider_stakes','workers','machines','offers','jobs','bids') THEN
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
