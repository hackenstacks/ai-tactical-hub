
import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class SecurityService {
  private readonly STORAGE_KEY = 'TACTICAL_HUB_VAULT_V2';

  // Uses Web Crypto API for AES-GCM
  async generateKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      "raw",
      enc.encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveBits", "deriveKey"]
    );
    return window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: salt,
        iterations: 100000,
        hash: "SHA-256"
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
  }

  async encrypt(data: any, password: string): Promise<string> {
    try {
      const salt = window.crypto.getRandomValues(new Uint8Array(16));
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const key = await this.generateKey(password, salt);
      const enc = new TextEncoder();
      const encodedData = enc.encode(JSON.stringify(data));

      const encryptedContent = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        key,
        encodedData
      );

      // Combine salt + iv + ciphertext for storage
      const buffer = new Uint8Array(salt.byteLength + iv.byteLength + encryptedContent.byteLength);
      buffer.set(salt, 0);
      buffer.set(iv, salt.byteLength);
      buffer.set(new Uint8Array(encryptedContent), salt.byteLength + iv.byteLength);

      return this.arrayBufferToBase64(buffer);
    } catch (e) {
      console.error('Encryption Failure', e);
      throw new Error('Encryption System Failure');
    }
  }

  async decrypt(encryptedBase64: string, password: string): Promise<any> {
    try {
      const data = this.base64ToArrayBuffer(encryptedBase64);
      const salt = data.slice(0, 16);
      const iv = data.slice(16, 28);
      const ciphertext = data.slice(28);

      const key = await this.generateKey(password, salt);
      const decryptedContent = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        key,
        ciphertext
      );

      const dec = new TextDecoder();
      return JSON.parse(dec.decode(decryptedContent));
    } catch (e) {
      console.error('Decryption Failure', e);
      return null;
    }
  }

  // Helpers
  private arrayBufferToBase64(buffer: Uint8Array): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): Uint8Array {
    const binary_string = window.atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes;
  }

  async saveToVault(password: string, data: any): Promise<boolean> {
    const encrypted = await this.encrypt(data, password);
    localStorage.setItem(this.STORAGE_KEY, encrypted);
    return true;
  }

  async loadFromVault(password: string): Promise<any> {
    const encrypted = localStorage.getItem(this.STORAGE_KEY);
    if (!encrypted) return null;
    return await this.decrypt(encrypted, password);
  }

  hasVault(): boolean {
    return !!localStorage.getItem(this.STORAGE_KEY);
  }
}
