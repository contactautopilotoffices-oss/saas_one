import React, { useState, useEffect, useRef } from 'react';
import { 
  Calculator, Building, Users, TrendingUp, DollarSign, Clock, 
  Briefcase, Target, Percent, Save, FileText, ChevronDown, Calendar, User,
  Layout, Upload, Maximize, Activity, BarChart3, PieChart, ShieldAlert, BadgePercent, Coins, LineChart, Zap,
  Info, Lock, Settings2
} from 'lucide-react';

// --- CUSTOM SVG VISUALIZATION COMPONENTS ---

const DonutChart = ({ data }) => {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  let cumulativePercent = 0;
  const total = data.reduce((sum, item) => sum + item.value, 0) || 1;

  return (
    <div className="relative w-48 h-48 flex items-center justify-center">
      <svg viewBox="0 0 100 100" className="w-full h-full transform -rotate-90">
        {data.map((item, i) => {
          const percent = item.value / total;
          const dash = percent * circumference;
          const gap = circumference - dash;
          const offset = cumulativePercent * circumference;
          cumulativePercent += percent;
          
          return (
            <circle
              key={i}
              cx="50" cy="50" r={radius}
              fill="transparent"
              stroke={item.color}
              strokeWidth="12"
              strokeDasharray={`${dash} ${gap}`}
              strokeDashoffset={-offset}
              className="transition-all duration-500 ease-out drop-shadow-md"
            />
          );
        })}
      </svg>
      {/* Center Label */}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-xs text-zinc-400 font-bold tracking-widest uppercase">Total Cost</span>
        <span className="text-sm font-black text-white mt-1 leading-none">100%</span>
      </div>
    </div>
  );
};

const TCVAreaChart = ({ termMonths, sellingPrice, annualEscalation }) => {
  // Generate points for the chart
  const points = [];
  let currentPrice = sellingPrice;
  const maxPrice = sellingPrice * Math.pow(1 + (annualEscalation / 100), Math.floor(termMonths / 12));
  
  for (let i = 0; i <= termMonths; i++) {
    if (i > 0 && i % 12 === 0) currentPrice *= (1 + (annualEscalation / 100));
    points.push({ x: i, y: currentPrice });
  }

  const width = 300;
  const height = 100;
  
  // Create SVG path
  let path = `M 0 ${height} `;
  let linePath = `M 0 ${height - ((points[0]?.y || 0) / (maxPrice || 1)) * height} `;
  
  points.forEach((p, i) => {
    const xPos = (p.x / termMonths) * width;
    const yPos = height - ((p.y / (maxPrice || 1)) * height * 0.8) - 10; // 0.8 for padding
    path += `L ${xPos} ${yPos} `;
    if (i > 0) linePath += `L ${xPos} ${yPos} `;
  });
  
  path += `L ${width} ${height} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-24 mt-2 overflow-visible">
      <defs>
        <linearGradient id="tcvGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#818cf8" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#818cf8" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={path} fill="url(#tcvGradient)" className="transition-all duration-300" />
      <path d={linePath} fill="none" stroke="#818cf8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="transition-all duration-300 drop-shadow-[0_0_8px_rgba(129,140,248,0.5)]" />
    </svg>
  );
};

// --- INFO TOOLTIP HELPER ---
const InfoIcon = ({ text }) => (
  <div className="group/hud relative inline-block ml-1">
    <Info size={12} className="text-zinc-500 hover:text-indigo-400 cursor-help transition-colors" />
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/hud:block w-48 p-2 bg-zinc-100 text-zinc-900 text-[10px] font-bold normal-case rounded shadow-xl z-50 text-center pointer-events-none">
      {text}
    </div>
  </div>
);

// --- INPUT COMPONENT ---
const InputGroup = ({ label, value, paramKey, onChange, icon: Icon, type = "text", suffix = "", info, readOnly }) => (
  <div className="flex flex-col space-y-1.5 relative group">
    <label className="text-[10px] font-bold text-zinc-500 flex items-center gap-1.5 uppercase tracking-wider">
      <Icon size={12} className="text-zinc-400 group-hover:text-indigo-500 transition-colors" />
      {label}
      {info && (
        <div className="group/tooltip relative inline-block">
          <Info size={12} className="text-zinc-400 hover:text-indigo-500 cursor-help" />
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/tooltip:block w-48 p-2 bg-zinc-800 text-white text-[10px] font-normal normal-case rounded shadow-lg z-50 text-center pointer-events-none">
            {info}
          </div>
        </div>
      )}
    </label>
    <div className="relative">
      <input
        type={type}
        inputMode="decimal"
        value={value}
        onChange={readOnly ? undefined : (e) => onChange(paramKey, e.target.value)}
        readOnly={readOnly}
        className={`w-full pl-3 pr-12 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all text-sm font-bold ${readOnly ? 'bg-zinc-100 border-zinc-200 text-zinc-500 cursor-not-allowed' : 'bg-white border-zinc-200 text-zinc-900 shadow-sm'}`}
      />
      {suffix && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 text-[10px] font-bold pointer-events-none flex items-center gap-1">
          {readOnly && <Lock size={10} />} {suffix}
        </span>
      )}
    </div>
  </div>
);

// --- MAIN APP ---
export default function App() {
  // Deal Metadata
  const [dealInfo, setDealInfo] = useState({
    dealName: 'Project Titan',
    clientName: 'Global Tech Corp',
    date: new Date().toISOString().split('T')[0]
  });

  // Consolidated Parameter State (Strings to preserve typing)
  const [params, setParams] = useState({
    termMonths: "60", lockInMonths: "60", annualEscalation: "5",  
    wacc: "12", makeGoodSqft: "50",
    rentFreeLandlord: "0", rentFreeClient: "0", opexEscalation: "5",
    builtUpArea: "15600", carpetArea: "11700",
    rentPerSqft: "50", capexPerSqft: "1800", capexTenure: "60",
    pricingMode: "Margin", // 'Margin' or 'Target'
    targetSellingPrice: "15000",
    seatsMode: "Known", // 'Known' or 'Auto'
    targetDensity: "45",
    readyFunds: "0", 
    depositType: "Mos", 
    landlordDepositValue: "0", clientDepositValue: "0",
    marginPercent: "12.5", seats: "600", clientBudget: "15000", brokerageMonths: "1",
    clientDepositMonths: "5", landlordDepositMonths: "5",
    useDetailedOpex: true, opexPerSqft: "62",
    detailedOpex: {
      electricity: "312000", housekeeping: "247000", security: "102000", internet: "50000",
      pantry: "105750", maintenance: "54499", adminMisc: "95000"
    }
  });

  // Standardized Institutional Metrics (Point 6 & 8)
  const STANDARD_ROI = 12.0;
  const STANDARD_SALVAGE = 10.0;

  // Derived Results State
  const [results, setResults] = useState({
    totalRent: 0, actualMonthlyRent: 0, totalCapex: 0, capexEMI: 0, brokerageAmortization: 0, monthlyDepositOpportunityCost: 0,
    totalOpex: 0, derivedOpexPerSqft: 0, totalCost: 0, marginAmount: 0, sellingPrice: 0,
    baseCostPerSeat: 0, perSeatCost: 0, efficiency: 0, seatDensity: 0, initialCashflow: 0,
    totalLandlordDeposit: 0, totalClientDeposit: 0, tcv: 0, capexPaybackMonths: 0, netFreeCashFlow: 0,
    npv: 0, yieldOnCost: 0, breakEvenOccupancy: 0, cashOnCash: 0, salvageAmount: 0, totalMakeGood: 0,
    finalSeats: 0, debtAmount: 0, serviceFeePerSeat: 0, marginPercent: 0
  });

  // Core Financial Engine
  useEffect(() => {
    const num = (val) => Number(val) || 0;

    const termMonths = num(params.termMonths); const lockInMonths = num(params.lockInMonths);
    const annualEscalation = num(params.annualEscalation); const wacc = num(params.wacc);
    const opexEscalation = num(params.opexEscalation); const makeGoodSqft = num(params.makeGoodSqft);
    const rentFreeLandlord = num(params.rentFreeLandlord); const rentFreeClient = num(params.rentFreeClient);
    const builtUpArea = num(params.builtUpArea); const carpetArea = num(params.carpetArea);
    const rentPerSqft = num(params.rentPerSqft); const capexPerSqft = num(params.capexPerSqft);
    const capexTenure = num(params.capexTenure); const readyFunds = num(params.readyFunds);
    const brokerageMonths = num(params.brokerageMonths); 
    const opexPerSqft = num(params.opexPerSqft);

    // Dynamic Seats calculation based on layout
    let finalSeats = num(params.seats);
    if (params.seatsMode === 'Auto') {
        finalSeats = Math.floor(carpetArea / (num(params.targetDensity) || 45));
    }

    // 1. Direct Costs & Amortized Rent
    const actualMonthlyRent = rentPerSqft * builtUpArea;
    const totalRentPaid = actualMonthlyRent * Math.max(0, termMonths - rentFreeLandlord);
    const totalRent = termMonths > 0 ? totalRentPaid / termMonths : 0; // Effective amortized rent
    const totalCapex = capexPerSqft * builtUpArea;

    // 2. Opex
    let totalOpex = 0; let derivedOpexPerSqft = opexPerSqft;
    if (params.useDetailedOpex) {
      totalOpex = Object.values(params.detailedOpex).reduce((sum, val) => sum + num(val), 0);
      derivedOpexPerSqft = builtUpArea > 0 ? totalOpex / builtUpArea : 0;
    } else {
      totalOpex = opexPerSqft * builtUpArea;
    }

    // 3. Debt (EMI) & Equity Adjustments
    const debtAmount = Math.max(0, totalCapex - readyFunds);
    const monthlyROI = (STANDARD_ROI / 100) / 12;
    
    const debtEMI = (monthlyROI > 0 && capexTenure > 0)
      ? debtAmount * (monthlyROI * Math.pow(1 + monthlyROI, capexTenure)) / (Math.pow(1 + monthlyROI, capexTenure) - 1)
      : (capexTenure > 0 ? debtAmount / capexTenure : 0);
      
    // Straight-line amortize the ready funds across the tenure without interest
    const equityAmortization = capexTenure > 0 ? (Math.min(readyFunds, totalCapex) / capexTenure) : 0;
    const capexEMI = debtEMI + equityAmortization;
    
    // 4. Deal Structuring Amortizations
    const totalBrokerage = actualMonthlyRent * brokerageMonths;
    const brokerageAmortization = lockInMonths > 0 ? totalBrokerage / lockInMonths : 0;

    // 5. Opportunity Cost
    let totalLandlordDeposit = 0; let totalClientDeposit = 0;
    if (params.depositType === 'Mos') {
        totalLandlordDeposit = actualMonthlyRent * num(params.landlordDepositMonths);
        totalClientDeposit = actualMonthlyRent * num(params.clientDepositMonths);
    } else {
        totalLandlordDeposit = num(params.landlordDepositValue);
        totalClientDeposit = num(params.clientDepositValue);
    }
    
    const netDepositLocked = Math.max(0, totalLandlordDeposit - totalClientDeposit);
    const monthlyDepositOpportunityCost = (netDepositLocked * (STANDARD_ROI / 100)) / 12;
    
    // 6. Layout Physics
    const efficiency = builtUpArea > 0 ? (carpetArea / builtUpArea) * 100 : 0;
    const seatDensity = finalSeats > 0 ? carpetArea / finalSeats : 0;

    // 7. Pricing Math (Progressive vs Regressive)
    const totalCost = totalRent + capexEMI + totalOpex + brokerageAmortization + monthlyDepositOpportunityCost;
    let sellingPrice = 0; let marginAmount = 0; let marginPercent = 0;
    
    if (params.pricingMode === 'Margin') {
        marginPercent = num(params.marginPercent);
        marginAmount = totalCost * (marginPercent / 100);
        sellingPrice = totalCost + marginAmount;
    } else {
        // Regressive Target Pricing
        sellingPrice = num(params.targetSellingPrice) * finalSeats;
        marginAmount = sellingPrice - totalCost;
        marginPercent = totalCost > 0 ? (marginAmount / totalCost) * 100 : 0;
    }
    
    const baseCostPerSeat = finalSeats > 0 ? totalCost / finalSeats : 0;
    const perSeatCost = finalSeats > 0 ? sellingPrice / finalSeats : 0;
    const serviceFeePerSeat = finalSeats > 0 ? marginAmount / finalSeats : 0;

    // 8. Base Cashflow Math
    const initialCashflow = -totalCapex - totalLandlordDeposit + totalClientDeposit;
    const netFreeCashFlow = sellingPrice - totalRent - totalOpex - capexEMI;
    const actualCashYield = sellingPrice - totalRent - totalOpex; 
    const capexPaybackMonths = actualCashYield > 0 ? totalCapex / actualCashYield : 0;

    // 9. PhD LEVEL VALUATION ENGINE
    const salvageAmount = totalCapex * (STANDARD_SALVAGE / 100);
    const totalMakeGood = makeGoodSqft * builtUpArea;
    
    const monthlyNOI = sellingPrice - totalRent - totalOpex;
    const yieldOnCost = totalCapex > 0 ? ((monthlyNOI * 12) / totalCapex) * 100 : 0;
    const initialInvestment = Math.max(0, Math.abs(initialCashflow));
    const cashOnCash = initialInvestment > 0 ? ((netFreeCashFlow * 12) / initialInvestment) * 100 : 0;
    const fixedCashCosts = totalRent + totalOpex + capexEMI;
    const breakEvenSeats = perSeatCost > 0 ? fixedCashCosts / perSeatCost : 0;
    const breakEvenOccupancy = finalSeats > 0 ? (breakEvenSeats / finalSeats) * 100 : 0;

    let tcv = 0; let npv = initialCashflow;
    const monthlyDiscountRate = wacc / 100 / 12;

    for (let m = 1; m <= termMonths; m++) {
        let yearsPassed = Math.floor((m - 1) / 12);
        let escalatedRevenue = (m <= rentFreeClient) ? 0 : sellingPrice * Math.pow(1 + (annualEscalation / 100), yearsPassed);
        tcv += escalatedRevenue;
        
        let escalatedOpex = totalOpex * Math.pow(1 + (opexEscalation / 100), yearsPassed);
        let currentRentOutflow = (m <= rentFreeLandlord) ? 0 : actualMonthlyRent;
        
        let cf = escalatedRevenue - currentRentOutflow - escalatedOpex - capexEMI;
        if (m === termMonths) cf += salvageAmount - totalMakeGood + totalLandlordDeposit - totalClientDeposit;
        
        npv += (monthlyDiscountRate > 0) ? cf / Math.pow(1 + monthlyDiscountRate, m) : cf;
    }

    setResults({
      totalRent, actualMonthlyRent, totalCapex, capexEMI, brokerageAmortization, monthlyDepositOpportunityCost,
      totalOpex, derivedOpexPerSqft, totalCost, marginAmount, sellingPrice,
      baseCostPerSeat, perSeatCost, efficiency, seatDensity, initialCashflow,
      totalLandlordDeposit, totalClientDeposit, tcv, capexPaybackMonths, netFreeCashFlow,
      npv, yieldOnCost, breakEvenOccupancy, cashOnCash, salvageAmount, totalMakeGood,
      finalSeats, debtAmount, serviceFeePerSeat, marginPercent
    });
  }, [params]);

  // Handlers
  const updateParam = (key, value) => {
    if (typeof key === 'boolean') return;
    if (key === 'useDetailedOpex') { setParams(prev => ({ ...prev, [key]: value })); return; } 
    if (key.includes('.')) {
       const [parent, child] = key.split('.');
       setParams(prev => ({ ...prev, [parent]: { ...prev[parent], [child]: value } }));
    } else { setParams(prev => ({ ...prev, [key]: value })); }
  };

  const formatCurrency = (num) => {
    if (isNaN(num) || num === Infinity || num === -Infinity) return "0";
    if (Math.abs(num) >= 10000000) return `₹ ${(num / 10000000).toFixed(2)} Cr`;
    if (Math.abs(num) >= 100000) return `₹ ${(num / 100000).toFixed(2)} L`;
    return `₹ ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(num)}`;
  };
  
  const formatStandard = (num) => {
    return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(num || 0);
  }

  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-zinc-50 font-sans selection:bg-indigo-500 selection:text-white">
      
      {/* ========================================================= */}
      {/* COCKPIT : LEFT COLUMN (Data Entry) */}
      {/* ========================================================= */}
      <div className="w-full lg:w-[60%] xl:w-[65%] p-4 sm:p-8 overflow-y-auto custom-scrollbar">
        
        {/* Header */}
        <div className="flex justify-between items-end border-b border-zinc-200 pb-6 mb-8">
          <div>
            <div className="flex items-center gap-2 text-indigo-600 mb-1">
              <Zap size={16} className="fill-indigo-600"/>
              <span className="text-[10px] font-black tracking-widest uppercase">Alpha Engine</span>
            </div>
            <h1 className="text-3xl font-black text-zinc-900 tracking-tight leading-none">Enterprise Pricing Modeler</h1>
          </div>
          <button onClick={() => window.print()} className="hidden sm:flex items-center gap-2 text-xs font-bold text-zinc-500 hover:text-zinc-900 transition-colors">
            <FileText size={14}/> EXPORT
          </button>
        </div>

        <div className="space-y-8 max-w-4xl mx-auto pb-20">
          
          {/* SECTION 1: Physics & Layout */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-zinc-100 relative overflow-hidden group hover:shadow-md transition-all">
            <div className="absolute top-0 left-0 w-1 h-full bg-blue-500 rounded-l-2xl"></div>
            <h2 className="text-xs font-black text-zinc-800 uppercase tracking-widest mb-5 flex items-center gap-2">
              <Layout size={14} className="text-blue-500"/> Physical Asset & Timeline
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <InputGroup label="Built-Up Area" value={params.builtUpArea} paramKey="builtUpArea" onChange={updateParam} icon={Building} suffix="Sq.ft" />
              <InputGroup label="Carpet Area" value={params.carpetArea} paramKey="carpetArea" onChange={updateParam} icon={Maximize} suffix="Sq.ft" />
              <InputGroup label="Tenure" value={params.termMonths} paramKey="termMonths" onChange={updateParam} icon={Clock} suffix="Mos" />
              <InputGroup label="Lock-in" value={params.lockInMonths} paramKey="lockInMonths" onChange={updateParam} icon={Clock} suffix="Mos" />
            </div>
            
            <div className="mt-5 bg-zinc-50 rounded-xl p-4 border border-zinc-100">
              <div className="flex justify-between items-center mb-4">
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Billable Seats Setup</span>
                <div className="flex bg-zinc-200 rounded p-0.5">
                   <button onClick={() => updateParam('seatsMode', 'Known')} className={`px-2 py-1 text-[9px] font-bold rounded transition-colors ${params.seatsMode === 'Known' ? 'bg-white shadow text-indigo-600' : 'text-zinc-500'}`}>Known Target</button>
                   <button onClick={() => updateParam('seatsMode', 'Auto')} className={`px-2 py-1 text-[9px] font-bold rounded transition-colors ${params.seatsMode === 'Auto' ? 'bg-white shadow text-indigo-600' : 'text-zinc-500'}`}>Auto-Density</button>
                </div>
              </div>
              
              <div className="flex flex-col sm:flex-row gap-6 items-center">
                <div className="w-full sm:w-48">
                   {params.seatsMode === 'Known' ? (
                     <InputGroup label="Manual Seats" value={params.seats} paramKey="seats" onChange={updateParam} icon={Users} suffix="Seats" />
                   ) : (
                     <InputGroup label="Target Density" value={params.targetDensity} paramKey="targetDensity" onChange={updateParam} icon={Maximize} suffix="Sq.ft/Seat" info="Automatically calculates maximum seats by dividing Carpet Area by this target density." />
                   )}
                </div>
                <div className="flex w-full justify-around sm:justify-start gap-8 sm:border-l sm:border-zinc-200 sm:pl-6">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Final Seats</span>
                    <span className="text-xl font-black text-indigo-600">{results.finalSeats}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Efficiency</span>
                    <span className="text-xl font-black text-zinc-800">{results.efficiency.toFixed(1)}%</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Density</span>
                    <span className="text-xl font-black text-zinc-800">{results.seatDensity.toFixed(1)} <span className="text-xs font-semibold text-zinc-500">sq.ft/p</span></span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 2: Economics Matrix */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-zinc-100 relative overflow-hidden group hover:shadow-md transition-all">
            <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500 rounded-l-2xl"></div>
            <h2 className="text-xs font-black text-zinc-800 uppercase tracking-widest mb-5 flex items-center gap-2">
              <DollarSign size={14} className="text-emerald-500"/> Economics Matrix
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Opex Sub-Panel */}
              <div className="space-y-4">
                <div className="flex justify-between items-center border-b border-zinc-100 pb-2">
                  <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Operational (Opex)</span>
                  <label className="flex items-center cursor-pointer">
                    <span className="mr-2 text-[10px] font-bold text-zinc-500">{params.useDetailedOpex ? 'Itemized' : 'Flat'}</span>
                    <div className="relative">
                      <input type="checkbox" className="sr-only" checked={params.useDetailedOpex} onChange={e => updateParam('useDetailedOpex', e.target.checked)} />
                      <div className={`block w-7 h-4 rounded-full transition-colors ${params.useDetailedOpex ? 'bg-emerald-500' : 'bg-zinc-300'}`}></div>
                      <div className={`dot absolute left-1 top-1 bg-white w-2 h-2 rounded-full transition-transform ${params.useDetailedOpex ? 'transform translate-x-3' : ''}`}></div>
                    </div>
                  </label>
                </div>
                {!params.useDetailedOpex ? (
                  <InputGroup label="Flat Opex Rate" value={params.opexPerSqft} paramKey="opexPerSqft" onChange={updateParam} icon={DollarSign} suffix="₹/sqft" />
                ) : (
                  <div className="grid grid-cols-2 gap-3 bg-emerald-50/50 p-3 rounded-xl border border-emerald-100/50">
                    <InputGroup label="Electricity" value={params.detailedOpex.electricity} paramKey="detailedOpex.electricity" onChange={updateParam} icon={Activity} />
                    <InputGroup label="Housekeeping" value={params.detailedOpex.housekeeping} paramKey="detailedOpex.housekeeping" onChange={updateParam} icon={Users} />
                    <InputGroup label="Security" value={params.detailedOpex.security} paramKey="detailedOpex.security" onChange={updateParam} icon={ShieldAlert} />
                    <InputGroup label="Internet" value={params.detailedOpex.internet} paramKey="detailedOpex.internet" onChange={updateParam} icon={Activity} />
                    <InputGroup label="Pantry" value={params.detailedOpex.pantry} paramKey="detailedOpex.pantry" onChange={updateParam} icon={Activity} />
                    <InputGroup label="Maintenance" value={params.detailedOpex.maintenance} paramKey="detailedOpex.maintenance" onChange={updateParam} icon={Briefcase} />
                    <InputGroup label="Admin/Misc" value={params.detailedOpex.adminMisc} paramKey="detailedOpex.adminMisc" onChange={updateParam} icon={Briefcase} />
                    <div className="col-span-2 pt-2 flex justify-between items-center border-t border-emerald-200/50 mt-1">
                      <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest bg-emerald-100 px-2 py-1 rounded">Total: ₹ {formatStandard(results.totalOpex)} / mo</span>
                      <span className="text-sm font-black text-zinc-900">₹{results.derivedOpexPerSqft?.toFixed(2)} / sqft</span>
                    </div>
                  </div>
                )}
                
                <div className="border-b border-zinc-100 pb-2 mt-6 mb-3"><span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Base Real Estate</span></div>
                <div className="grid grid-cols-2 gap-4">
                  <InputGroup label="Rent Rate" value={params.rentPerSqft} paramKey="rentPerSqft" onChange={updateParam} icon={Building} suffix="₹/sqft" />
                  <InputGroup label="LL Rent-Free" value={params.rentFreeLandlord} paramKey="rentFreeLandlord" onChange={updateParam} icon={Building} suffix="Mos" info="Amortizes standard rent over the term minus rent-free periods to lower your baseline unit cost." />
                  <div className="col-span-2">
                     <InputGroup label="Annual Escalation" value={params.annualEscalation} paramKey="annualEscalation" onChange={updateParam} icon={TrendingUp} suffix="% p.a." />
                  </div>
                </div>
              </div>

              {/* Capex & Debt Sub-Panel */}
              <div className="space-y-4">
                <div className="border-b border-zinc-100 pb-2 flex justify-between">
                   <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Capex & Funding</span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                   <InputGroup label="Capex Rate" value={params.capexPerSqft} paramKey="capexPerSqft" onChange={updateParam} icon={DollarSign} suffix="₹/sqft" />
                   <InputGroup label="Ready Funds (Eq)" value={params.readyFunds} paramKey="readyFunds" onChange={updateParam} icon={Coins} suffix="₹" info="Self-funded equity. Interest is only charged on the excess balance." />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <InputGroup label="Capex ROI" value={STANDARD_ROI} paramKey="none" onChange={()=>{}} icon={Percent} suffix="% p.a." readOnly={true} info="Institutional standardized interest rate for debt portion." />
                  <InputGroup label="Tenure" value={params.capexTenure} paramKey="capexTenure" onChange={updateParam} icon={Clock} suffix="Mos" />
                </div>
                <div className="bg-orange-50/50 p-3 rounded-xl border border-orange-100 mt-2 flex justify-between items-center">
                  <span className="text-[10px] font-black text-orange-600 uppercase tracking-widest flex items-center gap-1">EMI + Eq. Amort <InfoIcon text="Combination of Debt EMI plus straight-line amortization of ready equity funds." /></span>
                  <span className="text-sm font-black text-orange-900">₹ {formatStandard(results.capexEMI)}</span>
                </div>

                <div className="border-b border-zinc-100 pb-2 mt-6 mb-3 flex justify-between items-end">
                   <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Deal Mechanics</span>
                   <div className="flex bg-zinc-100 rounded p-0.5">
                     <button onClick={() => updateParam('depositType', 'Mos')} className={`px-2 py-0.5 text-[9px] font-bold rounded transition-colors ${params.depositType === 'Mos' ? 'bg-white shadow text-indigo-600' : 'text-zinc-400'}`}>Months</button>
                     <button onClick={() => updateParam('depositType', '₹')} className={`px-2 py-0.5 text-[9px] font-bold rounded transition-colors ${params.depositType === '₹' ? 'bg-white shadow text-indigo-600' : 'text-zinc-400'}`}>Value (₹)</button>
                   </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                   {params.depositType === 'Mos' ? (
                     <>
                       <InputGroup label="Client Dep." value={params.clientDepositMonths} paramKey="clientDepositMonths" onChange={updateParam} icon={Building} suffix="Mos" />
                       <InputGroup label="Landlord Dep." value={params.landlordDepositMonths} paramKey="landlordDepositMonths" onChange={updateParam} icon={Building} suffix="Mos" />
                     </>
                   ) : (
                     <>
                       <InputGroup label="Client Dep. (₹)" value={params.clientDepositValue} paramKey="clientDepositValue" onChange={updateParam} icon={DollarSign} />
                       <InputGroup label="Landlord Dep. (₹)" value={params.landlordDepositValue} paramKey="landlordDepositValue" onChange={updateParam} icon={DollarSign} />
                     </>
                   )}
                   <div className="col-span-2"><InputGroup label="Brokerage Fee" value={params.brokerageMonths} paramKey="brokerageMonths" onChange={updateParam} icon={Briefcase} suffix="Mos Rent" /></div>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 3: Strategy & Valuation */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-zinc-100 relative overflow-hidden group hover:shadow-md transition-all">
            <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500 rounded-l-2xl"></div>
            <h2 className="text-xs font-black text-zinc-800 uppercase tracking-widest mb-5 flex items-center gap-2">
              <Target size={14} className="text-indigo-500"/> Alpha Strategy & Valuation
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
              {/* Target & Budget */}
              <div className="space-y-5 bg-zinc-50 p-5 rounded-xl border border-zinc-100">
                <div className="flex justify-between items-center mb-2">
                   <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Pricing Strategy</span>
                   <div className="flex bg-zinc-200 rounded p-0.5">
                     <button onClick={() => updateParam('pricingMode', 'Margin')} className={`px-2 py-1 text-[9px] font-bold rounded transition-colors ${params.pricingMode === 'Margin' ? 'bg-white shadow text-indigo-600' : 'text-zinc-500'}`}>Progressive (Cost+)</button>
                     <button onClick={() => updateParam('pricingMode', 'Target')} className={`px-2 py-1 text-[9px] font-bold rounded transition-colors ${params.pricingMode === 'Target' ? 'bg-white shadow text-indigo-600' : 'text-zinc-500'}`}>Regressive (Target)</button>
                   </div>
                </div>
                
                {params.pricingMode === 'Margin' ? (
                  <div>
                    <div className="flex justify-between mb-2">
                      <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Target Margin Markup</span>
                      <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">{results.marginPercent.toFixed(2)}%</span>
                    </div>
                    <input 
                      type="range" min="0" max="50" step="0.5"
                      value={Number(params.marginPercent) || 0} 
                      onChange={(e) => updateParam('marginPercent', e.target.value)}
                      className="w-full h-2 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                    />
                  </div>
                ) : (
                  <InputGroup label="Target Final Price / Seat" value={params.targetSellingPrice} paramKey="targetSellingPrice" onChange={updateParam} icon={Target} suffix="₹" info="Enter client's desired static seat budget to reverse-calculate your margin capability." />
                )}
                
                <div className="flex justify-between items-end border-t border-zinc-200 pt-3">
                  <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest flex items-center gap-1">Implied WS Fee <InfoIcon text="Calculated service fee absolute value based on your strategy." /></span>
                  <span className={`font-black text-lg ${results.marginAmount < 0 ? 'text-red-500' : 'text-indigo-600'}`}>
                    {results.marginAmount < 0 ? '-' : ''}₹ {formatStandard(Math.abs(results.marginAmount))} <span className="text-xs font-semibold opacity-70">/mo</span>
                  </span>
                </div>
              </div>

              {/* PhD Metrics Input */}
              <div className="space-y-4">
                 <div className="border-b border-zinc-100 pb-2 flex justify-between items-end">
                    <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Valuation & Concessions</span>
                 </div>
                 
                 <InputGroup label="Terminal Salvage" value={STANDARD_SALVAGE} paramKey="none" onChange={()=>{}} icon={Coins} suffix="% Capex" readOnly={true} info="Standardized end-of-life residual salvage value for DCF modeling." />

                 <div className="grid grid-cols-2 gap-4">
                   <InputGroup label="Client Rent-Free" value={params.rentFreeClient} paramKey="rentFreeClient" onChange={updateParam} icon={Users} suffix="Mos" info="Reduces total contract value and delays revenue realization in DCF." />
                   <InputGroup label="Dilapidation" value={params.makeGoodSqft} paramKey="makeGoodSqft" onChange={updateParam} icon={ShieldAlert} suffix="₹/sqft" />
                   <InputGroup label="Opex Esc." value={params.opexEscalation} paramKey="opexEscalation" onChange={updateParam} icon={TrendingUp} suffix="% p.a." />
                   <InputGroup label="Cost of Capital" value={params.wacc} paramKey="wacc" onChange={updateParam} icon={PieChart} suffix="%" />
                 </div>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* ========================================================= */}
      {/* HUD : RIGHT COLUMN (Analytics Dashboard - Fixed) */}
      {/* ========================================================= */}
      <div className="w-full lg:w-[40%] xl:w-[35%] bg-zinc-950 text-white lg:fixed lg:right-0 lg:h-screen overflow-y-auto custom-scrollbar shadow-[-20px_0_40px_rgba(0,0,0,0.3)]">
        <div className="p-6 sm:p-8 space-y-8 relative">
          
          {/* Ambient Glow */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-[100px] pointer-events-none"></div>

          {/* Primary Metric - Final Price */}
          <div className="relative z-10">
            <div className="flex justify-between items-start mb-2">
              <h2 className="text-[10px] text-zinc-400 font-black uppercase tracking-widest">Alpha Quoted Price</h2>
              {Number(params.clientBudget) > 0 && (
                <div className={`px-2 py-1 rounded text-[9px] font-black tracking-widest border ${results.perSeatCost <= Number(params.clientBudget) ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                  {results.perSeatCost <= Number(params.clientBudget) ? '✓ WITHIN BUDGET' : '⚠ OVER BUDGET'}
                </div>
              )}
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-light text-zinc-500">₹</span>
              <span className="text-6xl font-black tracking-tighter text-white">{formatStandard(results.perSeatCost)}</span>
            </div>
            <div className="text-xs font-bold text-zinc-500 mt-1 uppercase tracking-wider">Per Seat / Month (Year 1)</div>

            {/* Financial Summary */}
            <div className="mt-6 p-6 bg-slate-800/80 rounded-xl space-y-4 text-sm border border-slate-700/50">
              <div className="flex justify-between items-center pb-3 border-b border-slate-700/50">
                <span className="text-slate-400 font-semibold tracking-wide">Base Cost to Me</span>
                <span className="font-bold text-lg">₹ {formatStandard(results.baseCostPerSeat)} <span className="text-xs text-slate-500">/seat</span></span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b border-slate-700/50">
                <span className="text-slate-400 font-semibold tracking-wide flex items-center gap-1">Service Fee <InfoIcon text={`Calculated Service Fee = ${results.marginPercent.toFixed(1)}% Margin`} /></span>
                <span className={`font-bold ${results.serviceFeePerSeat < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  {results.serviceFeePerSeat < 0 ? '-' : '+'} ₹ {formatStandard(Math.abs(results.serviceFeePerSeat))} <span className="text-xs opacity-50">/seat</span>
                </span>
              </div>
              <div className="flex justify-between items-center pt-2">
                <span className="text-slate-300 font-black uppercase tracking-wider text-xs">Final Quoted Price</span>
                <span className="font-black text-2xl text-white">₹ {formatStandard(results.perSeatCost)}</span>
              </div>
            </div>
          </div>

          {/* Institutional Data Cards Matrix */}
          <div className="grid grid-cols-2 gap-3 relative z-10">
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 backdrop-blur-sm">
              <div className="text-[9px] text-indigo-300 font-black uppercase tracking-widest mb-1 flex items-center gap-1.5"><LineChart size={10}/> NPV (Discounted)</div>
              <div className={`text-xl font-black tracking-tight ${results.npv >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {results.npv < 0 ? '-' : '+'} {formatCurrency(Math.abs(results.npv))}
              </div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 backdrop-blur-sm">
              <div className="text-[9px] text-indigo-300 font-black uppercase tracking-widest mb-1 flex items-center gap-1.5"><ShieldAlert size={10}/> Break-Even Occupancy</div>
              <div className="text-xl font-black tracking-tight text-white">{results.breakEvenOccupancy.toFixed(1)}%</div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 backdrop-blur-sm">
              <div className="text-[9px] text-indigo-300 font-black uppercase tracking-widest mb-1 flex items-center gap-1.5"><BadgePercent size={10}/> Yield on Cost (YoC)</div>
              <div className="text-xl font-black tracking-tight text-white">{results.yieldOnCost.toFixed(1)}%</div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 backdrop-blur-sm">
              <div className="text-[9px] text-indigo-300 font-black uppercase tracking-widest mb-1 flex items-center gap-1.5"><Coins size={10}/> Cash-on-Cash Rtn</div>
              <div className="text-xl font-black tracking-tight text-white">{results.cashOnCash === Infinity ? '∞' : `${results.cashOnCash.toFixed(1)}%`}</div>
            </div>
          </div>

          {/* Data Viz: TCV Trajectory */}
          <div className="relative z-10 border-t border-white/10 pt-6">
            <div className="flex justify-between items-end mb-2">
              <div>
                <h3 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Total Contract Value (TCV)</h3>
                <div className="text-2xl font-black text-indigo-400">{formatCurrency(results.tcv)}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Payback</div>
                <div className="text-sm font-bold text-white">{results.capexPaybackMonths.toFixed(1)} Mos</div>
              </div>
            </div>
            <TCVAreaChart termMonths={Number(params.termMonths)} sellingPrice={results.sellingPrice} annualEscalation={Number(params.annualEscalation)} />
          </div>

          {/* Data Viz: Donut Stack & Initial Cashflow */}
          <div className="relative z-10 border-t border-white/10 pt-6 grid grid-cols-1 sm:grid-cols-2 gap-6 items-center">
            
            {/* Donut Chart */}
            <div className="flex flex-col items-center">
              <h3 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-4 w-full text-left">Monthly Cost Stack</h3>
              <DonutChart data={[
                { value: results.totalRent, color: '#3b82f6' }, // Blue
                { value: results.capexEMI, color: '#f97316' },  // Orange
                { value: results.totalOpex, color: '#10b981' }, // Emerald
                { value: results.brokerageAmortization, color: '#a855f7' } // Purple
              ]} />
              <div className="w-full mt-4 space-y-1.5">
                {[
                  { label: "Rent", val: results.totalRent, bg: "bg-blue-500" },
                  { label: "Capex EMI", val: results.capexEMI, bg: "bg-orange-500" },
                  { label: "Opex", val: results.totalOpex, bg: "bg-emerald-500" },
                  { label: "Brokerage", val: results.brokerageAmortization, bg: "bg-purple-500" }
                ].map((item, i) => (
                  <div key={i} className="flex justify-between items-center text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                    <span className="flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${item.bg}`}></span> {item.label}</span>
                    <span>{formatStandard(item.val)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Day 0 Cashflow */}
            <div>
              <h3 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-4">Initial Cashflow (Day 0)</h3>
              <div className="space-y-3">
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2.5">
                  <div className="text-[9px] text-red-400 font-bold uppercase tracking-widest mb-0.5">Outflows</div>
                  <div className="flex justify-between text-xs font-black text-red-300">
                    <span>Capex</span><span>- {formatCurrency(results.totalCapex)}</span>
                  </div>
                  <div className="flex justify-between text-xs font-black text-red-300 mt-1">
                    <span>LL Deposit</span><span>- {formatCurrency(results.totalLandlordDeposit)}</span>
                  </div>
                </div>
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2.5">
                  <div className="text-[9px] text-emerald-400 font-bold uppercase tracking-widest mb-0.5">Inflows</div>
                  <div className="flex justify-between text-xs font-black text-emerald-300">
                    <span>Client Dep.</span><span>+ {formatCurrency(results.totalClientDeposit)}</span>
                  </div>
                </div>
                <div className="pt-2 border-t border-white/10 flex justify-between items-center">
                  <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Net Outlay</span>
                  <span className={`text-base font-black ${results.initialCashflow < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {results.initialCashflow < 0 ? '-' : '+'} {formatCurrency(Math.abs(results.initialCashflow))}
                  </span>
                </div>
              </div>
              
              {/* Advanced Metrics visual indicator */}
              <div className="mt-4 text-[9px] text-zinc-500 font-medium text-center border-t border-white/5 pt-3 leading-relaxed">
                 *DCF model includes ₹{formatCurrency(results.salvageAmount)} salvage recovery & assumes ₹{formatCurrency(results.totalMakeGood)} make-good cost at end of term.
              </div>
            </div>

          </div>
        </div>
      </div>
      
      {/* CSS for custom scrollbar hidden in general tailwind */}
      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #d4d4d8; border-radius: 10px; }
        .bg-zinc-950.custom-scrollbar::-webkit-scrollbar-thumb { background: #3f3f46; }
      `}} />
    </div>
  );
}