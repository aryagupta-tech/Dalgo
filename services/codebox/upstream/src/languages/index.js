import python from './python.js';
import javascript from './javascript.js';
import cpp from './cpp.js';
import c from './c.js';
import java from './java.js';
import multi from './multi.js';
import typescript from './typescript.js';

// Map of all supported languages by ID
const languagesById = new Map();
const languagesList = [python, javascript, cpp, c, java, multi, typescript];

languagesList.forEach(lang => {
  languagesById.set(lang.id, lang);
});

// RapidAPI Judge0 CE Extra language ID aliases.
// The frontend sends these IDs; map them to our standard configs.
const RAPIDAPI_ALIASES = {
  93: javascript,   // JavaScript (Node.js 18.15.0)
  102: javascript,  // JavaScript (Node.js 22.x)
  94: typescript,   // TypeScript (5.0.3)
  92: python,       // Python (3.11.2)
};

Object.entries(RAPIDAPI_ALIASES).forEach(([aliasId, lang]) => {
  languagesById.set(Number(aliasId), lang);
});

/**
 * Get language by ID
 * @param {number} id - Language ID
 * @returns {object|null} Language configuration
 */
export function getLanguageById(id) {
  return languagesById.get(id) || null;
}

/**
 * Get all active (non-archived) languages
 * @returns {object[]} List of active languages
 */
export function getActiveLanguages() {
  return languagesList.filter(lang => !lang.is_archived);
}

/**
 * Get all languages (including archived)
 * @returns {object[]} List of all languages
 */
export function getAllLanguages() {
  return languagesList;
}

/**
 * Check if a language ID is valid
 * @param {number} id - Language ID
 * @returns {boolean} True if valid
 */
export function isValidLanguageId(id) {
  return languagesById.has(id);
}

// Status codes (Judge0 compatible)
export const STATUSES = {
  1: { id: 1, description: 'In Queue' },
  2: { id: 2, description: 'Processing' },
  3: { id: 3, description: 'Accepted' },
  4: { id: 4, description: 'Wrong Answer' },
  5: { id: 5, description: 'Time Limit Exceeded' },
  6: { id: 6, description: 'Compilation Error' },
  7: { id: 7, description: 'Runtime Error (SIGSEGV)' },
  8: { id: 8, description: 'Runtime Error (SIGXFSZ)' },
  9: { id: 9, description: 'Runtime Error (SIGFPE)' },
  10: { id: 10, description: 'Runtime Error (SIGABRT)' },
  11: { id: 11, description: 'Runtime Error (NZEC)' },
  12: { id: 12, description: 'Runtime Error (Other)' },
  13: { id: 13, description: 'Internal Error' },
  14: { id: 14, description: 'Exec Format Error' },
};

/**
 * Get status by ID
 * @param {number} id - Status ID
 * @returns {object|null} Status object
 */
export function getStatusById(id) {
  return STATUSES[id] || null;
}

/**
 * Get all statuses
 * @returns {object[]} List of all statuses
 */
export function getAllStatuses() {
  return Object.values(STATUSES);
}

export default {
  getLanguageById,
  getActiveLanguages,
  getAllLanguages,
  isValidLanguageId,
  getStatusById,
  getAllStatuses,
  STATUSES,
};
