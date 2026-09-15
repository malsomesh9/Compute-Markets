ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS started_at bigint;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS submitted_at bigint;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS verified_at bigint;

CREATE TABLE IF NOT EXISTS public.benchmark_reports (
 id text PRIMARY KEY,
 machine_id text NOT NULL REFERENCES public.machines(id),
 worker text NOT NULL,
 hardware_report_hash text NOT NULL,
 image_digest text NOT NULL,
 report jsonb NOT NULL CHECK(pg_column_size(report)<32768),
 signature text NOT NULL,
 passed boolean NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS benchmark_reports_machine_created_idx ON public.benchmark_reports(machine_id,created_at DESC);
ALTER TABLE public.benchmark_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.benchmark_reports FROM anon,authenticated;
GRANT SELECT ON public.benchmark_reports TO anon,authenticated;
CREATE POLICY benchmark_public_read ON public.benchmark_reports FOR SELECT TO anon,authenticated USING(true);

CREATE TABLE IF NOT EXISTS public.market_price_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 gpu_model text NOT NULL,
 region text NOT NULL,
 offer_id text NOT NULL REFERENCES public.offers(id),
 rate_base_units_per_second numeric(20,0) NOT NULL CHECK(rate_base_units_per_second>0),
 available boolean NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(offer_id,recorded_at)
);
CREATE INDEX IF NOT EXISTS market_price_model_time_idx ON public.market_price_history(gpu_model,recorded_at DESC);
ALTER TABLE public.market_price_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.market_price_history FROM anon,authenticated;
GRANT SELECT ON public.market_price_history TO anon,authenticated;
CREATE POLICY market_price_public_read ON public.market_price_history FOR SELECT TO anon,authenticated USING(true);

ALTER TABLE public.chain_events ADD COLUMN IF NOT EXISTS block_time bigint;
ALTER TABLE public.chain_events ADD COLUMN IF NOT EXISTS event_name text;
ALTER TABLE public.chain_events ADD COLUMN IF NOT EXISTS event_data jsonb;
