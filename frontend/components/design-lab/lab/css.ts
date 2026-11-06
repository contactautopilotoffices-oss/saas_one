/** Lab-wide CSS: focus rings, skeleton shimmer, and fonts that beat the app's global base layer. */
export const LAB_CSS = `
.lab-shell { --lab-bar-h: 100px; }
@media (min-width: 1400px) { .lab-shell { --lab-bar-h: 56px; } }
.lab-root p, .lab-root label, .lab-root button, .lab-root input, .lab-root select { font-family: inherit; }
.lab-root :focus-visible { outline: 2px solid var(--lab-focus); outline-offset: 2px; }
.lab-root label input:focus-visible { outline: none; }
.lab-root label:has(input:focus-visible) { outline: 2px solid var(--lab-focus); outline-offset: 2px; }
.lab-bar :focus-visible { outline: 2px solid #FFFFFF; outline-offset: 2px; }
.lab-skeleton { background: linear-gradient(90deg, var(--lab-skel-a) 0%, var(--lab-skel-b) 50%, var(--lab-skel-a) 100%); background-size: 200% 100%; animation: lab-shimmer 1.4s ease-in-out infinite; }
@keyframes lab-shimmer { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }
@media (prefers-reduced-motion: reduce) { .lab-skeleton { animation: none; } .lab-root * { transition-duration: 0ms !important; } }
.lab-scroll-x { scrollbar-width: none; }
.lab-scroll-x::-webkit-scrollbar { display: none; }
`;
