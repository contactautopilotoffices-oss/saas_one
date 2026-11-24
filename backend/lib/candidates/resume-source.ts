import { SOURCE_KIND_LABELS, type UploadSource } from './types';

/** Conflicting or absent filename markers need a person, never a guessed source. */
export function sourceFromResumeName(name: string): UploadSource {
    const naukri = /naukri/i.test(name);
    const linkedin = /linkedin/i.test(name);
    if (naukri === linkedin) return { kind: null, name: null };
    return naukri ? { kind: 'naukri', name: null } : { kind: 'portal', name: 'LinkedIn' };
}

export function resumeSourceLabel(source: UploadSource): string {
    return source.kind ? source.name || SOURCE_KIND_LABELS[source.kind] : 'Unknown';
}
