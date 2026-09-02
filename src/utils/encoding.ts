import * as crypto from 'crypto';

// Add type declaration for Web Crypto API
declare global {
	interface Window {
		crypto: {
			subtle: {
				digest(algorithm: string, data: ArrayBuffer): Promise<ArrayBuffer>;
			};
		};
	}
}

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

// Helper function to calculate SHA-1 hash
export async function calculateSHA1(data: ArrayBuffer): Promise<string> {
	// Use the Web Crypto API if available, otherwise fall back to Node.js crypto
	if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
		const hashBuffer = await window.crypto.subtle.digest('SHA-1', data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
	} else {
		// Fallback to Node.js crypto
		const hash = crypto.createHash('sha1');
		hash.update(Buffer.from(data));
		return hash.digest('hex');
	}
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
