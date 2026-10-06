-- =============================================================================
-- SATEJ — rate benchmark from what we have actually paid (Zoho purchase lines)
-- -----------------------------------------------------------------------------
-- WHY THIS EXISTS
--   Satej now asks vendors for a rate on the call, and Meera pushes back on a
--   high one. Both need to know "what do we normally pay for this?". The answer
--   is already in zoho_po_line_items (25,877 lines, Apr 2023 → today), but not
--   in a form anyone can look up:
--
--   · the Zoho item NAME is an accounting bucket — "Housekeeping Material (3402)"
--     covers urinal pads at ₹25 and R5 liquid at ₹870. The product is in the
--     DESCRIPTION, so the benchmark is keyed on the description;
--   · the same product is written many ways — "20ltr jar", "20 ltr jar",
--     "water jar 20 ltr", "fill rich 20ltr jar period - june'25". Descriptions
--     are normalised (sizes, months, periods, HSN codes) and looked up by
--     trigram similarity, so spelling variants meet at query time;
--   · units mix — a "5 ltr" hand wash billed per can at ₹410 and per piece at
--     ₹82. Rates are compared only within one normalised unit, and a rate more
--     than 3× away from its group's median is left out as a unit/pack mismatch.
--
-- WHAT IS COUNTED
--   POs that are real purchases: approved, open, billed, partially billed.
--   Drafts, pending, rejected and cancelled are not prices we paid.
--   The last 36 months. Rates are per unit, before tax, as Zoho holds them.
--
-- FRESHNESS
--   satej_refresh_rate_benchmark() rebuilds the table. /api/cron/satej-benchmark
--   calls it on days 1, 11, 21 and 31 of each month (≈ every 10 days), after the
--   PO line sync; the rate checker has a "Refresh now" button.
--
-- ALSO HERE: satej_faq — the answers Meera may give vendors. Only 'approved'
-- rows are put into her script; seeded drafts wait for the team.
--
-- RLS on, no policies: service role only, behind /api/satej/*.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- --- normalisation -------------------------------------------------------------

-- One spelling per product: lower case, sizes glued to their unit ("20 ltr" → "20l"),
-- and the noise that differs between two orders of the same thing removed —
-- billing periods, months, dates, HSN codes, "supply of". Cut to ~100 characters:
-- fit-out lines carry a page of BOQ specification, and matching on all of it made
-- "gypsum false ceiling" equally similar to every partition spec that mentions gypsum.
CREATE OR REPLACE FUNCTION public.satej_normalize_item(t text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
    SELECT nullif(btrim(substring(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
           regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
           regexp_replace(regexp_replace(
               lower(coalesce(t, '')),
               -- billing periods and months: "period - june'25", "for the month of mar26", "01.04.2026 to 31.06.2026"
               '(period|for the month of|month of)\s*[-:]?.*$', '', 'g'),
               '\m(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s*[''’-]?\s*\d{2,4}\M', ' ', 'g'),
               '\d{1,2}[./-]\d{1,2}[./-]\d{2,4}', ' ', 'g'),
               -- HSN / SAC codes: "(3402)", "hsn 3405", "- 09024040"
               '\(?\m(hsn|sac)?\s*:?\s*\d{4,8}\M\)?', ' ', 'g'),
               -- sizes: 5 ltr / 5 litre / 5 liters / 5l → 5l ; kg ; g ; ml ; mm ; ft
               '(\d+(\.\d+)?)\s*(ltrs?|litres?|liters?|lt)\M', '\1l', 'g'),
               '(\d+(\.\d+)?)\s*(kgs?|kilos?|kilograms?)\M', '\1kg', 'g'),
               '(\d+(\.\d+)?)\s*(grms?|gms?|grams?|gm)\M', '\1g', 'g'),
               '(\d+(\.\d+)?)\s*(mls?|millilitres?)\M', '\1ml', 'g'),
               '(\d+(\.\d+)?)\s*(mm|cm|inch|inches|ft|feet|mtrs?|meters?|metres?)\M', '\1\3', 'g'),
               -- leading verbs that describe the order, not the product
               '^\s*(supply|supplying|providing|purchase|procurement)\s+(and\s+\w+\s+)?(of\s+)?', '', 'g'),
               '\m(qty|nos|pcs|no|each)\M', ' ', 'g'),
               '[^a-z0-9]+', ' ', 'g'),
               '\s+', ' ', 'g')) FROM '^.{0,100}(?=\s|$)|^.{0,100}')), '')
$$;

-- One spelling per unit. NULL when Zoho has none.
CREATE OR REPLACE FUNCTION public.satej_normalize_unit(u text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
    SELECT CASE
        WHEN v = '' THEN NULL
        WHEN v IN ('nos', 'no', 'nos.', 'pcs', 'pc', 'piece', 'pieces', 'unit', 'units', 'each', 'ea') THEN 'nos'
        WHEN v IN ('ltr', 'ltrs', 'l', 'litre', 'liter', 'litres', 'liters') THEN 'ltr'
        WHEN v IN ('kg', 'kgs', 'kilo') THEN 'kg'
        WHEN v IN ('m', 'mtr', 'mtrs', 'meter', 'metre', 'rmt') THEN 'm'
        WHEN v IN ('rft', 'ft', 'feet', 'rft.') THEN 'ft'
        WHEN v IN ('sq. ft.', 'sq.ft', 'sq ft', 'sqft', 'sft', 'sq.ft.') THEN 'sqft'
        WHEN v IN ('sqm', 'sq. m', 'sq.m') THEN 'sqm'
        WHEN v IN ('hrs', 'hr', 'hour', 'hours') THEN 'hr'
        WHEN v IN ('day', 'days') THEN 'day'
        WHEN v IN ('month', 'months', 'mon', 'pm') THEN 'month'
        WHEN v IN ('services', 'service', 'job', 'ls', 'lot', 'lumpsum', 'lump sum') THEN 'job'
        WHEN v IN ('pkt', 'pkts', 'packet', 'packets', 'pack') THEN 'pkt'
        WHEN v IN ('bags', 'bag') THEN 'bag'
        WHEN v IN ('coils', 'coil') THEN 'coil'
        WHEN v IN ('bottle', 'bottles') THEN 'bottle'
        ELSE v
    END
    FROM (SELECT lower(btrim(coalesce(u, ''))) AS v) x
$$;

-- --- the benchmark ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.satej_rate_benchmark (
    organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    product_key       text NOT NULL,          -- satej_normalize_item(description)
    unit              text NOT NULL,          -- satej_normalize_unit(unit), '-' when Zoho had none
    label             text NOT NULL,          -- the description as people most often wrote it
    item_bucket       text,                   -- the Zoho item name most used for it
    category          text,                   -- the PO category most used for it
    hsn_or_sac        text,
    tax_percentage    numeric(6,2),
    n_lines           integer NOT NULL,
    n_pos             integer NOT NULL,
    n_vendors         integer NOT NULL,
    n_outliers        integer NOT NULL,       -- left out: > 3× from the group median
    rate_min          numeric(16,4) NOT NULL,
    rate_p25          numeric(16,4) NOT NULL,
    rate_median       numeric(16,4) NOT NULL,
    rate_p75          numeric(16,4) NOT NULL,
    rate_max          numeric(16,4) NOT NULL,
    median_12m        numeric(16,4),          -- NULL when nothing in the last 12 months
    last_rate         numeric(16,4) NOT NULL,
    last_date         date NOT NULL,
    last_vendor       text,
    first_date        date NOT NULL,
    total_spend       numeric(16,2) NOT NULL, -- Σ item_total, the lines kept
    vendors           jsonb NOT NULL,         -- [{vendor, median, n, last_date}] cheapest first, top 6
    sites             text[] NOT NULL,
    rates             numeric[] NOT NULL,     -- every kept rate, ascending: lets a lookup pool spelling variants
    rates_12m         numeric[] NOT NULL,     -- the same, last 12 months only
    refreshed_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, product_key, unit)
);

-- No trigram index on purpose. ~12k rows per organisation: a plain scan answers a
-- lookup in ~0.1 s, while a GIN trigram index made the planner pick a bitmap scan
-- whose rechecks took 2.5 s per lookup (measured on this data, 2026-10-06).

ALTER TABLE public.satej_rate_benchmark ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.satej_rate_benchmark IS
    'What the organisation has paid per unit for each product, from Zoho PO lines. Rebuilt by satej_refresh_rate_benchmark(); read through satej_rate_lookup(), satej_rate_pool() and satej_quote_verdict().';

-- Rebuild the benchmark for one organisation, or all of them. Returns rows written.
CREATE OR REPLACE FUNCTION public.satej_refresh_rate_benchmark(p_org uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, extensions
-- Every CTE here is one row per product; the planner's guess for them is 1, and a
-- nested loop over ~12k × ~12k rows took 45 s. Hash joins take ~3 s.
SET enable_nestloop = off
AS $$
DECLARE
    v_rows integer;
BEGIN
    DELETE FROM public.satej_rate_benchmark WHERE p_org IS NULL OR organization_id = p_org;

    WITH lines AS (
        SELECT l.organization_id,
               satej_normalize_item(coalesce(nullif(btrim(l.description), ''), l.name)) AS product_key,
               coalesce(satej_normalize_unit(l.unit), '-') AS unit,
               btrim(regexp_replace(coalesce(nullif(btrim(l.description), ''), l.name), '\s+', ' ', 'g')) AS label,
               l.name AS item_bucket,
               nullif(btrim(p.category), '') AS category,
               l.hsn_or_sac,
               l.tax_percentage,
               l.rate,
               coalesce(l.item_total, l.rate * l.quantity) AS item_total,
               p.id AS po_id,
               nullif(btrim(p.vendor_name), '') AS vendor,
               nullif(btrim(p.project_name), '') AS site,
               p.po_date
        FROM public.zoho_po_line_items l
        JOIN public.zoho_purchase_orders p ON p.id = l.po_id
        WHERE (p_org IS NULL OR l.organization_id = p_org)
          AND p.status IN ('approved', 'open', 'billed', 'partially_billed')
          AND p.po_date >= current_date - interval '36 months'
          AND l.rate > 0
    ),
    keyed AS MATERIALIZED (
        SELECT * FROM lines WHERE length(product_key) >= 3
    ),
    med AS (
        SELECT organization_id, product_key, unit,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY rate) AS m
        FROM keyed GROUP BY 1, 2, 3
    ),
    kept AS (
        SELECT k.*, (k.rate > med.m * 3 OR k.rate < med.m / 3) AS outlier
        FROM keyed k JOIN med USING (organization_id, product_key, unit)
    ),
    good AS (
        SELECT * FROM kept WHERE NOT outlier
    ),
    per_vendor AS (
        SELECT organization_id, product_key, unit, vendor,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY rate) AS median,
               count(*) AS n, max(po_date) AS last_date
        FROM good WHERE vendor IS NOT NULL
        GROUP BY 1, 2, 3, 4
    ),
    vendor_json AS (
        SELECT organization_id, product_key, unit,
               jsonb_agg(jsonb_build_object('vendor', vendor, 'median', round(median::numeric, 2), 'n', n, 'last_date', last_date)
                         ORDER BY median, n DESC) FILTER (WHERE rk <= 6) AS vendors
        FROM (SELECT *, row_number() OVER (PARTITION BY organization_id, product_key, unit ORDER BY median, n DESC) AS rk FROM per_vendor) v
        GROUP BY 1, 2, 3
    ),
    outliers AS (
        SELECT organization_id, product_key, unit, count(*) FILTER (WHERE outlier) AS n_outliers
        FROM kept GROUP BY 1, 2, 3
    )
    INSERT INTO public.satej_rate_benchmark (
        organization_id, product_key, unit, label, item_bucket, category, hsn_or_sac, tax_percentage,
        n_lines, n_pos, n_vendors, n_outliers,
        rate_min, rate_p25, rate_median, rate_p75, rate_max, median_12m,
        last_rate, last_date, last_vendor, first_date, total_spend, vendors, sites, rates, rates_12m, refreshed_at)
    SELECT g.organization_id, g.product_key, g.unit,
           mode() WITHIN GROUP (ORDER BY g.label),
           mode() WITHIN GROUP (ORDER BY g.item_bucket),
           mode() WITHIN GROUP (ORDER BY g.category),
           mode() WITHIN GROUP (ORDER BY g.hsn_or_sac),
           mode() WITHIN GROUP (ORDER BY g.tax_percentage),
           count(*), count(DISTINCT g.po_id), count(DISTINCT g.vendor), max(o.n_outliers),
           min(g.rate),
           percentile_cont(0.25) WITHIN GROUP (ORDER BY g.rate),
           percentile_cont(0.5)  WITHIN GROUP (ORDER BY g.rate),
           percentile_cont(0.75) WITHIN GROUP (ORDER BY g.rate),
           max(g.rate),
           percentile_cont(0.5) WITHIN GROUP (ORDER BY g.rate) FILTER (WHERE g.po_date >= current_date - interval '12 months'),
           (array_agg(g.rate ORDER BY g.po_date DESC, g.rate))[1],
           max(g.po_date),
           (array_agg(g.vendor ORDER BY g.po_date DESC, g.rate))[1],
           min(g.po_date),
           sum(g.item_total),
           coalesce(max(vj.vendors::text)::jsonb, '[]'::jsonb),
           coalesce((array_agg(DISTINCT g.site) FILTER (WHERE g.site IS NOT NULL))[1:8], ARRAY[]::text[]),
           array_agg(g.rate ORDER BY g.rate),
           coalesce(array_agg(g.rate ORDER BY g.rate) FILTER (WHERE g.po_date >= current_date - interval '12 months'), ARRAY[]::numeric[]),
           now()
    FROM good g
    JOIN outliers o USING (organization_id, product_key, unit)
    LEFT JOIN vendor_json vj USING (organization_id, product_key, unit)
    GROUP BY g.organization_id, g.product_key, g.unit;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

-- Benchmarks that look like `p_query`, best first. A unit, when given, ranks
-- same-unit rows first; it never hides the others (the team may have the unit wrong).
CREATE OR REPLACE FUNCTION public.satej_rate_lookup(p_org uuid, p_query text, p_unit text DEFAULT NULL, p_limit integer DEFAULT 10)
RETURNS TABLE (
    product_key text, unit text, label text, item_bucket text, category text,
    n_lines integer, n_vendors integer,
    rate_min numeric, rate_p25 numeric, rate_median numeric, rate_p75 numeric, rate_max numeric, median_12m numeric,
    last_rate numeric, last_date date, last_vendor text, tax_percentage numeric,
    vendors jsonb, sites text[], refreshed_at timestamptz,
    similarity real, unit_match boolean
)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
    -- MATERIALIZED: inlined, the query was re-normalised (13 regexes) for every row compared.
    WITH q AS MATERIALIZED (SELECT satej_normalize_item(p_query) AS k, satej_normalize_unit(p_unit) AS u)
    SELECT b.product_key, b.unit, b.label, b.item_bucket, b.category,
           b.n_lines, b.n_vendors,
           b.rate_min, b.rate_p25, b.rate_median, b.rate_p75, b.rate_max, b.median_12m,
           b.last_rate, b.last_date, b.last_vendor, b.tax_percentage,
           b.vendors, b.sites, b.refreshed_at,
           greatest(similarity(b.product_key, q.k), word_similarity(q.k, b.product_key)) AS similarity,
           (q.u IS NOT NULL AND b.unit = q.u) AS unit_match
    FROM public.satej_rate_benchmark b, q
    WHERE b.organization_id = p_org
      AND q.k IS NOT NULL
      AND (b.product_key % q.k OR q.k <% b.product_key OR b.product_key ILIKE '%' || q.k || '%')
    ORDER BY (q.u IS NOT NULL AND b.unit = q.u) DESC,
             greatest(similarity(b.product_key, q.k), word_similarity(q.k, b.product_key)) DESC,
             b.n_lines DESC
    LIMIT greatest(1, least(p_limit, 50))
$$;

-- One benchmark for a product, pooling its spelling variants. The closest match
-- picks the unit; every row in that unit within 0.25 similarity of it (and at
-- least 0.45) is pooled, and the percentiles are taken over all their rates.
-- "20l jar" (46 orders), "fill rich 20l jar" (42) and "water jar 20l" (9) are one
-- product to a buyer, so they are one benchmark here. NULL when nothing is close.
CREATE OR REPLACE FUNCTION public.satej_rate_pool(p_org uuid, p_query text, p_unit text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
    -- MATERIALIZED throughout: inlined, the lookup re-ran for each field below (2.4 s → 0.1 s).
    WITH m AS MATERIALIZED (
        SELECT * FROM satej_rate_lookup(p_org, p_query, p_unit, 30) WHERE similarity >= 0.45
    ),
    top AS MATERIALIZED (SELECT * FROM m LIMIT 1),
    pool AS MATERIALIZED (
        SELECT m.* FROM m, top
        WHERE m.unit = top.unit AND m.similarity >= top.similarity - 0.25
    ),
    joined AS MATERIALIZED (
        SELECT b.* FROM public.satej_rate_benchmark b
        JOIN pool USING (product_key, unit)
        WHERE b.organization_id = p_org
    ),
    r AS MATERIALIZED (SELECT unnest(rates) AS rate FROM joined),
    r12 AS MATERIALIZED (SELECT unnest(rates_12m) AS rate FROM joined),
    v AS MATERIALIZED (
        SELECT x->>'vendor' AS vendor, min((x->>'median')::numeric) AS median, sum((x->>'n')::int) AS n, max(x->>'last_date') AS last_date
        FROM joined, jsonb_array_elements(joined.vendors) x GROUP BY 1
    )
    SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM top) THEN NULL ELSE jsonb_build_object(
        'label',        (SELECT label FROM top),
        'unit',         (SELECT unit FROM top),
        'similarity',   (SELECT round(similarity::numeric, 2) FROM top),
        'unit_match',   (SELECT unit_match FROM top),
        'matched',      (SELECT jsonb_agg(jsonb_build_object('label', label, 'n', n_lines, 'median', round(rate_median, 2)) ORDER BY n_lines DESC) FROM pool),
        'n_lines',      (SELECT count(*) FROM r),
        'n_vendors',    (SELECT count(*) FROM v),
        'rate_min',     (SELECT min(rate) FROM r),
        'rate_p25',     (SELECT round(percentile_cont(0.25) WITHIN GROUP (ORDER BY rate)::numeric, 2) FROM r),
        'rate_median',  (SELECT round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY rate)::numeric, 2) FROM r),
        'rate_p75',     (SELECT round(percentile_cont(0.75) WITHIN GROUP (ORDER BY rate)::numeric, 2) FROM r),
        'rate_max',     (SELECT max(rate) FROM r),
        'median_12m',   (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY rate)::numeric, 2) FROM r12),
        'last_rate',    (SELECT last_rate FROM joined ORDER BY last_date DESC, n_lines DESC LIMIT 1),
        'last_date',    (SELECT max(last_date) FROM joined),
        'last_vendor',  (SELECT last_vendor FROM joined ORDER BY last_date DESC, n_lines DESC LIMIT 1),
        'tax_percentage', (SELECT tax_percentage FROM joined ORDER BY n_lines DESC LIMIT 1),
        'vendors',      coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY median, n DESC) FROM (SELECT * FROM v ORDER BY median, n DESC LIMIT 6) v), '[]'::jsonb),
        'refreshed_at', (SELECT max(refreshed_at) FROM joined)
    ) END
$$;

-- Where a quoted rate sits against what we have paid. One JSON object:
--   verdict     good | fair | slightly_high | high | no_benchmark
--   confidence  high | medium | low   (how sure we are it is the same product, and how much history there is)
--   delta_pct   (rate − median) / median × 100
--   benchmark   satej_rate_pool() for the item
CREATE OR REPLACE FUNCTION public.satej_quote_verdict(p_org uuid, p_query text, p_unit text, p_rate numeric)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = public, extensions
AS $$
-- plpgsql, not sql: as an inlined SQL function the pool was re-planned for every
-- field read off it, and one verdict took 9 s instead of 0.1 s.
DECLARE
    j   jsonb := satej_rate_pool(p_org, p_query, p_unit);
    p25 numeric; med numeric; p75 numeric; n int; sim numeric;
BEGIN
    IF j IS NULL OR p_rate IS NULL OR p_rate <= 0
       OR (satej_normalize_unit(p_unit) IS NOT NULL AND NOT (j->>'unit_match')::boolean) THEN
        RETURN jsonb_build_object('verdict', 'no_benchmark', 'confidence', 'low', 'benchmark', j);
    END IF;
    p25 := (j->>'rate_p25')::numeric; med := (j->>'rate_median')::numeric; p75 := (j->>'rate_p75')::numeric;
    n := (j->>'n_lines')::int; sim := (j->>'similarity')::numeric;
    RETURN jsonb_build_object(
        'verdict', CASE
            WHEN p_rate <= p25 THEN 'good'
            WHEN p_rate <= med * 1.05 THEN 'fair'
            WHEN p_rate <= p75 * 1.10 THEN 'slightly_high'
            ELSE 'high' END,
        'confidence', CASE
            WHEN sim >= 0.6 AND n >= 5 THEN 'high'
            WHEN n >= 2 THEN 'medium'
            ELSE 'low' END,
        'delta_pct', round((p_rate - med) / nullif(med, 0) * 100, 1),
        'benchmark', j);
END;
$$;

REVOKE ALL ON FUNCTION public.satej_refresh_rate_benchmark(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.satej_rate_lookup(uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.satej_rate_pool(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.satej_quote_verdict(uuid, text, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.satej_refresh_rate_benchmark(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.satej_rate_lookup(uuid, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.satej_rate_pool(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.satej_quote_verdict(uuid, text, text, numeric) TO service_role;

-- --- FAQ: what Meera may answer -----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.satej_faq (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    topic            text NOT NULL DEFAULT 'general',
    question         text NOT NULL,          -- how vendors actually ask it
    answer           text NOT NULL,          -- what Meera says, Hinglish, one or two sentences
    status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'archived')),
    source           text NOT NULL DEFAULT 'team' CHECK (source IN ('calls', 'zoho', 'team')),
    evidence         text,                   -- why this entry exists: a call it came from, a PO figure
    sort_order       integer NOT NULL DEFAULT 100,
    updated_by_name  text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS satej_faq_org_idx ON public.satej_faq (organization_id, status, sort_order);
ALTER TABLE public.satej_faq ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.satej_faq IS
    'Answers Meera may give vendors on a call. Only status=approved is published into her script (Satej console → FAQ → Publish to Meera).';

-- Build the first benchmark now, so the rate checker is not empty on day one.
SELECT public.satej_refresh_rate_benchmark(NULL);

-- --- first FAQ for Autopilot Offices ---------------------------------------------------
-- Drawn from Meera's real calls (23 Sep – 3 Oct 2026: what vendors actually asked and
-- where she dodged or got it wrong) and from the Zoho PO history. Entries that state a
-- company fact nobody has confirmed yet are 'draft' and are NOT spoken until the team
-- approves them on the FAQ page. Written once: re-running this file adds nothing.
INSERT INTO public.satej_faq (organization_id, topic, question, answer, status, source, evidence, sort_order)
SELECT '211e1330-ad83-446d-941f-dcea48396798'::uuid, f.topic, f.question, f.answer, f.status, f.source, f.evidence, f.sort_order
FROM (VALUES
 ('about_us', 'Kaun bol raha hai? Kahan se bol rahe ho?',
  'Main Meera, Autopilot Offices ki procurement team se. Hum Mumbai se baat kar rahe hain, hamara kaam kai shehron mein hai.',
  'approved', 'calls', 'Asked on 4 of 10 answered calls ("kaun bol rahi hai", "aap kahan se bol rahe ho").', 10),
 ('about_us', 'Autopilot Offices kya karti hai?',
  'Hum companies ke liye managed offices chalate hain: fit-out, housekeeping, maintenance, sab hum sambhalte hain. Isliye har site ke liye regular supplies aur kaam lagta hai.',
  'approved', 'zoho', 'Company brief; Zoho POs span housekeeping, electrical, civil, furniture, HVAC.', 20),
 ('about_us', 'Aapki company kitne saal se hai? Aap kitne saal se kaam kar rahe ho?',
  'Company kuch saalon se managed offices chala rahi hai, abhi teen se zyada shehron mein tees se zyada sites hain. Exact detail main WhatsApp pe bhej deti hoon.',
  'draft', 'calls', 'Vendor asked twice on 3 Oct (Ella Tissue); Meera answered about herself. Team: confirm the founding year and replace the vague line.', 30),
 ('about_us', 'Kahan kahan kaam hai? Kitni sites hain?',
  'Mumbai, Thane, Navi Mumbai, Noida, Delhi, Indore, Kolkata, Bengaluru, aur nayi sites khulti rehti hain. Tees se zyada sites pe hum supply lete hain.',
  'approved', 'zoho', '34 distinct sites on POs in the last 36 months (Zoho).', 40),
 ('this_requirement', 'Exact location kya hai? Mumbai mein kahan chahiye?',
  'Area main bata deti hoon: {location_text}. Poora address aur contact PO ke saath WhatsApp pe aayega.',
  'approved', 'calls', '23 Sep: vendor asked "Mumbai mein kahan chahiye" three times.', 50),
 ('this_requirement', 'Details bhejo / BOQ bhej do, phir dekhte hain.',
  'Haan bilkul, isi number pe WhatsApp pe details bhej deti hoon. Bas do-teen cheezein abhi samajh leti hoon taaki sahi details bhejun.',
  'approved', 'calls', '24 Sep: Meera refused the BOQ twice ("qualification ke baad"); the vendor almost dropped.', 60),
 ('this_requirement', 'Kitna maal chahiye? Ek baar ka hai ya regular?',
  'Abhi {quantity_text} chahiye. Agar rate aur service theek rahi toh doosri sites ke liye bhi regular order aata hai.',
  'approved', 'zoho', 'Housekeeping and water are re-ordered monthly across sites (Zoho).', 70),
 ('process', 'Order pakka hai kya?',
  'Requirement pakki hai, hum teen-chaar vendors se rate le rahe hain. Rate aur details dekh ke team final karegi, phir PO jaata hai.',
  'approved', 'team', 'Satej shortlists; a person approves (decision 2026-10-06).', 80),
 ('process', 'Aage kaun baat karega? Kaise process hota hai?',
  'Hamari procurement team aapko WhatsApp pe details bhejegi aur quotation legi. Order formal PO se hota hai, Zoho se.',
  'approved', 'zoho', 'Every order in the history is a Zoho PO.', 90),
 ('process', 'Mera number kahan se mila?',
  'Aapka number online listing se mila, Justdial ya Google se. Agar yeh kaam aap nahi karte toh bata dijiye, main list se hata deti hoon.',
  'approved', 'team', 'Discovery reads Justdial, IndiaMART and Google listings.', 100),
 ('payment', 'Payment kaise hota hai? Advance milega?',
  'Payment terms har PO mein likhe hote hain. Chhote supply orders mein advance bhi hota hai, bade kaam mein milestone pe. Final terms team quotation ke baad batayegi.',
  'draft', 'zoho', 'POs with terms on file: 651 "Custom", 343 "100% Advance" (Zoho detail). Team: confirm what Meera may say about advance.', 110),
 ('payment', 'Credit kitne din ka chahiye?',
  'Yeh team quotation ke time decide karti hai. Aap apne terms quotation mein likh dijiye.',
  'approved', 'team', 'Meera does not commit to payment terms.', 120),
 ('gst', 'GST zaroori hai kya? Hamara turnover chhota hai.',
  'GST invoice zaroori hai, kyunki hum input credit lete hain. Turnover chhota ho toh koi baat nahi, chhote vendors ke saath bhi kaam karte hain.',
  'approved', 'calls', '3 Oct: Meera told a small vendor "turnover bhi thoda achha hona chahiye". Never judge turnover on the call.', 130),
 ('rates', 'Aapka budget kya hai? Aap kitna dete ho?',
  'Budget main share nahi kar sakti. Aap apna best rate bataiye, GST alag ya saath mein, woh clear kar dijiye.',
  'approved', 'team', 'Meera never reveals benchmark numbers.', 140),
 ('rates', 'Transport / delivery charge alag lagega?',
  'Rate mein delivery shamil ho toh behtar hai. Alag ho toh abhi bata dijiye kitna lagega, taaki sab vendors ko barabar compare karein.',
  'approved', 'zoho', '"Transportation" appears on 443+ PO lines as a separate charge (Zoho).', 150),
 ('rates', 'Sample chahiye?',
  'Supply items mein team sample maang sakti hai. Woh WhatsApp pe bata denge.',
  'approved', 'team', NULL, 160),
 ('objections', 'Dobara call mat karna. / Mera number hata do.',
  'बिल्कुल, मैं note कर लेती हूँ, आपको दोबारा call नहीं आएगा। Sorry for the trouble.',
  'approved', 'team', 'Carried over from the Bolna dashboard script of 3 Oct 2026. Satej does not yet keep a do-not-call list; the team should note it from the call log.', 165),
 ('objections', 'Interest nahi hai.',
  'कोई बात नहीं। बस बता दीजिए, ये काम आप करते नहीं या अभी time नहीं है? आगे के लिए काम आएगा।',
  'approved', 'team', 'Carried over from the Bolna dashboard script of 3 Oct 2026. Ask once; never argue.', 166),
 ('objections', 'Abhi bahut kaam hai, capacity nahi hai.',
  'समझ सकती हूँ। अगले महीने वगैरह में हो पाएगा तो बताइए, मैं तब के लिए note कर लेती हूँ।',
  'approved', 'team', 'Carried over from the Bolna dashboard script of 3 Oct 2026.', 167),
 ('objections', 'Partner se poochna padega.',
  'ठीक है जी। मैं details WhatsApp पे भेज देती हूँ, आप partner से बात करके rate भेज दीजिए।',
  'approved', 'team', 'Carried over from the Bolna dashboard script of 3 Oct 2026.', 168),
 ('objections', 'Hum chhote kaam nahi lete.',
  'समझ गई। ये regular order है और हमारी तीस से ज़्यादा sites हैं, तो आगे बड़ा काम भी आता है। Details भेज दूँ, देख लीजिए?',
  'approved', 'team', 'Carried over from the Bolna dashboard script of 3 Oct 2026; the site count is from Zoho.', 169),
 ('identity', 'Aap robot ho? AI ho?',
  'Ji, main Autopilot Offices ki AI assistant hoon. Aage ki baat aur order hamari procurement team khud karegi.',
  'approved', 'team', 'Honesty rule: Meera never denies being an AI.', 170)
) AS f(topic, question, answer, status, source, evidence, sort_order)
WHERE EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = '211e1330-ad83-446d-941f-dcea48396798')
  AND NOT EXISTS (SELECT 1 FROM public.satej_faq x WHERE x.organization_id = '211e1330-ad83-446d-941f-dcea48396798');
