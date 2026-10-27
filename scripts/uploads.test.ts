// Tests for the upload helper (update.md B.2): content checks, size cap, stored names, safe delete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// A scratch UPLOADS_DIR, set before the module reads it.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wvl-uploads-'));
process.env.UPLOADS_DIR = scratch;
const {
  MAX_UPLOAD_BYTES, UploadError, decodeImageUpload, deleteUpload, detectImageType,
  initUploads, isStoredFileName, saveUpload, uploadDirs, uploadPath, uploadsDir,
} = await import('../server/uploads.ts');

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const b64 = (buf: Buffer) => buf.toString('base64');

test('UPLOADS_DIR is honoured and both folders are created', () => {
  assert.equal(uploadsDir, path.resolve(scratch));
  initUploads();
  assert.ok(fs.statSync(uploadDirs.images).isDirectory());
  assert.ok(fs.statSync(uploadDirs.proofs).isDirectory());
});

test('detectImageType: JPEG, PNG and WebP by magic bytes', () => {
  assert.equal(detectImageType(JPEG), 'jpg');
  assert.equal(detectImageType(PNG), 'png');
  assert.equal(detectImageType(WEBP), 'webp');
});

test('detectImageType: other content is refused', () => {
  const others = [
    Buffer.from('GIF89a\x01\x00\x01\x00'),
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    Buffer.from('%PDF-1.7\n'),
    Buffer.from('<!doctype html><html>'),
    Buffer.from('plain text'),
    Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WAVEfmt ')]),
    Buffer.from([0xff, 0xd8]),
    Buffer.alloc(0),
  ];
  for (const buf of others) assert.equal(detectImageType(buf), null, buf.toString('latin1'));
});

test('decodeImageUpload: data URL or bare base64; the declared type is ignored', () => {
  assert.equal(decodeImageUpload(b64(PNG)).ext, 'png');
  assert.equal(decodeImageUpload(`data:image/webp;base64,${b64(WEBP)}`).ext, 'webp');
  // Declared as PNG, really JPEG: the content wins.
  assert.equal(decodeImageUpload(`data:image/png;base64,${b64(JPEG)}`).ext, 'jpg');
  assert.deepEqual(decodeImageUpload(b64(JPEG)).buffer, JPEG);
});

test('decodeImageUpload: non-images, bad base64 and empty input are 400s', () => {
  const bad = [
    `data:image/png;base64,${b64(Buffer.from('<svg onload="x"/>'))}`,
    b64(Buffer.from('%PDF-1.4')),
    'not base64 at all!',
    'data:image/png;base64,',
    '',
    undefined,
    42,
  ];
  for (const input of bad) {
    assert.throws(() => decodeImageUpload(input), (err: unknown) => err instanceof UploadError && err.status === 400, String(input));
  }
});

test('decodeImageUpload: over 2 MB is refused, exactly 2 MB is accepted', () => {
  const big = Buffer.alloc(MAX_UPLOAD_BYTES + 1);
  JPEG.copy(big);
  assert.throws(() => decodeImageUpload(b64(big)), /larger than 2 MB/);
  const max = Buffer.alloc(MAX_UPLOAD_BYTES);
  JPEG.copy(max);
  assert.equal(decodeImageUpload(b64(max)).buffer.length, MAX_UPLOAD_BYTES);
});

test('saveUpload: random <uuid>.<ext> names in the right folder; deleteUpload removes them', () => {
  const a = saveUpload('images', WEBP, 'webp');
  const b = saveUpload('proofs', PNG, 'png');
  assert.notEqual(a.id, b.id);
  assert.equal(a.fileName, `${a.id}.webp`);
  assert.ok(isStoredFileName(a.fileName) && isStoredFileName(b.fileName));
  assert.deepEqual(fs.readFileSync(path.join(uploadDirs.images, a.fileName)), WEBP);
  assert.ok(fs.existsSync(path.join(uploadDirs.proofs, b.fileName)));
  assert.equal(fs.existsSync(path.join(uploadDirs.images, b.fileName)), false);

  deleteUpload('images', a.fileName);
  deleteUpload('proofs', b.fileName);
  assert.equal(fs.existsSync(path.join(uploadDirs.images, a.fileName)), false);
  assert.equal(fs.existsSync(path.join(uploadDirs.proofs, b.fileName)), false);
  // Deleting again (already gone) is harmless.
  deleteUpload('images', a.fileName);
});

test('uploadPath / deleteUpload: only names this module made, never traversal', () => {
  const keep = path.join(scratch, 'keep.txt');
  fs.writeFileSync(keep, 'x');
  for (const name of ['../keep.txt', '..\\keep.txt', 'keep.txt', '../proofs/x.png', '%2e%2e%2fkeep.txt',
    `${crypto.randomUUID()}.gif`, `${crypto.randomUUID()}.webp/../../keep.txt`, `${crypto.randomUUID().toUpperCase()}.webp`, '']) {
    assert.equal(uploadPath('images', name), null, name);
    deleteUpload('images', name);
  }
  assert.ok(fs.existsSync(keep));
});

test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
