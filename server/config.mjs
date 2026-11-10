import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { APPROACH_PREFIX, MOVEMENT_PREFIX } from './normalize.mjs';

export const DEFAULT_TARGETS_FILE = fileURLToPath(new URL('./targets.json', import.meta.url));

export function validateTargets(input) {
  if (!Array.isArray(input) || input.length > 256) throw new Error('Target registry must be an array with at most 256 entries.');
  const targets = new Map();
  for (const entry of input) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid target registry entry.');
    if (typeof entry.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(entry.id) || targets.has(entry.id)) throw new Error('Invalid or duplicate target id.');
    if (typeof entry.label !== 'string' || !entry.label.trim() || entry.label.length > 120) throw new Error('Invalid target label.');
    if (typeof entry.intersectionId !== 'string' || !/^\d{5}$/.test(entry.intersectionId)) throw new Error('Invalid target intersectionId.');
    if (!Object.hasOwn(APPROACH_PREFIX, entry.approach) || !Object.hasOwn(MOVEMENT_PREFIX, entry.movement)) throw new Error('Invalid target approach or movement.');
    if (typeof entry.mappingVersion !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(entry.mappingVersion)) throw new Error('Invalid target mappingVersion.');
    if (typeof entry.verified !== 'boolean') throw new Error('Target verification must be explicit.');
    if (entry.verified && (
      typeof entry.verificationEvidence !== 'string' || !entry.verificationEvidence.trim() || entry.verificationEvidence.length > 500 ||
      typeof entry.verifiedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(entry.verifiedAt) || !Number.isFinite(Date.parse(entry.verifiedAt))
    )) throw new Error('Verified targets require owner-reviewed evidence and a verification timestamp.');
    targets.set(entry.id, Object.freeze({
      id: entry.id,
      label: entry.label.trim(),
      intersectionId: entry.intersectionId,
      approach: entry.approach,
      movement: entry.movement,
      mappingVersion: entry.mappingVersion,
      verified: entry.verified,
    }));
  }
  return targets;
}

export async function loadTargets(filename = DEFAULT_TARGETS_FILE) {
  const content = await readFile(filename, 'utf8');
  if (Buffer.byteLength(content) > 256 * 1024) throw new Error('Target registry is too large.');
  return validateTargets(JSON.parse(content));
}
