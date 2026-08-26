export type IniData = Map<string, Map<string, string[]>>;
export type SectionOrder = string[];

export interface IniParseOptions {
  allowDupSectionTitles?: boolean;
  storeAnyLine?: boolean;
  storeIsolatedLine?: boolean;
  isolatedSection?: string;
  keepEmptySection?: boolean;
}

export class IniReader {
  data: IniData = new Map();
  order: SectionOrder = [];
  options: Required<IniParseOptions>;

  constructor(opts: IniParseOptions = {}) {
    this.options = {
      allowDupSectionTitles: opts.allowDupSectionTitles ?? true,
      storeAnyLine: opts.storeAnyLine ?? false,
      storeIsolatedLine: opts.storeIsolatedLine ?? false,
      isolatedSection: opts.isolatedSection ?? 'custom',
      keepEmptySection: opts.keepEmptySection ?? true,
    };
  }

  private ensureSection(section: string): void {
    if (!this.data.has(section)) {
      this.data.set(section, new Map());
      this.order.push(section);
    }
  }

  parse(content: string): number {
    // Remove BOM
    if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
    const lines = content.split(/\r?\n/);
    let currentSection = '';
    if (this.options.storeIsolatedLine) {
      this.ensureSection(this.options.isolatedSection);
      currentSection = this.options.isolatedSection;
    }

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith(';') || line.startsWith('#') || line.startsWith('//')) continue;

      // Section header
      if (line.startsWith('[') && line.endsWith(']')) {
        const name = line.slice(1, -1).trim();
        if (!name) continue;
        if (this.data.has(name) && !this.options.allowDupSectionTitles) {
          return -1; // DUPLICATE
        }
        this.ensureSection(name);
        currentSection = name;
        continue;
      }

      // Key=value or any line
      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) {
        if (this.options.storeAnyLine) {
          this.ensureSection(currentSection);
          const m = this.data.get(currentSection)!;
          const key = '{NONAME}';
          if (!m.has(key)) m.set(key, []);
          m.get(key)!.push(this.processEscape(line));
        } else if (this.options.storeIsolatedLine && !currentSection) {
          this.ensureSection(this.options.isolatedSection);
          const m = this.data.get(this.options.isolatedSection)!;
          const key = '{NONAME}';
          if (!m.has(key)) m.set(key, []);
          m.get(key)!.push(this.processEscape(line));
        }
        continue;
      }

      const key = line.slice(0, eqIdx).trim();
      const value = this.processEscape(line.slice(eqIdx + 1).trim());
      const section = currentSection || (this.options.storeIsolatedLine ? this.options.isolatedSection : '');
      if (!section && !this.options.storeIsolatedLine) continue;
      this.ensureSection(section || this.options.isolatedSection);
      const sec = section || this.options.isolatedSection;
      const m = this.data.get(sec)!;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(value);
    }
    return 0;
  }

  private processEscape(s: string): string {
    return s.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');
  }

  get(section: string, key: string, def = ''): string {
    const sec = this.data.get(section);
    if (!sec) return def;
    const vals = sec.get(key);
    if (!vals || vals.length === 0) return def;
    return vals[vals.length - 1];
  }

  getAll(section: string, key: string): string[] {
    const sec = this.data.get(section);
    if (!sec) return [];
    // prefix match like C++ get_all
    const result: string[] = [];
    for (const [k, v] of sec) {
      if (k === key || k.startsWith(key)) {
        result.push(...v);
      }
    }
    return result;
  }

  getBool(section: string, key: string, def = false): boolean {
    const v = this.get(section, key, '');
    if (!v) return def;
    return v.toLowerCase() === 'true';
  }

  getInt(section: string, key: string, def = 0): number {
    const v = this.get(section, key, '');
    if (!v) return def;
    const n = parseInt(v, 10);
    return isNaN(n) ? def : n;
  }

  itemPrefixExist(section: string, prefix: string): boolean {
    const sec = this.data.get(section);
    if (!sec) return false;
    for (const k of sec.keys()) {
      if (k.startsWith(prefix)) return true;
    }
    return false;
  }

  hasSection(section: string): boolean {
    return this.data.has(section);
  }
}

export function parseIni(content: string, opts?: IniParseOptions): IniReader {
  const r = new IniReader(opts);
  r.parse(content);
  return r;
}
