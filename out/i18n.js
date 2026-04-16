"use strict";
/**
 * i18n.ts – Loads translations from JSON files in the i18n/ directory.
 * Locale is auto-detected from vscode.env.language.
 *
 * Supported: en · de · es · pt · it · fr · ja · zh-TW
 *
 * (c) 2026 FUTURE[code] - Markus Feilen
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getI18n = getI18n;
exports.ti = ti;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function loadLocale(locale) {
    const file = path.join(__dirname, '..', 'i18n', `${locale}.json`);
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    catch {
        return null;
    }
}
function getI18n() {
    const lang = (vscode.env.language ?? 'en').toLowerCase();
    if (lang.startsWith('de')) {
        return loadLocale('de') ?? loadLocale('en');
    }
    if (lang.startsWith('es')) {
        return loadLocale('es') ?? loadLocale('en');
    }
    if (lang.startsWith('pt')) {
        return loadLocale('pt') ?? loadLocale('en');
    }
    if (lang.startsWith('it')) {
        return loadLocale('it') ?? loadLocale('en');
    }
    if (lang.startsWith('fr')) {
        return loadLocale('fr') ?? loadLocale('en');
    }
    if (lang.startsWith('ja')) {
        return loadLocale('ja') ?? loadLocale('en');
    }
    if (lang === 'zh-tw' || lang === 'zh-hant' || lang === 'zh-hk') {
        return loadLocale('zh-tw') ?? loadLocale('en');
    }
    if (lang.startsWith('zh')) {
        return loadLocale('zh-tw') ?? loadLocale('en');
    }
    return loadLocale('en');
}
/** Quick helper: substitute {key} placeholders in a translated string */
function ti(i18n, key, vars) {
    let s = i18n[key] ?? key;
    if (vars) {
        for (const [k, v] of Object.entries(vars)) {
            s = s.replace(`{${k}}`, String(v));
        }
    }
    return s;
}
//# sourceMappingURL=i18n.js.map