const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBufferSource(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode("dev-mcp-source-credentials"),
      info: encoder.encode("v1")
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptSecret(value: string | undefined, keyMaterial: string | undefined): Promise<string | null> {
  if (!value) return null;
  if (!keyMaterial) throw new Error("ENCRYPTION_KEY is required to store source credentials");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(keyMaterial);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(value));
  return `v1.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

export async function decryptSecret(value: string | null, keyMaterial: string | undefined): Promise<string | null> {
  if (!value) return null;
  if (!keyMaterial) throw new Error("ENCRYPTION_KEY is required to read source credentials");
  const [version, ivText, payloadText] = value.split(".");
  if (version !== "v1" || !ivText || !payloadText) throw new Error("Unsupported encrypted secret format");
  const key = await deriveKey(keyMaterial);
  const iv = bytesToBufferSource(base64ToBytes(ivText));
  const payload = bytesToBufferSource(base64ToBytes(payloadText));
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    payload
  );
  return decoder.decode(decrypted);
}
