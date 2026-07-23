'use client';
import React, { useMemo, useState } from 'react';
import { ShiftConfig } from './ShiftConfigModal';
import { Pencil, Trash2 } from 'lucide-react';

interface RosterAssignment {
    user_id: string;
    roster_date: string;
    shift_id: string;
    is_reliever?: boolean;
    relieving_user_id?: string | null;
    updated_by?: string | null;
    updater?: { full_name: string } | null;
}

interface StaffMember {
    user_id: string;
    role: string;
    custom_designation?: string;
    users: {
        id: string;
        full_name: string;
        designation: string;
    };
}

interface Props {
    staff: StaffMember[];
    rosters: RosterAssignment[];
    configs: ShiftConfig[];
    year: number;
    month: number; // 0-indexed
    viewDate?: Date | null;
    onCellChange: (userId: string, dateStr: string, shiftId: string) => void;
    onToggleReliever: (userId: string, dateStr: string) => void;
    onUpdateDesignation: (userId: string, designation: string) => void;
    onRenameOfflineStaff: (userId: string, newName: string) => void;
    onRemoveStaff?: (userId: string, isOffline: boolean) => void;
    onCopyDay?: (dateStr: string) => void;
}

export function RosterBoard({ staff, rosters, configs, year, month, viewDate, onCellChange, onToggleReliever, onUpdateDesignation, onRenameOfflineStaff, onRemoveStaff, onCopyDay }: Props) {
    const containerRef = React.useRef<HTMLDivElement>(null);
    const todayRef = React.useRef<HTMLTableCellElement>(null);

    const [editingUserId, setEditingUserId] = useState<string | null>(null);
    const [renamingUserId, setRenamingUserId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    
    // Group staff by designation for display
    const sortedGroups = useMemo(() => {
        const groups: Record<string, StaffMember[]> = {};
        staff.forEach(s => {
            const desig = s.custom_designation || s.users.designation || s.role || 'Unassigned';
            if (!groups[desig]) groups[desig] = [];
            groups[desig].push(s);
        });

        const getRank = (desig: string) => {
            const d = desig.toUpperCase().trim();
            if (d === 'ASSISTANT MANAGER - TECHNICAL') return 1;
            if (d === 'EXECUTIVE - TECHNICAL') return 2;
            if (d === 'BMS OPERATOR') return 3;
            if (d === 'MST') return 4;
            if (d === 'ASSISTANT MANAGER - OPERATIONS') return 5;
            if (d === 'FACILITY EXECUTIVE - OPERATIONS') return 6;
            if (d === 'TRAINEE - OPERATIONS') return 7;
            if (d === 'HOUSEKEEPING - OPERATIONS') return 8;
            if (d === 'PANTRY - OPERATIONS') return 9;
            if (d === 'SECURITY - OPERATIONS') return 10;
            return 100;
        };

        return Object.entries(groups).sort(([a], [b]) => {
            const rankA = getRank(a);
            const rankB = getRank(b);
            if (rankA !== rankB) return rankA - rankB;
            return a.localeCompare(b);
        });
    }, [staff]);

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days = viewDate ? [viewDate.getDate()] : Array.from({ length: daysInMonth }, (_, i) => i + 1);

    const now = new Date();
    const isCurrentMonth = now.getFullYear() === year && now.getMonth() === month;
    const currentDay = now.getDate();

    React.useEffect(() => {
        if (todayRef.current && containerRef.current) {
            // Small timeout to ensure rendering is complete before scrolling
            setTimeout(() => {
                todayRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            }, 100);
        }
    }, [month, year, staff.length, viewDate]);

    const getAssignment = (userId: string, dateStr: string) => {
        return rosters.find(r => r.user_id === userId && r.roster_date === dateStr);
    };

    const handleKeyDown = (e: React.KeyboardEvent, userId: string) => {
        if (e.key === 'Enter') {
            onUpdateDesignation(userId, editValue);
            setEditingUserId(null);
        } else if (e.key === 'Escape') {
            setEditingUserId(null);
        }
    };

    return (
        <div ref={containerRef} className="overflow-x-auto border rounded-lg bg-white shadow-sm mt-4 scroll-smooth">
            <table className="w-full text-sm text-left border-collapse min-w-max">
                <thead className="text-xs uppercase bg-gray-100 border-b">
                    <tr>
                        <th className="px-4 py-3 border-r min-w-[200px] sticky left-0 bg-gray-100 z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">Staff Name</th>
                        {days.map(d => {
                            const date = new Date(year, month, d);
                            const isToday = isCurrentMonth && d === currentDay;
                            return (
                                <th 
                                    key={d} 
                                    ref={isToday ? todayRef : null}
                                    className={`px-2 py-2 border-r text-center min-w-[60px] relative group ${isToday ? 'bg-blue-100/60 ring-1 ring-blue-300' : ''}`}
                                >
                                    <div>{d.toString().padStart(2, '0')}</div>
                                    <div className="text-[10px] text-gray-500">
                                        {date.toLocaleDateString('en-US', { weekday: 'short' })}
                                    </div>
                                    {onCopyDay && (
                                        <button 
                                            onClick={() => {
                                                const dateStr = `${year}-${(month + 1).toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
                                                onCopyDay(dateStr);
                                            }}
                                            className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-0.5 bg-white border rounded shadow hover:text-blue-600 transition-opacity"
                                            title="Copy to next day"
                                        >
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                                        </button>
                                    )}
                                </th>
                            );
                        })}
                    </tr>
                </thead>
                <tbody>
                    {sortedGroups.map(([designation, members]) => (
                        <React.Fragment key={designation}>
                            {/* Designation Group Header */}
                            <tr className="bg-gray-200">
                                <td colSpan={daysInMonth + 1} className="py-2 border-b text-left">
                                    <span className="sticky left-1/2 -translate-x-1/2 font-bold text-gray-700 text-xs inline-block z-10">
                                        {designation.toUpperCase()}
                                    </span>
                                </td>
                            </tr>
                            
                            {/* Staff Rows */}
                            {members.map(member => (
                                <tr key={member.user_id} className="border-b hover:bg-gray-50 transition-colors group/row">
                                    <td className="px-4 py-3 border-r sticky left-0 bg-white shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] z-10 flex items-center justify-between min-h-[48px]">
                                        {editingUserId === member.user_id ? (
                                            <select
                                                autoFocus
                                                className="w-full text-xs p-1 border rounded focus:outline-none focus:ring-1"
                                                value={editValue}
                                                onChange={e => {
                                                    setEditValue(e.target.value);
                                                    onUpdateDesignation(member.user_id, e.target.value);
                                                    setEditingUserId(null);
                                                }}
                                                onBlur={() => setEditingUserId(null)}
                                            >
                                                <option value="">-- Select Role --</option>
                                                <option value="ASSISTANT MANAGER - TECHNICAL">ASSISTANT MANAGER - TECHNICAL</option>
                                                <option value="EXECUTIVE - TECHNICAL">EXECUTIVE - TECHNICAL</option>
                                                <option value="BMS OPERATOR">BMS OPERATOR</option>
                                                <option value="MST">MST</option>
                                                <option value="ASSISTANT MANAGER - OPERATIONS">ASSISTANT MANAGER - OPERATIONS</option>
                                                <option value="FACILITY EXECUTIVE - OPERATIONS">FACILITY EXECUTIVE - OPERATIONS</option>
                                                <option value="TRAINEE - OPERATIONS">TRAINEE - OPERATIONS</option>
                                                <option value="HOUSEKEEPING - OPERATIONS">HOUSEKEEPING - OPERATIONS</option>
                                                <option value="PANTRY - OPERATIONS">PANTRY - OPERATIONS</option>
                                                <option value="SECURITY - OPERATIONS">SECURITY - OPERATIONS</option>
                                            </select>
                                        ) : (
                                            <>
                                                {renamingUserId === member.user_id ? (
                                                    <input
                                                        autoFocus
                                                        className="w-full text-xs p-1 border rounded focus:outline-none focus:ring-1"
                                                        defaultValue={member.users.full_name}
                                                        onKeyDown={e => {
                                                            if (e.key === 'Enter') {
                                                                onRenameOfflineStaff(member.user_id, e.currentTarget.value);
                                                                setRenamingUserId(null);
                                                            } else if (e.key === 'Escape') {
                                                                setRenamingUserId(null);
                                                            }
                                                        }}
                                                        onBlur={e => {
                                                            onRenameOfflineStaff(member.user_id, e.target.value);
                                                            setRenamingUserId(null);
                                                        }}
                                                    />
                                                ) : (
                                                    <div className="flex items-center gap-1">
                                                        <span className="font-medium truncate pr-2" title={member.users.full_name}>
                                                            {member.users.full_name}
                                                        </span>
                                                        {member.role === 'offline' && (
                                                            <button onClick={() => setRenamingUserId(member.user_id)} className="text-gray-400 hover:text-blue-500 flex-shrink-0" title="Rename Staff">
                                                                <Pencil className="w-3 h-3" />
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                                <div className="flex items-center gap-2 opacity-0 group-hover/row:opacity-100 transition-opacity">
                                                    <button
                                                        onClick={() => {
                                                            setEditValue(member.custom_designation || member.users.designation || member.role || '');
                                                            setEditingUserId(member.user_id);
                                                        }}
                                                        className="text-gray-400 hover:text-blue-500 transition-colors"
                                                        title="Edit Role"
                                                    >
                                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                                                    </button>
                                                    {onRemoveStaff && (
                                                        <button
                                                            onClick={() => {
                                                                if (window.confirm(`Are you sure you want to remove ${member.users.full_name} from the roster?`)) {
                                                                    onRemoveStaff(member.user_id, member.role === 'offline');
                                                                }
                                                            }}
                                                            className="text-gray-400 hover:text-red-500 transition-colors"
                                                            title="Remove Staff"
                                                        >
                                                            <Trash2 className="w-3 h-3" />
                                                        </button>
                                                    )}
                                                </div>
                                            </>
                                        )}
                                    </td>
                                    
                                    {days.map(d => {
                                        const dateStr = `${year}-${(month + 1).toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
                                        const assignment = getAssignment(member.user_id, dateStr);
                                        const activeConfig = configs.find(c => c.id === assignment?.shift_id);
                                        
                                        let bgColor = 'transparent';
                                        let textColor = 'inherit';
                                        if (activeConfig) {
                                            if (activeConfig.code === 'Leave' || activeConfig.code === 'L') {
                                                bgColor = '#ef4444'; // Red
                                                textColor = 'white';
                                            } else if (activeConfig.code.includes('W/O') || !activeConfig.is_working_day) {
                                                bgColor = '#38bdf8'; // Blue
                                                textColor = 'white';
                                            }
                                        }

                                        const updaterName = assignment?.updater?.full_name;
                                        const tooltip = updaterName ? `Updated by: ${updaterName}` : undefined;

                                        const isToday = isCurrentMonth && d === currentDay;

                                        return (
                                            <td 
                                                key={d} 
                                                className={`border-r p-1 text-center relative group ${isToday ? 'bg-blue-50/30 border-blue-200' : ''}`}
                                                style={{ backgroundColor: bgColor !== 'transparent' ? bgColor : undefined, color: textColor }}
                                                title={tooltip}
                                            >
                                                <select
                                                    className="w-full bg-transparent border-none text-xs text-center cursor-pointer focus:ring-0 appearance-none font-semibold"
                                                    style={{ color: textColor }}
                                                    value={assignment?.shift_id || ''}
                                                    onChange={(e) => onCellChange(member.user_id, dateStr, e.target.value)}
                                                >
                                                    <option value="" className="text-black">-</option>
                                                    {configs.map(c => (
                                                        <option key={c.id} value={c.id} className="text-black">
                                                            {c.code}
                                                        </option>
                                                    ))}
                                                    <option value="custom_time" className="text-primary font-bold">
                                                        + Custom Time...
                                                    </option>
                                                </select>
                                                
                                                {/* Show timings for working days */}
                                                {activeConfig?.is_working_day && activeConfig.start_time && activeConfig.end_time && (
                                                    <div className="text-[9px] opacity-80 mt-[-2px] pb-1 pointer-events-none tracking-tighter" style={{ color: textColor }}>
                                                        {activeConfig.start_time.slice(0, 5)}-{activeConfig.end_time.slice(0, 5)}
                                                    </div>
                                                )}
                                                
                                                {/* Reliever Indicator */}
                                                {assignment?.is_reliever && (
                                                    <div className="absolute top-0 right-0 w-2 h-2 bg-yellow-400 rounded-full" title="Reliever Shift"></div>
                                                )}

                                                {/* Right click to toggle reliever */}
                                                {assignment && (
                                                    <button 
                                                        onClick={(e) => { e.preventDefault(); onToggleReliever(member.user_id, dateStr); }}
                                                        className="absolute inset-0 opacity-0 group-hover:opacity-100 flex items-end justify-end p-1 pointer-events-none"
                                                    >
                                                        <span className="text-[8px] bg-black text-white px-1 rounded pointer-events-auto cursor-pointer" title="Toggle Reliever">
                                                            {assignment.is_reliever ? 'R' : '+R'}
                                                        </span>
                                                    </button>
                                                )}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </React.Fragment>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
