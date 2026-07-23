'use client';

import React from 'react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, ReferenceLine,
} from 'recharts';
import {
    RepTrend, COACHING_LAYER_KEYS, COACHING_LAYER_LABELS, CoachingLayerKey,
} from '@/frontend/types/crm';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface CoachingTrendChartProps {
    trend: RepTrend;
    height?: number;
}

/**
 * Score-over-time line chart for a single rep.
 * - X axis: call index (most recent on the right)
 * - Y axis: 0..10
 * - Dashed reference line at the rep's average
 */
export default function CoachingTrendChart({ trend, height = 220 }: CoachingTrendChartProps) {
    if (trend.history.length === 0) {
        return (
            <div className="flex h-32 items-center justify-center text-sm text-text-secondary">
                No analyzed calls yet.
            </div>
        );
    }

    // recharts wants { name, opening, rapport, ... } keyed by call index label
    const data = trend.history.map((p, i) => {
        const row: Record<string, any> = {
            name: `#${i + 1}`,
            overall: p.overallScore,
            dateLabel: new Date(p.uploadedAt).toLocaleDateString(undefined, {
                month: 'short', day: 'numeric',
            }),
            leadLabel: p.leadCompanyName || '—',
        };
        for (const k of COACHING_LAYER_KEYS) {
            row[k] = p.layers[k];
        }
        return row;
    });

    // Cycle a small palette of distinguishable but muted colors
    const layerColors: Record<CoachingLayerKey, string> = {
        opening:     '#0EA5E9',
        rapport:     '#8B5CF6',
        requirements:'#F59E0B',
        core:        '#10B981',
        closing:     '#EF4444',
    };

    return (
        <div>
            <div className="mb-2 flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 font-medium text-text-primary">
                    {trendIcon(trend.direction)}
                    <span>{directionLabel(trend.direction)}</span>
                    {trend.recentDelta != null && (
                        <span
                            className={`text-xs ${
                                trend.recentDelta > 0
                                    ? 'text-emerald-600'
                                    : trend.recentDelta < 0
                                    ? 'text-red-600'
                                    : 'text-text-secondary'
                            }`}
                        >
                            ({trend.recentDelta > 0 ? '+' : ''}{trend.recentDelta.toFixed(1)} last call)
                        </span>
                    )}
                </div>
                <div className="text-xs text-text-secondary">
                    Avg <span className="font-semibold text-text-primary">{trend.avgOverallScore.toFixed(1)}</span>
                    {' · '}
                    {trend.callCount} call{trend.callCount === 1 ? '' : 's'}
                </div>
            </div>
            <ResponsiveContainer width="100%" height={height}>
                <LineChart data={data} margin={{ top: 5, right: 16, bottom: 5, left: -8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis
                        dataKey="dateLabel"
                        stroke="#94A3B8"
                        style={{ fontSize: 11 }}
                        tickLine={false}
                    />
                    <YAxis
                        domain={[0, 10]}
                        stroke="#94A3B8"
                        style={{ fontSize: 11 }}
                        tickLine={false}
                        width={32}
                    />
                    <Tooltip
                        contentStyle={{
                            borderRadius: 8,
                            border: '1px solid #E2E8F0',
                            fontSize: 12,
                        }}
                        labelFormatter={(_, payload) => {
                            const p = payload?.[0]?.payload;
                            return p ? `${p.name} · ${p.leadLabel}` : '';
                        }}
                    />
                    <Legend
                        wrapperStyle={{ fontSize: 11 }}
                        iconType="circle"
                        iconSize={8}
                    />
                    <ReferenceLine
                        y={trend.avgOverallScore}
                        stroke="#94A3B8"
                        strokeDasharray="4 4"
                        label={{
                            value: 'avg',
                            position: 'right',
                            fill: '#94A3B8',
                            fontSize: 10,
                        }}
                    />
                    {COACHING_LAYER_KEYS.map((k) => (
                        <Line
                            key={k}
                            type="monotone"
                            dataKey={k}
                            name={COACHING_LAYER_LABELS[k]}
                            stroke={layerColors[k]}
                            strokeWidth={1.5}
                            dot={{ r: 2.5 }}
                            activeDot={{ r: 4 }}
                        />
                    ))}
                    <Line
                        type="monotone"
                        dataKey="overall"
                        name="Overall"
                        stroke="#0F172A"
                        strokeWidth={2.5}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                    />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}

function trendIcon(direction: RepTrend['direction']) {
    switch (direction) {
        case 'improving': return <TrendingUp className="h-4 w-4 text-emerald-500" />;
        case 'declining': return <TrendingDown className="h-4 w-4 text-red-500" />;
        case 'flat':      return <Minus className="h-4 w-4 text-slate-500" />;
        default:          return <Minus className="h-4 w-4 text-text-tertiary" />;
    }
}

function directionLabel(direction: RepTrend['direction']): string {
    switch (direction) {
        case 'improving':           return 'Improving';
        case 'declining':           return 'Declining';
        case 'flat':                return 'Holding steady';
        case 'insufficient_data':   return 'Need more data';
    }
}
