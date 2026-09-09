'use client';

/**
 * A TAB THAT CRASHES MUST SAY SO, NOT GO WHITE.
 * -----------------------------------------------------------------------------
 * The Delivery tab rendered blank. Not an error, not a spinner — white space.
 * From outside there is no way to tell a crashed tab from an empty one, from a
 * tab still loading, from a tab that has nothing to show. Diagnosing it meant
 * opening a browser console, which is a thing an operator will never do and a
 * thing nobody can do from a phone.
 *
 * React unmounts the whole subtree when a render throws. Without a boundary the
 * subtree is the tab, so one bad field in one panel takes the entire tab with
 * it and leaves nothing behind that names what happened.
 *
 * This is deliberately NOT a global boundary. It wraps each tab, so a crash in
 * Delivery costs Delivery and the rest of the console keeps working — the
 * blast radius is the panel, not the page.
 *
 * WHAT IT SHOWS is the point: the message, the component that threw, and the
 * first frames of the stack, on screen, copyable. The next time something goes
 * blank the report will name its own cause.
 */

import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
    /** Named in the message, so a screenshot alone identifies the panel. */
    name: string;
    /** Remount when this changes — switching agents must clear a stale error. */
    resetKey?: string;
    children: React.ReactNode;
}

interface State {
    error: Error | null;
    info: string | null;
}

export default class TabBoundary extends React.Component<Props, State> {
    state: State = { error: null, info: null };

    static getDerivedStateFromError(error: Error): Partial<State> {
        return { error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        // Still log it — a boundary that swallows the stack trades one silent
        // failure for another. The console keeps the full trace; the panel
        // below shows the part a person can act on.
        console.error(`[agent console] ${this.props.name} tab crashed`, error, info);
        this.setState({ info: (info.componentStack ?? '').split('\n').slice(0, 4).join('\n').trim() || null });
    }

    componentDidUpdate(prev: Props) {
        // A stale error must not follow the operator to another agent.
        if (prev.resetKey !== this.props.resetKey && this.state.error) {
            this.setState({ error: null, info: null });
        }
    }

    render() {
        const { error, info } = this.state;
        if (!error) return this.props.children;

        return (
            <div className="rounded-[14px] border border-red-500/30 bg-red-500/[0.06] p-4">
                <div className="flex items-start gap-2.5">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                    <div className="min-w-0 flex-1">
                        <h4 className="text-[12.5px] font-semibold text-red-800">
                            The {this.props.name} tab could not be shown
                        </h4>
                        <p className="mt-1 text-[11.5px] leading-relaxed text-red-700/90">
                            This panel hit an error while rendering. The rest of the console is unaffected —
                            switch tabs and come back, or send this message on.
                        </p>
                        <pre className="mt-2.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-red-500/25 bg-card px-3 py-2 font-mono text-[11px] leading-relaxed text-red-900">
{error.message || String(error)}{info ? `\n\n${info}` : ''}
                        </pre>
                        <button
                            type="button"
                            onClick={() => this.setState({ error: null, info: null })}
                            className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11.5px] font-medium hover:bg-card-tint"
                        >
                            <RotateCcw className="h-3 w-3" /> Try again
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}
