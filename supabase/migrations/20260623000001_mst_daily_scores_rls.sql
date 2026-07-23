-- Enable RLS on mst_daily_scores
ALTER TABLE "public"."mst_daily_scores" ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view scores
CREATE POLICY "Authenticated users can select mst_daily_scores"
ON "public"."mst_daily_scores"
FOR SELECT
TO authenticated
USING (true);

-- Allow authenticated users to insert scores
CREATE POLICY "Authenticated users can insert mst_daily_scores"
ON "public"."mst_daily_scores"
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Allow authenticated users to update scores
CREATE POLICY "Authenticated users can update mst_daily_scores"
ON "public"."mst_daily_scores"
FOR UPDATE
TO authenticated
USING (true);

-- Allow authenticated users to delete scores
CREATE POLICY "Authenticated users can delete mst_daily_scores"
ON "public"."mst_daily_scores"
FOR DELETE
TO authenticated
USING (true);
