/** Today's date (or any instant's date) in IST as YYYY-MM-DD. The business runs in IST; UTC is a day behind before 05:30. */
export const istDate = (d: Date | string = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
