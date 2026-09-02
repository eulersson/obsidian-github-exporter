/** A literal or regex rule that removes every match from the published copy. */
export interface MaskRule {
	/** Literal text, or a regular expression source when `isRegex` is set. */
	pattern: string;
	isRegex: boolean;
	/** Regex flags. `g` is always forced on so every match is removed. */
	flags: string;
	/** By default matches inside fenced/inline code are left alone. */
	inCodeBlocks: boolean;
	/** Shown in previews and reports so a hit can be identified without echoing the secret. */
	label: string;
}

/** A pattern that must never reach the remote. A hit aborts the publish. */
export interface DenyRule {
	pattern: string;
	isRegex: boolean;
	flags: string;
	label: string;
}

export interface MaskSettings {
	/** Callout types treated as private, e.g. `private` for `> [!private]`. */
	privateCallouts: string[];
	rules: MaskRule[];
	denyPatterns: DenyRule[];
}

export const DEFAULT_MASK_SETTINGS: MaskSettings = {
	privateCallouts: ['private'],
	rules: [],
	denyPatterns: [],
};

/** One removed region, reported back for previews and the history check. */
export interface MaskSpan {
	/** 1-based line in the *original* note. */
	line: number;
	/** Human-readable cause, e.g. `region`, `callout: private`, `rule: API keys`. */
	reason: string;
	/** The removed text. Used for the history check — never put this in a Notice. */
	text: string;
}

export interface MaskResult {
	output: string;
	spans: MaskSpan[];
}

/** A hit on a deny pattern. Carries no secret text — only where and which rule. */
export interface DenyHit {
	line: number;
	label: string;
}

/**
 * Masking failed in a way that could leak. Every caller must treat this as
 * "do not publish this file" — never as "publish it unmasked".
 */
export class MaskError extends Error {
	constructor(message: string, readonly line?: number) {
		super(message);
		this.name = 'MaskError';
	}
}
