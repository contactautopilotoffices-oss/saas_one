import React, { useState, useRef } from 'react';
import { 
    Upload, FileText, Loader2, CheckCircle2, 
    AlertCircle, ShoppingCart, ArrowRight,
    Edit3, Trash2, Plus, Building2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { InvoiceData } from '@/backend/services/aiProcessor';

interface Props {
    organizationId: string;
    onComplete?: () => void;
}

export default function ProcurementPOProcessor({ organizationId, onComplete }: Props) {
    const [step, setStep] = useState<'upload' | 'parsing' | 'review' | 'success'>('upload');
    const [file, setFile] = useState<File | null>(null);
    const [parsedData, setParsedData] = useState<InvoiceData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isCreatingPO, setIsCreatingPO] = useState(false);
    const [zohoOrgId, setZohoOrgId] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            setFile(selectedFile);
            startParsing(selectedFile);
        }
    };

    const startParsing = async (fileToParse: File) => {
        setStep('parsing');
        setError(null);
        
        try {
            const formData = new FormData();
            formData.append('file', fileToParse);

            const res = await fetch('/api/procurement/process-pi', {
                method: 'POST',
                body: formData,
            });

            const result = await res.json();
            if (!res.ok) throw new Error(result.error || 'Failed to parse invoice');

            setParsedData(result.data);
            setStep('review');
        } catch (err: any) {
            setError(err.message);
            setStep('upload');
        }
    };

    const handleUpdateItem = (index: number, field: string, value: any) => {
        if (!parsedData) return;
        const newItems = [...parsedData.items];
        newItems[index] = { ...newItems[index], [field]: value };
        
        // Recalculate total for the item
        if (field === 'quantity' || field === 'unit_price') {
            newItems[index].total = (newItems[index].quantity || 0) * (newItems[index].unit_price || 0);
        }

        const newTotal = newItems.reduce((sum, item) => sum + (item.total || 0), 0);
        setParsedData({ ...parsedData, items: newItems, total_amount: newTotal });
    };

    const handleCreatePO = async () => {
        if (!parsedData || !zohoOrgId) {
            setError('Please provide a Zoho Organization ID');
            return;
        }

        setIsCreatingPO(true);
        setError(null);

        try {
            const res = await fetch('/api/procurement/zoho/po', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    organizationId,
                    invoiceData: parsedData,
                    zohoOrgId,
                }),
            });

            const result = await res.json();
            if (!res.ok) throw new Error(result.error || 'Failed to create PO');

            setStep('success');
            if (onComplete) onComplete();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsCreatingPO(false);
        }
    };

    return (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden max-w-4xl mx-auto">
            {/* Header */}
            <div className="bg-slate-900 p-8 text-white">
                <div className="flex items-center gap-4 mb-2">
                    <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center border border-white/10">
                        <ShoppingCart className="w-5 h-5 text-primary" />
                    </div>
                    <h2 className="text-2xl font-black tracking-tight">AI Purchase Order Generator</h2>
                </div>
                <p className="text-slate-400 text-sm font-medium">Upload a Performa Invoice and let AI generate a Zoho Books PO for you.</p>
            </div>

            <div className="p-8">
                {error && (
                    <div className="mb-6 p-4 bg-rose-50 border border-rose-100 rounded-2xl flex items-center gap-3 text-rose-600 animate-in fade-in slide-in-from-top-2">
                        <AlertCircle className="w-5 h-5 shrink-0" />
                        <p className="text-sm font-bold">{error}</p>
                    </div>
                )}

                <AnimatePresence mode="wait">
                    {step === 'upload' && (
                        <motion.div 
                            key="step-upload"
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 1.05 }}
                            className="flex flex-col items-center justify-center"
                        >
                            <div 
                                onClick={() => fileInputRef.current?.click()}
                                className="w-full max-w-md aspect-video border-4 border-dashed border-slate-100 rounded-[40px] flex flex-col items-center justify-center gap-4 cursor-pointer hover:border-primary/30 hover:bg-primary/5 transition-all group"
                            >
                                <div className="w-20 h-20 rounded-3xl bg-slate-50 flex items-center justify-center group-hover:scale-110 transition-transform">
                                    <Upload className="w-8 h-8 text-slate-400 group-hover:text-primary" />
                                </div>
                                <div className="text-center">
                                    <p className="text-lg font-black text-slate-700">Click to upload PI</p>
                                    <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">PDF, JPG, or PNG</p>
                                </div>
                                <input 
                                    type="file" 
                                    ref={fileInputRef} 
                                    onChange={handleFileChange} 
                                    className="hidden" 
                                    accept=".pdf,image/*" 
                                />
                            </div>
                            
                            <div className="mt-12 grid grid-cols-3 gap-8 w-full max-w-2xl">
                                {[
                                    { icon: FileText, label: 'Upload PI', sub: 'PDF or Image' },
                                    { icon: Loader2, label: 'AI Mapping', sub: 'Instant Data Entry' },
                                    { icon: CheckCircle2, label: 'Sync Zoho', sub: 'One-click PO' },
                                ].map((item, i) => (
                                    <div key={i} className="text-center space-y-2">
                                        <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center mx-auto border border-slate-100">
                                            <item.icon className="w-4 h-4 text-slate-400" />
                                        </div>
                                        <p className="text-[10px] font-black text-slate-900 uppercase tracking-widest">{item.label}</p>
                                        <p className="text-[9px] text-slate-400 font-bold">{item.sub}</p>
                                    </div>
                                ))}
                            </div>
                        </motion.div>
                    )}

                    {step === 'parsing' && (
                        <motion.div 
                            key="step-parsing"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex flex-col items-center justify-center py-20 space-y-6"
                        >
                            <div className="relative">
                                <div className="w-24 h-24 border-4 border-slate-100 rounded-full animate-spin border-t-primary" />
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <Loader2 className="w-10 h-10 text-primary animate-pulse" />
                                </div>
                            </div>
                            <div className="text-center">
                                <h3 className="text-xl font-black text-slate-900">AI is Analyzing...</h3>
                                <p className="text-sm text-slate-400 font-medium mt-1 italic animate-pulse">Reading items, taxes, and vendor details from your invoice.</p>
                            </div>
                        </motion.div>
                    )}

                    {step === 'review' && parsedData && (
                        <motion.div 
                            key="step-review"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="space-y-8"
                        >
                            {/* Summary Header */}
                            <div className="grid grid-cols-2 gap-6 bg-slate-50 p-6 rounded-[32px] border border-slate-100">
                                <div className="space-y-4">
                                    <div>
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Vendor Name</label>
                                        <input 
                                            value={parsedData.vendor_name || ''}
                                            onChange={e => setParsedData({...parsedData, vendor_name: e.target.value})}
                                            className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-black outline-none focus:ring-2 focus:ring-primary/20"
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">PI Number</label>
                                            <input 
                                                value={parsedData.invoice_number || ''}
                                                onChange={e => setParsedData({...parsedData, invoice_number: e.target.value})}
                                                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Date</label>
                                            <input 
                                                type="date"
                                                value={parsedData.date || ''}
                                                onChange={e => setParsedData({...parsedData, date: e.target.value})}
                                                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold outline-none"
                                            />
                                        </div>
                                    </div>
                                </div>
                                <div className="flex flex-col justify-between items-end">
                                    <div className="text-right">
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Amount</p>
                                        <p className="text-4xl font-black text-primary tracking-tighter">
                                            {parsedData.currency === 'INR' ? '₹' : parsedData.currency}
                                            {parsedData.total_amount.toLocaleString()}
                                        </p>
                                    </div>
                                    <div className="w-full max-w-xs space-y-2">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                            <Building2 className="w-3 h-3" /> Zoho Org ID
                                        </label>
                                        <input 
                                            placeholder="Enter Zoho Organization ID"
                                            value={zohoOrgId}
                                            onChange={e => setZohoOrgId(e.target.value)}
                                            className="w-full bg-white border-2 border-primary/20 rounded-xl px-4 py-2 text-sm font-black outline-none focus:border-primary shadow-sm"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Items Table */}
                            <div className="bg-white border border-slate-100 rounded-3xl overflow-hidden shadow-sm">
                                <table className="w-full text-left">
                                    <thead className="bg-slate-50">
                                        <tr>
                                            <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Item Description</th>
                                            <th className="px-4 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest w-24">Qty</th>
                                            <th className="px-4 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest w-32">Rate</th>
                                            <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest w-32 text-right">Total</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        {parsedData.items.map((item, idx) => (
                                            <tr key={idx} className="hover:bg-slate-50/50 group transition-colors">
                                                <td className="px-6 py-4">
                                                    <input 
                                                        value={item.name || ''}
                                                        onChange={e => handleUpdateItem(idx, 'name', e.target.value)}
                                                        className="w-full bg-transparent font-bold text-slate-700 outline-none text-xs"
                                                    />
                                                </td>
                                                <td className="px-4 py-4">
                                                    <input 
                                                        type="number"
                                                        value={item.quantity || 0}
                                                        onChange={e => handleUpdateItem(idx, 'quantity', parseFloat(e.target.value))}
                                                        className="w-full bg-transparent font-black text-slate-900 outline-none text-xs"
                                                    />
                                                </td>
                                                <td className="px-4 py-4">
                                                    <input 
                                                        type="number"
                                                        value={item.unit_price || 0}
                                                        onChange={e => handleUpdateItem(idx, 'unit_price', parseFloat(e.target.value))}
                                                        className="w-full bg-transparent font-black text-slate-900 outline-none text-xs"
                                                    />
                                                </td>
                                                <td className="px-6 py-4 text-right text-xs font-black text-slate-900">
                                                    ₹{item.total.toLocaleString()}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <div className="flex gap-4 pt-4">
                                <button 
                                    onClick={() => setStep('upload')}
                                    className="px-8 py-4 rounded-2xl border border-slate-200 text-slate-500 font-black text-xs uppercase tracking-widest hover:bg-slate-50 transition-all"
                                >
                                    Re-upload
                                </button>
                                <button 
                                    onClick={handleCreatePO}
                                    disabled={isCreatingPO || !zohoOrgId}
                                    className="flex-1 bg-primary text-white py-4 px-8 rounded-2xl font-black text-xs uppercase tracking-widest hover:shadow-xl hover:shadow-primary/20 transition-all disabled:opacity-50 flex items-center justify-center gap-3"
                                >
                                    {isCreatingPO ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <CheckCircle2 className="w-4 h-4" />
                                    )}
                                    Generate Zoho Purchase Order
                                </button>
                            </div>
                        </motion.div>
                    )}

                    {step === 'success' && (
                        <motion.div 
                            key="step-success"
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="flex flex-col items-center justify-center py-20 text-center space-y-6"
                        >
                            <div className="w-24 h-24 rounded-[32px] bg-emerald-500 text-white flex items-center justify-center shadow-xl shadow-emerald-200">
                                <CheckCircle2 className="w-12 h-12" />
                            </div>
                            <div className="space-y-2">
                                <h3 className="text-3xl font-black text-slate-900 tracking-tight">PO Generated Successfully!</h3>
                                <p className="text-slate-500 font-medium">The Purchase Order has been created in your Zoho Books account.</p>
                            </div>
                            <div className="pt-8 flex gap-4">
                                <button 
                                    onClick={() => setStep('upload')}
                                    className="px-8 py-4 rounded-2xl bg-slate-900 text-white font-black text-xs uppercase tracking-widest hover:bg-slate-800 transition-all flex items-center gap-2"
                                >
                                    New Generation
                                </button>
                                <button 
                                    onClick={() => window.open('https://books.zoho.com', '_blank')}
                                    className="px-8 py-4 rounded-2xl border border-slate-200 text-slate-900 font-black text-xs uppercase tracking-widest hover:bg-slate-50 transition-all flex items-center gap-2"
                                >
                                    Go to Zoho Books <ArrowRight className="w-4 h-4" />
                                </button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}
