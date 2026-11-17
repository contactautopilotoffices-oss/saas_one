'use client';

/**
 * Guidance: a short note the Tech team writes, which the brain keeps in view for every reply in this organisation.
 * It has versions. A version can go live only after its test passed: every test message is played without and with
 * the note on the real model, and it passes only if nothing unsafe happens and it passes at least as many as today.
 *
 * The test runs in steps: `test_step` is called again and again, ONE call at a time, while the test is running. The
 * loop stops on Pause, on a failed call and when the screen closes; the test then waits and can be continued.
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, Compass, Copy, FlaskConical, Loader2, OctagonAlert, Pause, Play, PowerOff, Rocket, ShieldCheck, Sparkles, Trash2, TriangleAlert, Undo2 } from 'lucide-react';
import type { GuidanceScore, GuidanceTest, GuidanceVersion, GuidanceView, SuggestView } from '@/backend/lib/aiLayer/brain/console/types';
import { LEARNING_MISSING, type GuidanceBody } from './api';
import { useBrain, useView } from './BrainContext';
import { dateTimeIN, int, plural, usd } from './labels';
import { Btn, Card, CardHead, Chip, Dialog, ErrorState, LoadingScreen, Screen, cx, s, useMotion } from './ui';

export default function GuidanceScreen() {
    const { status } = useBrain();
    const v = useView(api => api.guidance(), 'guidance');
    const missing = !!status?.learningMissing || (!!v.res && !v.res.ok && v.res.kind === 'missing');
    return (
        <Screen title="Guidance" sub="A short note from the Tech team that the brain keeps in view for every reply in this organisation. It can shape how the brain words and handles things; it can never change who may do what.">
            {missing ? <MissingNotice />
                : !v.res ? <LoadingScreen label="Loading guidance" />
                    : v.error ? <ErrorState what="guidance" message={v.error} onRetry={v.reload} />
                        : v.data && <Body view={v.data} replace={d => v.mutate(() => d)} />}
        </Screen>
    );
}

function MissingNotice() {
    return (
        <div className={cx(s.banner, s.bannerInfo)} role="note">
            <Compass className="mt-0.5 h-4 w-4 shrink-0 text-(--bc-accent)" />
            <div className="flex flex-col gap-[4px]">
                <p className="text-[13.5px] font-semibold text-(--bc-ink-1)">{LEARNING_MISSING}</p>
                <p className="text-[12.5px] text-(--bc-ink-2)">Lessons from judged messages and the rest of the console work without it.</p>
            </div>
        </div>
    );
}

type Confirm = null | 'test' | 'live' | 'off' | 'replace';

function Body({ view, replace }: { view: GuidanceView; replace: (d: GuidanceView) => void }) {
    const { api, report, toast } = useBrain();
    const ids = useId();
    const draft = view.versions.find(x => x.status === 'draft') ?? null;
    const live = view.live;

    // The draft's words: the box's own while being edited, the saved words otherwise.
    const [text, setText] = useState<string | null>(null);
    const words = text ?? draft?.text ?? '';
    const dirty = text !== null && text !== (draft?.text ?? '');
    const over = words.length > view.maxChars;
    const box = useRef<HTMLTextAreaElement>(null);

    const [busy, setBusy] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [confirm, setConfirm] = useState<Confirm>(null);

    // ── The test loop ──
    const loop = useRef({ running: false, alive: true });
    const [looping, setLooping] = useState(false);
    const [pausing, setPausing] = useState(false);
    const [loopErr, setLoopErr] = useState<string | null>(null);
    useEffect(() => {
        const c = loop.current;
        c.alive = true;
        // Leaving the screen stops the calling; the test waits on the server and can be continued later.
        return () => { c.alive = false; c.running = false; };
    }, []);

    const runTest = async (versionId: string) => {
        const c = loop.current;
        if (c.running) return;
        c.running = true;
        setLooping(true); setPausing(false); setLoopErr(null); setErr(null);
        try {
            while (c.running && c.alive) {
                const r = await api.postGuidance({ action: 'test_step', versionId });
                if (!c.alive) return;
                report(r);
                if (!r.ok) { setLoopErr(r.message); break; }
                replace(r.data);
                const t = r.data.versions.find(x => x.id === versionId)?.test;
                if (!t || t.state !== 'running') {
                    if (t?.state === 'passed') toast('The test passed. This version can go live.');
                    else if (t?.state === 'failed') toast('The test did not pass. See why below.', 'bad');
                    break;
                }
            }
        } finally {
            c.running = false;
            if (c.alive) { setLooping(false); setPausing(false); }
        }
    };
    const pause = () => { loop.current.running = false; setPausing(true); };

    const post = async (body: GuidanceBody, what: string, done?: string): Promise<boolean> => {
        setBusy(what); setErr(null);
        const r = await api.postGuidance(body);
        report(r);
        setBusy(null);
        if (!r.ok) { setErr(r.message); return false; }
        replace(r.data);
        if (done) toast(done);
        return true;
    };

    const save = async () => {
        if (await post({ action: 'save_draft', text: words.trim() }, 'save', 'Draft saved.')) { setText(null); setSuggested(null); }
    };

    // ── Suggest words from the answers judged wrong: one model call; the words go into the editor, nothing is saved ──
    const [suggesting, setSuggesting] = useState(false);
    const [suggestErr, setSuggestErr] = useState<string | null>(null);
    const [suggested, setSuggested] = useState<number | null>(null);
    const askSuggest = async () => {
        setSuggesting(true); setSuggestErr(null);
        const r = await api.postGuidance({ action: 'suggest' });
        setSuggesting(false);
        report(r);
        if (!r.ok) { setSuggestErr(r.message); return; }
        replace(r.data);
        if (!r.suggestion) { setSuggestErr('The brain did not send any words back. Try again later.'); return; }
        setText(r.suggestion.text);
        setSuggested(r.suggestion.basedOn);
        box.current?.focus({ preventScroll: true });
    };
    // Unsaved words in the editor are never replaced without asking.
    const onSuggest = () => { if (dirty) setConfirm('replace'); else void askSuggest(); };
    const copyWords = (from: GuidanceVersion) => {
        setText(from.text);
        box.current?.focus({ preventScroll: true });
        box.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };

    return (
        <div className="flex min-w-0 flex-col gap-[24px]">
            {err && (
                <div role="alert" className={cx(s.banner, s.bannerBad, 'items-center')}>
                    <OctagonAlert className="h-4 w-4 shrink-0 text-(--bc-bad-text)" />
                    <p className="min-w-0 flex-1 text-[13px] text-(--bc-ink-1)">{err}</p>
                    <Btn size="sm" variant="quiet" onClick={() => setErr(null)}>Dismiss</Btn>
                </div>
            )}

            <div className="grid min-w-0 items-start gap-[24px] @5xl:grid-cols-2">
                {/* What is live now */}
                <Card as="section" className="@container flex min-w-0 flex-col gap-[16px] p-[16px] @3xl:p-6" aria-labelledby={`${ids}live`}>
                    <CardHead id={`${ids}live`} icon={Compass} label="Live now"
                        right={live && <Btn size="sm" variant="bad" icon={PowerOff} disabled={!!busy} onClick={() => setConfirm('off')}>Turn guidance off</Btn>} />
                    {live ? (
                        <>
                            <div className="flex min-w-0 flex-wrap items-center gap-[8px]">
                                <Chip tone="ok" icon={Check}>Version {live.version} · live</Chip>
                                <span className={cx(s.tab, 'text-[12.5px] text-(--bc-ink-3)')}>
                                    Since {dateTimeIN(live.activatedAt)} · written by {live.createdBy}{live.test ? <> · tested on <span className={s.mono}>{live.test.model}</span></> : ''}
                                </span>
                            </div>
                            <blockquote className={s.quote}>{live.text}</blockquote>
                            {live.test && <p className="text-[12.5px] text-(--bc-ink-3)">{summary(live.test)}</p>}
                        </>
                    ) : <NothingLive />}
                </Card>

                {/* The draft and its test */}
                <Card as="section" className="@container flex min-w-0 flex-col gap-[16px] p-[16px] @3xl:p-6" aria-labelledby={`${ids}draft`}>
                    <CardHead id={`${ids}draft`} icon={Compass} label={draft ? `Draft · version ${draft.version}` : 'New draft'}
                        hint="Write it as you would brief a new colleague: short, plain, one idea per line."
                        right={draft && <Btn size="sm" variant="quiet" icon={Trash2} disabled={!!busy || looping} onClick={() => post({ action: 'discard_draft', versionId: draft.id }, 'discard', 'Draft discarded.').then(ok => { if (ok) setText(null); })}>Discard draft</Btn>} />
                    {view.suggest && <SuggestStrip sg={view.suggest} busy={suggesting} disabled={looping || !!busy} onSuggest={onSuggest} error={suggestErr} />}
                    <div className="flex min-w-0 flex-col gap-[8px]">
                        <label htmlFor={`${ids}words`} className="sr-only">Guidance words</label>
                        <textarea ref={box} id={`${ids}words`} className={s.input} rows={6} value={words} disabled={looping}
                            aria-describedby={`${ids}count`} aria-invalid={over}
                            placeholder="For example: Call the helpdesk “the front desk”."
                            onChange={e => setText(e.target.value)} />
                        <div className="flex min-w-0 flex-wrap items-center justify-between gap-[8px]">
                            <span id={`${ids}count`} className={cx(s.tab, 'text-[12px]', over ? 'text-(--bc-bad-text)' : words.length > view.maxChars * 0.9 ? 'text-(--bc-warn-text)' : 'text-(--bc-ink-3)')}>
                                {int(words.length)} / {int(view.maxChars)} characters{over ? ` · ${int(words.length - view.maxChars)} too many` : ''}
                            </span>
                            <span className="flex flex-wrap gap-[8px]">
                                {dirty && <Btn size="sm" variant="quiet" icon={Undo2} onClick={() => { setText(null); setSuggested(null); }}>Undo changes</Btn>}
                                <Btn size="sm" variant="primary" disabled={!dirty || over || !words.trim() || !!busy || looping} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save draft'}</Btn>
                            </span>
                        </div>
                        {over && <p role="alert" className="text-[12.5px] text-(--bc-bad-text)">Guidance can be at most {int(view.maxChars)} characters. Shorten it to save.</p>}
                        {dirty && draft?.test && <p className="text-[12.5px] text-(--bc-ink-3)">Saving replaces the draft’s words and clears its test.</p>}
                        {dirty && suggested !== null && (
                            <p role="status" className="flex items-start gap-[8px] text-[12.5px] leading-snug text-(--bc-ink-2)">
                                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-(--bc-accent)" />
                                Suggested from {plural(suggested, 'answer')} judged wrong. Read it, change what you want, then save it as a draft. It still has to pass its test before it is in force.
                            </p>
                        )}
                    </div>

                    {draft && !dirty && (
                        <TestPanel draft={draft} view={view} looping={looping} pausing={pausing} loopErr={loopErr} busy={!!busy}
                            onTest={() => setConfirm('test')} onContinue={() => runTest(draft.id)} onPause={pause} onLive={() => setConfirm('live')} />
                    )}
                    {draft && dirty && <p className="text-[12.5px] text-(--bc-ink-3)">Save the draft to test it.</p>}
                    {!draft && !dirty && <p className="text-[12.5px] text-(--bc-ink-3)">Write the words and save them as a draft. A draft is tested before it can go live.</p>}
                </Card>
            </div>

            <Versions versions={view.versions} onUse={copyWords} />

            {/* Confirmations */}
            <Dialog open={confirm === 'replace'} onClose={() => setConfirm(null)} title="Replace the words in the editor?" footer={<>
                <Btn variant="quiet" data-autofocus onClick={() => setConfirm(null)}>Keep my words</Btn>
                <Btn variant="primary" icon={Sparkles} onClick={() => { setConfirm(null); void askSuggest(); }}>Replace with a suggestion</Btn>
            </>}>
                <p className="text-[14px] leading-relaxed text-(--bc-ink-1)">The editor holds words that are not saved. A suggestion replaces them.</p>
                <p className="text-[13px] text-(--bc-ink-2)">{draft ? 'The saved draft stays as it is until you save again.' : 'Nothing has been saved yet.'}</p>
            </Dialog>
            <Dialog open={confirm === 'test'} onClose={() => setConfirm(null)} title="Test this version?" footer={<>
                <Btn variant="quiet" onClick={() => setConfirm(null)}>Cancel</Btn>
                <Btn variant="primary" icon={FlaskConical} data-autofocus disabled={!draft || !view.model || view.testsLeftToday <= 0}
                    onClick={() => { setConfirm(null); if (draft) void runTest(draft.id); }}>Start the test</Btn>
            </>}>
                <p className="text-[13.5px] leading-relaxed text-(--bc-ink-2)">Every test message is played twice on the real model, without and with this note. It passes only if nothing unsafe happens and it passes at least as many test messages as today. The test uses real model credit.</p>
                <dl className={cx(s.well, s.rows, 'px-[16px]')}>
                    <Row k="Model">{view.model ? <span className={s.mono}>{view.model}</span> : <span className="text-(--bc-bad-text)">No model is set</span>}</Row>
                    <Row k="Test messages">{plural(view.cases, 'message')}, each played twice: {int(view.cases * 2)} runs</Row>
                    <Row k="Cost">{view.estimateUsd === null ? 'Cost unknown for this model' : `About ${usd(view.estimateUsd)}`}</Row>
                    <Row k="Tests left today">{view.testsLeftToday > 0 ? int(view.testsLeftToday) : <span className="text-(--bc-bad-text)">None. Tests can be run again tomorrow.</span>}</Row>
                </dl>
                <p className="text-[12.5px] text-(--bc-ink-3)">A step can take up to a minute. You can pause, or leave this screen; the test waits and can be continued later.</p>
            </Dialog>

            <Dialog open={confirm === 'live'} onClose={() => setConfirm(null)} title={draft ? `Make version ${draft.version} live?` : 'Make it live?'} footer={<>
                <Btn variant="quiet" onClick={() => setConfirm(null)}>Cancel</Btn>
                <Btn variant="primary" icon={Rocket} data-autofocus disabled={!!busy || draft?.test?.state !== 'passed'}
                    onClick={() => { if (draft) void post({ action: 'activate', versionId: draft.id }, 'activate', `Version ${draft.version} is live.`).then(() => setConfirm(null)); }}>
                    {busy === 'activate' ? 'Making it live…' : 'Make it live'}
                </Btn>
            </>}>
                <p className="text-[14px] leading-relaxed text-(--bc-ink-1)">Within about a minute, every reply the brain writes for this organisation is written with this note in view.</p>
                {live && <p className="text-[13px] text-(--bc-ink-2)">Version {live.version} stops being used.</p>}
            </Dialog>

            <Dialog open={confirm === 'off'} onClose={() => setConfirm(null)} title="Turn guidance off?" footer={<>
                <Btn variant="quiet" onClick={() => setConfirm(null)}>Keep it</Btn>
                <Btn variant="bad" icon={PowerOff} data-autofocus disabled={!!busy}
                    onClick={() => { void post({ action: 'turn_off' }, 'off', 'Guidance is off.').then(() => setConfirm(null)); }}>
                    {busy === 'off' ? 'Turning off…' : 'Turn it off'}
                </Btn>
            </>}>
                <p className="text-[14px] leading-relaxed text-(--bc-ink-1)">Within about a minute the brain will answer without this note.</p>
                <p className="text-[13px] text-(--bc-ink-2)">The words stay in Earlier versions and can be used again as a new draft.</p>
            </Dialog>
        </div>
    );
}

/**
 * "Suggest words from judged mistakes": the brain proposes a note from the answers the Tech team judged wrong. Shown
 * disabled, with the reason beside it, until it can be used; one model call that can take 10 to 30 seconds.
 */
function SuggestStrip({ sg, busy, disabled, onSuggest, error }: { sg: SuggestView; busy: boolean; disabled: boolean; onSuggest: () => void; error: string | null }) {
    const why = !sg.available ? 'Not available yet: a database change is waiting to be applied.'
        : sg.mistakes < sg.needed ? `Judge at least ${int(sg.needed)} answers as wrong in Review first (${int(sg.mistakes)} so far).`
            : sg.leftToday <= 0 ? `${int(sg.perDay)} suggestions a day; try again tomorrow.` : null;
    return (
        <div className="flex min-w-0 flex-col gap-[6px]">
            <div className="flex min-w-0 flex-wrap items-center gap-x-[12px] gap-y-[6px]">
                <Btn size="sm" icon={busy ? Loader2 : Sparkles} disabled={!!why || busy || disabled} onClick={onSuggest} aria-describedby="suggest-why"
                    className={busy ? '[&>svg]:animate-spin' : undefined}>{busy ? 'Suggesting…' : 'Suggest words from judged mistakes'}</Btn>
                <span id="suggest-why" className={cx(s.tab, 'text-[12px] text-(--bc-ink-3)')}>
                    {busy ? 'This can take 10 to 30 seconds.' : why ?? `${int(sg.leftToday)} of ${int(sg.perDay)} left today`}
                </span>
            </div>
            {error && <p role="alert" className="flex items-start gap-[6px] text-[12.5px] text-(--bc-bad-text)"><OctagonAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</p>}
        </div>
    );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
    return (
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-[16px] gap-y-[4px] py-[10px] text-[13px]">
            <dt className="text-(--bc-ink-3)">{k}</dt>
            <dd className={cx(s.tab, 'min-w-0 text-right text-(--bc-ink-1)')}>{children}</dd>
        </div>
    );
}

function NothingLive() {
    return (
        <div className="flex min-w-0 flex-col gap-[12px]">
            <p className="text-[14px] font-semibold text-(--bc-ink-1)">No guidance is live. The brain answers with its own instructions only.</p>
            <p className="text-[13px] leading-relaxed text-(--bc-ink-2)">Guidance is for this organisation’s own words and habits, the things a new colleague would be told on the first day. For example:</p>
            <ul className="flex flex-col gap-[8px]">
                {['Call the helpdesk “the front desk”.', 'For lift faults, always mark the ticket urgent.', 'When someone writes in Hindi, answer in Hindi.'].map(x => (
                    <li key={x} className={cx(s.quote, 'py-[8px]! text-[13.5px]!')}>{x}</li>
                ))}
            </ul>
            <p className="flex items-start gap-[8px] text-[12.5px] text-(--bc-ink-3)"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-(--bc-ok-text)" />It can never change who may do what: access, skills and the Yes before an action stay exactly as they are.</p>
        </div>
    );
}

function TestPanel({ draft, view, looping, pausing, loopErr, busy, onTest, onContinue, onPause, onLive }: {
    draft: GuidanceVersion; view: GuidanceView; looping: boolean; pausing: boolean; loopErr: string | null; busy: boolean;
    onTest: () => void; onContinue: () => void; onPause: () => void; onLive: () => void;
}) {
    const t = draft.test;
    const canLive = t?.state === 'passed';
    return (
        <section aria-label="Test" className="flex min-w-0 flex-col gap-[16px] border-t border-(--bc-line) pt-[16px]">
            {!t && (
                <div className="flex flex-wrap items-center justify-between gap-[12px]">
                    <p className="text-[13px] text-(--bc-ink-2)">Not tested yet. A version can go live only after its test passes.</p>
                    <Btn icon={FlaskConical} disabled={busy} onClick={onTest}>Test this version</Btn>
                </div>
            )}

            {t?.state === 'running' && (looping ? <Progress t={t} pausing={pausing} onPause={onPause} /> : (
                <div className="flex flex-col gap-[12px]">
                    <Progress t={t} />
                    {loopErr && <p role="alert" className="flex items-start gap-[8px] text-[12.5px] text-(--bc-bad-text)"><OctagonAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{loopErr}</p>}
                    <div className="flex flex-wrap items-center justify-between gap-[12px]">
                        <p className="text-[13px] text-(--bc-ink-2)">The test is waiting at {int(t.done)} of {int(t.total)} runs.</p>
                        <Btn icon={Play} disabled={busy} onClick={onContinue}>Continue the test</Btn>
                    </div>
                </div>
            ))}

            {t?.state === 'stale' && (
                <div className={cx(s.banner, s.bannerWarn, 'flex-wrap items-center')}>
                    <TriangleAlert className="h-4 w-4 shrink-0 text-(--bc-warn-text)" />
                    <p className="min-w-0 flex-1 text-[13px] text-(--bc-ink-1)">The test set, the model order or the words changed since this was tested. Test it again.</p>
                    <Btn size="sm" icon={FlaskConical} disabled={busy} onClick={onTest}>Test again</Btn>
                </div>
            )}

            {(t?.state === 'passed' || t?.state === 'failed') && <Result t={t} />}
            {t?.state === 'failed' && <p className="text-[12.5px] text-(--bc-ink-3)">Change the words, save the draft, and test it again.</p>}

            <div className="flex flex-wrap items-center justify-between gap-[12px] border-t border-(--bc-line) pt-[16px]">
                <p className="text-[12.5px] text-(--bc-ink-3)">
                    {canLive ? 'Passed: this version can go live.' : 'It can go live after its test passes.'}
                    {!t && view.testsLeftToday <= 0 && ' No tests are left today.'}
                </p>
                <Btn variant="primary" icon={Rocket} disabled={!canLive || busy || looping} onClick={onLive}>Make it live</Btn>
            </div>
        </section>
    );
}

function Progress({ t, pausing, onPause }: { t: GuidanceTest; pausing?: boolean; onPause?: () => void }) {
    const m = useMotion();
    const share = t.total ? Math.min(1, t.done / t.total) : 0;
    return (
        <div className="flex min-w-0 flex-col gap-[8px]">
            <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-[16px] gap-y-[4px] text-[13px]">
                <span className="text-(--bc-ink-2)">{onPause ? 'Testing on ' : 'Tested so far on '}<span className={s.mono}>{t.model}</span></span>
                <span className={cx(s.tab, 'text-(--bc-ink-1)')} aria-live="polite">{int(t.done)} of {int(t.total)} runs · {usd(t.spentUsd)} spent so far</span>
            </div>
            <div role="progressbar" aria-label="Test progress" aria-valuemin={0} aria-valuemax={t.total} aria-valuenow={t.done} className={s.barTrack} style={{ height: 8 }}>
                <div className={s.barFill} style={{ width: `${share * 100}%`, transition: m.reduce ? 'none' : 'width 600ms cubic-bezier(0.19, 1, 0.22, 1)' }} />
            </div>
            {onPause && (
                <div className="flex flex-wrap items-center gap-[12px]">
                    <Btn size="sm" icon={Pause} disabled={pausing} onClick={onPause}>{pausing ? 'Pausing after this step…' : 'Pause'}</Btn>
                    <span className="text-[12px] text-(--bc-ink-3)">A step can take up to a minute. Leaving this screen pauses the test.</span>
                </div>
            )}
        </div>
    );
}

function Score({ title, score, highlight }: { title: string; score: GuidanceScore; highlight?: boolean }) {
    const bad = score.unsafe > 0;
    return (
        <div className={cx(s.well, 'flex min-w-0 flex-col gap-[6px] p-[12px]')} style={bad ? { boxShadow: 'inset 0 0 0 2px var(--bc-bad)' } : highlight ? { boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--bc-accent) 45%, transparent)' } : undefined}>
            <span className={s.label}>{title}</span>
            <span className={cx(s.numLg, 'text-(--bc-ink-1)')}>{int(score.passed)}<span className={cx(s.numSm, 'text-(--bc-ink-3)')}> of {int(score.done)} passed</span></span>
            {bad
                ? <span className="flex items-center gap-[6px] text-[12.5px] font-semibold text-(--bc-bad-text)"><OctagonAlert className="h-3.5 w-3.5" />UNSAFE · {plural(score.unsafe, 'case')}</span>
                : <span className="flex items-center gap-[6px] text-[12.5px] text-(--bc-ok-text)"><ShieldCheck className="h-3.5 w-3.5" />0 unsafe</span>}
        </div>
    );
}

function Result({ t }: { t: GuidanceTest }) {
    const passed = t.state === 'passed';
    return (
        <div className="@container flex min-w-0 flex-col gap-[12px]">
            <div className="grid min-w-0 gap-[12px] @md:grid-cols-2">
                <Score title="Without the note (today)" score={t.baseline} />
                <Score title="With the note" score={t.candidate} highlight />
            </div>
            {t.verdict && (
                <p className={cx('flex items-start gap-[8px] text-[13.5px]', passed ? 'text-(--bc-ok-text)' : 'text-(--bc-bad-text)')}>
                    {passed ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /> : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
                    <span className="text-(--bc-ink-1)"><b className={cx('font-semibold', passed ? 'text-(--bc-ok-text)' : 'text-(--bc-bad-text)')}>{passed ? 'Passed. ' : 'Did not pass. '}</b>{t.verdict}</span>
                </p>
            )}
            {t.newlyFailing.length > 0 && (
                <div className="flex min-w-0 flex-col gap-[6px]">
                    <span className={s.label}>Pass today, fail with the note</span>
                    <ul className="flex flex-col gap-[4px]">
                        {t.newlyFailing.map(f => (
                            <li key={f.id} className="flex min-w-0 gap-[8px] text-[12.5px]">
                                <span className={cx(s.mono, 'shrink-0 text-(--bc-ink-3)')}>{f.id}</span>
                                <span className="min-w-0 break-words text-(--bc-ink-2)">{f.why}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            <p className={cx(s.tab, 'text-[12px] text-(--bc-ink-3)')}>Tested on <span className={s.mono}>{t.model}</span>{t.finishedAt ? ` · ${dateTimeIN(t.finishedAt)}` : ''} · cost {usd(t.spentUsd)}</p>
        </div>
    );
}

/** One line about a version's test, for the live card and the version list. */
function summary(t: GuidanceTest | null): string {
    if (!t) return 'Not tested.';
    if (t.state === 'running') return `Test under way: ${int(t.done)} of ${int(t.total)} runs.`;
    if (t.state === 'stale') return 'Needs testing again: the test set, the model order or the words changed since.';
    const head = t.state === 'passed' ? 'Test passed' : 'Test did not pass';
    return `${head}: ${int(t.candidate.passed)} of ${int(t.candidate.done)} with the note, ${int(t.baseline.passed)} without · ${t.candidate.unsafe ? `${t.candidate.unsafe} unsafe` : '0 unsafe'}.`;
}

const STATUS: Record<GuidanceVersion['status'], { label: string; tone: 'ok' | 'accent' | 'neutral' }> = {
    live: { label: 'Live', tone: 'ok' }, draft: { label: 'Draft', tone: 'accent' }, retired: { label: 'Retired', tone: 'neutral' },
};

function Versions({ versions, onUse }: { versions: GuidanceVersion[]; onUse: (v: GuidanceVersion) => void }) {
    return (
        <Card as="section" className="@container flex min-w-0 flex-col gap-[16px] p-[16px] @3xl:p-6" aria-labelledby="g-versions">
            <CardHead id="g-versions" label="Earlier versions" hint="Newest first. A retired version’s words can start a new draft." />
            {versions.length === 0 ? <p className="text-[13px] text-(--bc-ink-3)">No versions yet. Each saved draft becomes a version.</p> : (
                <ol className={s.rows}>
                    {versions.map(v => (
                        <li key={v.id} className="grid min-w-0 gap-[8px] py-[16px] first:pt-0 last:pb-0 @3xl:grid-cols-[180px_minmax(0,1fr)_auto] @3xl:gap-[24px]">
                            <div className="flex min-w-0 flex-wrap items-center gap-[8px] @3xl:flex-col @3xl:items-start @3xl:gap-[4px]">
                                <span className="flex items-center gap-[8px]"><span className={cx(s.numMd, 'text-(--bc-ink-1)')}>v{v.version}</span><Chip tone={STATUS[v.status].tone}>{STATUS[v.status].label}</Chip></span>
                                <span className={cx(s.tab, 'text-[12px] text-(--bc-ink-3)')}>{v.createdBy} · {dateTimeIN(v.createdAt)}</span>
                                {v.activatedAt && <span className={cx(s.tab, 'text-[12px] text-(--bc-ink-3)')}>Went live {dateTimeIN(v.activatedAt)}</span>}
                            </div>
                            <div className="flex min-w-0 flex-col gap-[4px]">
                                <p className="line-clamp-3 text-[13px] whitespace-pre-line text-(--bc-ink-1)">{v.text}</p>
                                <p className={cx('text-[12px]', v.test?.candidate.unsafe ? 'text-(--bc-bad-text)' : 'text-(--bc-ink-3)')}>{summary(v.test)}</p>
                            </div>
                            <div className="flex items-start">
                                {(v.status === 'retired' || v.status === 'live') && <Btn size="sm" variant="quiet" icon={Copy} onClick={() => onUse(v)}>Use these words as a new draft</Btn>}
                            </div>
                        </li>
                    ))}
                </ol>
            )}
        </Card>
    );
}
