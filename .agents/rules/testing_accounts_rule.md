# 🧪 Testing Accounts & Test Data Safety Rule

## 🚨 CRITICAL RULE: Designated Testing Account & Explicit Confirmation

1. **NEVER use real employee accounts for testing**:
   - Do NOT use real staff accounts (e.g. `irfan.mulla@worksquare.in`, or any other actual employees).
   - Creating test tickets, tasks, requisitions, or feedback under real accounts triggers actual omnichannel notifications (emails, WhatsApp, SMS) to reporting managers, HR Heads, and directors.

2. **Authorized Test Account**:
   - The designated, safe testing account for this workspace is:
     - **Email**: `mst.ho@gmail.com`
     - **Name**: `mst HO`
     - **User ID**: `5fe04b2c-a77e-4d22-a95f-46836173f9ee`
     - **Employee Code**: `E692`

3. **Mandatory User Confirmation on Testing**:
   - **Whenever the user instructs to "do testing" or "run testing"**:
     - ALWAYS pause and ask the user to confirm:
       *"Which account should I use to create the test tickets/data? (Defaulting to `mst.ho@gmail.com` unless specified otherwise)"*
   - Never proceed with automated creation of tickets under an assumed account without confirmation.

4. **Omnichannel Notification Platform Switch-Off Reminder (MANDATORY)**:
   - **Whenever the user asks to "do regression testing" or create test tickets/comments**:
     - **ALWAYS remind and confirm with the user before triggering tests**:
       *"⚠️ Please ensure you have switched off the Omnichannel notification platform (WhatsApp, Email, SMS) so recipient inboxes do not get flooded with test messages before we run the tests. Have you switched it off and are we good to proceed?"*
     - Never initiate ticket creation or comment generation during regression runs until this reminder has been communicated.
