import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const RAW_EMPLOYEES = [
    { ecode: 'E001', first_name: 'Meena', last_name: 'Chavan', department: 'Operations', designation: 'Senior Executive', email: 'Minarc21@gmail.com', location: 'Lower Parel', reporting_manager_name: 'Foram Kashyap', phone: '9029225545' },
    { ecode: 'E009', first_name: 'Hitesh', last_name: 'Waghela', department: 'Operations', designation: 'Office Boy', email: 'hitesh.waghela19@gmail.com', location: 'Lower Parel', reporting_manager_name: 'Chavan Meena Ramrao', phone: '9702602234' },
    { ecode: 'E010', first_name: 'Padma', last_name: 'Padhy', department: 'Operations', designation: 'Security Guard', email: 'padma.padhy14@gmail.com', location: 'Thane', reporting_manager_name: 'Shailesh Kashyap', phone: '9768308950' },
    { ecode: 'E007', first_name: 'Foram', last_name: 'Kashyap', department: 'Operations', designation: 'Assistant Manager', email: 'foram.edgeucaters@gmail.com', location: 'Andheri', reporting_manager_name: 'Dipti Walanj', phone: '9920890912' },
    { ecode: 'E019', first_name: 'Nilesh', last_name: 'Mane', department: 'Operations', designation: 'Senior Executive', email: 'manen661@gmail.com', location: 'Thane', reporting_manager_name: 'Altamash', phone: '7400223210' },
    { ecode: 'E016', first_name: 'Shailesh Kumar', last_name: 'Kashyap', department: 'Infrastructure', designation: 'Manager', email: 'shaileshkashyap23@gmail.com', location: 'Rabale', reporting_manager_name: 'Dipti Walanj', phone: '8551054933' },
    { ecode: 'E020', first_name: 'Ankit', last_name: 'Shah', department: 'Infrastructure', designation: 'Senior Manager', email: 'ankitshah8808@gmail.com', location: 'Lower Parel', reporting_manager_name: 'Shrihari Balaraju Gardas', phone: '8369905687' },
    { ecode: 'E021', first_name: 'Sanchita', last_name: 'More', department: 'Operations', designation: 'Senior Executive', email: 'sanchitaws0606@gmail.com', location: 'Andheri', reporting_manager_name: 'Foram Kashyap', phone: '8104602734' },
    { ecode: 'E031', first_name: 'Saniel', last_name: 'Golechha', department: 'Management', designation: 'Director', email: 'saniel@worksquare.in', location: 'Lower Parel', reporting_manager_name: '', phone: '9820645092' },
    { ecode: 'E032', first_name: 'Rushabh', last_name: 'Shah', department: 'Management', designation: 'Director', email: 'rushabh@worksquare.in', location: 'Lower Parel', reporting_manager_name: '', phone: '7738056910' },
    { ecode: 'E046', first_name: 'Rajesh', last_name: 'Kadam', department: 'Accounts', designation: 'Assistant General Manager', email: 'rajeshbk999@rediffmail.com', location: 'Lower Parel', reporting_manager_name: 'Rushabh Shah', phone: '9833104947' },
    { ecode: 'E048', first_name: 'Sachin', last_name: 'Puri', department: 'Operations', designation: 'Senior Executive', email: 'sachingoswami2020@gmail.com', location: 'Delhi', reporting_manager_name: 'Dipti Walanj', phone: '8178449170' },
    { ecode: 'E055', first_name: 'Mehul', last_name: 'Kapadia', department: 'Business', designation: 'General Manager', email: 'mehul089@gmail.com', location: 'Lower Parel', reporting_manager_name: 'Rushabh Shah', phone: '9833237615' },
    { ecode: 'E058', first_name: 'Sachin', last_name: 'Karandikar', department: 'Operations', designation: 'Senior Executive', email: 'sdkarandikar738@gmail.com', location: 'Thane', reporting_manager_name: 'Shailesh Kashyap', phone: '7757869026' },
    { ecode: 'E064', first_name: 'Umesh', last_name: 'Singh', department: 'Operations', designation: 'Multi Skilled Technician', email: 'rs8130478283@gmail.com', location: 'Noida', reporting_manager_name: 'Dipti Walanj', phone: '8130478283' },
    { ecode: 'E071', first_name: 'Pratik', last_name: 'Gawade', department: 'Accounts', designation: 'Executive', email: 'pratikgawade31052002@gmail.com', location: 'Lower Parel', reporting_manager_name: 'Rajesh Bhikahi Kadam', phone: '7304713844' },
    { ecode: 'E076', first_name: 'Madhvi', last_name: 'Jain', department: 'Business Development & Growth', designation: 'Senior Manager', email: 'Madhvi.1388@gmail.com', location: 'Delhi', reporting_manager_name: 'Saniel Golechha', phone: '9911936066' },
    { ecode: 'E082', first_name: 'Vilas', last_name: 'Korgaonkar', department: 'Operations', designation: 'Pantry Boy', email: 'hrworksquare@gmail.com', location: 'Andheri', reporting_manager_name: 'Foram Kashyap', phone: '9892675504' },
    { ecode: 'E083', first_name: 'Shamrao', last_name: 'Patil', department: 'Operations', designation: 'Senior Multi Skilled Technician', email: 'shamdada7171@gmail.com', location: 'Rabale', reporting_manager_name: 'Sanket Bate', phone: '9763134971' },
    { ecode: 'E089', first_name: 'Nitesh', last_name: 'Nadge', department: 'Operations', designation: 'Pantry Boy', email: 'nadgenitesh44@gmail.com', location: 'Rabale', reporting_manager_name: 'Sanket Bate', phone: '9022703850' },
    { ecode: 'E095', first_name: 'Sahil', last_name: 'Sitaprao', department: 'Procurement', designation: 'Executive', email: 'sitapraosahil15@gmail.com', location: 'Lower Parel', reporting_manager_name: 'Saniel Golechha', phone: '8291954934' },
    { ecode: 'E096', first_name: 'Suraj', last_name: 'Nandavadekar', department: 'Infrastructure', designation: 'Assistant Manager', email: 'surajmnandawadekar89@gmail.com', location: 'Rabale', reporting_manager_name: 'Shrihari Balaraju Gardas', phone: '8380901304' },
    { ecode: 'E100', first_name: 'Rahul', last_name: 'Patel', department: 'Operations', designation: 'Senior Executive', email: 'rahulpatel19.1986@yahoo.com', location: 'Indore', reporting_manager_name: 'Dipti Walanj', phone: '9926493556' },
    { ecode: 'E101', first_name: 'Kanai', last_name: 'Das', department: 'Operations', designation: 'Senior Executive', email: 'kanai.das567@gmail.com', location: 'Kolkata', reporting_manager_name: 'Dipti Walanj', phone: '7980038462' },
    { ecode: 'E104', first_name: 'Dattu', last_name: 'Mistary', department: 'Operations', designation: 'Pantry Boy', email: 'dattumistary5622@gmail.com', location: 'Rabale', reporting_manager_name: 'Sanket Bate', phone: '8454889386' },
    { ecode: 'E103', first_name: 'Shrihari', last_name: 'Gardas', department: 'Operations', designation: 'Vice President', email: 'gardas.shrihari@yahoo.com', location: 'Lower Parel', reporting_manager_name: 'Saniel Golechha', phone: '9920901001' },
    { ecode: 'E106', first_name: 'Sandeep', last_name: 'Gardi', department: 'Operations', designation: 'Multi Skilled Technician', email: 'sandeepgardi2215@gmail.com', location: 'Rabale', reporting_manager_name: 'Sanket Bate', phone: '9930446734' },
    { ecode: 'E108', first_name: 'Sailee', last_name: 'Katkar', department: 'Legal', designation: 'Senior Manager', email: 'Sailee.katkar@gmail.com', location: 'Lower Parel', reporting_manager_name: 'Mehul Kiran Kapadia', phone: '9326893975' },
    { ecode: 'E124', first_name: 'Roohi', last_name: 'Idirishi', department: 'Human Resources', designation: 'Senior Manager', email: 'roohiidrishi98@gmail.com', location: 'Lower Parel', reporting_manager_name: 'Rushabh Shah', phone: '7666809793' },
    { ecode: 'E126', first_name: 'Kunar Singh', last_name: 'Tomar', department: 'Operations', designation: 'Multi Skilled Technician', email: 'indrpalsinghtomar@gmail.com', location: 'Indore', reporting_manager_name: 'Dipti Walanj', phone: '8359858448' },
    { ecode: 'E127', first_name: 'Manjunath', last_name: 'Kalyanpur', department: 'Business Development & Growth', designation: 'Senior Manager', email: 'manjunath.kalyanpur@gmail.com', location: 'Bangalore', reporting_manager_name: 'Saniel Golechha', phone: '9844055642' },
    { ecode: 'E132', first_name: 'Sangam', last_name: 'Dawale', department: 'Operations', designation: 'Multi Skilled Technician', email: 'sangamdawale1998@gmail.com', location: 'Rabale', reporting_manager_name: 'Sanket Bate', phone: '7378737879' },
    { ecode: 'E137', first_name: 'Irfan', last_name: 'Mulla', department: 'Operations', designation: 'Executive', email: 'irfanmulla455220@gmail.com', location: 'Thane', reporting_manager_name: 'Altamash', phone: '8928606399' },
    { ecode: 'E140', first_name: 'Chidanand', last_name: 'Tummarguddi', department: 'Operations', designation: 'Multi Skilled Technician', email: 'tdchidu1998@gmail.com', location: 'Bangalore', reporting_manager_name: 'Siddhalingappa', phone: '9591910217' },
    { ecode: 'E143', first_name: 'Siddhalingappa', last_name: 'Nagond', department: 'Operations', designation: 'Executive', email: 'siddalingappa.nagond@worksquare.in', location: 'Bangalore', reporting_manager_name: 'Dipti Walanj', phone: '9980381998' },
    { ecode: 'E144', first_name: 'Abhijeet', last_name: 'Jadhav', department: 'Operations', designation: 'Executive', email: 'abhijeet.jadhav@worksquare.in', location: 'Andheri', reporting_manager_name: 'Foram Kashyap', phone: '9930368976' },
    { ecode: 'E145', first_name: 'Priti', last_name: 'Kamble', department: 'Operations', designation: 'BMS Operator', email: 'pritikamble769@gmail.com', location: 'Rabale', reporting_manager_name: 'Sanket Bate', phone: '7276443145' },
    { ecode: 'E146', first_name: 'Abhiram', last_name: 'K', department: 'Infrastructure', designation: 'Assistant Manager', email: 'abhir7429@gmail.com', location: 'Bangalore', reporting_manager_name: 'Shrihari Balaraju Gardas', phone: '8792543900' },
    { ecode: 'E150', first_name: 'Shabbir', last_name: 'Hussain', department: 'Design', designation: 'Project Manager', email: 'shabhussain22@gmail.com', location: 'Lower Parel', reporting_manager_name: 'Shrihari Balaraju Gardas', phone: '9820691384' },
    { ecode: 'E152', first_name: 'Naresh', last_name: 'Laxman', department: 'Operations', designation: 'Business Intelligence Manager', email: 'naresh.onair@gmail.com', location: 'Lower Parel', reporting_manager_name: 'Dipti Walanj', phone: '9920592120' },
    { ecode: 'E157', first_name: 'Amar', last_name: 'Mathapati', department: 'Operations', designation: 'Executive', email: 'Amar.mathapati55@gmail.com', location: 'Bangalore', reporting_manager_name: 'Kiran Kumar', phone: '8880269143' },
    { ecode: 'E160', first_name: 'Neha Kumari', last_name: 'Singh', department: 'Business Development & Growth', designation: 'Executive', email: 'nehasinghr1996@gmail.com', location: 'Noida', reporting_manager_name: 'Madhvi Jain', phone: '9473317603' },
    { ecode: 'E172', first_name: 'Likhit', last_name: 'Gowda', department: 'Operations', designation: 'Multi Skilled Technician', email: 'likhithgowdad397@gmail.com', location: 'Bangalore', reporting_manager_name: 'Kiran Kumar', phone: '9035992498' },
    { ecode: 'E167', first_name: 'Rahul Kumar', last_name: 'Ramjiyawan', department: 'IT', designation: 'Executive', email: 'rahulrvn17@gmail.com', location: 'Lower Parel', reporting_manager_name: 'Suraj Nandavadkar', phone: '9819426795' },
    { ecode: 'E180', first_name: 'Godwin', last_name: 'Gabriel', department: 'Operations', designation: 'Executive', email: 'godwingabriel2002@gmail.com', location: 'Bangalore', reporting_manager_name: 'Naresh Laxman', phone: '7619622465' },
    { ecode: 'E179', first_name: 'Raj', last_name: 'Gawade', department: 'Design', designation: 'Senior Desinger', email: 'rajyagawade@gmail.com', location: 'Lower Parel', reporting_manager_name: 'Shabbir Hussain', phone: '7020401694' },
    { ecode: 'E181', first_name: 'Abhishek', last_name: 'Nagaraj', department: 'Operations', designation: 'Executive', email: 'Abhiraj33ace@gmail.com', location: 'Bangalore', reporting_manager_name: 'Naresh Laxman', phone: '9741793531' },
    { ecode: 'E182', first_name: 'Ajay', last_name: 'Vishwakarma', department: 'Operations', designation: 'Multi Skilled Technician', email: 'ajayvish614@gmail.com', location: 'Rabale', reporting_manager_name: 'Shailesh Kashyap', phone: '9323646033' },
    { ecode: 'E183', first_name: 'Amol', last_name: 'Lokhande', department: 'Operations', designation: 'Multi Skilled Technician', email: 'amollokhande2287@gmail.com', location: 'Thane', reporting_manager_name: 'Shailesh Kashyap', phone: '9987739417' },
    { ecode: 'E156', first_name: 'Sanket', last_name: 'Bate', department: 'Operations', designation: 'BMS Operator', email: 'sanketbate9626@gmail.com', location: 'Rabale', reporting_manager_name: 'Shailesh Kashyap', phone: '9284159409' },
    { ecode: 'E186', first_name: 'Naveenachari', last_name: 'B S', department: 'Operations', designation: 'Multi Skilled Technician', email: 'srustikarta2022@gmail.com', location: 'Bangalore', reporting_manager_name: 'Kiran Kumar', phone: '9980189600' },
    { ecode: 'E191', first_name: 'Lohitaksha', last_name: 'Ranganathan', department: 'Business Development & Growth', designation: 'Assistant Manager', email: 'ranganathanlohitaksha@gmail.com', location: 'Bangalore', reporting_manager_name: 'Saniel Golechha', phone: '9100256500' },
    { ecode: 'E194', first_name: 'Kiran', last_name: 'Kumar', department: 'Operations', designation: 'Assistant Manager', email: 'Kiran.sr89@gmail.com', location: 'Bangalore', reporting_manager_name: 'Dipti Walanj', phone: '7022511962' },
    { ecode: 'E196', first_name: 'Sangram', last_name: 'Swain', department: 'Operations', designation: 'Security Supervisor', email: 'sangramswainkishore@gmail.com', location: 'Bangalore', reporting_manager_name: 'Naresh Laxman', phone: '8867398524' },
    { ecode: 'E197', first_name: 'Pawan', last_name: 'Wagda', department: 'Operations', designation: 'Multi Skilled Technician', email: 'pawanwagda68567@gmail.com', location: 'Indore', reporting_manager_name: 'Dipti Walanj', phone: '8269429165' },
    { ecode: 'E198', first_name: 'Anil', last_name: 'Jena', department: 'Operations', designation: 'Multi Skilled Technician', email: 'aniljena2012@gmail.com', location: 'Bangalore', reporting_manager_name: 'Kiran Kumar', phone: '9742231938' },
    { ecode: 'E192', first_name: 'Raju', last_name: 'Sahu', department: 'Operations', designation: 'Office Boy', email: 'rajusahu12081988@gmail.com', location: 'Bangalore', reporting_manager_name: 'Siddhalingappa', phone: '7760256324' },
    { ecode: 'E201', first_name: 'Diya', last_name: 'Wadate', department: 'Legal', designation: 'Executive', email: 'diyawadate2230@gmail.com', location: 'Lower Parel', reporting_manager_name: 'Sailee Katkar', phone: '7498159409' },
    { ecode: 'E203', first_name: 'Vidya', last_name: 'Pawar', department: 'Procurement', designation: 'Executive', email: 'vidyasy89@gmail.com', location: 'Lower Parel', reporting_manager_name: 'Saniel Golechha', phone: '9870536699' },
    { ecode: 'E205', first_name: 'Shravani', last_name: 'Naik', department: 'Business Development & Growth', designation: 'Executive', email: 'nshravani60@gmail.com', location: 'Lower Parel', reporting_manager_name: 'Mehul Kiran Kapadia', phone: '9833675513' },
    { ecode: 'E206', first_name: 'Shubham', last_name: 'Gavali', department: 'Business Development & Growth', designation: 'Executive', email: 'shubhamgavli365@gmail.com', location: 'Lower Parel', reporting_manager_name: 'Mehul Kiran Kapadia', phone: '9619427089' },
    { ecode: 'E210', first_name: 'Shivaraj', last_name: 'RL', department: 'Operations', designation: 'BMS Operator', email: 'rlshivaraj@gmail.com', location: 'Bangalore', reporting_manager_name: 'Kiran Kumar', phone: '8951300362' },
    { ecode: 'E214', first_name: 'Ganesh', last_name: 'Patne', department: 'Operations', designation: 'Pantry Boy', email: 'Patneganesh49@gmail.com', location: 'Lower Parel', reporting_manager_name: 'Chavan Meena Ramrao', phone: '8692849580' },
    { ecode: 'E211', first_name: 'Ganesh', last_name: 'Naik', department: 'Operations', designation: 'Executive', email: 'Ganesh.naik355@gmail.com', location: 'Bangalore', reporting_manager_name: 'Naresh Laxman', phone: '9742381323' },
    { ecode: 'E215', first_name: 'Sushant', last_name: 'Londhe', department: 'Operations', designation: 'BMS Operator', email: 'susmu_132@yahoo.com', location: 'Thane', reporting_manager_name: 'Shailesh Kashyap', phone: '7506423654' },
    { ecode: 'E218', first_name: 'Nikta', last_name: 'Suryavanshi', department: 'Operations', designation: 'BMS Operator', email: '3506nikitasuryavanshi@gmail.com', location: 'Rabale', reporting_manager_name: 'Sanket Bate', phone: '8591009919' },
    { ecode: 'E217', first_name: 'Dheerendra', last_name: 'Tiwari', department: 'Operations', designation: 'Manager', email: 'apexdheerendra@gmail.com', location: 'Indore', reporting_manager_name: 'Dipti Walanj', phone: '8109099828' },
    { ecode: 'E219', first_name: 'Chandrashekhar', last_name: 'Patil', department: 'Operations', designation: 'Multi Skilled Technician', email: 'patilchandrashekhar99@gmail.com', location: 'Thane', reporting_manager_name: 'Shailesh Kashyap', phone: '9987994749' },
    { ecode: 'E220', first_name: 'Sachin', last_name: 'Padale', department: 'Operations', designation: 'Multi Skilled Technician', email: 'sachinpadale777@gmail.com', location: 'Thane', reporting_manager_name: 'Shailesh Kashyap', phone: '8898888075' },
    { ecode: 'E222', first_name: 'Dipti', last_name: 'Walanj', department: 'Operations', designation: 'Senior General Manager', email: 'dipti_virgo@yahoo.co.in', location: 'Lower Parel', reporting_manager_name: 'Shrihari Balaraju Gardas', phone: '9920466715' },
    { ecode: 'E223', first_name: 'Mahmadul', last_name: 'Rajan', department: 'Operations', designation: 'Pantry Boy', email: 'mahmudulrajan@gmail.com', location: 'Bangalore', reporting_manager_name: 'Naresh Laxman', phone: '9366606964' },
    { ecode: 'E225', first_name: 'Ayub', last_name: 'Varunkar', department: 'Operations', designation: 'Multi Skilled Technician', email: 'varunkarayub786@gmail.com', location: 'Thane', reporting_manager_name: 'Shailesh Kashyap', phone: '8108234124' },
    { ecode: 'E226', first_name: 'Sanil', last_name: 'Parab', department: 'Human Resources', designation: 'Assistant Manager', email: 'sanil.parab96@gmail.com', location: 'Lower Parel', reporting_manager_name: 'Roohi Ezaz Idirishi', phone: '9561045994' },
    { ecode: 'E229', first_name: 'Harish', last_name: 'More', department: 'Operations', designation: 'Multi Skilled Technician', email: 'harishmore2238@gmail.com', location: 'Rabale', reporting_manager_name: 'Sanket Bate', phone: '7218615650' },
    { ecode: 'E231', first_name: 'Anil', last_name: 'Kumar', department: 'Operations', designation: 'Multi Skilled Technician', email: 'anilbningabo@gmail.com', location: 'Bangalore', reporting_manager_name: 'Kiran Kumar', phone: '7975358755' },
    { ecode: 'E238', first_name: 'Vrushali', last_name: 'Tambe', department: 'Accounts', designation: 'Senior Executive', email: 'vtambe342@gmail.com', location: 'Lower Parel', reporting_manager_name: 'Rajesh Bhikahi Kadam', phone: '8879816085' },
    { ecode: 'E241', first_name: 'Altamash', last_name: 'Chaugule', department: 'Operations', designation: 'Senior Executive', email: 'altamash.as24@yahoo.com', location: 'Thane', reporting_manager_name: 'Shailesh Kashyap', phone: '9702848798' },
    { ecode: 'E250', first_name: 'Nilesh', last_name: 'Parkhe', department: 'Operations', designation: 'Pantry Boy', email: 'nileshparkhe786@gmail.com', location: 'Thane', reporting_manager_name: 'Shailesh Kashyap', phone: '8454057390' },
    { ecode: 'E240', first_name: 'Luis', last_name: 'Rozario', department: 'Design', designation: 'Team Lead', email: 'rozarioluis@gmail.com', location: 'Lower Parel', reporting_manager_name: 'Shabbir Hussain', phone: '9619052262' },
    { ecode: 'E239', first_name: 'Dushyanth', last_name: 'V', department: 'Operations', designation: 'BMS Operator', email: 'dushyanth.venketesh@gmail.com', location: 'Bangalore', reporting_manager_name: 'Kiran Kumar', phone: '9686495076' },
    { ecode: 'E244', first_name: 'Manu', last_name: 'Naik', department: 'Operations', designation: 'Security Supervisor', email: 'manukmnaik@gmail.com', location: 'Bangalore', reporting_manager_name: 'Naresh Laxman', phone: '8546898916' },
    { ecode: 'E245', first_name: 'Abhinav', last_name: 'Kawade', department: 'Marketing', designation: 'Executive', email: 'abhinavkawade412@gmail.com', location: 'Lower Parel', reporting_manager_name: 'Nirupam Lahiri', phone: '9307339245' },
    { ecode: 'E247', first_name: 'Manjunath', last_name: 'AS', department: 'Operations', designation: 'Multi Skilled Technician', email: 'manjunathaas433@gmail.com', location: 'Bangalore', reporting_manager_name: 'Kiran Kumar', phone: '7026083859' },
    { ecode: 'E248', first_name: 'Nirupam', last_name: 'Lahiri', department: 'Marketing', designation: 'Assistant General Manager', email: 'lahirinirupam@gmail.com', location: 'Lower Parel', reporting_manager_name: 'Rushabh Shah', phone: '8669056388' },
    { ecode: 'E249', first_name: 'Sonia', last_name: 'Gupta', department: 'Operations', designation: 'Front Desk Executive', email: 'sonia.gupta1303@gmail.com', location: 'Delhi', reporting_manager_name: 'Dipti Walanj', phone: '8929102099' },
    { ecode: 'E251', first_name: 'Raksha', last_name: 'Sharma', department: 'Operations', designation: 'Front Desk Executive', email: 'sharmaraksha0889@gmail.com', location: 'Indore', reporting_manager_name: 'Dipti Walanj', phone: '9630447704' },
    { ecode: 'E253', first_name: 'Shiddesh', last_name: 'Kumar', department: 'Operations', designation: 'Runner Boy', email: 'shiddesh@gmail.com', location: 'Bangalore', reporting_manager_name: 'Naresh Laxman', phone: '9964690860' },
    { ecode: 'E259', first_name: 'Shreedhar', last_name: 'SP', department: 'Operations', designation: 'Technical Executive', email: 'shridhrsp1994@gmail.com', location: 'Bangalore', reporting_manager_name: 'Kiran Kumar', phone: '9900805204' },
    { ecode: 'E255', first_name: 'Minal', last_name: 'Shirke', department: 'Operations', designation: 'Trainee', email: 'minalshirke0111@gmail.com', location: 'Thane', reporting_manager_name: 'Shailesh Kashyap', phone: '8080981234' },
    { ecode: 'E263', first_name: 'Nikhil', last_name: 'pawar', department: 'Operations', designation: 'Executive', email: 'np63082@gmail.com', location: 'Rabale', reporting_manager_name: 'Shailesh Kashyap', phone: '7700033283' },
    { ecode: 'E260', first_name: 'Harshini', last_name: 'Ranganathan', department: 'Business Development & Growth', designation: 'Executive', email: 'harshinirs27@gmail.com', location: 'Bangalore', reporting_manager_name: 'Manjunath Kalyanpur', phone: '9494608123' },
    { ecode: 'E264', first_name: 'Durga Prasad', last_name: 'Malviya', department: 'Opeartions', designation: 'Executive', email: 'malviyadurgaprasad00@gmail.com', location: 'Indore', reporting_manager_name: 'Dipti Walanj', phone: '7024488745' },
    { ecode: 'E262', first_name: 'Neeti', last_name: 'Upadhyay', department: 'Human Resource', designation: 'Jr HR Executive', email: 'neeti17upadhyay@gmail.com', location: 'Lower Parel', reporting_manager_name: 'Sanil Parab', phone: '9424332575' },
    { ecode: 'I12', first_name: 'Tisha', last_name: 'Rathod', department: 'Business Development & Growth', designation: 'Intern', email: 'tishaarathod25@gmail.com', location: 'Lower Parel', reporting_manager_name: 'Mehul Kiran Kapadia', phone: '9004425481' },
    { ecode: 'E270', first_name: 'Jaseem', last_name: 'Shaikh', department: 'Opeartions', designation: 'Facility Executive', email: 'sheikjaseem97@gmail.com', location: 'Bangalore', reporting_manager_name: 'Naresh Laxman', phone: '9894861098' },
    { ecode: 'E269', first_name: 'Faizur', last_name: 'Abdullah', department: 'Opeartions', designation: 'Pantry Boy', email: 'faizurabdullah660@gmail.com', location: 'Bangalore', reporting_manager_name: 'Naresh Laxman', phone: '6001052019' },
    { ecode: 'E267', first_name: 'Sushant', last_name: 'Shinde', department: 'Human Resource', designation: 'Executive', email: 'shindesushant049@gmail.com', location: 'Lower Parel', reporting_manager_name: 'Sanil Parab', phone: '8652842689' },
    { ecode: 'E258', first_name: 'Ganesh', last_name: 'Bobade', department: 'Operations', designation: 'Housekeeping Supervisor', email: 'ganeshbobade420@gmail.com', location: 'Thane', reporting_manager_name: 'Shailesh Kashyap', phone: '8652275012' },
    { ecode: 'E265', first_name: 'Laxmi', last_name: 'Tondikatti', department: 'Opeartions', designation: 'Housekeeping Supervisor', email: 'stlakshmi32@gmail.com', location: 'Bangalore', reporting_manager_name: 'Naresh Laxman', phone: '8147642637' },
    { ecode: 'E271', first_name: 'Satej', last_name: 'Sadhye', department: 'Procurement', designation: 'Procurement Executive', email: 'satejsadhye210@gmail.com', location: 'Lower Parel', reporting_manager_name: 'Saniel Golechha', phone: '7045149504' },
    { ecode: 'E272', first_name: 'Minal', last_name: 'Shahane', department: 'Marketing', designation: 'Visual Designer', email: 'Minalshahane06@gmail.com', location: 'Lower Parel', reporting_manager_name: 'Nirupam Lahiri', phone: '9619091150' },
    { ecode: 'E273', first_name: 'Paravin', last_name: 'Paru', department: 'Operations', designation: 'Front Office', email: 'paravinparu26@gmail.com', location: 'Bangalore', reporting_manager_name: 'Naresh Laxman', phone: '7676168393' },
    { ecode: 'E274', first_name: 'Partha', last_name: 'Nayek', department: 'Operations', designation: 'Pantry Boy', email: 'parthanayek996@gmail.com', location: 'Bangalore', reporting_manager_name: 'Naresh Laxman', phone: '7003347045' },
    { ecode: 'I13', first_name: 'Veer', last_name: 'Mehta', department: 'Business Development and Growth', designation: 'Intern', email: 'veermehta109@gmail.com', location: 'Lower Parel', reporting_manager_name: 'Saniel Golechha', phone: '8448272042' },
    { ecode: 'E275', first_name: 'Rajesh', last_name: 'Zore', department: 'Design', designation: 'Interior Designer', email: 'rajeshzore98@gmail.com', location: 'Lower Parel', reporting_manager_name: 'Shabbir Hussain', phone: '8108070893' },
    { ecode: 'E276', first_name: 'Gauri', last_name: 'Pise', department: 'Operations', designation: 'Housekeeping Supervisor', email: 'gauripise1509@gmail.com', location: 'Thane', reporting_manager_name: 'Shailesh K', phone: '9321050901' },
    { ecode: 'E277', first_name: 'Manjunath', last_name: 'K', department: 'Operations', designation: 'Facility Executive', email: 'manju.kumar87@gmail.com', location: 'Bangalore', reporting_manager_name: 'Naresh Laxman', phone: '9141788256' },
    { ecode: 'E278', first_name: 'Hemanthraju', last_name: 'D', department: 'Operations', designation: 'Pantry Boy', email: 'hhemanthemant37@gmail.com', location: 'Bangalore', reporting_manager_name: 'Naresh Laxman', phone: '8861874479' },
    { ecode: 'E279', first_name: 'Samuvel', last_name: 'S', department: 'Infrastructure', designation: 'Site Supervisor', email: 'ss9502466@gmail.com', location: 'Bangalore', reporting_manager_name: 'Abhiram', phone: '7806905340' },
    { ecode: 'E280', first_name: 'Anjaniappa', last_name: 'Anji', department: 'Operations', designation: 'Sr Multi Skilled Technician', email: 'anjusandanur@gmail.com', location: 'Bangalore', reporting_manager_name: 'Kiran', phone: '9964835882' },
    { ecode: 'E281', first_name: 'Prajkta', last_name: 'Chavan', department: 'Operations', designation: 'BMS', email: 'prajktachavan902@gmail.com', location: 'Thane', reporting_manager_name: 'Shailesh K', phone: '9594093018' },
    { ecode: 'E282', first_name: 'Harsh', last_name: 'Patil', department: 'Tech', designation: 'Forward Deployment Engineer', email: 'harshrp2309@gmail.com', location: 'Lower Parel', reporting_manager_name: 'Lohitaksha Ranganathan', phone: '7028232515' },
    { ecode: 'E283', first_name: 'Binod', last_name: 'Routh', department: 'Operations', designation: 'Pantry Boy', email: 'routhbinod821@gmail.com', location: 'Bangalore', reporting_manager_name: 'Naresh Laxman', phone: '9641965520' },
    { ecode: 'E284', first_name: 'Anil', last_name: 'Kumar', department: 'Infrastructure', designation: 'Site Supervisor', email: 'anilarmy0071998@gmail.com', location: 'Noida', reporting_manager_name: 'Suraj Harishchandra Nandavadekar', phone: '7503563009' },
    { ecode: 'E285', first_name: 'Pramod', last_name: 'R N', department: 'Opeartions', designation: 'Trainee', email: 'pramodrajagere18@gmail.com', location: 'Bangalore', reporting_manager_name: 'Naresh Laxman', phone: '8073607692' },
    { ecode: 'E286', first_name: 'Priyanka', last_name: 'Pal', department: 'Procurement', designation: 'Executive', email: 'priyanka1304pal@gmail.com', location: 'Lower Parel', reporting_manager_name: 'Saniel Golechha', phone: '' },
    { ecode: 'E288', first_name: 'Aakanksha', last_name: 'Sakpal', department: 'Legal', designation: 'Senior Manager', email: 'aks.sakpal03@gmail.com', location: 'Lower Parel', reporting_manager_name: 'Mehul Kiran Kapadia', phone: '7977193873' },
    { ecode: 'E289', first_name: 'Utpal', last_name: 'Debnath', department: 'Operations', designation: 'Pantry Boy', email: 'kanaidebnath372@gmail.com', location: 'Bangalore', reporting_manager_name: 'Naresh Laxman', phone: '6296734851' }
];

async function seedHR() {
    console.log('Seeding HR categories & 96 employee profiles via Supabase JS client...');

    // 1. Fetch organization ID
    const { data: orgs } = await supabase.from('organizations').select('id').limit(1);
    const orgId = orgs?.[0]?.id || '211e1330-ad83-446d-941f-dcea48396798';

    // 2. Fetch users to match emails
    const { data: users } = await supabase.from('users').select('id, email');
    const userMap = new Map((users || []).map(u => [u.email?.toLowerCase(), u.id]));

    // 3. Upsert Categories
    const categories = [
        { organization_id: orgId, ticket_type: 'grievance', category_name: 'Work Environment', sub_category_name: 'Safety / Ergonomics', first_level_owner_type: 'reporting_manager', l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
        { organization_id: orgId, ticket_type: 'grievance', category_name: 'Role Clarity', sub_category_name: 'Job Description', first_level_owner_type: 'reporting_manager', l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
        { organization_id: orgId, ticket_type: 'grievance', category_name: 'Workload', sub_category_name: 'Overtime / Allocation', first_level_owner_type: 'reporting_manager', l1_sla_days: 3, l2_sla_days: 7, l3_sla_days: 10, l4_sla_days: 12 },
        { organization_id: orgId, ticket_type: 'hr_query', category_name: 'Payroll & Salary', sub_category_name: 'Payslip', first_level_owner_type: 'hr', l1_sla_days: 2, l2_sla_days: 5, l3_sla_days: 8, l4_sla_days: 10 },
        { organization_id: orgId, ticket_type: 'hr_query', category_name: 'Attendance & Leave', sub_category_name: 'Leave Balance', first_level_owner_type: 'hr', l1_sla_days: 2, l2_sla_days: 5, l3_sla_days: 8, l4_sla_days: 10 },
        { organization_id: orgId, ticket_type: 'confidential_feedback', category_name: 'Senior Management Concerns', sub_category_name: 'Whistleblower', first_level_owner_type: 'director', l1_sla_days: 1, l2_sla_days: 3, l3_sla_days: 5, l4_sla_days: 7, is_confidential: true },
        { organization_id: orgId, ticket_type: 'anonymous_feedback', category_name: 'Anonymous Workplace Feedback', sub_category_name: 'General', first_level_owner_type: 'director', l1_sla_days: 1, l2_sla_days: 3, l3_sla_days: 5, l4_sla_days: 7, is_anonymous: true }
    ];

    const { error: catErr } = await supabase.from('hr_ticket_categories').upsert(categories, { onConflict: 'id' });
    console.log('Categories upsert result error:', catErr?.message || 'None');

    // 4. Map & Upsert Employee Profiles
    const profiles = RAW_EMPLOYEES.map(emp => {
        const userId = userMap.get(emp.email?.toLowerCase()) || null;
        const isDirector = emp.ecode === 'E031' || emp.ecode === 'E032' || emp.designation === 'Director';
        const isHR = emp.department?.toLowerCase().includes('human resource');

        return {
            organization_id: orgId,
            user_id: userId,
            employee_code: emp.ecode,
            first_name: emp.first_name,
            last_name: emp.last_name,
            email: emp.email,
            phone: emp.phone,
            department: emp.department,
            designation: emp.designation,
            location: emp.location,
            reporting_manager_code: emp.reporting_manager_name,
            is_director_authority: isDirector,
            is_hr_authority: isHR,
            reconciliation_status: userId ? 'linked' : 'unlinked',
            is_active: true
        };
    });

    const { error: profErr } = await supabase.from('employee_profiles').upsert(profiles, { onConflict: 'organization_id,employee_code' });
    console.log('Employee Profiles upsert result error:', profErr?.message || 'None');
}

seedHR();
