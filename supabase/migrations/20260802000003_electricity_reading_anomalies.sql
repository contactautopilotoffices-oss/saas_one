-- Electricity reading data quality.
--
-- WHY: 13 of 2,219 readings carry impossible values and single-handedly destroy every
-- aggregate built on this table. July 2026 sums to 717,049,536 kWh / Rs 574cr against a
-- median daily reading of ~1,200 kWh. A month-over-month chart built naively on
-- SUM(final_units) is not merely wrong, it is wrong by three orders of magnitude — so the
-- dashboard needs both (a) an aggregate that ignores these rows and (b) a way to surface
-- them, because they are a real operational problem, not a display bug.
--
-- THE FOUR OBSERVED DEFECTS
--   1. Meter 'EB-1' at SS Plaza has multiplier_value_used = 1000. Its register already
--      reads kWh (opening 624,505 -> closing 630,102 = 5,597 kWh/day, plausible for the
--      site), so the 1000x multiplier inflates 12 rows into the millions. This is a
--      configuration error in meter_multipliers, not a typo.
--   2. 2026-07-15 SS Plaza EB-1: opening_reading 72,288.35 where the prior close was
--      ~730,000 — a dropped digit. Yields 666,075 units before the multiplier.
--   3. 2026-06-25 SS Plaza 'Jio Tower': opening 32,651.8 against a close of 327,599 —
--      the same dropped digit, yielding 294,947 units instead of ~1,081.
--   4. 2026-03-31 AMR Altruist 'Eb': opening_reading = 1, a meter-initialisation row that
--      should never have been treated as consumption.
--
-- This migration does NOT mutate any reading. Deciding that a meter's multiplier is wrong,
-- or that a digit was dropped, is an operator's call — the view flags candidates and the UI
-- asks. Nothing here silently rewrites recorded meter data.

-- Ratio at which a reading is considered impossible relative to its own meter's typical
-- day. 10x is deliberately generous: real spikes (a heatwave, a new floor coming online)
-- rarely exceed 3-4x, so 10x flags only genuine data errors and keeps the alert trustworthy.
-- A tile that cries wolf gets ignored, which defeats the point.

CREATE OR REPLACE VIEW public.electricity_reading_anomalies
WITH (security_invoker = on) AS
WITH per_meter AS (
    SELECT
        meter_id,
        percentile_cont(0.5) WITHIN GROUP (
            ORDER BY COALESCE(final_units, computed_units, 0)
        ) AS median_units,
        count(*) AS sample_size
    FROM public.electricity_readings
    WHERE COALESCE(final_units, computed_units, 0) > 0
    GROUP BY meter_id
)
SELECT
    r.id,
    r.property_id,
    r.meter_id,
    m.name  AS meter_name,
    p.name  AS property_name,
    r.reading_date,
    r.opening_reading,
    r.closing_reading,
    r.computed_units,
    r.multiplier_value_used,
    COALESCE(r.final_units, r.computed_units, 0) AS units,
    r.computed_cost,
    pm.median_units,
    CASE
        WHEN pm.median_units > 0
        THEN round((COALESCE(r.final_units, r.computed_units, 0) / pm.median_units)::numeric, 1)
    END AS times_typical,
    CASE
        -- Ordered by confidence: the most specific diagnosis wins.
        WHEN r.closing_reading IS NOT NULL
         AND r.opening_reading IS NOT NULL
         AND r.closing_reading < r.opening_reading            THEN 'negative_consumption'
        WHEN r.opening_reading IS NOT NULL
         AND r.opening_reading <= 1
         AND COALESCE(r.final_units, r.computed_units, 0) > 1000 THEN 'meter_initialisation'
        -- A close 5x+ larger than the open in the same register usually means a digit was
        -- dropped from the opening value.
        WHEN r.opening_reading IS NOT NULL
         AND r.opening_reading > 1
         AND r.closing_reading IS NOT NULL
         AND r.closing_reading > r.opening_reading * 5        THEN 'suspected_digit_drop'
        WHEN r.multiplier_value_used IS NOT NULL
         AND r.multiplier_value_used >= 1000
         AND pm.median_units > 0
         AND COALESCE(r.final_units, r.computed_units, 0) > pm.median_units * 10
                                                              THEN 'suspect_multiplier'
        ELSE 'outlier'
    END AS anomaly_kind
FROM public.electricity_readings r
JOIN per_meter pm ON pm.meter_id = r.meter_id
LEFT JOIN public.electricity_meters m ON m.id = r.meter_id
LEFT JOIN public.properties        p ON p.id = r.property_id
WHERE
    -- Needs enough history for a median to mean anything.
    pm.sample_size >= 5
    AND (
        (pm.median_units > 0 AND COALESCE(r.final_units, r.computed_units, 0) > pm.median_units * 10)
        OR (r.closing_reading IS NOT NULL AND r.opening_reading IS NOT NULL
            AND r.closing_reading < r.opening_reading)
        OR (r.opening_reading IS NOT NULL AND r.opening_reading <= 1
            AND COALESCE(r.final_units, r.computed_units, 0) > 1000)
    );

COMMENT ON VIEW public.electricity_reading_anomalies IS
    'Candidate bad electricity readings. Advisory only — never auto-corrected. Feeds the '
    'dashboard data-quality alert and the Electricity widget''s clean-aggregate filter.';

-- ---------------------------------------------------------------------------
-- Clean monthly consumption, with anomalies excluded.
--
-- This is what every chart and tile must read. It also reports how many rows it had to
-- drop, so the UI can say "3 readings excluded" rather than quietly under-reporting — a
-- silently filtered total is its own kind of lie.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.electricity_monthly_consumption
WITH (security_invoker = on) AS
SELECT
    r.property_id,
    date_trunc('month', r.reading_date)::date AS period_month,
    count(*)                                   AS readings_counted,
    count(DISTINCT r.meter_id)                 AS meters_counted,
    count(a.id)                                AS readings_excluded,
    SUM(COALESCE(r.final_units, r.computed_units, 0)) FILTER (WHERE a.id IS NULL) AS units,
    SUM(COALESCE(r.computed_cost, 0))                 FILTER (WHERE a.id IS NULL) AS cost,
    min(r.reading_date)                        AS first_reading_on,
    max(r.reading_date)                        AS last_reading_on
FROM public.electricity_readings r
LEFT JOIN public.electricity_reading_anomalies a ON a.id = r.id
GROUP BY r.property_id, date_trunc('month', r.reading_date);

COMMENT ON VIEW public.electricity_monthly_consumption IS
    'Anomaly-filtered monthly electricity consumption per property. readings_excluded is '
    'surfaced in the UI so a filtered total is never mistaken for a complete one.';
