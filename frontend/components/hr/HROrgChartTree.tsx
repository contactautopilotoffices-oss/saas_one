'use client';

import React, { useState, useMemo } from 'react';
import {
    ChevronDown, ChevronRight, User, Users, Clock, Shield, Briefcase, 
    Crown, ExternalLink, Ticket, Filter, AlertCircle, ArrowUpRight, Search, 
    CheckCircle2, Key, FileText, UserCheck, Wrench, X, Mail, Phone, MapPin, 
    Building2, Hash, ShieldCheck, CheckCircle, Info, ZoomIn, ZoomOut, Maximize2, RotateCcw
} from 'lucide-react';

import { formatAppRole } from '../../lib/accounts/roles';

interface HROrgChartTreeProps {
    employees: any[];
    tickets: any[];
    onSelectEmployee?: (emp: any) => void;
    onSelectTicket?: (ticketId: string) => void;
}

export default function HROrgChartTree({
    employees = [],
    tickets = [],
    onSelectEmployee,
    onSelectTicket
}: HROrgChartTreeProps) {
    const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});
    const [searchQuery, setSearchQuery] = useState('');
    const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
    const [selectedEmpId, setSelectedEmpId] = useState<string | null>(null);
    const [inspectingEmp, setInspectingEmp] = useState<any | null>(null);
    const [activeDetailTab, setActiveDetailTab] = useState<'profile' | 'app' | 'workload' | 'reportees'>('profile');
    const [zoomLevel, setZoomLevel] = useState<number>(1);
    const canvasRef = React.useRef<HTMLDivElement>(null);

    // Mouse drag panning state & refs
    const [isDragging, setIsDragging] = useState(false);
    const dragStartPos = React.useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });
    const hasDragged = React.useRef(false);
    const lastTouchTime = React.useRef(0);

    // Center horizontal scroll view helper
    const centerScroll = React.useCallback(() => {
        setTimeout(() => {
            if (canvasRef.current) {
                const el = canvasRef.current;
                const scrollableWidth = el.scrollWidth - el.clientWidth;
                if (scrollableWidth > 0) {
                    el.scrollLeft = scrollableWidth / 2;
                }
            }
        }, 60);
    }, []);

    // Center scroll on mount
    React.useEffect(() => {
        centerScroll();
    }, [centerScroll]);

    // Map-style Cursor-Centered Zooming Helper
    const zoomAtPoint = React.useCallback((clientX: number, clientY: number, factorOrTarget: number) => {
        if (!canvasRef.current) return;
        const el = canvasRef.current;
        const rect = el.getBoundingClientRect();

        const cursorX = clientX - rect.left;
        const cursorY = clientY - rect.top;

        setZoomLevel(prevZoom => {
            let targetZoom = prevZoom;
            if (factorOrTarget > 0 && factorOrTarget <= 3 && factorOrTarget !== 1) {
                targetZoom = Number((prevZoom * factorOrTarget).toFixed(3));
            } else if (factorOrTarget === 1) {
                targetZoom = 1;
            } else {
                targetZoom = factorOrTarget;
            }

            targetZoom = Math.min(Math.max(targetZoom, 0.35), 1.6);
            if (Math.abs(targetZoom - prevZoom) < 0.0001) return prevZoom;

            const ratio = targetZoom / prevZoom;
            const newScrollLeft = (el.scrollLeft + cursorX) * ratio - cursorX;
            const newScrollTop = (el.scrollTop + cursorY) * ratio - cursorY;

            requestAnimationFrame(() => {
                if (canvasRef.current) {
                    canvasRef.current.scrollLeft = Math.max(0, newScrollLeft);
                    canvasRef.current.scrollTop = Math.max(0, newScrollTop);
                }
            });

            return targetZoom;
        });
    }, []);

    // Trackpad 2-finger pinch zoom & mouse wheel zooming
    React.useEffect(() => {
        const el = canvasRef.current;
        if (!el) return;

        const handleWheel = (e: WheelEvent) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                // Smooth exponential zoom for 2-finger trackpad pinch gesture & Ctrl+Wheel
                const zoomFactor = Math.pow(1.008, -e.deltaY);
                zoomAtPoint(e.clientX, e.clientY, zoomFactor);
            }
        };

        el.addEventListener('wheel', handleWheel, { passive: false });
        return () => el.removeEventListener('wheel', handleWheel);
    }, [zoomAtPoint]);

    // Zoom helper functions
    const zoomIn = () => {
        if (canvasRef.current) {
            const rect = canvasRef.current.getBoundingClientRect();
            zoomAtPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.15);
        } else {
            setZoomLevel(prev => Math.min(Number((prev + 0.12).toFixed(2)), 1.6));
        }
    };

    const zoomOut = () => {
        if (canvasRef.current) {
            const rect = canvasRef.current.getBoundingClientRect();
            zoomAtPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, 0.88);
        } else {
            setZoomLevel(prev => Math.max(Number((prev - 0.12).toFixed(2)), 0.35));
        }
    };

    const resetZoom = () => {
        setZoomLevel(1);
        centerScroll();
    };
    const fitZoom = () => {
        setZoomLevel(0.55);
        centerScroll();
    };

    // Drag-Panning Mouse Handlers
    const handleMouseDown = (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('button, input, a, select')) {
            return;
        }
        setIsDragging(true);
        hasDragged.current = false;
        if (canvasRef.current) {
            dragStartPos.current = {
                x: e.clientX,
                y: e.clientY,
                scrollLeft: canvasRef.current.scrollLeft,
                scrollTop: canvasRef.current.scrollTop
            };
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDragging || !canvasRef.current) return;
        const dx = e.clientX - dragStartPos.current.x;
        const dy = e.clientY - dragStartPos.current.y;
        if (Math.hypot(dx, dy) > 4) {
            hasDragged.current = true;
        }
        canvasRef.current.scrollLeft = dragStartPos.current.scrollLeft - dx;
        canvasRef.current.scrollTop = dragStartPos.current.scrollTop - dy;
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    const handleMouseLeave = () => {
        setIsDragging(false);
    };

    const handleDoubleClick = (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('button, input, a, select')) {
            return;
        }
        if (zoomLevel >= 1.25) {
            setZoomLevel(0.55);
            centerScroll();
        } else {
            zoomAtPoint(e.clientX, e.clientY, 1.35);
        }
    };

    // Touchscreen Multi-Touch Pinch Zoom & Double-Tap
    const touchStartDist = React.useRef<number | null>(null);
    const touchStartZoom = React.useRef<number>(1);

    const handleTouchStart = (e: React.TouchEvent) => {
        if ((e.target as HTMLElement).closest('button, input, a, select')) {
            return;
        }
        if (e.touches.length === 2) {
            const p1 = e.touches[0];
            const p2 = e.touches[1];
            touchStartDist.current = Math.hypot(p2.clientX - p1.clientX, p2.clientY - p1.clientY);
            touchStartZoom.current = zoomLevel;
            return;
        }

        const now = Date.now();
        if (now - lastTouchTime.current < 300) {
            if (zoomLevel >= 1.25) {
                setZoomLevel(0.55);
                centerScroll();
            } else {
                const touch = e.touches[0];
                if (touch) {
                    zoomAtPoint(touch.clientX, touch.clientY, 1.35);
                }
            }
        }
        lastTouchTime.current = now;
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (e.touches.length === 2 && touchStartDist.current !== null && canvasRef.current) {
            const p1 = e.touches[0];
            const p2 = e.touches[1];
            const currentDist = Math.hypot(p2.clientX - p1.clientX, p2.clientY - p1.clientY);
            if (touchStartDist.current > 0) {
                const ratio = currentDist / touchStartDist.current;
                const midX = (p1.clientX + p2.clientX) / 2;
                const midY = (p1.clientY + p2.clientY) / 2;
                zoomAtPoint(midX, midY, touchStartZoom.current * ratio);
            }
        }
    };

    const handleTouchEnd = () => {
        touchStartDist.current = null;
    };

    // Toggle collapse/expand node
    const toggleExpand = (nodeId: string) => {
        setExpandedNodes(prev => ({
            ...prev,
            [nodeId]: !(prev[nodeId] ?? true) // Default expanded
        }));
    };

    const expandAll = () => {
        const next: Record<string, boolean> = {};
        employees.forEach(e => {
            const uid = e.user_id || e.id || e.employee_code;
            if (uid) next[uid] = true;
        });
        setExpandedNodes(next);
        setZoomLevel(0.55); // Auto zoom out so full tree fits on screen
        centerScroll();
    };

    const collapseAll = () => {
        const next: Record<string, boolean> = {};
        employees.forEach(e => {
            const uid = e.user_id || e.id || e.employee_code;
            if (uid) next[uid] = false;
        });
        setExpandedNodes(next);
        setZoomLevel(1);
        centerScroll();
    };

    // Normalize manager name variations for accurate hierarchy resolution
    const normalizeManagerName = React.useCallback((str: string): string => {
        if (!str) return '';
        let s = str.trim().toLowerCase();
        
        if (s.includes('shailesh') && (s.includes('kashyap') || s === 'shailesh k')) return 'shailesh kumar kashyap';
        if (s.includes('chavan meena') || s.includes('meena chavan')) return 'meena chavan';
        if (s.includes('rajesh') && s.includes('kadam')) return 'rajesh kadam';
        if (s.includes('mehul') && s.includes('kapadia')) return 'mehul kapadia';
        if (s.includes('shrihari') || s.includes('gardas')) return 'shrihari gardas';
        if (s.includes('roohi') && (s.includes('idirishi') || s.includes('idrishi'))) return 'roohi idirishi';
        if (s.includes('siddhalingappa')) return 'siddhalingappa nagond';
        if (s.includes('suraj') && (s.includes('nandavadekar') || s.includes('nandavadkar'))) return 'suraj nandavadekar';
        if (s.includes('altamash')) return 'altamash chaugule';
        if (s.includes('abhiram')) return 'abhiram k';
        if (s.includes('kiran') && (s.includes('kumar') || s === 'kiran')) return 'kiran kumar';
        
        return s;
    }, []);

    // Direct reportees finder for a manager profile
    const getDirectReportees = React.useCallback((mgr: any): any[] => {
        if (!mgr) return [];
        const mgrUid = mgr.user_id || mgr.id;
        const mgrCode = (mgr.employee_code || '').toLowerCase().trim();
        const mgrFullName = `${mgr.first_name || ''} ${mgr.last_name || ''}`.trim();
        const normMgrFullName = normalizeManagerName(mgrFullName);

        return employees.filter(e => {
            const eUid = e.user_id || e.id;
            if (mgrUid && eUid === mgrUid) return false;

            const rId = e.reporting_manager_id || '';
            const rCode = (e.reporting_manager_code || '').trim();
            const rName = (e.reporting_manager_name || '').trim();
            const rStr = (rName || rCode).trim();
            const normRStr = normalizeManagerName(rStr);

            if (!rStr && !rId) return false;

            // 1. Direct ID match
            if (mgrUid && rId && (rId === mgrUid || rId === mgr.id)) return true;
            // 2. Direct Code match
            if (mgrCode && mgrCode.length > 1 && (rCode.toLowerCase() === mgrCode || rName.toLowerCase() === mgrCode)) return true;
            // 3. Exact or Normalized Name match
            if (normMgrFullName && normRStr && normRStr === normMgrFullName) return true;
            if (mgrFullName && rStr && rStr.toLowerCase() === mgrFullName.toLowerCase()) return true;

            return false;
        });
    }, [employees, normalizeManagerName]);

    // Recursive calculation for all sub-tree reportees (Direct + Indirect)
    const getAllSubTreeReportees = React.useCallback((mgr: any, visited = new Set<string>()): any[] => {
        if (!mgr) return [];
        const mgrKey = mgr.user_id || mgr.id || (mgr.employee_code || '').toLowerCase().trim() || `${mgr.first_name || ''} ${mgr.last_name || ''}`.trim().toLowerCase();
        if (!mgrKey || visited.has(mgrKey)) return [];
        const nextVisited = new Set(visited);
        nextVisited.add(mgrKey);

        const direct = getDirectReportees(mgr);
        let all = [...direct];

        for (const child of direct) {
            const sub = getAllSubTreeReportees(child, nextVisited);
            for (const s of sub) {
                const sKey = s.user_id || s.id || (s.employee_code || '').toLowerCase().trim();
                if (!all.some(item => (item.id === s.id || (sKey && (item.user_id || item.id || (item.employee_code || '').toLowerCase().trim()) === sKey)))) {
                    all.push(s);
                }
            }
        }
        return all;
    }, [getDirectReportees]);

    // Calculate indirect reportees (All sub-tree reportees excluding direct)
    const getIndirectReportees = React.useCallback((mgr: any): any[] => {
        const direct = getDirectReportees(mgr);
        const directKeys = new Set(direct.map(d => d.user_id || d.id || (d.employee_code || '').toLowerCase().trim()));
        const allTree = getAllSubTreeReportees(mgr);
        return allTree.filter(t => {
            const tKey = t.user_id || t.id || (t.employee_code || '').toLowerCase().trim();
            return !directKeys.has(tKey);
        });
    }, [getDirectReportees, getAllSubTreeReportees]);

    // Helper to resolve an employee's direct reporting manager profile
    const getManagerOfEmployee = React.useCallback((emp: any, allEmployees: any[]): any | null => {
        if (!emp) return null;
        const rId = emp.reporting_manager_id || '';
        const rCode = (emp.reporting_manager_code || '').trim();
        const rName = (emp.reporting_manager_name || '').trim();
        const rStr = (rName || rCode).trim();
        const normRStr = normalizeManagerName(rStr);

        if (!rStr && !rId) return null;

        const empUid = emp.user_id || emp.id || emp.employee_code;

        for (const m of allEmployees) {
            const mUid = m.user_id || m.id || m.employee_code;
            if (mUid && mUid === empUid) continue; // skip self

            const mCode = (m.employee_code || '').toLowerCase().trim();
            const mFullName = `${m.first_name || ''} ${m.last_name || ''}`.trim();
            const normMFullName = normalizeManagerName(mFullName);

            // 1. Direct ID match
            if (rId && mUid && (rId === mUid || rId === m.id)) return m;
            // 2. Employee Code match
            if (rCode && mCode && (rCode.toLowerCase() === mCode || rName.toLowerCase() === mCode)) return m;
            // 3. Exact or Normalized Name match
            if (normMFullName && normRStr && normRStr === normMFullName) return m;
            if (mFullName && rStr && rStr.toLowerCase() === mFullName.toLowerCase()) return m;
        }

        return null;
    }, [normalizeManagerName]);


    // Live Path & Interactive Search Tracing
    const {
        matchedEmpIds,
        pathNodeIds,
        pathEdgeKeys,
        matchedList
    } = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) {
            return {
                matchedEmpIds: new Set<string>(),
                pathNodeIds: new Set<string>(),
                pathEdgeKeys: new Set<string>(),
                matchedList: []
            };
        }

        const matched: any[] = [];
        const matchedIds = new Set<string>();
        const pathIds = new Set<string>();
        const edgeKeys = new Set<string>();

        employees.forEach(e => {
            const uid = e.user_id || e.id || e.employee_code;
            if (!uid) return;

            const name = `${e.first_name || ''} ${e.last_name || ''} ${e.name || ''} ${e.full_name || ''}`.toLowerCase();
            const code = (e.employee_code || '').toLowerCase();
            const dept = (e.department || '').toLowerCase();
            const desig = (e.designation || '').toLowerCase();
            const email = (e.email || e.app_email || '').toLowerCase();

            if (name.includes(q) || code.includes(q) || dept.includes(q) || desig.includes(q) || email.includes(q)) {
                matched.push(e);
                matchedIds.add(uid);
                pathIds.add(uid);
            }
        });

        // Trace path upwards for each matched employee to top leadership root
        matched.forEach(emp => {
            let current = emp;
            const visited = new Set<string>();

            while (current) {
                const currentUid = current.user_id || current.id || current.employee_code;
                if (!currentUid || visited.has(currentUid)) break;
                visited.add(currentUid);
                pathIds.add(currentUid);

                const mgr = getManagerOfEmployee(current, employees);
                if (mgr) {
                    const mgrUid = mgr.user_id || mgr.id || mgr.employee_code;
                    if (mgrUid) {
                        pathIds.add(mgrUid);
                        edgeKeys.add(`${mgrUid}->${currentUid}`);
                    }
                }
                current = mgr;
            }
        });

        return {
            matchedEmpIds: matchedIds,
            pathNodeIds: pathIds,
            pathEdgeKeys: edgeKeys,
            matchedList: matched
        };
    }, [employees, searchQuery, getManagerOfEmployee]);

    // Determine root leadership nodes vs standalone staff
    const { rootNodes, standaloneStaff } = useMemo(() => {
        const directors: any[] = [];

        // First pass: Find actual Directors & Executive Leadership
        employees.forEach(e => {
            const desig = (e.designation || '').toLowerCase();
            const isDirector = Boolean(
                e.is_director_authority ||
                e.is_director ||
                desig.includes('director') ||
                desig === 'md' ||
                desig === 'ceo' ||
                desig.includes('managing director') ||
                desig.includes('chief executive')
            );

            if (isDirector) {
                directors.push(e);
            }
        });

        if (directors.length > 0) {
            const directorUserIds = new Set(directors.map(d => d.user_id || d.id || d.employee_code));
            const standaloneList = employees.filter(e => {
                const uid = e.user_id || e.id || e.employee_code;
                if (directorUserIds.has(uid)) return false;

                const rCode = (e.reporting_manager_code || '').trim();
                const rId = (e.reporting_manager_id || '').trim();
                const rName = (e.reporting_manager_name || '').trim();
                const hasNoManager = !rCode && !rId && !rName;
                const hasReportees = getDirectReportees(e).length > 0;

                return hasNoManager && !hasReportees;
            });

            return { rootNodes: directors, standaloneStaff: standaloneList };
        }

        // Fallback: If no explicit directors, pick top employees without a manager
        const topRoots = employees.filter(e => {
            const rCode = (e.reporting_manager_code || '').trim();
            const rId = (e.reporting_manager_id || '').trim();
            const rName = (e.reporting_manager_name || '').trim();
            return !rCode && !rId && !rName;
        });

        return { rootNodes: topRoots.length > 0 ? topRoots : employees.slice(0, 10), standaloneStaff: [] };
    }, [employees, getDirectReportees]);

    // Auto-expand all parent/ancestor nodes along the live path when search query changes
    React.useEffect(() => {
        if (searchQuery.trim() && pathNodeIds.size > 0) {
            setExpandedNodes(prev => {
                const next = { ...prev };
                pathNodeIds.forEach(id => {
                    next[id] = true;
                });
                return next;
            });
        }
    }, [searchQuery, pathNodeIds]);

    // Reset match index when search query changes
    React.useEffect(() => {
        setCurrentMatchIndex(0);
    }, [searchQuery]);

    // Smoothly scroll and center canvas to target match node
    React.useEffect(() => {
        if (searchQuery.trim() && matchedList.length > 0) {
            const targetEmp = matchedList[currentMatchIndex % matchedList.length];
            if (!targetEmp) return;
            const targetUid = targetEmp.user_id || targetEmp.id || targetEmp.employee_code;

            const timer = setTimeout(() => {
                const cardEl = document.getElementById(`node-card-${targetUid}`);
                if (cardEl) {
                    cardEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
                }
            }, 120);
            return () => clearTimeout(timer);
        }
    }, [searchQuery, currentMatchIndex, matchedList]);

    // Handle employee click
    const handleEmpClick = (emp: any) => {
        if (hasDragged.current) {
            hasDragged.current = false;
            return;
        }
        const uid = emp.user_id || emp.id || emp.employee_code;
        setSelectedEmpId(uid);
        setInspectingEmp(emp);
        if (onSelectEmployee) {
            onSelectEmployee(emp);
        }
    };

    // Smart role/designation badge
    const renderRoleBadge = (emp: any, hasChildren: boolean, isDirector: boolean) => {
        const desig = (emp.designation || '').toLowerCase();
        const appRole = (emp.app_role || '').toLowerCase();

        if (isDirector) {
            return (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 flex items-center gap-1 shrink-0">
                    <Crown className="w-3 h-3 text-amber-500 fill-amber-500" />
                    Director / Executive
                </span>
            );
        }

        if (['hr', 'hr_head', 'hr_manager', 'org_super_admin', 'ops_super_admin', 'org_admin'].includes(appRole)) {
            const roleLabel = appRole === 'hr_head' ? 'HR Head' : appRole === 'org_super_admin' ? 'Org Admin' : appRole.toUpperCase();
            return (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-teal-50 dark:bg-teal-950/80 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 flex items-center gap-1 shrink-0">
                    <Shield className="w-3 h-3 text-teal-600" />
                    {roleLabel}
                </span>
            );
        }

        if (hasChildren || desig.includes('manager') || desig.includes('lead') || desig.includes('head') || desig.includes('vp') || desig.includes('gm')) {
            const badgeText = desig.includes('general manager') ? 'General Manager' : desig.includes('senior manager') ? 'Senior Manager' : desig.includes('assistant manager') ? 'Assistant Manager' : 'Manager';
            return (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1 shrink-0">
                    <Briefcase className="w-3 h-3" />
                    {badgeText}
                </span>
            );
        }

        if (desig.includes('technician') || desig.includes('mst') || desig.includes('bms') || desig.includes('operator')) {
            return (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 flex items-center gap-1 shrink-0">
                    <Wrench className="w-3 h-3" />
                    Technician / Operator
                </span>
            );
        }

        if (desig.includes('executive') || desig.includes('supervisor') || desig.includes('lead')) {
            return (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-sky-50 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300 border border-sky-200 dark:border-sky-800 flex items-center gap-1 shrink-0">
                    <UserCheck className="w-3 h-3" />
                    Executive / Supervisor
                </span>
            );
        }

        return (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 shrink-0">
                {emp.designation || 'Staff'}
            </span>
        );
    };

    // Render individual org card component
    const renderNodeCard = (emp: any, depth = 0, ancestors = new Set<string>()) => {
        const empUid = emp.user_id || emp.id || emp.employee_code;
        const empCode = (emp.employee_code || '').toLowerCase().trim();
        const empName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || emp.full_name || emp.name || emp.email || 'Employee';
        const empNameLower = empName.toLowerCase().trim();

        const nodeKey = empUid || empCode || empNameLower;
        if (!nodeKey || ancestors.has(nodeKey)) {
            return null; // Prevent recursion
        }
        const nextAncestors = new Set(ancestors);
        nextAncestors.add(nodeKey);

        const directReportees = getDirectReportees(emp);
        const indirectReportees = getIndirectReportees(emp);
        const totalReportees = getAllSubTreeReportees(emp);
        const hasChildren = directReportees.length > 0;
        const isExpanded = expandedNodes[empUid] ?? (depth < 2);

        const desigLower = (emp.designation || '').toLowerCase();
        const isDirector = Boolean(
            emp.is_director_authority ||
            emp.is_director ||
            desigLower.includes('director') ||
            desigLower.includes('md') ||
            desigLower.includes('ceo')
        );

        // Live Path & Search Highlights
        const isSearchActive = Boolean(searchQuery.trim());
        const isTargetMatch = matchedEmpIds.has(empUid);
        const isOnPathNode = pathNodeIds.has(empUid);
        const isNonPathNode = isSearchActive && !isOnPathNode;

        // Assigned tickets count
        const empTickets = tickets.filter(t => t.assigned_to_user_id === empUid);
        const pendingCount = empTickets.filter(t => !['resolved', 'closed'].includes(t.status)).length;
        const isSelected = selectedEmpId === empUid;
        const isAppLinked = Boolean(emp.is_app_linked || emp.user_id);

        const hasActivePathChild = directReportees.some(child => {
            const cUid = child.user_id || child.id || child.employee_code;
            return pathEdgeKeys.has(`${empUid}->${cUid}`);
        });

        // Determine Card Border & Glow Styles
        const getCardStyles = () => {
            if (isTargetMatch) {
                return 'border-emerald-500 ring-4 ring-emerald-500/60 bg-emerald-50/90 dark:bg-emerald-950/70 shadow-[0_0_25px_rgba(16,185,129,0.45)] scale-105 z-20 animate-pulse-subtle';
            }
            if (isOnPathNode) {
                return 'border-[#587e85] ring-2 ring-[#587e85]/60 bg-teal-50/75 dark:bg-teal-950/40 shadow-lg z-15';
            }
            if (isNonPathNode) {
                return 'opacity-35 grayscale-[50%] hover:opacity-100 hover:grayscale-0 transition-all duration-200 border-slate-200 dark:border-slate-800';
            }
            if (isSelected) {
                return 'border-[#587e85] ring-2 ring-[#587e85]/40 bg-[#587e85]/5 dark:bg-[#587e85]/10 scale-102 z-10';
            }
            if (isDirector) {
                return 'border-indigo-200 dark:border-indigo-900/60 bg-gradient-to-b from-indigo-50/40 via-white to-white dark:from-indigo-950/20 dark:via-slate-900 dark:to-slate-900';
            }
            return 'border-slate-200 dark:border-slate-800 hover:border-[#587e85]/60';
        };

        return (
            <div key={emp.id || empUid} id={`node-card-${empUid}`} className="flex flex-col items-center relative transition-all duration-300">
                {/* Employee Card */}
                <div
                    onClick={() => handleEmpClick(emp)}
                    className={`w-72 p-4 rounded-3xl border transition-all duration-200 cursor-pointer relative bg-white dark:bg-slate-900 shadow-sm hover:shadow-md ${getCardStyles()}`}
                >
                    {/* Top Header: Category Badge & App Link Status */}
                    <div className="flex items-center justify-between gap-1 mb-2.5">
                        {isTargetMatch ? (
                            <span className="px-2.5 py-0.5 rounded-full text-[9.5px] font-black uppercase tracking-wider bg-emerald-600 text-white shadow-xs flex items-center gap-1 shrink-0 animate-pulse">
                                <Search className="w-2.5 h-2.5" />
                                Target Match
                            </span>
                        ) : isOnPathNode ? (
                            <span className="px-2.5 py-0.5 rounded-full text-[9.5px] font-black uppercase tracking-wider bg-[#587e85] text-white shadow-xs flex items-center gap-1 shrink-0">
                                <ArrowUpRight className="w-2.5 h-2.5" />
                                Path Node
                            </span>
                        ) : (
                            renderRoleBadge(emp, hasChildren, isDirector)
                        )}

                        <div className="flex items-center gap-1 shrink-0">
                            {isAppLinked ? (
                                <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 text-[9.5px] font-extrabold flex items-center gap-0.5" title="App Account Linked">
                                    <Key className="w-2.5 h-2.5" />
                                    App
                                </span>
                            ) : (
                                <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 text-[9.5px] font-medium flex items-center gap-0.5" title="HR Profile Only">
                                    <FileText className="w-2.5 h-2.5" />
                                    HR Record
                                </span>
                            )}

                            {emp.employee_code && (
                                <span className="text-[10px] font-mono font-bold text-slate-600 dark:text-slate-400 px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">
                                    {emp.employee_code}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Employee Profile Details */}
                    <div className="flex items-center gap-3">
                        <div className={`w-11 h-11 rounded-2xl font-black flex items-center justify-center text-sm shrink-0 border ${
                            isTargetMatch
                                ? 'bg-emerald-600 text-white border-emerald-400 shadow-sm'
                                : isDirector 
                                ? 'bg-indigo-600 text-white border-indigo-400 shadow-xs' 
                                : 'bg-[#587e85] text-white border-[#587e85]/40'
                        }`}>
                            {empName.slice(0, 2).toUpperCase()}
                        </div>

                        <div className="min-w-0 flex-1">
                            <h4 className="text-xs font-black text-slate-900 dark:text-white truncate">
                                {empName}
                            </h4>
                            <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 truncate">
                                {emp.designation || 'Staff'}
                            </p>
                            <p className="text-[10px] font-medium text-slate-400 dark:text-slate-500 truncate">
                                {emp.department || 'Operations'} {emp.location ? `• ${emp.location}` : ''}
                            </p>
                        </div>
                    </div>

                    {/* Footer Workload & Reportee Badges */}
                    <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-1 text-[11px]">
                        <div className="flex items-center gap-1 flex-wrap">
                            {hasChildren ? (
                                <>
                                    <span className="px-2 py-0.5 rounded-full font-extrabold text-[10px] bg-slate-100 dark:bg-slate-800 text-[#587e85]" title="Direct Reportees">
                                        {directReportees.length} Direct
                                    </span>
                                    {indirectReportees.length > 0 && (
                                        <span className="px-2 py-0.5 rounded-full font-bold text-[10px] bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300" title="Indirect Reportees">
                                            {indirectReportees.length} Ind.
                                        </span>
                                    )}
                                </>
                            ) : (
                                <span className="text-[10px] text-slate-400 font-medium">
                                    Individual Contributor
                                </span>
                            )}
                        </div>

                        <div className="flex items-center gap-1">
                            {pendingCount > 0 ? (
                                <span className="px-2 py-0.5 rounded-full font-black text-[10px] bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300/60 flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    {pendingCount} Pending
                                </span>
                            ) : (
                                <span className="px-2 py-0.5 rounded-full font-bold text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-400">
                                    0 Pending
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Expand/Collapse Toggle Button for Parent Nodes */}
                    {hasChildren && (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                toggleExpand(empUid);
                            }}
                            className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center shadow-xs hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors z-20"
                            title={isExpanded ? 'Collapse reportees' : 'Expand reportees'}
                        >
                            {isExpanded ? (
                                <ChevronDown className="w-3.5 h-3.5 text-[#587e85] rotate-180 transition-transform duration-200" />
                            ) : (
                                <ChevronDown className="w-3.5 h-3.5 text-slate-500 transition-transform duration-200" />
                            )}
                        </button>
                    )}
                </div>

                {/* Sub-tree Connector Lines & Children Nodes */}
                {hasChildren && isExpanded && (
                    <div className="flex flex-col items-center w-full pt-6 relative">
                        {/* Vertical line from parent card down into children container */}
                        <div className={`transition-all duration-300 h-6 absolute top-0 ${
                            hasActivePathChild
                                ? 'w-1 bg-[#587e85] dark:bg-teal-400 shadow-[0_0_12px_rgba(88,126,133,0.9)] z-10'
                                : 'w-0.5 bg-slate-300 dark:bg-slate-700'
                        }`} />

                        {/* Children Row Container */}
                        <div className="flex items-start justify-center gap-6 relative pt-6">
                            {directReportees.map((childEmp, idx) => {
                                const childUid = childEmp.user_id || childEmp.id || childEmp.employee_code;
                                const isFirst = idx === 0;
                                const isLast = idx === directReportees.length - 1;
                                const isOnly = directReportees.length === 1;
                                const isEdgeOnPath = pathEdgeKeys.has(`${empUid}->${childUid}`);

                                return (
                                    <div key={childEmp.id || childEmp.user_id || childUid} className="flex flex-col items-center relative">
                                        {/* Horizontal Line Segment across child card headers */}
                                        {!isOnly && (
                                            <div className={`absolute top-0 transition-all duration-300 ${
                                                isEdgeOnPath
                                                    ? 'h-1 bg-[#587e85] dark:bg-teal-400 shadow-[0_0_12px_rgba(88,126,133,0.9)] z-10'
                                                    : 'h-0.5 bg-slate-300 dark:bg-slate-700'
                                            } ${
                                                isFirst ? 'left-1/2 right-0' : isLast ? 'left-0 right-1/2' : 'left-0 right-0'
                                            }`} />
                                        )}
                                        {/* Vertical connector line down to child card top */}
                                        <div className={`transition-all duration-300 h-6 absolute top-0 ${
                                            isEdgeOnPath
                                                ? 'w-1 bg-[#587e85] dark:bg-teal-400 shadow-[0_0_12px_rgba(88,126,133,0.9)] z-10'
                                                : 'w-0.5 bg-slate-300 dark:bg-slate-700'
                                        }`} />

                                        {renderNodeCard(childEmp, depth + 1, nextAncestors)}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="w-full space-y-6 relative">
            {/* Toolbar Controls */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-[#587e85]/10 text-[#587e85] rounded-xl">
                        <Users className="w-4 h-4" />
                    </div>
                    <div>
                        <h3 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider">
                            Interactive Visual Org Chart
                        </h3>
                        <p className="text-[11px] text-slate-500 font-medium">
                            Top-down reporting hierarchy structure. Directors at top → Reportees branching below. Click any card for details.
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative flex items-center">
                        <Search className="w-3.5 h-3.5 absolute left-3 text-slate-400 pointer-events-none" />
                        <input
                            type="text"
                            placeholder="Search employee / live path..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-8 pr-8 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#587e85] w-52 sm:w-60 transition-all"
                        />
                        {searchQuery && (
                            <button
                                type="button"
                                onClick={() => setSearchQuery('')}
                                className="absolute right-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-white p-0.5 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                                title="Clear search"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>

                    {/* Match Counter & Next/Prev match focus buttons */}
                    {searchQuery.trim() && (
                        matchedList.length > 0 ? (
                            <div className="flex items-center gap-1.5 bg-[#587e85]/10 border border-[#587e85]/30 rounded-xl px-2.5 py-1 text-xs text-[#587e85] dark:text-teal-300 font-extrabold shadow-2xs">
                                <span className="flex items-center gap-1.5">
                                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                                    {currentMatchIndex + 1} of {matchedList.length} {matchedList.length === 1 ? 'Match' : 'Matches'}
                                </span>
                                {matchedList.length > 1 && (
                                    <div className="flex items-center gap-1 ml-1 pl-1.5 border-l border-[#587e85]/20">
                                        <button
                                            type="button"
                                            onClick={() => setCurrentMatchIndex(prev => (prev > 0 ? prev - 1 : matchedList.length - 1))}
                                            className="px-1.5 py-0.5 rounded hover:bg-[#587e85]/20 font-black text-[11px] text-[#587e85] dark:text-teal-300"
                                            title="Focus previous match"
                                        >
                                            ◀
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setCurrentMatchIndex(prev => (prev + 1) % matchedList.length)}
                                            className="px-1.5 py-0.5 rounded hover:bg-[#587e85]/20 font-black text-[11px] text-[#587e85] dark:text-teal-300"
                                            title="Focus next match"
                                        >
                                            ▶
                                        </button>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <span className="text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 px-2.5 py-1 rounded-xl border border-amber-200 dark:border-amber-800">
                                No employee found
                            </span>
                        )
                    )}

                    <button
                        type="button"
                        onClick={expandAll}
                        className="px-3 py-1.5 rounded-xl text-xs font-extrabold bg-[#587e85]/10 text-[#587e85] dark:text-teal-300 hover:bg-[#587e85]/20 transition-colors"
                        title="Expand all nodes & auto-fit zoom"
                    >
                        Expand All
                    </button>
                    <button
                        type="button"
                        onClick={collapseAll}
                        className="px-3 py-1.5 rounded-xl text-xs font-extrabold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 transition-colors"
                    >
                        Collapse All
                    </button>
                </div>
            </div>

            {/* Live Path Active Banner */}
            {searchQuery.trim() && matchedList.length > 0 && (
                <div className="bg-gradient-to-r from-[#587e85]/15 via-emerald-500/10 to-transparent p-3.5 rounded-3xl border border-[#587e85]/30 flex flex-wrap items-center justify-between gap-3 shadow-xs animate-in fade-in">
                    <div className="flex items-center gap-2 text-xs font-extrabold text-[#587e85] dark:text-teal-300">
                        <span className="px-2.5 py-0.5 rounded-full bg-[#587e85] text-white text-[10px] font-black uppercase tracking-wider animate-pulse flex items-center gap-1 shadow-xs">
                            <Search className="w-3 h-3" />
                            Live Path Active
                        </span>
                        <span>
                            Tracing top-down reporting hierarchy for <span className="underline font-black text-slate-900 dark:text-white">{matchedList[currentMatchIndex % matchedList.length]?.first_name || matchedList[currentMatchIndex % matchedList.length]?.name || matchedList[currentMatchIndex % matchedList.length]?.employee_code || 'Employee'}</span>
                            {matchedList.length > 1 ? ` (Match ${currentMatchIndex + 1} of ${matchedList.length})` : ''}
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-white underline flex items-center gap-1"
                    >
                        <X className="w-3.5 h-3.5" />
                        Clear filter
                    </button>
                </div>
            )}

            {/* Visual Org Chart Canvas Container */}
            <div
                ref={canvasRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
                onDoubleClick={handleDoubleClick}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                className={`w-full overflow-auto bg-slate-50/50 dark:bg-slate-950/40 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-inner min-h-[580px] max-h-[780px] relative select-none ${
                    isDragging ? 'cursor-grabbing' : 'cursor-grab'
                }`}
            >
                {/* Floating Canvas Quick Zoom Overlay */}
                <div className="sticky top-4 right-4 z-30 float-right flex items-center gap-1.5 p-1.5 mr-4 rounded-2xl bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border border-slate-200 dark:border-slate-700 shadow-lg text-slate-700 dark:text-slate-200 pointer-events-auto">
                    <button
                        type="button"
                        onClick={zoomOut}
                        disabled={zoomLevel <= 0.25}
                        className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-30"
                        title="Zoom Out"
                    >
                        <ZoomOut className="w-4 h-4" />
                    </button>

                    <span className="text-xs font-mono font-black px-1.5 py-0.5 min-w-[42px] text-center select-none text-[#587e85] dark:text-teal-300">
                        {Math.round(zoomLevel * 100)}%
                    </span>

                    <button
                        type="button"
                        onClick={zoomIn}
                        disabled={zoomLevel >= 1.5}
                        className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-30"
                        title="Zoom In"
                    >
                        <ZoomIn className="w-4 h-4" />
                    </button>

                    <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />

                    <button
                        type="button"
                        onClick={fitZoom}
                        className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-xs font-bold flex items-center gap-1"
                        title="Fit Full Tree"
                    >
                        <Maximize2 className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Fit</span>
                    </button>

                    <button
                        type="button"
                        onClick={resetZoom}
                        className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-xs font-bold flex items-center gap-1"
                        title="Reset 100%"
                    >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">100%</span>
                    </button>
                </div>

                {/* Tree View Canvas Wrapper */}
                <div className="inline-flex min-w-full justify-center p-12 w-max min-h-full">
                    {rootNodes.length === 0 ? (
                        <div className="py-20 text-center text-xs text-slate-400 font-medium my-auto">
                            No leadership or employee profile nodes found matching search.
                        </div>
                    ) : (
                        <div
                            className="transition-transform duration-200 origin-top flex items-start justify-center gap-12 pb-12"
                            style={{
                                transform: `scale(${zoomLevel})`,
                                transformOrigin: 'top center',
                            }}
                        >
                            {rootNodes.map(rootEmp => renderNodeCard(rootEmp, 0))}
                        </div>
                    )}
                </div>
            </div>

            {/* Standalone Staff Members */}
            {standaloneStaff.length > 0 && !searchQuery.trim() && (
                <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200 dark:border-slate-800 space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                        <h4 className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-2">
                            <Users className="w-4 h-4 text-slate-400" />
                            Additional Staff Members ({standaloneStaff.length})
                        </h4>
                        <span className="text-[11px] text-slate-400 font-medium">Profiles registered in HR directory</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                        {standaloneStaff.map(emp => {
                            const empUid = emp.user_id || emp.id;
                            const empName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || emp.full_name || emp.name || emp.email || 'Employee';
                            const isSelected = selectedEmpId === empUid;
                            const isAppLinked = Boolean(emp.is_app_linked || emp.user_id);

                            return (
                                <div
                                    key={emp.id || empUid}
                                    onClick={() => handleEmpClick(emp)}
                                    className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                                        isSelected 
                                            ? 'bg-[#587e85]/10 border-[#587e85]' 
                                            : 'bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-700'
                                    }`}
                                >
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        <div className="w-8 h-8 rounded-xl bg-[#587e85] text-white font-bold flex items-center justify-center text-xs shrink-0">
                                            {empName.slice(0, 2).toUpperCase()}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-xs font-black text-slate-900 dark:text-white truncate">
                                                {empName}
                                            </p>
                                            <p className="text-[10.5px] text-slate-500 truncate">
                                                {emp.designation || 'Staff'} • {emp.department || 'Operations'}
                                            </p>
                                        </div>
                                    </div>

                                    {isAppLinked ? (
                                        <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[9px] font-extrabold shrink-0">App</span>
                                    ) : (
                                        <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[9px] font-bold shrink-0">HR</span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* DETAILED EMPLOYEE INFORMATION & WORKLOAD INSPECTION MODAL DRAWER */}
            {inspectingEmp && (() => {
                const empUid = inspectingEmp.user_id || inspectingEmp.id;
                const empName = `${inspectingEmp.first_name || ''} ${inspectingEmp.last_name || ''}`.trim() || inspectingEmp.full_name || inspectingEmp.name || inspectingEmp.email || 'Employee';
                const directReps = getDirectReportees(inspectingEmp);
                const empTickets = tickets.filter(t => t.assigned_to_user_id === empUid);
                const pendingTickets = empTickets.filter(t => !['resolved', 'closed'].includes(t.status));
                const resolvedTickets = empTickets.filter(t => ['resolved', 'closed'].includes(t.status));
                const isAppLinked = Boolean(inspectingEmp.is_app_linked || inspectingEmp.user_id);

                return (
                    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-xs transition-opacity animate-in fade-in">
                        <div className="w-full max-w-xl bg-white dark:bg-slate-900 h-full shadow-2xl flex flex-col overflow-hidden border-l border-slate-200 dark:border-slate-800 animate-in slide-in-from-right duration-200">
                            {/* Drawer Header */}
                            <div className="p-5 bg-gradient-to-r from-slate-50 to-indigo-50/40 dark:from-slate-800 dark:to-slate-800/80 border-b border-slate-200 dark:border-slate-700 flex items-start justify-between gap-4">
                                <div className="flex items-center gap-3.5">
                                    <div className="w-14 h-14 rounded-2xl bg-[#587e85] text-white font-black flex items-center justify-center text-lg shadow-sm border-2 border-white dark:border-slate-700 shrink-0">
                                        {empName.slice(0, 2).toUpperCase()}
                                    </div>

                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h2 className="text-base font-black text-slate-900 dark:text-white">
                                                {empName}
                                            </h2>
                                            {inspectingEmp.employee_code && (
                                                <span className="px-2 py-0.5 rounded bg-[#587e85]/10 text-[#587e85] text-xs font-mono font-bold">
                                                    {inspectingEmp.employee_code}
                                                </span>
                                            )}
                                        </div>

                                        <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 mt-0.5">
                                            {inspectingEmp.designation || 'Staff'} • {inspectingEmp.department || 'Operations'}
                                        </p>

                                        <div className="flex items-center gap-2 mt-2">
                                            {isAppLinked ? (
                                                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300/60 flex items-center gap-1">
                                                    <Key className="w-3 h-3" />
                                                    Active App Account
                                                </span>
                                            ) : (
                                                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-300 flex items-center gap-1">
                                                    <FileText className="w-3 h-3" />
                                                    HR Record Only
                                                </span>
                                            )}

                                            {inspectingEmp.location && (
                                                <span className="text-[11px] font-medium text-slate-500 flex items-center gap-1">
                                                    <MapPin className="w-3 h-3" />
                                                    {inspectingEmp.location}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    onClick={() => setInspectingEmp(null)}
                                    className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Navigation Tabs */}
                            <div className="flex items-center border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 px-5 gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setActiveDetailTab('profile')}
                                    className={`px-3.5 py-2 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 ${
                                        activeDetailTab === 'profile'
                                            ? 'border-[#587e85] text-[#587e85]'
                                            : 'border-transparent text-slate-500 hover:text-slate-800'
                                    }`}
                                >
                                    <User className="w-3.5 h-3.5" />
                                    <span>HR Profile Info</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setActiveDetailTab('app')}
                                    className={`px-3.5 py-2 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 ${
                                        activeDetailTab === 'app'
                                            ? 'border-[#587e85] text-[#587e85]'
                                            : 'border-transparent text-slate-500 hover:text-slate-800'
                                    }`}
                                >
                                    <Key className="w-3.5 h-3.5" />
                                    <span>App & Credentials</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setActiveDetailTab('workload')}
                                    className={`px-3.5 py-2 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 ${
                                        activeDetailTab === 'workload'
                                            ? 'border-[#587e85] text-[#587e85]'
                                            : 'border-transparent text-slate-500 hover:text-slate-800'
                                    }`}
                                >
                                    <Ticket className="w-3.5 h-3.5" />
                                    <span>Workload ({empTickets.length})</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setActiveDetailTab('reportees')}
                                    className={`px-3.5 py-2 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 ${
                                        activeDetailTab === 'reportees'
                                            ? 'border-[#587e85] text-[#587e85]'
                                            : 'border-transparent text-slate-500 hover:text-slate-800'
                                    }`}
                                >
                                    <Users className="w-3.5 h-3.5" />
                                    <span>Reportees ({getAllSubTreeReportees(inspectingEmp).length})</span>
                                </button>
                            </div>

                            {/* Tab Content Body */}
                            <div className="flex-1 overflow-y-auto p-5 space-y-5">
                                {/* TAB 1: HR PROFILE INFORMATION */}
                                {activeDetailTab === 'profile' && (
                                    <div className="space-y-4">
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 space-y-1">
                                                <p className="text-[10px] font-extrabold uppercase text-slate-400">Employee Code</p>
                                                <p className="text-xs font-black text-slate-900 dark:text-white font-mono">{inspectingEmp.employee_code || 'N/A'}</p>
                                            </div>

                                            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 space-y-1">
                                                <p className="text-[10px] font-extrabold uppercase text-slate-400">Location / Office</p>
                                                <p className="text-xs font-black text-slate-900 dark:text-white">{inspectingEmp.location || 'Lower Parel'}</p>
                                            </div>

                                            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 space-y-1">
                                                <p className="text-[10px] font-extrabold uppercase text-slate-400">Department</p>
                                                <p className="text-xs font-black text-slate-900 dark:text-white">{inspectingEmp.department || 'Operations'}</p>
                                            </div>

                                            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 space-y-1">
                                                <p className="text-[10px] font-extrabold uppercase text-slate-400">Company Designation</p>
                                                <p className="text-xs font-black text-slate-900 dark:text-white">{inspectingEmp.designation || 'Staff'}</p>
                                            </div>
                                        </div>

                                        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 space-y-3">
                                            <h4 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
                                                <Mail className="w-3.5 h-3.5 text-[#587e85]" />
                                                Contact & Reporting Info
                                            </h4>

                                            <div className="space-y-2 text-xs">
                                                <div className="flex items-center justify-between border-b border-slate-200/60 dark:border-slate-700/60 pb-2">
                                                    <span className="text-slate-500 font-medium">Personal Email:</span>
                                                    <span className="font-extrabold text-slate-900 dark:text-white font-mono">
                                                        {inspectingEmp.email || inspectingEmp.app_email || inspectingEmp.user?.email || 'N/A'}
                                                    </span>
                                                </div>

                                                {isAppLinked && (inspectingEmp.app_email || inspectingEmp.user?.email) && (
                                                    <div className="flex items-center justify-between border-b border-slate-200/60 dark:border-slate-700/60 pb-2">
                                                        <span className="text-slate-500 font-medium">App Account Email:</span>
                                                        <span className="font-extrabold text-[#587e85] font-mono">
                                                            {inspectingEmp.app_email || inspectingEmp.user?.email}
                                                        </span>
                                                    </div>
                                                )}

                                                <div className="flex items-center justify-between border-b border-slate-200/60 dark:border-slate-700/60 pb-2">
                                                    <span className="text-slate-500 font-medium">Contact Phone:</span>
                                                    <span className="font-extrabold text-slate-900 dark:text-white font-mono">{inspectingEmp.phone || inspectingEmp.contact_number || inspectingEmp.app_phone || 'N/A'}</span>
                                                </div>

                                                <div className="flex items-center justify-between">
                                                    <span className="text-slate-500 font-medium">Reporting Manager:</span>
                                                    <span className="font-extrabold text-[#587e85]">
                                                        {inspectingEmp.reporting_manager_code || inspectingEmp.reporting_manager_name || 'None (Top Management)'}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* TAB 2: APP ACCOUNT & CREDENTIALS DETAILS */}
                                {activeDetailTab === 'app' && (
                                    <div className="space-y-4">
                                        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 space-y-3">
                                            <div className="flex items-center justify-between">
                                                <h4 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
                                                    <Key className="w-3.5 h-3.5 text-[#587e85]" />
                                                    App Login & System Account
                                                </h4>
                                                {isAppLinked ? (
                                                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800">Linked</span>
                                                ) : (
                                                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-600">Unlinked</span>
                                                )}
                                            </div>

                                            <div className="space-y-2 text-xs">
                                                <div className="flex items-center justify-between border-b border-slate-200/60 dark:border-slate-700/60 pb-2">
                                                    <span className="text-slate-500 font-medium">App User ID:</span>
                                                    <span className="font-mono text-[11px] font-bold text-slate-700 dark:text-slate-300">
                                                        {inspectingEmp.user_id || 'Not generated yet'}
                                                    </span>
                                                </div>

                                                <div className="flex items-center justify-between border-b border-slate-200/60 dark:border-slate-700/60 pb-2">
                                                    <span className="text-slate-500 font-medium">App Role:</span>
                                                    <span className="font-extrabold text-indigo-600 dark:text-indigo-400 uppercase">
                                                        {formatAppRole(inspectingEmp)}
                                                    </span>
                                                </div>

                                                <div className="flex items-center justify-between border-b border-slate-200/60 dark:border-slate-700/60 pb-2">
                                                    <span className="text-slate-500 font-medium">App Email:</span>
                                                    <span className="font-mono font-bold text-slate-900 dark:text-white">{inspectingEmp.app_email || inspectingEmp.user?.email || inspectingEmp.email || 'N/A'}</span>
                                                </div>

                                                <div className="flex items-center justify-between">
                                                    <span className="text-slate-500 font-medium">HR Reconciliation Status:</span>
                                                    <span className="font-extrabold text-emerald-600 capitalize">
                                                        {inspectingEmp.reconciliation_status || (isAppLinked ? 'linked' : 'unlinked')}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* TAB 3: WORKLOAD & ASSIGNED TICKETS */}
                                {activeDetailTab === 'workload' && (
                                    <div className="space-y-4">
                                        <div className="grid grid-cols-3 gap-2">
                                            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-center">
                                                <p className="text-[10px] font-extrabold uppercase text-slate-400">Assigned</p>
                                                <p className="text-xl font-black text-slate-900 dark:text-white mt-0.5">{empTickets.length}</p>
                                            </div>
                                            <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-center">
                                                <p className="text-[10px] font-extrabold uppercase text-amber-700 dark:text-amber-400">Pending</p>
                                                <p className="text-xl font-black text-amber-900 dark:text-amber-200 mt-0.5">{pendingTickets.length}</p>
                                            </div>
                                            <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-center">
                                                <p className="text-[10px] font-extrabold uppercase text-emerald-700 dark:text-emerald-400">Resolved</p>
                                                <p className="text-xl font-black text-emerald-900 dark:text-emerald-200 mt-0.5">{resolvedTickets.length}</p>
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <h4 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider">
                                                Assigned Tickets ({empTickets.length})
                                            </h4>

                                            {empTickets.length === 0 ? (
                                                <div className="p-8 text-center text-xs text-slate-400 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-800 font-medium">
                                                    No tickets currently assigned to {empName}.
                                                </div>
                                            ) : (
                                                <div className="space-y-2">
                                                    {empTickets.map(t => (
                                                        <div
                                                            key={t.id}
                                                            onClick={() => {
                                                                if (onSelectTicket) onSelectTicket(t.id);
                                                            }}
                                                            className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 hover:border-[#587e85] transition-all cursor-pointer shadow-2xs space-y-1.5"
                                                        >
                                                            <div className="flex items-center justify-between">
                                                                <span className="text-xs font-black text-[#587e85]">#{t.ticket_number}</span>
                                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                                                                    ['resolved', 'closed'].includes(t.status)
                                                                        ? 'bg-emerald-100 text-emerald-800'
                                                                        : 'bg-amber-100 text-amber-800'
                                                                }`}>
                                                                    {t.status.replace(/_/g, ' ')}
                                                                </span>
                                                            </div>

                                                            <p className="text-xs font-bold text-slate-900 dark:text-white truncate">{t.subject}</p>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* TAB 4: REPORTEES LIST (DIRECT & INDIRECT BREAKDOWN) */}
                                {activeDetailTab === 'reportees' && (() => {
                                    const directList = getDirectReportees(inspectingEmp);
                                    const indirectList = getIndirectReportees(inspectingEmp);
                                    const totalList = getAllSubTreeReportees(inspectingEmp);

                                    return (
                                        <div className="space-y-4">
                                            {/* Reportees KPI Summary */}
                                            <div className="grid grid-cols-3 gap-2">
                                                <div className="p-3 rounded-2xl bg-[#587e85]/10 border border-[#587e85]/20 text-center">
                                                    <p className="text-[10px] font-extrabold uppercase text-[#587e85] dark:text-teal-300">Direct</p>
                                                    <p className="text-lg font-black text-slate-900 dark:text-white mt-0.5">{directList.length}</p>
                                                </div>
                                                <div className="p-3 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 text-center">
                                                    <p className="text-[10px] font-extrabold uppercase text-indigo-700 dark:text-indigo-300">Indirect</p>
                                                    <p className="text-lg font-black text-slate-900 dark:text-white mt-0.5">{indirectList.length}</p>
                                                </div>
                                                <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-center">
                                                    <p className="text-[10px] font-extrabold uppercase text-emerald-700 dark:text-emerald-300">Total Tree</p>
                                                    <p className="text-lg font-black text-emerald-900 dark:text-emerald-200 mt-0.5">{totalList.length}</p>
                                                </div>
                                            </div>

                                            {/* DIRECT REPORTEES SECTION */}
                                            <div className="space-y-2">
                                                <h4 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider flex items-center justify-between">
                                                    <span>Direct Reportees ({directList.length})</span>
                                                </h4>

                                                {directList.length === 0 ? (
                                                    <div className="p-4 text-center text-xs text-slate-400 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-800 font-medium italic">
                                                        No direct reportees assigned.
                                                    </div>
                                                ) : (
                                                    <div className="space-y-2">
                                                        {directList.map(rep => {
                                                            const repUid = rep.user_id || rep.id;
                                                            const repName = `${rep.first_name || ''} ${rep.last_name || ''}`.trim() || rep.full_name || rep.name;
                                                            return (
                                                                <div
                                                                    key={rep.id || repUid}
                                                                    onClick={() => handleEmpClick(rep)}
                                                                    className="p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer flex items-center justify-between gap-3"
                                                                >
                                                                    <div className="flex items-center gap-3">
                                                                        <div className="w-8 h-8 rounded-xl bg-[#587e85] text-white font-bold flex items-center justify-center text-xs shrink-0">
                                                                            {repName.slice(0, 2).toUpperCase()}
                                                                        </div>
                                                                        <div>
                                                                            <p className="text-xs font-black text-slate-900 dark:text-white">{repName}</p>
                                                                            <p className="text-[10.5px] text-slate-500">{rep.designation || 'Staff'} • {rep.department || 'Operations'}</p>
                                                                        </div>
                                                                    </div>

                                                                    <button
                                                                        type="button"
                                                                        className="text-xs text-[#587e85] font-bold hover:underline"
                                                                    >
                                                                        Inspect
                                                                    </button>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>

                                            {/* INDIRECT REPORTEES SECTION */}
                                            {indirectList.length > 0 && (
                                                <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                                                    <h4 className="text-xs font-black text-indigo-700 dark:text-indigo-300 uppercase tracking-wider">
                                                        Indirect Reportees ({indirectList.length})
                                                    </h4>

                                                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                                                        {indirectList.map(rep => {
                                                            const repUid = rep.user_id || rep.id;
                                                            const repName = `${rep.first_name || ''} ${rep.last_name || ''}`.trim() || rep.full_name || rep.name;
                                                            return (
                                                                <div
                                                                    key={rep.id || repUid}
                                                                    onClick={() => handleEmpClick(rep)}
                                                                    className="p-3 rounded-2xl border border-indigo-100 dark:border-indigo-950 bg-indigo-50/40 dark:bg-indigo-950/20 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-all cursor-pointer flex items-center justify-between gap-3"
                                                                >
                                                                    <div className="flex items-center gap-3">
                                                                        <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white font-bold flex items-center justify-center text-xs shrink-0">
                                                                            {repName.slice(0, 2).toUpperCase()}
                                                                        </div>
                                                                        <div>
                                                                            <p className="text-xs font-black text-slate-900 dark:text-white">{repName}</p>
                                                                            <p className="text-[10.5px] text-slate-500">
                                                                                {rep.designation || 'Staff'} • Reports to: <span className="font-bold text-slate-700 dark:text-slate-300">{rep.reporting_manager_code || rep.reporting_manager_name}</span>
                                                                            </p>
                                                                        </div>
                                                                    </div>

                                                                    <button
                                                                        type="button"
                                                                        className="text-xs text-indigo-600 font-bold hover:underline"
                                                                    >
                                                                        Inspect
                                                                    </button>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
