'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, Loader2, User, Sparkles, AlertCircle, TrendingUp, Calendar, Users, DollarSign } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    isLoading?: boolean;
}

interface QuickInsight {
    id: string;
    label: string;
    icon: any;
    query: string;
}

const QUICK_INSIGHTS: QuickInsight[] = [
    { id: '1', label: 'Leads not contacted', icon: Users, query: 'Show leads not contacted for 14 days' },
    { id: '2', label: 'High value opportunities', icon: DollarSign, query: 'Show highest value opportunities above 50 lakhs' },
    { id: '3', label: 'Pipeline summary', icon: TrendingUp, query: 'Show Bangalore pipeline summary' },
    { id: '4', label: 'Monthly closures', icon: Calendar, query: 'Show this month\'s closures' },
    { id: '5', label: 'Overdue follow-ups', icon: AlertCircle, query: 'Show overdue follow ups' }
];

export default function AIInsightsPanel() {
    const [messages, setMessages] = useState<Message[]>([
        {
            id: 'welcome',
            role: 'assistant',
            content: '👋 Hi! I\'m your CRM AI assistant. I can help you with:\n\n• Lead summaries and insights\n• Pipeline analysis\n• Follow-up reminders\n• Performance reports\n\nTry one of the quick actions below or ask me anything!'
        }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSend = async (query: string) => {
        if (!query.trim() || isLoading) return;

        const userMessage: Message = {
            id: `user-${Date.now()}`,
            role: 'user',
            content: query
        };

        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);

        // Add loading message
        const loadingMessage: Message = {
            id: `loading-${Date.now()}`,
            role: 'assistant',
            content: '',
            isLoading: true
        };
        setMessages(prev => [...prev, loadingMessage]);

        try {
            // Call AI service (using existing infrastructure)
            const response = await fetch('/api/crm/ai', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, context: 'crm' })
            });

            if (response.ok) {
                const data = await response.json();
                setMessages(prev => prev.map(m =>
                    m.id === loadingMessage.id
                        ? { ...m, id: `assistant-${Date.now()}`, content: data.response || data.message || 'I\'m analyzing your CRM data...' }
                        : m
                ));
            } else {
                // Fallback to basic query response
                const responseText = await processQuery(query);
                setMessages(prev => prev.map(m =>
                    m.id === loadingMessage.id
                        ? { ...m, id: `assistant-${Date.now()}`, content: responseText }
                        : m
                ));
            }
        } catch (error) {
            console.error('AI query error:', error);
            setMessages(prev => prev.map(m =>
                m.id === loadingMessage.id
                    ? { ...m, id: `assistant-${Date.now()}`, content: 'I encountered an error processing your request. Please try again.' }
                    : m
            ));
        } finally {
            setIsLoading(false);
        }
    };

    const processQuery = async (query: string): Promise<string> => {
        const lowerQuery = query.toLowerCase();

        // Basic query processing using existing API
        try {
            if (lowerQuery.includes('not contacted') || lowerQuery.includes('14 days')) {
                const res = await fetch('/api/crm/leads?page=1&page_size=10');
                if (res.ok) {
                    const data = await res.json();
                    const staleLeads = (data.leads || []).filter((l: any) => {
                        if (!l.last_contacted) return true;
                        const daysSince = (Date.now() - new Date(l.last_contacted).getTime()) / (1000 * 60 * 60 * 24);
                        return daysSince > 14;
                    });
                    return `Found ${staleLeads.length} leads not contacted in the last 14 days.\n\n${staleLeads.slice(0, 5).map((l: any, i: number) => `${i + 1}. ${l.company_name || l.contact_person} - Last contacted: ${l.last_contacted ? new Date(l.last_contacted).toLocaleDateString() : 'Never'}`).join('\n')}`;
                }
            }

            if (lowerQuery.includes('high value') || lowerQuery.includes('lakh')) {
                const res = await fetch('/api/crm/leads?page=1&page_size=20');
                if (res.ok) {
                    const data = await res.json();
                    const highValue = (data.leads || []).filter((l: any) => l.deal_value >= 5000000)
                        .sort((a: any, b: any) => b.deal_value - a.deal_value);
                    return `Found ${highValue.length} high-value opportunities (₹50L+):\n\n${highValue.slice(0, 5).map((l: any, i: number) => `${i + 1}. ${l.company_name} - ₹${(l.deal_value / 10000000).toFixed(2)} Cr`).join('\n')}`;
                }
            }

            if (lowerQuery.includes('pipeline') || lowerQuery.includes('bangalore')) {
                const res = await fetch('/api/crm/stats?type=admin');
                if (res.ok) {
                    const data = await res.json();
                    return `Pipeline Summary:\n\n• Total Leads: ${data.total_leads}\n• Open Leads: ${data.open_leads}\n• Pipeline Value: ₹${((data.pipeline_value || 0) / 10000000).toFixed(2)} Cr\n\nTop Properties:\n${(data.property_wise_leads || []).slice(0, 3).map((p: any, i: number) => `${i + 1}. ${p.property_name}: ${p.count} leads (₹${(p.value / 10000000).toFixed(2)} Cr)`).join('\n')}`;
                }
            }

            if (lowerQuery.includes('closure') || lowerQuery.includes('won')) {
                const res = await fetch('/api/crm/stats?type=rep');
                if (res.ok) {
                    const data = await res.json();
                    return `This Month's Performance:\n\n• Won Deals: ${data.won_this_month}\n• Revenue Closed: ₹${(data.revenue_closed / 10000000).toFixed(2)} Cr\n• Pipeline Value: ₹${(data.pipeline_value / 10000000).toFixed(2)} Cr\n• Target Achievement: ${data.target_achievement_percent}%`;
                }
            }

            if (lowerQuery.includes('overdue') || lowerQuery.includes('follow')) {
                const res = await fetch('/api/crm/leads?page=1&page_size=20');
                if (res.ok) {
                    const data = await res.json();
                    const today = new Date().toISOString().split('T')[0];
                    const overdue = (data.leads || []).filter((l: any) =>
                        l.next_followup_date && l.next_followup_date.split('T')[0] < today
                    );
                    return `Found ${overdue.length} overdue follow-ups:\n\n${overdue.slice(0, 5).map((l: any, i: number) => `${i + 1}. ${l.company_name || l.contact_person} - Due: ${new Date(l.next_followup_date).toLocaleDateString()}`).join('\n')}`;
                }
            }

            // Default response
            return `I can help you analyze your CRM data. Try asking about:\n\n• "Show leads not contacted for 14 days"\n• "Show highest value opportunities"\n• "Show pipeline summary"\n• "Show this month's closures"\n• "Show overdue follow-ups"`;
        } catch (error) {
            return 'I\'m having trouble accessing your CRM data right now. Please try again in a moment.';
        }
    };

    return (
        <div className="flex flex-col h-full bg-white rounded-2xl border border-slate-200 overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 bg-slate-50">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Bot className="w-5 h-5 text-primary" />
                </div>
                <div>
                    <h3 className="font-semibold text-text-primary">AI Insights</h3>
                    <p className="text-xs text-text-secondary">CRM Assistant</p>
                </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map(message => (
                    <motion.div
                        key={message.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
                    >
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                            message.role === 'user' ? 'bg-primary text-white' : 'bg-slate-100'
                        }`}>
                            {message.role === 'user' ? (
                                <User className="w-4 h-4" />
                            ) : (
                                <Bot className="w-4 h-4 text-text-secondary" />
                            )}
                        </div>
                        <div className={`flex-1 ${message.role === 'user' ? 'text-right' : ''}`}>
                            <div className={`inline-block px-4 py-3 rounded-2xl text-sm whitespace-pre-wrap ${
                                message.role === 'user'
                                    ? 'bg-primary text-white rounded-tr-sm'
                                    : 'bg-slate-100 text-text-primary rounded-tl-sm'
                            }`}>
                                {message.isLoading ? (
                                    <div className="flex items-center gap-2">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        <span>Analyzing...</span>
                                    </div>
                                ) : (
                                    message.content
                                )}
                            </div>
                        </div>
                    </motion.div>
                ))}
                <div ref={messagesEndRef} />
            </div>

            {/* Quick Insights */}
            <AnimatePresence>
                {messages.length <= 2 && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="px-4 pb-2"
                    >
                        <p className="text-xs text-text-tertiary mb-2">Quick Actions</p>
                        <div className="flex flex-wrap gap-2">
                            {QUICK_INSIGHTS.map(insight => (
                                <button
                                    key={insight.id}
                                    onClick={() => handleSend(insight.query)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 rounded-lg text-xs font-medium text-text-secondary transition-colors"
                                >
                                    <insight.icon className="w-3 h-3" />
                                    {insight.label}
                                </button>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Input */}
            <div className="p-4 border-t border-slate-200">
                <div className="flex items-center gap-2">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSend(input)}
                        placeholder="Ask about your CRM data..."
                        className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                    <button
                        onClick={() => handleSend(input)}
                        disabled={!input.trim() || isLoading}
                        className="p-2.5 bg-primary text-white rounded-xl disabled:opacity-50 hover:bg-primary/90 transition-colors"
                    >
                        <Send className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
}