-- Migration: 20260919000007_normalize_employee_reporting_managers.sql
-- Description: Normalize raw manager name variations in employee_profiles and resolve reporting_manager_id foreign keys

DO $$
BEGIN
    -- 1. Normalize raw manager name text stored in reporting_manager_code
    UPDATE public.employee_profiles SET reporting_manager_code = 'Shailesh Kumar Kashyap'
    WHERE reporting_manager_code ILIKE '%Shailesh%Kashyap%' OR reporting_manager_code = 'Shailesh K';

    UPDATE public.employee_profiles SET reporting_manager_code = 'Meena Chavan'
    WHERE reporting_manager_code ILIKE '%Meena%Chavan%' OR reporting_manager_code ILIKE '%Chavan%Meena%';

    UPDATE public.employee_profiles SET reporting_manager_code = 'Rajesh Kadam'
    WHERE reporting_manager_code ILIKE '%Rajesh%Kadam%' OR reporting_manager_code ILIKE '%Rajesh%Bhikahi%Kadam%';

    UPDATE public.employee_profiles SET reporting_manager_code = 'Mehul Kapadia'
    WHERE reporting_manager_code ILIKE '%Mehul%Kapadia%' OR reporting_manager_code ILIKE '%Mehul%Kiran%Kapadia%';

    UPDATE public.employee_profiles SET reporting_manager_code = 'Shrihari Gardas'
    WHERE reporting_manager_code ILIKE '%Shrihari%Gardas%' OR reporting_manager_code ILIKE '%Shrihari%Balaraju%Gardas%' OR reporting_manager_code = 'Shrihari';

    UPDATE public.employee_profiles SET reporting_manager_code = 'Roohi Idirishi'
    WHERE reporting_manager_code ILIKE '%Roohi%Idirishi%' OR reporting_manager_code ILIKE '%Roohi%Ezaz%Idirishi%' OR reporting_manager_code ILIKE '%Roohi%Idrishi%';

    UPDATE public.employee_profiles SET reporting_manager_code = 'Siddhalingappa Nagond'
    WHERE reporting_manager_code ILIKE '%Siddhalingappa%';

    UPDATE public.employee_profiles SET reporting_manager_code = 'Suraj Nandavadekar'
    WHERE reporting_manager_code ILIKE '%Suraj%Nandavadekar%' OR reporting_manager_code ILIKE '%Suraj%Nandavadkar%' OR reporting_manager_code ILIKE '%Suraj%Harishchandra%Nandavadekar%';

    UPDATE public.employee_profiles SET reporting_manager_code = 'Altamash Chaugule'
    WHERE reporting_manager_code ILIKE '%Altamash%';

    UPDATE public.employee_profiles SET reporting_manager_code = 'Abhiram K'
    WHERE reporting_manager_code ILIKE '%Abhiram%';

    UPDATE public.employee_profiles SET reporting_manager_code = 'Kiran Kumar'
    WHERE reporting_manager_code ILIKE '%Kiran%Kumar%' OR reporting_manager_code = 'Kiran';

    -- 2. Resolve reporting_manager_id by matching against manager's user_id or profile id
    UPDATE public.employee_profiles e
    SET reporting_manager_id = m.user_id
    FROM public.employee_profiles m
    WHERE e.reporting_manager_code IS NOT NULL
      AND e.reporting_manager_code != ''
      AND (
          LOWER(TRIM(m.first_name || ' ' || m.last_name)) = LOWER(TRIM(e.reporting_manager_code))
          OR (m.employee_code IS NOT NULL AND LOWER(TRIM(m.employee_code)) = LOWER(TRIM(e.reporting_manager_code)))
      )
      AND m.user_id IS NOT NULL;

END $$;
