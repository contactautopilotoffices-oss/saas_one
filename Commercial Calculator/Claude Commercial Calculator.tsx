import React, { useState, useEffect } from "react";
import { Calculator, Building, TrendingUp, DollarSign, Info, ChevronRight } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip as ReTooltip, Legend, ResponsiveContainer } from "recharts";

export default function UnifiedCommercialCalculator() {
  // Shared state
  const [carpetArea, setCarpetArea] = useState(18000);
  const [activeTab, setActiveTab] = useState("capex");
  
  // CAPEX Calculator State
  const [finishingType, setFinishingType] = useState("");
  const [lockInMonths, setLockInMonths] = useState(36);
  const [capexCalculated, setCapexCalculated] = useState(false);
  const [capexResults, setCapexResults] = useState(null);
  
  // Commercial Calculator State
  const [seats, setSeats] = useState(600);
  const [efficiency, setEfficiency] = useState(83);
  const [rentRate, setRentRate] = useState(75);
  const [camRate, setCamRate] = useState(11);
  const [capex, setCapex] = useState(250000);
  const [parking, setParking] = useState(50000);
  const [cafeteria, setCafeteria] = useState(50000);
  const [opexRate, setOpexRate] = useState(60);
  const [markup, setMarkup] = useState(20);
  const [buaMode, setBuaMode] = useState("markup");
  const [buaMarkup, setBuaMarkup] = useState(30);
  const [directBUA, setDirectBUA] = useState(0);
  const [commercialCalculated, setCommercialCalculated] = useState(false);

  const finishingRates = {
    bareShell: { name: "Bare Shell", rate: 2700 },
    warmShell: { name: "Warm Shell", rate: 2100 },
    furnished: { name: "Furnished", rate: 500 }
  };

  // Calculate CAPEX
  const calculateCapex = () => {
    if (!carpetArea || !finishingType) {
      alert("Please fill in all required fields");
      return;
    }

    const rate = finishingRates[finishingType].rate;
    const lumpSum = carpetArea * rate;
    const monthlyCAPEX = lumpSum / lockInMonths;
    const totalYears = Math.ceil(lockInMonths / 12);
    
    let yearlyBreakdown = [];
    let totalCAPEX = 0;
    let remainingMonths = lockInMonths;
    
    for (let year = 1; year <= totalYears; year++) {
      let monthsInYear = Math.min(12, remainingMonths);
      let yearAmount = year === 1 
        ? monthlyCAPEX * monthsInYear
        : monthlyCAPEX * monthsInYear * Math.pow(1.16, year - 1);
      
      yearlyBreakdown.push({
        year,
        months: monthsInYear,
        amount: yearAmount,
        interest: year > 1 ? '16% compounded' : 'No interest'
      });
      
      totalCAPEX += yearAmount;
      remainingMonths -= monthsInYear;
    }
    
    setCapexResults({
      lumpSum,
      monthlyCAPEX,
      totalCAPEX,
      yearlyBreakdown,
      finishingName: finishingRates[finishingType].name,
      rate
    });
    setCapexCalculated(true);
    
    // Auto-populate commercial calculator with calculated CAPEX
    setCapex(Math.round(monthlyCAPEX));
  };

  // Commercial calculations
  const round0 = (n) => Math.round(Number.isFinite(n) ? n : 0);
  const fmtINR = (n) => `₹${round0(n).toLocaleString('en-IN')}`;
  
  let computedBUA = 0;
  if (buaMode === 'markup') {
    computedBUA = carpetArea * (1 + buaMarkup / 100);
  } else if (buaMode === 'efficiency') {
    computedBUA = carpetArea * 100 / efficiency;
  } else {
    computedBUA = directBUA;
  }
  const bua = round0(computedBUA);

  const rent = round0(rentRate * bua);
  const cam = round0(camRate * bua);
  const opex = round0(opexRate * bua);
  const totalBase = rent + cam + opex + capex + parking + cafeteria;
  const factor = 1 + (markup / 100);
  const totalWithMarkup = round0(totalBase * factor);
  const perSeat = round0(totalWithMarkup / Math.max(1, seats));

  const pieData = [
    { name: "Rent", value: round0((rent * factor) / Math.max(1, seats)) },
    { name: "CAM", value: round0((cam * factor) / Math.max(1, seats)) },
    { name: "Opex", value: round0((opex * factor) / Math.max(1, seats)) },
    { name: "Capex", value: round0((capex * factor) / Math.max(1, seats)) },
    { name: "Parking", value: round0((parking * factor) / Math.max(1, seats)) },
    { name: "Cafeteria", value: round0((cafeteria * factor) / Math.max(1, seats)) }
  ];

  const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <h1 className="text-3xl font-bold text-center bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
            Unified Commercial & CAPEX Calculator
          </h1>
          <p className="text-center text-gray-600 mt-2">Complete workspace cost analysis tool</p>
        </div>

        {/* Tab Navigation */}
        <div className="bg-white rounded-xl shadow-lg p-2 mb-6">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab("capex")}
              className={`flex-1 py-3 px-4 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 ${
                activeTab === "capex" 
                  ? "bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-md" 
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              <Building size={20} />
              CAPEX Calculator
            </button>
            <button
              onClick={() => setActiveTab("commercial")}
              className={`flex-1 py-3 px-4 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 ${
                activeTab === "commercial" 
                  ? "bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-md" 
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              <Calculator size={20} />
              Commercial Rent
            </button>
          </div>
        </div>

        {/* Shared Input */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="text-indigo-600" size={24} />
            <h2 className="text-xl font-bold text-gray-800">Common Parameters</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Carpet Area (sq.ft)
              </label>
              <input
                type="number"
                value={carpetArea}
                onChange={(e) => setCarpetArea(+e.target.value)}
                className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none transition-colors"
              />
            </div>
            {capexCalculated && (
              <div className="bg-gradient-to-r from-green-50 to-emerald-50 p-4 rounded-lg border border-green-200">
                <p className="text-sm text-gray-600">Monthly CAPEX (auto-filled)</p>
                <p className="text-2xl font-bold text-green-700">{fmtINR(capexResults?.monthlyCAPEX || 0)}</p>
              </div>
            )}
          </div>
        </div>

        {/* CAPEX Calculator Tab */}
        {activeTab === "capex" && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="text-lg font-bold text-gray-800 mb-4">Select Finishing Type</h3>
              <div className="grid md:grid-cols-3 gap-4">
                {Object.entries(finishingRates).map(([key, value]) => (
                  <div
                    key={key}
                    onClick={() => setFinishingType(key)}
                    className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                      finishingType === key
                        ? "border-indigo-500 bg-indigo-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-semibold">{value.name}</span>
                      <span className="bg-indigo-100 text-indigo-700 px-2 py-1 rounded text-sm font-bold">
                        ₹{value.rate}/sq.ft
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-lg p-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Lock-in Period (months)
              </label>
              <input
                type="number"
                value={lockInMonths}
                onChange={(e) => setLockInMonths(+e.target.value)}
                className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
              />
              <p className="text-sm text-gray-500 mt-2">
                Interest: 16% per annum after Year 1
              </p>
            </div>

            <button
              onClick={calculateCapex}
              className="w-full bg-gradient-to-r from-indigo-500 to-purple-500 text-white py-3 rounded-lg font-semibold hover:shadow-lg transition-all flex items-center justify-center gap-2"
            >
              <Calculator size={20} />
              Calculate CAPEX
            </button>

            {capexCalculated && capexResults && (
              <div className="space-y-6 animate-in">
                <div className="bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-xl shadow-lg p-6">
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-indigo-100">Initial Lump Sum</p>
                      <p className="text-3xl font-bold">{fmtINR(capexResults.lumpSum)}</p>
                    </div>
                    <div>
                      <p className="text-indigo-100">Monthly CAPEX</p>
                      <p className="text-3xl font-bold">{fmtINR(capexResults.monthlyCAPEX)}</p>
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-indigo-400">
                    <p className="text-indigo-100">Total CAPEX (with interest)</p>
                    <p className="text-4xl font-bold">{fmtINR(capexResults.totalCAPEX)}</p>
                  </div>
                </div>

                <div className="bg-white rounded-xl shadow-lg p-6">
                  <h3 className="text-lg font-bold text-gray-800 mb-4">Yearly Breakdown</h3>
                  {capexResults.yearlyBreakdown.map((item) => (
                    <div key={item.year} className="flex justify-between items-center p-3 mb-2 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                      <div>
                        <p className="font-semibold">Year {item.year}</p>
                        <p className="text-sm text-gray-500">{item.months} months | {item.interest}</p>
                      </div>
                      <p className="text-xl font-bold text-indigo-600">{fmtINR(item.amount)}</p>
                    </div>
                  ))}
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center gap-3">
                  <Info className="text-blue-600" size={20} />
                  <div>
                    <p className="font-semibold text-blue-900">Ready to calculate commercial rent?</p>
                    <button
                      onClick={() => setActiveTab("commercial")}
                      className="text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 mt-1"
                    >
                      Go to Commercial Calculator <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Commercial Calculator Tab */}
        {activeTab === "commercial" && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="text-lg font-bold text-gray-800 mb-4">Workspace Configuration</h3>
              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Seats</label>
                  <input
                    type="number"
                    value={seats}
                    onChange={(e) => setSeats(+e.target.value)}
                    className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Rent Rate (per sq.ft)</label>
                  <input
                    type="number"
                    value={rentRate}
                    onChange={(e) => setRentRate(+e.target.value)}
                    className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">CAM Rate (per sq.ft)</label>
                  <input
                    type="number"
                    value={camRate}
                    onChange={(e) => setCamRate(+e.target.value)}
                    className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="text-lg font-bold text-gray-800 mb-4">Monthly Costs</h3>
              <div className="grid md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">CAPEX (monthly)</label>
                  <input
                    type="number"
                    value={capex}
                    onChange={(e) => setCapex(+e.target.value)}
                    className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Parking</label>
                  <input
                    type="number"
                    value={parking}
                    onChange={(e) => setParking(+e.target.value)}
                    className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Cafeteria</label>
                  <input
                    type="number"
                    value={cafeteria}
                    onChange={(e) => setCafeteria(+e.target.value)}
                    className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Opex Rate (per sq.ft)</label>
                  <input
                    type="number"
                    value={opexRate}
                    onChange={(e) => setOpexRate(+e.target.value)}
                    className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="text-lg font-bold text-gray-800 mb-4">BUA Calculation Mode</h3>
              <div className="space-y-3">
                <label className="flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer hover:bg-gray-50 transition-colors"
                  style={{ borderColor: buaMode === 'markup' ? '#6366f1' : '#e5e7eb' }}>
                  <input
                    type="radio"
                    checked={buaMode === 'markup'}
                    onChange={() => setBuaMode('markup')}
                    className="w-4 h-4 text-indigo-600"
                  />
                  <span className="flex-1">Markup over Carpet (%)</span>
                  <input
                    type="number"
                    value={buaMarkup}
                    onChange={(e) => setBuaMarkup(+e.target.value)}
                    className="w-20 px-2 py-1 border rounded"
                    onClick={(e) => e.stopPropagation()}
                  />
                </label>
                <label className="flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer hover:bg-gray-50 transition-colors"
                  style={{ borderColor: buaMode === 'efficiency' ? '#6366f1' : '#e5e7eb' }}>
                  <input
                    type="radio"
                    checked={buaMode === 'efficiency'}
                    onChange={() => setBuaMode('efficiency')}
                    className="w-4 h-4 text-indigo-600"
                  />
                  <span className="flex-1">Efficiency (%)</span>
                  <input
                    type="number"
                    value={efficiency}
                    onChange={(e) => setEfficiency(+e.target.value)}
                    className="w-20 px-2 py-1 border rounded"
                    onClick={(e) => e.stopPropagation()}
                  />
                </label>
                <label className="flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer hover:bg-gray-50 transition-colors"
                  style={{ borderColor: buaMode === 'direct' ? '#6366f1' : '#e5e7eb' }}>
                  <input
                    type="radio"
                    checked={buaMode === 'direct'}
                    onChange={() => setBuaMode('direct')}
                    className="w-4 h-4 text-indigo-600"
                  />
                  <span className="flex-1">Direct BUA (sq.ft)</span>
                  <input
                    type="number"
                    value={directBUA}
                    onChange={(e) => setDirectBUA(+e.target.value)}
                    className="w-24 px-2 py-1 border rounded"
                    onClick={(e) => e.stopPropagation()}
                  />
                </label>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-lg p-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Overall Markup: {markup}%
              </label>
              <input
                type="range"
                value={markup}
                onChange={(e) => setMarkup(+e.target.value)}
                min="0"
                max="50"
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>0%</span>
                <span>50%</span>
              </div>
            </div>

            <button
              onClick={() => setCommercialCalculated(true)}
              className="w-full bg-gradient-to-r from-indigo-500 to-purple-500 text-white py-3 rounded-lg font-semibold hover:shadow-lg transition-all flex items-center justify-center gap-2"
            >
              <Calculator size={20} />
              Calculate Commercial Rent
            </button>

            {commercialCalculated && (
              <div className="space-y-6 animate-in">
                <div className="bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-xl shadow-lg p-6">
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-indigo-100">Carpet Area</p>
                      <p className="text-2xl font-bold">{round0(carpetArea).toLocaleString('en-IN')} sq.ft</p>
                    </div>
                    <div>
                      <p className="text-indigo-100">BUA</p>
                      <p className="text-2xl font-bold">{bua.toLocaleString('en-IN')} sq.ft</p>
                    </div>
                  </div>
                  <div className="grid md:grid-cols-2 gap-4 mt-4">
                    <div>
                      <p className="text-indigo-100">Total (with {markup}% markup)</p>
                      <p className="text-3xl font-bold">{fmtINR(totalWithMarkup)}</p>
                    </div>
                    <div>
                      <p className="text-indigo-100">Per Seat Cost</p>
                      <p className="text-3xl font-bold">{fmtINR(perSeat)}</p>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-xl shadow-lg p-6">
                  <h3 className="text-lg font-bold text-gray-800 mb-4">Per Seat Cost Breakdown</h3>
                  <div className="flex flex-col lg:flex-row gap-6">
                    <div className="flex-1">
                      <ResponsiveContainer width="100%" height={300}>
                        <PieChart>
                          <Pie
                            data={pieData}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={100}
                            dataKey="value"
                            label={(entry) => `${entry.name}: ${fmtINR(entry.value)}`}
                          >
                            {pieData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Pie>
                          <ReTooltip formatter={(value) => fmtINR(value)} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex-1 space-y-3">
                      {pieData.map((item, index) => (
                        <div key={item.name} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                          <div className="flex items-center gap-3">
                            <div className="w-4 h-4 rounded" style={{ backgroundColor: COLORS[index] }}></div>
                            <span className="font-medium">{item.name}</span>
                          </div>
                          <span className="font-bold">{fmtINR(item.value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-xl shadow-lg p-6">
                  <h3 className="text-lg font-bold text-gray-800 mb-4">Monthly Breakdown (before markup)</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between p-3 bg-gray-50 rounded-lg">
                      <span>Rent</span>
                      <span className="font-bold">{fmtINR(rent)}</span>
                    </div>
                    <div className="flex justify-between p-3 bg-gray-50 rounded-lg">
                      <span>CAM</span>
                      <span className="font-bold">{fmtINR(cam)}</span>
                    </div>
                    <div className="flex justify-between p-3 bg-gray-50 rounded-lg">
                      <span>Opex</span>
                      <span className="font-bold">{fmtINR(opex)}</span>
                    </div>
                    <div className="flex justify-between p-3 bg-gray-50 rounded-lg">
                      <span>Capex</span>
                      <span className="font-bold">{fmtINR(capex)}</span>
                    </div>
                    <div className="flex justify-between p-3 bg-gray-50 rounded-lg">
                      <span>Parking</span>
                      <span className="font-bold">{fmtINR(parking)}</span>
                    </div>
                    <div className="flex justify-between p-3 bg-gray-50 rounded-lg">
                      <span>Cafeteria</span>
                      <span className="font-bold">{fmtINR(cafeteria)}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}