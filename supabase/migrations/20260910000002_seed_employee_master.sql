-- Migration: 20260910000002_seed_employee_master.sql
-- Description: Seed 96 Employee Profiles with automated Reporting Manager linkage & Categories

-- Function to seed employees and resolve reporting manager links
DO $$
DECLARE
    v_org_id UUID;
BEGIN
    -- Get default organization ID
    SELECT id INTO v_org_id FROM public.organizations LIMIT 1;
    IF v_org_id IS NULL THEN
        v_org_id := '00000000-0000-0000-0000-000000000000'::uuid;
    END IF;

    -- 1. Insert Categories Master (Grievances, HR Queries, Confidential, Anonymous)
    INSERT INTO public.hr_ticket_categories (organization_id, ticket_type, category_name, sub_category_name, first_level_owner_type, l1_sla_days, l2_sla_days, l3_sla_days, l4_sla_days, is_confidential, is_anonymous)
    VALUES
        (v_org_id, 'grievance', 'Work Environment', 'Safety / Ergonomics', 'reporting_manager', 3, 7, 10, 12, false, false),
        (v_org_id, 'grievance', 'Role Clarity', 'Job Description / Objectives', 'reporting_manager', 3, 7, 10, 12, false, false),
        (v_org_id, 'grievance', 'Workload', 'Overtime / Allocation', 'reporting_manager', 3, 7, 10, 12, false, false),
        (v_org_id, 'grievance', 'Reporting Structure', 'Manager Assignment', 'reporting_manager', 3, 7, 10, 12, false, false),
        (v_org_id, 'grievance', 'Interpersonal Conflict', 'Peer / Team Disagreements', 'reporting_manager', 3, 7, 10, 12, false, false),
        (v_org_id, 'grievance', 'Workplace Behaviour', 'Conduct / Harassment', 'reporting_manager', 3, 7, 10, 12, false, false),
        (v_org_id, 'grievance', 'Managerial Concerns', 'Supervision / Feedback', 'reporting_manager', 3, 7, 10, 12, false, false),
        
        (v_org_id, 'hr_query', 'Payroll & Salary', 'Payslip / Salary Difference', 'hr', 2, 5, 8, 10, false, false),
        (v_org_id, 'hr_query', 'Attendance & Leave', 'Leave Balance / Regularization', 'hr', 2, 5, 8, 10, false, false),
        (v_org_id, 'hr_query', 'PF / ESIC / PT', 'PF Transfer / Statutory', 'hr', 3, 7, 10, 12, false, false),
        (v_org_id, 'hr_query', 'Reimbursements', 'Travel / Expense Claims', 'hr', 3, 7, 10, 12, false, false),
        (v_org_id, 'hr_query', 'Employee Documents', 'Letters / Verification', 'hr', 2, 5, 8, 10, false, false),
        (v_org_id, 'hr_query', 'Insurance & Mediclaim', 'Plum / Policy Details', 'hr', 2, 5, 8, 10, false, false),
        (v_org_id, 'hr_query', 'Onboarding & Exit', 'Full & Final Settlement', 'hr', 3, 7, 10, 12, false, false),
        (v_org_id, 'hr_query', 'Performance & Appraisal', 'KRA / Review Queries', 'hr', 3, 7, 10, 12, false, false),

        (v_org_id, 'confidential_feedback', 'Senior Management Concerns', 'Whistleblower / Retaliation', 'director', 1, 3, 5, 7, true, false),
        (v_org_id, 'anonymous_feedback', 'Anonymous Workplace Feedback', 'General Suggestion / Concern', 'director', 1, 3, 5, 7, true, true)
    ON CONFLICT DO NOTHING;

    -- 2. Temporary table for raw employee dataset
    CREATE TEMP TABLE temp_employees (
        ecode TEXT,
        first_name TEXT,
        last_name TEXT,
        department TEXT,
        designation TEXT,
        email TEXT,
        location TEXT,
        reporting_manager_name TEXT,
        phone TEXT
    );

    INSERT INTO temp_employees (ecode, first_name, last_name, department, designation, email, location, reporting_manager_name, phone) VALUES
        ('E001', 'Meena', 'Chavan', 'Operations', 'Senior Executive', 'Minarc21@gmail.com', 'Lower Parel', 'Foram Kashyap', '9029225545'),
        ('E009', 'Hitesh', 'Waghela', 'Operations', 'Office Boy', 'hitesh.waghela19@gmail.com', 'Lower Parel', 'Chavan Meena Ramrao', '9702602234'),
        ('E010', 'Padma', 'Padhy', 'Operations', 'Security Guard', 'padma.padhy14@gmail.com', 'Thane', 'Shailesh Kashyap', '9768308950'),
        ('E007', 'Foram', 'Kashyap', 'Operations', 'Assistant Manager', 'foram.edgeucaters@gmail.com', 'Andheri', 'Dipti Walanj', '9920890912'),
        ('E019', 'Nilesh', 'Mane', 'Operations', 'Senior Executive', 'manen661@gmail.com', 'Thane', 'Altamash', '7400223210'),
        ('E016', 'Shailesh Kumar', 'Kashyap', 'Infrastructure', 'Manager', 'shaileshkashyap23@gmail.com', 'Rabale', 'Dipti Walanj', '8551054933'),
        ('E020', 'Ankit', 'Shah', 'Infrastructure', 'Senior Manager', 'ankitshah8808@gmail.com', 'Lower Parel', 'Shrihari Balaraju Gardas', '8369905687'),
        ('E021', 'Sanchita', 'More', 'Operations', 'Senior Executive', 'sanchitaws0606@gmail.com', 'Andheri', 'Foram Kashyap', '8104602734'),
        ('E031', 'Saniel', 'Golechha', 'Management', 'Director', 'saniel@worksquare.in', 'Lower Parel', '', '9820645092'),
        ('E032', 'Rushabh', 'Shah', 'Management', 'Director', 'rushabh@worksquare.in', 'Lower Parel', '', '7738056910'),
        ('E046', 'Rajesh', 'Kadam', 'Accounts', 'Assistant General Manager', 'rajeshbk999@rediffmail.com', 'Lower Parel', 'Rushabh Shah', '9833104947'),
        ('E048', 'Sachin', 'Puri', 'Operations', 'Senior Executive', 'sachingoswami2020@gmail.com', 'Delhi', 'Dipti Walanj', '8178449170'),
        ('E055', 'Mehul', 'Kapadia', 'Business', 'General Manager', 'mehul089@gmail.com', 'Lower Parel', 'Rushabh Shah', '9833237615'),
        ('E058', 'Sachin', 'Karandikar', 'Operations', 'Senior Executive', 'sdkarandikar738@gmail.com', 'Thane', 'Shailesh Kashyap', '7757869026'),
        ('E064', 'Umesh', 'Singh', 'Operations', 'Multi Skilled Technician', 'rs8130478283@gmail.com', 'Noida', 'Dipti Walanj', '8130478283'),
        ('E071', 'Pratik', 'Gawade', 'Accounts', 'Executive', 'pratikgawade31052002@gmail.com', 'Lower Parel', 'Rajesh Bhikahi Kadam', '7304713844'),
        ('E076', 'Madhvi', 'Jain', 'Business Development & Growth', 'Senior Manager', 'Madhvi.1388@gmail.com', 'Delhi', 'Saniel Golechha', '9911936066'),
        ('E082', 'Vilas', 'Korgaonkar', 'Operations', 'Pantry Boy', 'hrworksquare@gmail.com', 'Andheri', 'Foram Kashyap', '9892675504'),
        ('E083', 'Shamrao', 'Patil', 'Operations', 'Senior Multi Skilled Technician', 'shamdada7171@gmail.com', 'Rabale', 'Sanket Bate', '9763134971'),
        ('E089', 'Nitesh', 'Nadge', 'Operations', 'Pantry Boy', 'nadgenitesh44@gmail.com', 'Rabale', 'Sanket Bate', '9022703850'),
        ('E095', 'Sahil', 'Sitaprao', 'Procurement', 'Executive', 'sitapraosahil15@gmail.com', 'Lower Parel', 'Saniel Golechha', '8291954934'),
        ('E096', 'Suraj', 'Nandavadekar', 'Infrastructure', 'Assistant Manager', 'surajmnandawadekar89@gmail.com', 'Rabale', 'Shrihari Balaraju Gardas', '8380901304'),
        ('E100', 'Rahul', 'Patel', 'Operations', 'Senior Executive', 'rahulpatel19.1986@yahoo.com', 'Indore', 'Dipti Walanj', '9926493556'),
        ('E101', 'Kanai', 'Das', 'Operations', 'Senior Executive', 'kanai.das567@gmail.com', 'Kolkata', 'Dipti Walanj', '7980038462'),
        ('E104', 'Dattu', 'Mistary', 'Operations', 'Pantry Boy', 'dattumistary5622@gmail.com', 'Rabale', 'Sanket Bate', '8454889386'),
        ('E103', 'Shrihari', 'Gardas', 'Operations', 'Vice President', 'gardas.shrihari@yahoo.com', 'Lower Parel', 'Saniel Golechha', '9920901001'),
        ('E106', 'Sandeep', 'Gardi', 'Operations', 'Multi Skilled Technician', 'sandeepgardi2215@gmail.com', 'Rabale', 'Sanket Bate', '9930446734'),
        ('E108', 'Sailee', 'Katkar', 'Legal', 'Senior Manager', 'Sailee.katkar@gmail.com', 'Lower Parel', 'Mehul Kiran Kapadia', '9326893975'),
        ('E124', 'Roohi', 'Idirishi', 'Human Resources', 'Senior Manager', 'roohiidrishi98@gmail.com', 'Lower Parel', 'Rushabh Shah', '7666809793'),
        ('E126', 'Kunar Singh', 'Tomar', 'Operations', 'Multi Skilled Technician', 'indrpalsinghtomar@gmail.com', 'Indore', 'Dipti Walanj', '8359858448'),
        ('E127', 'Manjunath', 'Kalyanpur', 'Business Development & Growth', 'Senior Manager', 'manjunath.kalyanpur@gmail.com', 'Bangalore', 'Saniel Golechha', '9844055642'),
        ('E132', 'Sangam', 'Dawale', 'Operations', 'Multi Skilled Technician', 'sangamdawale1998@gmail.com', 'Rabale', 'Sanket Bate', '7378737879'),
        ('E137', 'Irfan', 'Mulla', 'Operations', 'Executive', 'irfanmulla455220@gmail.com', 'Thane', 'Altamash', '8928606399'),
        ('E140', 'Chidanand', 'Tummarguddi', 'Operations', 'Multi Skilled Technician', 'tdchidu1998@gmail.com', 'Bangalore', 'Siddhalingappa', '9591910217'),
        ('E143', 'Siddhalingappa', 'Nagond', 'Operations', 'Executive', 'siddalingappa.nagond@worksquare.in', 'Bangalore', 'Dipti Walanj', '9980381998'),
        ('E144', 'Abhijeet', 'Jadhav', 'Operations', 'Executive', 'abhijeet.jadhav@worksquare.in', 'Andheri', 'Foram Kashyap', '9930368976'),
        ('E145', 'Priti', 'Kamble', 'Operations', 'BMS Operator', 'pritikamble769@gmail.com', 'Rabale', 'Sanket Bate', '7276443145'),
        ('E146', 'Abhiram', 'K', 'Infrastructure', 'Assistant Manager', 'abhir7429@gmail.com', 'Bangalore', 'Shrihari Balaraju Gardas', '8792543900'),
        ('E150', 'Shabbir', 'Hussain', 'Design', 'Project Manager', 'shabhussain22@gmail.com', 'Lower Parel', 'Shrihari Balaraju Gardas', '9820691384'),
        ('E152', 'Naresh', 'Laxman', 'Operations', 'Business Intelligence Manager', 'naresh.onair@gmail.com', 'Lower Parel', 'Dipti Walanj', '9920592120'),
        ('E157', 'Amar', 'Mathapati', 'Operations', 'Executive', 'Amar.mathapati55@gmail.com', 'Bangalore', 'Kiran Kumar', '8880269143'),
        ('E160', 'Neha Kumari', 'Singh', 'Business Development & Growth', 'Executive', 'nehasinghr1996@gmail.com', 'Noida', 'Madhvi Jain', '9473317603'),
        ('E172', 'Likhit', 'Gowda', 'Operations', 'Multi Skilled Technician', 'likhithgowdad397@gmail.com', 'Bangalore', 'Kiran Kumar', '9035992498'),
        ('E167', 'Rahul Kumar', 'Ramjiyawan', 'IT', 'Executive', 'rahulrvn17@gmail.com', 'Lower Parel', 'Suraj Nandavadkar', '9819426795'),
        ('E180', 'Godwin', 'Gabriel', 'Operations', 'Executive', 'godwingabriel2002@gmail.com', 'Bangalore', 'Naresh Laxman', '7619622465'),
        ('E179', 'Raj', 'Gawade', 'Design', 'Senior Desinger', 'rajyagawade@gmail.com', 'Lower Parel', 'Shabbir Hussain', '7020401694'),
        ('E181', 'Abhishek', 'Nagaraj', 'Operations', 'Executive', 'Abhiraj33ace@gmail.com', 'Bangalore', 'Naresh Laxman', '9741793531'),
        ('E182', 'Ajay', 'Vishwakarma', 'Operations', 'Multi Skilled Technician', 'ajayvish614@gmail.com', 'Rabale', 'Shailesh Kashyap', '9323646033'),
        ('E183', 'Amol', 'Lokhande', 'Operations', 'Multi Skilled Technician', 'amollokhande2287@gmail.com', 'Thane', 'Shailesh Kashyap', '9987739417'),
        ('E156', 'Sanket', 'Bate', 'Operations', 'BMS Operator', 'sanketbate9626@gmail.com', 'Rabale', 'Shailesh Kashyap', '9284159409'),
        ('E186', 'Naveenachari', 'B S', 'Operations', 'Multi Skilled Technician', 'srustikarta2022@gmail.com', 'Bangalore', 'Kiran Kumar', '9980189600'),
        ('E191', 'Lohitaksha', 'Ranganathan', 'Business Development & Growth', 'Assistant Manager', 'ranganathanlohitaksha@gmail.com', 'Bangalore', 'Saniel Golechha', '9100256500'),
        ('E194', 'Kiran', 'Kumar', 'Operations', 'Assistant Manager', 'Kiran.sr89@gmail.com', 'Bangalore', 'Dipti Walanj', '7022511962'),
        ('E196', 'Sangram', 'Swain', 'Operations', 'Security Supervisor', 'sangramswainkishore@gmail.com', 'Bangalore', 'Naresh Laxman', '8867398524'),
        ('E197', 'Pawan', 'Wagda', 'Operations', 'Multi Skilled Technician', 'pawanwagda68567@gmail.com', 'Indore', 'Dipti Walanj', '8269429165'),
        ('E198', 'Anil', 'Jena', 'Operations', 'Multi Skilled Technician', 'aniljena2012@gmail.com', 'Bangalore', 'Kiran Kumar', '9742231938'),
        ('E192', 'Raju', 'Sahu', 'Operations', 'Office Boy', 'rajusahu12081988@gmail.com', 'Bangalore', 'Siddhalingappa', '7760256324'),
        ('E201', 'Diya', 'Wadate', 'Legal', 'Executive', 'diyawadate2230@gmail.com', 'Lower Parel', 'Sailee Katkar', '7498159409'),
        ('E203', 'Vidya', 'Pawar', 'Procurement', 'Executive', 'vidyasy89@gmail.com', 'Lower Parel', 'Saniel Golechha', '9870536699'),
        ('E205', 'Shravani', 'Naik', 'Business Development & Growth', 'Executive', 'nshravani60@gmail.com', 'Lower Parel', 'Mehul Kiran Kapadia', '9833675513'),
        ('E206', 'Shubham', 'Gavali', 'Business Development & Growth', 'Executive', 'shubhamgavli365@gmail.com', 'Lower Parel', 'Mehul Kiran Kapadia', '9619427089'),
        ('E210', 'Shivaraj', 'RL', 'Operations', 'BMS Operator', 'rlshivaraj@gmail.com', 'Bangalore', 'Kiran Kumar', '8951300362'),
        ('E214', 'Ganesh', 'Patne', 'Operations', 'Pantry Boy', 'Patneganesh49@gmail.com', 'Lower Parel', 'Chavan Meena Ramrao', '8692849580'),
        ('E211', 'Ganesh', 'Naik', 'Operations', 'Executive', 'Ganesh.naik355@gmail.com', 'Bangalore', 'Naresh Laxman', '9742381323'),
        ('E215', 'Sushant', 'Londhe', 'Operations', 'BMS Operator', 'susmu_132@yahoo.com', 'Thane', 'Shailesh Kashyap', '7506423654'),
        ('E218', 'Nikta', 'Suryavanshi', 'Operations', 'BMS Operator', '3506nikitasuryavanshi@gmail.com', 'Rabale', 'Sanket Bate', '8591009919'),
        ('E217', 'Dheerendra', 'Tiwari', 'Operations', 'Manager', 'apexdheerendra@gmail.com', 'Indore', 'Dipti Walanj', '8109099828'),
        ('E219', 'Chandrashekhar', 'Patil', 'Operations', 'Multi Skilled Technician', 'patilchandrashekhar99@gmail.com', 'Thane', 'Shailesh Kashyap', '9987994749'),
        ('E220', 'Sachin', 'Padale', 'Operations', 'Multi Skilled Technician', 'sachinpadale777@gmail.com', 'Thane', 'Shailesh Kashyap', '8898888075'),
        ('E222', 'Dipti', 'Walanj', 'Operations', 'Senior General Manager', 'dipti_virgo@yahoo.co.in', 'Lower Parel', 'Shrihari Balaraju Gardas', '9920466715'),
        ('E223', 'Mahmadul', 'Rajan', 'Operations', 'Pantry Boy', 'mahmudulrajan@gmail.com', 'Bangalore', 'Naresh Laxman', '9366606964'),
        ('E225', 'Ayub', 'Varunkar', 'Operations', 'Multi Skilled Technician', 'varunkarayub786@gmail.com', 'Thane', 'Shailesh Kashyap', '8108234124'),
        ('E226', 'Sanil', 'Parab', 'Human Resources', 'Assistant Manager', 'sanil.parab96@gmail.com', 'Lower Parel', 'Roohi Ezaz Idirishi', '9561045994'),
        ('E229', 'Harish', 'More', 'Operations', 'Multi Skilled Technician', 'harishmore2238@gmail.com', 'Rabale', 'Sanket Bate', '7218615650'),
        ('E231', 'Anil', 'Kumar', 'Operations', 'Multi Skilled Technician', 'anilbningabo@gmail.com', 'Bangalore', 'Kiran Kumar', '7975358755'),
        ('E238', 'Vrushali', 'Tambe', 'Accounts', 'Senior Executive', 'vtambe342@gmail.com', 'Lower Parel', 'Rajesh Bhikahi Kadam', '8879816085'),
        ('E241', 'Altamash', 'Chaugule', 'Operations', 'Senior Executive', 'altamash.as24@yahoo.com', 'Thane', 'Shailesh Kashyap', '9702848798'),
        ('E250', 'Nilesh', 'Parkhe', 'Operations', 'Pantry Boy', 'nileshparkhe786@gmail.com', 'Thane', 'Shailesh Kashyap', '8454057390'),
        ('E240', 'Luis', 'Rozario', 'Design', 'Team Lead', 'rozarioluis@gmail.com', 'Lower Parel', 'Shabbir Hussain', '9619052262'),
        ('E239', 'Dushyanth', 'V', 'Operations', 'BMS Operator', 'dushyanth.venketesh@gmail.com', 'Bangalore', 'Kiran Kumar', '9686495076'),
        ('E244', 'Manu', 'Naik', 'Operations', 'Security Supervisor', 'manukmnaik@gmail.com', 'Bangalore', 'Naresh Laxman', '8546898916'),
        ('E245', 'Abhinav', 'Kawade', 'Marketing', 'Executive', 'abhinavkawade412@gmail.com', 'Lower Parel', 'Nirupam Lahiri', '9307339245'),
        ('E247', 'Manjunath', 'AS', 'Operations', 'Multi Skilled Technician', 'manjunathaas433@gmail.com', 'Bangalore', 'Kiran Kumar', '7026083859'),
        ('E248', 'Nirupam', 'Lahiri', 'Marketing', 'Assistant General Manager', 'lahirinirupam@gmail.com', 'Lower Parel', 'Rushabh Shah', '8669056388'),
        ('E249', 'Sonia', 'Gupta', 'Operations', 'Front Desk Executive', 'sonia.gupta1303@gmail.com', 'Delhi', 'Dipti Walanj', '8929102099'),
        ('E251', 'Raksha', 'Sharma', 'Operations', 'Front Desk Executive', 'sharmaraksha0889@gmail.com', 'Indore', 'Dipti Walanj', '9630447704'),
        ('E253', 'Shiddesh', 'Kumar', 'Operations', 'Runner Boy', 'shiddesh@gmail.com', 'Bangalore', 'Naresh Laxman', '9964690860'),
        ('E259', 'Shreedhar', 'SP', 'Operations', 'Technical Executive', 'shridhrsp1994@gmail.com', 'Bangalore', 'Kiran Kumar', '9900805204'),
        ('E255', 'Minal', 'Shirke', 'Operations', 'Trainee', 'minalshirke0111@gmail.com', 'Thane', 'Shailesh Kashyap', '8080981234'),
        ('E263', 'Nikhil', 'pawar', 'Operations', 'Executive', 'np63082@gmail.com', 'Rabale', 'Shailesh Kashyap', '7700033283'),
        ('E260', 'Harshini', 'Ranganathan', 'Business Development & Growth', 'Executive', 'harshinirs27@gmail.com', 'Bangalore', 'Manjunath Kalyanpur', '9494608123'),
        ('E264', 'Durga Prasad', 'Malviya', 'Opeartions', 'Executive', 'malviyadurgaprasad00@gmail.com', 'Indore', 'Dipti Walanj', '7024488745'),
        ('E262', 'Neeti', 'Upadhyay', 'Human Resource', 'Jr HR Executive', 'neeti17upadhyay@gmail.com', 'Lower Parel', 'Sanil Parab', '9424332575'),
        ('I12', 'Tisha', 'Rathod', 'Business Development & Growth', 'Intern', 'tishaarathod25@gmail.com', 'Lower Parel', 'Mehul Kiran Kapadia', '9004425481'),
        ('E270', 'Jaseem', 'Shaikh', 'Opeartions', 'Facility Executive', 'sheikjaseem97@gmail.com', 'Bangalore', 'Naresh Laxman', '9894861098'),
        ('E269', 'Faizur', 'Abdullah', 'Opeartions', 'Pantry Boy', 'faizurabdullah660@gmail.com', 'Bangalore', 'Naresh Laxman', '6001052019'),
        ('E267', 'Sushant', 'Shinde', 'Human Resource', 'Executive', 'shindesushant049@gmail.com', 'Lower Parel', 'Sanil Parab', '8652842689'),
        ('E258', 'Ganesh', 'Bobade', 'Operations', 'Housekeeping Supervisor', 'ganeshbobade420@gmail.com', 'Thane', 'Shailesh Kashyap', '8652275012'),
        ('E265', 'Laxmi', 'Tondikatti', 'Opeartions', 'Housekeeping Supervisor', 'stlakshmi32@gmail.com', 'Bangalore', 'Naresh Laxman', '8147642637'),
        ('E271', 'Satej', 'Sadhye', 'Procurement', 'Procurement Executive', 'satejsadhye210@gmail.com', 'Lower Parel', 'Saniel Golechha', '7045149504'),
        ('E272', 'Minal', 'Shahane', 'Marketing', 'Visual Designer', 'Minalshahane06@gmail.com', 'Lower Parel', 'Nirupam Lahiri', '9619091150'),
        ('E273', 'Paravin', 'Paru', 'Operations', 'Front Office', 'paravinparu26@gmail.com', 'Bangalore', 'Naresh Laxman', '7676168393'),
        ('E274', 'Partha', 'Nayek', 'Operations', 'Pantry Boy', 'parthanayek996@gmail.com', 'Bangalore', 'Naresh Laxman', '7003347045'),
        ('I13', 'Veer', 'Mehta', 'Business Development and Growth', 'Intern', 'veermehta109@gmail.com', 'Lower Parel', 'Saniel Golechha', '8448272042'),
        ('E275', 'Rajesh', 'Zore', 'Design', 'Interior Designer', 'rajeshzore98@gmail.com', 'Lower Parel', 'Shabbir Hussain', '8108070893'),
        ('E276', 'Gauri', 'Pise', 'Operations', 'Housekeeping Supervisor', 'gauripise1509@gmail.com', 'Thane', 'Shailesh K', '9321050901'),
        ('E277', 'Manjunath', 'K', 'Operations', 'Facility Executive', 'manju.kumar87@gmail.com', 'Bangalore', 'Naresh Laxman', '9141788256'),
        ('E278', 'Hemanthraju', 'D', 'Operations', 'Pantry Boy', 'hhemanthemant37@gmail.com', 'Bangalore', 'Naresh Laxman', '8861874479'),
        ('E279', 'Samuvel', 'S', 'Infrastructure', 'Site Supervisor', 'ss9502466@gmail.com', 'Bangalore', 'Abhiram', '7806905340'),
        ('E280', 'Anjaniappa', 'Anji', 'Operations', 'Sr Multi Skilled Technician', 'anjusandanur@gmail.com', 'Bangalore', 'Kiran', '9964835882'),
        ('E281', 'Prajkta', 'Chavan', 'Operations', 'BMS', 'prajktachavan902@gmail.com', 'Thane', 'Shailesh K', '9594093018'),
        ('E282', 'Harsh', 'Patil', 'Tech', 'Forward Deployment Engineer', 'harshrp2309@gmail.com', 'Lower Parel', 'Lohitaksha Ranganathan', '7028232515'),
        ('E283', 'Binod', 'Routh', 'Operations', 'Pantry Boy', 'routhbinod821@gmail.com', 'Bangalore', 'Naresh Laxman', '9641965520'),
        ('E284', 'Anil', 'Kumar', 'Infrastructure', 'Site Supervisor', 'anilarmy0071998@gmail.com', 'Noida', 'Suraj Harishchandra Nandavadekar', '7503563009'),
        ('E285', 'Pramod', 'R N', 'Opeartions', 'Trainee', 'pramodrajagere18@gmail.com', 'Bangalore', 'Naresh Laxman', '8073607692'),
        ('E286', 'Priyanka', 'Pal', 'Procurement', 'Executive', 'priyanka1304pal@gmail.com', 'Lower Parel', 'Saniel Golechha', ''),
        ('E288', 'Aakanksha', 'Sakpal', 'Legal', 'Senior Manager', 'aks.sakpal03@gmail.com', 'Lower Parel', 'Mehul Kiran Kapadia', '7977193873'),
        ('E289', 'Utpal', 'Debnath', 'Operations', 'Pantry Boy', 'kanaidebnath372@gmail.com', 'Bangalore', 'Naresh Laxman', '6296734851');

    -- 3. Upsert into public.employee_profiles with email matching against public.users
    INSERT INTO public.employee_profiles (
        organization_id,
        user_id,
        employee_code,
        first_name,
        last_name,
        email,
        phone,
        department,
        designation,
        location,
        reporting_manager_code,
        is_director_authority,
        is_hr_authority,
        reconciliation_status,
        is_active
    )
    SELECT
        v_org_id,
        u.id AS user_id,
        t.ecode,
        t.first_name,
        t.last_name,
        t.email,
        t.phone,
        t.department,
        t.designation,
        t.location,
        t.reporting_manager_name,
        (t.ecode IN ('E031', 'E032') OR t.designation = 'Director'),
        (t.department ILIKE '%Human Resource%'),
        CASE WHEN u.id IS NOT NULL THEN 'linked' ELSE 'unlinked' END,
        true
    FROM temp_employees t
    LEFT JOIN public.users u ON LOWER(u.email) = LOWER(t.email)
    ON CONFLICT (organization_id, employee_code) DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        department = EXCLUDED.department,
        designation = EXCLUDED.designation,
        location = EXCLUDED.location,
        reporting_manager_code = EXCLUDED.reporting_manager_code,
        is_director_authority = EXCLUDED.is_director_authority,
        is_hr_authority = EXCLUDED.is_hr_authority,
        reconciliation_status = EXCLUDED.reconciliation_status;

    -- 4. Resolve reporting_manager_id based on manager text name match
    UPDATE public.employee_profiles e
    SET reporting_manager_id = m.user_id
    FROM temp_employees t
    JOIN public.employee_profiles m ON (
        LOWER(TRIM(m.first_name || ' ' || m.last_name)) LIKE LOWER(TRIM(t.reporting_manager_name)) || '%'
        OR LOWER(TRIM(t.reporting_manager_name)) LIKE LOWER(TRIM(m.first_name)) || '%'
    )
    WHERE e.employee_code = t.ecode
      AND t.reporting_manager_name IS NOT NULL 
      AND t.reporting_manager_name != ''
      AND m.user_id IS NOT NULL;

    DROP TABLE temp_employees;
END $$;
