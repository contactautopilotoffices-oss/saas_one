'use client';

import { Fragment, useMemo } from 'react';

import { formatAnswer, type Inline } from './formatAnswer';

function Runs({ runs }: { runs: Inline[] }) {
    return (
        <>
            {runs.map((run, i) =>
                run.bold ? (
                    <strong key={i} className="font-semibold">
                        {run.text}
                    </strong>
                ) : run.italic ? (
                    <em key={i}>{run.text}</em>
                ) : (
                    <Fragment key={i}>{run.text}</Fragment>
                ),
            )}
        </>
    );
}

/** The assistant's answer with bold text and lists shown properly (see formatAnswer.ts). */
export function FormattedAnswer({ text }: { text: string }) {
    const blocks = useMemo(() => formatAnswer(text), [text]);
    return (
        <div className="space-y-2">
            {blocks.map((block, i) => {
                if (block.kind === 'paragraph') {
                    return (
                        <p key={i}>
                            {block.lines.map((line, j) => (
                                <Fragment key={j}>
                                    {j > 0 && <br />}
                                    <Runs runs={line} />
                                </Fragment>
                            ))}
                        </p>
                    );
                }
                const items = block.items.map((item, j) => (
                    <li key={j} className="pl-0.5">
                        <Runs runs={item} />
                    </li>
                ));
                return block.kind === 'bullets' ? (
                    <ul key={i} className="list-disc space-y-1 pl-4 marker:text-primary">
                        {items}
                    </ul>
                ) : (
                    <ol key={i} start={block.start} className="list-decimal space-y-1 pl-5 marker:text-text-secondary">
                        {items}
                    </ol>
                );
            })}
        </div>
    );
}
