# UI and CSS Guidelines for SaaS One

## Design Aesthetics
- **Core Principle:** Modern, highly premium SaaS aesthetic.
- **Color Palette:** Avoid generic red/blue. Use curated HSL tokens (e.g. `bg-primary`, `text-text-primary`, `bg-surface`).
- **Dark Mode:** Deep dark modes (`bg-slate-900`, `bg-slate-800` surfaces) with high-contrast text (`text-slate-100`).
- **Glassmorphism:** Use `backdrop-blur-md bg-surface/50` for overlays and sticky headers.
- **Animations:** Subtle micro-animations (e.g. `transition-smooth group-hover:scale-105`) to make the interface feel alive.

## Tailwind Constraints
- Use predefined tokens instead of arbitrary values (use `bg-surface` instead of `bg-white dark:bg-slate-900`).
- Use `rounded-[var(--radius-md)]` or `rounded-2xl` for soft, friendly corners.
- Always implement responsive layouts prioritizing mobile-first (use `lg:flex` etc).

## Components
- Forms and Modals MUST be placed outside of elements that have CSS transforms (like sliding sidebars) to prevent `position: fixed` stacking context bugs.
- Always use Lucide React for icons.
