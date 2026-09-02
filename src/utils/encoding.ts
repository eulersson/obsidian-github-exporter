export function base64Encode(str: string): string {
	// Convert string to UTF-8 bytes
	const bytes = new TextEncoder().encode(str);
	// Convert bytes to base64
	return btoa(String.fromCharCode.apply(null, bytes as unknown as number[]));
}

export function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
	const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
	// Convert bytes to string in chunks to avoid stack overflow
	let binary = '';
	const chunkSize = 8192; // Process in 8KB chunks
	for (let i = 0; i < bytes.length; i += chunkSize) {
		const chunk = bytes.slice(i, Math.min(i + chunkSize, bytes.length));
		binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
	}
	return btoa(binary);
}

export function base64ToString(base64: string): string {
	// GitHub wraps base64 payloads at 60 columns; atob rejects the newlines.
	const bytes = atob(base64.replace(/\s/g, '')).split('').map(c => c.charCodeAt(0));
	return new TextDecoder().decode(new Uint8Array(bytes));
}

/**
 * SHA-1 via the Web Crypto API, which Obsidian provides on both desktop and
 * mobile. Deliberately no Node `crypto` fallback: importing it would emit a
 * top-level `require` that fails to load the plugin on mobile.
 */
export async function calculateSHA1(data: ArrayBuffer): Promise<string> {
	const hashBuffer = await window.crypto.subtle.digest('SHA-1', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Hash bytes the way Git does, so the result can be compared directly against
 * the `sha` of a blob in a tree listing: SHA-1 over `blob <length>\0<content>`.
 */
export async function gitBlobSha(contentBytes: Uint8Array): Promise<string> {
	const header = `blob ${contentBytes.length}\0`;
	const headerBytes = new TextEncoder().encode(header);
	const combinedBytes = new Uint8Array(headerBytes.length + contentBytes.length);
	combinedBytes.set(headerBytes);
	combinedBytes.set(contentBytes, headerBytes.length);
	return calculateSHA1(combinedBytes.buffer);
}
