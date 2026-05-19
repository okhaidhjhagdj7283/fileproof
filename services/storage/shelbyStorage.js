/**
 * Shelby Storage Abstraction Layer
 * Replace the internals here when Shelby SDK/API changes.
 * The rest of the app only imports from this file.
 *
 * Current mode: LOCAL fallback (no Shelby API key configured)
 * When SHELBY_API_KEY is set, switch to real Shelby calls.
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const LOCAL_UPLOAD_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(LOCAL_UPLOAD_DIR)) fs.mkdirSync(LOCAL_UPLOAD_DIR, { recursive: true });

const USE_SHELBY = !!process.env.SHELBY_API_KEY;
const SHELBY_BASE = process.env.SHELBY_BASE_URL || 'https://api.shelby.storage/v1';

// ─── Helpers ────────────────────────────────────────────────────────────────

function localBlobId(filename) {
  return `local://${filename}`;
}

function blobIdToFilename(blobId) {
  return blobId.replace(/^local:\/\//, '').replace(/^shelby:\/\//, '');
}

// ─── Public Interface ────────────────────────────────────────────────────────

/**
 * Create an upload session.
 * Returns { uploadSessionId, uploadUrl, storageProvider }
 */
async function createUploadSession({ fileName, fileType, fileSize, userId }) {
  if (!USE_SHELBY) {
    // Local mode: generate a session ID; actual upload handled by multer
    return {
      uploadSessionId: `sess_${uuidv4()}`,
      uploadUrl: null,
      storageProvider: 'local',
    };
  }

  const res = await fetch(`${SHELBY_BASE}/upload-sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SHELBY_API_KEY}`,
    },
    body: JSON.stringify({ fileName, fileType, fileSize, userId }),
  });
  if (!res.ok) throw new Error(`Shelby createUploadSession failed: ${res.status}`);
  const data = await res.json();
  return {
    uploadSessionId: data.sessionId,
    uploadUrl: data.uploadUrl,
    storageProvider: 'shelby',
  };
}

/**
 * After multer saves the file locally, register it as a blob.
 * In local mode: just return a local:// blob ID.
 * In Shelby mode: upload the file stream to Shelby and return shelby:// blob ID.
 */
async function registerUpload({ localFilePath, fileName, fileType, fileSize }) {
  if (!USE_SHELBY) {
    const filename = path.basename(localFilePath);
    return {
      shelbyBlobId: localBlobId(filename),
      storageProvider: 'local',
      storageUri: `/api/proofs/blob/${filename}`,
    };
  }

  // Upload to Shelby
  const fileStream = fs.createReadStream(localFilePath);
  const res = await fetch(`${SHELBY_BASE}/blobs`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SHELBY_API_KEY}`,
      'X-File-Name': fileName,
      'X-File-Type': fileType,
      'X-File-Size': String(fileSize),
      'Content-Type': fileType,
    },
    body: fileStream,
    duplex: 'half',
  });
  if (!res.ok) throw new Error(`Shelby upload failed: ${res.status}`);
  const data = await res.json();

  // Optionally remove local temp file after Shelby upload
  try { fs.unlinkSync(localFilePath); } catch {}

  return {
    shelbyBlobId: `shelby://${data.blobId}`,
    storageProvider: 'shelby',
    storageUri: data.accessUrl,
  };
}

/**
 * Get metadata for a blob.
 */
async function getBlobMetadata({ shelbyBlobId }) {
  if (!USE_SHELBY || shelbyBlobId.startsWith('local://')) {
    const filename = blobIdToFilename(shelbyBlobId);
    const filePath = path.join(LOCAL_UPLOAD_DIR, filename);
    const exists = fs.existsSync(filePath);
    return { exists, filePath, provider: 'local' };
  }

  const blobId = shelbyBlobId.replace('shelby://', '');
  const res = await fetch(`${SHELBY_BASE}/blobs/${blobId}`, {
    headers: { 'Authorization': `Bearer ${process.env.SHELBY_API_KEY}` },
  });
  if (!res.ok) return { exists: false };
  const data = await res.json();
  return { exists: true, ...data, provider: 'shelby' };
}

/**
 * Get a readable stream for a blob.
 */
async function getBlobStream({ shelbyBlobId }) {
  if (!USE_SHELBY || shelbyBlobId.startsWith('local://')) {
    const filename = blobIdToFilename(shelbyBlobId);
    const filePath = path.join(LOCAL_UPLOAD_DIR, filename);
    if (!fs.existsSync(filePath)) throw new Error('File not found');
    return fs.createReadStream(filePath);
  }

  const blobId = shelbyBlobId.replace('shelby://', '');
  const res = await fetch(`${SHELBY_BASE}/blobs/${blobId}/download`, {
    headers: { 'Authorization': `Bearer ${process.env.SHELBY_API_KEY}` },
  });
  if (!res.ok) throw new Error(`Shelby download failed: ${res.status}`);
  return res.body;
}

/**
 * Get a download URL (for client-side verify of displayed file).
 */
async function getDownloadUrl({ shelbyBlobId }) {
  if (!USE_SHELBY || shelbyBlobId.startsWith('local://')) {
    const filename = blobIdToFilename(shelbyBlobId);
    return `/api/storage/blob/${filename}`;
  }

  const blobId = shelbyBlobId.replace('shelby://', '');
  const res = await fetch(`${SHELBY_BASE}/blobs/${blobId}/download-url`, {
    headers: { 'Authorization': `Bearer ${process.env.SHELBY_API_KEY}` },
  });
  if (!res.ok) throw new Error(`Shelby getDownloadUrl failed: ${res.status}`);
  const data = await res.json();
  return data.url;
}

module.exports = {
  createUploadSession,
  registerUpload,
  getBlobMetadata,
  getBlobStream,
  getDownloadUrl,
};
