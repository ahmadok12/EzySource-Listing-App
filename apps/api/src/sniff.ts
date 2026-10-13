/**
 * Checks a file's first bytes against its declared type, so a renamed HTML page or
 * script can't be stored as a photo (specs/12 "Script in notes or malicious upload").
 */
const ascii = (bytes: Uint8Array, at: number, text: string) =>
  [...text].every((ch, i) => bytes[at + i] === ch.charCodeAt(0));

export const SNIFF_BYTES = 16;

export function looksLike(bytes: Uint8Array, mimeType: string): boolean {
  switch (mimeType) {
    case "image/jpeg":
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/png":
      return bytes[0] === 0x89 && ascii(bytes, 1, "PNG\r\n\x1a\n");
    case "image/webp":
      return ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP");
    case "application/pdf":
      return ascii(bytes, 0, "%PDF-");
    case "audio/webm":
      return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
    case "audio/mp4":
      return ascii(bytes, 4, "ftyp");
    case "audio/ogg":
      return ascii(bytes, 0, "OggS");
    case "audio/mpeg":
      // ID3 tag, or an MPEG audio frame sync.
      return ascii(bytes, 0, "ID3") || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0);
    default:
      return false;
  }
}
