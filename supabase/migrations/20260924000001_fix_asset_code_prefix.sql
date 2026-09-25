-- Migration: 20260924000001_fix_asset_code_prefix.sql
-- Description: Asset codes must carry the full property code.
--
-- Bug (found by automated test, 24 Sep 2026): generate_asset_code() took the
-- first 4 characters of properties.code. Every property code starts "PROP-",
-- so every property produced "PROP-<CAT>-00001" — the second property to
-- register an HVAC asset would collide on assets_org_code_unique and fail.
--
-- Fix: use the whole property code ("PROP-004" -> "PROP-004-HVAC-00001"), and
-- skip past any code already taken (e.g. a code typed by hand in an import),
-- so an auto-generated code can never collide with an existing one.
-- Existing assets keep their codes; per-property counters carry on from where
-- they are.

CREATE OR REPLACE FUNCTION public.generate_asset_code(
    p_org_id UUID,
    p_property_id UUID,
    p_category_code TEXT DEFAULT 'GEN'
)
RETURNS TEXT AS $$
DECLARE
    v_prop_code TEXT;
    v_cat TEXT := UPPER(REGEXP_REPLACE(COALESCE(NULLIF(p_category_code, ''), 'GEN'), '[^A-Za-z0-9]', '', 'g'));
    v_next INT;
    v_code TEXT;
BEGIN
    SELECT UPPER(REGEXP_REPLACE(
               COALESCE(NULLIF(TRIM(code), ''), SUBSTRING(TRIM(name) FROM 1 FOR 3)),
               '[^A-Za-z0-9-]', '', 'g'))
    INTO v_prop_code
    FROM public.properties WHERE id = p_property_id;

    IF v_prop_code IS NULL OR v_prop_code = '' THEN
        v_prop_code := 'PRP';
    END IF;

    LOOP
        INSERT INTO public.asset_code_sequences (organization_id, property_id, category_code, last_val)
        VALUES (p_org_id, p_property_id, v_cat, 1)
        ON CONFLICT (organization_id, property_id, category_code) DO UPDATE
        SET last_val = asset_code_sequences.last_val + 1
        RETURNING last_val INTO v_next;

        v_code := v_prop_code || '-' || v_cat || '-' || LPAD(v_next::text, 5, '0');

        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM public.assets
            WHERE organization_id = p_org_id AND UPPER(asset_code) = UPPER(v_code)
        );
    END LOOP;

    RETURN v_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

NOTIFY pgrst, 'reload schema';
