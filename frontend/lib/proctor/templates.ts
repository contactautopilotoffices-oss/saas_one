// Starter tests HR can load into the "New test" form, edit, and save as their
// own. Nothing here is stored until someone saves it.

import type { ProctorSectionKey } from './sections';

export interface TemplateQuestion {
    section: ProctorSectionKey;
    text: string;
    options: string[];
    answer_index: number;
}

export interface TemplateSection {
    key: string;
    title: string;
    description: string;
}

export interface ProctorTemplate {
    key: string;
    label: string;
    title: string;
    instructions: string;
    duration_minutes: number;
    max_attempts: number;
    sections: TemplateSection[];
    questions: TemplateQuestion[];
}

const OPS_MANAGER: ProctorTemplate = {
    key: 'ops_manager',
    label: 'Ops Manager',
    title: 'Ops Manager — screening assessment',
    instructions:
        '20 questions in four sections: cognitive ability, aptitude, workplace culture and situational judgement. ' +
        'You have 30 minutes. Pick the one best answer for each question. ' +
        'Work the numbers in your head — keep phones, calculators and papers away; the camera flags them.',
    duration_minutes: 30,
    max_attempts: 2,
    sections: [
        { key: 'cognitive', title: 'Cognitive ability', description: 'Reasoning with numbers, patterns and words. No facility knowledge needed.' },
        { key: 'aptitude', title: 'Aptitude', description: 'The arithmetic of running a site: diesel, occupancy, budgets, SLAs.' },
        { key: 'culture', title: 'Workplace culture', description: 'How you work with a team, and what you do when something is not right.' },
        { key: 'situational', title: 'Situational judgement', description: 'Real situations on site. Pick what you would actually do first.' },
    ],
    questions: [
        // ── Cognitive ability ───────────────────────────────────────────────
        {
            section: 'cognitive',
            text: 'What comes next: 3, 7, 15, 31, ?',
            options: ['47', '62', '63', '64'],
            answer_index: 2,
        },
        {
            section: 'cognitive',
            text: 'All HVAC technicians on the team are certified. Some certified staff work night shifts. Which statement must be true?',
            options: [
                'All HVAC technicians work night shifts',
                'Some HVAC technicians work night shifts',
                'No HVAC technician works night shifts',
                'None of the above must be true',
            ],
            answer_index: 3,
        },
        {
            section: 'cognitive',
            text: '4 housekeepers clean a floor in 6 hours. Working at the same pace, how long do 6 housekeepers take?',
            options: ['3 hours', '4 hours', '5 hours', '9 hours'],
            answer_index: 1,
        },
        {
            section: 'cognitive',
            text: 'Invoice is to payment as ticket is to ___',
            options: ['Complaint', 'Technician', 'Resolution', 'Priority'],
            answer_index: 2,
        },
        {
            section: 'cognitive',
            text: 'Today is Wednesday. What day of the week will it be 45 days from today?',
            options: ['Saturday', 'Friday', 'Sunday', 'Monday'],
            answer_index: 0,
        },

        // ── Aptitude ────────────────────────────────────────────────────────
        {
            section: 'aptitude',
            text: 'A DG set uses 18 litres of diesel an hour. A power cut lasts 3.5 hours and diesel costs ₹92 a litre. What does the cut cost in diesel?',
            options: ['₹5,796', '₹5,520', '₹6,440', '₹1,656'],
            answer_index: 0,
        },
        {
            section: 'aptitude',
            text: 'A centre has 240 seats and 198 are occupied. What is the occupancy?',
            options: ['78.5%', '80.0%', '82.5%', '85.0%'],
            answer_index: 2,
        },
        {
            section: 'aptitude',
            text: 'The monthly R&M budget is ₹1,20,000 and ₹1,38,000 was spent. By how much is the site over budget?',
            options: ['13%', '15%', '18%', '12%'],
            answer_index: 1,
        },
        {
            section: 'aptitude',
            text: '40 tickets were raised this week and 34 were closed within SLA. What is the SLA compliance?',
            options: ['80%', '34%', '90%', '85%'],
            answer_index: 3,
        },
        {
            section: 'aptitude',
            text: 'The electricity bill is ₹3,60,000 for a month with 300 occupied seats. What is the electricity cost per occupied seat?',
            options: ['₹1,500', '₹12,000', '₹1,200', '₹1,000'],
            answer_index: 2,
        },

        // ── Workplace culture ───────────────────────────────────────────────
        {
            section: 'culture',
            text: "A housekeeping associate points out, in front of the team, a mistake you made in this week's roster. What is the best response?",
            options: [
                'Tell them to raise such things privately next time',
                'Thank them, fix the roster, and tell the team you want issues raised early like this',
                'Explain why the mistake was not really your fault',
                'Fix it quietly later without mentioning it',
            ],
            answer_index: 1,
        },
        {
            section: 'culture',
            text: 'You find a teammate has been marking PPM checks as done without doing them. What do you do?',
            options: [
                'Nothing — it is their responsibility, not yours',
                'Do the checks yourself and say nothing',
                'Confirm the facts, speak to them directly, and report it to your manager — these are safety checks',
                'Call it out in the team WhatsApp group so everyone learns',
            ],
            answer_index: 2,
        },
        {
            section: 'culture',
            text: 'Which of these best shows ownership in an ops manager?',
            options: [
                'Following up on a client issue until the client confirms it is fixed, even when another team caused it',
                "Making sure your own team's tickets are closed on time",
                'Escalating every issue to your manager quickly',
                'Keeping detailed records of which team caused each problem',
            ],
            answer_index: 0,
        },
        {
            section: 'culture',
            text: 'Head office rolls out a new checklist that adds 20 minutes of paperwork to each shift. Your team is unhappy. What do you do?',
            options: [
                'Tell the team to skip it on busy days',
                'Complain to other managers about head office',
                'Delay rolling it out until someone asks',
                'Roll it out, note exactly where it slows the team down, and send that to head office with a suggested fix',
            ],
            answer_index: 3,
        },
        {
            section: 'culture',
            text: 'Your site passes a client audit with top marks and leadership congratulates you. What do you do?',
            options: [
                'Accept the credit — you are accountable for the site',
                'Name the team members who made it happen when you reply to leadership',
                'Say nothing and move on to the next task',
                'Mention that the audit was easier than usual',
            ],
            answer_index: 1,
        },

        // ── Situational judgement ───────────────────────────────────────────
        {
            section: 'situational',
            text: 'At 9:05 AM a lift stops between floors with people inside. The AMC technician is 90 minutes away. What do you do first?',
            options: [
                'Wait for the AMC technician — only they may touch the lift',
                'Stay in contact with the people inside, start the lift rescue SOP with trained in-house staff, and inform the AMC and the client',
                'Ask the people inside to try forcing the doors open',
                'Post about it in the site WhatsApp group and wait for instructions',
            ],
            answer_index: 1,
        },
        {
            section: 'situational',
            text: 'Two urgent requests arrive together: the boardroom AC is not cooling with a client meeting in 30 minutes, and a washroom tap is leaking. One technician is free. What do you do?',
            options: [
                "Send the technician to the boardroom AC, have housekeeping shut the tap's isolation valve, and give both clients a time for the fix",
                'Handle the leak first — water damage is worse',
                'Handle them in the order the tickets were raised',
                'Ask the boardroom client to move their meeting',
            ],
            answer_index: 0,
        },
        {
            section: 'situational',
            text: 'During a contract renewal, a vendor offers you an expensive personal gift. What do you do?',
            options: [
                'Accept it — it does not change your decision',
                'Accept it and share it with your team',
                "Decline it politely and tell your manager, as the company's gifting policy requires",
                'Ask the vendor for a discount instead',
            ],
            answer_index: 2,
        },
        {
            section: 'situational',
            text: "At month end, one site's diesel consumption is 30% higher than usual, with no extra power cuts logged. What do you do?",
            options: [
                'Approve it — consumption varies',
                'Blame the DG operator and replace them',
                "Ask the vendor to reduce next month's bill",
                'Compare DG run-hour readings with the diesel log, check for leaks or pilferage, and report what you find',
            ],
            answer_index: 3,
        },
        {
            section: 'situational',
            text: 'A client complains loudly in the lobby about repeated cleaning lapses on their floor. What do you do?',
            options: [
                'Ask them to email the complaint so it is on record',
                'Listen, apologise, take the specifics, agree a fix with a date, and come back with proof it was done',
                'Explain that housekeeping is short-staffed this month',
                'Promise it will never happen again',
            ],
            answer_index: 1,
        },
    ],
};

export const PROCTOR_TEMPLATES: ProctorTemplate[] = [OPS_MANAGER];
