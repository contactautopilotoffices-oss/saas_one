-- Migration: seed the SS Plaza audit documentation checklist into audit_master_items
-- Date: 2026-08-30
--
-- WHY: the Document Bank (20260827000001) links an uploaded file to a checklist
-- point via document_bank.linked_master_item_id, and DocumentBank.tsx renders
-- that as a <select> populated from audit_master_items. That table was EMPTY in
-- production (verified 2026-08-30, content-range */0), so the dropdown had no
-- options and there was nothing to upload against — the vault existed with no
-- list of what it was meant to hold.
--
-- Source: SS_Audit_Documentation Checklist..xlsx, three sheets (DG / UPS / STP),
-- 40 rows whose Audit Category is 'Documentation'. Column mapping:
--   S.No                   -> si_no
--   Equipment              -> category      (DG Set / UPS / STP)
--   Audit Check Point +
--   Documentation Required -> requirement   (joined, so the dropdown reads as a
--                                            requirement and not a bare noun)
--   Priority               -> is_required_by_default (High/Critical => true)
--
-- Seeded for EVERY organization: these are generic DG/UPS/STP documentation
-- requirements, and audit_master_items is org-scoped with no property column.
--
-- Idempotent via NOT EXISTS on (organization_id, category, requirement), so
-- re-running never duplicates a row or disturbs an edited one.

INSERT INTO audit_master_items (organization_id, si_no, category, requirement, is_required_by_default)
SELECT o.id, v.si_no, v.category, v.requirement,
       v.priority IN ('High', 'Critical')
  FROM organizations o
 CROSS JOIN (VALUES
    (1, 'DG Set', 'AMC contract valid — AMC copy with validity dates, scope, response-time SLA and escalation contacts.', 'High'),
    (2, 'DG Set', 'OEM engine, alternator and controller manuals available — Latest OEM O&M manuals, wiring diagrams and controller fault-code guide available onsite or in controlled digital repository.', 'Medium'),
    (3, 'DG Set', 'PM records updated — PM schedule versus actual completion records for last 12 months; no overdue statutory or OEM PM tasks.', 'High'),
    (4, 'DG Set', 'DG running log maintained — Daily/weekly running log showing start-stop time, running hours, load, fuel consumption, operator name and signature.', 'High'),
    (21, 'DG Set', 'DG asset master complete — Asset register with DG ID, make, model, kVA/kW, engine and alternator serial numbers, installation date and location.', 'High'),
    (22, 'DG Set', 'Approved single-line diagram available — Latest approved SLD showing DGs, AMF/ATS, synchronisation panel, breakers, essential-load panels and UPS interface.', 'High'),
    (23, 'DG Set', 'Critical-load schedule approved — Approved list of critical, essential and non-essential loads with connected load and priority sequence.', 'High'),
    (24, 'DG Set', 'DG capacity adequacy study available — Capacity study comparing installed DG capacity, diversity, starting current and actual essential load.', 'Critical'),
    (25, 'DG Set', 'PM matrix aligned to OEM requirements — Calendar- and running-hour-based PM matrix for engine, alternator, controls, fuel system and batteries.', 'High'),
    (26, 'DG Set', 'Breakdown log and RCA maintained — Breakdown history, root-cause analysis, corrective action and closure evidence for repeat failures.', 'High'),
    (27, 'DG Set', 'Critical spares inventory available — Critical-spares list and stock record for filters, belts, hoses, relays, fuses, sensors, starter items and AVR.', 'Medium'),
    (28, 'DG Set', 'Test instruments calibrated — Valid calibration certificates for earth tester, multimeter, clamp meter, insulation tester, thermal camera and sound meter.', 'Medium'),
    (29, 'DG Set', 'Authorized operator competency records available — Operator authorization, training attendance and competency assessment for DG operation, shutdown and emergency response.', 'High'),
    (30, 'DG Set', 'Emergency operating SOP and escalation matrix available — Approved SOP for power failure, DG failure, refuelling, fire, emergency shutdown and escalation contacts.', 'High'),
    (1, 'UPS', 'AMC contract valid — Check AMC validity, comprehensive/non-comprehensive scope, response SLA, spares coverage and escalation contact.', 'High'),
    (2, 'UPS', 'OEM manual and service schedule available — Verify OEM operation manual, installation manual, troubleshooting guide, PM frequency and recommended spares list.', 'High'),
    (3, 'UPS', 'Asset master and nameplate details verified — Record UPS ID, make, model, kVA/kW, serial number, topology, input/output voltage, battery string details and installation date.', 'High'),
    (4, 'UPS', 'Approved single-line diagram available — Verify UPS input, output, bypass, battery bank, isolation transformers, upstream/downstream breakers and critical-load feeders on approved SLD.', 'High'),
    (5, 'UPS', 'Critical-load schedule available — Check connected load list, load priority, IT/server/security/fire loads and redundancy classification.', 'High'),
    (6, 'UPS', 'UPS capacity adequacy study available — Compare connected critical load, growth load, redundancy requirement, battery autonomy and UPS rating.', 'High'),
    (7, 'UPS', 'Redundancy configuration verified — Confirm N, N+1, 2N or modular redundancy as approved; check if one module failure still supports critical load.', 'Critical'),
    (8, 'UPS', 'PM records updated — Verify monthly/quarterly/annual PM record for last 6–12 months with closure of observations.', 'High'),
    (9, 'UPS', 'Breakdown log and RCA maintained — Review alarm/trip history, power events, bypass transfers, battery faults and RCA/CAPA closure.', 'High'),
    (10, 'UPS', 'Battery warranty and installation records available — Check battery make, rating, quantity, string design, install date, warranty, batch number and replacement history.', 'High'),
    (11, 'UPS', 'Battery disposal / buyback records available — Verify used batteries are returned to authorized producer/recycler/vendor with handover certificates/invoices.', 'High'),
    (12, 'UPS', 'UPS room layout and clearance drawing available — Check maintenance clearance, ventilation, cable routing, battery rack layout, escape route and equipment access.', 'High'),
    (13, 'UPS', 'Operator SOP and escalation matrix available — Approved SOP for mains failure, UPS alarm, battery low, bypass operation, emergency shutdown and escalation.', 'High'),
    (1, 'STP', 'STP design capacity and actual sewage generation verified — Compare design KLD, average flow, peak flow and actual daily sewage generation; identify hydraulic overloading.', 'Critical'),
    (2, 'STP', 'Consent / approval applicability verified — Verify KSPCB consent/approval applicability, validity, conditions and renewal status where applicable.', 'Critical'),
    (3, 'STP', 'Approved process flow diagram available — Check PFD showing collection tank, screen, equalization, aeration/bioreactor, clarifier, filtration, disinfection, sludge handling and treated-water tank.', 'High'),
    (4, 'STP', 'STP layout and hydraulic profile available — Verify layout, tank levels, access, ventilation, manholes, pump locations, dosing points and treated-water routing.', 'High'),
    (5, 'STP', 'O&M manual available — Check vendor O&M manual, process control limits, PM schedules, troubleshooting guide and chemical-dosing instructions.', 'High'),
    (6, 'STP', 'AMC contract valid — Verify AMC scope, manpower, lab testing, chemical supply, breakdown SLA and escalation matrix.', 'High'),
    (7, 'STP', 'Daily logbook maintained — Check daily flow, blower hours, pump hours, MLSS, DO, pH, chlorine/ORP, sludge wasting and operator remarks.', 'High'),
    (8, 'STP', 'Lab test reports available — Review treated-water test reports for pH, BOD, COD, TSS, oil & grease, faecal coliform and other consent parameters.', 'Critical'),
    (9, 'STP', 'Inlet and outlet sampling points identified — Verify safe, labelled and representative sampling points for raw sewage and treated water.', 'High'),
    (10, 'STP', 'Calibration records for meters and instruments available — Check calibration of pH meter, flow meter, DO meter, ORP meter, chlorine kit and lab instruments.', 'High'),
    (11, 'STP', 'Operator competency records available — Verify operator training for process operation, confined-space safety, chemical handling and emergency response.', 'High'),
    (12, 'STP', 'Breakdown log and RCA maintained — Review pump/blower failures, overflow incidents, odour complaints, non-compliance results and CAPA closure.', 'High'),
    (13, 'STP', 'Treated-water reuse plan available — Verify use for flushing, gardening, HVAC make-up or other approved use; check no unauthorized discharge.', 'High')
 ) AS v(si_no, category, requirement, priority)
 WHERE NOT EXISTS (
     SELECT 1 FROM audit_master_items a
      WHERE a.organization_id = o.id
        AND a.category = v.category
        AND a.requirement = v.requirement
 );

NOTIFY pgrst, 'reload schema';
