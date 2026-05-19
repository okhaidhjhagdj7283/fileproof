/**
 * Shelby Storage Abstraction Layer
 * All storage operations go through this file.
 * In dev without SHELBY_API_KEY: falls back to local disk.
 * In production: requires SHELBY_API_KEY.
 *
 * DB always stores:
 *   storage_provider: 'shelby' | 'local'
 *   shelby_blob_id:   'shelby://blob_xxx' | 'local://filename.ext'
 *   storage_uri:      same as shelby_blob_id (or signed URL when available)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const config = require('../../config/env');

const LOCAL_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(LOCAL_DIR)) fs.mkdirSync(LOCAL_DIR, { recursive: true });

const USE_SHELBY = !!config.shelbyApiKey;
const SHELBY_BASE = config.shelbyBaseUrl;

// ─── Internal helpers ─────────────────────────────────────────────────────────

function shelbyHeaders() {
  return {
    'Authorization': `Bearer ${config.shelbyApiKey}`,
    'Content-Type': 'application/json',
  };
}

function localBlobId(filename) {
  return `local://${filename}`;
}

function blobFilename(blobId) {
  return blobId.replace(/^local:\/\//, '').replace(/^shelby:\/\//, '');
}

// ─── createUploadSession ─────────────────────────────────────────────────────
/**
 * Returns { uploadSessionId, uploadUrl, storageProvider }
 * Client should PUT the file to uploadUrl directly.
 */
async function createUploadSession({ fileName, fileType, fileSize, sha256Hash, userId }) {
  if (!USE_SHELBY) {
    // Local fallback: generate a temp filename, return a local upload URL
    const ext = path.extname(fileName) || '';
    const tempName = `${uuidv4()}${ext}`;
    return {
      uploadSessionId: `sess_local_${uuidv4()}`,
      uploadUrl: `/api/storage/local-upload/${tempName}`,
      storageProvider: 'local',
      _localTempName: tempName,
    };
  }

  const res = await fetch(`${SHELBY_BASE}/upload-sessions`, {
    method: 'POST',
    headers: shelbyHeaders(),
    body: JSON.stringify({ fileName, fileType, fileSize, sha256Hash, userId }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.status);
    throw new Error(`Shelby createUploadSession failed (${res.status}): ${err}`);
  }
  const data = await res.json();
  return {
    uploadSessionId: data.sessionId,
    uploadUrl: data.uploadUrl,
    storageProvider: 'shelby',
  };
}

// ─── confirmUpload ────────────────────────────────────────────────────────────
/**
 * After client PUT to uploadUrl, confirm the session and get blob ID.
 * For local: just return the local:// blob ID based on temp filename.
 * Returns { shelbyBlobId, storageProvider, storageUri }
 */
async function confirmUpload({ uploadSessionId, localTempName }) {
  if (!USE_SHELBY || uploadSessionId.startsWith('sess_local_')) {
    return {
      shelbyBlobId: localBlobId(localTempName),
      storageProvider: 'local',
      storageUri: localBlobId(localTempName),
    };
  }

  const res = await fetch(`${SHELBY_BASE}/upload-sessions/${uploadSessionId}/confirm`, {
    method: 'POST',
    headers: shelbyHeaders(),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.status);
    throw new Error(`Shelby confirmUpload failed (${res.status}): ${err}`);
  }
  const data = await res.json();
  return {
    shelbyBlobId: `shelby://${data.blobId}`,
    storageProvider: 'shelby',
    storageUri: `shelby://${data.blobId}`,
  };
}

// ─── getBlobMetadata ──────────────────────────────────────────────────────────
/**
 * Returns { exists, size?, contentType?, provider }
 */
async function getBlobMetadata({ shelbyBlobId }) {
  if (!shelbyBlobId) return { exists: false };

  if (!USE_SHELBY || shelbyBlobId.startsWith('local://')) {
    const filename = blobFilename(shelbyBlobId);
    const filePath = path.join(LOCAL_DIR, filename);
    const exists = fs.existsSync(filePath);
    const size = exists ? fs.statSync(filePath).size : null;
    return { exists, size, provider: 'local', filePath: exists ? filePath : null };
  }

  const blobId = blobFilename(shelbyBlobId);
  const res = await fetch(`${SHELBY_BASE}/blobs/${blobId}`, {
    headers: shelbyHeaders(),
  });
  if (!res.ok) return { exists: false, provider: 'shelby' };
  const data = await res.json();
  return { exists: true, ...data, provider: 'shelby' };
}

// ─── getBlobStream ────────────────────────────────────────────────────────────
/**
 * Returns a Node.js Readable stream of the blob content.
 */
async function getBlobStream({ shelbyBlobId }) {
  if (!USE_SHELBY || shelbyBlobId.startsWith('local://')) {
    const filename = blobFilename(shelbyBlobId);
    const filePath = path.join(LOCAL_DIR, filename);
    if (!fs.existsSync(filePath)) throw new Error(`Local blob not found: ${filename}`);
    return fs.createReadStream(filePath);
  }

  const blobId = blobFilename(shelbyBlobId);
  const res = await fetch(`${SHELBY_BASE}/blobs/${blobId}/download`, {
    headers: shelbyHeaders(),
  });
  if (!res.ok) throw new Error(`Shelby getBlobStream failed (${res.status})`);

  // Convert Web ReadableStream → Node Readable
  const { Readable } = require('stream');
  return Readable.fromWeb(res.body);
}

// ─── getDownloadUrl ───────────────────────────────────────────────────────────
/**
 * Returns a URL the client can use to download the file.
 * For local: returns internal API path.
 * For Shelby: returns signed download URL.
 */
async function getDownloadUrl({ shelbyBlobId }) {
  if (!shelbyBlobId) throw new Error('shelbyBlobId is required');

  if (!USE_SHELBY || shelbyBlobId.startsWith('local://')) {
    const filename = blobFilename(shelbyBlobId);
    return `/api/storage/blob/${filename}`;
  }

  const blobId = blobFilename(shelbyBlobId);
  const res = await fetch(`${SHELBY_BASE}/blobs/${blobId}/download-url`, {
    headers: shelbyHeaders(),
  });
  if (!res.ok) throw new Error(`Shelby getDownloadUrl failed (${res.status})`);
  const data = await res.json();
  return data.url;
}

module.exports = {
  createUploadSession,
  confirmUpload,
  getBlobMetadata,
  getBlobStream,
  getDownloadUrl,
  LOCAL_DIR,
};
