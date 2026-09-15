ALTER TABLE public.machines DROP CONSTRAINT machines_gpu_count_check;
ALTER TABLE public.machines DROP CONSTRAINT machines_vram_mb_check;
ALTER TABLE public.machines ADD CONSTRAINT machines_gpu_count_check CHECK(gpu_count BETWEEN 0 AND 16);
ALTER TABLE public.machines ADD CONSTRAINT machines_vram_mb_check CHECK((gpu_count=0 AND vram_mb=0) OR (gpu_count>0 AND vram_mb>0));
