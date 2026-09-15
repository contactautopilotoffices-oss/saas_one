# 🎨 ROLE-BASED UI & DESIGN SYSTEM RULE

To prevent UI hallucinations, inconsistent colors, and mismatched components across dashboards, ALL UI code MUST adhere to the SaaS One Design System and role-specific color standards.

---

## 1. Core Typography & Aesthetics
- **Headings**: Use `font-black text-slate-900 tracking-tight` (Light) or `font-black text-white tracking-tight` (Dark).
- **Sub-headers & Category Labels**: Always use uppercase tracked text:
  `text-[10px] font-black uppercase tracking-widest text-slate-400`
- **Border Radius**: Heavy friendly rounded corners:
  - Cards: `rounded-2xl` or `rounded-3xl`
  - Modals & Bottom Sheets: `rounded-[2rem]` or `rounded-t-[32px]`
  - Buttons & Input Fields: `rounded-xl`
- **Font Weights**: Heavily leverage `font-black` for titles, metric values, and primary actions.

---

## 2. Role-Specific Color Schemes & Accents

Do NOT invent new random colors. Strictly use the established role theme palettes:

Role / Dashboard | Primary Accent Color | Badge Style | Background Pattern
:--- | :--- | :--- | :---
**Master Admin / Ops Super Admin** | Indigo / Violet (`#6366f1`) | `bg-indigo-500/10 text-indigo-400 border-indigo-500/20` | Dark glassmorphism (`bg-[#0d1117] border-[#21262d]`)
**Org Super Admin** | Emerald / Slate (`#10b981`) | `bg-emerald-500/10 text-emerald-500 border-emerald-500/20` | Clean slate light/dark (`bg-slate-50 dark:bg-[#0d1117]`)
**Property Admin / Site Admin** | Teal / Cyan (`#0d9488`) | `bg-teal-500/10 text-teal-500 border-teal-500/20` | Modern card grid (`bg-white dark:bg-[#161b22]`)
**Staff / MST / Technician** | Blue / Amber (`#3b82f6`) | `bg-blue-500/10 text-blue-500 border-blue-500/20` | Mobile-first sticky bottom bar & compact list
**Tenant / Occupant** | Primary Brand (`#0284c7`) | `bg-sky-500/10 text-sky-500 border-sky-500/20` | Rounded card tiles with soft glows (`shadow-sky-500/10`)
**Procurement Manager** | Purple / Amber (`#8b5cf6`) | `bg-purple-500/10 text-purple-400 border-purple-500/20` | Tabular data grids with status chips
**Food Vendor Partner** | Orange / Amber (`#f97316`) | `bg-orange-500/10 text-orange-500 border-orange-500/20` | POS stat tiles & order badge counters

---

## 3. Standard Interactive Elements

### Primary Action Button
```tsx
className="bg-primary text-white font-black px-5 py-3 rounded-xl shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 active:scale-95 text-xs uppercase tracking-wider"
```

### Secondary Button
```tsx
className="bg-slate-100 text-slate-700 font-bold px-4 py-2.5 rounded-xl hover:bg-slate-200 dark:bg-[#21262d] dark:text-slate-300 dark:border-[#30363d] dark:hover:bg-[#30363d] text-xs"
```

### Status Badge
```tsx
className="px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
```

---

## 4. Visual Verification Rule
- Whenever creating or editing a component, inspect existing sibling components in `frontend/components/dashboard/` to match padding, font sizing, icon styles (`lucide-react`), and dark-mode classes (`dark:bg-[#161b22] dark:border-[#30363d]`).
